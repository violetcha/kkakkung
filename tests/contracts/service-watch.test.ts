// S15P21C204-288 host watch contract: one notice per transition, a deploy that recreates the
// containers between two runs is not an outage, only the same container restarting counts as a
// crash, a damaged state file behaves as a fresh one, and the Jenkins job binds the webhook only
// through its Secret text credential. Nothing here asks Docker or contacts Mattermost.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INITIAL_WATCH_STATE,
  WATCH_POLICY,
  WATCH_TARGETS,
  decideWatch,
  formatWatchNotice,
  summarize,
  type WatchObservation,
} from '../../scripts/watch-service.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const MIN = 60_000;

const healthy = (restartCount = 0, id = 'c1'): WatchObservation => ({
  game: { id, running: true, health: 'healthy', restartCount },
  web: { running: true },
  live: { ok: true, status: 200 },
});
const down: WatchObservation = {
  game: { id: 'c1', running: true, health: 'unhealthy', restartCount: 0 },
  web: { running: true },
  live: { ok: false, status: 502 },
};

/** Runs observations five minutes apart, storing state only as the script would. */
function run(observations: WatchObservation[], start = 0) {
  let state: unknown = INITIAL_WATCH_STATE;
  const notices: string[] = [];
  observations.forEach((observation, i) => {
    const result = decideWatch(state, observation, start + i * 5 * MIN, { label: 'test' });
    notices.push(...result.notices.map((n) => n.kind));
    state = result.next;
  });
  return { notices, state: state as ReturnType<typeof decideWatch>['next'] };
}

describe('symptoms', () => {
  it('names each failing part', () => {
    expect(summarize(healthy())).toEqual({ healthy: true, problems: [] });
    expect(summarize(down).problems).toEqual(['GAME_UNHEALTHY', 'LIVE_HTTP_502']);
    expect(
      summarize({ game: null, web: null, live: { ok: false, status: null } }).problems,
    ).toEqual(['GAME_MISSING', 'WEB_MISSING', 'LIVE_UNREACHABLE']);
    expect(
      summarize({
        game: { id: 'c', running: false, health: 'none', restartCount: 0 },
        web: { running: false },
        live: { ok: true, status: 200 },
      }).problems,
    ).toEqual(['GAME_NOT_RUNNING', 'WEB_NOT_RUNNING']);
  });

  it('judges the HTTP probe alone when Docker could not be asked', () => {
    expect(
      summarize({ game: undefined, web: undefined, live: { ok: true, status: 200 } }).healthy,
    ).toBe(true);
    expect(
      summarize({ game: undefined, web: undefined, live: { ok: false, status: null } }).problems,
    ).toEqual(['LIVE_UNREACHABLE']);
  });
});

describe('outage transitions', () => {
  it(`announces DOWN only after ${WATCH_POLICY.downAfterChecks} failed runs`, () => {
    expect(run([healthy(), down]).notices).toEqual([]);
    expect(run([healthy(), down, down]).notices).toEqual(['DOWN']);
  });

  it('does not call one failed run between deploys an outage', () => {
    expect(run([healthy(), down, healthy(), down, healthy()]).notices).toEqual([]);
  });

  it('reminds while the outage lasts and reports the recovery once', () => {
    const series = [healthy(), ...Array<WatchObservation>(15).fill(down), healthy(), healthy()];
    const { notices, state } = run(series);
    // DOWN at the second failed run, a reminder an hour later, then RECOVERED.
    expect(notices).toEqual(['DOWN', 'STILL_DOWN', 'RECOVERED']);
    expect(state).toMatchObject({ failures: 0, announcedDown: false, downSinceMs: null });
  });

  it('puts the symptoms and the duration in the DOWN and RECOVERED text', () => {
    let state: unknown = INITIAL_WATCH_STATE;
    const texts: string[] = [];
    for (const [at, observation] of [
      [0, down],
      [5 * MIN, down],
      [20 * MIN, healthy()],
    ] as const) {
      const result = decideWatch(state, observation, at, { label: 'j15c204' });
      texts.push(...result.notices.map((n) => n.text));
      state = result.next;
    }
    expect(texts[0]).toContain('**서비스 무응답** · j15c204 (호스트 감시)');
    expect(texts[0]).toContain('연속 2회 확인 실패, 5분 전부터');
    expect(texts[0]).toContain('GAME_UNHEALTHY, LIVE_HTTP_502');
    expect(texts[1]).toContain('**서비스 복구**');
    expect(texts[1]).toContain('약 20분 중단');
  });
});

