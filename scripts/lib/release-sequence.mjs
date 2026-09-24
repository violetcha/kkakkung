// Owned by F (F-16 / DP-06). The release barrier as a pure sequence over injected adapters:
// manifest and image checks → external isolation evidence → drain (terminal succeeded, no
// unresolved retirements) → image swap → ready/recovery → resume (terminal succeeded and
// admission OPEN checked separately) → smoke → publication re-check → last-good record.
// Any failure after the swap goes through the same barrier again on the previous release, and a
// failure that cannot be recovered is left as ROLLBACK_BLOCKED rather than forced.
//
// No process, network or Docker access lives here; scripts/deploy-release.mjs supplies adapters.
// The sequence never sees the operator token: adapters add it when `bearer` is requested.

export const RELEASE_PHASES = Object.freeze([
  'BLOCKED',
  'DRAINING',
  'DEPLOYING',
  'RECOVERING',
  'SMOKE',
  'READY',
  'ROLLBACK_BLOCKED',
]);

export const RELEASE_RESULTS = Object.freeze([
  'READY',
  'DEPLOYED_WITHOUT_OPERATIONS',
  'ROLLED_BACK',
  'FAILED',
  'BLOCKED',
  'PUBLISH_BLOCKED',
  'ROLLBACK_BLOCKED',
]);

export const DEFAULT_DEADLINES = Object.freeze({
  // S15P21C204-291. Drain ends only when matches, practices and pending admissions are all zero,
  // and a match runs 180 s. At 120 s a deploy that met a single match timed out, failed and went
  // down the rollback path, which closes admission again while it repeats drain/swap/ready/resume.
  // Waiting is cheap: with no match running drain finishes at once, so ordinary deploys are
  // unchanged. A rematch cannot stretch this indefinitely — startCountdown requires admission
  // OPEN, so no new round begins once draining started (server/src/rooms/KkakkungRoom.ts).
  drainMs: 300_000,
  readyMs: 120_000,
  recoverMs: 180_000,
  resumeMs: 60_000,
});

/**
 * S15P21C204-296. 공개 주소에서 운영 API 가 막혔는지 두드려 볼 대표 경로.
 * 정상 철자 하나, 대문자 변형 하나, 슬래시 없는 bare 접두 하나. 셋 다 404 여야 한다.
 */
export const OPERATIONS_EDGE_PROBES = Object.freeze([
  '/api/operations/status',
  '/API/OPERATIONS/status',
  '/api/operations',
]);

const SHA40 = /^[0-9a-f]{40}$/;
const TAG8 = /^[0-9a-f]{8}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_KEYS = Object.freeze(['game', 'web']);

