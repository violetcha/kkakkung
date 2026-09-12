# Jenkins 설치와 잡 생성 (EC2 j15c204)

호스트에 직접 설치합니다. 배포 대상이 이 호스트라서, 컨테이너에 넣으면 호스트 도커로
다시 나오는 층이 생기고 볼륨 경로 불일치가 따라옵니다.

**2026-09-08 기준 1~5, 7 완료.** 남은 건 6 (정식 잡) 입니다.

## 1. 설치 (완료)

```bash
sudo apt-get install -y fontconfig openjdk-21-jre
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key \
  | sudo tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null
echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" \
  | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt-get update && sudo apt-get install -y jenkins
```

저장소 서명 키는 `jenkins.io-2026.key` 입니다. 예전 문서의 `2023.key` 는 만료돼서 `NO_PUBKEY` 가 납니다.
설치 마지막의 `systemctl start` 는 Jenkins 가 다 뜰 때까지 프롬프트를 잡고 있어요. 멈춘 게 아닙니다.

## 2. 포트·경로 (완료)

```bash
sudo mkdir -p /etc/systemd/system/jenkins.service.d
printf '%s\n' '[Service]' \
  'Environment="JENKINS_PORT=18080"' \
  'Environment="JENKINS_LISTEN_ADDRESS=127.0.0.1"' \
  'Environment="JENKINS_PREFIX=/jenkins"' \
  | sudo tee /etc/systemd/system/jenkins.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart jenkins
```

## 3. 도커 권한과 작업 폴더 (완료)

```bash
sudo usermod -aG docker jenkins
sudo mkdir -p /opt/kkakkung && sudo chown jenkins:jenkins /opt/kkakkung
sudo systemctl restart jenkins
```

`/opt/kkakkung/last-good-tag` 에 마지막 성공 태그가 기록됩니다. 롤백에 씁니다.
Jenkins 는 docker 그룹이라 사실상 호스트 root 입니다. 관리자 비밀번호를 길게 잡으세요.

## 4. 호스트 nginx (완료 → host.conf 로 교체 필요)

```bash
sudo cp infra/nginx/host.conf /etc/nginx/sites-available/kkakkung
sudo ln -sf /etc/nginx/sites-available/kkakkung /etc/nginx/sites-enabled/kkakkung
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

현재 서버에 올라간 설정은 정적파일을 `/var/www/kkakkung` 에서 직접 서빙하는 이전 버전입니다.
40번 단일레포 구조에선 프론트가 컨테이너(web-proxy) 안에 들어가므로 `host.conf` 로 바꿔야 합니다.

## 5. 초기 설정과 크리덴셜 (완료)

- 플러그인: suggested + **GitLab** 만. Docker Pipeline 은 불필요 (Jenkinsfile 이 `sh 'docker ...'` 로 CLI 직접 호출)
- Jenkins URL: `https://j15c204.p.ssafy.io/jenkins/`
- 크리덴셜 `gitlab-token`: Username with password, **Project Access Token** (개인 계정 아님)
- 크리덴셜 `kkakkung-production-env`: **Secret file**. `infra/production.env.example` 을 복사해 값을 채운 파일을 업로드. 배포마다 `/opt/kkakkung/production.env`(600) 로 내려가고 compose `env_file` 이 game-server 에만 읽힘. 값 바꾸면 크리덴셜 Update 후 재배포. 처음엔 LiveKit 줄이 비어 있어도 됨(빈 값 = 미설정)

## 6. 파이프라인 잡 (2026-09-09 기준 두 개, 완료)

| 잡            | 트리거                                                                                          | 하는 일                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `kkakkung`    | develop 폴링 `H/2`                                                                              | Jenkinsfile 전체: 검증 → 이미지 → Trivy → **Deploy** → ready 확인 → last-good 기록. 실패 시 이전 태그로 롤백                        |
| `kkakkung-mr` | GitLab 웹훅 **Merge request events** (열림·갱신·소스 push, 댓글 `Jenkins please retry a build`) | MR 소스 브랜치(`origin/${gitlabSourceBranch}`)만 검증·이미지 빌드. Deploy 는 develop 이 아니라 skip. 결과를 GitLab 커밋 상태로 게시 |

