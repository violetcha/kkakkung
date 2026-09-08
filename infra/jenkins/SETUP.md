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

## 6. 파이프라인 잡 (남음)

Jenkinsfile 이 아직 레포에 없을 땐 Definition 을 `Pipeline script` 로 두고 Jenkinsfile 내용을 붙인 뒤 맨 앞에 `git branch: ..., credentialsId: 'gitlab-token', url: ...` 체크아웃 스테이지만 넣으면 같은 흐름을 시험할 수 있습니다.

`New Item → Pipeline`

- **Build Triggers**: `Build when a change is pushed to GitLab` → 웹훅 URL 을 GitLab `Settings → Webhooks` 에 등록
  - Trigger: Push events, Merge request events
- **Pipeline**: `Pipeline script from SCM` → Git → 레포 주소 + `gitlab-token`
  - Branches to build: `*/develop` 과 `*/chore/*`, `*/feat/*` 등 필요 브랜치. 또는 Multibranch Pipeline
- **Script Path**: `Jenkinsfile`

Jenkinsfile 은 `GIT_BRANCH`(단일 잡) 또는 `BRANCH_NAME`(Multibranch) 을 읽어 `develop` 일 때만 배포합니다.

## 7. 첫 빌드 전 확인 (완료, 2026-09-08)

- EC2 에서 40번 Dockerfile 두 개 빌드 → `compose.prod.yaml` 로 기동 → `/health/ready` 200, Origin 403/200 확인까지 마쳤습니다.
  단, 원본 `Dockerfile.game-server` 는 pnpm 11.19 의 `deploy` 버그(pnpm/pnpm#13754)로 **부팅 시 ERR_MODULE_NOT_FOUND**.
  수정안 `infra/docker/Dockerfile.game-server`(이 스켈레톤) 로 교체해서 통과. 40번 소유 파일이라 이주헌에게 전달.
  재현 순서:
  ```bash
  git clone -b chore/S15P21C204-40-monorepo-skeleton-conventions https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204.git /tmp/kk && cd /tmp/kk
  docker build -f infra/docker/Dockerfile.game-server -t kkakkung-game:test .
  docker build -f infra/docker/Dockerfile.web -t kkakkung-web:test .
  ```
- compose 파일은 `${TAG:?}` 로 태그를 강제해서 `down`·`ps` 도 `TAG=` 가 필요합니다. 태그 몰라도 되는 방법: `docker compose -p kkakkung ps` / `down`.
- pnpm store 캐시 폴더: Jenkinsfile 이 `/var/lib/jenkins/.cache/pnpm-store` 를 만듭니다. 첫 Verify 는 5분 안팎.

## 알고 있어야 할 것

- 빌드가 컨트롤러(built-in node)에서 돕니다. 서버 한 대라 에이전트 분리 실익이 적어 안 나눕니다. 서버가 늘면 노드 추가 + `agent { label }`.
- e2e(Playwright) 는 CI 에서 아직 안 돌립니다. 브라우저 이미지(`mcr.microsoft.com/playwright`) 를 붙이면 추가 가능.
