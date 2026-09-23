/**
 * S15P21C204-259. The scenario runner on a synthetic world: it must only ever emit ordinary
 * commands, walk by the passage graph and give up instead of blocking the room. Whether the
 * rules then produce a restraint or a capture is covered by the room test on A's real core.
 */
import { expect, it } from 'vitest';
import type { GameSubject, Topology } from '../../src/game/ports.js';
import {
  DEMO_SCENARIOS,
  SCENARIO_OPTIONS,
  STEP_TIMEOUT_TICKS,
  availableScenarios,
  scenarioOffers,
  createDemoRunner,
  type DemoOperatorState,
  type DemoWorld,
  type PuppetCommand,
} from '../../src/rooms/DemoScenarios.js';

/** A 5x5 room with a solid border: every inner cell is a passage. */
const topology: Topology = {
  topologyVersion: 'demo-test-1',
  width: 5,
  height: 5,
  walkable: Array.from({ length: 25 }, (_, index) => {
    const x = index % 5;
    const y = Math.floor(index / 5);
    return x > 0 && x < 4 && y > 0 && y < 4;
  }),
};

const player = (
  over: Partial<GameSubject> & Pick<GameSubject, 'playerId' | 'role'>,
): GameSubject => ({
  status: 'ACTIVE',
  cell: { x: 1, y: 1 },
  dir: 0,
  action: null,
  ...over,
});

function world(participants: readonly GameSubject[], over: Partial<DemoWorld> = {}): DemoWorld {
  return {
    tick: 0,
    topology,
    participants,
    exits: [],
    startCells: [],
    challenges: {},
    exchanges: {},
    operatorId: 'operator',
    puppetIds: ['puppet-tagger', 'puppet-runner'],
    ...over,
  };
}

/** Applies what the rules would do: a turn changes facing, a move changes the cell. */
function apply(actor: GameSubject, command: PuppetCommand): GameSubject {
  if (command.type === 'TURN') {
    const step = command.payload.direction === 'right' ? 1 : 3;
    return { ...actor, dir: (((actor.dir + step) % 4) + 4) % 4 };
  }
  if (command.type === 'MOVE_INTENT' && command.payload.direction === 'forward') {
    const vectors = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];
    const vector = vectors[actor.dir]!;
    return { ...actor, cell: { x: actor.cell.x + vector.dx, y: actor.cell.y + vector.dy } };
  }
  return actor;
}

// S15P21C204-317. Since 319 a capture needs an armed grab with the runner one cell in front.
// Walking onto the operator, as this scenario used to, never captured and ran out the budget.
it('brings a puppet tagger beside the operator, faces it and arms its grab', () => {
  const runner = createDemoRunner();
  let tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 }, dir: 0 });
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const sent: PuppetCommand[] = [];
  const start = runner.start('capture', world([operator, tagger]));
  expect(start).toBeNull();

  for (let tick = 1; tick <= 60 && !sent.some((c) => c.type === 'GRAB_INTENT'); tick++) {
    runner.advance(world([operator, tagger], { tick }), (actor, command) => {
      expect(actor).toBe('puppet-tagger');
      sent.push(command);
      tagger = apply(tagger, command);
      return true;
    });
  }
  expect(inFront(tagger, operator)).toBe(true);
  expect(sameCell(tagger, operator)).toBe(false);
  // Only the commands a player could send themselves.
  expect(new Set(sent.map((command) => command.type))).toEqual(
    new Set(['TURN', 'MOVE_INTENT', 'GRAB_INTENT']),
  );
});

it('re-arms after the grab window and follows a prey that stepped away', () => {
  const runner = createDemoRunner();
  let tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 2 }, dir: 0 });
  let operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const grabs: number[] = [];
  expect(runner.start('capture', world([operator, tagger]))).toBeNull();
  const tickOnce = (tick: number) =>
    runner.advance(world([operator, tagger], { tick }), (_actor, command) => {
      if (command.type === 'GRAB_INTENT') grabs.push(tick);
      tagger = apply(tagger, command);
      return true;
    });
  for (let tick = 1; tick <= 20; tick++) tickOnce(tick);
  // Already in front: it arms at once and again each time the window has closed, not every tick.
  expect(grabs[0]).toBe(1);
  expect(grabs.length).toBeGreaterThan(1);
  expect(grabs.every((tick, index) => index === 0 || tick - grabs[index - 1]! >= 8)).toBe(true);

  // The operator walks off to the far corner: the tagger follows and arms there again.
  operator = { ...operator, cell: { x: 3, y: 3 } };
  const before = grabs.length;
  for (let tick = 21; tick <= 120; tick++) tickOnce(tick);
  expect(inFront(tagger, operator)).toBe(true);
  expect(grabs.length).toBeGreaterThan(before);

  operator = { ...operator, status: 'CAPTURED' };
  tickOnce(121);
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });
});

// S15P21C204-342. 완료를 서버가 알려 준다. 웹이 "도는 중이던 것이 사라짐" 으로 추론하면 한 틱에
// 끝나는 대본을 놓치고, 같은 이유로 또 거절돼도 화면이 바뀐 줄 모른다.
it('reports the completed scenario and counts every outcome', () => {
  const runner = createDemoRunner();
  // 앞 칸이 통로인 가운데에 선다. 배치 대본이 그 칸을 쓴다.
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 3 }, dir: 0 });
  let puppet = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } });
  const build = (tick: number) => world([operator, puppet], { tick });
  expect(runner.status).toMatchObject({ completed: null, outcomes: 0 });

  // 한 틱에 끝나는 대본(배치)도 완료로 남는다. 방이 옮겨 준 자리를 세계가 다시 알려 준다.
  expect(runner.start('place-puppet', build(0))).toBeNull();
  for (let tick = 1; tick <= 6 && runner.status.scenario; tick++)
    runner.advance(build(tick), {
      send: () => true,
      place: (actor, cell, dir) => {
        if (actor === puppet.playerId) puppet = { ...puppet, cell, dir };
        return true;
      },
    });
  expect(runner.status).toMatchObject({ completed: 'place-puppet', outcomes: 1, failure: null });

  // 실패는 완료를 지우고 결과 번호만 올린다.
  expect(runner.start('capture', build(4))).toBeNull();
  runner.advance(build(STEP_TIMEOUT_TICKS + 5), () => true);
  expect(runner.status).toMatchObject({ completed: null, outcomes: 2 });
  expect(runner.status.failure).toBe('chase-operator:TIMEOUT');

  // 라운드가 끝나 대본만 내리는 것은 결과가 아니다.
  expect(runner.start('capture', build(STEP_TIMEOUT_TICKS + 6))).toBeNull();
  runner.stop();
  expect(runner.status).toMatchObject({ scenario: null, outcomes: 2 });
});

