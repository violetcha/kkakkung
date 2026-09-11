import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run as root on the deployment host. Secret is read from a private file, never argv/stdout.
const [tokenFile, output] = process.argv.slice(2);
if (!tokenFile || !output)
  throw new Error('usage: node scripts/write-smoke-proxy.mjs <token-file> <output-conf>');
const token = readFileSync(resolve(tokenFile), 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('SMOKE_KEY_INVALID');
const config = `# Generated internal-only smoke listener. Do not commit this rendered file.
map $http_x_kkakkung_smoke_key $kkakkung_smoke_authorized {
  default 0;
  ~^${token}$ 1;
}
server {
  listen 127.0.0.1:18081;
  server_name localhost;
  access_log off;
  if ($kkakkung_smoke_authorized = 0) { return 403; }
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Kkakkung-Smoke-Key "";
    proxy_set_header Cookie "";
    proxy_set_header X-Forwarded-User "";
    proxy_set_header X-Auth-Request-User "";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_buffering off;
  }
}
`;
writeFileSync(resolve(output), config, { mode: 0o600 });
chmodSync(resolve(output), 0o600);
console.log('Internal smoke proxy configuration written (key omitted).');
