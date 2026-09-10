# infra

배포와 서버 운영. 담당: 정호성 (DevOps).

- `compose.yaml` — 로컬 개발용이자 **기본 파일.** 서비스·포트·헬스체크·볼륨 정의.
- `compose.production.yaml` — **EC2 운영 override.** 위에 덧씌워 이미지 태그·운영 env·재시작·로그 회전만 바꿉니다. 단독 실행 안 함.
- `docker/` — 이미지 정의. 개발과 배포가 같은 Dockerfile 을 씁니다.
- `nginx/default.conf` — web-proxy **컨테이너 안** nginx. 정적파일(캐시 헤더) + API + WebSocket 라우팅, X-Forwarded-* 전달.
- `nginx/host.conf` — **EC2 호스트** nginx. TLS 종단, `/jenkins`, GitLab SSO 게이트(`auth_request`), 나머지는 컨테이너로.
- `compose.sso.yaml` — **GitLab SSO 게이트**(oauth2-proxy). 앱 배포와 별개 프로젝트. 비밀은 `/opt/kkakkung/sso.env` (토대 `sso.env.example`).
- `jenkins/SETUP.md` — Jenkins 설치·잡 생성 순서.

## 배포가 의존하는 것

파이프라인은 각 패키지 내부를 모릅니다. 아래 항목에만 의존하니 **바꿀 땐 인프라에 미리 알려주세요.**

| 항목                | 현재 값                                                                                                 | 어디서 쓰나                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 런타임              | Node `24.19.0`, pnpm `11.19.0` (`.node-version`, `packageManager`)                                      | Jenkinsfile `NODE_IMAGE`, `PNPM_VER`, Dockerfile                            |
| 검증                | `node scripts/ci-verify.mjs` → `pnpm verify` 1회 (format·check:execution·lint·typecheck·test·build·e2e) | Jenkins Verify                                                              |
| 이미지              | `infra/docker/Dockerfile.game-server`, `Dockerfile.web`, 컨텍스트 = 루트                                | Jenkins Build                                                               |
| 서버 엔트리         | `dist/main.js` (`pnpm --filter @kkakkung/game-server build`)                                            | Dockerfile                                                                  |
| 헬스                | `GET /health/live`, `GET /health/ready` (503 → 200)                                                     | compose healthcheck, Jenkins 배포 확인                                      |
| 서버 환경변수       | `server/src/config/env.ts` 의 zod 스키마                                                                | `compose.production.yaml` environment                                       |
| **NODE_ENV**        | `development` \| `test` 만 허용. **production 은 부팅 거절** (NFR-05)                                   | 배포도 `development` 로 띄움. production 프로파일 생기면 compose 한 줄 변경 |
| **ALLOWED_ORIGINS** | 정확한 origin 목록. 없는 origin 은 **HTTP 403 / WS 거절**                                               | `https://j15c204.p.ssafy.io` 를 넣어둠. 도메인 바뀌면 여기                  |
| 웹 빌드             | `apps/web/dist` (Vite)                                                                                  | Dockerfile.web → nginx 컨테이너                                             |
| 웹 접속 주소        | `VITE_API_BASE_URL`, `VITE_COLYSEUS_URL` **비움** → 같은 origin                                         | 배포 빌드에 .env 를 넣지 않음                                               |
| Colyseus 경로       | `/matchmake/*`, `/<processId>/<roomId>` (루트 기준)                                                     | `nginx/default.conf` 가 처리. 프리픽스 없음                                 |

LiveKit 키(`LIVEKIT_*`)는 서버 스키마가 아직 읽지 않아 compose 에 넣지 않았습니다. 서버가 읽기 시작하면 Jenkins 크리덴셜에서 주입합니다.

## 토폴로지 (EC2 한 대)

```
인터넷 :443 ─ 호스트 nginx (TLS) ─┬─ /jenkins            → 127.0.0.1:18080 Jenkins
                                   ├─ /oauth2/*           → 127.0.0.1:4180 oauth2-proxy (GitLab SSO)
                                   ├─ /health/*           → 127.0.0.1:8080 (SSO 없이, 배포 확인용)
                                   ├─ /monitor,/playground → 404
                                   └─ /  (auth_request 로 SSO 통과한 요청만) → 127.0.0.1:8080 web-proxy 컨테이너
                                                                 ├─ 정적파일
                                                                 └─ /api, /matchmake, WS → game-server:2567 (내부 네트워크)
```

`game-server` 는 호스트 포트를 열지 않습니다. `web-proxy` 는 127.0.0.1 에만 묶습니다.
클라우드 방화벽이 1024~65535 를 열어둬서, `0.0.0.0` 으로 띄우면 UFW 와 무관하게 노출됩니다.

## 접근 제어 (GitLab SSO)

서비스 주소는 인터넷에 열려 있지만 `/`·`/api`·WebSocket 은 **lab.ssafy.com 로그인 + 프로젝트 `S15P21C204` 멤버(Reporter 이상)** 만 통과한다. 로그인 안 된 요청은 `/oauth2/start` → GitLab 인가 → 돌아와 쿠키(`_oauth2_proxy`, 7일) 를 받는다. `/health/*` 와 `/jenkins` 는 SSO 밖이다. 심사·시연 때 외부인이 접속해야 하면 그 사람을 프로젝트에 Reporter 로 초대하거나, `host.conf` 의 `auth_request` 두 줄을 주석 처리하고 reload 한다. GitLab OAuth 앱은 정호성 계정의 `kkakkung-sso`(redirect `/oauth2/callback`, scopes openid profile email read_api).

## 파이프라인

