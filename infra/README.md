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

| 항목                | 현재 값                                                                                                 | 어디서 쓰나                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 런타임              | Node `24.19.0`, pnpm `11.19.0` (`.node-version`, `packageManager`)                                      | Jenkinsfile `NODE_IMAGE`, `PNPM_VER`, Dockerfile |
| 검증                | `node scripts/ci-verify.mjs` → `pnpm verify` 1회 (format·check:execution·lint·typecheck·test·build·e2e) | Jenkins Verify                                   |
| 이미지              | `infra/docker/Dockerfile.game-server`, `Dockerfile.web`, 컨텍스트 = 루트                                | Jenkins Build                                    |
| 서버 엔트리         | `dist/main.js` (`pnpm --filter @kkakkung/game-server build`)                                            | Dockerfile                                       |
| 헬스                | `GET /health/live`, `GET /health/ready` (503 → 200)                                                     | compose healthcheck, Jenkins 배포 확인           |
| 서버 환경변수       | `server/src/config/env.ts` 의 zod 스키마                                                                | `compose.production.yaml` environment            |
| **NODE_ENV**        | `development` \| `test`만 허용. production은 부팅 거절                                                  | 제품 선택은 별도 `SERVER_PROFILE=product`        |
| **ALLOWED_ORIGINS** | 허용 목록 밖 Origin은 HTTP 403 / WS 거절. Origin 없는 운영·CLI 요청은 별도 인증 유지                    | 정확한 배포 출처와 HTTP/WS 경계 검사             |
| 웹 빌드             | `apps/web/dist` (Vite)                                                                                  | Dockerfile.web → nginx 컨테이너                  |
| 웹 접속 주소        | `VITE_API_BASE_URL`, `VITE_COLYSEUS_URL` **비움** → 같은 origin                                         | 배포 빌드에 .env 를 넣지 않음                    |
| Colyseus 경로       | `/matchmake/*`, `/<processId>/<roomId>` (루트 기준)                                                     | `nginx/default.conf` 가 처리. 프리픽스 없음      |

제품 프로필은 `LIVEKIT_*` 설정과 운영 증거를 읽는다. 실제 값은 Jenkins Secret file과 제품 Compose overlay로 주입하며 예시·이미지·소스에는 넣지 않는다. `NODE_ENV`와 `SERVER_PROFILE`은 별개다. 현재 제품 배포도 `NODE_ENV=development`, `SERVER_PROFILE=product`를 사용한다.

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

continuous 제품 배포는 `SESSION_ADMISSION_MODE=gitlab-sso`로 팀원 직접 입장을 연결한다.
사이트의 GitLab 프로젝트 멤버 검사를 통과하면 별도 초대 없이 방 생성·방 코드 참가가 가능하다.
SSAFY 전체 교육생에게 개방하는 설정은 아니다. 기본/attested 입장 방식은 invitation이다.
호스트가 `X-SSO-User`를 인증 응답 값으로 덮어쓰고 내부 smoke 프록시는 제거해야 한다.
게임 포트 비공개·web-proxy loopback 바인딩을 유지한 상태에서만 사용한다.

서비스의 `/`·`/api`·WebSocket은 **lab.ssafy.com 로그인 + 프로젝트 `S15P21C204` 멤버(Reporter 이상)** 게이트를 유지한다. 로그인하지 않은 요청은 `/oauth2/start`와 GitLab 인가를 거친다. `/health/*`와 `/jenkins`는 SSO 밖이며 정확한 LiveKit webhook POST는 서버 서명을 검증한다. 심사·시연 참가자는 승인된 프로젝트 접근 권한으로 입장한다. 내부 6인 시험 예외는 SSO 해제를 허용하지 않는다. 자동 DP-06 인증은 아래 loopback 전용 경로를 따른다.

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

제품 배포 기본 운영 모드는 `continuous`다. `compose.continuous.yaml`로 고정 서비스 설정과 capability를 마운트하고 각 배포 SHA/lockfile별 DP-06 계획을 자동 생성한다. 공개 종료 날짜나 대시보드 확인 시각을 매일 갱신하지 않는다. 기존 `attested` 모드는 `compose.product.yaml`과 기간 한정 증거/예산을 사용한다. [상시 운영](../docs/continuous-operations.md)을 따른다.

Jenkins 와 수동 `infra/deploy.sh` 가 **같은 러너**를 부른다. 어느 쪽도 `compose up` 을 직접 하지 않고, 현재 체크아웃을 임의 태그로 빌드하지 않는다.

