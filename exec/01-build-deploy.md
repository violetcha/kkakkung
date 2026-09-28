# 1. 빌드 및 배포 매뉴얼

GitLab에서 소스를 클론한 뒤 까꿍을 빌드하고 배포하는 절차다. 기준 커밋은 `develop` 581e6ff(2026-09-28)다.

까꿍은 **Java·JVM·WAS·DB를 쓰지 않는다.** 웹은 TypeScript + React 정적 번들이고, 서버는 Node.js 위의 Colyseus(WebSocket 게임 서버) + Express(HTTP)다. 영상·음성은 LiveKit Cloud(외부 SFU)를 쓴다.

## 1.1 사용 제품과 버전

### 개발 도구

| 항목       | 버전                       | 비고                                                        |
| ---------- | -------------------------- | ----------------------------------------------------------- |
| IDE        | Visual Studio Code 1.137.0 | 저장소는 IDE 설정에 의존하지 않는다(`.editorconfig`만 있음) |
| Node.js    | 24.19.0                    | `.node-version`, `package.json` `engines`                   |
| pnpm       | 11.19.0                    | `package.json` `packageManager`. npm·yarn은 쓰지 않는다     |
| TypeScript | 6.0.3                      |                                                             |
| Docker     | 29.6.2(개발 PC)            | Docker Compose v2 플러그인                                  |
| Git        | 2.x                        |                                                             |

### 런타임·프레임워크

| 구분      | 제품                         | 버전            |
| --------- | ---------------------------- | --------------- |
| 게임 서버 | Node.js                      | 24.19.0         |
|           | Colyseus(`@colyseus/core`)   | 0.18.11         |
|           | Express                      | 5.2.1           |
|           | livekit-server-sdk           | 2.18.0          |
| 웹        | React                        | 19.2.8          |
|           | three.js / React Three Fiber | 0.185.1 / 9.7.0 |
|           | MediaPipe Tasks Vision       | 1.0.1           |
|           | livekit-client               | 2.22.2          |
|           | Vite(빌드)                   | 8.2.2           |
| 시험      | Vitest / Playwright          | 5.0.0 / 1.63.0  |

### 서버(배포) 구성

| 구분               | 제품                                      | 버전·이미지                                 |
| ------------------ | ----------------------------------------- | ------------------------------------------- |
| 호스트             | AWS EC2 1대(Ubuntu)                       | 4 vCPU                                      |
| 웹 서버(호스트)    | nginx. TLS 종단, SSO, 경로 차단           | 호스트 패키지                               |
| 웹 서버(컨테이너)  | nginx. 정적 파일, `/api`·WebSocket 프록시 | `nginx:1.28-alpine`                         |
| 게임 서버 컨테이너 | Node.js                                   | `node:24.19.0-bookworm-slim`                |
| 로그인 게이트      | oauth2-proxy(GitLab OAuth)                | `quay.io/oauth2-proxy/oauth2-proxy:v7.8.1`  |
| CI/CD              | Jenkins(OpenJDK 21 JRE 위에서 동작)       | `pkg.jenkins.io` stable 패키지              |
| CI 검증 컨테이너   | Node.js + Playwright Chromium             | `node:24.19.0-bookworm`, Playwright 1.63.0  |
| 비밀 스캔          | gitleaks                                  | `zricethezav/gitleaks:v8.30.1`              |
| 이미지 스캔(야간)  | Trivy                                     | `aquasec/trivy:0.74.0`                      |
| 인증서             | Let's Encrypt(certbot)                    | `/etc/letsencrypt/live/j15c204.p.ssafy.io/` |

Jenkins 자체만 JVM(OpenJDK 21)을 쓴다. 서비스 코드는 JVM과 무관하다.

## 1.2 로컬 빌드와 실행

루트에서 실행한다. 앱별 lockfile은 없고 루트 `pnpm-lock.yaml`이 기준이다.

