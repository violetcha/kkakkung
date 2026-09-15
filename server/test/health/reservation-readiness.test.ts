import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  inspectReservationReadiness,
  ReservationReadinessInspector,
  REUSED_GENERATION_FIELDS,
  REUSED_REQUEST_FIELDS,
  type ReservationReadinessInput,
} from '../../src/health/ReservationReadiness.js';
import {
  MediaGenerationRegistry,
  type Generation,
} from '../../src/media/MediaGenerationRegistry.js';
import { checksum } from '../../src/operations/CheckpointStore.js';
import * as checkpointStore from '../../src/operations/CheckpointStore.js';
import { freezeSnapshot } from '../../src/operations/ImmutableSnapshot.js';
import type { JournalEntry, JournalRecord } from '../../src/operations/OperationJournal.js';
import type { UsageReservation } from '../../src/operations/UsageCheckpoint.js';
import { practiceFrame, prepareRequest } from '../media/generation-fixtures.js';

const NOW = 1_800_000_000_000;

describe('exact accounting reuse', () => {
  it('reuses frozen history but rechecks mutable generations and replacement records', () => {
    const { generation, input } = setup();
    const frozen = {
      ...input,
      records: freezeSnapshot(structuredClone(input.records)),
      reservations: freezeSnapshot(structuredClone(input.reservations)),
    };
    const inspector = new ReservationReadinessInspector();
    expect(inspector.inspect(frozen).consistent).toBe(true);
    generation.terminal = true;
    expect(inspector.inspect(frozen).unresolvedCount).toBe(1);
    generation.terminal = false;
    expect(inspector.inspect(frozen).consistent).toBe(true);
    expect(
      inspector.inspect({
        ...frozen,
        records: freezeSnapshot([{ ...frozen.records[0]!, checksum: 'corrupt' }]),
      }).consistent,
    ).toBe(false);
  });

  it('does not trust shallow-frozen caller arrays with mutable entries', () => {
    const { input } = setup();
    const records = Object.freeze(structuredClone(input.records));
    const inspector = new ReservationReadinessInspector();
    expect(inspector.inspect({ ...input, records }).consistent).toBe(true);
    records[0]!.record.state = 'REVOKED';
    expect(inspector.inspect({ ...input, records }).consistent).toBe(false);
  });

  it('does not rehash unchanged journal entries while accepting fresh equivalent snapshots', () => {
    const { input } = setup();
    const inspector = new ReservationReadinessInspector();
    const hash = vi.spyOn(checkpointStore, 'checksum');
    try {
      expect(inspector.inspect(input)).toEqual({ consistent: true, unresolvedCount: 0 });
      const calls = hash.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      for (let i = 0; i < 20; i++)
        expect(inspector.inspect(structuredClone(input)).consistent).toBe(true);
      expect(hash.mock.calls.length).toBe(calls);
    } finally {
      hash.mockRestore();
    }
  });

  it('observes in-place terminal state and changed durable checksums without a clock advance', () => {
    const { generation, input } = setup();
    const inspector = new ReservationReadinessInspector();
    expect(inspector.inspect(input).unresolvedCount).toBe(0);
    generation.terminal = true;
    expect(inspector.inspect(input).unresolvedCount).toBe(1);
    generation.terminal = false;
    expect(inspector.inspect(input).consistent).toBe(true);
    expect(
      inspector.inspect({ ...input, records: [{ ...input.records[0]!, checksum: 'corrupt' }] })
        .consistent,
    ).toBe(false);
  });

  it('rejects a cloned preparation after warming the same value with the exact registry object', () => {
    const { generation, input } = setup();
    const inspector = new ReservationReadinessInspector();
    const preparing = { ...input, records: [], pendingPreparations: [generation] };
    expect(inspector.inspect(preparing).consistent).toBe(true);
    expect(
      inspector.inspect({ ...preparing, pendingPreparations: [structuredClone(generation)] })
        .consistent,
    ).toBe(false);
    expect(inspector.inspect({ ...preparing, pendingPreparations: [] }).consistent).toBe(false);
  });

  it('rechecks exact retirement membership and disappearance of its bounded exemption', () => {
    const { generation, input } = setup();
    generation.terminal = true;
    generation.state = 'REVOKING';
    const retiring = {
      ...input,
      records: [entry(generation)],
      reservations: [reservation(generation.reservationId, { status: 'RETIRING' })],
      pendingRetirements: [generation],
    };
    const inspector = new ReservationReadinessInspector();
    expect(inspector.inspect(retiring)).toEqual({ consistent: true, unresolvedCount: 0 });
    expect(
      inspector.inspect({ ...retiring, pendingRetirements: [structuredClone(generation)] })
        .consistent,
    ).toBe(false);
    expect(inspector.inspect({ ...retiring, pendingRetirements: [] }).unresolvedCount).toBe(1);
  });

  it('detects removed journal records and changed reservation scope even with unchanged seq', () => {
    const { input } = setup();
    const inspector = new ReservationReadinessInspector();
    expect(inspector.inspect(input).consistent).toBe(true);
    expect(inspector.inspect({ ...input, records: [] }).consistent).toBe(false);
    expect(inspector.inspect(input).consistent).toBe(true);
    const changed = structuredClone(input);
    (changed.reservations[0]!.request as { matchId: string }).matchId = 'different';
    expect(inspector.inspect(changed).consistent).toBe(false);
  });

  it('does not hide an extra undefined journal field behind JSON equivalence', () => {
    const { input } = setup();
    const inspector = new ReservationReadinessInspector();
    expect(inspector.inspect(input).consistent).toBe(true);
    const invalidEntry = { ...input.records[0]!, unexpected: undefined };
    expect(inspector.inspect({ ...input, records: [invalidEntry] }).consistent).toBe(false);
  });

  it.each(REUSED_GENERATION_FIELDS)(
    'does not reuse accounting after an in-place %s change',
    (field) => {
      const { generation, input } = setup();
      const changes: Record<keyof Generation, (g: Generation) => unknown> = {
        request: (g) => ({ ...g.request, requestId: 'replaced' }),
        generation: (g) => g.generation + 1,
        roomName: (g) => `${g.roomName}0`,
        identity: (g) => `${g.identity}0`,
        serverEpoch: () => randomUUID(),
        reservationId: (g) => `${g.reservationId}:1`,
        issuedAtEpochMs: (g) => g.issuedAtEpochMs - 1,
        expiresAtEpochMs: (g) => g.expiresAtEpochMs + 1,
        splitOwnership: (g) => ({
          faceRoomName: g.roomName,
          faceIdentity: 'face',
          receiverRoomNames: [],
        }),
        terminal: (g) => !g.terminal,
        state: () => 'REVOKING',
      };
      const inspector = new ReservationReadinessInspector();
      const reused = inspector.inspect(input);
      expect(inspector.inspect(input)).toBe(reused);
      (generation as Record<string, unknown>)[field] = changes[field](generation);
      const inspected = inspector.inspect(input);
      expect(inspected).not.toBe(reused);
      expect(inspected).toEqual(inspectReservationReadiness(input));
    },
  );

  it.each(REUSED_REQUEST_FIELDS)(
    'does not reuse accounting after an in-place request %s change',
    (field) => {
      const { generation, input } = setup();
      const changes: Record<keyof Generation['request'], unknown> = {
        requestId: 'changed',
        matchId: 'changed',
        playerId: 'changed',
        mediaInstanceId: 'changed',
        purpose: 'game',
        expectedPreviousGeneration: 7,
      };
      const inspector = new ReservationReadinessInspector();
      const reused = inspector.inspect(input);
      (generation.request as Record<string, unknown>)[field] = changes[field];
      const inspected = inspector.inspect(input);
      expect(inspected).not.toBe(reused);
      expect(inspected).toEqual(inspectReservationReadiness(input));
    },
  );

  it('reuses frozen split ownership by reference and compares a replacement by value', () => {
    const registry = new MediaGenerationRegistry('e-fixture', false, 'split');
    registry.observe({
      ...practiceFrame,
      participants: [
        practiceFrame.participants[0]!,
        { ...practiceFrame.participants[0]!, playerId: 'q' },
      ],
    });
    const generation = registry.allocate(prepareRequest, NOW);
    const input: ReservationReadinessInput = {
      namespace: registry.namespace,
      serverEpoch: registry.serverEpoch,
      records: freezeSnapshot([entry(generation)]),
      reservations: freezeSnapshot([reservation(generation.reservationId)]),
      generations: registry.all(),
      pendingPreparations: [],
    };
    const inspector = new ReservationReadinessInspector();
    const reused = inspector.inspect(input);
    expect(reused).toEqual({ consistent: true, unresolvedCount: 0 });
    expect(inspector.inspect(input)).toBe(reused);
    const unfrozen = structuredClone(generation.splitOwnership)!;
    generation.splitOwnership = unfrozen;
    expect(inspector.inspect(input)).toBe(reused);
    // Cache the mutable replacement itself, then change it behind the same reference.
    generation.terminal = true;
    expect(inspector.inspect(input)).not.toBe(reused);
    generation.terminal = false;
    const recached = inspector.inspect(input);
    expect(recached).toEqual(reused);
    expect(inspector.inspect(input)).toBe(recached);
    (unfrozen.receiverRoomNames as string[]).pop();
    const inspected = inspector.inspect(input);
    expect(inspected).not.toBe(recached);
    expect(inspected).toEqual(inspectReservationReadiness(input));
    expect(inspected.consistent).toBe(false);
  });

  it('rechecks exact membership when equal values arrive in different objects', () => {
    const { generation, input } = setup();
    const preparing = { ...input, records: [], pendingPreparations: [generation] };
    const inspector = new ReservationReadinessInspector();
    expect(inspector.inspect(preparing).consistent).toBe(true);
    expect(inspector.inspect({ ...preparing, generations: [structuredClone(generation)] })).toEqual(
      { consistent: false, unresolvedCount: 1 },
    );
    expect(inspector.inspect(preparing).consistent).toBe(true);
  });

  it('matches uncached inspection through a sequence of in-place changes and restorations', () => {
    const { registry, generation, input } = setup();
    const second = registry.allocate(
      { ...prepareRequest, requestId: 'second', playerId: 'q' },
      NOW,
    );
    const objects = [generation, second];
    const originals = structuredClone(objects);
    const base = {
      ...input,
      records: freezeSnapshot([entry(generation), entry(second, 2)]),
      reservations: freezeSnapshot([
        reservation(generation.reservationId),
        reservation(second.reservationId),
      ]),
    };
    const changes: ((g: Generation) => void)[] = [
      (g) => (g.terminal = !g.terminal),
      (g) => (g.state = g.state === 'PREPARED' ? 'REVOKING' : 'REVOKED'),
      (g) => (g.reservationId = `${generation.reservationId}:1`),
      (g) => (g.expiresAtEpochMs += 1),
      (g) => ((g.request as { playerId: string }).playerId = 'moved'),
      (g) => (g.request = { ...g.request }),
    ];
    let seed = 20260915;
    const next = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % limit;
    };
    const inspector = new ReservationReadinessInspector();
    for (let step = 0; step < 300; step++) {
      const index = next(objects.length);
      const target = objects[index]!;
      if (next(4) === 0) Object.assign(target, structuredClone(originals[index]!));
      else changes[next(changes.length)]!(target);
      const current = {
        ...base,
        generations: registry.all(),
        pendingPreparations: next(5) === 0 ? [target] : [],
      };
      expect(inspector.inspect(current)).toEqual(inspectReservationReadiness(current));
    }
  });
});