it('refuses a scenario the world cannot support and reports why', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'tagger' });
  expect(runner.start('capture', world([operator]))).toBe('OPERATOR_MUST_BE_RUNNER');
  expect(runner.start('exit', world([operator]))).toBe('NO_RUNNER_PUPPET');
  expect(runner.status.scenario).toBeNull();
});

it('gives up a step that cannot finish instead of blocking the room', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  const tagger = player({
    playerId: 'puppet-tagger',
    role: 'tagger',
    cell: { x: 3, y: 3 },
  });
  expect(runner.start('capture', world([operator, tagger]))).toBeNull();
  // The puppet never moves, so the step runs out of its budget and the scenario stops. The bound
  // follows the constant: S15P21C204-302 raised the budget for the corridor maze and a hardcoded
  // 1300 silently stopped reaching it.
  for (let tick = 1; tick <= STEP_TIMEOUT_TICKS + 100; tick++)
    runner.advance(world([operator, tagger], { tick }), () => true);
  expect(runner.status.scenario).toBeNull();
  expect(runner.status.failure).toBe('chase-operator:TIMEOUT');
});

/**
 * Runs the scenario on the synthetic world, applying each emitted command to its actor, until
 * the scenario ends or `ticks` pass. `patch` lets a test feed core-owned facts (sessions) back.
 */
function simulate(
  runner: ReturnType<typeof createDemoRunner>,
  actors: Map<string, GameSubject>,
  ticks: number,
  options: {
    patch?: (
      tick: number,
      sent: readonly { actor: string; command: PuppetCommand }[],
    ) => Partial<DemoWorld> | undefined;
    drop?: (actor: string) => boolean;
  } = {},
) {
  const sent: { actor: string; command: PuppetCommand }[] = [];
  const dropped: string[] = [];
  let over: Partial<DemoWorld> = {};
  for (let tick = 1; tick <= ticks && runner.status.scenario !== null; tick++) {
    over = { ...over, ...options.patch?.(tick, sent) };
    runner.advance(world([...actors.values()], { tick, ...over }), {
      send: (actor, command) => {
        sent.push({ actor, command });
        actors.set(actor, apply(actors.get(actor)!, command));
        return true;
      },
      ...(options.drop
        ? { drop: options.drop }
        : {
            drop: (actor) => {
              dropped.push(actor);
              return true;
            },
          }),
    });
  }
  return { sent, dropped };
}

// S15P21C204-342. 목록에서 빼면 버튼이 조용히 사라진다. 전부 보내되 못 쓰는 이유를 붙인다.
it('offers every scenario and says why the ones it cannot start are blocked', () => {
  const operator = player({ playerId: 'operator', role: 'runner' });
  const tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } });
  const offers = scenarioOffers(world([operator, tagger], { puppetIds: ['puppet-tagger'] }));
  expect(offers).toHaveLength(DEMO_SCENARIOS.length);
  const blocked = new Map(offers.map((offer) => [offer.id, offer.unavailable]));
  expect(blocked.get('capture')).toBeUndefined();
  // 도망자 인형이 없으니 그 대본들은 이유와 함께 잠긴다.
  expect(blocked.get('exit')).toBe('NO_RUNNER_PUPPET');
  expect(blocked.get('exchange-trace')).toBe('OPERATOR_MUST_BE_TAGGER');
  // 목록에 남아 있는 것이 핵심이다.
  expect(offers.map((offer) => offer.id)).toContain('exit');
});

it('lists only the scenarios the operator role and the puppets can carry out', () => {
  const asRunner = world([
    player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } }),
    player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 1 } }),
    player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } }),
  ]);
  const runnerList = availableScenarios(asRunner);
  expect(runnerList).toEqual(
    expect.arrayContaining(['trap', 'sensor', 'capture', 'capture-one', 'approach', 'exchange']),
  );
  expect(runnerList).toContain('exchange-cancel');
  expect(runnerList).toContain('abort-connection-lost');
  // A tagger's view and two-runner results need what this world lacks.
  expect(runnerList).not.toContain('exchange-trace');
  expect(runnerList).not.toContain('result-runner-win');
  expect(runnerList).not.toContain('result-tagger-win');
  // No exit is known for the puppet, so the escape scenarios cannot be built.
  expect(runnerList).not.toContain('exit');

  const asTagger = world(
    [
      player({ playerId: 'operator', role: 'tagger', cell: { x: 2, y: 2 } }),
      player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 1 } }),
      player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } }),
      player({ playerId: 'puppet-runner-2', role: 'runner', cell: { x: 3, y: 1 } }),
    ],
    { puppetIds: ['puppet-tagger', 'puppet-runner', 'puppet-runner-2'] },
  );
  const taggerList = availableScenarios(asTagger);
  expect(taggerList).toContain('exchange-trace');
  expect(taggerList).toContain('trap');
  expect(taggerList).not.toContain('capture');
  expect(taggerList).not.toContain('exchange');
  expect(taggerList).not.toContain('exchange-cancel');
});

it('makes two puppet runners exchange beside a tagger operator and accepts the offer it sees', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'tagger', cell: { x: 2, y: 2 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } })],
    [
      'puppet-runner-2',
      player({ playerId: 'puppet-runner-2', role: 'runner', cell: { x: 3, y: 3 } }),
    ],
  ]);
  const puppetIds = ['puppet-runner', 'puppet-runner-2'];
  expect(runner.start('exchange-trace', world([...actors.values()], { puppetIds }))).toBeNull();
  const { sent } = simulate(runner, actors, 200, {
    patch: (_tick, sentSoFar) =>
      // The core opens the session one tick after the request reaches it.
      sentSoFar.some((entry) => entry.command.type === 'EXCHANGE_REQUEST')
        ? { puppetIds, exchanges: { 'puppet-runner': 'x-1', 'puppet-runner-2': 'x-1' } }
        : { puppetIds },
  });
  const request = sent.find((entry) => entry.command.type === 'EXCHANGE_REQUEST');
  expect(request).toMatchObject({
    actor: 'puppet-runner',
    command: { payload: { targetPlayerId: 'puppet-runner-2' } },
  });
  expect(sent.find((entry) => entry.command.type === 'EXCHANGE_ACCEPT')).toMatchObject({
    actor: 'puppet-runner-2',
    command: { payload: { exchangeId: 'x-1' } },
  });
  // Neither runner ever stepped onto the tagger: that would have been a capture, not a trace.
  const operator = actors.get('operator')!;
  expect(sameCell(actors.get('puppet-runner')!, operator)).toBe(false);
  expect(sameCell(actors.get('puppet-runner-2')!, operator)).toBe(false);
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });
});

