# infra

배포와 서버 운영. 담당: 정호성 (DevOps).

- `compose.yaml` — 로컬 개발용 (40번에서 작성). 그대로 둡니다.
- `compose.prod.yaml` — **EC2 배포용.** Jenkins 가 빌드한 SHA 태그 이미지를 띄웁니다.
- `docker/` — 이미지 정의. 개발과 배포가 같은 Dockerfile 을 씁니다.
- `nginx/default.conf` — web-proxy **컨테이너 안** nginx. 정적파일 + API + WebSocket 라우팅.
- `nginx/host.conf` — **EC2 호스트** nginx. TLS 종단, `/jenkins`, 나머지는 컨테이너로.
- `jenkins/SETUP.md` — Jenkins 설치·잡 생성 순서.

## 배포가 의존하는 것

파이프라인은 각 패키지 내부를 모릅니다. 아래 항목에만 의존하니 **바꿀 땐 인프라에 미리 알려주세요.**

| 항목                | 현재 값                                                                  | 어디서 쓰나                                                                 |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 런타임              | Node `24.19.0`, pnpm `11.19.0` (`.node-version`, `packageManager`)       | Jenkinsfile `NODE_IMAGE`, `PNPM_VER`, Dockerfile                            |
| 검증                | `pnpm format:check`, `lint`, `typecheck`, `test`                         | Jenkins Verify (e2e 는 아직 제외)                                           |
| 이미지              | `infra/docker/Dockerfile.game-server`, `Dockerfile.web`, 컨텍스트 = 루트 | Jenkins Build                                                               |
| 서버 엔트리         | `dist/main.js` (`pnpm --filter @kkakkung/game-server build`)             | Dockerfile                                                                  |
| 헬스                | `GET /health/live`, `GET /health/ready` (503 → 200)                      | compose healthcheck, Jenkins 배포 확인                                      |
| 서버 환경변수       | `server/src/config/env.ts` 의 zod 스키마                                 | `compose.prod.yaml` environment                                             |
| **NODE_ENV**        | `development` \| `test` 만 허용. **production 은 부팅 거절** (NFR-05)    | 배포도 `development` 로 띄움. production 프로파일 생기면 compose 한 줄 변경 |
| **ALLOWED_ORIGINS** | 정확한 origin 목록. 없는 origin 은 **HTTP 403 / WS 거절**                | `https://j15c204.p.ssafy.io` 를 넣어둠. 도메인 바뀌면 여기                  |
| 웹 빌드             | `apps/web/dist` (Vite)                                                   | Dockerfile.web → nginx 컨테이너                                             |
| 웹 접속 주소        | `VITE_API_BASE_URL`, `VITE_COLYSEUS_URL` **비움** → 같은 origin          | 배포 빌드에 .env 를 넣지 않음                                               |
| Colyseus 경로       | `/matchmake/*`, `/<processId>/<roomId>` (루트 기준)                      | `nginx/default.conf` 가 처리. 프리픽스 없음                                 |

LiveKit 키(`LIVEKIT_*`)는 서버 스키마가 아직 읽지 않아 compose 에 넣지 않았습니다. 서버가 읽기 시작하면 Jenkins 크리덴셜에서 주입합니다.

## 토폴로지 (EC2 한 대)

```
인터넷 :443 ─ 호스트 nginx (TLS) ─┬─ /jenkins            → 127.0.0.1:18080 Jenkins
                                   ├─ /monitor,/playground → 404
                                   └─ /                   → 127.0.0.1:8080 web-proxy 컨테이너
                                                                 ├─ 정적파일
                                                                 └─ /api, /matchmake, WS → game-server:2567 (내부 네트워크)
```

`game-server` 는 호스트 포트를 열지 않습니다. `web-proxy` 는 127.0.0.1 에만 묶습니다.
클라우드 방화벽이 1024~65535 를 열어둬서, `0.0.0.0` 으로 띄우면 UFW 와 무관하게 노출됩니다.

## 파이프라인

```
push → Jenkins
  Prepare       TAG = 커밋 SHA 8자리
  Secret scan   gitleaks (실패 시 중단)
  Verify        pnpm format:check · lint · typecheck · test  (node:24 컨테이너, jenkins uid)
  Build images  kkakkung-game:<TAG>, kkakkung-web:<TAG>
  Scan images   trivy (기록만)
  Deploy        develop 만. compose up → /health/ready 확인 → 실패 시 직전 태그로 롤백
```

## 브랜치와 배포

`develop` 에 머지 = 실서버 배포. `master` 는 발표 스냅샷(Protected). 서버가 한 대라 dev/prod 가 아직 안 나뉘어 있어요.

## 롤백

```bash
docker images kkakkung-game
TAG=<이전SHA> docker compose -f infra/compose.prod.yaml up -d
```

Jenkins 는 성공한 태그를 `/opt/kkakkung/last-good-tag` 에 기록하고, 헬스체크 실패 시 그 태그로 자동 복귀합니다.

## 비밀값

`.env`, `*.pem` 은 커밋 금지 (루트 `.gitignore`). 실제 값은 Jenkins 크리덴셜에만. 필요하면 인프라에게.