describe('crash restarts', () => {
  it('reports a restart of the same container', () => {
    const result = run([healthy(0), healthy(2)]);
    expect(result.notices).toEqual(['RESTARTED']);
    expect(result.state.game).toEqual({ id: 'c1', restartCount: 2 });
  });

  it('ignores a new container from a deploy, whatever its count', () => {
    expect(run([healthy(3, 'old'), healthy(5, 'new'), healthy(5, 'new')]).notices).toEqual([]);
  });

  it('keeps the baseline while the container is missing', () => {
    const missing: WatchObservation = { ...healthy(), game: null };
    const { notices } = run([healthy(1), missing, healthy(2)]);
    expect(notices).toEqual(['RESTARTED']);
  });

  it('says the restart and the lost match in the text', () => {
    const text = formatWatchNotice('RESTARTED', { label: 'x', delta: 1, restartCount: 4 });
    expect(text).toContain('Docker가 1회 다시 띄웠다(이 컨테이너 누적 4회)');
    expect(text).toContain('진행 중이던 경기는 복원되지 않는다');
  });
});

describe('stored state', () => {
  it('treats a missing or damaged file as the initial state', () => {
    for (const damaged of [null, 'garbage', { failures: -3, game: { id: 7 } }, []]) {
      const result = decideWatch(damaged, healthy(9), 0);
      expect(result.notices).toEqual([]);
      expect(result.next).toMatchObject({ failures: 0, announcedDown: false, game: { id: 'c1' } });
    }
  });

  it('keeps notices free of URLs and secrets', () => {
    // A restart found in the recovering run is told before the recovery itself.
    const { notices } = run([healthy(0), down, down, healthy(1)]);
    expect(notices).toEqual(['DOWN', 'RESTARTED', 'RECOVERED']);
    for (const kind of ['DOWN', 'STILL_DOWN', 'RECOVERED', 'RESTARTED', 'TEST'] as const) {
      const text = formatWatchNotice(kind, {
        label: 'l',
        failures: 2,
        lastedMs: MIN,
        problems: ['LIVE_UNREACHABLE'],
        delta: 1,
        restartCount: 1,
      });
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/hooks|token/i);
    }
  });
});

describe('command line and Jenkins job', () => {
  const script = resolve(root, 'scripts/watch-service.mjs');

  it('probes the loopback proxy and the two production containers', () => {
    expect(WATCH_TARGETS).toEqual({
      game: 'kkakkung-game',
      web: 'kkakkung-web',
      liveUrl: 'http://127.0.0.1:8080/health/live',
    });
    const compose = readFileSync(resolve(root, 'infra/compose.production.yaml'), 'utf8');
    expect(compose).toContain('container_name: kkakkung-game');
    expect(compose).toContain('container_name: kkakkung-web');
  });

  it('refuses to run without a state file or a webhook', () => {
    const env = { ...process.env, MM_WEBHOOK: '', WATCH_DRY_RUN: '' };
    expect(spawnSync(process.execPath, [script], { env, encoding: 'utf8' }).status).toBe(2);
    const noHook = spawnSync(process.execPath, [script, '--test'], { env, encoding: 'utf8' });
    expect(noHook.status).toBe(1);
  });

  it('prints the test message in a dry run and sends nothing', () => {
    const result = spawnSync(process.execPath, [script, '--test', '--label', 'dry'], {
      env: { ...process.env, MM_WEBHOOK: '', WATCH_DRY_RUN: '1' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('**알림 경로 시험** · dry (호스트 감시)');
  });

  it('runs every five minutes with the webhook bound only from the Secret text credential', () => {
    const job = readFileSync(resolve(root, 'infra/jenkins/watchdog.Jenkinsfile'), 'utf8');
    expect(job).toContain("triggers { cron('H/5 * * * *') }");
    expect(job).toContain(
      "withCredentials([string(credentialsId: 'mattermost-webhook', variable: 'MM_WEBHOOK')])",
    );
    expect(job).toContain(
      'node scripts/watch-service.mjs --state "$STATE_DIR/watchdog-state.json"',
    );
    expect(job).toContain("STATE_DIR = '/opt/kkakkung'");
    expect(job).not.toMatch(/echo[^\n]*MM_WEBHOOK|set -x/);
  });
});
