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

| 잡            | 트리거                                                                                          | 하는 일                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `kkakkung`    | GitLab 웹훅 **Push events** (develop). 웹훅이 끊겼을 때를 대비해 폴링 `H/15` 를 함께 둔다       | Jenkinsfile 전체: 검증 → 이미지 → **Deploy** → ready 확인 → last-good 기록. 실패 시 이전 태그로 롤백                             |
| `kkakkung-mr` | GitLab 웹훅 **Merge request events** (열림·갱신·소스 push, 댓글 `Jenkins please retry a build`) | MR 소스 브랜치(`origin/${gitlabSourceBranch}`)만 검증. 이미지는 아래 조건일 때만, Deploy 는 skip. 결과를 GitLab 커밋 상태로 게시 |

웹훅: GitLab 프로젝트 Settings → Webhooks, URL `https://j15c204.p.ssafy.io/jenkins/project/kkakkung-mr`, Secret token 은 잡 설정의 것과 동일(서버에서 생성, 문서에 적지 않음), Merge request events 만. Push events 를 켜면 모든 브랜치가 빌드되므로 끈다.

MR 빌드는 GitLab 이 보낸 커밋을 체크아웃 HEAD 와 대조하고, develop 배포 빌드는 체크아웃을 그대로 검증·배포한다(DP-04). 판단은 `scripts/trigger-commit.mjs` 가 하고 Prepare 는 결과만 받는다. 그 결과가 `EXPECTED_SOURCE_SHA` 이고 `scripts/ci-verify.mjs` 가 install 전에 다시 대조한다. `EXPECTED_SOURCE_SHA` 는 언제나 **체크아웃된 커밋**이므로, 이 대조가 잡는 것은 Prepare 이후 작업 공간이 움직인 경우다.

