import { describe, expect, it, vi } from 'vitest';
import { checksum } from '../../server/src/operations/CheckpointStore.js';
import type { JournalRecord } from '../../server/src/operations/OperationJournal.js';
import {
  confirmFailedStartup,
  confirmStoppedStartup,
  prepareFailedStartupRecovery,
  type StartupObservation,
  type StartupRecoveryInput,
} from '../../scripts/lib/failed-startup-recovery.js';
import type { ReleaseManifest } from '../../scripts/lib/release-sequence.mjs';
import { createStartupRecoveryHost } from '../../scripts/lib/failed-startup-recovery-host.js';

const NOW = 1_800_000_000_000;
const digest = (char: string) => 'sha256:' + char.repeat(64);
const envelope = (state: unknown) => {
  const payload = { version: 1, lastSeq: 1, state };
  return { ...payload, checksum: checksum(payload) };
};
const record: JournalRecord = {
  state: 'REVOKED',
  namespace: 'fixture',
  matchId: 'match',
  mediaInstanceId: 'media',
  serverEpoch: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  roomName: 'fixture--aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa--bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  identity: 'identity',
  generation: 1,
  issuedAtEpochMs: NOW - 120_000,
  expiresAtEpochMs: NOW - 60_000,
  atEpochMs: NOW - 30_000,
  reservationId: 'reservation',
};
const journal = (value = record) => {
  const payload = { version: 1, seq: 1, record: value };
  return JSON.stringify({ ...payload, checksum: checksum(payload) }) + '\n';
};
const emptyAbort = (): JournalRecord => ({
  ...record,
  state: 'ABORTED',
  reservationId: 'never-issued',
  splitOwnership: {
    faceRoomName: `fixture--${record.serverEpoch}--cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    faceIdentity: 'face-only',
    receiverRoomNames: [`fixture--${record.serverEpoch}--dddddddd-dddd-4ddd-8ddd-dddddddddddd`],
  },
  reservationIntent: {
    phase: 'RESERVING',
    requests: [
      {
        reservationId: 'never-issued',
        matchId: record.matchId,
        purpose: 'public',
        slots: 6,
        expectedMinutes: 5,
        expectedBytes: 1000,
        margin: 1,
      },
    ],
  },
});
const released = {
  request: {
    reservationId: 'reservation',
    matchId: 'match',
    purpose: 'public',
    slots: 6,
    expectedMinutes: 5,
    expectedBytes: 1000,
    margin: 0,
  },
  minutes: 30,
  bytes: 1000,
  status: 'RELEASED',
  createdAtEpochMs: NOW - 120_000,
  retiringAtEpochMs: NOW - 90_000,
  retiringAfterVersion: 1,
  retiringPeriodId: 'period',
  remoteConfirmedAtEpochMs: NOW - 80_000,
  releasedAtEpochMs: NOW - 70_000,
};
function fixture() {
  const manifest = (char: string): ReleaseManifest => ({
    releaseSha: char.repeat(40),
    verifiedSha: char.repeat(40),
    tag: char.repeat(8),
    profile: 'product',
    operatingMode: 'continuous',
    images: {
      game: { ref: 'game:' + char.repeat(8), digest: digest(char), revision: char.repeat(40) },
      web: { ref: 'web:' + char.repeat(8), digest: digest(char), revision: char.repeat(40) },
    },
    previous: {
      tag: 'c'.repeat(8),
      images: { game: { digest: digest('c') }, web: { digest: digest('d') } },
    },
  });
  const stepNames = [
    ['manifest', 'PASS'],
    ['images', 'PASS'],
    ['isolation', 'PASS'],
    ['operations', 'PASS'],
    ['DRAIN terminal', 'PASS'],
    ['DRAIN state', 'PASS'],
    ['RELEASE compose up', 'PASS'],
    ['RELEASE recovering', 'INFO'],
    ['RELEASE_READY_TIMEOUT', 'FAIL'],
    ['rollback start', 'INFO'],
    ['ROLLBACK_DRAIN_FAILED', 'FAIL'],
  ];
  const failedReport = {
    releaseSha: 'b'.repeat(40),
    tag: 'b'.repeat(8),
    profile: 'product',
    result: 'ROLLBACK_BLOCKED',
    reason: 'ROLLBACK_DRAIN_FAILED',
    lastGoodWritten: false,
    steps: stepNames.map(([name, status], index) => ({
      name,
      status,
      at: NOW + index * 1000,
      detail:
        name === 'DRAIN state'
          ? 'admission=DRAINING unresolved=0'
          : name === 'RELEASE compose up'
            ? 'tag=' + 'b'.repeat(8)
            : '',
    })),
  };
  const input: StartupRecoveryInput = {
    candidate: manifest('a'),
    failedManifest: manifest('b'),
    failedReport,
  };
  const observed: StartupObservation = {
    containerId: 'f'.repeat(64),
    startedAtMs: NOW + 5500,
    restartCount: 0,
    running: true,
    gameImage: digest('b'),
    webImage: digest('b'),
    namespace: 'fixture',
    teamContinuousProduct: true,
    soleVolumeWriter: true,
    journalModifiedAtMs: NOW - 20_000,
    journal: journal(),
    journalAnchorPresent: false,
    cleanup: envelope({
      namespace: 'fixture',
      historyComplete: true,
      observedTargets: [],
      report: {
        recordedIdentities: 0,
        observedParticipants: 0,
        revoked: 0,
        unresolved: 1,
        ownedRoomsRemaining: 0,
        historyComplete: true,
      },
    }),
    retry: envelope([]),
    usage: envelope({ official: null, reservations: [released] }),
    readiness: { state: 'LOCKED', reasonCodes: ['REMOTE_RETIREMENT_UNCONFIRMED'] },
    operations: { admission: 'LOCKED', readiness: 'LOCKED', unresolvedCount: 1 },
  };
  return { input, observed, failedReport };
}

describe('explicit failed first-start recovery, without Cloud or Docker evidence', () => {
  it('accepts a proven empty aborted issuance without counting it as a revoked identity', () => {
    const { input, observed } = fixture();
    expect(
      confirmFailedStartup(input, {
        ...observed,
        journal: journal(emptyAbort()),
        usage: envelope({ official: null, reservations: [] }),
      }),
    ).toMatchObject({ identities: 0, abortedIssuances: 1, lastSeq: 1 });
  });

  it('rejects an aborted issuance if any root or unexpected child reservation exists', () => {
    const { input, observed } = fixture();
    for (const reservationId of ['never-issued', 'never-issued:1', 'never-issued:foreign']) {
      expect(() =>
        confirmFailedStartup(input, {
          ...observed,
          journal: journal(emptyAbort()),
          usage: envelope({
            official: null,
            reservations: [
              {
                ...released,
                request: { ...released.request, reservationId },
              },
            ],
          }),
        }),
      ).toThrow('FAILED_STARTUP_UNCONFIRMED');
    }
  });

  it('rejects abort records without a pre-signing phase and explicit terminal evidence', () => {
    const { input, observed } = fixture();
    const owner = emptyAbort();
    const cases: JournalRecord[] = [
      { ...owner, reservationIntent: { ...owner.reservationIntent!, phase: 'COMMITTED' } },
      { ...owner, atEpochMs: undefined },
      { ...owner, atEpochMs: owner.issuedAtEpochMs - 1 },
      { ...owner, retirementId: 'unproven-revocation' },
    ];
    for (const candidate of cases) {
      expect(() =>
        confirmFailedStartup(input, {
          ...observed,
          journal: journal(candidate),
          usage: envelope({ official: null, reservations: [] }),
        }),
      ).toThrow('FAILED_STARTUP_UNCONFIRMED');
    }
  });

  it('rejects reopening a terminal aborted issuance even if its final record is revoked', () => {
    const { input, observed } = fixture();
    const owner = emptyAbort();
    const terminal = { ...owner, state: 'REVOKED' as const };
    const payload = { version: 1, seq: 2, record: terminal };
    expect(() =>
      confirmFailedStartup(input, {
        ...observed,
        journal:
          journal(owner) + JSON.stringify({ ...payload, checksum: checksum(payload) }) + '\n',
      }),
    ).toThrow('FAILED_STARTUP_UNCONFIRMED');
  });

  it.each(['downgrade', 'late-intent', 'changed-plan'] as const)(
    'rejects forged pre-signing history even when the final empty abort is valid: %s',
    (kind) => {
      const { input, observed } = fixture();
      const final = emptyAbort();
      const first: JournalRecord = { ...final, state: 'PREPARED' };
      if (kind === 'downgrade')
        Object.assign(first, {
          reservationIntent: { ...final.reservationIntent, phase: 'COMMITTED' },
        });
      if (kind === 'late-intent')
        delete (first as { reservationIntent?: unknown }).reservationIntent;
      if (kind === 'changed-plan')
        Object.assign(first, {
          reservationIntent: {
            ...final.reservationIntent,
            requests: final.reservationIntent!.requests.map((request) => ({
              ...request,
              expectedBytes: request.expectedBytes + 1,
            })),
          },
        });
      const payload = { version: 1, seq: 2, record: final };
      expect(() =>
        confirmFailedStartup(input, {
          ...observed,
          journal:
            journal(first) + JSON.stringify({ ...payload, checksum: checksum(payload) }) + '\n',
          usage: envelope({ official: null, reservations: [] }),
        }),
      ).toThrow('FAILED_STARTUP_UNCONFIRMED');
    },
  );

  it('rejects a remote status endpoint or another host state directory before any IO', () => {
    const http = vi.fn(async () => ({ status: 503, json: null }));
    for (const change of [
      { localUrl: 'https://elsewhere.invalid' },
      { stateDir: '/tmp/another-service' },
    ]) {
      expect(() =>
        createStartupRecoveryHost({
          stateDir: '/opt/kkakkung',
          localUrl: 'http://127.0.0.1:8080',
          http,
          ...change,
        }),
      ).toThrow('STARTUP_HOST_SCOPE_UNCONFIRMED');
    }
    expect(http).not.toHaveBeenCalled();
  });
  it('accepts prior drain plus an unadmitted initial boot and preserves unresolved queries', () => {
    const { input, observed } = fixture();
    expect(confirmFailedStartup(input, observed)).toMatchObject({
      failedSha: 'b'.repeat(40),
      lastSeq: 1,
      identities: 1,
      unresolvedQueries: 1,
    });
  });
  it('preserves legitimate absent retry storage and optional historical timestamps without inventing files', () => {
    const { input, observed } = fixture();
    const legacy: JournalRecord = { ...record };
    delete (legacy as { atEpochMs?: number }).atEpochMs;
    expect(
      confirmFailedStartup(input, {
        ...observed,
        journal: journal(legacy),
        retry: null,
      }),
    ).toMatchObject({ lastSeq: 1, identities: 1 });
    expect(() =>
      confirmFailedStartup(input, {
        ...observed,
        journal: journal({ ...legacy, state: 'UNRESOLVED' }),
        retry: null,
      }),
    ).toThrow('FAILED_STARTUP_UNCONFIRMED');
  });

  it.each([
    { restartCount: 1 },
    { running: false },
    { teamContinuousProduct: false },
    { soleVolumeWriter: false },
    { gameImage: digest('a') },
    { webImage: digest('a') },
    { startedAtMs: NOW + 4500 },
    { startedAtMs: NOW + 6500 },
    { journalModifiedAtMs: NOW + 5501 },
    { journalAnchorPresent: true },
    { journal: journal({ ...record, state: 'UNRESOLVED' }) },
    { journal: journal({ ...record, atEpochMs: NOW + 6000 }) },
    { journal: journal({ ...record, expiresAtEpochMs: NOW + 6000 }) },
    { journal: journal().replace('REVOKED', 'PREPARED') },
    { journal: '' },
    { readiness: { state: 'LOCKED', reasonCodes: ['HISTORY_INCOMPLETE'] } },
    { operations: { admission: 'OPEN', readiness: 'LOCKED', unresolvedCount: 1 } },
    { operations: { admission: 'LOCKED', readiness: 'LOCKED', unresolvedCount: 2 } },
    { usage: envelope({ official: null, reservations: [] }) },
  ] satisfies Partial<StartupObservation>[])(
    'blocks unsafe or changed startup observation %#',
    async (change) => {
      const { input, observed } = fixture();
      const stopAndArchive = vi.fn(async () => {});
      const host = { observe: async () => ({ ...observed, ...change }), stopAndArchive };
      expect(await prepareFailedStartupRecovery(input, host)).toEqual({ code: 1 });
      expect(stopAndArchive).not.toHaveBeenCalled();
    },
  );

  it.each(['resume', 'lastGood', 'drain', 'previous'] as const)(
    'rejects invalid prior release proof: %s',
    (kind) => {
      const { input, observed, failedReport } = fixture();
      let changed = input;
      if (kind === 'resume')
        failedReport.steps.push({
          name: 'RELEASE_RESUME terminal',
          status: 'PASS',
          at: NOW + 20_000,
          detail: '',
        });
      if (kind === 'lastGood') failedReport.lastGoodWritten = true;
      if (kind === 'drain') failedReport.steps[5]!.detail = 'admission=DRAINING unresolved=1';
      if (kind === 'previous')
        changed = { ...input, candidate: { ...input.candidate, previous: null } };
      expect(() => confirmFailedStartup(changed, observed)).toThrow('FAILED_STARTUP_UNCONFIRMED');
    },
  );

  it('observes again before stopping and rejects a change or an archive failure', async () => {
    const { input, observed } = fixture();
    const stopAndArchive = vi.fn(async () => {});
    const host = {
      observe: vi
        .fn()
        .mockResolvedValueOnce(observed)
        .mockResolvedValueOnce({ ...observed, restartCount: 1 }),
      stopAndArchive,
    };
    expect(await prepareFailedStartupRecovery(input, host)).toEqual({ code: 1 });
    expect(stopAndArchive).not.toHaveBeenCalled();
    expect(
      await prepareFailedStartupRecovery(input, {
        observe: async () => observed,
        stopAndArchive: async () => {
          throw new Error('archive failed');
        },
      }),
    ).toEqual({ code: 1 });
    expect(
      await prepareFailedStartupRecovery(input, { observe: async () => observed, stopAndArchive }),
    ).toEqual({ code: 0 });
    expect(stopAndArchive).toHaveBeenCalledOnce();
  });

  it.each([
    { running: true },
    { exitCode: 137 },
    { writerPresent: true },
    { otherVolumeWriters: true },
    { journalHash: 'changed' },
    { stateHash: 'changed' },
  ])('never permits replacement after an unclean or changed stop %#', (change) => {
    const { input, observed } = fixture();
    const proof = confirmFailedStartup(input, observed);
    const stopped = {
      running: false,
      exitCode: 0,
      writerPresent: false,
      otherVolumeWriters: false,
      journalHash: proof.journalHash,
      stateHash: proof.stateHash,
    };
    expect(() => confirmStoppedStartup(proof, stopped)).not.toThrow();
    expect(() => confirmStoppedStartup(proof, { ...stopped, ...change })).toThrow(
      'FAILED_STARTUP_UNCONFIRMED',
    );
  });
});