it('gives up an exchange the rules refused within the offer lifetime, not the step budget', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } })],
  ]);
  expect(runner.start('exchange-cancel', world([...actors.values()]))).toBeNull();
  const { sent } = simulate(runner, actors, 400);
  // The request went out, no session ever appeared, so the cancel was never sent.
  expect(sent.some((entry) => entry.command.type === 'EXCHANGE_REQUEST')).toBe(true);
  expect(sent.some((entry) => entry.command.type === 'EXCHANGE_CANCEL')).toBe(false);
  expect(runner.status.failure).toBe('offer-pending:TIMEOUT');
});

it('withdraws its own offer after the operator has seen it', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } })],
  ]);
  expect(runner.start('exchange-cancel', world([...actors.values()]))).toBeNull();
  const { sent } = simulate(runner, actors, 400, {
    patch: (_tick, sentSoFar) =>
      sentSoFar.some((entry) => entry.command.type === 'EXCHANGE_REQUEST')
        ? { exchanges: { 'puppet-runner': 'x-2' } }
        : undefined,
  });
  expect(sent.at(-1)).toMatchObject({
    actor: 'puppet-runner',
    command: { type: 'EXCHANGE_CANCEL', payload: { exchangeId: 'x-2' } },
  });
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });
});

// S15P21C204-342. 앞 대본이 남긴 교환 요청은 2초 뒤 저절로 사라진다. 그 사이에 취소 대본을 누르면,
// 새 요청을 기다리던 단계가 남은 요청을 보고 지나가 버려 취소할 때는 이미 사라진 뒤였다.
it('waits for a leftover offer to clear before asking for its own', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } })],
  ]);
  expect(runner.start('exchange-cancel', world([...actors.values()]))).toBeNull();
  const leftoverUntil = 60;
  let requestedAt: number | null = null;
  const { sent } = simulate(runner, actors, 400, {
    patch: (tick, sentSoFar) => {
      const requested = sentSoFar.some((entry) => entry.command.type === 'EXCHANGE_REQUEST');
      if (requested && requestedAt === null) requestedAt = tick;
      if (tick < leftoverUntil) return { exchanges: { 'puppet-runner': 'stale-1' } };
      return { exchanges: requested ? { 'puppet-runner': 'x-3' } : {} };
    },
  });
  // 남은 요청이 사라진 뒤에야 제 요청을 낸다. 취소는 제 요청을 향한다.
  expect(requestedAt).toBeGreaterThanOrEqual(leftoverUntil);
  expect(sent.at(-1)).toMatchObject({
    command: { type: 'EXCHANGE_CANCEL', payload: { exchangeId: 'x-3' } },
  });
  expect(runner.status.failure).toBeNull();
});

it('drops one puppet connection and sends no command for the abort scenario', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner' })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } })],
  ]);
  expect(runner.start('abort-connection-lost', world([...actors.values()]))).toBeNull();
  const { sent, dropped } = simulate(runner, actors, 5);
  expect(sent).toEqual([]);
  expect(dropped).toEqual(['puppet-tagger']);
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });

  // A room that cannot drop puppets fails the step instead of leaving the scenario hanging.
  const without = createDemoRunner();
  expect(without.start('abort-connection-lost', world([...actors.values()]))).toBeNull();
  without.advance(world([...actors.values()], { tick: 1 }), () => true);
  expect(without.status.failure).toBe('drop-connection:FAILED');
});

it('moves the installer off the device before a puppet runner walks into it', () => {
  const runner = createDemoRunner();
  // The operator is a tagger facing up: the device goes on (2,1), the cell straight ahead.
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'tagger', cell: { x: 2, y: 2 }, dir: 0 })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 3 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } })],
  ]);
  expect(runner.start('trap', world([...actors.values()]))).toBeNull();
  const { sent } = simulate(runner, actors, 400);
  const install = sent.findIndex((entry) => entry.command.type === 'INSTALL');
  expect(sent[install]?.actor).toBe('puppet-tagger');
  // After installing, the tagger left the device cell and the runner ended on it.
  expect(actors.get('puppet-tagger')!.cell).not.toEqual({ x: 2, y: 1 });
  expect(actors.get('puppet-runner')!.cell).toEqual({ x: 2, y: 1 });
  // The runner only started moving once the tagger's own commands were done.
  const firstRunnerMove = sent.findIndex((entry) => entry.actor === 'puppet-runner');
  const lastTaggerMove = sent.map((entry) => entry.actor).lastIndexOf('puppet-tagger');
  expect(firstRunnerMove).toBeGreaterThan(lastTaggerMove);
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });
});

it('never installs on a start cell or on a cell someone stands on', () => {
  // Straight ahead of the operator (2,1) is a start cell and (1,2) holds a runner puppet, so
  // the device goes on (3,2): the remaining free neighbour of the operator.
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 }, dir: 0 })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 2 } })],
  ]);
  const startCells = [{ x: 2, y: 1 }];
  const runner = createDemoRunner();
  expect(runner.start('trap', world([...actors.values()], { startCells }))).toBeNull();
  const { sent } = simulate(runner, actors, 400, { patch: () => ({ startCells }) });
  const install = sent.findIndex((entry) => entry.command.type === 'INSTALL');
  expect(install).toBeGreaterThan(0);
  // The installer's cell at the moment of installing is where the trap goes.
  const installerPath = sent.slice(0, install).filter((entry) => entry.actor === 'puppet-tagger');
  const before = installerPath.reduce(
    (actor, entry) => apply(actor, entry.command),
    player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } }),
  );
  expect(before.cell).toEqual({ x: 3, y: 2 });
  expect(actors.get('puppet-tagger')!.cell).not.toEqual({ x: 3, y: 2 });
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });

  // With every neighbour taken, the scenario is refused instead of walking into someone.
  const boxed = world(
    [
      player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 }, dir: 0 }),
      player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 2 } }),
      player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 2 } }),
    ],
    {
      startCells: [
        { x: 2, y: 1 },
        { x: 2, y: 3 },
      ],
    },
  );
  expect(createDemoRunner().start('trap', boxed)).toBe('NO_ROOM_TO_INSTALL');
});

