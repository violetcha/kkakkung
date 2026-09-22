#!/usr/bin/env node
// S15P21C204-345. Whether the checked-out commit may stand for the commit the trigger announced,
// and which SHA the rest of the build verifies against (DP-04).
//
//   node scripts/trigger-commit.mjs --head <sha> --mr <sha> --push <sha>
//
// Prints the SHA to hand to `EXPECTED_SOURCE_SHA`, or exits 1 with the reason on stderr.
//
// The two triggers are not the same question.
//
// **MR builds must match exactly.** A mismatch there means the source branch was pushed again
// while this build was running, and GitLab starts a build for that push. Stopping is how the
// older commit avoids collecting a success status it did not earn (SETUP.md, kkakkung-mr #186).
//
// **Push builds pass when the checkout contains what was announced.** `disableConcurrentBuilds()`
// makes Jenkins fold several queued push triggers into one build, and that build carries one
// webhook's `after` while checking out the moving `refs/remotes/origin/develop`. Merging three
// MRs in a row therefore announced the first merge and checked out the third — and the exact
// comparison stopped the deploy with nothing left in the queue to retry it (kkakkung #205: three
// merges, zero deploys; only a polling race saved it). A develop that is a descendant of the
// announced commit contains that commit, and every commit added on top arrived through its own
// verified MR, so deploying it is deploying what was announced and then some.
//
// Anything this cannot decide — an unreadable HEAD, a malformed SHA, a `merge-base` that fails
// because the commit is missing — stops the build. Not being able to tell is never a pass.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** GitLab sends full hashes; short ones are accepted the way ci-verify.mjs accepts them. */
const SHA = /^[0-9a-f]{7,40}$/;

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * @param {{ head?: string, mr?: string, push?: string }} input
 * @param {(ancestor: string, descendant: string) => boolean} [isAncestor]
 * @returns {{ ok: true, sha: string, advancedFrom?: string, announced: boolean }
 *          | { ok: false, message: string }}
 */
export function triggerVerdict(input, isAncestor = gitIsAncestor) {
  const head = normalize(input.head);
  if (!SHA.test(head)) return { ok: false, message: `체크아웃 커밋을 읽지 못했습니다 (${head})` };

  const mr = normalize(input.mr);
  if (mr) {
    if (!SHA.test(mr)) return { ok: false, message: `MR 커밋 형식이 잘못됐습니다 (${mr})` };
    if (!head.startsWith(mr))
      return {
        ok: false,
        message:
          `체크아웃된 커밋(${head})이 GitLab 이 보낸 MR 커밋(${mr})과 다릅니다. ` +
          `소스 브랜치에 새 push 가 온 것이므로 그 push 의 빌드가 대신 돕니다.`,
      };
    return { ok: true, sha: head, announced: true };
  }

  const push = normalize(input.push);
  if (push) {
    if (!SHA.test(push)) return { ok: false, message: `push 커밋 형식이 잘못됐습니다 (${push})` };
    if (head.startsWith(push)) return { ok: true, sha: head, announced: true };
    if (!isAncestor(push, head))
      return {
        ok: false,
        message:
          `체크아웃된 커밋(${head})이 GitLab 이 보낸 커밋(${push})을 포함하지 않습니다. ` +
          `브랜치가 갈라졌거나 force-push 된 것입니다. 배포 중단.`,
      };
    return { ok: true, sha: head, advancedFrom: push, announced: true };
  }

  // 폴링으로 시작한 빌드에는 알려온 커밋이 없다. 대조할 대상이 없으므로 체크아웃을 그대로 쓴다.
  return { ok: true, sha: head, announced: false };
}

function gitIsAncestor(ancestor, descendant) {
  return (
    spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { encoding: 'utf8' })
      .status === 0
  );
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--head' || key === '--mr' || key === '--push') out[key.slice(2)] = argv[++i];
    else {
      console.error(`unknown argument ${key}`);
      process.exit(2);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verdict = triggerVerdict(parse(process.argv.slice(2)));
  if (!verdict.ok) {
    console.error(`trigger-commit: ${verdict.message}`);
    process.exit(1);
  }
  // stdout 은 SHA 하나만 담는다. 설명은 stderr 로 내보내 Jenkins 콘솔에만 남는다.
  if (verdict.advancedFrom)
    console.error(
      `trigger-commit: develop 이 ${verdict.advancedFrom} 이후로 더 나아갔습니다. ` +
        `체크아웃 ${verdict.sha} 가 그 커밋을 포함하므로 그대로 검증·배포합니다.`,
    );
  else if (!verdict.announced)
    console.error('trigger-commit: 알려온 커밋이 없습니다(폴링 빌드). 체크아웃을 그대로 씁니다.');
  process.stdout.write(verdict.sha);
}