function reservation(root: string, overrides: Partial<UsageReservation> = {}): UsageReservation {
  return {
    request: {
      reservationId: root,
      matchId: 'm',
      purpose: 'public',
      slots: 6,
      expectedMinutes: 5,
      expectedBytes: 1000,
      margin: 1,
    },
    minutes: 60,
    bytes: 2000,
    status: 'ACTIVE',
    createdAtEpochMs: NOW,
    retiringAtEpochMs: null,
    retiringAfterVersion: null,
    retiringPeriodId: null,
    remoteConfirmedAtEpochMs: null,
    releasedAtEpochMs: null,
    ...overrides,
  };
}

function entry(
  generation: Generation,
  seq = 1,
  changes: Partial<JournalRecord> = {},
): JournalEntry {
  const record: JournalRecord = {
    namespace: 'e-fixture',
    matchId: generation.request.matchId,
    mediaInstanceId: generation.request.mediaInstanceId,
    roomName: generation.roomName,
    serverEpoch: generation.serverEpoch,
    identity: generation.identity,
    generation: generation.generation,
    reservationId: generation.reservationId,
    issuedAtEpochMs: generation.issuedAtEpochMs,
    expiresAtEpochMs: generation.expiresAtEpochMs,
    state: generation.state,
    ...(generation.splitOwnership ? { splitOwnership: generation.splitOwnership } : {}),
    ...changes,
  };
  const payload = { version: 1 as const, seq, record };
  return { ...payload, checksum: checksum(payload) };
}