it('captures one puppet runner with one puppet tagger for the tally scenario', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 1 } })],
  ]);
  expect(runner.start('capture-one', world([...actors.values()]))).toBeNull();
  simulate(runner, actors, 60, {
    patch: (_tick, sent) => {
      // The rules' capture: an armed grab with the prey one cell in front of the tagger.
      const tagger = actors.get('puppet-tagger')!;
      const prey = actors.get('puppet-runner')!;
      const armed = sent.at(-1)?.command.type === 'GRAB_INTENT';
      if (armed && inFront(tagger, prey))
        actors.set('puppet-runner', { ...prey, status: 'CAPTURED' });
      return undefined;
    },
  });
  expect(actors.get('puppet-runner')!.status).toBe('CAPTURED');
  expect(sameCell(actors.get('puppet-tagger')!, actors.get('operator')!)).toBe(false);
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });
});

function sameCell(a: GameSubject, b: GameSubject) {
  return a.cell.x === b.cell.x && a.cell.y === b.cell.y;
}

/** The runner is the cell right in front of the tagger: what an armed grab reaches. */
function inFront(tagger: GameSubject, prey: GameSubject) {
  const vector = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ][tagger.dir]!;
  return tagger.cell.x + vector.dx === prey.cell.x && tagger.cell.y + vector.dy === prey.cell.y;
}

// S15P21C204-267. On the real server a forward intent stays held until released or expired, and
// the held move resumes in the tick the first cell completes: an unreleased intent is two cells.
it('releases every forward intent on the next tick so a puppet walks exactly one cell', () => {
  const runner = createDemoRunner();
  let tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 }, dir: 0 });
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  expect(runner.start('capture', world([operator, tagger]))).toBeNull();
  const sent: PuppetCommand[] = [];
  for (let tick = 1; tick <= 40 && !inFront(tagger, operator); tick++) {
    // The world shows the move in progress on the tick after the intent, then it lands.
    const last = sent.at(-1);
    const busy = last?.type === 'MOVE_INTENT' && last.payload.direction === 'forward';
    const shown = busy
      ? {
          ...tagger,
          action: {
            kind: 'move' as const,
            from: { ...tagger.cell, dir: tagger.dir },
            to: { ...apply(tagger, last).cell, dir: tagger.dir },
            startTick: tick - 1,
            endTick: tick + 8,
          },
        }
      : tagger;
    runner.advance(world([operator, shown], { tick }), (actor, command) => {
      expect(actor).toBe('puppet-tagger');
      sent.push(command);
      if (command.type === 'MOVE_INTENT' && command.payload.direction === null) {
        // The move the intent started still lands; only the hold is gone.
        tagger = apply(tagger, { type: 'MOVE_INTENT', payload: { direction: 'forward' } });
      }
      if (command.type === 'TURN') tagger = apply(tagger, command);
      return true;
    });
  }
  expect(inFront(tagger, operator)).toBe(true);
  const forwards = sent.filter(
    (command) => command.type === 'MOVE_INTENT' && command.payload.direction === 'forward',
  );
  const releases = sent.filter(
    (command) => command.type === 'MOVE_INTENT' && command.payload.direction === null,
  );
  expect(forwards.length).toBeGreaterThan(0);
  expect(releases.length).toBe(forwards.length);
  // Every release directly follows its intent: nothing else is sent while the puppet is moving.
  sent.forEach((command, index) => {
    if (command.type === 'MOVE_INTENT' && command.payload.direction === 'forward') {
      expect(sent[index + 1]).toEqual({ type: 'MOVE_INTENT', payload: { direction: null } });
    }
  });
});

// ---------------------------------------------------------------------------
// S15P21C204-317. 관리자가 주도하는 대본과 선택지.
//
// 여기서 보는 것은 "대본이 무엇을 요구하는가"다. 그 요구가 구속·포획·탈출로 이어지는지는
// 실제 코어를 도는 방 시험이 본다.
// ---------------------------------------------------------------------------

/** 관리자 상태를 채운 세계. 없으면 관리자 주도 대본은 전부 거절된다. */
function operatorState(over: Partial<DemoOperatorState> = {}): DemoOperatorState {
  return { installations: [], challengeId: null, exchangeId: null, exit: null, ...over };
}

/** 인형 도망자의 출구. 관리자 출구와 달리 미로 반대편에 있을 수 있다. */
const PUPPET_EXIT = {
  exitId: 'exit-puppet',
  ownerId: 'puppet-runner',
  approach: { x: 3, y: 1 },
  wall: { x: 3, y: 0 },
};

const OPERATOR_EXIT = {
  exitId: 'exit-operator',
  ownerId: 'operator',
  approach: { x: 3, y: 1 },
  wall: { x: 3, y: 0 },
};

/** 대본을 돌리며 요청된 배치를 모은다. 코어가 하는 일을 시험 안에서 흉내낸다. */
function runWithPlacement(
  runner: ReturnType<typeof createDemoRunner>,
  build: (tick: number) => DemoWorld,
  ticks: number,
) {
  const placed: { actor: string; cell: { x: number; y: number }; dir: number }[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    runner.advance(build(tick), {
      send: () => true,
      place: (actor, cell, dir) => {
        placed.push({ actor, cell, dir });
        return true;
      },
    });
  }
  return placed;
}

it('받지 않는 선택지는 거절한다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  const tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } });
  // `capture` 는 선택지를 하나도 읽지 않는다. 켜 두면 무시되는 설정처럼 보이므로 거절한다.
  expect(runner.start('capture', world([operator, tagger]), { distance: 2 })).toBe(
    'UNSUPPORTED_OPTION',
  );
  expect(runner.start('approach', world([operator, tagger]), { distance: 9 as 1 })).toBe(
    'UNSUPPORTED_OPTION',
  );
  expect(runner.status.scenario).toBeNull();
});

it('다가오기 대본은 다섯 칸 거리 선택을 받는다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  const tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } });
  expect(runner.start('approach', world([operator, tagger]), { distance: 5 })).toBeNull();
});

it('관리자 상태가 없으면 관리자 주도 대본을 시작하지 않는다', () => {
  // 방(S15P21C204-318)이 채우기 전이다. 반쯤 도는 버튼을 보여 주지 않는다.
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  const puppets = [
    player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } }),
    player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 3 } }),
  ];
  const now = world([operator, ...puppets]);
  expect(runner.start('place-me-at-exit', now)).toBe('NO_OPERATOR_STATE');
  expect(runner.start('caught-in-my-challenge', now)).toBe('NO_OPERATOR_STATE');
  expect(runner.start('accept-my-exchange', now)).toBe('NO_OPERATOR_STATE');
});