```bash
git clone https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204.git
cd S15P21C204
pnpm install --frozen-lockfile
pnpm setup:env                       # apps/web/.env.local, server/.env 를 예시에서 만든다
pnpm exec playwright install chromium
pnpm dev                             # 웹 http://localhost:5173, 서버 http://localhost:2567
```

- 기본 개발 설정은 **미디어가 꺼진 진단 프로필**이다. 제품 게임 전체(얼굴·음성)를 돌리려면 1.3의 제품 설정과 LiveKit 값이 필요하다.
- 서버 생존 확인: `http://localhost:2567/health/live`

**빌드와 검사**

```bash
pnpm build     # packages → server(dist/main.js) → apps/web(dist)
pnpm verify    # 포맷 → lint·의존 경계 → 타입 → 단위/통합 → 빌드 → 공개 번들 → 제품 자산 → E2E
```

**Docker로 로컬 실행**(미디어 꺼짐)

```bash
docker compose -f infra/compose.yaml up -d --build
# http://127.0.0.1:8080
```

## 1.3 빌드·실행 환경 변수

### 웹(빌드 시점, `apps/web/.env.local`)

| 변수                | 값   | 설명                                                       |
| ------------------- | ---- | ---------------------------------------------------------- |
| `VITE_API_BASE_URL` | 비움 | 비우면 같은 출처 `/api`. 직접 지정하면 `/api`까지 포함한다 |
| `VITE_COLYSEUS_URL` | 비움 | 비우면 같은 출처. 개발 서버에서는 `ws://127.0.0.1:2567`    |

배포 빌드에는 `.env`를 넣지 않는다(두 값 모두 비움 → 같은 출처).

### 게임 서버(실행 시점)

서버 환경 변수는 `server/src/config/env.ts`의 zod 스키마가 검사한다. 그룹으로 묶인 값은 **전부 있거나 전부 없어야** 하고, 빈 값은 미설정으로 본다.

**기본 설정**

| 변수                      | 운영 값                            | 설명                                                            |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`                | `development`                      | `development`·`test`만 허용한다. `production`은 부팅을 거절한다 |
| `SERVER_PROFILE`          | `product`                          | 제품 게임 조립. `development`는 진단 프로필                     |
| `HOST` / `PORT`           | `0.0.0.0` / `2567`                 | 컨테이너 안 주소. 호스트 포트는 열지 않는다                     |
| `ALLOWED_ORIGINS`         | `https://j15c204.p.ssafy.io`       | 목록 밖 Origin은 HTTP 403·WebSocket 거절                        |
| `TRUST_PROXY_HOPS`        | `1`                                | 호스트 nginx 한 단계를 믿는다(SSO 헤더)                         |
| `SERVICE_NAMESPACE`       | `kkakkung-ec2`                     | LiveKit 방 이름 접두사                                          |
| `LOG_LEVEL`               | `info`                             |                                                                 |
| `OPS_DATA_DIR`            | `/var/lib/kkakkung`                | 운영 기록(미디어 저널·사용량) 저장 위치. Docker 볼륨            |
| `MEDIA_MODE`              | `livekit`                          | `disabled`면 미디어 없이 데모 방만 열린다                       |
| `MEDIA_SUBSCRIPTION_MODE` | `publisher-permissions`            | 구독 권한 방식                                                  |
| `SERVICE_AUDIENCE`        | `team`                             | 공개 대상                                                       |
| `SESSION_ADMISSION_MODE`  | `gitlab-sso`                       | GitLab 로그인 사용자 입장                                       |
| `OPS_OPERATING_MODE`      | `continuous`                       | 상시 운영 모드                                                  |
| `PRODUCT_TUNING_PATH`     | `server/config/tuning/mvp-v4.json` | 게임 튜닝 값(서버 전용)                                         |
| `PRODUCT_MAP_TEMPLATE`    | `maze-v1`                          | 방장이 맵 크기를 고르지 않았을 때의 기본 맵                     |

**용량 정책**

