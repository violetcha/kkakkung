// F-14 / QA-10 short unit tests: the load client's phase machine with a fake transport and
// clock, the stage plan and gating, and the statistics. No socket, no server, no real time.
import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@kkakkung/protocol/game-messages';
import { GameLoadClient } from './GameLoadClient.ts';
import {
  LOAD_THRESHOLDS,
  buildPlan,
  evaluateStage,
  longestRoundSeconds,
  stageDuration,
  tailIsVisible,
  type ClientStageStats,
} from './GameLoadScenario.ts';
import {
  combinedRounds,
  describe as describeValues,
  quantile,
  slopePerMinute,
} from './LoadStats.ts';

function fakeClient(playerId = 'p1', hostId = 'p1') {
  const sent: CommandEnvelope[] = [];
  let ids = 0;
  const client = new GameLoadClient({
    playerId,
    roomIndex: 0,
    transport: { send: (e) => sent.push(e) },
    createRequestId: () => `req-${++ids}`,
  });
  client.onRoster({ hostId });
  return { client, sent };
}

const active = (loadId: string) => ({
  self: {
    status: 'ACTIVE' as const,
    loading: { loadId, mediaInstanceId: 'media-1', receiverGeneration: 1 },
  },
});

describe('GameLoadClient phase machine', () => {
  it('sends READY once per match in DEVICE_CHECK and nothing before a matchId exists', () => {
    const { client, sent } = fakeClient();
    client.observe({ phase: 'DEVICE_CHECK', matchId: null }, 0);
    client.advance(0);
    expect(sent).toEqual([]);
    client.observe({ phase: 'DEVICE_CHECK', matchId: 'm1' }, 10);
    client.advance(10);
    client.advance(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'READY', matchId: 'm1', sequence: 1 });
  });

  it('sends PRACTICE_READY after the delay and LOAD_READY with the view’s loadId exactly once', () => {
    const { client, sent } = fakeClient();
    client.observe({ phase: 'TEAM_PRACTICE', matchId: 'm1' }, 1000);
    client.advance(1000);
    client.advance(1500);
    expect(sent.filter((e) => e.type === 'PRACTICE_READY')).toHaveLength(0);
    client.advance(2000);
    expect(sent.filter((e) => e.type === 'PRACTICE_READY')).toHaveLength(1);
    client.observe({ phase: 'GAME_LOADING', matchId: 'm1' }, 3000);
    client.advance(3000);
    expect(sent.filter((e) => e.type === 'LOAD_READY')).toHaveLength(0);
    client.onView(active('load-1'));
    client.advance(3100);
    client.advance(3200);
    const loads = sent.filter((e) => e.type === 'LOAD_READY');
    expect(loads).toHaveLength(1);
    expect(loads[0]!.payload).toEqual({
      loadId: 'load-1',
      mediaInstanceId: 'media-1',
      receiverGeneration: 1,
    });
  });

  it('drives moves at 10 Hz and turns every 2 s only while PLAYING, and nothing in COUNTDOWN', () => {
    const { client, sent } = fakeClient();
    client.observe({ phase: 'COUNTDOWN', matchId: 'm1' }, 0);
    for (let t = 0; t <= 1000; t += 50) client.advance(t);
    expect(sent).toEqual([]);
    client.observe({ phase: 'PLAYING', matchId: 'm1' }, 1000);
    for (let t = 1000; t < 6000; t += 50) client.advance(t);
    const moves = sent.filter((e) => e.type === 'MOVE_INTENT');
    const turns = sent.filter((e) => e.type === 'TURN');
    expect(moves.length).toBe(50);
    expect(turns.length).toBe(3);
    // The held direction flips so the character actually travels.
    const directions = new Set(moves.map((m) => (m.payload as { direction: string }).direction));
    expect(directions).toEqual(new Set(['forward', 'back']));
    expect(sent.every((e) => e.matchId === 'm1')).toBe(true);
    expect(new Set(sent.map((e) => e.requestId)).size).toBe(sent.length);
  });

  it('only the host sends REMATCH after RESULT, once per match, and tracks the new match start', () => {
    const host = fakeClient('p1', 'p1');
    const guest = fakeClient('p2', 'p1');
    for (const { client } of [host, guest]) {
      client.observe({ phase: 'RESULT', matchId: 'm1' }, 10_000);
      client.advance(10_000);
      client.advance(10_600);
      client.advance(11_000);
    }
    expect(host.sent.filter((e) => e.type === 'REMATCH')).toHaveLength(1);
    expect(guest.sent.filter((e) => e.type === 'REMATCH')).toHaveLength(0);
    host.client.observe({ phase: 'DEVICE_CHECK', matchId: 'm2' }, 12_000);
    expect(host.client.stats().matchStartsMs).toEqual([10_000, 12_000]);
  });

  it('measures acceptance latency from send to receipt and counts outcomes and aborts', () => {
    const { client, sent } = fakeClient();
    client.observe({ phase: 'PLAYING', matchId: 'm1' }, 0);
    client.advance(0);
    const envelope = sent[0]!;
    client.onReceipt(
      {
        matchId: 'm1',
        requestId: envelope.requestId,
        sequence: envelope.sequence,
        stateVersion: 1,
        status: 'accepted',
        code: null,
      },
      35,
    );
    client.onReceipt(
      {
        matchId: 'm1',
        requestId: 'unknown',
        sequence: 99,
        stateVersion: 1,
        status: 'rejected',
        code: 'INVALID_PHASE',
      },
      40,
    );
    client.onOutcome({
      matchId: 'm1',
      requestId: envelope.requestId,
      sequence: envelope.sequence,
      tick: 3,
      stateVersion: 2,
      result: 'applied',
      code: null,
    });
    client.observe({ phase: 'ABORTED', matchId: 'm1', abortReason: 'GAME_CONNECTION_LOST' }, 100);
    const stats = client.stats();
    expect(stats.ackLatenciesMs).toEqual([35]);
    expect(stats.outcomesApplied).toBe(1);
    expect(stats.abortsSeen).toBe(1);
    expect(stats.abortReasons).toEqual(['GAME_CONNECTION_LOST']);
    // An abort is terminal like RESULT: the host restarts the room instead of idling forever.
    client.advance(700);
    expect(sent.filter((e) => e.type === 'REMATCH')).toHaveLength(1);
    expect(client.pendingCount()).toBe(sent.length - 1);
    client.resetStage();
    expect(client.stats().ackLatenciesMs).toEqual([]);
    expect(client.stats().matchStartsMs).toEqual([0]);
  });
});