/** Structural and cross-field checks of a release manifest. Returns every issue, not the first. */
export function validateManifest(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object'];
  const m = manifest;
  if (!SHA40.test(m.releaseSha ?? '')) issues.push('releaseSha must be a 40-hex commit');
  if (!TAG8.test(m.tag ?? '')) issues.push('tag must be the 8-hex prefix of releaseSha');
  else if (SHA40.test(m.releaseSha ?? '') && !m.releaseSha.startsWith(m.tag))
    issues.push('tag is not a prefix of releaseSha');
  if (m.verifiedSha !== m.releaseSha)
    issues.push('verifiedSha differs from releaseSha (deploy only the commit Jenkins verified)');
  if (m.profile !== 'product' && m.profile !== 'skeleton')
    issues.push("profile must be 'product' or 'skeleton'");
  if (m.operatingMode !== undefined && !['attested', 'continuous'].includes(m.operatingMode))
    issues.push('operatingMode invalid');
  if (m.operatingMode === 'continuous' && m.profile !== 'product')
    issues.push('continuous mode requires product profile');
  for (const key of IMAGE_KEYS) {
    const image = m.images?.[key];
    if (!image) {
      issues.push(`images.${key} missing (both web and server images are required)`);
      continue;
    }
    if (typeof image.ref !== 'string' || !image.ref.includes(':'))
      issues.push(`images.${key}.ref must be name:tag`);
    if (!DIGEST.test(image.digest ?? ''))
      issues.push(`images.${key}.digest must be sha256:<64hex>`);
    if (image.revision !== m.releaseSha)
      issues.push(`images.${key}.revision label differs from releaseSha`);
  }
  if (m.previous !== null && m.previous !== undefined) {
    const p = m.previous;
    if (p.operatingMode !== undefined && !['attested', 'continuous'].includes(p.operatingMode))
      issues.push('previous.operatingMode invalid');
    if (
      p.officialBudgetMaxAgeMs !== undefined &&
      (!Number.isSafeInteger(p.officialBudgetMaxAgeMs) || p.officialBudgetMaxAgeMs <= 0)
    )
      issues.push('previous.officialBudgetMaxAgeMs invalid');
    if (p.profile !== undefined && !['skeleton', 'product'].includes(p.profile))
      issues.push('previous.profile invalid');
    if (!TAG8.test(p.tag ?? '')) issues.push('previous.tag must be 8-hex');
    for (const key of IMAGE_KEYS) {
      if (!DIGEST.test(p.images?.[key]?.digest ?? ''))
        issues.push(`previous.images.${key}.digest must be sha256:<64hex>`);
    }
  }
  if (m.officialBudgetMaxAgeMs !== undefined && m.officialBudgetMaxAgeMs !== null) {
    if (!Number.isSafeInteger(m.officialBudgetMaxAgeMs) || m.officialBudgetMaxAgeMs <= 0)
      issues.push('officialBudgetMaxAgeMs must be a positive integer when present');
  } else if (m.profile === 'product' && m.operatingMode !== 'continuous')
    issues.push('product requires officialBudgetMaxAgeMs');
  return issues;
}

class ReleaseStop extends Error {
  constructor(result, reason, detail) {
    super(`${result}: ${reason}${detail ? ` (${detail})` : ''}`);
    this.result = result;
    this.reason = reason;
    this.detail = detail ?? null;
  }
}

const isolatedStatus = (status) =>
  status === 301 || status === 302 || status === 401 || status === 403;

/**
 * Runs the whole barrier. Resolves (never throws) with
 * `{ phase, result, reason, detail, steps, exitCode, lastGoodWritten }`.
 */