function setup() {
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe({
    ...practiceFrame,
    participants: [
      practiceFrame.participants[0]!,
      { ...practiceFrame.participants[0]!, playerId: 'q' },
    ],
  });
  const generation = registry.allocate(prepareRequest, NOW);
  const input: ReservationReadinessInput = {
    namespace: registry.namespace,
    serverEpoch: registry.serverEpoch,
    records: [entry(generation)],
    reservations: [reservation(generation.reservationId)],
    generations: registry.all(),
    pendingPreparations: [],
  };
  return { registry, generation, input };
}

describe('runtime reservation and generation readiness', () => {
  it('accepts a normal current participant and two participants sharing a lease root', () => {
    const { registry, generation, input } = setup();
    expect(inspectReservationReadiness(input)).toEqual({ consistent: true, unresolvedCount: 0 });
    const second = registry.allocate(
      { ...prepareRequest, requestId: 'second', playerId: 'q' },
      NOW,
    );
    second.reservationId = generation.reservationId;
    expect(
      inspectReservationReadiness({
        ...input,
        records: [entry(generation), entry(second, 2)],
        generations: registry.all(),
        reservations: [...input.reservations, reservation(`${generation.reservationId}:1`)],
      }),
    ).toEqual({ consistent: true, unresolvedCount: 0 });
  });

  it('allows the explicitly tracked preparation before and after reservation fsync', () => {
    const { generation, input } = setup();
    const preparing = { ...input, records: [], pendingPreparations: [generation] };
    expect(inspectReservationReadiness({ ...preparing, reservations: [] })).toEqual({
      consistent: true,
      unresolvedCount: 0,
    });
    expect(inspectReservationReadiness(preparing)).toEqual({
      consistent: true,
      unresolvedCount: 0,
    });
    expect(inspectReservationReadiness({ ...preparing, records: input.records })).toEqual({
      consistent: true,
      unresolvedCount: 0,
    });
    expect(inspectReservationReadiness(input)).toEqual({ consistent: true, unresolvedCount: 0 });
  });

  it('does not authorize an orphan reservation from allocation or a cloned pending object', () => {
    const { generation, input } = setup();
    const orphan = { ...input, records: [] };
    expect(inspectReservationReadiness(orphan).consistent).toBe(false);
    expect(
      inspectReservationReadiness({ ...orphan, pendingPreparations: [structuredClone(generation)] })
        .consistent,
    ).toBe(false);
    expect(
      inspectReservationReadiness({ ...orphan, generations: [], pendingPreparations: [generation] })
        .consistent,
    ).toBe(false);
  });

  it('fails closed once a preparation ends without durable PREPARED evidence', () => {
    const { generation, input } = setup();
    generation.terminal = true;
    expect(
      inspectReservationReadiness({ ...input, records: [], pendingPreparations: [generation] }),
    ).toEqual({ consistent: false, unresolvedCount: 1 });
  });

  it('rejects a missing root, a wrong match and a numeric extension without its base', () => {
    const { generation, input } = setup();
    expect(inspectReservationReadiness({ ...input, reservations: [] }).consistent).toBe(false);
    expect(
      inspectReservationReadiness({
        ...input,
        reservations: [
          reservation(generation.reservationId, {
            request: { ...input.reservations[0]!.request, matchId: 'different-match' },
          }),
        ],
      }).consistent,
    ).toBe(false);
    expect(
      inspectReservationReadiness({
        ...input,
        reservations: [reservation(`${generation.reservationId}:1`)],
      }).consistent,
    ).toBe(false);
  });

  it('does not attach a nonnumeric suffix to a root or ambiguously share nested roots', () => {
    const { registry, generation, input } = setup();
    expect(
      inspectReservationReadiness({
        ...input,
        reservations: [...input.reservations, reservation(`${generation.reservationId}:bad`)],
      }).consistent,
    ).toBe(false);
    const second = registry.allocate(
      { ...prepareRequest, requestId: 'second', playerId: 'q' },
      NOW,
    );
    second.reservationId = `${generation.reservationId}:1`;
    expect(
      inspectReservationReadiness({
        ...input,
        records: [entry(generation), entry(second, 2)],
        generations: registry.all(),
        reservations: [...input.reservations, reservation(second.reservationId)],
      }).consistent,
    ).toBe(false);
  });

  it.each(['REVOKING', 'UNRESOLVED'] as const)('counts current %s only once', (state) => {
    const { generation, input } = setup();
    generation.state = state;
    generation.terminal = true;
    expect(
      inspectReservationReadiness({
        ...input,
        records: [entry(generation)],
        reservations: [reservation(generation.reservationId, { status: 'RETIRING' })],
      }),
    ).toEqual({ consistent: true, unresolvedCount: 1 });
  });

  it('counts an old-epoch PREPARED identity without fabricating a registry generation', () => {
    const { input } = setup();
    expect(
      inspectReservationReadiness({ ...input, serverEpoch: randomUUID(), generations: [] }),
    ).toEqual({ consistent: true, unresolvedCount: 1 });
  });

  it('rejects a current-epoch identity missing from the registry', () => {
    const { input } = setup();
    expect(inspectReservationReadiness({ ...input, generations: [] })).toEqual({
      consistent: false,
      unresolvedCount: 1,
    });
  });

  it('counts terminal PREPARED and never trusts an in-memory REVOKED over durable PREPARED', () => {
    const { generation, input } = setup();
    generation.terminal = true;
    expect(inspectReservationReadiness(input).unresolvedCount).toBe(1);
    generation.state = 'REVOKED';
    expect(inspectReservationReadiness(input).unresolvedCount).toBe(1);
  });

  it.each(['AWAITING_OFFICIAL', 'RELEASED'] as const)(
    'rejects %s accounting before every generation is durably revoked',
    (status) => {
      const { generation, input } = setup();
      expect(
        inspectReservationReadiness({
          ...input,
          reservations: [reservation(generation.reservationId, { status })],
        }).consistent,
      ).toBe(false);
    },
  );

  it('accepts durable retirement awaiting official reconciliation without releasing its budget', () => {
    const { generation, input } = setup();
    generation.state = 'REVOKED';
    generation.terminal = true;
    expect(
      inspectReservationReadiness({
        ...input,
        records: [entry(generation)],
        reservations: [reservation(generation.reservationId, { status: 'AWAITING_OFFICIAL' })],
      }),
    ).toEqual({ consistent: true, unresolvedCount: 0 });
  });

  it('keeps a RETIRING reservation unresolved even after its generation is durable REVOKED', () => {
    const { generation, input } = setup();
    generation.state = 'REVOKED';
    generation.terminal = true;
    expect(
      inspectReservationReadiness({
        ...input,
        records: [entry(generation)],
        reservations: [reservation(generation.reservationId, { status: 'RETIRING' })],
      }),
    ).toEqual({ consistent: true, unresolvedCount: 1 });
  });

  it('accepts released reservations and failed pre-reservation generations after compaction', () => {
    const { generation, input } = setup();
    generation.state = 'REVOKED';
    generation.terminal = true;
    expect(
      inspectReservationReadiness({
        ...input,
        records: [],
        reservations: [reservation(generation.reservationId, { status: 'RELEASED' })],
      }),
    ).toEqual({ consistent: true, unresolvedCount: 0 });
    expect(inspectReservationReadiness({ ...input, records: [], reservations: [] })).toEqual({
      consistent: true,
      unresolvedCount: 0,
    });
  });

  it('rejects checksum corruption, duplicated current records and scope mismatch', () => {
    const { generation, input } = setup();
    for (const records of [
      [{ ...entry(generation), checksum: 'corrupted' }],
      [entry(generation), entry(generation, 2)],
      [entry(generation, 1, { namespace: 'foreign' })],
      [entry(generation, 1, { matchId: 'different' })],
    ])
      expect(inspectReservationReadiness({ ...input, records }).consistent).toBe(false);
  });

  it('fails closed without exposing malformed internal values', () => {
    const { generation, input } = setup();
    (generation as unknown as { state: string }).state = 'private-untrusted-value';
    expect(inspectReservationReadiness(input)).toEqual({ consistent: false, unresolvedCount: 1 });
  });

  it('keeps an exact bounded current retirement ready through PREPARED, REVOKING and durable REVOKED accounting', () => {
    const { generation, input } = setup();
    generation.terminal = true;
    for (const state of ['PREPARED', 'REVOKING', 'REVOKED'] as const) {
      generation.state = state;
      const retiring = {
        ...input,
        records: [entry(generation)],
        reservations: [reservation(generation.reservationId, { status: 'RETIRING' })],
        pendingRetirements: [generation],
      };
      expect(inspectReservationReadiness(retiring)).toEqual({
        consistent: true,
        unresolvedCount: 0,
      });
      expect(
        inspectReservationReadiness({ ...retiring, pendingRetirements: [] }).unresolvedCount,
      ).toBe(1);
    }
    expect(
      inspectReservationReadiness({
        ...input,
        records: [entry(generation)],
        reservations: [reservation(generation.reservationId, { status: 'AWAITING_OFFICIAL' })],
      }),
    ).toEqual({ consistent: true, unresolvedCount: 0 });
  });

  it.each(['cloned', 'unlisted', 'prior-boot', 'unresolved'] as const)(
    'rejects a %s retirement exemption instead of hiding unknown occupancy',
    (kind) => {
      const { generation, input } = setup();
      generation.state = 'REVOKING';
      generation.terminal = true;
      if (kind === 'unresolved') generation.state = 'UNRESOLVED';
      const retiring: ReservationReadinessInput = {
        ...input,
        records: [entry(generation)],
        reservations: [reservation(generation.reservationId, { status: 'RETIRING' })],
        generations: kind === 'unlisted' ? [] : input.generations,
        serverEpoch: kind === 'prior-boot' ? randomUUID() : input.serverEpoch,
        pendingRetirements: [kind === 'cloned' ? structuredClone(generation) : generation],
      };
      expect(inspectReservationReadiness(retiring)).toEqual({
        consistent: false,
        unresolvedCount: 1,
      });
    },
  );

  it('never exempts another unresolved identity that shares a pending retirement reservation root', () => {
    const { registry, generation, input } = setup();
    const second = registry.allocate(
      { ...prepareRequest, requestId: 'second-retirement', playerId: 'q' },
      NOW,
    );
    second.reservationId = generation.reservationId;
    generation.state = 'REVOKING';
    generation.terminal = true;
    second.state = 'UNRESOLVED';
    second.terminal = true;
    const retiring = {
      ...input,
      records: [entry(generation), entry(second, 2)],
      generations: registry.all(),
      reservations: [
        reservation(generation.reservationId, { status: 'RETIRING' }),
        reservation(`${generation.reservationId}:1`, { status: 'RETIRING' }),
      ],
      pendingRetirements: [generation],
    };
    expect(inspectReservationReadiness(retiring)).toEqual({ consistent: true, unresolvedCount: 1 });
    expect(
      inspectReservationReadiness({ ...retiring, pendingRetirements: [generation, second] }),
    ).toEqual({ consistent: false, unresolvedCount: 1 });
  });

  it('does not let a pending retirement cover a different durable identity or falsely released accounting', () => {
    const { generation, input } = setup();
    generation.state = 'REVOKING';
    generation.terminal = true;
    expect(
      inspectReservationReadiness({
        ...input,
        records: [entry(generation, 1, { identity: 'different-identity' })],
        pendingRetirements: [generation],
      }).consistent,
    ).toBe(false);
    for (const status of ['AWAITING_OFFICIAL', 'RELEASED'] as const) {
      expect(
        inspectReservationReadiness({
          ...input,
          records: [entry(generation)],
          pendingRetirements: [generation],
          reservations: [reservation(generation.reservationId, { status })],
        }).consistent,
      ).toBe(false);
    }
  });
});