웹훅: GitLab 프로젝트 Settings → Webhooks, URL `https://j15c204.p.ssafy.io/jenkins/project/kkakkung-mr`, Secret token 은 잡 설정의 것과 동일(서버에서 생성, 문서에 적지 않음), Merge request events 만. Push events 를 켜면 모든 브랜치가 빌드되므로 끈다.

MR 빌드는 GitLab 이 보낸 `gitlabMergeRequestLastCommit` 을 `EXPECTED_SOURCE_SHA` 로 받아 `scripts/ci-verify.mjs` 가 체크아웃 HEAD 와 대조한다(DP-04). develop 폴링 빌드는 이 값이 없어 대조를 생략한다.

브랜치에 Jenkinsfile 이 없으면(develop 미머지) MR 빌드가 "Jenkinsfile not found" 로 실패한다. 브랜치에 develop 을 한 번 merge 하면 해결된다.

**동시 실행 (2026-09-10 변경)**: 컨트롤러 `numExecutors` 는 **1** 이다(`/var/lib/jenkins/config.xml`, 백업 `config.xml.bak-2026-09-10`). 잡 안의 겹침은 Jenkinsfile 의 `disableConcurrentBuilds()`, 잡 사이(`kkakkung` ↔ `kkakkung-mr`)의 겹침은 executor 1개로 막는다. 두 빌드가 겹치면 4 vCPU 가 모자라 서버 tick 이 250ms 를 넘어 6인 통합 시험이 깨졌다(kkakkung-mr #70). 대기열은 그대로 순서대로 돈다. 잠금 플러그인(lockable-resources)은 설치돼 있지 않다.

**파이프라인 끝나기 전 머지 막기**: Jenkins 가 `updateGitlabCommitStatus name: 'jenkins'` 로 MR 커밋 상태를 게시하므로 GitLab 은 이를 외부 파이프라인으로 본다. GitLab 프로젝트 **Settings → Merge requests → Merge checks → "Pipelines must succeed"** 를 켜면 jenkins 상태가 success 가 되기 전엔 Merge 버튼이 잠긴다("Skipped pipelines are considered successful" 은 끔). Maintainer 권한이 필요해 UI 에서 사람이 켠다. 켠 뒤 웹훅을 놓친 MR 은 댓글 `Jenkins please retry a build` 로 다시 돌린다.

두 잡과 크리덴셜(Secret file, GitLab API token)은 UI 로그인 없이 `jobs/<잡>/config.xml` 배치 + `init.groovy.d` 부트스트랩(실행 후 자기 삭제) + Jenkins 재시작으로 만들었다. 같은 방법으로 재현 가능.

## 7. 첫 빌드 전 확인 (완료, 2026-09-08)

- EC2 에서 40번 Dockerfile 두 개 빌드 → `compose.production.yaml` 로 기동 → `/health/ready` 200, Origin 403/200 확인까지 마쳤습니다.
  단, 원본 `Dockerfile.game-server` 는 pnpm 11.19 의 `deploy` 버그(pnpm/pnpm#13754)로 **부팅 시 ERR_MODULE_NOT_FOUND**.
  수정안 `infra/docker/Dockerfile.game-server`(이 스켈레톤) 로 교체해서 통과. 40번 소유 파일이라 이주헌에게 전달.
  재현 순서:
  ```bash
  git clone -b chore/S15P21C204-40-monorepo-skeleton-conventions https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204.git /tmp/kk && cd /tmp/kk
  docker build -f infra/docker/Dockerfile.game-server -t kkakkung-game:test .
  docker build -f infra/docker/Dockerfile.web -t kkakkung-web:test .
  ```
- 운영 기동은 항상 두 파일을 겹칩니다: `TAG=<sha> docker compose -f infra/compose.yaml -f infra/compose.production.yaml up -d`. override 는 `${TAG:?}` 로 태그를 강제해서 `down`·`ps` 도 `TAG=` 가 필요합니다. 태그 몰라도 되는 방법: `docker compose -p kkakkung ps` / `down`.
- CI 이미지 `kkakkung-ci:<Dockerfile.ci 해시 12자>` 는 Prepare 단계가 없을 때만 빌드합니다(첫 빌드 3~5분, apt 로 Chromium 의존성). Dockerfile.ci 를 바꾸면 해시가 바뀌어 자동으로 다시 빌드됩니다.
- pnpm store 캐시 폴더: Jenkinsfile 이 `/var/lib/jenkins/.cache/pnpm-store` 를 만듭니다. 첫 Verify 는 5분 안팎.

## 알고 있어야 할 것

- 빌드가 컨트롤러(built-in node)에서 돕니다. 서버 한 대라 에이전트 분리 실익이 적어 안 나눕니다. 서버가 늘면 노드 추가 + `agent { label }`.
- e2e(Playwright) 는 CI 에서 아직 안 돌립니다. 브라우저 이미지(`mcr.microsoft.com/playwright`) 를 붙이면 추가 가능.

## 8. GitLab SSO 게이트 (2026-09-09 적용)

```bash
sudo install -d /opt/kkakkung/sso && sudo cp infra/compose.sso.yaml /opt/kkakkung/sso/
sudo cp infra/sso.env.example /opt/kkakkung/sso.env && sudo chmod 600 /opt/kkakkung/sso.env   # CLIENT_ID·CLIENT_SECRET 은 담당자가 nano 로, COOKIE_SECRET 은 openssl rand -hex 16
sudo docker compose -f /opt/kkakkung/sso/compose.sso.yaml up -d
sudo docker logs kkakkung-sso | tail -3    # "OAuthProxy configured for GitLab" 확인
sudo install -m 644 infra/nginx/host.conf /etc/nginx/sites-available/kkakkung && sudo nginx -t && sudo systemctl reload nginx
```

oauth2-proxy 가 먼저 떠 있어야 nginx 의 `auth_request` 가 502 를 내지 않습니다. 쿠키 시크릿은 32자 hex(표준 base64 44자는 거절). GitLab OAuth 앱: 프로필 → Preferences → Applications, Confidential, Redirect `https://j15c204.p.ssafy.io/oauth2/callback`, scopes openid profile email read_api.

## 9. 실패 알림 (Mattermost DM)

빌드가 실패하면 `post { failure }` 가 `scripts/notify-build-failure.mjs` 를 호스트 Node 로 실행해 실패한 사람에게 Mattermost DM 을 보낸다.

| 항목        | 값                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 웹훅 URL    | Jenkins 크리덴셜 **Secret text**, ID `mattermost-webhook` (Manage Jenkins → Credentials → Global). 저장소·문서·로그에 URL 을 두지 않는다                                                                                                                                                                                                                                                               |
| 수신자 매핑 | `infra/jenkins/notify-map.json`: `byGitlabUsername`(GitLab 사용자명 → MM `@사용자명`)과 `byEmail`(GitLab 계정/커밋 이메일 → MM). GitLab 계정 이메일은 비공개라 확인할 수 없으므로 사용자명 매핑이 있으면 이메일이 달라도 닿는다                                                                                                                                                                        |
| 수신자 결정 | `gitlabUserEmail` → `gitlabMergedByUser`/`gitlabUserUsername`(GitLab 사용자명) → 실패 커밋 author 이메일(develop 잡) → 모두 없으면 웹훅 기본 채널                                                                                                                                                                                                                                                      |
| 메시지      | 잡·빌드 번호, 브랜치, 커밋, 실패 단계(`FAILED_STAGE`), MR 링크, 콘솔 링크, **실패 시험 이름과 로그 발췌**(2026-09-10)                                                                                                                                                                                                                                                                                  |
| 로그 발췌   | post 단계가 컨트롤러와 같은 호스트라 `$JENKINS_HOME/jobs/<잡>/builds/<n>/log` 를 직접 읽는다(API 토큰 불필요). vitest "Failed Tests" 블록부터 40줄·3500자 상한, 마지막 요약(Test Files·exit code)은 항상 포함. ANSI·타임스탬프·[Pipeline]·✓ 줄 제거, `Bearer …`·`token=…`·`hooks/…` URL 은 `[redacted]`. 로그를 못 읽으면 발췌 없이 이전 메시지 그대로. `BUILD_LOG_FILE` 로 파일을 지정해 dry-run 가능 |
| 실패 처리   | 크리덴셜 없음·전송 실패·작업공간 없음 모두 echo 후 계속. 빌드 결과는 바뀌지 않는다                                                                                                                                                                                                                                                                                                                     |
| 점검        | `NOTIFY_DRY_RUN=1 node scripts/notify-build-failure.mjs` 는 payload 만 출력하고 보내지 않는다. 계약 시험 `tests/contracts/notify-contract.test.ts`                                                                                                                                                                                                                                                     |

DM 발신자는 웹훅을 만든 계정으로 표시된다(팀 봇 계정 없음). 새 팀원은 `notify-map.json` 에 이메일과 MM 아이디를 추가한다.

## 10. 배포 러너 (DP-06, 2026-09-10)

Deploy 단계는 `scripts/verify-release.mjs` → `scripts/deploy-release.mjs` 만 호출한다(`infra/README.md` "배포 장벽"). 호스트 Node 24 로 실행되며 compose 를 직접 부르는 줄은 Jenkinsfile 에 없다.

| 항목         | 값                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프로파일     | Build with Parameters의 `RELEASE_PROFILE`: product(기본) 또는 skeleton. [6인 시험 절차](../../docs/six-player-test.md)를 따른다.                                                                                |
| 운영 토큰    | Secret file `kkakkung-production-env`의 `OPS_TOKEN`을 서버와 제품 배포 러너가 함께 읽는다. 내부 시험 키 `SMOKE_INTERNAL_TOKEN`과 `SMOKE_INTERNAL_BASE_URL`도 같은 파일에 둔다. 개인 SSO 쿠키는 사용하지 않는다. |
| preflight    | continuous는 검증된 SHA/lock별 유계 DP-06 계획을 자동 생성한다. attested는 `/opt/kkakkung/cloud-preflight.json`이 필요하다.                                                                                     |
| 운영 정책    | 기본 continuous는 service-operations.json과 capability를 검사한다. attested는 기존 공식 잔량·유효기간을 검사한다. [상시 운영](../../docs/continuous-operations.md)을 따른다.                                    |
| smoke origin | SMOKE_INTERNAL_BASE_URL의 loopback listener와 SMOKE_INTERNAL_TOKEN을 사용한다. 공개 HTTPS의 SSO 차단은 따로 검사한다.                                                                                           |
| 기록         | `/opt/kkakkung/releases/<tag>.json`(매니페스트), `/opt/kkakkung/releases/<tag>/release.json`(단계·결과), `last-good-tag`·`last-good-digest`(통과 시에만)                                                        |
| 실패         | 러너가 이전 이미지로 복귀를 시도한다. `ROLLBACK_BLOCKED` 면 사람이 확인: `release.json` 의 reason(NO_PREVIOUS_RELEASE, PREVIOUS_DIGEST_MISMATCH, ROLLBACK_DRAIN_TIMEOUT, ROLLBACK_READY_TIMEOUT …)              |
| 수동         | `DEPLOY_PROFILE=product ./infra/deploy.sh <SHA>`는 같은 product-release 러너를 호출한다. 내부 시험 키는 제품 환경 파일에서 읽는다.                                                                              |

첫 실제 실행(develop 머지 → Jenkins Deploy)은 이 MR 이 머지된 뒤다. 그 결과를 docs/verification.md F-16 에 기록한다.

### 제품 배포 재실행과 이미지 보존

- `build-release-images.mjs`는 같은 커밋 태그의 기존 이미지를 재사용한다. revision이 다른 이미지는 덮어쓰지 않고 실패한다. 배포와 롤백은 매니페스트의 이미지 ID를 Compose override로 지정하며 자동 재빌드·pull을 하지 않는다.
- continuous의 DP-06 계획은 1방·6명·최대 600초+60초, 실행 유효기간 30분으로 자동 생성한다. 공식 잔량을 만들지 않고 공급자 할당량 정책을 명시한다. attested만 기본 preflight의 유효기간·공식 예산·기기 계획·lockfile 검증을 유지한다. 실제 실행 파일은 `releases/<tag>-preflight.json`이다.
- `LOCKED`여도 경기·입장·저널·예산·회수 정리가 확인되면 drain은 완료할 수 있다. 기존 서버의 입장 잠금은 유지한다. 회수 미확인이나 기록 손상은 계속 차단한다.
- 마지막 정상 이미지 ID가 이미 삭제됐다면 롤백은 `PREVIOUS_IMAGE_MISSING`으로 실패한다. 같은 소스를 재빌드한 이미지를 기존 digest의 대체물로 취급하거나 실패한 배포를 last-good으로 기록하지 않는다.