**MR 빌드는 정확 일치 (S15P21C204-345)**. 다르면 소스 브랜치에 새 push 가 온 것이고 그 push 의 빌드가 따로 도니, 멈추는 것이 오래된 커밋에 성공 상태가 붙지 않게 하는 방법이다(#186).

**develop 배포 빌드는 대조하지 않는다 (S15P21C204-345)**. `disableConcurrentBuilds()` 때문에 Jenkins 가 큐에 쌓인 푸시 트리거를 빌드 하나로 합치는데, 그 빌드는 첫 웹훅의 `after` 를 들고 움직이는 `refs/remotes/origin/develop` 를 체크아웃한다. 대조하면 연속 머지가 통째로 배포되지 않는다(`kkakkung #205`: 머지 셋, 배포 0. 큐에 남은 것이 없어 재시도도 없다). 트리거 종류를 어느 SHA 변수가 채워졌는지로 가를 수도 없다 — GitLab 플러그인은 push 빌드에도 `gitlabMergeRequestLastCommit` 을 `gitlabAfter` 와 같은 값으로 채운다(`kkakkung #209`). 그래서 배포 여부(`IS_DEPLOY`)를 먼저 정하고, 배포 빌드는 폴링 빌드와 같이 HEAD 를 쓴다. 웹훅 내용과 상관없이 체크아웃은 늘 `origin/develop` 이므로 대조가 막아 주던 것은 force-push 뿐이었고, 그것도 다음 폴링이 그대로 배포했다. develop 은 보호 브랜치가 아니므로 force-push 로 머지가 사라지는 것은 Jenkins 가 아니라 GitLab 보호 설정으로 막아야 한다. SHA 형식을 읽지 못하면 배포 빌드라도 중단한다. 스크립트는 받은 `deploy`·`mr`·`push` 값을 콘솔에 한 줄 남긴다.

**같은 머리는 두 번 배포하지 않는다 (S15P21C204-347)**. 대조를 걷어낸 대가로 중복이 생겼다. 웹훅 빌드가 큐에서 기다리는 동안 `H/15` 폴링이 "아직 빌드되지 않은 새 커밋"을 보고 빌드를 하나 더 넣는데, 둘 다 늘 `origin/develop` 머리를 체크아웃하므로 같은 커밋을 두 번 배포한다. 되풀이되는 것은 CI 시간만이 아니다. DP-06 스모크가 실제 180초 라운드를 끝까지 뛰므로(`kkakkung #211` 실측 222초) LiveKit 참가자-분 약 22분을 태우고 실서버 방 하나를 3.7분 점유한다. 그래서 Prepare 가 `/opt/kkakkung/last-good-tag` 를 이번 태그와 견주어 같으면 Deploy 단계를 건너뛰고(`ALREADY_DEPLOYED`), 빌드 설명에 "배포 생략: 이미 `<tag>`" 를 남긴다. 빌드는 직렬화되므로 여기서 읽는 last-good 은 앞 배포가 끝난 결과다. last-good 은 공개 재검사까지 통과해야 기록되므로 **실패한 배포는 다시 시도된다**. **사람이 시작한 빌드(Build Now·Rebuild)는 건너뛰지 않는다** — 환경 파일만 바꾸고 같은 커밋을 다시 배포하는 경로(5장)가 그것이다. 시작 원인을 읽지 못하면 배포하는 쪽으로 기운다.

**develop 트리거 (2026-09-21 변경)**: `H/2` 폴링은 머지하고도 최대 2분을 기다리게 했다. GitLab 프로젝트 Settings → Webhooks 에 URL `https://j15c204.p.ssafy.io/jenkins/project/kkakkung`, **Push events** 에 브랜치 필터 `develop` 로 훅을 하나 더 만들고(Secret token 은 잡 설정의 것과 같게), 잡 설정에서 **Build when a change is pushed to GitLab** 을 켠다. 폴링은 `H/15` 로 낮춰 남겨 둔다 — 웹훅이 끊겨도 15분 안에 따라잡는다. 브랜치 필터를 비우면 모든 브랜치가 develop 잡을 돌리므로 반드시 채운다.

브랜치에 Jenkinsfile 이 없으면(develop 미머지) MR 빌드가 "Jenkinsfile not found" 로 실패한다. 브랜치에 develop 을 한 번 merge 하면 해결된다.

**동시 실행 (2026-09-14 변경)**: 컨트롤러 `numExecutors` 는 **2** 로 되돌렸다. 잡 안의 겹침은 Jenkinsfile 의 `disableConcurrentBuilds()`, 잡 사이(`kkakkung` ↔ `kkakkung-mr`)의 겹침은 **Verify·이미지 빌드·배포**, 그리고 야간 이미지 스캔이 같은 호스트 `flock /var/lib/jenkins/verify.lock` 을 잡아 직렬화한다(체크아웃·비밀 스캔만 겹침). Verify 만 잠갔을 때는 Verify 를 생략한 배포 빌드의 이미지 빌드·Trivy 가 다른 빌드의 vitest 와 겹쳐 tick 과부하 flake 가 재발했다(kkakkung-mr #139, 15:22~~15:28 ↔ kkakkung #125). 두 빌드의 vitest 가 겹치면 4 vCPU 가 모자라 서버 tick 이 250ms 를 넘어 6인 통합 시험이 깨졌기 때문이다(kkakkung-mr #70). 9/10~~9/14 사이 executor 1개로 운영했을 때는 MR 빌드가 develop 배포 뒤에 통째로 줄을 서서 한 빌드가 14분까지 걸렸다(#130: 대기 6분 + 파이프라인 8분). 잠금 플러그인(lockable-resources)은 설치돼 있지 않다.

**성공 후 이미지 정리는 잠금 밖에서 돈다 (S15P21C204-347)**. 정리가 `docker images` 순서(이미지 생성 시각)만 보던 때는 kkakkung-mr #167 의 정리가 kkakkung #140 이 막 만든 `kkakkung-web:c458e647`(캐시 재사용으로 25분 전 이미지에 붙은 태그)을 Trivy 1초 전에 지웠는데, 그 사고를 실제로 막는 것은 `scripts/prune-release-images.mjs` 의 **나이 가드**(마지막 태그 부착 후 1시간 미만은 건너뜀)와 보호 목록(최신 5개·`--protect` 태그·실행 중 컨테이너의 태그)이다. 잠금은 그 위에 덧댄 중복 방어였고, 대가로 정리 한 줄이 다른 잡의 Verify 뒤에서 10분씩 기다렸다(kkakkung-mr #288 651초, kkakkung #213 606초, kkakkung-mr #280 531초). 그동안 `disableConcurrentBuilds()` 때문에 다음 푸시가 큐에서 같이 기다려, kkakkung #213 은 29분 중 14.5분이 잠금 대기였다. 잠금이 막는 것은 동시 vitest 의 tick 과부하이고 태그 몇 개 지우는 일은 그 층이 아니다.

**결과를 바꿀 수 없는 단계 정리 (2026-09-21, S15P21C204-322)**: MR 빌드가 하던 일 중 그 MR 의 합격·불합격과 무관한 것을 걷어냈다.

| 걷어낸 것          | 왜                                                                                                                                                                    | 지금                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MR 의 이미지 빌드  | MR 은 Deploy 를 건너뛰어 그 이미지를 아무도 쓰지 않았고, 태그가 커밋 SHA 라 머지 커밋이 재사용하지도 못했다. 소스가 깨지는 것은 Verify 의 `pnpm build` 가 이미 잡는다 | `scripts/needs-image-build.mjs` 가 판단한다. 배포 빌드는 항상, MR 은 Dockerfile·`infra/nginx/`·lockfile·`package.json` 등 이미지에 들어가는 파일을 건드렸을 때만. 판단이 안 되면(얕은 클론·없는 ref) 빌드한다 |
| `Scan images`      | `--exit-code 0` 이라 HIGH/CRITICAL 이 나와도 막지 않으면서 잠금을 1~3분 쥐었다. MR 이 스캔하던 이미지는 배포되지도 않았다                                             | 야간 잡 `kkakkung-image-scan` (13장). 배포돼 있는 `last-good-tag` 이미지를 본다                                                                                                                               |
| gitleaks 전체 스캔 | 매 빌드 844커밋·43MB 를 다시 읽었다. 그 커밋들은 이미 그때 스캔했다                                                                                                   | `scripts/secret-scan-range.mjs` 가 범위를 정한다. MR 은 `origin/develop..HEAD`, 배포는 last-good 이후. **범위를 못 정하면 전체를 읽는다** — 좁히지 못하는 것이 건너뛰는 이유가 되지 않는다                    |
| `:latest` 태그     | 원격이 움직일 때마다 다시 받고, 어떤 판정으로 통과했는지 되짚을 수 없다                                                                                               | `GITLEAKS_IMAGE`(Jenkinsfile)·`TRIVY_IMAGE`(야간 잡) 에 버전을 박았다. 올릴 때 그 줄만 바꾼다                                                                                                                 |

**건드리지 않은 것**: Verify·이미지 빌드·배포의 `flock` 직렬화, drain 300초, 배포 DP-06 smoke, `pnpm verify` 의 검사 항목. 앞의 둘은 여기 적힌 사고를 막고 있고, 뒤의 둘은 게이트 자체다.

**Verify 생략**: Verify 가 빌드 시간의 대부분이다(2026-09-22 실측 9분 37초: e2e 4분 25초 + vitest 3분 21초 + 포맷·린트·타입·빌드·자산 1분 47초). MR 빌드가 성공하면 `scripts/verified-tree.mjs record` 가 `/opt/kkakkung/verified-trees/<tree>.json` 에 검증한 **트리 해시**를 남기고, develop(배포) 빌드는 자기 트리가 기록돼 있으면 Verify 를 생략한다("Verify 생략: …" 로그). 트리가 다르면 전부 다시 검증한다. 이미지 빌드·배포는 그대로 돈다.

**MR 은 develop 과 합친 결과를 검증한다 (S15P21C204-347)**. 소스 브랜치의 트리는 다른 MR 이 머지돼 develop 이 움직이는 순간 머지 커밋의 트리와 달라져, 배포 빌드가 같은 코드를 10분씩 다시 검증했다(kkakkung #210 17분·#213 15분 ↔ #211·#212 1초, 넷 중 둘). Verify 직전에 **작업 공간에서만** `git merge --no-commit --no-ff origin/develop` 을 하고 `git write-tree` 의 트리를 검증·기록한다. 그 사이 develop 이 더 움직이지 않으면 머지 커밋의 트리가 그것과 같아 배포가 생략한다. 검증 대상이 곧 머지될 코드라 게이트도 정확해진다. 체크아웃은 그대로라 커밋 상태 게시도 345 의 SHA 대조도 `EXPECTED_SOURCE_SHA` 도 건드리지 않는다(HEAD 가 움직이지 않는다). 합치지 못하면(충돌·`origin/develop` 없음) abort 하고 소스 브랜치를 그대로 검증한다 — 그 MR 은 어차피 머지되지 않는다. `post` 가 항상 `git merge --abort` 를 해서 다음 빌드에 머지 상태를 남기지 않는다. **develop 이 깨져 있으면 모든 MR 이 빨개진다**. 합친 결과가 진실이므로 그게 맞다.

**생략은 검증만 건너뛴다, 작업 공간은 아니다 (2026-09-22 추가)**: 검증 기록은 **트리**에 딸리고 `pnpm install`·`pnpm build` 산출물은 **작업 공간**에 딸린다. `kkakkung` 과 `kkakkung-mr` 은 작업 공간이 다르므로, MR 이 검증한 트리를 배포가 그대로 받아도 `/var/lib/jenkins/workspace/kkakkung` 의 `packages/*/dist` 와 `node_modules` 는 직전 배포의 것이다. 배포 스모크(DP-06)는 **그 작업 공간의 웹 클라이언트 소스**를 실행하고 그 소스는 `dist` 를 읽기 때문에, 이 어긋남이 멀쩡한 커밋을 무너뜨린다(`kkakkung #203`: `TypeError: restorePrivateView is not a function` 380건 → `ROLLBACK_BLOCKED`. 서버 이미지는 Docker 안에서 새로 빌드돼 멀쩡했고 시험 클라이언트만 옛 protocol 을 읽었다). Deploy 단계가 릴리스 스크립트를 부르기 전에 **Verify 생략 여부와 무관하게** 같은 CI 컨테이너·같은 pnpm store 로 `pnpm install --frozen-lockfile && pnpm build:packages` 를 돌린다(S15P21C204-343). 이미 최신이면 몇 초다. 조건을 달지 않는 이유는 "Verify 가 돌았으면 작업 공간이 준비돼 있다" 는 암묵적 결합이 바로 이 사고의 원인이기 때문이다.

**파이프라인 끝나기 전 머지 막기**: Jenkins 가 `updateGitlabCommitStatus name: 'jenkins'` 로 MR 커밋 상태를 게시하므로 GitLab 은 이를 외부 파이프라인으로 본다. GitLab 프로젝트 **Settings → Merge requests → Merge checks → "Pipelines must succeed"** 를 켜면 jenkins 상태가 success 가 되기 전엔 Merge 버튼이 잠긴다("Skipped pipelines are considered successful" 은 끔). Maintainer 권한이 필요해 UI 에서 사람이 켠다. 켠 뒤 웹훅을 놓친 MR 은 댓글 `Jenkins please retry a build` 로 다시 돌린다.

두 잡과 크리덴셜(Secret file, GitLab API token)은 UI 로그인 없이 `jobs/<잡>/config.xml` 배치 + `init.groovy.d` 부트스트랩(실행 후 자기 삭제) + Jenkins 재시작으로 만들었다. 같은 방법으로 재현 가능.

**호스트 속도 (2026-09-16 추가)**: EC2 는 t3.xlarge(버스터블)라 CPU 크레딧이 바닥나면 steal 이 치솟고, SwiftShader 로 도는 Playwright e2e 가 먼저 무너진다(kkakkung-mr #171: `facility-rendering.spec.ts` 가 재시도 포함 2회 60초 초과, 다른 21개 e2e 는 평소 시간. 로컬 SwiftShader 강제 실행은 12초). Verify 단계는 앞뒤로 `host before-verify/after-verify: load=… steal_ticks=… idle_ticks=…` 줄을 남기므로, 두 줄의 steal_ticks 차이가 크면(수천 틱 이상) 호스트가 느렸던 것이고 코드 회귀가 아니다. 그 spec 은 예산 120초·5인 장면 스크린샷 분리·실패 시 단계별 소요(`step-timings-ms` 첨부)로 바꿨다(S15P21C204-264).

**MR 빌드는 Replay 하지 않는다 (2026-09-18 추가)**: `kkakkung-mr` 는 GitLab 웹훅이 넘긴 `gitlabSourceBranch` 로 체크아웃한다. Jenkins UI 의 Replay/Rebuild 는 그 변수 없이 돌아 "Couldn't find any revision to build" 로 곧바로 실패한다(kkakkung-mr #187·#190·#192·#193, 9/17). 다시 검증하려면 그 브랜치에 커밋을 push 한다. 검증 중에 같은 브랜치에 또 push 하면 "체크아웃된 커밋이 GitLab 이 보낸 커밋과 다릅니다" 로 앞 빌드가 중단되고 새 빌드가 도는 것이 정상이다(#186).

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
- 현재 Verify는 Chromium을 준비하고 `pnpm verify`의 Playwright E2E까지 실행한다. 별도 Cloud/실장치 인수는 포함하지 않는다. 도구체인·SHA·jenkins UID의 설치는 `scripts/ci-verify.mjs`와 Jenkinsfile을 따른다.

## 8. GitLab SSO 게이트 (2026-09-09 적용)

367부터 로그인 게이트는 lab.ssafy.com 계정 전체를 통과시키고, `/demo`·`/showcase` 운영자는
게임 서버가 `/opt/kkakkung/sso-access/allowed-emails.txt`로 판정한다. 최초 설치 전에
[SSO 절차](../SSO.md)에 따라 이 파일을 준비한다.
기존 운영 서버는 아래 최초 설치 명령으로 비밀 env를 덮어쓰지 말고, 같은 문서의 전환 절차를
따른다. 게이트 교체는 앱 배포 뒤에 한다(순서는 SSO 절차).

```bash
sudo install -d /opt/kkakkung/sso && sudo cp infra/compose.sso.yaml /opt/kkakkung/sso/
sudo cp infra/sso.env.example /opt/kkakkung/sso.env && sudo chmod 600 /opt/kkakkung/sso.env   # CLIENT_ID·CLIENT_SECRET 은 담당자가 nano 로, COOKIE_SECRET 은 openssl rand -hex 16
sudo docker compose -f /opt/kkakkung/sso/compose.sso.yaml up -d
sudo docker logs kkakkung-sso | tail -3    # "OAuthProxy configured for GitLab" 확인
sudo install -m 644 infra/nginx/audience-team.conf /etc/nginx/snippets/kkakkung-audience.conf   # 공개 대상 조각. 없으면 nginx 가 뜨지 않는다
sudo install -m 644 infra/nginx/demo-admin.conf /etc/nginx/snippets/kkakkung-demo-admin.conf
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
| 프로파일     | Build with Parameters의 `RELEASE_PROFILE`: product(기본) 또는 skeleton. [테스트](../../docs/testing.md)를 따른다.                                                                                               |
| 운영 토큰    | Secret file `kkakkung-production-env`의 `OPS_TOKEN`을 서버와 제품 배포 러너가 함께 읽는다. 내부 시험 키 `SMOKE_INTERNAL_TOKEN`과 `SMOKE_INTERNAL_BASE_URL`도 같은 파일에 둔다. 개인 SSO 쿠키는 사용하지 않는다. |
| preflight    | continuous는 검증된 SHA/lock별 유계 DP-06 계획을 자동 생성한다. attested는 `/opt/kkakkung/cloud-preflight.json`이 필요하다.                                                                                     |
| 운영 정책    | 기본 continuous는 service-operations.json과 capability를 검사한다. attested는 기존 공식 잔량·유효기간을 검사한다. [운영](../../docs/operations.md)을 따른다.                                                    |
| smoke origin | SMOKE_INTERNAL_BASE_URL의 loopback listener와 SMOKE_INTERNAL_TOKEN을 사용한다. 공개 HTTPS의 SSO 차단은 따로 검사한다.                                                                                           |
| 기록         | `/opt/kkakkung/releases/<tag>.json`(매니페스트), `/opt/kkakkung/releases/<tag>/release.json`(단계·결과), `last-good-tag`·`last-good-digest`(통과 시에만)                                                        |
| 실패         | 러너가 이전 이미지로 복귀를 시도한다. `ROLLBACK_BLOCKED` 면 사람이 확인: `release.json` 의 reason(NO_PREVIOUS_RELEASE, PREVIOUS_DIGEST_MISMATCH, ROLLBACK_DRAIN_TIMEOUT, ROLLBACK_READY_TIMEOUT …)              |
| 수동         | `DEPLOY_PROFILE=product ./infra/deploy.sh <SHA>`는 같은 product-release 러너를 호출한다. 내부 시험 키는 제품 환경 파일에서 읽는다.                                                                              |

배포별 결과는 해당 Jenkins 실행과 `release.json`으로 확인한다.

### 제품 배포 재실행과 이미지 보존

- `build-release-images.mjs`는 같은 커밋 태그의 기존 이미지를 재사용한다. revision이 다른 이미지는 덮어쓰지 않고 실패한다. 배포와 롤백은 매니페스트의 이미지 ID를 Compose override로 지정하며 자동 재빌드·pull을 하지 않는다.
- continuous의 DP-06 계획은 1방·6명·최대 600초+60초, 실행 유효기간 30분으로 자동 생성한다. 공식 잔량을 만들지 않고 공급자 할당량 정책을 명시한다. attested만 기본 preflight의 유효기간·공식 예산·기기 계획·lockfile 검증을 유지한다. 실제 실행 파일은 `releases/<tag>-preflight.json`이다.
- `LOCKED`여도 경기·입장·저널·예산·회수 정리가 확인되면 drain은 완료할 수 있다. 기존 서버의 입장 잠금은 유지한다. 회수 미확인이나 기록 손상은 계속 차단한다.
- 성공한 빌드는 저장소별 최근 5개 태그만 남긴다. 지금 태그, `last-good-tag`, 실행 중 컨테이너의 태그, 마지막 태그 시각이 1시간 이내인 태그는 지우지 않는다(`node scripts/prune-release-images.mjs --dry-run kkakkung-game kkakkung-web` 으로 미리 볼 수 있다).
- 마지막 정상 이미지 ID가 이미 삭제됐다면 롤백은 `PREVIOUS_IMAGE_MISSING`으로 실패한다. 같은 소스를 재빌드한 이미지를 기존 digest의 대체물로 취급하거나 실패한 배포를 last-good으로 기록하지 않는다.

## 11. 서비스 감시 잡 (S15P21C204-288)

`kkakkung-watchdog` 잡이 5분마다 `scripts/watch-service.mjs` 를 호스트 Node 로 실행해 서비스 무응답·게임 서버 비정상 재시작·복구를 Mattermost 로 알린다. 무엇을 언제 알리는지는 [운영 6장 외부 알림](../../docs/operations.md#외부-알림).

| 항목      | 값                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 잡 만들기 | 새로운 Item → 이름 `kkakkung-watchdog`, Pipeline → Pipeline script from SCM, Git 저장소·크리덴셜은 `kkakkung` 잡과 같게, 브랜치 `*/develop`, Script Path `infra/jenkins/watchdog.Jenkinsfile`, Lightweight checkout |
| 첫 실행   | 저장 후 **지금 빌드** 한 번. 이때 5분 cron 과 `SEND_TEST` 파라미터가 등록된다. 이어서 **파라미터와 함께 빌드**에서 `SEND_TEST` 를 켜고 실행해 채널에 시험 메시지가 오는지 확인한다                                  |
| 웹훅      | 9장의 `mattermost-webhook` 을 그대로 쓴다. 채널을 비우면 웹훅 기본 채널, 다른 채널은 Jenkinsfile `environment` 에 `WATCH_CHANNEL` 을 둔다                                                                           |
| 상태      | `/opt/kkakkung/watchdog-state.json`(jenkins, 600). 지우면 다음 회차가 처음부터 센다(재시작 기준값도 새로 잡힌다)                                                                                                    |
| 결과      | 서비스가 죽어 있어도 잡은 성공이다. 잡이 실패하면 알림을 못 보낸 것이다: 전달 실패·크리덴셜 없음·docker 에 물을 수 없음. 실패한 회차의 알림은 다음 회차가 다시 보낸다                                               |
| 점검      | `WATCH_DRY_RUN=1 node scripts/watch-service.mjs --state /tmp/watch.json` 은 판정과 메시지만 출력하고 보내지도 저장하지도 않는다. 계약 시험 `tests/contracts/service-watch.test.ts`                                  |

게임 서버 경보(LOCKED·429·저널·회수 미확인·틱 과부하)는 이 잡이 아니라 서버가 `ALERT_WEBHOOK_URL` 로 직접 보낸다. `kkakkung-production-env` 에 그 줄을 넣고 재배포해야 켜진다.

## 12. LiveKit 사용량 잡 (S15P21C204-304)

`kkakkung-livekit-usage` 잡은 30분마다 LiveKit Cloud Analytics API를 읽어 현재 월의 참가자-분을 세고, 임계치를 넘을 때 Mattermost로 알린다. 이 잡은 게임 컨테이너 밖에서 실행되므로 서버가 멈춰도 마지막 성공 시각과 API 장애를 별도로 확인할 수 있다.

Analytics API는 LiveKit Cloud Scale 이상에서만 제공된다. 현재 프로젝트가 Build라면 잡은 사용량을 추정하거나 성공으로 꾸미지 않고 `ANALYTICS_UNAUTHORIZED`로 실패 알림을 보낸다. Build에서는 공개 전에 대시보드의 현재 월 사용량을 확인하고, 이 잡을 활성화하려면 프로젝트 플랜과 아래 자격 증명을 먼저 확인한다.

| 항목      | 값                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 잡 만들기 | 새로운 Item → 이름 `kkakkung-livekit-usage`, Pipeline → Pipeline script from SCM, Git 저장소·크리덴셜은 `kkakkung` 잡과 같게, 브랜치 `*/develop`, Script Path `infra/jenkins/livekit-usage.Jenkinsfile`, Lightweight checkout |
| 크리덴셜  | Secret text `livekit-api-key`, `livekit-api-secret`, `livekit-project-id`, `livekit-usage-baseline-minutes`, 기존 `mattermost-webhook`                                                                                        |
| 기준값    | 첫 실행의 `livekit-usage-baseline-minutes`는 해당 월 LiveKit Cloud 대시보드의 참가자-분 사용량이다. `5000/4000/4500`은 Build 5,000분 기준의 예시일 뿐이며 프로젝트 Settings → Project 값과 일치하는지 확인한다.               |
| 상태      | `/opt/kkakkung/livekit-usage-state.json`(jenkins, 600). 삭제하면 첫 실행으로 돌아가 새 대시보드 기준값을 요구한다.                                                                                                            |
| 시험      | 파라미터와 함께 빌드에서 `SEND_TEST`를 켜고 실행한다. `LIVEKIT_USAGE_DRY_RUN=1`은 전송·저장을 하지 않는 로컬 판정 시험이다.                                                                                                   |
| 복구      | API 401/403·429·timeout은 `BLOCKED`/실패로 남기고 잔량을 만들지 않는다. 대시보드에서 확인한 뒤 자격 증명·플랜·네트워크를 고치고 다음 30분 회차가 다시 성공하는지 확인한다.                                                    |

LiveKit Cloud 웹훅은 `participant_joined/left` 같은 방 이벤트 전달용이며 계정 잔여 할당량을 제공하지 않는다. 전달 보장도 없으므로 이 잡의 Analytics API 결과를 공식 사용량으로 사용하고, 웹훅 이벤트는 미디어 상태 복구용으로만 취급한다.

## 13. 이미지 취약점 스캔 잡 (S15P21C204-322)

`kkakkung-image-scan` 잡이 하루 한 번 배포돼 있는 이미지(`/opt/kkakkung/last-good-tag`)를 Trivy 로 스캔한다. 예전에는 파이프라인의 `Scan images` 단계가 매 빌드 두 번 돌았는데, `--exit-code 0` 이라 아무것도 막지 않으면서 무거운 단계 잠금을 1~3분 쥐고 있었다. 취약점은 대부분 베이스 이미지(node·nginx)에서 오고 커밋마다 달라지지 않으므로 하루 한 번이면 같은 것을 본다.

| 항목      | 값                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 잡 만들기 | 새로운 Item → 이름 `kkakkung-image-scan`, Pipeline → Pipeline script from SCM, Git 저장소·크리덴셜은 `kkakkung` 잡과 같게, 브랜치 `*/develop`, Script Path `infra/jenkins/image-scan.Jenkinsfile`, Lightweight checkout |
| 첫 실행   | 저장 후 **지금 빌드** 한 번. 이때 cron 이 등록된다                                                                                                                                                                      |
| 결과 해석 | HIGH/CRITICAL 이 나와도 **잡은 성공이다**(기록만). 잡이 실패하면 "스캔을 돌리지 못했다"는 뜻이다: `last-good-tag` 없음, 이미지가 정리됨, Trivy 를 띄우지 못함                                                           |
| 버전      | `TRIVY_IMAGE` 에 태그를 박았다. 올릴 때 그 줄만 바꾼다. `:latest` 로 두면 원격이 움직일 때마다 다시 받고 어떤 DB 로 통과했는지 되짚을 수 없다                                                                           |
| 차단 기준 | 아직 없다. 무엇을 막고 무엇을 예외로 둘지는 정해지지 않았다([운영](../../docs/operations.md))                                                                                                                           |
