// F-05 / DP-02 static contract of the container layout. Runtime behaviour (healthy, imports inside the
// image, proxy observation) is covered by scripts/container-smoke.mjs on a Docker host.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const base = read('infra/compose.yaml');
const prod = read('infra/compose.production.yaml');
const game = read('infra/docker/Dockerfile.game-server');
const web = read('infra/docker/Dockerfile.web');
const envExample = read('infra/production.env.example');
const jenkinsfile = read('Jenkinsfile');
const stripComments = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
const servicesOf = (yaml: string) => yaml.split(/^volumes:/m)[0]!;

describe('compose base + production override', () => {
  it('keeps exactly two services and one replica each', () => {
    expect(servicesOf(base).match(/^ {2}[a-z-]+:$/gm)).toEqual(['  web-proxy:', '  game-server:']);
    expect(prod).not.toMatch(/replicas:\s*[2-9]/);
    expect(base).not.toMatch(/replicas:/);
  });
  it('starts web-proxy on live, not ready', () => {
    expect(base).toContain("fetch('http://127.0.0.1:2567/health/live')");
    expect(base).not.toContain("fetch('http://127.0.0.1:2567/health/ready')");
    expect(base).toMatch(/depends_on:\s+game-server:\s+condition: service_healthy/);
  });
  it('binds only the proxy to localhost and exposes no game-server host port', () => {
    expect(base).toContain("'127.0.0.1:8080:80'");
    const gameSection = base.slice(base.indexOf('  game-server:'));
    expect(gameSection).not.toMatch(/^\s+ports:/m);
    expect(prod.slice(prod.indexOf('  game-server:'))).not.toMatch(/^\s+ports:/m);
  });
  it('is an override: images by TAG, no build section, restart, log rotation, stop grace, env_file', () => {
    expect(prod).toMatch(/image: kkakkung-web:\$\{TAG:\?/);
    expect(prod).toMatch(/image: kkakkung-game:\$\{TAG:\?/);
    expect(prod).not.toMatch(/^\s+build:/m);
    expect(prod.match(/restart: unless-stopped/g)).toHaveLength(2);
    expect(prod.match(/max-size: '10m'/g)).toHaveLength(2);
    expect(prod).toMatch(/stop_grace_period: 30s/);
    expect(prod).toMatch(/env_file:\s+- \/opt\/kkakkung\/production\.env/);
  });
  it('keeps the persistent journal on a named volume and no database', () => {
    expect(base).toMatch(/operations:\/var\/lib\/kkakkung/);
    expect(base).toMatch(/^volumes:\n\s+operations:/m);
    for (const forbidden of ['redis', 'postgres', 'mysql', 'mongo']) {
      expect(base.toLowerCase()).not.toContain(forbidden);
      expect(prod.toLowerCase()).not.toContain(forbidden);
    }
  });
  it('puts no secret values in compose or the env template', () => {
    for (const name of ['LIVEKIT_API_SECRET', 'LIVEKIT_API_KEY', 'OPS_TOKEN']) {
      expect(prod).not.toMatch(new RegExp(`${name}:\\s*\\S`));
      expect(base).not.toContain(name);
      expect(envExample).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
    expect(prod).toContain('NODE_ENV: development');
    expect(prod).toMatch(/ALLOWED_ORIGINS: https:\/\/j15c204\.p\.ssafy\.io$/m);
  });
});

describe('runtime images', () => {
  it('game-server runs as node (non-root) from server/dist/main.js without pnpm deploy', () => {
    expect(game).toMatch(/^USER node$/m);
    expect(game).toMatch(/CMD \["node", "dist\/main\.js"\]/);
    expect(game).toMatch(/WORKDIR \/app\/server/);
    expect(stripComments(game)).not.toMatch(/pnpm\s+(?:--filter \S+\s+)?deploy/);
    expect(game).toMatch(
      /pnpm install --prod --frozen-lockfile --filter @kkakkung\/game-server\.\.\./,
    );
    expect(game).toMatch(/mkdir -p \/var\/lib\/kkakkung && chown node:node/);
  });
  it('web image is nginx with the container routing config and the built dist', () => {
    expect(web).toMatch(/^FROM nginx:1\.28-alpine$/m);
    expect(web).toContain('COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf');
    expect(web).toContain('COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html');
  });
  it('never bakes secrets or VITE variables into images', () => {
    for (const df of [game, web]) {
      expect(df).not.toMatch(/ARG\s+(LIVEKIT|OPS_TOKEN|VITE_)/);
      expect(df).not.toMatch(/ENV\s+(LIVEKIT|OPS_TOKEN|VITE_)/);
      expect(df).not.toMatch(/COPY\s+\S*\.env(\s|$)/);
    }
  });
  it('Jenkins tags both images with the short SHA and labels them with the full revision', () => {
    expect(jenkinsfile).toMatch(
      /-t "\$IMG_GAME:\$TAG" --label "org\.opencontainers\.image\.revision=\$GIT_SHA"/,
    );
    expect(jenkinsfile).toMatch(
      /-t "\$IMG_WEB:\$TAG"\s+--label "org\.opencontainers\.image\.revision=\$GIT_SHA"/,
    );
    expect(jenkinsfile).toContain(
      "COMPOSE   = '-f infra/compose.yaml -f infra/compose.production.yaml'",
    );
  });
});
