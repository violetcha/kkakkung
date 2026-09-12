import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checksum, syncDirectory } from '../../server/src/operations/CheckpointStore.js';
import type { HttpResponse } from './release-sequence.mjs';
import type {
  StartupObservation,
  StartupRecoveryHost,
  StartupRecoveryProof,
} from './failed-startup-recovery.js';
import { confirmStoppedStartup } from './failed-startup-recovery.js';

const DATA_PATH = '/var/lib/docker/volumes/kkakkung_operations/_data';
const VOLUME = 'kkakkung_operations';
const FILE_LIMIT = 16 * 1024 * 1024;
const ARCHIVE_LIMIT = 32 * 1024 * 1024;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

function docker(args: string[]): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 40_000,
    maxBuffer: FILE_LIMIT,
  });
  if (result.status !== 0) throw new Error('STARTUP_DOCKER_CHECK_FAILED');
  return result.stdout.trim();
}

type Container = {
  Id: string;
  Image: string;
  RestartCount: number;
  State: { Running: boolean; StartedAt: string; ExitCode: number };
  Config: { Env: string[]; Labels: Record<string, string> };
  Mounts: { Type: string; Name: string; Destination: string; Source: string; RW: boolean }[];
};
const inspect = (id: string): Container => JSON.parse(docker(['inspect', id]))[0] as Container;

async function readFile(name: string) {
  const target = path.join(DATA_PATH, name);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > FILE_LIMIT)
    throw new Error('STARTUP_UNSAFE_STATE_FILE');
  return { body: await fs.readFile(target), modifiedAtMs: stat.mtimeMs };
}