```
push → Jenkins
  Prepare       TAG = 커밋 SHA 8자리, GitLab 이 보낸 SHA 와 체크아웃 대조
  Secret scan   gitleaks (실패 시 중단)
  Verify        scripts/ci-verify.mjs: 도구체인 → SHA 대조 → frozen install → Chromium → pnpm verify 1회 (kkakkung-ci 컨테이너, jenkins uid)
  Build images  kkakkung-game:<TAG>, kkakkung-web:<TAG> (revision 라벨 = 커밋 SHA)
  Scan images   trivy (기록만)
  Deploy        develop 만. verify-release.mjs → deploy-release.mjs (아래 장벽). 실패 시 러너가 같은 장벽으로 이전 이미지 복귀
```

## 배포 장벽 (DP-06, `scripts/deploy-release.mjs`)

Jenkins 와 수동 `infra/deploy.sh` 가 **같은 러너**를 부른다. 어느 쪽도 `compose up` 을 직접 하지 않고, 현재 체크아웃을 임의 태그로 빌드하지 않는다.

1. **매니페스트** (`scripts/verify-release.mjs`): 검증된 커밋 SHA = 배포 SHA, 웹·서버 두 이미지의 digest 와 `org.opencontainers.image.revision` 라벨, 이전 last-good(태그+digest). 이미지가 없거나 라벨이 다르면 BLOCKED.
2. **외부 격리 확인**: 쿠키 없는 `/api/config` 가 SSO 로 돌아가는지(302/401/403), `/health/live` 200, 익명 `/api/operations/status` 가 200 이 아닌지. 증거가 없으면 BLOCKED. 격리는 GitLab SSO 게이트(DP-03)로 배포 전·중·후 상시 유지된다.
3. **drain**: `POST /api/operations/commands {requestId, action:'drain'}` 202 는 접수일 뿐. 같은 requestId 로 `GET /api/operations/commands/:requestId` 를 backoff 조회해 `succeeded` 를 확인하고, `GET /api/operations/status` 가 admission=DRAINING·unresolvedCount=0 인지 본다. pending/failed/기한 초과면 이미지 교체 0.
4. **교체**: `TAG=<sha8> docker compose -f infra/compose.yaml -f infra/compose.production.yaml up -d`. 실행 중 컨테이너의 이미지 id 가 매니페스트 digest 와 같은지 확인.
5. **ready/복구**: `/health/ready` 200. 503 `recovering` 은 RECOVERING 으로 기다린다. 운영 API 가 있으면 readiness=READY 를 따로 확인(admission 은 아직 DRAINING 이어도 정상).
6. **resume**: 새 requestId 로 `{action:'resume'}` → terminal succeeded → status 가 admission=OPEN·readiness=READY 인지 **별도로** 확인. LOCKED 면 완료 불일치로 실패.
7. **smoke**: 운영 API 있음 → `run-cloud-check.mjs --case DP-06`(preflight 필요, 6인 HTTP 경로). 없음(skeleton) → `deployment-smoke.mjs`(DP-03 HTTP smoke).
8. **공개 재검사**: unresolvedCount 0, READY/OPEN, 공식 잔량 확인 시각이 `officialBudgetMaxAgeMs` 안. 아니면 PUBLISH_BLOCKED(새 이미지는 유지, 롤백 없음, 격리 유지).
9. **기록**: 위를 모두 통과했을 때만 `/opt/kkakkung/last-good-tag`·`last-good-digest`.

실패(교체 이후): 운영 API 가 있으면 **새 requestId 로 다시 drain** 을 완료한 뒤에만, 이전 태그의 이미지 id 가 last-good-digest 와 같을 때만 복귀하고, 복귀 이미지도 4~8 을 다시 통과해야 한다. 이전 기록 없음·digest 불일치·drain 실패·복귀 이미지 ready 실패는 **ROLLBACK_BLOCKED** 로 남기고 강제 교체하지 않는다.

프로파일: `DEPLOY_PROFILE=skeleton`(현재. E 운영 API 미통합 → drain/resume 은 NOT_RUN 으로 기록, 결과 `DEPLOYED_WITHOUT_OPERATIONS`, DP-06 완료 증거가 아님) · `product`(Jenkins Secret text `kkakkung-ops-token` 과 `/opt/kkakkung/cloud-preflight.json` 필요, 결과 `READY`). 단계 기록은 `/opt/kkakkung/releases/<tag>/release.json`, 계약 시험은 `tests/contracts/deployment-sequence.test.ts`.

## 브랜치와 배포

`develop` 에 머지 = 실서버 배포. `master` 는 발표 스냅샷(Protected). 서버가 한 대라 dev/prod 가 아직 안 나뉘어 있어요.

## 롤백

```bash
./infra/deploy.sh <이전 커밋 SHA>
```

수동 롤백도 같은 러너다: 그 커밋의 이미지가 이미 있어야 하고(없으면 Jenkins 로 그 커밋을 검증·빌드), drain → 교체 → ready → resume → smoke 를 다시 지난다. `docker compose up` 을 손으로 치지 않는다.

## 비밀값

`.env`, `*.pem` 은 커밋 금지 (루트 `.gitignore`). 운영 비밀값은 `infra/production.env.example` 을 토대로 만든 파일을 Jenkins **Secret file** 크리덴셜 `kkakkung-production-env` 에만 둔다. 배포 때 `/opt/kkakkung/production.env`(600) 로 내려가 `compose.production.yaml` 의 `env_file` 로 game-server 에 주입된다. 이미지·compose·MR·채팅에 값을 쓰지 않는다. 필요하면 인프라에게.