describe('stage plan and gating', () => {
  const clientStats = (over: Partial<ClientStageStats> = {}): ClientStageStats => ({
    playerId: 'p',
    roomIndex: 0,
    commandsSent: 600,
    ackLatenciesMs: Array.from({ length: 100 }, (_, i) => 20 + i),
    receiptsRejected: 0,
    outcomesApplied: 600,
    outcomesRejected: 0,
    outcomesCanceled: 0,
    matchStartsMs: [0, 180_000, 360_000, 540_000],
    abortsSeen: 0,
    abortReasons: [],
    phasesSeen: ['PLAYING'],
    ...over,
  });
  const server = (
    over: Partial<NonNullable<Parameters<typeof evaluateStage>[0]['server']>> = {},
  ) => ({
    lagMs: [1, 2, 3, 4, 5],
    tickDuration: Array.from({ length: 60 }, (_, i) => ({
      atMs: Math.floor(i / 6) * 50,
      value: 2,
    })),
    overloads: 0,
    catchups: 0,
    rss: [
      { atMs: 0, value: 100_000_000 },
      { atMs: 60_000, value: 100_500_000 },
    ],
    ...over,
  });

  it('builds the 1→3→5→10 plan with the final duration only on the last stage', () => {
    const plan = buildPlan({ stageDurationSeconds: 60, finalDurationSeconds: 1800 });
    expect(plan.stages).toEqual([1, 3, 5, 10]);
    expect(stageDuration(plan, 0)).toBe(60);
    expect(stageDuration(plan, 3)).toBe(1800);
    expect(() => buildPlan({ stages: [3, 1] })).toThrow();
    expect(() => buildPlan({ stages: [11] })).toThrow();
  });

  it('a clean 60-client stage with server samples passes and combines ten rooms per round', () => {
    const clients = Array.from({ length: 60 }, (_, i) =>
      clientStats({ playerId: `p${i}`, roomIndex: Math.floor(i / 6) }),
    );
    const result = evaluateStage(
      { rooms: 10, durationSeconds: 600, clients, server: server() },
      600_000,
    );
    expect(result.status).toBe('PASS');
    expect(result.stopEscalation).toBe(false);
    expect(result.distributions.tickCombinedMs?.p95).toBe(12);
    expect(result.distributions.rssSlopeBytesPerMinute).toBeCloseTo(500_000, -3);
  });

  it('an overload in the 1-room stage fails and stops escalation to 3 rooms', () => {
    const clients = Array.from({ length: 6 }, (_, i) => clientStats({ playerId: `p${i}` }));
    const result = evaluateStage(
      { rooms: 1, durationSeconds: 60, clients, server: server({ overloads: 1 }) },
      60_000,
    );
    expect(result.status).toBe('FAIL');
    expect(result.stopEscalation).toBe(true);
    expect(result.checks.find((c) => c.name === 'tick.overloads')?.status).toBe('FAIL');
  });

  it('a server process exit during the stage fails server.alive and stops escalation', () => {
    const clients = Array.from({ length: 6 }, (_, i) => clientStats({ playerId: `p${i}` }));
    const result = evaluateStage(
      {
        rooms: 10,
        durationSeconds: 732,
        clients,
        server: server(),
        serverExit: { code: 1, afterSeconds: 732 },
      },
      732_000,
    );
    expect(result.status).toBe('FAIL');
    expect(result.stopEscalation).toBe(true);
    const alive = result.checks.find((c) => c.name === 'server.alive');
    expect(alive?.status).toBe('FAIL');
    expect(alive?.detail).toContain('code=1');
  });

  it('a lag threshold miss fails the stage but does not stop escalation', () => {
    const clients = Array.from({ length: 6 }, (_, i) => clientStats({ playerId: `p${i}` }));
    const result = evaluateStage(
      { rooms: 1, durationSeconds: 60, clients, server: server({ lagMs: [5, 10, 25, 30, 40] }) },
      60_000,
    );
    expect(result.status).toBe('FAIL');
    expect(result.stopEscalation).toBe(false);
    expect(result.checks.find((c) => c.name === 'eventLoop.lag.p95Ms')?.status).toBe('FAIL');
  });

  it('sixty idle connections fail the input coverage check even with perfect latency', () => {
    const clients = Array.from({ length: 60 }, (_, i) =>
      clientStats({ playerId: `p${i}`, commandsSent: 3, ackLatenciesMs: [5, 5, 5] }),
    );
    const result = evaluateStage(
      { rooms: 10, durationSeconds: 1800, clients, server: server() },
      1_800_000,
    );
    expect(result.status).toBe('FAIL');
    const idle = result.checks.find((c) => c.name === 'input.commandsPerClientPerMinute.min')!;
    expect(idle.status).toBe('FAIL');
    expect(idle.value).toBeCloseTo(0.1, 5);
    expect(idle.limit).toBe(LOAD_THRESHOLDS.minCommandsPerClientPerMinute);
  });

  it('a match that runs longer than 200 s without a new matchId is a scenario error', () => {
    expect(longestRoundSeconds([0, 180_000], 300_000)).toBe(180);
    expect(longestRoundSeconds([0], 250_000)).toBe(250);
    expect(longestRoundSeconds([], 1000)).toBeNull();
    const clients = [clientStats({ matchStartsMs: [0] })];
    const result = evaluateStage(
      { rooms: 1, durationSeconds: 300, clients, server: server() },
      300_000,
    );
    expect(result.checks.find((c) => c.name === 'round.longestSeconds')).toMatchObject({
      status: 'FAIL',
      value: 300,
    });
  });

  it('missing tick.duration samples leave the stage INCOMPLETE rather than PASS', () => {
    const clients = Array.from({ length: 6 }, (_, i) => clientStats({ playerId: `p${i}` }));
    const result = evaluateStage(
      { rooms: 1, durationSeconds: 60, clients, server: server({ tickDuration: [] }) },
      60_000,
    );
    expect(result.status).toBe('INCOMPLETE');
    expect(result.stopEscalation).toBe(false);
    expect(result.checks.filter((c) => c.status === 'NOT_MEASURED').map((c) => c.name)).toEqual([
      'tick.combined.p95Ms',
      'tick.combined.p99Ms',
    ]);
  });
});

describe('statistics', () => {
  it('p99 reflects a slow top 1 % and the mean never gates', () => {
    const values = [...Array.from({ length: 99 }, () => 5), 400];
    expect(quantile(values, 0.99)).toBe(400);
    expect(quantile(values, 0.5)).toBe(5);
    expect(tailIsVisible(values)).toBe(true);
    expect(describeValues(values).mean).toBeLessThan(10);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });

  it('combines same-round samples and fits a memory slope', () => {
    const samples = [
      { atMs: 100, value: 2 },
      { atMs: 100, value: 3 },
      { atMs: 150, value: 4 },
    ];
    expect(combinedRounds(samples)).toEqual([5, 4]);
    expect(
      slopePerMinute([
        { atMs: 0, value: 0 },
        { atMs: 60_000, value: 1_000 },
        { atMs: 120_000, value: 2_000 },
      ]),
    ).toBeCloseTo(1000, 6);
    expect(Number.isNaN(slopePerMinute([{ atMs: 0, value: 1 }]))).toBe(true);
  });
});