| 변수                            | 운영 값                                       | 설명                                    |
| ------------------------------- | --------------------------------------------- | --------------------------------------- |
| `MAX_ROOMS`                     | `10`                                          | 동시에 연습~경기 중인 일반 방 수        |
| `LOBBY_MAX_ROOMS`               | `30`                                          | 동시에 열어 둘 수 있는 일반 방 수       |
| `MAX_SLOTS`                     | `60`                                          | 좌석 수                                 |
| `MAX_ROOMS_PER_ACCOUNT`         | `1`                                           | SSO 계정당 방                           |
| `MAX_ROOMS_PER_ORIGIN`          | `2`                                           | 접속 출처당 방(게스트 방식용)           |
| `ROOM_IDLE_TTL_MS`              | `600000`                                      | 대기방 무활동 만료(10분)                |
| `SHOWCASE_ROOMS`                | 기본 `1`                                      | 동시 시연 방 수. `0`이면 시연 발급 닫힘 |
| `DEMO_ROOMS` / `DEMO_MAX_ROOMS` | `1` / `3`                                     | 데모 방 사용 여부 / 동시 데모 방 수     |
| `DEMO_ADMIN_EMAILS_FILE`        | `/etc/kkakkung/sso-access/allowed-emails.txt` | 데모·시연 운영자 이메일 목록            |

**비밀·운영 정책 값**(`/opt/kkakkung/production.env`, 1.5)

| 그룹           | 변수                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| LiveKit        | `LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PROJECT_ALIAS`     |
| 운영 API       | `OPS_TOKEN`(길고 무작위한 값)                                                                              |
| 운영 정책      | `OPS_OPERATION_TIMEOUT_MS`, `MEDIA_MAX_NORMAL_API_CALLS_PER_60S`, `MEDIA_MAX_TOTAL_API_CALLS_PER_60S`      |
| 월 사용량 가드 | `LIVEKIT_MONTHLY_MINUTES`, `LIVEKIT_USAGE_BASELINE`(둘 다 넣거나 둘 다 뺀다)                               |
| 입장 정책      | `INVITE_MAX_TTL_MS`, `SESSION_ATTEMPT_WINDOW_MS`, `SESSION_ATTEMPTS_PER_INVITE`, `SESSION_ATTEMPTS_PER_IP` |
| 경보(선택)     | `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_CHANNEL`                                                               |
| 배포 시험      | `SMOKE_INTERNAL_BASE_URL`(`http://127.0.0.1:18081`), `SMOKE_INTERNAL_TOKEN`(32바이트 hex)                  |

입장 정책 그룹이 비면 제품 입장이 잠기고(`LOCKED`), LiveKit 그룹이 비면 미디어가 꺼진다.

### 로그인 게이트(`/opt/kkakkung/sso.env`)

| 변수                         | 설명                             |
| ---------------------------- | -------------------------------- |
| `OAUTH2_PROXY_CLIENT_ID`     | GitLab OAuth 앱 ID               |
| `OAUTH2_PROXY_CLIENT_SECRET` | GitLab OAuth 앱 Secret           |
| `OAUTH2_PROXY_COOKIE_SECRET` | `openssl rand -hex 16`(32자 hex) |

## 1.4 배포 절차

### 호스트 토폴로지

```
인터넷 :443 ─ 호스트 nginx (TLS) ─┬─ /jenkins              → 127.0.0.1:18080 Jenkins
                                   ├─ /oauth2/*             → 127.0.0.1:4180 oauth2-proxy (GitLab SSO)
                                   ├─ /health/*             → 127.0.0.1:8080 (SSO 없이)
                                   ├─ /demo, /showcase      → GitLab SSO → 127.0.0.1:8080
                                   ├─ /api/operations 등    → 404
                                   └─ /  (SSO 통과한 요청)   → 127.0.0.1:8080 web-proxy 컨테이너
                                                                 ├─ 정적 파일
                                                                 └─ /api, /matchmake, WS → game-server:2567
```

