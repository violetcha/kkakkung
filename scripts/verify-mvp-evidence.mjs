#!/usr/bin/env node
// Owned by F (F-19 / QA-13). Turns the gate manifest into the MVP gate report: every gate carries
// its status, source commit, environment, evidence references, measured limits and defects; a
// PASS whose evidence file is missing, empty or from another commit becomes UNVERIFIED; BLOCKED,
// NOT_RUN and PRODUCT_DECISION_PENDING are never added to PASS; publication conditions
// (isolation, unresolved retirements, official budget, smoke cleanup) are judged apart from the
// gates. The report section is written into docs/verification.md between fixed markers.
//
//   node scripts/verify-mvp-evidence.mjs --gates .local/qa/mvp-gates.json --input .local/qa --report docs/verification.md
//
// Exit 0 when every required gate PASSes and publication conditions hold, 1 otherwise, 3 when the
// manifest is missing. The report is written in both cases so the honest state is always visible.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const GATE_STATUSES = Object.freeze([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_RUN',
  'PRODUCT_DECISION_PENDING',
]);
export const REQUIRED_GATES = Object.freeze([
  'G1-A',
  'G1-B',
  'G1-C',
  'G1-D',
  'G2',
  'G3-A',
  'G3-B',
  'G3-D',
  'G4',
  'G5',
  'G6',
]);
export const PENDING_GATES = Object.freeze(['G3-C']);
const MARK_START = '<!-- mvp-gate-report:start -->';
const MARK_END = '<!-- mvp-gate-report:end -->';

/**
 * Pure evaluation. `exists(ref)` says whether an evidence reference resolves to a non-empty file
 * or directory; `headCommit` is the checkout being reported (40 hex) or null when unknown.
 */
export function evaluateGates(manifest, exists, headCommit) {
  const gates = Array.isArray(manifest.gates) ? manifest.gates : [];
  const results = gates.map((g) => {
    const problems = [];
    if (!GATE_STATUSES.includes(g.status)) problems.push(`unknown status ${g.status}`);
    const refs = Array.isArray(g.evidenceRefs) ? g.evidenceRefs : [];
    const missing = refs.filter((ref) => !exists(ref));
    if (g.status === 'PASS' || g.status === 'FAIL') {
      if (refs.length === 0) problems.push('no evidence reference');
      if (missing.length) problems.push(`evidence missing: ${missing.join(', ')}`);
      if (!/^[0-9a-f]{40}$/.test(g.sourceCommit ?? '')) problems.push('sourceCommit missing');
      else if (headCommit && g.sourceCommit !== headCommit && !g.sourceCommitIsFeatureBranch)
        problems.push(
          `sourceCommit ${g.sourceCommit.slice(0, 7)} differs from the reported checkout ${headCommit.slice(0, 7)}`,
        );
      if (!g.environmentRef) problems.push('environmentRef missing');
    }
    const status =
      problems.length && (g.status === 'PASS' || g.status === 'FAIL') ? 'UNVERIFIED' : g.status;
    return {
      gate: g.gate,
      status,
      declared: g.status,
      sourceCommit: g.sourceCommit ?? null,
      environmentRef: g.environmentRef ?? null,
      evidenceRefs: refs,
      measuredLimits: g.measuredLimits ?? {},
      defects: g.defects ?? [],
      problems,
    };
  });
  const byGate = new Map(results.map((r) => [r.gate, r]));
  const count = (s) =>
    results.filter((r) => REQUIRED_GATES.includes(r.gate) && r.status === s).length;
  const requiredMissing = REQUIRED_GATES.filter((g) => !byGate.has(g));
  const mvpComplete =
    requiredMissing.length === 0 && REQUIRED_GATES.every((g) => byGate.get(g).status === 'PASS');
  const pending = results.filter(
    (r) => r.status === 'PRODUCT_DECISION_PENDING' || PENDING_GATES.includes(r.gate),
  );

  // Publication (public window reopening) is a separate decision from the gates.
  const pub = manifest.publication ?? {};
  const publicationProblems = [];
  if (pub.isolationVerified !== true) publicationProblems.push('external isolation not verified');
  if (pub.unresolvedRetirements !== 0)
    publicationProblems.push(`unresolved retirements: ${pub.unresolvedRetirements ?? 'unknown'}`);
  if (pub.officialBudgetCheckedAt == null)
    publicationProblems.push('official budget not confirmed');
  if (pub.smokeCleanupConfirmed !== true)
    publicationProblems.push('smoke session/media cleanup not confirmed');
  if (pub.resumeOpenConfirmed !== true) publicationProblems.push('resume → OPEN not confirmed');
  if (pub.publicWindowOpen !== true) publicationProblems.push('public window not open');

  // Verified capacity: the largest room count that passed, game-only and with media, separately.
  const capacity = manifest.capacity ?? { gameOnlyRooms: 0, withMediaRooms: 0 };
  return {
    gates: results,
    summary: {
      required: REQUIRED_GATES.length,
      pass: count('PASS'),
      fail: count('FAIL'),
      blocked: count('BLOCKED'),
      notRun: count('NOT_RUN'),
      unverified: count('UNVERIFIED'),
      requiredMissing,
      pending: pending.map((p) => p.gate),
      mvpComplete,
      /** Feature state and verified limit are reported apart (26.2). */
      featureState: manifest.featureState ?? 'unknown',
      capacity,
    },
    publication: { allowed: publicationProblems.length === 0, problems: publicationProblems },
  };
}