async function exists(name: string) {
  try {
    await fs.lstat(path.join(DATA_PATH, name));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function optionalRetry() {
  try {
    return JSON.parse(
      (await readFile('revocation-checkpoint.json')).body.toString('utf8'),
    ) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Uses existing local operations authentication; it never extracts LiveKit credentials. */
export function createStartupRecoveryHost(options: {
  stateDir: string;
  localUrl: string;
  http: (method: 'GET', url: string, options?: { bearer?: boolean }) => Promise<HttpResponse>;
  now?: () => number;
}): StartupRecoveryHost {
  if (options.stateDir !== '/opt/kkakkung' || options.localUrl !== 'http://127.0.0.1:8080')
    throw new Error('STARTUP_HOST_SCOPE_UNCONFIRMED');
  const now = options.now ?? Date.now;
  const observe = async (): Promise<StartupObservation> => {
    if (process.platform !== 'linux' || (await fs.realpath(DATA_PATH)) !== DATA_PATH)
      throw new Error('STARTUP_HOST_UNSUPPORTED');
    const game = inspect('kkakkung-game');
    const web = inspect('kkakkung-web');
    const value = (key: string) =>
      game.Config.Env.find((entry) => entry.startsWith(key + '='))?.slice(key.length + 1);
    const mount = game.Mounts.find((entry) => entry.Destination === '/var/lib/kkakkung');
    const volumeWriters = docker([
      'ps',
      '--no-trunc',
      '--filter',
      `volume=${VOLUME}`,
      '--format',
      '{{.ID}}',
    ]).split('\n');
    if (
      mount?.Type !== 'volume' ||
      mount.Name !== VOLUME ||
      mount.Source !== DATA_PATH ||
      !mount.RW ||
      !web.State.Running
    )
      throw new Error('STARTUP_VOLUME_UNCONFIRMED');
    const [ready, status] = await Promise.all([
      options.http('GET', options.localUrl + '/health/ready'),
      options.http('GET', options.localUrl + '/api/operations/status', { bearer: true }),
    ]);
    if (ready.status !== 503 || status.status !== 200)
      throw new Error('STARTUP_STATUS_UNCONFIRMED');
    const [journal, cleanup, retry, usage] = await Promise.all([
      readFile('media-journal.jsonl'),
      readFile('cleanup-checkpoint.json'),
      optionalRetry(),
      readFile('usage-checkpoint.json'),
    ]);
    const startedAtMs = Date.parse(game.State.StartedAt);
    if (startedAtMs > now()) throw new Error('STARTUP_CLOCK_UNCONFIRMED');
    return {
      containerId: game.Id,
      startedAtMs,
      restartCount: game.RestartCount,
      running: game.State.Running,
      gameImage: game.Image,
      webImage: web.Image,
      namespace: value('SERVICE_NAMESPACE') ?? '',
      teamContinuousProduct:
        value('SERVER_PROFILE') === 'product' &&
        value('MEDIA_MODE') === 'livekit' &&
        value('SESSION_ADMISSION_MODE') === 'gitlab-sso' &&
        value('OPS_OPERATING_MODE') === 'continuous' &&
        game.Config.Labels['com.docker.compose.project'] === 'kkakkung',
      soleVolumeWriter: volumeWriters.length === 1 && volumeWriters[0] === game.Id,
      journalModifiedAtMs: journal.modifiedAtMs,
      journal: journal.body.toString('utf8'),
      journalAnchorPresent: await exists('media-journal.jsonl.checkpoint.json'),
      cleanup: JSON.parse(cleanup.body.toString('utf8')) as unknown,
      retry,
      usage: JSON.parse(usage.body.toString('utf8')) as unknown,
      readiness: ready.json as StartupObservation['readiness'],
      operations: status.json as StartupObservation['operations'],
    };
  };
  const stopAndArchive = async (proof: StartupRecoveryProof): Promise<void> => {
    const game = inspect('kkakkung-game');
    const beforeJournal = await readFile('media-journal.jsonl');
    if (
      game.Id !== proof.containerId ||
      !game.State.Running ||
      game.RestartCount !== 0 ||
      Date.parse(game.State.StartedAt) !== proof.startedAtMs ||
      hash(beforeJournal.body) !== proof.journalHash ||
      beforeJournal.modifiedAtMs > proof.startedAtMs
    )
      throw new Error('STARTUP_CHANGED_BEFORE_STOP');
    // Docker stop may use SIGKILL after its grace period. Such a stop cannot authorize replacement.
    docker(['stop', '--time', '30', proof.containerId]);
    const stopped = inspect(proof.containerId);
    const afterJournal = await readFile('media-journal.jsonl');
    const state = await Promise.all([
      readFile('cleanup-checkpoint.json').then(
        (file) => JSON.parse(file.body.toString('utf8')) as unknown,
      ),
      optionalRetry(),
      readFile('usage-checkpoint.json').then(
        (file) => JSON.parse(file.body.toString('utf8')) as unknown,
      ),
    ]);
    confirmStoppedStartup(proof, {
      running: stopped.State.Running,
      exitCode: stopped.State.ExitCode,
      writerPresent: await exists('writer.lock'),
      otherVolumeWriters:
        docker(['ps', '--filter', `volume=${VOLUME}`, '--format', '{{.ID}}']) !== '',
      journalHash: hash(afterJournal.body),
      stateHash: checksum({ cleanup: state[0], retry: state[1], usage: state[2] }),
    });
    const archive = path.join(
      path.resolve(options.stateDir),
      'recovery-backups',
      `${proof.failedSha.slice(0, 8)}-${now()}-${randomUUID()}`,
    );
    await fs.mkdir(archive, { recursive: true, mode: 0o700 });
    const files: { name: string; bytes: number; sha256: string }[] = [];
    let bytes = 0;
    const names = await fs.readdir(DATA_PATH);
    if (names.length > 64) throw new Error('STARTUP_ARCHIVE_LIMIT');
    for (const name of names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
        throw new Error('STARTUP_UNSAFE_ARCHIVE_NAME');
      const { body } = await readFile(name);
      bytes += body.length;
      if (bytes > ARCHIVE_LIMIT) throw new Error('STARTUP_ARCHIVE_LIMIT');
      const handle = await fs.open(path.join(archive, name), 'wx', 0o600);
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      files.push({ name, bytes: body.length, sha256: hash(body) });
    }
    // Archive metadata contains counts/hashes only; the private state stays on the same host.
    const metadata = await fs.open(path.join(archive, 'startup-recovery-proof.json'), 'wx', 0o600);
    try {
      await metadata.writeFile(JSON.stringify({ ...proof, files }, null, 2) + '\n');
      await metadata.sync();
    } finally {
      await metadata.close();
    }
    await syncDirectory(archive);
    await syncDirectory(path.dirname(archive));
  };
  return { observe, stopAndArchive };
}
