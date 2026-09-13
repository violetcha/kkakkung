import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OperationJournal,
  validateJournalRecord,
  type JournalRecord,
} from '../../src/operations/OperationJournal.js';

const directories: string[] = [];
const journals: OperationJournal[] = [];
async function fixture(existing?: string) {
  const dir = existing ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-forward-journal-')));
  if (!existing) directories.push(dir);
  const journal = new OperationJournal({ opsDataDir: dir });
  journals.push(journal);
  await journal.restore();
  return { dir, journal };
}
const record = (): JournalRecord => {
  const epoch = randomUUID();
  const room = () => `qa-forward--${epoch}--${randomUUID()}`;
  return {
    state: 'PREPARED',
    namespace: 'qa-forward',
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
      receiverRoomNames: [room(), room()],
    },
  };
};
const target = (owner: JournalRecord, index = 0) => ({
  sourceRoomName: owner.roomName,
  identity: owner.identity,
  destinationRoomName: owner.splitOwnership!.receiverRoomNames[index]!,
});
afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('kkakkung-forward-journal-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

describe('write-ahead forward uncertainty in the actual generation journal', () => {
  it('reclaims an abruptly exited writer and restores its fsynced intent without a completion handle', async () => {
    const f = await fixture();
    await f.journal.close();
    const owner = record();
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      import { readFileSync } from 'node:fs';
      import { OperationJournal } from './server/src/operations/OperationJournal.ts';
      const input = JSON.parse(readFileSync(0, 'utf8'));
      const journal = new OperationJournal({ opsDataDir: input.dir });
      await journal.restore();
      await journal.append(input.owner);
      await journal.prepareForward(input.owner, input.target);
      process.exit(19);
    `,
      ],
      {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)),
        input: JSON.stringify({ dir: f.dir, owner, target: target(owner) }),
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(19);
    const recovered = await fixture(f.dir);
    expect(recovered.journal.writable).toBe(true);
    expect(recovered.journal.readSnapshot().records.at(-1)!.record.forwardIntents).toHaveLength(1);
    await expect(recovered.journal.append({ ...owner, state: 'REVOKED' })).rejects.toThrow(
      'UNCONFIRMED_FORWARD_INTENTS',
    );
  });

  it('keeps concurrent edges through retirement writes and settles only the acknowledged call', async () => {
    const f = await fixture();
    const owner = record();
    await f.journal.append(owner);
    const [first, second] = await Promise.all([
      f.journal.prepareForward(owner, target(owner)),
      f.journal.prepareForward(owner, target(owner, 1)),
    ]);
    await Promise.all([first.completeKnown(), f.journal.append({ ...owner, state: 'REVOKING' })]);
    let current = f.journal.readSnapshot().records.at(-1)!.record;
    expect(current.state).toBe('REVOKING');
    expect(current.forwardIntents).toHaveLength(1);
    expect(current.forwardIntents![0]!.destinationRoomName).toBe(
      target(owner, 1).destinationRoomName,
    );
    await expect(f.journal.append({ ...owner, state: 'REVOKED' })).rejects.toThrow(
      'UNCONFIRMED_FORWARD_INTENTS',
    );
    await expect(f.journal.append({ ...current, forwardIntents: [] })).rejects.toThrow(
      'FORWARD_INTENT_MUTATION_REQUIRED',
    );
    await second.completeKnown();
    current = f.journal.readSnapshot().records.at(-1)!.record;
    expect(current.state).toBe('REVOKING'); // SDK response never completes remote retirement.
    expect(current.forwardIntents).toEqual([]);
    await f.journal.append({ ...owner, state: 'REVOKED' });
    expect(await f.journal.compact(() => true)).toMatchObject({ removed: 1 });
  });

  it('retains a dispatched or not-yet-dispatched intent across file restore and compaction', async () => {
    const f = await fixture();
    const owner = record();
    await f.journal.append(owner);
    const completion = await f.journal.prepareForward(owner, target(owner));
    const before = f.journal.readSnapshot().records.at(-1)!.record.forwardIntents;
    await f.journal.close(); // Lose the process-owned HTTP outcome at this durable boundary.
    const recovered = await fixture(f.dir);
    expect(recovered.journal.readSnapshot().records.at(-1)!.record.forwardIntents).toEqual(before);
    await expect(completion.completeKnown()).rejects.toThrow('JOURNAL_NOT_WRITABLE');
    await recovered.journal.append({ ...owner, state: 'UNRESOLVED' });
    expect(await recovered.journal.compact(() => true)).toMatchObject({ removed: 0, retained: 1 });
    await recovered.journal.close();
    const again = await fixture(f.dir);
    expect(again.journal.readSnapshot().records.at(-1)!.record.forwardIntents).toEqual(before);
    await expect(again.journal.prepareForward(owner, target(owner))).rejects.toThrow(
      'FORWARD_OWNER_NOT_PREPARED',
    );
  });

  it('requires prepared ownership and one pending operation per origin/destination', async () => {
    const f = await fixture();
    const owner = record();
    await expect(f.journal.prepareForward(owner, target(owner))).rejects.toThrow(
      'FORWARD_OWNER_NOT_PREPARED',
    );
    await f.journal.append(owner);
    await f.journal.prepareForward(owner, target(owner));
    await expect(f.journal.prepareForward(owner, target(owner))).rejects.toThrow(
      'UNCONFIRMED_FORWARD_INTENTS',
    );
    await expect(
      f.journal.prepareForward(owner, { ...target(owner, 1), identity: 'foreign' }),
    ).rejects.toThrow('FORWARD_INTENT_OUTSIDE_OWNERSHIP');
    expect(f.journal.readSnapshot().records.at(-1)!.record.forwardIntents).toHaveLength(1);
  });

  it('preserves old single and split records while rejecting malformed/terminal pending evidence', () => {
    const owner = record();
    const intent = { ...target(owner), operationId: randomUUID() };
    expect(validateJournalRecord(owner)).toEqual(owner);
    const legacy = { ...owner };
    delete legacy.splitOwnership;
    expect(validateJournalRecord(legacy)).toEqual(legacy);
    for (const value of [
      null,
      [{ ...intent, token: 'invalid' }],
      [{ ...intent, operationId: '' }],
      [intent, intent],
      Array(11).fill(intent),
    ])
      expect(() => validateJournalRecord({ ...owner, forwardIntents: value })).toThrow();
    expect(() => validateJournalRecord({ ...legacy, forwardIntents: [] })).toThrow();
    expect(() =>
      validateJournalRecord({ ...owner, state: 'REVOKED', forwardIntents: [intent] }),
    ).toThrow();
  });
});