it('내 출구 앞으로 관리자를 세우고 출구 벽을 보게 한다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const build = (tick: number) =>
    world([operator], { tick, operator: operatorState({ exit: OPERATOR_EXIT }) });
  expect(runner.start('place-me-at-exit', build(0))).toBeNull();
  expect(runWithPlacement(runner, build, 2)[0]).toEqual({
    actor: 'operator',
    cell: { x: 3, y: 1 },
    dir: 0,
  });
});

// S15P21C204-321. 작은 미로에서는 출구 앞 칸에 인형이 서 있는 배치가 자주 나온다.
it('내 출구 앞에 인형이 서 있으면 먼저 비키게 한 뒤 나를 세운다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const blocker = player({
    playerId: 'puppet-runner',
    role: 'runner',
    cell: OPERATOR_EXIT.approach,
  });
  const build = (tick: number) =>
    world([operator, blocker], { tick, operator: operatorState({ exit: OPERATOR_EXIT }) });
  expect(runner.start('place-me-at-exit', build(0))).toBeNull();
  const placed = runWithPlacement(runner, build, 3);
  expect(placed[0]?.actor).toBe('puppet-runner');
  expect(placed[0]?.cell).not.toEqual(OPERATOR_EXIT.approach);
  expect(runner.status.step).toBe('clear-exit');
});

it('출구가 없거나 술래면 배치 대본을 거절한다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  expect(runner.start('place-me-at-exit', world([operator], { operator: operatorState() }))).toBe(
    'NO_OPERATOR_EXIT',
  );
  const tagger = player({ playerId: 'operator', role: 'tagger' });
  expect(runner.start('place-me-at-exit', world([tagger], { operator: operatorState() }))).toBe(
    'OPERATOR_MUST_BE_RUNNER',
  );
});

it('인형을 고른 방향·거리에 세우고 나를 보게 한다', () => {
  const runner = createDemoRunner();
  // (2,2) 에서 북쪽을 본다. 뒤 한 칸은 (2,3).
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 }, dir: 0 });
  const puppet = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 1 } });
  const build = (tick: number) => world([operator, puppet], { tick, operator: operatorState() });
  expect(runner.start('place-puppet', build(0), { side: 'back', distance: 1 })).toBeNull();
  expect(runWithPlacement(runner, build, 2)[0]).toEqual({
    actor: 'puppet-tagger',
    cell: { x: 2, y: 3 },
    dir: 0,
  });
});

it('등지게 세우면 반대 방향을 본다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 }, dir: 0 });
  const puppet = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 1 } });
  const build = (tick: number) => world([operator, puppet], { tick, operator: operatorState() });
  expect(
    runner.start('place-puppet', build(0), { side: 'back', distance: 1, facing: 'away' }),
  ).toBeNull();
  expect(runWithPlacement(runner, build, 2)[0]?.dir).toBe(2);
});

it('세울 자리가 벽이면 거절한다', () => {
  const runner = createDemoRunner();
  // (1,1) 에서 북쪽 한 칸은 격자 밖이다.
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 }, dir: 0 });
  const puppet = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } });
  expect(
    runner.start('place-puppet', world([operator, puppet], { operator: operatorState() }), {
      side: 'front',
      distance: 1,
    }),
  ).toBe('CELL_UNAVAILABLE');
});

it('배치를 할 수 없는 방에서는 그 단계가 실패한다', () => {
  // `place` 콜백이 없는 방이다. 기다리지 않고 바로 포기한다.
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const build = (tick: number) =>
    world([operator], { tick, operator: operatorState({ exit: OPERATOR_EXIT }) });
  expect(runner.start('place-me-at-exit', build(0))).toBeNull();
  runner.advance(build(1), { send: () => true });
  expect(runner.status.failure).toBe('place-at-exit:FAILED');
});

// S15P21C204-316. 코어는 배치를 조용히 거절한다. 전에는 2분 상한까지 매 틱 다시 요청했다.
it('코어가 받아들이지 않은 배치는 곧바로 실패로 끝난다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const build = (tick: number) =>
    world([operator], { tick, operator: operatorState({ exit: OPERATOR_EXIT }) });
  expect(runner.start('place-me-at-exit', build(0))).toBeNull();
  let requests = 0;
  // 방은 요청을 받지만 관리자는 한 칸도 옮겨지지 않는다.
  for (let tick = 1; tick <= 30 && runner.status.scenario; tick++)
    runner.advance(build(tick), {
      send: () => true,
      place: () => {
        requests += 1;
        return true;
      },
    });
  expect(runner.status.failure).toBe('place-at-exit:FAILED');
  expect(requests).toBeLessThanOrEqual(11);
});

it('다가오기는 역할과 거리를 고를 수 있다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  let puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } });
  // 기본이면 반대 역할을 부르지만, 같은 역할 인형도 부를 수 있다.
  expect(
    runner.start('approach', world([operator, puppet]), { role: 'runner', distance: 2 }),
  ).toBeNull();
  for (let tick = 1; tick <= 60 && runner.status.scenario; tick++) {
    runner.advance(world([operator, puppet], { tick }), (actor, command) => {
      expect(actor).toBe('puppet-runner');
      puppet = apply(puppet, command);
      return true;
    });
  }
  // 고른 거리에서 멈춘다. 가까이 붙이려면 distance 를 1 로 고르면 된다.
  expect(
    Math.abs(puppet.cell.x - operator.cell.x) + Math.abs(puppet.cell.y - operator.cell.y),
  ).toBe(2);
  expect(runner.status.failure).toBeNull();
});

it('내가 장비를 무장할 때까지 기다렸다가 인형이 들어온다', () => {
  const runner = createDemoRunner();
  let operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 1, y: 1 } });
  let puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } });
  const armedAt = { x: 2, y: 2 };
  let armed = false;
  const build = (tick: number) =>
    world([operator, puppet], {
      tick,
      operator: operatorState({
        installations: armed ? [{ kind: 'trap', cell: armedAt, state: 'ARMED' }] : [],
      }),
    });
  // 방이 옮겨 준 자리를 세계가 다시 알려 준다. 관리자 배치는 명령이 아니라 제어다.
  const io = {
    send: (_actor: string, command: PuppetCommand) => {
      puppet = apply(puppet, command);
      return true;
    },
    place: (actor: string, cell: { x: number; y: number }, dir: number) => {
      if (actor === 'operator') operator = { ...operator, cell, dir: dir as GameSubject['dir'] };
      return true;
    },
  };
  expect(runner.start('trap', build(0), { installer: 'me' })).toBeNull();
  // 무장 전에는 인형이 한 칸도 움직이지 않는다.
  for (let tick = 1; tick <= 10; tick++) {
    runner.advance(build(tick), {
      ...io,
      send: () => {
        throw new Error('puppet moved before the operator armed anything');
      },
    });
  }
  armed = true;
  for (let tick = 11; tick <= 80 && runner.status.scenario; tick++) runner.advance(build(tick), io);
  // S15P21C204-342. 장비 칸에 서 있으면 도망자가 들어올 수 없다. 관리자가 먼저 비킨다.
  expect(operator.cell).not.toEqual(armedAt);
  expect(puppet.cell).toEqual(armedAt);
});

