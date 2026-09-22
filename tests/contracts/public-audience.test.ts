// S15P21C204-290 공개 대상 계약: ingress·compose·배포 러너가 같은 audience 를 따른다.
//
// 공개 전환은 두 곳을 함께 바꿔야 한다. 하나만 바꾸면 조용히 어긋난다. compose 만 public 이면
// 서버는 게스트를 받을 준비가 되지만 SSO 가 계속 막고, nginx 만 public 이면 로그인 없이
// 도달하지만 서버가 입장을 거절한다. 여기서는 두 벌이 실제로 존재하고 서로 반대인지,
// 러너가 audience 를 받아 overlay 를 고르는지, 기본값이 team 인지를 고정한다.
// 네트워크도 Docker 도 쓰지 않는다: 파일과 프로세스 종료 코드만 본다.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const host = read('infra/nginx/host.conf');
const team = read('infra/nginx/audience-team.conf');
const publicSnippet = read('infra/nginx/audience-public.conf');
const publicOverlay = read('infra/compose.public.yaml');
const runner = read('scripts/deploy-release.mjs');

/**
 * The body of the app's `location / { … }`, the only block the audience changes. The HTTP→HTTPS
 * server has a `location /` too, so take the last one — the one that proxies to the web proxy.
 */
function appLocation(conf: string): string {
  const start = conf.lastIndexOf('\n    location / {');
  expect(start).toBeGreaterThan(0);
  const body = conf.slice(start, conf.indexOf('\n    }', start));
  expect(body).toContain('proxy_pass http://127.0.0.1:8080;');
  return body;
}

describe('ingress', () => {
  it('keeps the audience decision in one included snippet, not in host.conf', () => {
    const body = appLocation(host);
    expect(body).toContain('include /etc/nginx/snippets/kkakkung-audience.conf;');
    // The SSO directives must live in the snippet; left here they would apply to both audiences.
    expect(body).not.toContain('auth_request');
    expect(body).not.toContain('X-SSO-User');
    // The plumbing the team snippet needs stays in host.conf.
    expect(host).toContain('location = /oauth2/auth');
    expect(host).toContain('location @sso_signin');
  });

  it('refuses the operations API at the edge for every audience, whatever the spelling', () => {
    // S15P21C204-296. 접두·정확 일치는 대소문자를 가리는데 Express 는 가리지 않는다. 차단은
    // 대소문자를 무시하는 정규식이어야 하고, 슬래시 없는 bare 접두까지 덮어야 한다.
    expect(host).toMatch(/location ~\* \^\/api\/operations\s+\{ return 404; \}/);
    expect(host).not.toMatch(/location \^~ \/api\/operations/);
    expect(host).toMatch(/location ~\* \^\/api\/dev-sessions\s+\{ return 404; \}/);
    expect(host).toMatch(/location ~\* \^\/\(monitor\|playground\) \{ return 404; \}/);
    // 정확 일치는 정규식보다 먼저 잡히므로 webhook 은 그대로 지난다.
    expect(host).toContain('location = /api/livekit/webhook');
  });

  it('has two snippets that are actual opposites', () => {
    expect(team).toContain('auth_request /oauth2/auth;');
    expect(team).toContain('error_page 401 = @sso_signin;');
    expect(team).toContain('auth_request_set $sso_user $upstream_http_x_auth_request_user;');
    expect(team).toContain('proxy_set_header X-SSO-User $sso_user;');

    expect(publicSnippet).not.toContain('auth_request');
    // Without a login check a caller can send the header itself; the edge must clear it.
    expect(publicSnippet).toContain('proxy_set_header X-SSO-User "";');
    expect(publicSnippet).toContain('proxy_set_header X-Demo-Admin "";');
  });
});

describe('compose overlay', () => {
  it('changes the audience and nothing else', () => {
    expect(publicOverlay).toMatch(/SERVICE_AUDIENCE: public/);
    expect(publicOverlay).toMatch(/SESSION_ADMISSION_MODE: guest/);
    const settings = [...publicOverlay.matchAll(/^ {6}([A-Z_]+):/gm)].map((m) => m[1]);
    expect(settings).toEqual(['SERVICE_AUDIENCE', 'SESSION_ADMISSION_MODE']);
  });

  it('is never part of the default compose set', () => {
    expect(runner).toContain("compose: 'infra/compose.yaml infra/compose.production.yaml'");
    expect(read('Jenkinsfile')).not.toContain('compose.public.yaml');
  });
});

describe('release runner', () => {
  it('follows the recorded audience and only adds the overlay for public', () => {
    expect(runner).toMatch(/recorded \?\? 'team'/);
    expect(runner).toMatch(
      /if \(opt\.audience === 'public'\) selectedFiles\.push\('infra\/compose\.public\.yaml'\)/,
    );
    // The audience overlay must come after the product overlay or `team` would win.
    const productPush = runner.indexOf("'infra/compose.continuous.yaml'");
    const publicPush = runner.indexOf("'infra/compose.public.yaml'");
    expect(productPush).toBeGreaterThan(0);
    expect(publicPush).toBeGreaterThan(productPush);
  });

  it('refuses an audience it does not know', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/deploy-release.mjs'), '--audience', 'everyone'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--audience must be team or public');
  });

  it('refuses a damaged audience record instead of silently deploying team', () => {
    // Without this, a public service would quietly go back to team on the next Jenkins deploy.
    const dir = mkdtempSync(join(tmpdir(), 'kkakkung-audience-'));
    writeFileSync(join(dir, 'audience'), 'everyone\n');
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/deploy-release.mjs'), '--state-dir', dir],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('recorded audience is not team or public');
  });

  it('passes the audience through the product release entry point', () => {
    const product = read('scripts/product-release.mjs');
    expect(product).toContain("'--audience': 'audience'");
    expect(product).toMatch(/opt\.audience \? \['--audience', opt\.audience\] : \[\]/);
  });
});
