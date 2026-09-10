// F-16 / DP-06 deployment smoke (Cloud case). Runs only through scripts/run-cloud-check.mjs with
// an approved preflight that allows DP-06, right after deploy-release.mjs has confirmed the
// isolation, the resume and READY/OPEN. It exercises the real invitation → six sessions → media
// grant path of the deployed origin through the SSO gate. What it cannot do from Node — the
// six browsers publishing faces and voices and playing a round — is recorded NOT_RUN, never PASS;
// that evidence belongs to QA-09/QA-11 with real devices. External participants stay blocked by
// the gate: the test also confirms an anonymous request is still redirected.
//
// Inputs (values never written to evidence): SMOKE_BASE_URL (https origin), SMOKE_COOKIE (the
// operator's SSO cookie), OPS_TOKEN (operator Bearer for the invitation route).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { caseTimeoutMs, requireCloudPreflight } from './CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preflight = requireCloudPreflight('DP-06', process.env, Date.now(), root);
if (preflight.maxRooms < 1 || preflight.maxParticipants < 6)
  throw new Error('DP06_PREFLIGHT_NEEDS_ONE_ROOM_SIX_PARTICIPANTS');
const baseUrl = process.env.SMOKE_BASE_URL ?? '';
if (!/^https:\/\/[a-z0-9.-]+$/.test(baseUrl)) throw new Error('DP06_SMOKE_BASE_URL_MISSING');
const cookie = process.env.SMOKE_COOKIE ?? '';
const opsToken = process.env.OPS_TOKEN ?? '';
if (!cookie || !opsToken) throw new Error('DP06_SMOKE_COOKIE_OR_OPS_TOKEN_MISSING');

type Item = { name: string; status: 'PASS' | 'FAIL' | 'NOT_RUN'; detail: string };
const items: Item[] = [];
const record = (name: string, status: Item['status'], detail = '') =>
  items.push({ name, status, detail });
const evidenceDir = resolve(root, preflight.evidenceDir);

async function http(
  path: string,
  init: RequestInit & { operator?: boolean; anonymous?: boolean } = {},
) {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (!init.anonymous) headers.cookie = cookie;
  if (init.operator) headers.authorization = `Bearer ${opsToken}`;
  if (init.body) headers['content-type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json, location: res.headers.get('location') };
  } finally {
    clearTimeout(timer);
  }
}

afterAll(() => {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    resolve(evidenceDir, 'deployment-smoke.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        case: 'DP-06',
        baseUrl,
        namespace: preflight.namespace,
        items,
        note: 'HTTP-level six-participant smoke through the SSO gate. Browser media/gameplay NOT_RUN here (QA-09/QA-11). No cookie, token or grant values recorded.',
      },
      null,
      2,
    ) + '\n',
  );
});

it(
  'DP-06: the deployed origin admits six invited sessions and issues media grants while anonymous access stays blocked',
  async () => {
    // Isolation is still on: no cookie → SSO redirect, not the app.
    const anonymous = await http('/api/config', { anonymous: true });
    record(
      'anonymous blocked',
      [301, 302, 401, 403].includes(anonymous.status) ? 'PASS' : 'FAIL',
      `status ${anonymous.status}`,
    );
    expect([301, 302, 401, 403]).toContain(anonymous.status);

    // READY and OPEN are read separately; ready 200 alone is not admission.
    const ready = await http('/health/ready', { anonymous: true });
    const readyBody = (ready.json ?? {}) as { readiness?: string; admission?: string };
    record(
      'ready',
      ready.status === 200 ? 'PASS' : 'FAIL',
      `status ${ready.status} readiness=${readyBody.readiness} admission=${readyBody.admission}`,
    );
    expect(ready.status).toBe(200);
    expect(readyBody.admission).toBe('OPEN');

    // One invitation from the operator route, six sessions in one room.
    const issued = await http('/api/operations/invitations', {
      method: 'POST',
      operator: true,
      body: JSON.stringify({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: Date.now() + 15 * 60_000,
      }),
    });
    record('invitation', issued.status === 201 ? 'PASS' : 'FAIL', `status ${issued.status}`);
    expect(issued.status).toBe(201);
    const { inviteToken } = issued.json as { inviteToken: string };
    const sessions: { sessionToken: string; playerId: string; roomCode: string }[] = [];
    const host = await http('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ nickname: 'DP06-1', inviteToken, createRoom: true }),
    });
    expect(host.status).toBe(201);
    sessions.push(host.json as (typeof sessions)[number]);
    for (let i = 2; i <= 6; i++) {
      const res = await http('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          nickname: `DP06-${i}`,
          inviteToken,
          createRoom: false,
          roomCode: sessions[0]!.roomCode,
        }),
      });
      expect(res.status).toBe(201);
      sessions.push(res.json as (typeof sessions)[number]);
    }
    record(
      'six sessions',
      'PASS',
      `room ${sessions[0]!.roomCode.length} chars, ${sessions.length} sessions`,
    );

    // Media grants for every participant: the real grant route, no Cloud room joined from here.
    let grants = 0;
    for (const session of sessions) {
      const grant = await http('/api/media/grants', {
        method: 'POST',
        headers: { authorization: `Bearer ${session.sessionToken}` },
        body: JSON.stringify({ purpose: 'practice' }),
      });
      if (grant.status === 200 || grant.status === 201) grants++;
      else record(`grant ${session.playerId.slice(0, 8)}`, 'FAIL', `status ${grant.status}`);
    }
    record('media grants', grants === 6 ? 'PASS' : 'FAIL', `${grants}/6 issued`);
    expect(grants).toBe(6);

    record(
      'browser media publish (6 faces/voices)',
      'NOT_RUN',
      'needs six browsers with cameras; QA-09/QA-11',
    );
    record('gameplay round to result', 'NOT_RUN', 'needs the browsers above; QA-09');
  },
  caseTimeoutMs(preflight),
);