// S15P21C204-342. 발동한 덫은 더 이상 무장 상태가 아니다. 자리를 매 Tick 다시 읽던 단계는 도망자가
// 밟는 순간 목표를 잃고 실패로 끝났다. 대본이 보여 주려던 바로 그 순간이었다.
it('덫이 발동해 무장이 풀려도 그 자리를 기억한다', () => {
  const runner = createDemoRunner();
  let operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 1, y: 1 } });
  let puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } });
  const armedAt = { x: 2, y: 2 };
  // 도망자가 옆 칸에 닿는 순간 덫이 발동한 것으로 본다.
  const fired = () =>
    Math.abs(puppet.cell.x - armedAt.x) + Math.abs(puppet.cell.y - armedAt.y) <= 1;
  const build = (tick: number) =>
    world([operator, puppet], {
      tick,
      operator: operatorState({
        installations: [{ kind: 'trap', cell: armedAt, state: fired() ? 'TRIGGERED' : 'ARMED' }],
      }),
    });
  const io = {
    send: (_actor: string, command: PuppetCommand) => {
      puppet = apply(puppet, command);
      return true;
    },
    place: (actor: string, cell: { x: number; y: number }, dir: number) => {
      if (actor === 'operator') operator = { ...operator, cell, dir: dir as GameSubject['dir'] };
      return true;
    },
  };
  expect(runner.start('trap', build(0), { installer: 'me' })).toBeNull();
  for (let tick = 1; tick <= 80 && runner.status.scenario; tick++) runner.advance(build(tick), io);
  expect(runner.status.failure).toBeNull();
  expect(puppet.cell).toEqual(armedAt);
});

// S15P21C204-342. 규칙은 시작 칸 설치를 막는다(EQ-01). 관리자는 자기 시작 칸에서 경기를 시작하므로
// 이 대본은 관리자가 스스로 걸어 나오기 전에는 성립하지 않았고, 화면에는 그 이유가 없었다.
it('설치자가 나면 장비를 놓을 수 있는 자리로 먼저 옮긴다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 1, y: 1 } });
  const puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } });
  const build = (tick: number) =>
    world([operator, puppet], {
      tick,
      operator: operatorState(),
      // 관리자가 선 칸이 곧 시작 칸이다.
      startCells: [operator.cell, puppet.cell],
    });
  expect(runner.start('trap', build(0), { installer: 'me' })).toBeNull();
  const placed = runWithPlacement(runner, build, 2);
  expect(placed[0]?.actor).toBe('operator');
  expect(placed[0]?.cell).not.toEqual(operator.cell);
  expect(runner.status.step).toBe('stand-where-i-can-install');
});

it('감지기를 내가 놓을 때는 벽을 보게 세운다', () => {
  const runner = createDemoRunner();
  // (1,1) 은 벽(0,1)·(1,0) 과 맞닿은 모서리 통로다.
  const operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 1, y: 1 }, dir: 1 });
  const puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } });
  const build = (tick: number) =>
    world([operator, puppet], { tick, operator: operatorState(), startCells: [] });
  expect(runner.start('sensor', build(0), { installer: 'me' })).toBeNull();
  const placed = runWithPlacement(runner, build, 2);
  // 선 자리는 그대로 두고 벽 쪽으로 돌려세운다.
  expect(placed[0]).toMatchObject({ actor: 'operator', cell: { x: 1, y: 1 } });
  expect([0, 3]).toContain(placed[0]!.dir);
});

it('내가 끝내 설치하지 않으면 그 이유로 끝난다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 1, y: 1 } });
  const puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } });
  const build = (tick: number) => world([operator, puppet], { tick, operator: operatorState() });
  expect(runner.start('trap', build(0), { installer: 'me' })).toBeNull();
  runner.advance(build(STEP_TIMEOUT_TICKS + 1), () => true);
  // 밋밋한 TIMEOUT 이 아니라 관리자가 무엇을 안 했는지 말한다.
  expect(runner.status.failure).toBe('operator-installs:NO_INSTALL_FROM_OPERATOR');
});

it('설치자를 나로 두려면 술래여야 한다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  const puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } });
  expect(
    runner.start('trap', world([operator, puppet], { operator: operatorState() }), {
      installer: 'me',
    }),
  ).toBe('OPERATOR_MUST_BE_TAGGER');
});

// S15P21C204-342. 교환은 나눌 지식이 남아야 성립한다. 한 번 교환한 인형만 남으면 규칙이 다음
// 요청을 거절하므로, 대본이 남은 상대를 고르고 없으면 시작 전에 그 이유로 끝난다.
it('이미 지도를 나눈 인형은 건너뛰고 남은 인형을 고른다', () => {
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const shared = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 1 } });
  const fresh = player({ playerId: 'puppet-runner-2', role: 'runner', cell: { x: 1, y: 3 } });
  const build = (over: Partial<DemoWorld> = {}) =>
    world([operator, shared, fresh], {
      puppetIds: ['puppet-runner', 'puppet-runner-2'],
      operator: operatorState(),
      // 첫 인형과는 이미 나눴다.
      exchangeGain: (_from, to) => to === 'puppet-runner-2',
      ...over,
    });
  for (const scenario of ['exchange', 'exchange-cancel', 'accept-my-exchange'] as const) {
    const runner = createDemoRunner();
    expect(runner.start(scenario, build()), scenario).toBeNull();
    const movers = new Set<string>();
    // 첫 틱은 앞선 교환 요청이 비었는지 보는 단계가 쓴다. 움직이는 인형은 그다음 틱에 나온다.
    for (let tick = 1; tick <= 2 && movers.size === 0; tick += 1)
      runner.advance(build({ tick }), (actor) => {
        movers.add(actor);
        return true;
      });
    expect([...movers], scenario).toEqual(['puppet-runner-2']);

    // 남은 상대가 없으면 시작하지 않는다.
    const refused = createDemoRunner();
    expect(refused.start(scenario, build({ exchangeGain: () => false })), scenario).toBe(
      'NO_EXCHANGE_PARTNER',
    );
  }
});