### 최초 설치(요약)

1. **Docker·nginx·certbot 설치**, `j15c204.p.ssafy.io` 인증서 발급.
2. **Jenkins 설치**(`infra/jenkins/SETUP.md` 1~7절): OpenJDK 21 JRE, 포트 `127.0.0.1:18080`, 접두사 `/jenkins`, jenkins 사용자를 docker 그룹에 추가, 플러그인은 추천 + GitLab.
3. **Jenkins 크리덴셜 등록**: `gitlab-token`(GitLab 프로젝트 액세스 토큰), `kkakkung-production-env`(Secret file, `infra/production.env.example`을 채운 파일), `mattermost-webhook`(실패 알림, 선택).
4. **SSO 게이트**(`infra/SSO.md`): `/opt/kkakkung/sso-access/allowed-emails.txt`(운영자 이메일 목록) 준비 → `sso.env` 작성 → `docker compose -f /opt/kkakkung/sso/compose.sso.yaml up -d` → `infra/nginx/audience-team.conf`, `demo-admin.conf`, `host.conf`를 설치하고 `nginx -t`, reload.
5. **운영 설정 파일**: `/opt/kkakkung/runtime-evidence/`에 `service-operations.json`, `capability-report.json`(continuous 모드. `docs/operations.md`). 배포 러너가 `OPS_EVIDENCE_DIR`로 넘긴다.
6. **배포 시험 내부 프록시**: `node scripts/write-smoke-proxy.mjs /opt/kkakkung/smoke-internal.key /etc/nginx/conf.d/kkakkung-smoke.conf` 후 reload(loopback 전용).

### 자동 배포(Jenkins)

`develop`에 병합하면 Jenkins 잡 `kkakkung`이 다음을 한다.

1. Prepare: 태그 = 커밋 SHA 8자리
2. Secret scan: gitleaks
3. Verify: `scripts/ci-verify.mjs`(배포 모드 검사 계획)
4. Build images: `kkakkung-game:<TAG>`, `kkakkung-web:<TAG>`
5. Deploy: `scripts/verify-release.mjs` → `scripts/deploy-release.mjs`
   1. 이미지 매니페스트 확인
   2. 공개 격리 확인(익명 접근이 SSO로 돌아가는지)
   3. **drain**(새 입장을 닫고 진행 중 경기가 끝나길 기다림)
   4. 교체: `TAG=<sha8> docker compose -f infra/compose.yaml -f infra/compose.production.yaml -f infra/compose.continuous.yaml up -d`
   5. `/health/ready` 200 확인
   6. **resume**(입장 재개)
   7. DP-06 Cloud 스모크(실제 LiveKit으로 합성 6인 라운드)
   8. 공개 재검사 → `last-good` 기록

### 수동 배포·롤백

```bash
./infra/deploy.sh <커밋 SHA>      # 그 커밋 이미지가 이미 빌드돼 있어야 한다
```

수동 배포도 Jenkins와 같은 러너로 drain → 교체 → ready → resume → 스모크를 지난다. `docker compose up`을 손으로 치지 않는다.

## 1.5 배포 시 특이사항