1. **매니페스트** (`scripts/verify-release.mjs`): 검증된 커밋 SHA = 배포 SHA, 웹·서버 두 이미지의 digest 와 `org.opencontainers.image.revision` 라벨, 이전 last-good(태그+digest). 이미지가 없거나 라벨이 다르면 BLOCKED.
2. **외부 격리 확인**: 쿠키 없는 `/api/config` 가 SSO 로 돌아가는지(302/401/403), `/health/live` 200, 익명 `/api/operations/status` 가 200 이 아닌지. 증거가 없으면 BLOCKED. 격리는 GitLab SSO 게이트(DP-03)로 배포 전·중·후 상시 유지된다.
3. **drain**: `POST /api/operations/commands {requestId, action:'drain'}` 202 는 접수일 뿐. 같은 requestId 로 `GET /api/operations/commands/:requestId` 를 backoff 조회해 `succeeded` 를 확인하고, `GET /api/operations/status` 가 admission=DRAINING·unresolvedCount=0 인지 본다. pending/failed/기한 초과면 이미지 교체 0.
4. **교체**: `TAG=<sha8> docker compose -f infra/compose.yaml -f infra/compose.production.yaml up -d`. 실행 중 컨테이너의 이미지 id 가 매니페스트 digest 와 같은지 확인.
5. **ready/복구**: `/health/ready` 200. 503 `recovering` 은 RECOVERING 으로 기다린다. 운영 API 가 있으면 readiness=READY 를 따로 확인(admission 은 아직 DRAINING 이어도 정상).
6. **resume**: 새 requestId 로 `{action:'resume'}` → terminal succeeded → status 가 admission=OPEN·readiness=READY 인지 **별도로** 확인. LOCKED 면 완료 불일치로 실패.
7. **smoke**: 운영 API 있음 → `run-cloud-check.mjs --case DP-06`(preflight 필요, 6인 HTTP 경로). 없음(skeleton) → `deployment-smoke.mjs`(DP-03 HTTP smoke).
8. **공개 재검사**: unresolvedCount 0, READY/OPEN, 매니페스트와 운영 모드 일치. continuous는 공식 잔량/확인 시각이 null인지, attested는 공식 잔량 확인 시각이 `officialBudgetMaxAgeMs` 안인지 확인한다. 아니면 PUBLISH_BLOCKED(새 이미지·격리 유지, 롤백 없음).
9. **기록**: 위를 모두 통과했을 때만 `/opt/kkakkung/last-good-tag`·`last-good-digest`.

실패(교체 이후): 운영 API 가 있으면 **새 requestId 로 다시 drain** 을 완료한 뒤에만, 이전 태그의 이미지 id 가 last-good-digest 와 같을 때만 복귀하고, 복귀 이미지도 4~8 을 다시 통과해야 한다. 이전 기록 없음·digest 불일치·drain 실패·복귀 이미지 ready 실패는 **ROLLBACK_BLOCKED** 로 남기고 강제 교체하지 않는다.

프로필은 명시적으로 선택한다. `skeleton`은 운영·미디어 없는 진단 배포이며 drain/resume은 NOT_RUN, 결과는 `DEPLOYED_WITHOUT_OPERATIONS`다. `product`는 Secret file의 OPS_TOKEN, 검증된 운영 설정과 시험 인증을 사용한다. continuous DP-06 계획은 자동 생성하며 `/opt/kkakkung/cloud-preflight.json`은 attested에서만 필요하다. 성공 결과는 READY다. 단계 기록은 `/opt/kkakkung/releases/<tag>/release.json`, 계약 시험은 `tests/contracts/deployment-sequence.test.ts`를 따른다.

## 브랜치와 배포

`develop` 병합은 배포 파이프라인의 입력이다. 검사·이미지 생성·제품 배포 및 smoke가 성공했는지 해당 SHA의 실행 결과로 확인한다. 병합만으로 실서버 반영을 보고하지 않는다. 서버는 한 대이므로 진단/제품 배포 프로필과 last-good 기록을 확인한다.

## 롤백

```bash
./infra/deploy.sh <이전 커밋 SHA>
```

수동 롤백도 같은 러너다: 그 커밋의 이미지가 이미 있어야 하고(없으면 Jenkins 로 그 커밋을 검증·빌드), drain → 교체 → ready → resume → smoke 를 다시 지난다. `docker compose up` 을 손으로 치지 않는다.

## 비밀값

`.env`, `*.pem` 은 커밋 금지 (루트 `.gitignore`). 운영 비밀값은 `infra/production.env.example` 을 토대로 만든 파일을 Jenkins **Secret file** 크리덴셜 `kkakkung-production-env` 에만 둔다. 배포 때 `/opt/kkakkung/production.env`(600) 로 내려가 `compose.production.yaml` 의 `env_file` 로 game-server 에 주입된다. 이미지·compose·MR·채팅에 값을 쓰지 않는다. 필요하면 인프라에게.

## 자동 배포 시험 인증

DP-06 자동 게임·LiveKit 시험은 개인 SSO 쿠키 대신 호스트 내부 Nginx
`http://127.0.0.1:18081`과 전용 `SMOKE_INTERNAL_TOKEN`을 사용한다.
키는 암호학적 난수 32바이트의 hex 64자리이며 `OPS_TOKEN`과 별개다.
Jenkins `kkakkung-production-env`에 `SMOKE_INTERNAL_TOKEN`과
`SMOKE_INTERNAL_BASE_URL=http://127.0.0.1:18081`을 보관한다.
브라우저 코드, 공개 프록시, Git 저장소에는 키를 넣지 않는다.

호스트 root 전용 키 파일을 준비한 뒤
`node scripts/write-smoke-proxy.mjs /opt/kkakkung/smoke-internal.key /etc/nginx/conf.d/kkakkung-smoke.conf`로
설정을 만들고 `nginx -t` 후 reload한다. 포트는 반드시 loopback에만 바인딩한다.
HTTP와 WebSocket 모두 전용 헤더 인증을 거치며 키 누락·불일치는 403이다.
내부 요청의 X-SSO-User는 제거하고, 시험 참가자는 기존 초대·세션 발급을 거친다.
공개 HTTPS의 SSO는 유지한다. Cloud 시험은 공개 주소의 익명 접근 차단을 별도로 검사한다.
개인 GitLab 로그인 성공은 자동 게임 시험의 검증 범위가 아니며 별도 수동 SSO 점검으로 기록한다.

승인 preflight의 credentialEnvNames에서는 SMOKE_COOKIE를 SMOKE_INTERNAL_TOKEN으로 교체한다.
기존 예산·만료·검증 결과를 갱신한 것으로 간주하지 않는다.
키 교체 시 root 키 파일, 생성 Nginx 설정, Jenkins 환경 파일을 함께 바꾸고 재검증한다.
시험 종료 시 내부 listener를 제거하고 키를 폐기해 회수할 수 있다.
