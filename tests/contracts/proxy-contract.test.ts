// F-06 / DP-03 static contract of the edge: host nginx (TLS, SSO gate, health open, diagnostics blocked,
// WebSocket pass-through), container nginx routing, and the SSO proxy compose. Live behaviour is
// measured by scripts/deployment-smoke.mjs against the deployed origin.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const host = read('infra/nginx/host.conf');
const https = () => block(host, 'server {\n    listen 443');
const edge = read('infra/nginx/default.conf');
const sso = read('infra/compose.sso.yaml');
const ssoEnv = read('infra/sso.env.example');
const block = (conf: string, start: string) => {
  const i = conf.indexOf(start);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i; j < conf.length; j++) {
    if (conf[j] === '{') depth++;
    if (conf[j] === '}' && --depth === 0) return conf.slice(i, j + 1);
  }
  return conf.slice(i);
};

describe('host nginx (TLS edge)', () => {
  it('redirects http to https and keeps the ACME path', () => {
    const http80 = block(host, 'server {\n    listen 80;');
    expect(http80).toMatch(/return 301 https:\/\/\$host\$request_uri/);
    expect(http80).toMatch(/\.well-known\/acme-challenge/);
  });
  it('terminates TLS with the certbot chain on 443 http2', () => {
    expect(host).toMatch(/listen 443 ssl http2;/);
    expect(host).toMatch(
      /ssl_certificate\s+\/etc\/letsencrypt\/live\/j15c204\.p\.ssafy\.io\/fullchain\.pem/,
    );
    expect(host).toMatch(/include \/etc\/letsencrypt\/options-ssl-nginx\.conf/);
  });
  it('gates the app behind GitLab SSO but leaves health, jenkins and oauth2 endpoints open', () => {
    const app = block(https(), 'location / {');
    expect(app).toMatch(/auth_request \/oauth2\/auth;/);
    expect(app).toMatch(/error_page 401 = @sso_signin;/);
    expect(block(host, 'location @sso_signin')).toMatch(/return 302 \/oauth2\/start\?rd=/);
    expect(block(host, 'location /health/ {')).not.toMatch(/auth_request/);
    expect(block(host, 'location /jenkins {')).not.toMatch(/auth_request/);
    expect(block(host, 'location /oauth2/ {')).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:4180/);
    const auth = block(host, 'location = /oauth2/auth {');
    expect(auth).toMatch(/internal;/);
    expect(auth).toMatch(/proxy_pass_request_body off;/);
  });
  it('blocks diagnostics at the edge and forwards the rest to the web-proxy container only', () => {
    expect(host).toMatch(/location \^~ \/monitor\s+\{ return 404; \}/);
    expect(host).toMatch(/location \^~ \/playground \{ return 404; \}/);
    const app = block(https(), 'location / {');
    expect(app).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:8080;/);
    expect(host).not.toMatch(/proxy_pass http:\/\/127\.0\.0\.1:2567/);
  });
  it('passes WebSocket upgrades with long idle timeouts', () => {
    const app = block(https(), 'location / {');
    expect(app).toMatch(/proxy_set_header Upgrade\s+\$http_upgrade;/);
    expect(app).toMatch(/proxy_set_header Connection \$connection_upgrade;/);
    expect(app).toMatch(/proxy_read_timeout\s+3600s;/);
    expect(host).toMatch(/map \$http_upgrade \$connection_upgrade/);
  });
  it('has no leftover isolation switch', () => {
    expect(host).not.toMatch(/kk_isolation|kk_operator|kk_block/);
  });
  it('replaces supplied SSO identity with the authenticated upstream identity only', () => {
    const app = block(https(), 'location / {');
    expect(app).toContain('auth_request_set $sso_user $upstream_http_x_auth_request_user;');
    expect(app).toContain('proxy_set_header X-SSO-User $sso_user;');
    expect(app).not.toContain('$http_x_sso_user');
    expect(read('scripts/write-smoke-proxy.mjs')).toContain('proxy_set_header X-SSO-User "";');
    expect(read('infra/compose.yaml')).toContain('127.0.0.1:8080:80');
    expect(read('infra/compose.continuous.yaml')).toContain('SESSION_ADMISSION_MODE: gitlab-sso');
  });
});

describe('container nginx (web-proxy)', () => {
  it('routes api, health, matchmake and room websockets to game-server', () => {
    for (const path of ['/api/', '/health/', '/matchmake/'])
      expect(edge).toContain(`location ${path} { proxy_pass http://game-server:2567; }`);
    const ws = block(edge, 'location ~ ^/[^/]+/[^/]+$ {');
    expect(ws).toMatch(/proxy_set_header Upgrade \$http_upgrade;/);
    expect(ws).toMatch(/proxy_read_timeout 3600s;/);
  });
  it('caches hashed assets and versioned wasm immutably, revalidates .task models', () => {
    expect(block(edge, 'location ^~ /assets/ {')).toMatch(/immutable/);
    expect(block(edge, 'location ^~ /models/mediapipe/ {')).toMatch(/immutable/);
    expect(block(edge, 'location ^~ /models/ {')).toMatch(/must-revalidate/);
  });
  it('forwards client address headers for trust proxy', () => {
    expect(edge).toMatch(/proxy_set_header X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
    expect(edge).toMatch(/proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;/);
  });
});

describe('SSO proxy compose', () => {
  it('pins the image, binds to localhost, restricts to project members with PKCE', () => {
    expect(sso).toMatch(/image: quay\.io\/oauth2-proxy\/oauth2-proxy:v7\.\d+\.\d+/);
    expect(sso).toContain("'127.0.0.1:4180:4180'");
    expect(sso).toContain('OAUTH2_PROXY_GITLAB_PROJECTS: s15-ai-image-sub1/S15P21C204=20');
    expect(sso).toContain('OAUTH2_PROXY_CODE_CHALLENGE_METHOD: S256');
    expect(sso).toContain('OAUTH2_PROXY_REDIRECT_URL: https://j15c204.p.ssafy.io/oauth2/callback');
    expect(sso).toMatch(/OAUTH2_PROXY_COOKIE_SECURE: 'true'/);
    expect(sso).toMatch(/env_file:\s+- \/opt\/kkakkung\/sso\.env/);
  });
  it('keeps client secret and cookie secret out of compose and empty in the template', () => {
    for (const name of [
      'OAUTH2_PROXY_CLIENT_SECRET',
      'OAUTH2_PROXY_COOKIE_SECRET',
      'OAUTH2_PROXY_CLIENT_ID',
    ]) {
      expect(sso).not.toMatch(new RegExp(`${name}:`));
      expect(ssoEnv).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
  });
});