it('흔적 대본은 서로 나눌 지식이 남은 인형 둘을 고른다', () => {
  const operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 1, y: 1 } });
  const first = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 1 } });
  const second = player({ playerId: 'puppet-runner-2', role: 'runner', cell: { x: 1, y: 3 } });
  const build = (gain: (from: string, to: string) => boolean) =>
    world([operator, first, second], {
      puppetIds: ['puppet-runner', 'puppet-runner-2'],
      exchangeGain: gain,
    });
  const runner = createDemoRunner();
  expect(
    runner.start(
      'exchange-trace',
      build(() => true),
    ),
  ).toBeNull();
  expect(
    createDemoRunner().start(
      'exchange-trace',
      build(() => false),
    ),
  ).toBe('NO_EXCHANGE_PARTNER');
});

it('내가 요청하면 인형이 수락을 보낸다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  let puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 2 } });
  let requested = false;
  const build = (tick: number) =>
    world([operator, puppet], {
      tick,
      operator: operatorState(),
      exchanges: requested ? { 'puppet-runner': 'exchange-1' } : {},
    });
  expect(runner.start('accept-my-exchange', build(0))).toBeNull();
  const sent: PuppetCommand[] = [];
  for (let tick = 1; tick <= 30 && runner.status.scenario; tick++) {
    runner.advance(build(tick), (_actor, command) => {
      sent.push(command);
      puppet = apply(puppet, command);
      return true;
    });
    if (tick === 10) requested = true;
  }
  expect(sent).toContainEqual({ type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'exchange-1' } });
  expect(runner.status).toMatchObject({ scenario: null, step: null, failure: null });
});

it('내가 요청하지 않으면 교환 대본이 그 이유로 끝난다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  let puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 2 } });
  const build = (tick: number) => world([operator, puppet], { tick, operator: operatorState() });
  expect(runner.start('accept-my-exchange', build(0))).toBeNull();
  for (let tick = 1; tick <= 20 && runner.status.scenario; tick++) {
    runner.advance(build(tick), (_actor, command) => {
      puppet = apply(puppet, command);
      return true;
    });
  }
  runner.advance(build(STEP_TIMEOUT_TICKS + 40), () => true);
  expect(runner.status.failure).toBe('operator-requests:NO_REQUEST_FROM_OPERATOR');
});

// S15P21C204-342. 인형의 출구는 미로 반대편일 수 있어 20초 안에 걸어갈 수 없었다. 대본이
// 관리자를 그 옆에 세우고, 관리자는 잡기만 누르면 된다.
it('도전 중 포획은 관리자를 도전 중인 인형 옆에 세운다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 1, y: 1 } });
  let puppet = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 1 } });
  let challenging = false;
  const build = (tick: number) =>
    world([operator, puppet], {
      tick,
      exits: [PUPPET_EXIT],
      challenges: challenging ? { 'puppet-runner': 'challenge-1' } : {},
    });
  expect(runner.start('capture-in-challenge', build(0))).toBeNull();
  const placed: { actor: string; cell: { x: number; y: number } }[] = [];
  for (let tick = 1; tick <= 300 && placed.length === 0; tick++) {
    runner.advance(build(tick), {
      send: (_actor, command) => {
        if (command.type === 'EXIT_START') challenging = true;
        puppet = apply(puppet, command);
        return true;
      },
      place: (actor, cell) => {
        placed.push({ actor, cell });
        return true;
      },
    });
  }
  expect(runner.status.step).toBe('stand-beside-challenge');
  expect(placed[0]?.actor).toBe('operator');
  // 인형이 선 칸 바로 옆이다.
  const spot = placed[0]!.cell;
  expect(Math.abs(spot.x - puppet.cell.x) + Math.abs(spot.y - puppet.cell.y)).toBe(1);
});

it('내가 도전을 시작할 때까지 술래 인형이 옆에서 기다린다', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 3, y: 1 } });
  let puppet = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 3 } });
  let challenging = false;
  const build = (tick: number) =>
    world([operator, puppet], {
      tick,
      operator: operatorState({
        exit: OPERATOR_EXIT,
        challengeId: challenging ? 'challenge-1' : null,
      }),
    });
  expect(runner.start('caught-in-my-challenge', build(0))).toBeNull();
  for (let tick = 1; tick <= 60 && runner.status.scenario; tick++) {
    runner.advance(build(tick), (_actor, command) => {
      puppet = apply(puppet, command);
      return true;
    });
  }
  const waitingAt = puppet.cell;
  expect(runner.status.step).toBe('operator-starts-challenge');
  for (let tick = 61; tick <= 90; tick++) {
    runner.advance(build(tick), (_actor, command) => {
      puppet = apply(puppet, command);
      return true;
    });
  }
  // 도전이 시작되기 전에는 한 칸도 더 가지 않는다.
  expect(puppet.cell).toEqual(waitingAt);

  challenging = true;
  let shownChallenge = false;
  const commands: PuppetCommand['type'][] = [];
  for (let tick = 91; tick <= 200 && runner.status.scenario; tick++) {
    runner.advance(build(tick), (_actor, command) => {
      commands.push(command.type);
      puppet = apply(puppet, command);
      return true;
    });
    if (runner.status.step === 'show-my-challenge') shownChallenge = true;
  }
  // It grabs from the cell beside me; stepping onto me is not a capture since 319.
  expect(inFront(puppet, operator)).toBe(true);
  expect(commands).toContain('GRAB_INTENT');
  // S15P21C204-342. 도전이 열리자마자 잡으면 도전 화면을 한 번도 못 본다.
  expect(shownChallenge).toBe(true);
});

it('덫 두 개를 먼 칸부터 놓아 설치자가 앞 칸을 밟지 않는다', () => {
  const runner = createDemoRunner();
  // (2,1) 에서 남쪽을 본다. 앞 두 칸은 (2,2)·(2,3).
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 1 }, dir: 2 });
  let puppet = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 3 } });
  const build = (tick: number) => world([operator, puppet], { tick });
  expect(runner.start('double-trap-immunity', build(0))).toBeNull();
  const installs: { x: number; y: number }[] = [];
  for (let tick = 1; tick <= 600 && runner.status.scenario; tick++) {
    runner.advance(build(tick), (_actor, command) => {
      if (command.type === 'INSTALL') installs.push(puppet.cell);
      puppet = apply(puppet, command);
      return true;
    });
  }
  expect(runner.status.failure).toBeNull();
  expect(installs).toEqual([
    { x: 2, y: 3 },
    { x: 2, y: 2 },
  ]);
});

