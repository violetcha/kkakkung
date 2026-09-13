import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sameJournalGeneration } from '../../src/health/ReservationReadiness.js';
import type { Generation } from '../../src/media/MediaGenerationRegistry.js';
import { checksum } from '../../src/operations/CheckpointStore.js';
import {
  OperationJournal,
  validateJournalRecord,
  type JournalRecord,
} from '../../src/operations/OperationJournal.js';
import { ownedMediaRooms, ownedMediaTargets } from '../../src/operations/SplitMediaOwnership.js';

const directories: string[] = [];
const journals: OperationJournal[] = [];
const epoch = randomUUID();
const room = () => `qa-split--${epoch}--${randomUUID()}`;
const record = (): JournalRecord => ({
  state: 'PREPARED',
  namespace: 'qa-split',
  serverEpoch: epoch,
  matchId: 'm',
  mediaInstanceId: 'practice',
  roomName: room(),
  identity: randomUUID(),
  generation: 1,
  issuedAtEpochMs: 1000,
  expiresAtEpochMs: 301000,
  reservationId: 'reserved',
  splitOwnership: {
    faceRoomName: room(),
    faceIdentity: randomUUID(),
    receiverRoomNames: [room(), room(), room(), room(), room()],
  },
});
async function writer(dir?: string) {
  if (!dir) {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-split-journal-'));
    directories.push(dir);
  }
  const journal = new OperationJournal({ opsDataDir: dir });
  journals.push(journal);
  return { journal, dir };
}
afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      !resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(dir).startsWith('kkakkung-split-journal-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

describe('durable split ownership reader', () => {
  it('owns two token origins and ten possible clones in seven rooms without tokens or player metadata', () => {
    const value = validateJournalRecord(record());
    const targets = ownedMediaTargets(value);
    expect(targets).toHaveLength(12);
    expect(ownedMediaRooms(value)).toHaveLength(7);
    expect(targets.slice(0, 2)).toEqual([
      { roomName: value.roomName, identity: value.identity },
      {
        roomName: value.splitOwnership!.faceRoomName,
        identity: value.splitOwnership!.faceIdentity,
      },
    ]);
    expect(new Set(targets.map((target) => JSON.stringify(target))).size).toBe(12);
    const legacy = { ...value };
    delete legacy.splitOwnership;
    expect(validateJournalRecord(legacy)).toEqual(legacy);
    expect(ownedMediaTargets(legacy)).toEqual([
      { roomName: value.roomName, identity: value.identity },
    ]);
  });

  it.each([
    'same-face-room',
    'same-identity',
    'duplicate-destination',
    'own-destination',
    'foreign-namespace',
    'foreign-epoch',
    'too-many',
    'token-field',
    'missing-field',
    'null',
  ])('rejects %s before it can enter a durable record', (kind) => {
    const value = record();
    const split = {
      ...value.splitOwnership!,
      receiverRoomNames: [...value.splitOwnership!.receiverRoomNames],
    };
    let input: unknown = split;
    if (kind === 'same-face-room') split.faceRoomName = value.roomName;
    if (kind === 'same-identity') split.faceIdentity = value.identity;
    if (kind === 'duplicate-destination')
      split.receiverRoomNames = [split.receiverRoomNames[0]!, split.receiverRoomNames[0]!];
    if (kind === 'own-destination') split.receiverRoomNames = [value.roomName];
    if (kind === 'foreign-namespace')
      split.receiverRoomNames = [room().replace('qa-split', 'other')];
    if (kind === 'foreign-epoch') split.faceRoomName = `qa-split--${randomUUID()}--${randomUUID()}`;
    if (kind === 'too-many') split.receiverRoomNames = Array.from({ length: 6 }, room);
    if (kind === 'token-field') input = { ...split, token: 'not-a-real-secret' };
    if (kind === 'missing-field')
      input = { faceRoomName: split.faceRoomName, faceIdentity: split.faceIdentity };
    if (kind === 'null') input = null;
    expect(() => validateJournalRecord({ ...value, splitOwnership: input })).toThrow();
  });

  it('captures nested ownership before asynchronous append and preserves it through compaction/restart', async () => {
    const first = await writer();
    await first.journal.restore();
    const original = record();
    const mutable = structuredClone(original);
    const append = first.journal.append(mutable);
    (mutable.splitOwnership!.receiverRoomNames as string[]).splice(0);
    await append;
    expect(first.journal.snapshot().records[0]?.record).toEqual(original);
    await first.journal.compact(() => true); // PREPARED is retained despite the supplied callback.
    await first.journal.close();
    const second = await writer(first.dir);
    const replay = await second.journal.restore();
    expect(replay).toMatchObject({ integrity: 'ok', unresolved: true });
    expect(replay.records[0]?.record).toEqual(original);
  });

  it('cannot add, remove or replace ownership while advancing the same generation', async () => {
    const first = await writer();
    await first.journal.restore();
    const value = record();
    await first.journal.append(value);
    const missing = { ...value, state: 'REVOKING' as const };
    delete missing.splitOwnership;
    await expect(first.journal.append(missing)).rejects.toThrow('JOURNAL_OWNERSHIP_CHANGED');
    await expect(
      first.journal.append({
        ...value,
        splitOwnership: { ...value.splitOwnership!, receiverRoomNames: [] },
      }),
    ).rejects.toThrow('JOURNAL_OWNERSHIP_CHANGED');
    expect(first.journal.snapshot().lastSeq).toBe(1);
    await first.journal.append({ ...value, state: 'REVOKING' });
    const legacy = { ...value, identity: randomUUID() };
    delete legacy.splitOwnership;
    await first.journal.append(legacy);
    await expect(
      first.journal.append({ ...legacy, splitOwnership: value.splitOwnership }),
    ).rejects.toThrow('JOURNAL_OWNERSHIP_CHANGED');
  });

  it('rejects a correctly checksummed ownership replacement on disk', async () => {
    const first = await writer();
    await first.journal.restore();
    const value = record();
    await first.journal.append(value);
    await first.journal.close();
    const payload = {
      version: 1 as const,
      seq: 2,
      record: { ...value, splitOwnership: { ...value.splitOwnership!, receiverRoomNames: [] } },
    };
    await fs.appendFile(
      first.journal.filePath,
      `${JSON.stringify({ ...payload, checksum: checksum(payload) })}\n`,
    );
    const second = await writer(first.dir);
    expect(await second.journal.restore()).toMatchObject({
      integrity: 'corrupt',
      writable: false,
      unresolved: true,
    });
  });

  it('does not let a retention callback mutate nested durable ownership', async () => {
    const first = await writer();
    await first.journal.restore();
    const value = { ...record(), state: 'REVOKED' as const };
    await first.journal.append(value);
    await expect(
      first.journal.compact((entry) => {
        (entry.splitOwnership!.receiverRoomNames as string[]).pop();
        return true;
      }),
    ).rejects.toThrow();
    expect(first.journal.snapshot().records[0]?.record).toEqual(value);
  });

  it('matches readiness only when the current generation owns the exact durable destinations', () => {
    const value = record();
    const generation: Generation = {
      ...value,
      reservationId: 'reserved',
      terminal: false,
      request: {
        requestId: 'req',
        matchId: 'm',
        mediaInstanceId: 'practice',
        playerId: 'p',
        purpose: 'practice',
        expectedPreviousGeneration: null,
      },
    };
    expect(sameJournalGeneration(value, generation)).toBe(true);
    generation.splitOwnership = { ...value.splitOwnership!, receiverRoomNames: [] };
    expect(sameJournalGeneration(value, generation)).toBe(false);
    delete generation.splitOwnership;
    expect(sameJournalGeneration(value, generation)).toBe(false);
  });
});
