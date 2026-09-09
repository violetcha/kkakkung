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

| 항목        | 값                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 웹훅 URL    | Jenkins 크리덴셜 **Secret text**, ID `mattermost-webhook` (Manage Jenkins → Credentials → Global). 저장소·문서·로그에 URL 을 두지 않는다            |
| 수신자 매핑 | `infra/jenkins/notify-map.json` 의 `byEmail`: GitLab 계정/커밋 이메일 → MM `@사용자명`. 웹훅 payload 의 `username` 은 비어 오므로 이메일로 대조한다 |
| 수신자 결정 | MR 잡: `gitlabUserEmail` → develop 잡: 실패 커밋 author 이메일 → 둘 다 없으면 웹훅 기본 채널                                                        |
| 메시지      | 잡·빌드 번호, 브랜치, 커밋, 실패 단계(`FAILED_STAGE`), MR 링크, 콘솔 링크                                                                           |
| 실패 처리   | 크리덴셜 없음·전송 실패·작업공간 없음 모두 echo 후 계속. 빌드 결과는 바뀌지 않는다                                                                  |
| 점검        | `NOTIFY_DRY_RUN=1 node scripts/notify-build-failure.mjs` 는 payload 만 출력하고 보내지 않는다. 계약 시험 `tests/contracts/notify-contract.test.ts`  |

DM 발신자는 웹훅을 만든 계정으로 표시된다(팀 봇 계정 없음). 새 팀원은 `notify-map.json` 에 이메일과 MM 아이디를 추가한다.
