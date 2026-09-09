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

## 6. 파이프라인 잡 (예행연습 잡 생성 완료 2026-09-08, 정식 전환 남음)

현재 서버에는 `kkakkung-rehearsal` 잡이 있다. **Pipeline script from SCM** 으로 브랜치
`ci/S15P21C204-41-jenkins-pipeline` 의 `Jenkinsfile` 을 읽고, `H/3 * * * *` 로 폴링해 새 커밋이 있으면 자동 실행한다.
develop 이 아니라 Deploy 는 건너뛴다. 2026-09-08 빌드 #4 가 Secret scan → Verify → Build → Scan 까지 SUCCESS (2분 25초).

잡과 Secret file 크리덴셜은 UI 로그인 없이 `init.groovy.d` 부트스트랩 스크립트(실행 후 자기 삭제)와
`jobs/<잡>/config.xml` 배치 + Jenkins 재시작으로 만들었다. 같은 방법으로 재현 가능하다.

**정식 전환 (MR !15 가 develop 에 머지된 뒤)**

1. 잡 이름을 `kkakkung` 으로 바꾸거나 새 잡 생성. Branches to build: `*/develop`
2. Build Triggers: 폴링 대신 `Build when a change is pushed to GitLab` → 웹훅 URL 을 GitLab `Settings → Webhooks` 에 등록 (Push events, Merge request events)
3. 첫 배포 직전에 서버 nginx 를 `host.conf` 로 교체 (4번). 그 전엔 루트가 502 라서 순서를 지킬 것
4. 첫 develop 푸시로 Deploy 단계까지 확인. `/opt/kkakkung/last-good-tag`·`last-good-digest` 가 생기는지 확인

Jenkinsfile 은 `GIT_BRANCH`(단일 잡) 또는 `BRANCH_NAME`(Multibranch) 을 읽어 `develop` 일 때만 배포한다.

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
