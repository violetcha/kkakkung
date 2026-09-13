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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isCommit, isObject } from './evidence-values.mjs';
import {
  createEvidenceReader,
  evaluateRelease,
  readBoundArtifact,
  validateGateArtifact,
} from './gate-artifacts.mjs';
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

/** Evaluate the bytes supplied by the reader against the actual checkout/build, not manifest claims. */
export function evaluateGates(manifest, read, headCommit, options = {}) {
  const source = isObject(manifest) ? manifest : {};
  const gates = Array.isArray(source.gates) ? source.gates : [];
  const build = { sourceCommit: headCommit, lockfileHash: options.lockfileHash };
  const now = options.nowEpochMs ?? Date.now();
  const manifestProblems = [];
  if (!isCommit(headCommit) || source.headCommit !== headCommit)
    manifestProblems.push('manifest checkout differs from actual checkout');
  if (!/^[0-9a-f]{64}$/.test(options.lockfileHash ?? ''))
    manifestProblems.push('actual lockfileHash unavailable');
  const frequencies = new Map();
  for (const gate of gates) frequencies.set(gate?.gate, (frequencies.get(gate?.gate) ?? 0) + 1);
  const results = gates.map((input) => {
    const g = isObject(input) ? input : {};
    const problems = [];
    const measuredLimits = {};
    if (![...REQUIRED_GATES, ...PENDING_GATES].includes(g.gate)) problems.push('unknown gate');
    if (frequencies.get(g.gate) !== 1) problems.push('duplicate gate');
    if (!GATE_STATUSES.includes(g.status)) problems.push('unknown status');
    if (PENDING_GATES.includes(g.gate) && g.status !== 'PRODUCT_DECISION_PENDING')
      problems.push('pending gate cannot be accepted');
    const refs = Array.isArray(g.evidenceRefs) ? g.evidenceRefs : [];
    if (g.status === 'PASS' || g.status === 'FAIL') {
      if (!refs.length) problems.push('no evidence reference');
      if (new Set(refs).size !== refs.length) problems.push('duplicate evidence reference');
      if (!isCommit(g.sourceCommit) || g.sourceCommit !== headCommit)
        problems.push('sourceCommit differs from the reported checkout');
      if (!g.environmentRef) problems.push('environmentRef missing');
      for (const ref of refs) {
        try {
          const doc = readBoundArtifact(ref, g.evidenceSha256, read);
          Object.assign(measuredLimits, validateGateArtifact(doc, g, build, now));
        } catch (error) {
          problems.push(error instanceof Error ? error.message : 'invalid evidence');
        }
      }
      problems.push(...manifestProblems);
    }
    return {
      gate: g.gate ?? 'unknown',
      status: problems.length ? 'UNVERIFIED' : g.status,
      declared: g.status ?? 'NOT_RUN',
      sourceCommit: g.sourceCommit ?? null,
      environmentRef: g.environmentRef ?? null,
      evidenceRefs: refs,
      measuredLimits: problems.length ? {} : measuredLimits,
      defects: Array.isArray(g.defects) ? g.defects : [],
      problems,
    };
  });
  const byGate = new Map(results.map((g) => [g.gate, g]));
  const count = (status) =>
    REQUIRED_GATES.filter(
      (gate) => frequencies.get(gate) === 1 && byGate.get(gate)?.status === status,
    ).length;
  const requiredMissing = REQUIRED_GATES.filter((gate) => !byGate.has(gate));
  const mvpComplete =
    manifestProblems.length === 0 &&
    results.every((g) => g.status !== 'UNVERIFIED') &&
    REQUIRED_GATES.every(
      (gate) => frequencies.get(gate) === 1 && byGate.get(gate)?.status === 'PASS',
    );
  const release = evaluateRelease(source.publication, read, build, now);
  const publicationProblems = [...release.problems];
  if (!mvpComplete) publicationProblems.push('MVP gates not accepted');
  if (release.audience !== 'public')
    publicationProblems.push('team access restriction retained or audience unknown');
  return {
    gates: results,
    summary: {
      required: REQUIRED_GATES.length,
      pass: count('PASS'),
      fail: count('FAIL'),
      blocked: count('BLOCKED'),
      notRun: count('NOT_RUN'),
      unverified: REQUIRED_GATES.filter((gate) => byGate.get(gate)?.status === 'UNVERIFIED').length,
      requiredMissing,
      pending: [
        ...new Set(
          results.filter((g) => g.status === 'PRODUCT_DECISION_PENDING').map((g) => g.gate),
        ),
      ],
      mvpComplete,
      featureState: source.featureState ?? 'unknown',
      manifestProblems,
      // No capacity is inferred from manifest numbers or unit tests. G6 recomputes actual 10-room media measurements.
      capacity: {
        gameOnlyRooms: 0,
        withMediaRooms: frequencies.get('G6') === 1 && byGate.get('G6')?.status === 'PASS' ? 10 : 0,
      },
      declaredCapacity: source.capacity ?? null,
    },
    release,
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
    `운영 배포 준비: **${result.release.ready ? '충족' : '미충족'}** (${result.release.operatingMode}, ${result.release.audience}). 공개 재개 조건: **${result.publication.allowed ? '충족' : '미충족'}**${result.publication.problems.length ? ` — ${result.publication.problems.join('; ')}` : ''}. 공개창 오픈·Jira 완료·원격 배포는 이 보고서 작성으로 실행되지 않는다.`,
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
    let headCommit = null;
    try {
      headCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
    } catch {
      /* No actual checkout means no accepted gates. */
    }
    const lockfileHash = createHash('sha256')
      .update(readFileSync(resolve(root, 'pnpm-lock.yaml')))
      .digest('hex');
    const result = evaluateGates(manifest, createEvidenceReader(root, input), headCommit, {
      lockfileHash,
    });
    manifest.headCommit = headCommit;
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