/** Markdown for the report section. Never lists secrets; refs are repository/local paths only. */
export function renderReport(result, manifest, generatedAt) {
  const s = result.summary;
  const lines = [];
  lines.push(MARK_START);
  lines.push('## QA-13 MVP 관문 보고 (F-19)');
  lines.push('');
  lines.push(
    `생성 ${generatedAt} · 보고 기준 checkout \`${(manifest.headCommit ?? 'unknown').slice(0, 7)}\` · 기능 상태: **${s.featureState}** · MVP 완료: **${s.mvpComplete ? 'true' : 'false'}**`,
  );
  lines.push('');
  lines.push(
    `필수 관문 ${s.required}개 중 PASS ${s.pass} · FAIL ${s.fail} · BLOCKED ${s.blocked} · NOT_RUN ${s.notRun} · UNVERIFIED ${s.unverified}. BLOCKED/NOT_RUN/PRODUCT_DECISION_PENDING 은 PASS 에 합산하지 않는다. 결정 대기: ${s.pending.join(', ') || '없음'}.`,
  );
  lines.push('');
  lines.push(
    `검증된 상한: 게임 단독 **${s.capacity.gameOnlyRooms}방**, 미디어 포함 **${s.capacity.withMediaRooms}방** (1→3→5→10 중 실제 통과분만; 나머지는 운영 상한으로 열지 않음).`,
  );
  lines.push('');
  lines.push('| 관문 | 상태 | 환경 | 증거 | 실측 상한 | 잔여 결함 / 사유 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const g of result.gates) {
    const limits =
      Object.entries(g.measuredLimits)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || '-';
    const defects = [...g.defects, ...g.problems].join('; ') || '-';
    lines.push(
      `| ${g.gate} | **${g.status}**${g.status !== g.declared ? ` (선언 ${g.declared})` : ''} | ${g.environmentRef ?? '-'} | ${g.evidenceRefs.map((r) => `\`${r}\``).join(', ') || '-'} | ${limits} | ${defects} |`,
    );
  }
  lines.push('');
  lines.push(
    `공개 재개 조건: **${result.publication.allowed ? '충족' : '미충족'}**${result.publication.problems.length ? ` — ${result.publication.problems.join('; ')}` : ''}. 공개창 오픈·Jira 완료·원격 배포는 이 보고서 작성으로 실행되지 않는다.`,
  );
  lines.push('');
  lines.push(
    '운영 인계 순서: 외부 격리 확인(SSO 게이트) → drain terminal succeeded·회수 확인 → 검증 commit 이미지 교체 → initialize/RECOVERING 관찰 → READY → 격리 중 resume·OPEN 별도 확인 → 6인 smoke → 시험 세션·미디어 정리 → 공개창·공식 잔량 재검사 → (격리는 SSO 로 상시 유지). 실패 시 격리 유지·재 drain·회수 확인 뒤 이전 digest 로 롤백, 확인 불가는 ROLLBACK_BLOCKED 로 남김. UNRESOLVED 는 `retry-retirement` 명시 재시도, 저널 손상은 LOCKED(사람 확인), 시계 오차·예산 미확인은 재개 차단. 한계: DB 없음·진행 매치 복원 없음·호스트 전체 상실 중 변조 단말 즉시 회수 불가.',
  );
  lines.push(MARK_END);
  return lines.join('\n');
}

export function injectReport(markdown, section) {
  const start = markdown.indexOf(MARK_START);
  const end = markdown.indexOf(MARK_END);
  if (start >= 0 && end > start)
    return markdown.slice(0, start) + section + markdown.slice(end + MARK_END.length);
  return `${markdown.trimEnd()}\n\n${section}\n`;
}

if (basename(process.argv[1] ?? '') === 'verify-mvp-evidence.mjs') {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
  };
  const gatesPath = resolve(arg('--gates', '.local/qa/mvp-gates.json'));
  const input = resolve(arg('--input', '.local/qa'));
  const report = resolve(arg('--report', 'docs/verification.md'));
  if (!existsSync(gatesPath)) {
    console.error(`BLOCKED: gate manifest not found ${gatesPath}`);
    process.exitCode = 3;
  } else {
    const manifest = JSON.parse(readFileSync(gatesPath, 'utf8'));
    const root = process.cwd();
    const exists = (ref) => {
      const candidates = [resolve(root, ref), resolve(input, ref)];
      return candidates.some(
        (p) => existsSync(p) && (statSync(p).isDirectory() || statSync(p).size > 0),
      );
    };
    const result = evaluateGates(manifest, exists, manifest.headCommit ?? null);
    const section = renderReport(result, manifest, new Date().toISOString());
    const current = existsSync(report) ? readFileSync(report, 'utf8') : '';
    writeFileSync(report, injectReport(current, section));
    writeFileSync(
      resolve(input, 'QA-13.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2) + '\n',
    );
    const s = result.summary;
    console.log(
      `verify-mvp-evidence: mvpComplete=${s.mvpComplete} pass=${s.pass}/${s.required} blocked=${s.blocked} notRun=${s.notRun} unverified=${s.unverified} publication=${result.publication.allowed ? 'allowed' : 'blocked'}`,
    );
    process.exitCode = s.mvpComplete && result.publication.allowed ? 0 : 1;
  }
}