- **`NODE_ENV=production`을 쓰지 않는다.** 서버가 부팅을 거절한다. 제품 배포는 `NODE_ENV=development` + `SERVER_PROFILE=product`다.
- **진행 중인 경기가 있으면 배포가 실패할 수 있다.** drain 기한은 기본 300초(`scripts/lib/release-sequence.mjs`)이고, 그 안에 연습·경기·입장 예약·미디어 회수가 모두 끝나야 한다. 사람이 없을 때 배포한다. drain이 실패하면 러너가 옛 서버에 resume을 보내 입장을 다시 연다.
- **입장이 닫혀 있으면**(`지금은 입장을 받고 있지 않습니다`) 호스트 안에서 운영 명령으로 상태를 보고 resume한다(`docs/operations.md`). 운영 API는 공개 주소에서 404이고 `127.0.0.1:8080`에서만 부른다.
- **게임 서버 포트를 호스트에 열지 않는다.** `web-proxy`도 `127.0.0.1`에만 묶는다. 클라우드 방화벽이 1024~65535를 열어 두어, `0.0.0.0`으로 띄우면 외부에 노출된다.
- **oauth2-proxy가 먼저 떠 있어야** nginx `auth_request`가 502를 내지 않는다.
- **비밀 값**은 Jenkins Secret file에만 둔다. 저장소·이미지·MR·채팅에 쓰지 않는다. `.env`, `*.pem`은 커밋 금지다.
- **LiveKit 웹훅**: LiveKit Cloud 프로젝트 설정에 `https://j15c204.p.ssafy.io/api/livekit/webhook`을 등록한다(2장).
- 배포 뒤 브라우저는 **강력 새로고침(Ctrl+Shift+R)**해야 새 웹 번들을 받는다.
- 롤백은 `last-good` 기록과 이미지 digest가 맞을 때만 진행한다. 맞지 않으면 `ROLLBACK_BLOCKED`로 멈추고 강제 교체하지 않는다.

## 1.6 주요 설정 파일 목록

DB가 없어 DB 접속 정보와 ERD는 없다. 계정·비밀과 설정이 정의된 파일은 다음과 같다.

| 파일                                               | 내용                                              | 저장소 |
| -------------------------------------------------- | ------------------------------------------------- | ------ |
| `server/src/config/env.ts`                         | 서버 환경 변수 스키마와 그룹 규칙                 | 있음   |
| `server/.env.example`                              | 로컬 서버 환경 변수 예시                          | 있음   |
| `apps/web/.env.example`                            | 웹 빌드 변수 예시                                 | 있음   |
| `infra/production.env.example`                     | 운영 비밀·정책 값 목록(값 없음)                   | 있음   |
| `/opt/kkakkung/production.env`                     | 실제 운영 비밀 값(Jenkins가 배포 때 내려 줌, 600) | 없음   |
| `infra/sso.env.example`                            | oauth2-proxy 비밀 목록(값 없음)                   | 있음   |
| `/opt/kkakkung/sso.env`                            | 실제 GitLab OAuth 비밀                            | 없음   |
| `infra/sso-allowed-emails.example`                 | 운영자 이메일 목록 형식                           | 있음   |
| `/opt/kkakkung/sso-access/allowed-emails.txt`      | 실제 데모·시연 운영자 이메일 목록                 | 없음   |
| `infra/compose.yaml`                               | 서비스·포트·헬스체크·볼륨(기본)                   | 있음   |
| `infra/compose.production.yaml`                    | 운영 이미지 태그·환경 변수·재시작·로그 회전       | 있음   |
| `infra/compose.continuous.yaml`                    | 제품 상시 운영 설정(용량·입장 방식·미디어)        | 있음   |
| `infra/compose.sso.yaml`                           | oauth2-proxy 컨테이너                             | 있음   |
| `infra/nginx/host.conf`                            | 호스트 nginx(TLS·SSO·경로 차단)                   | 있음   |
| `infra/nginx/default.conf`                         | 컨테이너 nginx(정적 파일·프록시)                  | 있음   |
| `infra/docker/Dockerfile.*`                        | 게임 서버·웹·CI 이미지                            | 있음   |
| `Jenkinsfile`, `infra/jenkins/*.Jenkinsfile`       | 파이프라인·감시·사용량·이미지 스캔 잡             | 있음   |
| `server/config/tuning/mvp-v4.json`                 | 게임 튜닝 값(서버 전용)                           | 있음   |
| `server/content/maps`, `server/content/placements` | 맵 템플릿과 인증된 폴백 배치(서버 전용)           | 있음   |

더 자세한 절차는 저장소의 `infra/README.md`, `infra/jenkins/SETUP.md`, `infra/SSO.md`, `docs/operations.md`에 있다.
