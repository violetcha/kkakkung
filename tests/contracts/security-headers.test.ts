// S15P21C204-303. 보안 헤더가 실제로 나가는지, 그리고 CSP 가 제품을 깨뜨리지 않는 값인지.
//
// 정책 값은 프로덕션 빌드를 브라우저로 돌려 정했다(scripts/check-security-headers.mjs). 여기서는
// 그 결론이 설정에서 사라지거나 조용히 약해지지 않게 고정한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const snippet = read('infra/nginx/security-headers.conf');
const edge = read('infra/nginx/default.conf');
const host = read('infra/nginx/host.conf');
const dockerfile = read('infra/docker/Dockerfile.web');
const SNIPPET_PATH = '/etc/nginx/snippets/kkakkung-security.conf';

/** `location … { … }` 블록을 중괄호 짝으로 잘라 낸다. */
function locations(conf: string): { head: string; body: string }[] {
  const found: { head: string; body: string }[] = [];
  const re = /location\s+[^{]*\{/g;
  for (let m = re.exec(conf); m; m = re.exec(conf)) {
    let depth = 0;
    for (let i = m.index; i < conf.length; i++) {
      if (conf[i] === '{') depth++;
      if (conf[i] === '}' && --depth === 0) {
        found.push({ head: m[0], body: conf.slice(m.index, i + 1) });
        break;
      }
    }
  }
  return found;
}

describe('security headers', () => {
  it('states a policy that the measured product actually runs under', () => {
    const csp = /add_header Content-Security-Policy "([^"]+)" always;/.exec(snippet)?.[1];
    expect(csp, 'CSP 가 없다').toBeDefined();
    const directives = new Map(
      csp!.split(';').map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name!, values.join(' ')];
      }),
    );
    // 측정으로 확인한 것들. 하나라도 빠지면 제품이 깨진다.
    expect(directives.get('script-src')).toBe("'self' 'wasm-unsafe-eval'");
    expect(directives.get('worker-src')).toBe("'self'");
    expect(directives.get('font-src')).toBe("'self'");
    expect(directives.get('img-src')).toContain('data:');
    expect(directives.get('connect-src')).toContain('wss://*.livekit.cloud');
    expect(directives.get('connect-src')).toContain('https://*.livekit.cloud');
    // 측정으로 필요 없다고 확인한 것들. 다시 들어오면 CSP 의 뜻이 거의 사라진다.
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
    // 문서를 남의 프레임에 넣지 못하게. 카메라 화면이라 특히 중요하다.
    expect(directives.get('frame-ancestors')).toBe("'none'");
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'self'");
    expect(directives.get('default-src')).toBe("'self'");
  });

  it('keeps the rest of the header set and lets this origin use the camera', () => {
    expect(snippet).toMatch(/add_header X-Content-Type-Options "nosniff" always;/);
    expect(snippet).toMatch(/add_header X-Frame-Options "DENY" always;/);
    expect(snippet).toMatch(/add_header Referrer-Policy "same-origin" always;/);
    const permissions = /add_header Permissions-Policy "([^"]+)" always;/.exec(snippet)?.[1];
    // 이 둘을 빼면 카메라·마이크가 막혀 게임이 아예 안 된다.
    expect(permissions).toContain('camera=(self)');
    expect(permissions).toContain('microphone=(self)');
    expect(permissions).toContain('geolocation=()');
  });

  it('ships the snippet in the image and includes it wherever nginx would drop it', () => {
    expect(dockerfile).toContain(`COPY infra/nginx/security-headers.conf ${SNIPPET_PATH}`);
    // server level 에 한 번. 첫 location 블록 앞까지가 그 범위다.
    const serverLevel = edge.split(/\n\s*location\s[^\n]*\{/)[0]!;
    expect(serverLevel).toContain(`include ${SNIPPET_PATH};`);
    // nginx 는 자기 add_header 가 있는 level 에서 바깥 add_header 를 전부 버린다. 그래서
    // Cache-Control 을 붙이는 location 은 스스로 다시 include 해야 한다. 새 location 이
    // add_header 만 들고 들어오면 여기서 걸린다.
    for (const { head, body } of locations(edge)) {
      if (!body.includes('add_header')) continue;
      expect(body, `${head.trim()} 가 보안 헤더를 잃는다`).toContain(`include ${SNIPPET_PATH};`);
    }
  });

  it('sets HSTS at the TLS edge only, and does not duplicate the rest there', () => {
    // 443 서버의 앱 경로. 80 번의 `location / { return 301 … }` 과 구분해야 한다.
    const app =
      locations(host).find((l) => /location \/ \{/.test(l.head) && l.body.includes('proxy_pass'))
        ?.body ?? '';
    expect(app).toMatch(
      /add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;/,
    );
    // preload 는 되돌리기 어려워 넣지 않기로 했다. 헤더 값만 본다(주석에는 이유가 적혀 있다).
    const hsts = /add_header Strict-Transport-Security "([^"]+)"/.exec(host)?.[1];
    expect(hsts).not.toContain('preload');
    // CSP 는 컨테이너가 붙이고 호스트가 흘려보낸다. 두 곳에서 붙이면 값이 갈린다.
    expect(host).not.toContain('Content-Security-Policy');
  });

  it('turns off the schema JIT before anything can parse, by import order', () => {
    // Zod 4 는 첫 parse 때 `new Function` 으로 파서를 만든다. ESM 은 import 를 본문보다 먼저
    // 평가하므로, 본문에서 끄면 늦는다. 실제로 그렇게 두었을 때 위반이 그대로 났다.
    const entry = read('apps/web/src/main.tsx');
    const firstImport = entry.match(/^import .*$/m)?.[0];
    expect(firstImport).toBe("import './app/schema-runtime';");
    expect(read('apps/web/src/app/schema-runtime.ts')).toContain('useJitlessSchemas()');
    expect(read('packages/protocol/src/schema-runtime.ts')).toContain('jitless: true');
    // 서버는 CSP 아래가 아니고 매 tick parse 하므로 JIT 를 그대로 둔다.
    expect(read('server/src/bootstrap.ts')).not.toContain('useJitlessSchemas');
  });
});
