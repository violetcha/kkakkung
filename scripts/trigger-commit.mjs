#!/usr/bin/env node
// S15P21C204-345. Whether the checked-out commit may stand for the commit the trigger announced,
// and which SHA the rest of the build verifies against (DP-04).
//
//   node scripts/trigger-commit.mjs --head <sha> --deploy <true|false> --mr <sha> --push <sha>
//
// Prints the SHA to hand to `EXPECTED_SOURCE_SHA`, or exits 1 with the reason on stderr.
//
// The answer depends on the branch, not on what the webhook sent.
//
// **MR builds must match exactly.** A mismatch there means the source branch was pushed again
// while this build was running, and GitLab starts a build for that push. Stopping is how the
// older commit avoids collecting a success status it did not earn (SETUP.md, kkakkung-mr #186).
//
// **Deploy builds (develop) use the checkout as it is.** `disableConcurrentBuilds()` makes Jenkins
// fold several queued push triggers into one build, and that build carries one webhook's `after`
// while checking out the moving `refs/remotes/origin/develop`. Comparing the two stopped the deploy
// with nothing left in the queue to retry it (kkakkung #205: three merges, zero deploys). Telling
// push from MR by which SHA is filled did not work either: the GitLab plugin fills
// `gitlabMergeRequestLastCommit` on push builds too, so the fold still hit the exact match
// (kkakkung #209: `--mr f90ba6e --push f90ba6e`, checkout 35ddedd). The comparison guarded
// nothing a deploy needs: the checkout is always `origin/develop` whatever the payload says, polling
// builds already deploy HEAD with nothing announced, and a force-pushed develop reached the deploy
// through the next poll anyway. So a deploy build verifies and deploys HEAD, the way a polling
// build always has. `ci-verify.mjs` still checks that the workspace did not move after Prepare.
//
// Anything this cannot read — an unreadable HEAD, a malformed SHA — stops the build.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** GitLab sends full hashes; short ones are accepted the way ci-verify.mjs accepts them. */
const SHA = /^[0-9a-f]{7,40}$/;

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * @param {{ head?: string, deploy?: boolean | string, mr?: string, push?: string }} input
 * @returns {{ ok: true, sha: string, announced: string }
 *          | { ok: false, message: string }}
 */
export function triggerVerdict(input) {
  const head = normalize(input.head);
  if (!SHA.test(head)) return { ok: false, message: `체크아웃 커밋을 읽지 못했습니다 (${head})` };

  // MR 커밋 변수는 push 빌드에도 채워지므로 둘 중 먼저 있는 값을 알려온 커밋으로 본다.
  const announced = normalize(input.mr) || normalize(input.push);
  if (announced && !SHA.test(announced))
    return { ok: false, message: `GitLab 이 보낸 커밋 형식이 잘못됐습니다 (${announced})` };

  if (String(input.deploy) === 'true') return { ok: true, sha: head, announced };

  if (announced && !head.startsWith(announced))
    return {
      ok: false,
      message:
        `체크아웃된 커밋(${head})이 GitLab 이 보낸 커밋(${announced})과 다릅니다. ` +
        `소스 브랜치에 새 push 가 온 것이므로 그 push 의 빌드가 대신 돕니다.`,
    };
  return { ok: true, sha: head, announced };
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--head' || key === '--deploy' || key === '--mr' || key === '--push')
      out[key.slice(2)] = argv[++i];
    else {
      console.error(`unknown argument ${key}`);
      process.exit(2);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = parse(process.argv.slice(2));
  // 플러그인이 실제로 넘긴 값을 빌드 로그에 남긴다 (kkakkung #209).
  console.error(
    `trigger-commit: deploy=${input.deploy || '(없음)'} mr=${input.mr || '(없음)'} push=${input.push || '(없음)'}`,
  );
  const verdict = triggerVerdict(input);
  if (!verdict.ok) {
    console.error(`trigger-commit: ${verdict.message}`);
    process.exit(1);
  }
  // stdout 은 SHA 하나만 담는다. 설명은 stderr 로 내보내 Jenkins 콘솔에만 남는다.
  if (
    String(input.deploy) === 'true' &&
    verdict.announced &&
    !verdict.sha.startsWith(verdict.announced)
  )
    console.error(
      `trigger-commit: develop 이 알려온 ${verdict.announced} 에서 더 나아갔습니다(웹훅이 합쳐진 빌드). ` +
        `체크아웃 ${verdict.sha} 를 그대로 검증·배포합니다.`,
    );
  else if (!verdict.announced)
    console.error('trigger-commit: 알려온 커밋이 없습니다(폴링 빌드). 체크아웃을 그대로 씁니다.');
  process.stdout.write(verdict.sha);
}