it('덫 두 칸이 나오지 않으면 거절한다', () => {
  const runner = createDemoRunner();
  // (1,3) 에서 남쪽 한 칸은 격자 밖이다.
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 3 }, dir: 2 });
  const puppet = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } });
  expect(runner.start('double-trap-immunity', world([operator, puppet]))).toBe(
    'NO_ROOM_FOR_TWO_TRAPS',
  );
});

it('관전 대본은 내가 잡힌 뒤에야 두 번째 술래가 움직인다', () => {
  const runner = createDemoRunner();
  let operator = player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } });
  const first = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 1 } });
  const second = player({ playerId: 'puppet-tagger-2', role: 'tagger', cell: { x: 3, y: 3 } });
  const prey = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 3 } });
  const puppetIds = ['puppet-tagger', 'puppet-tagger-2', 'puppet-runner'];
  const build = (tick: number) => world([operator, first, second, prey], { tick, puppetIds });
  expect(runner.start('spectate-then-capture', build(0))).toBeNull();
  const movers = new Set<string>();
  for (let tick = 1; tick <= 20; tick++) {
    runner.advance(build(tick), (actor) => {
      movers.add(actor);
      return true;
    });
  }
  // 아직 내가 ACTIVE 다. 두 번째 술래는 관전이 열릴 때까지 대기한다.
  expect(movers.has('puppet-tagger')).toBe(true);
  expect(movers.has('puppet-tagger-2')).toBe(false);

  operator = { ...operator, status: 'CAPTURED' };
  for (let tick = 21; tick <= 40; tick++) {
    runner.advance(build(tick), (actor) => {
      movers.add(actor);
      return true;
    });
  }
  expect(movers.has('puppet-tagger-2')).toBe(true);
});

// S15P21C204-342. 먼저 교환한 인형이 관리자 옆을 차지하면 다음 인형이 설 자리가 없다. 그대로
// 두면 걷기가 조건을 못 채운 자리로만 옮겨 다니며 상한까지 맴돌았다.
it('교환하러 오는 인형을 위해 옆자리를 비운다', () => {
  // y=1 줄만 통로인 7x3 복도. 관리자 (3,1), 옆 칸 (2,1)·(4,1) 을 인형이 채우고 있다.
  const corridor: Topology = {
    topologyVersion: 'corridor-2',
    width: 7,
    height: 3,
    walkable: Array.from(
      { length: 21 },
      (_, index) => Math.floor(index / 7) === 1 && index % 7 > 0 && index % 7 < 6,
    ),
  };
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 3, y: 1 } });
  const seated = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 2, y: 1 } });
  const partner = player({ playerId: 'puppet-runner-2', role: 'runner', cell: { x: 4, y: 1 } });
  const build = (tick: number) =>
    world([operator, seated, partner], {
      tick,
      topology: corridor,
      puppetIds: ['puppet-runner', 'puppet-runner-2'],
      operator: operatorState(),
      exchangeGain: (_from, to) => to === 'puppet-runner-2',
    });
  const runner = createDemoRunner();
  expect(runner.start('exchange', build(0))).toBeNull();
  const placed = runWithPlacement(runner, build, 2);
  expect(runner.status.step).toBe('make-room-beside-me');
  expect(placed[0]?.actor).toBe('puppet-runner');
});

// S15P21C204-321. 통로 1칸 미로에서는 가만히 선 인형 몸이 길을 아예 막는다. 걷기가 길을 못 찾으면
// 목적지로 옮겨 달라고 한다. 옮길 수 없는 방이면 전처럼 실패로 끝난다.
it('길이 몸으로 막히면 걷는 대신 목적지로 옮긴다', () => {
  // y=1 줄만 통로인 7x3 복도. 걷는 인형 (1,1), 가로막는 인형 (2,1), 출구 앞 (4,1), 나는 (5,1).
  const corridor: Topology = {
    topologyVersion: 'corridor-1',
    width: 7,
    height: 3,
    walkable: Array.from(
      { length: 21 },
      (_, index) => Math.floor(index / 7) === 1 && index % 7 > 0 && index % 7 < 6,
    ),
  };
  const operator = player({ playerId: 'operator', role: 'tagger', cell: { x: 5, y: 1 } });
  const blocker = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 2, y: 1 } });
  const walker = player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } });
  const build = (tick: number) =>
    world([operator, blocker, walker], {
      tick,
      topology: corridor,
      exits: [
        { exitId: 'e', ownerId: 'puppet-runner', approach: { x: 4, y: 1 }, wall: { x: 4, y: 0 } },
      ],
    });
  const runner = createDemoRunner();
  expect(runner.start('exit', build(0))).toBeNull();
  const placed: { actor: string; cell: { x: number; y: number } }[] = [];
  runner.advance(build(1), {
    send: () => true,
    place: (actor, cell) => {
      placed.push({ actor, cell });
      return true;
    },
  });
  expect(runner.status.failure).toBeNull();
  expect(placed).toEqual([{ actor: 'puppet-runner', cell: { x: 4, y: 1 } }]);

  // 옮길 수 없는 방이면 길이 없다고 끝낸다.
  const plain = createDemoRunner();
  expect(plain.start('exit', build(0))).toBeNull();
  plain.advance(build(1), { send: () => true });
  expect(plain.status.failure).toMatch(/:FAILED$/);
});

it('모든 시나리오가 선택지 목록을 갖는다', () => {
  // 웹이 버튼마다 어떤 설정을 보여 줄지 이 표에서 읽는다. 빠지면 그 버튼만 설정이 사라진다.
  for (const scenario of DEMO_SCENARIOS) expect(SCENARIO_OPTIONS[scenario]).toBeDefined();
  expect(Object.keys(SCENARIO_OPTIONS)).toHaveLength(DEMO_SCENARIOS.length);
});

// S15P21C204-313. 선택지 때문에 시작하지 못한 버튼이 아무 반응 없이 끝나지 않게 한다.
it('reports a refused start the same way as a stop, and keeps a running scenario', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  const tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } });
  expect(runner.start('capture', world([operator, tagger]))).toBeNull();
  expect(runner.start('exit', world([operator, tagger]))).toBe('NO_RUNNER_PUPPET');
  expect(runner.status).toMatchObject({
    scenario: 'capture',
    step: 'chase-operator',
    failure: 'exit:NO_RUNNER_PUPPET',
  });
  expect(runner.start('trap', world([operator, tagger]), { distance: 2 })).toBe(
    'UNSUPPORTED_OPTION',
  );
  expect(runner.status.failure).toBe('trap:UNSUPPORTED_OPTION');
});