export async function runRelease(input, adapters) {
  const manifest = input.manifest;
  const deadlines = { ...DEFAULT_DEADLINES, ...(input.deadlines ?? {}) };
  const steps = [];
  const state = { phase: 'BLOCKED', lastGoodWritten: false };
  const log = adapters.log ?? (() => undefined);
  const record = (name, status, detail) => {
    const entry = { at: adapters.now(), phase: state.phase, name, status, detail: detail ?? null };
    steps.push(entry);
    log(`${status.padEnd(8)} ${name}${detail ? ` — ${detail}` : ''}`);
    adapters.onStep?.({ ...state, steps });
  };
  const setPhase = (phase) => {
    state.phase = phase;
    adapters.onStep?.({ ...state, steps });
  };
  const finish = (result, reason = null, detail = null) => {
    const exitCode =
      result === 'READY' || result === 'DEPLOYED_WITHOUT_OPERATIONS'
        ? 0
        : result === 'BLOCKED'
          ? 3
          : 1;
    return {
      phase: state.phase,
      result,
      reason,
      detail,
      steps,
      exitCode,
      lastGoodWritten: state.lastGoodWritten,
    };
  };
  const ok = (name, detail) => record(name, 'PASS', detail);
  const fail = (result, reason, detail) => {
    record(reason, 'FAIL', detail);
    throw new ReleaseStop(result, reason, detail);
  };

  const http = async (method, url, options = {}) => {
    try {
      return await adapters.http(method, url, options);
    } catch (error) {
      return {
        status: 0,
        json: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const pollSnapshot = async (requestId, deadlineMs, label) => {
    const started = adapters.now();
    let wait = 1000;
    for (;;) {
      const res = await http('GET', `${input.localUrl}/api/operations/commands/${requestId}`, {
        bearer: true,
      });
      if (res.status === 200 && res.json) {
        if (res.json.requestId !== requestId)
          fail('FAILED', `${label}_SNAPSHOT_MISMATCH`, 'snapshot requestId differs');
        if (res.json.status === 'succeeded') return res.json;
        if (res.json.status === 'failed')
          fail('FAILED', `${label}_FAILED`, `code=${res.json.code ?? '-'}`);
      } else if (res.status !== 0 && res.status !== 404) {
        fail('FAILED', `${label}_SNAPSHOT_HTTP_${res.status}`);
      }
      if (adapters.now() - started >= deadlineMs)
        fail('FAILED', `${label}_TIMEOUT`, `no terminal snapshot within ${deadlineMs}ms`);
      await adapters.sleep(wait);
      wait = Math.min(wait * 2, 10_000);
    }
  };

  const operationsStatus = async () => {
    const res = await http('GET', `${input.localUrl}/api/operations/status`, { bearer: true });
    if (res.status !== 200 || !res.json) fail('FAILED', `STATUS_HTTP_${res.status}`);
    return res.json;
  };

  /** One operator command by a fixed requestId; polled by that same id only. */
  const command = async (action, requestId, deadlineMs, label) => {
    const res = await http('POST', `${input.localUrl}/api/operations/commands`, {
      bearer: true,
      body: { requestId, action },
    });
    if (res.status === 409)
      fail('FAILED', `${label}_CONFLICT`, 'another operation holds the queue');
    if (res.status !== 202) fail('FAILED', `${label}_REJECTED`, `http ${res.status}`);
    const snapshot = await pollSnapshot(requestId, deadlineMs, label);
    ok(`${label} terminal`, `operationId=${snapshot.operationId}`);
    return snapshot;
  };

  const drain = async (label, tagForId) => {
    setPhase('DRAINING');
    const requestId = `deploy-${tagForId}-${label.toLowerCase()}-${adapters.now()}`;
    await command('drain', requestId, deadlines.drainMs, label);
    const status = await operationsStatus();
    if (!['DRAINING', 'LOCKED'].includes(status.admission))
      fail('FAILED', `${label}_STATE_MISMATCH`, `admission=${status.admission}`);
    if (status.unresolvedCount !== 0)
      fail('FAILED', `${label}_UNRESOLVED`, `unresolvedCount=${status.unresolvedCount}`);
    ok(`${label} state`, `admission=${status.admission} unresolved=0`);
    return requestId;
  };

  /**
   * S15P21C204-381. A drain that the server accepted but that then failed leaves the old server
   * closed to new rooms while nothing replaces it. Ask it to resume once. This is best effort: a
   * drain still queued answers 409 and an unresolved retirement blocks resume on the server, and
   * either way the release still ends with the drain failure.
   */
  const reopenAfterFailedDrain = async (error, tagForId) => {
    if (!(error instanceof ReleaseStop)) return;
    if (['DRAIN_CONFLICT', 'DRAIN_REJECTED'].includes(error.reason)) return;
    try {
      const requestId = `deploy-${tagForId}-drain-abort-resume-${adapters.now()}`;
      await command('resume', requestId, deadlines.resumeMs, 'DRAIN_ABORT_RESUME');
      const after = await operationsStatus();
      ok('DRAIN_ABORT_RESUME state', `admission=${after.admission}`);
    } catch (resumeError) {
      if (!(resumeError instanceof ReleaseStop)) throw resumeError;
    }
  };

  const waitReady = async (label) => {
    const started = adapters.now();
    let sawRecovering = false;
    for (;;) {
      const res = await http('GET', `${input.localUrl}/health/ready`);
      if (res.status === 200) {
        ok(`${label} ready`, sawRecovering ? 'after RECOVERING' : 'http 200');
        return res.json ?? {};
      }
      if (
        res.status === 503 &&
        (res.json?.state === 'RECOVERING' || res.json?.status === 'recovering') &&
        !sawRecovering
      ) {
        sawRecovering = true;
        setPhase('RECOVERING');
        record(`${label} recovering`, 'INFO', 'ready 503 RECOVERING');
      }
      const limit = sawRecovering ? deadlines.recoverMs : deadlines.readyMs;
      if (adapters.now() - started >= limit)
        fail('FAILED', `${label}_READY_TIMEOUT`, `last http ${res.status}`);
      await adapters.sleep(3000);
    }
  };

  const checkRunningImages = async (label, images) => {
    for (const key of IMAGE_KEYS) {
      const running = await adapters.runningImage(key);
      if (running !== images[key].digest)
        fail('FAILED', `${label}_SWAP_MISMATCH`, `${key} running=${running ?? 'none'}`);
    }
    ok(`${label} running images`, 'both digests match the manifest');
  };

  const smoke = async (mode) => {
    setPhase('SMOKE');
    const result = await adapters.runSmoke(mode);
    if (result.code !== 0) fail('FAILED', 'SMOKE_FAILED', `${mode} smoke exit ${result.code}`);
    ok('smoke', `${mode} smoke passed`);
  };

  /**
   * S15P21C204-343. 전진 배포는 DP-06(cloud)으로 확인하고, 롤백은 HTTP 스모크로 확인한다.
   *
   * DP-06 은 이 작업 공간의 웹 클라이언트 소스를 실행하는데, 롤백이 되돌리는 것은 **이전** 서버
   * 이미지다. 프로토콜이 바뀐 배포를 되돌리면 새 클라이언트가 옛 서버의 판을 읽지 못해 롤백이
   * 무조건 실패한다(#203: 326 이 `knowledgeRevision` 을 필수로 만들었고 5d6e5734 서버는 그것을
   * 보내지 않는다). 그 판정은 아무도 쓰지 않을 조합을 본 것이다 — 실사용자는 web 이미지도 함께
   * 되돌아가 짝이 맞는다.
   *
   * 롤백의 질문은 "사이트가 돌아왔는가"이지 "새 클라이언트가 옛 서버와 되는가"가 아니다. HTTP
   * 스모크(리다이렉트·TLS·live/ready·Origin 허용거부·WSS 입장·정적 MIME)는 버전에 묶이지 않는다.
   * 뒤따르는 publicationChecks(readiness·admission·unresolved·예산)도 그대로 돌아, 되돌린 서버가
   * 실제로 열려 있는지는 여전히 증명된다.
   */
  const smokeModeFor = (label, useOperations) =>
    useOperations && label !== 'ROLLBACK' ? 'cloud' : 'http';

  const publicationChecks = async (operatingMode, budgetMaxAgeMs) => {
    const status = await operationsStatus();
    const problems = [];
    if (status.readiness !== 'READY') problems.push(`readiness=${status.readiness}`);
    if (status.admission !== 'OPEN') problems.push(`admission=${status.admission}`);
    if (status.unresolvedCount !== 0) problems.push(`unresolvedCount=${status.unresolvedCount}`);
    const maxAge = budgetMaxAgeMs ?? null;
    const now = input.nowEpochMs();
    if (operatingMode === 'continuous') {
      if (status.operatingMode !== 'continuous') problems.push('continuous policy not active');
      if (
        status.remainingMinutes !== null ||
        status.remainingBytes !== null ||
        status.checkedAtEpochMs !== null
      )
        problems.push('provider quota must not claim an official balance');
    } else if (status.operatingMode === 'continuous') problems.push('unexpected operating policy');
    else if (maxAge === null) problems.push('officialBudgetMaxAgeMs not provided');
    else if (status.checkedAtEpochMs === null) problems.push('official budget never checked');
    else if (
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(status.checkedAtEpochMs) ||
      status.checkedAtEpochMs < 0 ||
      status.checkedAtEpochMs > now
    )
      problems.push('official budget check timestamp invalid');
    else if (now - status.checkedAtEpochMs > maxAge)
      problems.push(`official budget check older than ${maxAge}ms`);
    if (problems.length) fail('PUBLISH_BLOCKED', 'PUBLICATION_CONDITIONS', problems.join(', '));
    ok(
      'publication re-check',
      operatingMode === 'continuous'
        ? 'READY/OPEN, unresolved 0, provider quota policy active'
        : 'READY/OPEN, unresolved 0, official budget fresh',
    );
  };

  /** Post-swap barrier shared by the release and by a rollback. */
  const barrier = async (
    label,
    tag,
    images,
    useOperations,
    operatingMode = 'attested',
    budgetMaxAgeMs = manifest.officialBudgetMaxAgeMs,
  ) => {
    setPhase('DEPLOYING');
    const composed = await adapters.compose(
      tag,
      useOperations ? 'product' : 'skeleton',
      images,
      operatingMode,
    );
    if (composed.code !== 0) fail('FAILED', `${label}_COMPOSE_FAILED`, `exit ${composed.code}`);
    ok(`${label} compose up`, `tag=${tag}`);
    const ready = await waitReady(label);
    await checkRunningImages(label, images);
    if (useOperations) {
      // Health and admission are separate signals: READY may still be DRAINING here.
      const started = adapters.now();
      for (;;) {
        const status = await operationsStatus();
        if (status.readiness === 'READY') {
          ok(`${label} readiness`, `READY, admission=${status.admission}`);
          break;
        }
        if (status.readiness === 'LOCKED')
          fail('FAILED', `${label}_READINESS_LOCKED`, 'recovery locked');
        if (adapters.now() - started >= deadlines.recoverMs)
          fail('FAILED', `${label}_RECOVERY_TIMEOUT`, `readiness=${status.readiness}`);
        await adapters.sleep(3000);
      }
      const resumeId = `deploy-${tag}-${label.toLowerCase()}-resume-${adapters.now()}`;
      await command('resume', resumeId, deadlines.resumeMs, `${label}_RESUME`);
      const after = await operationsStatus();
      if (after.admission !== 'OPEN' || after.readiness !== 'READY')
        fail(
          'FAILED',
          `${label}_RESUME_MISMATCH`,
          `admission=${after.admission} readiness=${after.readiness}`,
        );
      ok(`${label} resume state`, 'admission=OPEN readiness=READY');
    } else if (ready.mediaEnabled) {
      fail(
        'FAILED',
        `${label}_OPERATIONS_EXPECTED`,
        'server reports media enabled without operations',
      );
    }
    await smoke(smokeModeFor(label, useOperations));
    if (useOperations) await publicationChecks(operatingMode, budgetMaxAgeMs);
  };

  const rollback = async (cause, useOperations) => {
    record('rollback start', 'INFO', cause);
    const previous = manifest.previous ?? null;
    try {
      if (useOperations) await drain('ROLLBACK_DRAIN', manifest.tag);
      if (!previous) fail('ROLLBACK_BLOCKED', 'NO_PREVIOUS_RELEASE');
      for (const key of IMAGE_KEYS) {
        const ref = previous.images[key].digest;
        const image = await adapters.inspectImage(ref);
        if (!image) fail('ROLLBACK_BLOCKED', 'PREVIOUS_IMAGE_MISSING', ref);
        if (image.id !== previous.images[key].digest)
          fail('ROLLBACK_BLOCKED', 'PREVIOUS_DIGEST_MISMATCH', `${ref} is not the recorded image`);
      }
      ok('previous images', `tag=${previous.tag} digests match last-good record`);
      const images = Object.fromEntries(
        IMAGE_KEYS.map((key) => [key, { digest: previous.images[key].digest }]),
      );
      const previousUsesOperations = previous.profile
        ? previous.profile === 'product'
        : useOperations;
      await barrier(
        'ROLLBACK',
        previous.tag,
        images,
        previousUsesOperations,
        previous.operatingMode ?? 'attested',
        previous.officialBudgetMaxAgeMs ?? manifest.officialBudgetMaxAgeMs,
      );
      setPhase('READY');
      return finish('ROLLED_BACK', cause, `previous ${previous.tag} passed the barrier again`);
    } catch (error) {
      if (!(error instanceof ReleaseStop)) throw error;
      setPhase('ROLLBACK_BLOCKED');
      return finish('ROLLBACK_BLOCKED', error.reason, `${error.detail ?? ''}; original: ${cause}`);
    }
  };

  let useOperations = false;
  try {
    // 1. Manifest and images.
    const issues = validateManifest(manifest);
    if (issues.length) fail('BLOCKED', 'MANIFEST_INVALID', issues.join('; '));
    ok('manifest', `release ${manifest.tag} verified=${manifest.verifiedSha.slice(0, 8)}`);
    for (const key of IMAGE_KEYS) {
      const image = await adapters.inspectImage(manifest.images[key].ref);
      if (!image) fail('BLOCKED', 'IMAGE_MISSING', manifest.images[key].ref);
      if (image.id !== manifest.images[key].digest)
        fail('BLOCKED', 'IMAGE_DIGEST_MISMATCH', manifest.images[key].ref);
      if (image.revision !== manifest.releaseSha)
        fail('BLOCKED', 'IMAGE_LABEL_MISMATCH', `${manifest.images[key].ref} revision label`);
    }
    ok('images', 'web and server images exist with the release revision label');
    if (manifest.profile === 'product') {
      if (!input.opsTokenPresent) fail('BLOCKED', 'OPS_TOKEN_MISSING');
      if (!input.smokePreflightPresent)
        fail('BLOCKED', 'SMOKE_PREFLIGHT_MISSING', 'DP-06 preflight');
    }

    // 2. Entry evidence and operator route authentication. What the public URL must answer
    //    depends on the audience (S15P21C204-290); the check is never skipped, only swapped.
    //    team:   /api/config is refused by the SSO gate, so only members reach the app.
    //    public: /api/config answers, and the edge itself refuses the operations API. A public
    //            audience whose gate still refuses means the ingress was not switched with it.
    const audience = input.audience ?? 'team';
    const gate = await http('GET', `${input.baseUrl}/api/config`);
    if (audience === 'public') {
      if (gate.status !== 200)
        fail(
          'BLOCKED',
          'AUDIENCE_MISMATCH',
          `public audience but /api/config answered ${gate.status}`,
        );
    } else if (!isolatedStatus(gate.status))
      fail('BLOCKED', 'ISOLATION_UNVERIFIED', `public /api/config answered ${gate.status}`);
    // 296. 대상과 무관하게 운영 API 는 공개 주소에서 404 여야 한다. 한 철자만 막힌 ingress 를
    // 잡으려고 대표 변형을 함께 두드린다: nginx 의 접두·정확 일치는 대소문자를 가리지만
    // Express 는 가리지 않아 `/API/OPERATIONS/status` 가 라우트까지 들어갔다. 슬래시 없는
    // bare 접두도 옛 `^~ /api/operations/` 를 지나쳤다. SSO 리다이렉트(팀)나 403 도 통과로
    // 읽지 않는다: 막았다면 앱에 닿기 전에 404 다.
    for (const path of OPERATIONS_EDGE_PROBES) {
      const exposed = await http('GET', `${input.baseUrl}${path}`);
      if (exposed.status !== 404)
        fail(
          'BLOCKED',
          'OPERATIONS_PUBLICLY_REACHABLE',
          `public ${path} answered ${exposed.status}`,
        );
    }
    const live = await http('GET', `${input.baseUrl}/health/live`);
    if (live.status !== 200)
      fail('BLOCKED', 'ISOLATION_UNVERIFIED', `public /health/live ${live.status}`);
    const anonymous = await http('GET', `${input.localUrl}/api/operations/status`);
    if (anonymous.status === 200) fail('BLOCKED', 'OPERATIONS_UNAUTHENTICATED');
    ok(
      'isolation',
      `audience ${audience}, gate ${gate.status}, live 200, anonymous operations ${anonymous.status}`,
    );

    // 3. Operations availability decides the barrier depth.
    const status = await http('GET', `${input.localUrl}/api/operations/status`, { bearer: true });
    if (
      manifest.profile === 'skeleton' &&
      (status.status === 200 || manifest.previous?.profile === 'product')
    )
      fail(
        'BLOCKED',
        'PRODUCT_PROFILE_REQUIRED',
        'existing product requires an explicit product release and Cloud preflight',
      );
    if (status.status === 200) useOperations = true;
    else if (status.status === 401 || status.status === 403) fail('BLOCKED', 'OPS_TOKEN_REJECTED');
    else if (manifest.profile === 'product') {
      // First product deployment: only a positively identified, media-free skeleton may
      // have no operations API. A failed/unreachable product API is never a migration signal.
      const oldReady = await http('GET', `${input.localUrl}/health/ready`);
      const body = oldReady.json;
      if (
        status.status !== 404 ||
        anonymous.status !== 404 ||
        manifest.previous?.profile !== 'skeleton' ||
        oldReady.status !== 200 ||
        body?.stage !== 'skeleton' ||
        body?.mvpReady !== false ||
        body?.mediaEnabled !== false ||
        body?.productSecurityReady !== false
      )
        fail('BLOCKED', 'OPERATIONS_UNAVAILABLE', `status route ${status.status}`);
      await checkRunningImages('MIGRATION_SOURCE', manifest.previous.images);
      ok(
        'skeleton migration',
        'verified previous skeleton; new product must pass the full barrier',
      );
    }
    ok(
      'operations',
      useOperations
        ? 'available, full barrier'
        : `unavailable (${status.status}); skeleton barrier`,
    );

    // 4. Ordinary releases always drain. A never-admitted failed first start may reuse its
    // predecessor's proven drain only through the explicit host/state recovery guard.
    if (input.recoverFailedStartup) {
      if (
        !useOperations ||
        manifest.profile !== 'product' ||
        manifest.operatingMode !== 'continuous' ||
        !adapters.recoverFailedStartup
      )
        fail('BLOCKED', 'STARTUP_RECOVERY_UNAVAILABLE');
      const recovered = await adapters.recoverFailedStartup();
      if (recovered.code !== 0) fail('BLOCKED', 'STARTUP_RECOVERY_UNCONFIRMED');
      ok(
        'failed startup recovery',
        'prior drain, no new grants, normal stop, writer released, state archived',
      );
    } else if (useOperations) {
      try {
        await drain('DRAIN', manifest.tag);
      } catch (error) {
        await reopenAfterFailedDrain(error, manifest.tag);
        throw error;
      }
    } else
      record(
        'drain',
        'NOT_RUN',
        'operations unavailable; nothing to drain in the skeleton profile',
      );

    // 5–8. Swap, ready/recovery, resume, smoke, publication re-check.
    try {
      await barrier(
        'RELEASE',
        manifest.tag,
        manifest.images,
        manifest.profile === 'product' || useOperations,
        manifest.operatingMode ?? 'attested',
      );
    } catch (error) {
      if (!(error instanceof ReleaseStop)) throw error;
      if (error.result === 'PUBLISH_BLOCKED') {
        // The new release is healthy; only publication is refused. Isolation stays, no rollback.
        return finish('PUBLISH_BLOCKED', error.reason, error.detail);
      }
      return await rollback(
        `${error.reason}${error.detail ? ` (${error.detail})` : ''}`,
        manifest.profile === 'product' || useOperations,
      );
    }
    await adapters.writeState('last-good-tag', `${manifest.tag}\n`);
    await adapters.writeState('last-good-profile', `${manifest.profile}\n`);
    await adapters.writeState(
      'last-good-digest',
      `game ${manifest.images.game.digest}\nweb  ${manifest.images.web.digest}\n`,
    );
    state.lastGoodWritten = true;
    ok('last-good', `tag and digests recorded for ${manifest.tag}`);
    if (manifest.profile === 'product' || useOperations) {
      setPhase('READY');
      record(
        'isolation',
        'INFO',
        audience === 'public'
          ? 'public audience: SSO gate removed at the edge, operations API refused publicly'
          : 'SSO gate retained (DP-03 decision); no public release step',
      );
      return finish('READY');
    }
    return finish(
      'DEPLOYED_WITHOUT_OPERATIONS',
      'OPERATIONS_UNAVAILABLE',
      'skeleton profile: no drain/resume/publication evidence; not DP-06 completion',
    );
  } catch (error) {
    if (!(error instanceof ReleaseStop)) throw error;
    if (error.result === 'BLOCKED') setPhase('BLOCKED');
    return finish(error.result, error.reason, error.detail);
  }
}
