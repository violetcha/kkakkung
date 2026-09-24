> 기준: origin/develop 200d186273d7 (2026-09-24). 이 커밋 이후의 변경은 반영하지 않았다.

# 서버 구현 명세

## 1. 역할과 경계

서버는 HTTP 입장·초대·운영 경계, Colyseus 방과 권위 틱, 공개 상태와 개인 뷰 투영, 운영 영속 상태와 준비(readiness) 판정, 구조화 로그·경보를 소유한다. 제품 방 `kkakkung`은 `@kkakkung/protocol/game-messages`의 0.2.0 계약(`productJoinOptionsSchema`, 명령 envelope)을 받고, 경기 규칙은 `@kkakkung/game-core/match`의 `matchCore`를 `CorePort`로 호출한다. 진단용 `sandbox` 방과 개발 프로필의 팀 방은 0.1.0 계약이며 [11절](#11-01sandbox-진단-경로)에서 따로 다룬다.

`server/src/media/`의 발급·권한·LiveKit·회수 상태기는 [media.md](media.md)가 소유한다. 이 문서는 Room과 bootstrap이 media를 부르는 지점만 적는다([1.2](#12-room과-bootstrap이-media를-부르는-지점)).

import 관계는 다음과 같다.

- 서버는 `@kkakkung/protocol`과 `@kkakkung/game-core`를 import한다. 제품 조립은 `@kkakkung/game-core/match`, sandbox 방은 루트 `@kkakkung/game-core`를 쓴다.
- ESLint에는 server 전용 import 제한 규칙이 없다. 경계는 apps/web 규칙이 `**/server/**`, `@kkakkung/game-core`, `**/packages/game-core/**` import를 막는 쪽에서만 강제된다.

| 경계      | 서버가 하는 일                                                                                                                                                | 반대편 소유                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| protocol  | 0.2 요청·명령을 검증하고 공개 상태·개인 뷰·명령 결과를 보낸다                                                                                                 | 메시지 형상·Schema·코드 집합은 [protocol.md](protocol.md) |
| game-core | `createPractice`, `createMatch`, `stepMatch`, `getFrame`, `getPlayerSelf`, `getPlayerKnowledge`, `getVisibleEntities`, `getVisibleSurfaces`를 틱에서 호출한다 | 규칙·튜닝·맵 의미는 [game-core.md](game-core.md)          |
| media     | Room이 연습·경기 인스턴스마다 `mediaInstanceId`를 만들고, 준비·회수 결과를 직렬 틱에 반영한다                                                                 | 발급·권한·재시도는 [media.md](media.md)                   |
| web       | HTTP 세션과 Room 공개/개인 상태를 제공한다                                                                                                                    | 화면·입력·브라우저 저장은 [web.md](web.md)                |
| infra     | `server/.env`를 읽고 `SERVER_PROFILE`로 조립을 고른다                                                                                                         | 배포·compose·nginx는 [infra.md](infra.md)                 |

근거: [KkakkungRoom.ts:51](../../server/src/rooms/KkakkungRoom.ts#L51), [ProductProfileLoader.ts:14](../../server/src/game/ProductProfileLoader.ts#L14), [GameRoom.ts:8](../../server/src/rooms/GameRoom.ts#L8), [eslint.config.mjs:47](../../eslint.config.mjs#L47), [eslint.config.mjs:53](../../eslint.config.mjs#L53), [ports.ts:187](../../server/src/game/ports.ts#L187), [MatchDriver.ts:259](../../server/src/game/MatchDriver.ts#L259), [KkakkungRoom.ts:1668](../../server/src/rooms/KkakkungRoom.ts#L1668), [KkakkungRoom.ts:1834](../../server/src/rooms/KkakkungRoom.ts#L1834).

### 1.2 Room과 bootstrap이 media를 부르는 지점

| 호출 지점                                                 | 언제                                     | 서버 쪽 처리                                          |
| --------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `createMediaCoordinator`                                  | 제품 프로필에서 `cloudConfigured`일 때만 | 없으면 media는 `null`                                 |
| `media.initialize()`                                      | `listen()` 직전                          | `fatal`이면 `MEDIA_INITIALIZATION_<code>`로 기동 실패 |
| `media.getOperations()`, `getReadiness()`, `canIssue()`   | 입장·초대·명령 준비 문                   | [2.2](#22-준비-문)                                    |
| `media.createOperationsHandlers(authorize)`               | 운영 HTTP 등록                           | [6.1](#61-운영-http와-인증)                           |
| `media.handleWebhook(raw, authorization)`                 | `POST /api/livekit/webhook`              | 결과를 200으로 그대로 반환                            |
| `room.requestMediaGrant` → `media.prepareGeneration`      | `POST /api/media/grants`                 | 결과는 `MEDIA_PREPARED` 제어로 다음 틱에 반영         |
| `room.acceptMediaReport` → `media.lifecycle.report`       | `POST /api/media/report`                 | 현재 인스턴스·세대가 맞을 때만                        |
| `media.retireGeneration`                                  | 인스턴스 회수·연결 끊김                  | 결과는 `MEDIA_RETIRED` 제어                           |
| `media.observeFrame`                                      | 매 틱, media 인스턴스가 있는 스텝        | 신뢰 프레임 전달                                      |
| `media.lifecycle.setGameConnection`                       | 입장·끊김·새 라운드                      | 연결 상태 통지                                        |
| `media.releaseMatch(matchId)`                             | 새 라운드·방 소멸                        | 이전 경기 반환                                        |
| `media.allowsNewMatch()`                                  | 연습 시작, `/api/capacity`               | 월 사용량 문                                          |
| `enqueueControl`, `enqueueBindings`, `enqueueAudioPolicy` | media → Room                             | `matchId`로 방을 찾아 큐에 넣고 틱에서 적용           |

근거: [ProductProfileLoader.ts:113](../../server/src/game/ProductProfileLoader.ts#L113), [bootstrap.ts:301](../../server/src/bootstrap.ts#L301), [bootstrap.ts:306](../../server/src/bootstrap.ts#L306), [bootstrap.ts:356](../../server/src/bootstrap.ts#L356), [bootstrap.ts:529](../../server/src/bootstrap.ts#L529), [bootstrap.ts:663](../../server/src/bootstrap.ts#L663), [KkakkungRoom.ts:485](../../server/src/rooms/KkakkungRoom.ts#L485), [KkakkungRoom.ts:534](../../server/src/rooms/KkakkungRoom.ts#L534), [KkakkungRoom.ts:382](../../server/src/rooms/KkakkungRoom.ts#L382), [KkakkungRoom.ts:2038](../../server/src/rooms/KkakkungRoom.ts#L2038), [KkakkungRoom.ts:2149](../../server/src/rooms/KkakkungRoom.ts#L2149), [KkakkungRoom.ts:1635](../../server/src/rooms/KkakkungRoom.ts#L1635), [bootstrap.ts:226](../../server/src/bootstrap.ts#L226), [bootstrap.ts:493](../../server/src/bootstrap.ts#L493), [KkakkungRoom.ts:718](../../server/src/rooms/KkakkungRoom.ts#L718).

## 2. 기동과 조립

### 2.1 프로필과 조립

1. `main.ts`가 `server/.env`가 있으면 읽는다. 이어 `parseConfig(process.env)`로 설정을 검사한다.
2. `SERVER_PROFILE=product`면 `loadProductProfile`로 제품 프로필을 만들고, `development`면 프로필 없이 skeleton 앱을 만든다.
3. 제품 프로필은 다음과 같이 조립된다.
   - `strictProduct: true`다.
   - 튜닝 JSON은 `validateTuning`을 통과해야 한다. 실패하면 `INVALID_PRODUCT_TUNING`, 읽기 실패는 `PRODUCT_CONTENT_UNAVAILABLE`로 기동이 실패한다.
   - 기본 맵은 `maps/<PRODUCT_MAP_TEMPLATE>.json`과 `placements/<id>-fallback.json`이다. master에 `templateId`·`templateVersion` 문자열이 없으면 `INVALID_PRODUCT_MAP_SOURCE`로 실패한다.
   - 크기별 템플릿 `small`→`maze-s-v1`, `medium`→`maze-m-v1`, `large`→`maze-v1`을 읽는다. 읽지 못한 크기는 기본 맵으로 간다.
   - 연습 맵은 `maps/practice-v1.json`이다.
4. media coordinator는 `cloudConfigured`일 때만 만든다. 조건은 `MEDIA_MODE=livekit` ∧ `LIVEKIT_PROJECT_ALIAS` ∧ (continuous ∨ `OPS_OFFICIAL_BUDGET_MAX_AGE_MS`) ∧ `OPS_OPERATION_TIMEOUT_MS` ∧ API 한도 그룹이다.
   - 이때 `runtime-evidence.json`(continuous면 `service-operations.json`)을 읽는 증거 로더도 붙는다.
   - media 동시 참가자 한도는 `MAX_SLOTS + SHOWCASE_ROOMS × 4`다.
5. **제품 프로필인데 media가 없으면** `admission()`이 항상 `LOCKED`, readiness도 `LOCKED`다. 따라서 세션 발급·초대 발급·시연 방·일반 방 입장은 모두 닫히고, media를 쓰지 않는 데모 방만 열린다. 시험은 이 상태에서 `/health/ready`가 `readiness: 'LOCKED', admission: 'LOCKED'`를 보이는지 확인한다.
6. `listen()` 순서는 다음과 같다.
   1. media가 있으면 `initialize()`한다. 월 사용량 가드가 켜져 있으면 info 로그를, 꺼져 있으면 warn 로그를 남긴다.
   2. `server.listen(PORT, HOST)` 뒤 HTTP 외부 경계를 설치한다.
   3. 10ms 틱 coordinator 구동, 1초 예약 정리 루프(예약 정리·초대 만료), 1초 계측 루프를 시작한다. 계측 루프는 프로세스 표본, `http.requests.*`, metric drain과 경보 평가, readiness 경보, notifier flush를 돈다.
   4. 이후 `ready=true`가 된다.
   - 준비 중 예외가 나면 media와 제품 리소스를 닫고 다시 던진다.
7. 미포착 예외와 거부된 promise는 `process.fault` 이벤트와 fatal 로그를 남긴다. 이어 `close()`를 한 번 시도하고 exit 1로 끝난다. close가 10초 안에 끝나지 않으면 강제로 exit 1이다. SIGINT·SIGTERM은 `close()`만 부른다.

근거: [main.ts:10](../../server/src/main.ts#L10), [main.ts:14](../../server/src/main.ts#L14), [ProductProfileLoader.ts:30](../../server/src/game/ProductProfileLoader.ts#L30), [ProductProfileLoader.ts:38](../../server/src/game/ProductProfileLoader.ts#L38), [ProductProfileLoader.ts:52](../../server/src/game/ProductProfileLoader.ts#L52), [ProductProfileLoader.ts:64](../../server/src/game/ProductProfileLoader.ts#L64), [map-templates.ts:11](../../server/src/game/map-templates.ts#L11), [ProductProfileLoader.ts:73](../../server/src/game/ProductProfileLoader.ts#L73), [ProductProfileLoader.ts:93](../../server/src/game/ProductProfileLoader.ts#L93), [ProductProfileLoader.ts:162](../../server/src/game/ProductProfileLoader.ts#L162), [ProductProfileLoader.ts:171](../../server/src/game/ProductProfileLoader.ts#L171), [RuntimeEvidence.ts:183](../../server/src/config/RuntimeEvidence.ts#L183), [bootstrap.ts:227](../../server/src/bootstrap.ts#L227), [bootstrap.ts:236](../../server/src/bootstrap.ts#L236), [product-profile.test.ts:186](../../server/test/room/product-profile.test.ts#L186), [bootstrap.ts:665](../../server/src/bootstrap.ts#L665), [bootstrap.ts:685](../../server/src/bootstrap.ts#L685), [bootstrap.ts:692](../../server/src/bootstrap.ts#L692), [bootstrap.ts:722](../../server/src/bootstrap.ts#L722), [bootstrap.ts:724](../../server/src/bootstrap.ts#L724), [bootstrap.ts:731](../../server/src/bootstrap.ts#L731), [bootstrap.ts:652](../../server/src/bootstrap.ts#L652), [process-guard.ts:33](../../server/src/process-guard.ts#L33), [main.ts:24](../../server/src/main.ts#L24).

### 2.2 준비 문

| 이름                    | 참 조건                                                                               | 쓰는 곳                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `admission()`           | media 있으면 운영 상태의 admission. 없으면 strict는 `LOCKED`, 비엄격은 개발 훅 값     | 세션 발급, 방장 초대, `/api/capacity`                                                   |
| `readinessState()`      | media 있으면 media readiness. 없으면 비엄격+개발 훅이면 `READY`, 그 밖은 `LOCKED`     | `/health/ready` 대체 경로, readiness 경보                                               |
| `operationsReady()`     | readiness `READY` ∧ admission `OPEN` ∧ (strict면 `media.canIssue()`)                  | 운영 초대 발급, 시연 방 발급, onAuth/onJoin, 연습 시작, 카운트다운, 재경기, media grant |
| `demoOperationsReady()` | media 없음 ∨ admission `OPEN`                                                         | 데모 방의 onAuth/onJoin·연습·카운트다운·재경기                                          |
| `productSecurityReady`  | `OPS_TOKEN` ∧ 운영 인증 조립 ∧ 입장 시도 한도 ∧ `INVITE_MAX_TTL_MS` ∧ origin 1개 이상 | media 설정으로 전달, readiness `PRODUCT_SECURITY_UNCONFIRMED` 판정                      |

근거: [bootstrap.ts:225](../../server/src/bootstrap.ts#L225), [bootstrap.ts:231](../../server/src/bootstrap.ts#L231), [bootstrap.ts:237](../../server/src/bootstrap.ts#L237), [bootstrap.ts:246](../../server/src/bootstrap.ts#L246), [bootstrap.ts:247](../../server/src/bootstrap.ts#L247), [bootstrap.ts:599](../../server/src/bootstrap.ts#L599), [KkakkungRoom.ts:226](../../server/src/rooms/KkakkungRoom.ts#L226).

## 3. 설정(환경 변수)

빈 문자열은 미설정으로 본다. Zod 검사가 실패하면 이름만 담은 오류로 기동을 거절한다. 그룹 변수는 전부 있거나 전부 없어야 하며, 일부만 있으면 `Incomplete <그룹> configuration`으로 거절한다. 비밀 값은 적지 않는다. 실서버 값은 저장소 밖이라 확인할 수 없다.

| 환경 변수                                                                             | 허용값·기본값                                                                                                      | 교차 검증                                                                                                                                                                            | 실제 사용처                                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                            | `development`/`test`, 기본 `development`                                                                           | `production`은 스키마에서 거절                                                                                                                                                       | 없음(검사만)                                                                                          |
| `SERVER_PROFILE`                                                                      | `development`/`product`, 기본 `development`                                                                        | product면 입장 정책 그룹 필수. development에서 `MEDIA_MODE=livekit` 거절                                                                                                             | 제품 프로필 조립 여부                                                                                 |
| `TRUST_PROXY_HOPS`                                                                    | 0–1, 기본 0                                                                                                        | audience 지정 또는 SSO면 1 필수                                                                                                                                                      | 1이면 `trustProxy`: Express `trust proxy`, `X-Forwarded-For` 첫 값, `X-SSO-User`, `X-Demo-Admin` 수용 |
| `SERVICE_AUDIENCE`                                                                    | `team`/`public`, 옵션                                                                                              | team→`gitlab-sso`, public→`guest`. `SESSION_ADMISSION_MODE`와 다르면 거절. 지정 시 product+hops 1 필수                                                                               | 입장 방식 결정                                                                                        |
| `SESSION_ADMISSION_MODE`                                                              | `invitation`/`gitlab-sso`/`guest`, 옵션. 둘 다 없으면 `invitation`                                                 | guest는 `SERVICE_AUDIENCE=public` 명시 필수. gitlab-sso는 product+hops 1 필수                                                                                                        | `/api/sessions` 자격 판정                                                                             |
| `PRODUCT_ASSET_VERSION`                                                               | 기본 `c-primitives-1`                                                                                              | —                                                                                                                                                                                    | 로딩 뷰의 `assetVersion`                                                                              |
| `PRODUCT_CONTENT_DIR`                                                                 | 기본 `server/content`                                                                                              | —                                                                                                                                                                                    | 맵·배치·연습 JSON 경로                                                                                |
| `PRODUCT_TUNING_PATH`                                                                 | 기본 `server/config/tuning/mvp-v1.json`                                                                            | —                                                                                                                                                                                    | 튜닝 JSON                                                                                             |
| `PRODUCT_MAP_TEMPLATE`                                                                | `^[a-z0-9-]+$`, 기본 `maze-v1`                                                                                     | —                                                                                                                                                                                    | 크기를 고르지 않은 방의 맵                                                                            |
| `HOST` / `PORT`                                                                       | 기본 `127.0.0.1` / 2567(1–65535)                                                                                   | —                                                                                                                                                                                    | `server.listen`                                                                                       |
| `ALLOWED_ORIGINS`                                                                     | 쉼표 목록, 기본 `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:2567`, `http://127.0.0.1:2567` | 각 값이 http(s)이고 `new URL(s).origin`과 같아야 함                                                                                                                                  | HTTP·WebSocket origin 검사, CORS                                                                      |
| `SERVICE_NAMESPACE`                                                                   | `^[a-z0-9-]+$`, 기본 `kkakkung-local`                                                                              | —                                                                                                                                                                                    | 로그 `base.service`, media namespace, 경보 문구                                                       |
| `MEDIA_MODE`                                                                          | `disabled`/`livekit`, 기본 `disabled`                                                                              | livekit이면 LiveKit 그룹·alias·`OPS_TOKEN`·공개창(attested)·예산 최신성(attested)·operation timeout·API 한도 필수. URL은 HTTPS/WSS 같은 host, 경로 `/`, 인증정보·query·fragment 금지 | `cloudConfigured`                                                                                     |
| `MEDIA_SUBSCRIPTION_MODE`                                                             | `server-controlled`/`publisher-permissions`, 기본 `server-controlled`                                              | public+livekit이면 `publisher-permissions` 필수                                                                                                                                      | media 설정, readiness capability 대조                                                                 |
| `MAX_ROOMS`                                                                           | 1–10, 기본 1                                                                                                       | —                                                                                                                                                                                    | 동시에 진행하는 일반 경기(연습~PLAYING) 수                                                            |
| `MAX_SLOTS`                                                                           | 6–60, 기본 6                                                                                                       | `MAX_ROOMS × 6`과 같아야 함                                                                                                                                                          | media 동시 참가자 한도(`+ SHOWCASE_ROOMS×4`)에만 쓰임. 좌석 등록부는 쓰지 않음                        |
| `LOBBY_MAX_ROOMS`                                                                     | 1–50, 옵션(없으면 `MAX_ROOMS`)                                                                                     | `MAX_ROOMS` 이상                                                                                                                                                                     | 동시에 열어 둘 수 있는 일반 방 수. 좌석 총량 `×6`                                                     |
| `MAX_ROOMS_PER_ORIGIN`                                                                | 1–10, 기본 2                                                                                                       | `MAX_ROOMS>1`이면 `MAX_ROOMS` 미만                                                                                                                                                   | 게스트 방 생성의 출처당 상한                                                                          |
| `MAX_ROOMS_PER_ACCOUNT`                                                               | 1–10, 기본 1                                                                                                       | `MAX_ROOMS>1`이면 `MAX_ROOMS` 미만                                                                                                                                                   | SSO 계정당 방 생성 상한                                                                               |
| `OPS_DATA_DIR`                                                                        | 기본 `./.local/operations`                                                                                         | —                                                                                                                                                                                    | 운영 영속 파일 디렉터리([7절](#7-운영-영속-상태와-복구))                                              |
| `LOG_LEVEL`                                                                           | `trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent`, 기본 `info`                                                | —                                                                                                                                                                                    | pino 레벨                                                                                             |
| `LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`         | http(s) URL, ws(s) URL, 비어 있지 않은 값                                                                          | 네 값 그룹                                                                                                                                                                           | media.md                                                                                              |
| `LIVEKIT_PROJECT_ALIAS`                                                               | `^[a-z0-9-]+$`, 옵션                                                                                               | livekit이면 필수                                                                                                                                                                     | media 설정, 증거 파일 대조                                                                            |
| `OPS_TOKEN`                                                                           | 비어 있지 않은 값                                                                                                  | `DEMO_ROOMS=1`은 이것이 있어야 켜짐                                                                                                                                                  | 운영 Bearer. `^[A-Za-z0-9._~+/-]+=*$`이고 앞뒤 공백이 없어야 유효하며, 아니면 모든 운영 인증이 거절됨 |
| `ALERT_WEBHOOK_URL`                                                                   | http(s) URL, 옵션                                                                                                  | https만, username·password·fragment 금지                                                                                                                                             | 경보 notifier                                                                                         |
| `ALERT_WEBHOOK_CHANNEL`                                                               | `^@?[a-z0-9][a-z0-9._-]{0,63}$`, 옵션                                                                              | URL 없이 설정하면 거절                                                                                                                                                               | webhook 본문 `channel`                                                                                |
| `DEMO_ROOMS`                                                                          | `0`/`1`, 기본 `0`                                                                                                  | `OPS_TOKEN` 없으면 꺼진 것으로 봄                                                                                                                                                    | 데모 라우트 등록                                                                                      |
| `DEMO_ADMISSION_TTL_MS`                                                               | 양의 정수, 기본 600,000                                                                                            | —                                                                                                                                                                                    | 데모·시연 세션의 첫 접속 기한                                                                         |
| `DEMO_MAX_ROOMS`                                                                      | 1–3, 기본 1                                                                                                        | —                                                                                                                                                                                    | 데모 방 동시 수                                                                                       |
| `SHOWCASE_ROOMS`                                                                      | 0–10, 기본 1                                                                                                       | —                                                                                                                                                                                    | 시연 방 동시 사용 수. 0이면 시연 발급 503                                                             |
| `DEMO_ADMIN_EMAILS_FILE`                                                              | 경로, 옵션                                                                                                         | 없는데 데모·시연이 켜져 있으면 warn 로그                                                                                                                                             | `X-Demo-Admin` 운영자 목록                                                                            |
| `LIVEKIT_MONTHLY_MINUTES`, `LIVEKIT_USAGE_BASELINE`                                   | 양의 정수 / `<분>@<ISO 시각>`, 옵션                                                                                | 함께 설정해야 함. baseline 형식 `^(\d+)@(.+)$`에 `Date.parse` 가능                                                                                                                   | 월 사용량 가드(media.md)                                                                              |
| `LIVEKIT_MONTHLY_RESERVE_MINUTES`                                                     | 0 이상, 기본 300                                                                                                   | —                                                                                                                                                                                    | 월 사용량 가드 여유분                                                                                 |
| `LIVEKIT_BILLING_CYCLE_DAY`                                                           | 1–28, 기본 1                                                                                                       | —                                                                                                                                                                                    | 월 사용량 가드 주기                                                                                   |
| `OPS_OPERATING_MODE`                                                                  | `attested`/`continuous`, 기본 `attested`                                                                           | continuous면 공개창 대신 `{mode:'continuous'}`, 예산 최신성 0                                                                                                                        | 공개창·예산 정책                                                                                      |
| `OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS`, `OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS`         | 양의 정수, 옵션                                                                                                    | 두 값 그룹, 시작<종료                                                                                                                                                                | 초대 발급 창, resume 조건                                                                             |
| `OPS_OFFICIAL_BUDGET_MAX_AGE_MS`                                                      | 양의 정수, 옵션                                                                                                    | livekit+attested에서 필수                                                                                                                                                            | 공식 예산 체크포인트 최신성                                                                           |
| `OPS_OPERATION_TIMEOUT_MS`                                                            | 양의 정수, 옵션                                                                                                    | livekit에서 필수                                                                                                                                                                     | 운영 명령 기본 기한                                                                                   |
| `MEDIA_MAX_NORMAL_API_CALLS_PER_60S`, `MEDIA_MAX_TOTAL_API_CALLS_PER_60S`             | 양의 정수, 각각 6,000·9,000 이하                                                                                   | 두 값 그룹, normal≤total, livekit이면 필수                                                                                                                                           | media API 예산, 경보 total 상한                                                                       |
| `INVITE_MAX_TTL_MS`                                                                   | 양의 정수, 옵션                                                                                                    | 입장 정책 그룹(product 필수)                                                                                                                                                         | 운영 초대 만료 상한, 방장 초대는 `min(10분, 값)`                                                      |
| `SESSION_ATTEMPT_WINDOW_MS`, `SESSION_ATTEMPTS_PER_INVITE`, `SESSION_ATTEMPTS_PER_IP` | 양의 정수, 옵션                                                                                                    | 입장 정책 그룹                                                                                                                                                                       | 입장 시도 한도 세 겹([4.3](#43-속도-제한-층))                                                         |
| `ROOM_IDLE_TTL_MS`                                                                    | 양의 정수, 옵션                                                                                                    | 입장 정책 그룹                                                                                                                                                                       | LOBBY 무활동 만료                                                                                     |

근거: [env.ts:39](../../server/src/config/env.ts#L39), [env.ts:41](../../server/src/config/env.ts#L41), [env.ts:59](../../server/src/config/env.ts#L59), [env.ts:71](../../server/src/config/env.ts#L71), [env.ts:76](../../server/src/config/env.ts#L76), [env.ts:106](../../server/src/config/env.ts#L106), [env.ts:114](../../server/src/config/env.ts#L114), [env.ts:132](../../server/src/config/env.ts#L132), [env.ts:141](../../server/src/config/env.ts#L141), [env.ts:164](../../server/src/config/env.ts#L164), [env.ts:179](../../server/src/config/env.ts#L179), [env.ts:195](../../server/src/config/env.ts#L195), [env.ts:197](../../server/src/config/env.ts#L197), [env.ts:198](../../server/src/config/env.ts#L198), [env.ts:201](../../server/src/config/env.ts#L201), [env.ts:208](../../server/src/config/env.ts#L208), [env.ts:219](../../server/src/config/env.ts#L219), [env.ts:226](../../server/src/config/env.ts#L226), [env.ts:230](../../server/src/config/env.ts#L230), [env.ts:232](../../server/src/config/env.ts#L232), [env.ts:238](../../server/src/config/env.ts#L238), [env.ts:242](../../server/src/config/env.ts#L242), [env.ts:254](../../server/src/config/env.ts#L254), [env.ts:258](../../server/src/config/env.ts#L258), [env.ts:274](../../server/src/config/env.ts#L274), [env.ts:285](../../server/src/config/env.ts#L285), [env.ts:300](../../server/src/config/env.ts#L300), [env.ts:303](../../server/src/config/env.ts#L303), [env.ts:306](../../server/src/config/env.ts#L306), [env.ts:325](../../server/src/config/env.ts#L325), [env.ts:370](../../server/src/config/env.ts#L370), [env.ts:381](../../server/src/config/env.ts#L381), [ApiBudget.ts:6](../../server/src/operations/ApiBudget.ts#L6), [OperatorAuth.ts:8](../../server/src/operations/OperatorAuth.ts#L8), [ProductProfileLoader.ts:109](../../server/src/game/ProductProfileLoader.ts#L109), [bootstrap.ts:444](../../server/src/bootstrap.ts#L444), [RoomInvitations.ts:23](../../server/src/session/RoomInvitations.ts#L23), [RoomExpiry.ts:34](../../server/src/session/RoomExpiry.ts#L34).

## 4. HTTP

### 4.1 요청 경계와 순서

`listen()` 뒤 `installHttpBoundary`가 기존 request 리스너를 전부 감싼다. 이 경계는 Colyseus `/matchmake/*`, OPTIONS, Express보다 먼저 실행된다. 경로는 query를 뗀 뒤 소문자로 비교한다.

1. **속도 검사**: 제품 HTTP 한도, 그다음 `/api/sessions*`·`/matchmake/*`의 출처 시도 한도를 본다([4.3](#43-속도-제한-층)). 실패하면 429다.
2. **Origin 검사**: 헤더가 없으면 허용한다. 있으면 `ALLOWED_ORIGINS`의 한 값과 정확히 같아야 한다. 배열, 빈 값, `null`, 쉼표, 공백이 들어간 값은 거절이다.
3. **본문 검사**: GET·HEAD·OPTIONS가 아니고 경로가 `/matchmake/` 또는 `/api/`로 시작하면 적용한다. 단 `/api/livekit/webhook`은 제외한다.
   - 선언 길이와 실제 수신 바이트가 모두 2,048을 넘으면 안 된다.
   - 5초 안에 본문이 끝나야 한다.
   - `application/json`이면 해석하고, 빈 본문은 `{}`로 본다.
4. **Express**: 순서는 다음과 같다.
   1. `x-powered-by` 끔
   2. origin 재검사
   3. CORS(`ALLOWED_ORIGINS`)
   4. webhook raw text 파서(256kb)
   5. JSON 파서(2kb)
   6. `trust proxy` 1(trustProxy일 때)
   7. 라우트
   8. 오류 처리기

WebSocket upgrade도 같은 origin 규칙을 쓰고, 한 메시지 payload 상한은 8,192바이트다.

| 거절 위치             | 조건                                           | 응답                               |
| --------------------- | ---------------------------------------------- | ---------------------------------- |
| 외부 경계 속도        | [4.3](#43-속도-제한-층)의 요청 수·동시 수 초과 | 429 `RATE_LIMITED`                 |
| 외부 경계 origin      | 위 거절 조건                                   | 403 `ORIGIN_NOT_ALLOWED`           |
| 외부 경계 본문        | 2,048바이트 초과(선언 또는 실제)               | 413 `PAYLOAD_TOO_LARGE`, 연결 파기 |
| 외부 경계 본문        | 5초 안에 본문 미완료                           | 408 `BODY_TIMEOUT`, 연결 닫음      |
| 외부 경계 JSON        | 구문 오류                                      | 400 `INVALID_JSON`                 |
| 외부 경계 스트림      | 요청 스트림 오류                               | 400 `INVALID_REQUEST`              |
| 외부 경계 하위 리스너 | 동기 예외                                      | 500 `INTERNAL_ERROR`               |
| Express origin        | 비허용 origin                                  | 403 `{error:'ORIGIN_NOT_ALLOWED'}` |
| Express 오류 처리기   | 파서·라우트가 오류를 넘김                      | 400 `INVALID_REQUEST`              |
| WebSocket upgrade     | 비허용 origin                                  | 403, 본문 없음                     |

외부 경계의 모든 거절은 `cache-control: no-store`와 JSON `{error}`로 답하고, warn 로그를 남긴다.

근거: [HttpBoundary.ts:17](../../server/src/session/HttpBoundary.ts#L17), [HttpBoundary.ts:27](../../server/src/session/HttpBoundary.ts#L27), [HttpBoundary.ts:49](../../server/src/session/HttpBoundary.ts#L49), [HttpBoundary.ts:59](../../server/src/session/HttpBoundary.ts#L59), [HttpBoundary.ts:62](../../server/src/session/HttpBoundary.ts#L62), [HttpBoundary.ts:73](../../server/src/session/HttpBoundary.ts#L73), [HttpBoundary.ts:78](../../server/src/session/HttpBoundary.ts#L78), [HttpBoundary.ts:80](../../server/src/session/HttpBoundary.ts#L80), [HttpBoundary.ts:87](../../server/src/session/HttpBoundary.ts#L87), [HttpBoundary.ts:94](../../server/src/session/HttpBoundary.ts#L94), [HttpBoundary.ts:100](../../server/src/session/HttpBoundary.ts#L100), [HttpBoundary.ts:115](../../server/src/session/HttpBoundary.ts#L115), [HttpBoundary.ts:154](../../server/src/session/HttpBoundary.ts#L154), [HttpBoundary.ts:168](../../server/src/session/HttpBoundary.ts#L168), [bootstrap.ts:340](../../server/src/bootstrap.ts#L340), [bootstrap.ts:343](../../server/src/bootstrap.ts#L343), [bootstrap.ts:348](../../server/src/bootstrap.ts#L348), [bootstrap.ts:352](../../server/src/bootstrap.ts#L352), [bootstrap.ts:360](../../server/src/bootstrap.ts#L360), [bootstrap.ts:361](../../server/src/bootstrap.ts#L361), [bootstrap.ts:557](../../server/src/bootstrap.ts#L557), [bootstrap.ts:151](../../server/src/bootstrap.ts#L151), [bootstrap.ts:702](../../server/src/bootstrap.ts#L702), [bootstrap.ts:720](../../server/src/bootstrap.ts#L720).

### 4.2 출처 키

속도 제한과 게스트 방 상한은 요청 주소를 "출처 키"로 접어서 센다.

- `trustProxy`일 때만 `X-Forwarded-For`의 첫 값을 읽고, 그 밖에는 소켓 주소를 쓴다.
- IPv4-mapped IPv6(`::ffff:a.b.c.d`)는 IPv4로 되돌린다.
- IPv6는 앞 4그룹 `/64`로 접는다.
- 대괄호와 zone id는 뗀다. 알아볼 수 없는 표기는 그대로 둔다.

근거: [client-origin.ts:21](../../server/src/session/client-origin.ts#L21), [client-origin.ts:61](../../server/src/session/client-origin.ts#L61), [client-origin.ts:66](../../server/src/session/client-origin.ts#L66), [client-origin.ts:76](../../server/src/session/client-origin.ts#L76).

### 4.3 속도 제한 층

| 층                         | 적용 경로                                                                                               | 키                                                      | 한도                                                                 | 거절                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| 제품 HTTP 한도 · 권한 없음 | `/api/operations`, `/api/operations/*`, `/api/media/grants`, `/api/media/report`에서 인증되지 않은 요청 | 출처 키                                                 | 1초 창에 키당 5, 전체 20, 동시 4, 처리 중 작업 4                     | 429 `RATE_LIMITED`                           |
| 제품 HTTP 한도 · 운영      | 위 운영 경로에서 운영 Bearer가 맞는 요청                                                                | 단일 키                                                 | 키당 60, 전체 120, 동시 16, 작업 16                                  | 429                                          |
| 제품 HTTP 한도 · media     | 위 media 경로에서 제품 세션이 맞는 요청                                                                 | 세션                                                    | 키당 12, 전체 240, 동시 128, 작업 128                                | 429                                          |
| 입구 시도 한도             | `/api/sessions`로 시작하는 경로와 `/matchmake/`                                                         | 출처 키                                                 | `SESSION_ATTEMPT_WINDOW_MS` 창에 `SESSION_ATTEMPTS_PER_IP × 4`       | 외부 경계 429                                |
| 세션 라우터 앞단           | `/api/sessions` 하위 전부                                                                               | 출처 키                                                 | 창당 `SESSION_ATTEMPTS_PER_IP`                                       | 429 `RATE_LIMITED`, `Retry-After`=창 초 올림 |
| 입장 시도                  | `POST /api/sessions`                                                                                    | SSO 계정 해시 / 게스트 출처 해시 / 초대 ID, 그리고 출처 | 키당 `SESSION_ATTEMPTS_PER_INVITE`, 출처당 `SESSION_ATTEMPTS_PER_IP` | 429 `RATE_LIMITED`                           |
| 방장 초대                  | `/api/sessions/current/invitation`                                                                      | `host-invite:<세션>`과 출처                             | 위와 같은 한도                                                       | 429 `RATE_LIMITED`                           |

- 모든 층의 키 수 상한은 4,096이다. 가득 찬 뒤 새 키는 거절된다.
- 거절된 요청은 시각을 기록하지 않는다.
- OPTIONS는 제품 HTTP 한도를 건너뛴다.
- 4,096자를 넘는 `Authorization` 헤더는 없는 것으로 본다.
- "처리 중 작업" 한도는 handler 실행을 감싸는 별도 계수다. 초과하면 429 `RATE_LIMITED`와 `Cache-Control: no-store`로 답한다.

근거: [ProductHttpLimiter.ts:5](../../server/src/session/ProductHttpLimiter.ts#L5), [ProductHttpLimiter.ts:23](../../server/src/session/ProductHttpLimiter.ts#L23), [ProductHttpLimiter.ts:43](../../server/src/session/ProductHttpLimiter.ts#L43), [ProductHttpLimiter.ts:45](../../server/src/session/ProductHttpLimiter.ts#L45), [ProductHttpLimiter.ts:49](../../server/src/session/ProductHttpLimiter.ts#L49), [ProductHttpLimiter.ts:96](../../server/src/session/ProductHttpLimiter.ts#L96), [bootstrap.ts:278](../../server/src/bootstrap.ts#L278), [bootstrap.ts:705](../../server/src/bootstrap.ts#L705), [SessionRoutes.ts:72](../../server/src/session/SessionRoutes.ts#L72), [SessionRoutes.ts:85](../../server/src/session/SessionRoutes.ts#L85), [SessionRoutes.ts:204](../../server/src/session/SessionRoutes.ts#L204), [SessionRoutes.ts:126](../../server/src/session/SessionRoutes.ts#L126), [AdmissionLimiter.ts:34](../../server/src/session/AdmissionLimiter.ts#L34), [AdmissionLimiter.ts:68](../../server/src/session/AdmissionLimiter.ts#L68).

### 4.4 제품 세션·초대·용량 경로

이 경로들은 제품 프로필에서만 등록된다. 모든 응답에 `Cache-Control: no-store`를 붙인다(`/api/capacity` 포함).

| 메서드·경로                               | 인증·요청                                                                                                                          | 성공                                                                                                                                                                                                                                 | 거절 → 응답                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/sessions/access`                | `gitlab-sso`+trustProxy일 때 단일 `X-SSO-User`(`^[A-Za-z0-9_.@-]{1,255}$`)                                                         | 200 `{method}`: guest 모드면 `guest`, 유효한 SSO 헤더면 `gitlab-sso`, 그 밖은 `invitation`. `Vary: X-SSO-User`                                                                                                                       | 없음                                                                                                                                                                                                                               |
| POST `/api/sessions`                      | strict union `{nickname(1–20), inviteToken?(16–512), createRoom:true}` 또는 `{…, createRoom:false, roomCode(^[A-HJ-NP-Z2-9]{6}$)}` | 201 `{sessionToken, playerId, roomCode, expiresAt, protocolVersion:'0.2.0'}`                                                                                                                                                         | 아래 표                                                                                                                                                                                                                            |
| DELETE `/api/sessions/current`            | `Bearer`, 빈 본문(`{}`만 허용)                                                                                                     | 204. 만료·취소된 토큰도 예약 정리 후 204                                                                                                                                                                                             | 본문 400 `INVALID_REQUEST`, Bearer 없음 401 `INVALID_SESSION`, 연결 중이거나 자리 JOINED/RETIRING이면 409 `SESSION_IN_USE`                                                                                                         |
| POST `/api/sessions/current/invitation`   | 방장 `Bearer`, 빈 본문                                                                                                             | 201 `{inviteToken, roomCode, expiresAt}`. 만료는 `min(10분, INVITE_MAX_TTL_MS)`. 이전 링크는 회수되고, 그 링크로 받은 미접속 RESERVED 자리와 세션은 해제                                                                             | 본문 400 `INVALID_REQUEST`, 세션 401 `INVALID_SESSION`, 방장 조건 불충족 403 `INVITATION_UNAVAILABLE`, 시도 한도 429 `RATE_LIMITED`, admission 닫힘 503 `ADMISSION_CLOSED`, 발급 실패 503 `INVITATION_UNAVAILABLE`(이전 링크 유지) |
| DELETE `/api/sessions/current/invitation` | 위와 같음                                                                                                                          | 204, 현재 링크 회수                                                                                                                                                                                                                  | 본문·세션·방장·시도 한도 거절은 위와 같음. admission 검사 없음                                                                                                                                                                     |
| GET `/api/capacity`                       | 없음                                                                                                                               | 200 `{matchesInUse, matchLimit, lobbyRoomsInUse, lobbyRoomLimit, admissionOpen, mediaBlocked}`. 먼저 예약을 정리한다. `matchesInUse`는 연습~PLAYING 일반 방 수, `lobbyRoomsInUse`는 일반 방 수, `mediaBlocked`는 `!allowsNewMatch()` | 없음. 입장 시도 한도 밖                                                                                                                                                                                                            |

방장 조건은 방이 닫히는 중이 아니고, 단계가 LOBBY 또는 DEVICE_CHECK이며, 요청자가 현재 방장이고 연결 중인 것이다.

`POST /api/sessions` 처리 순서와 거절은 다음과 같다.

| 순서 | 검사                                                                                                                 | 실패 응답                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1    | 본문 스키마                                                                                                          | 400 `INVALID_REQUEST`                                       |
| 2    | admission `OPEN` ∧ 입장 시도 한도 구성                                                                               | 503 `ADMISSION_CLOSED`                                      |
| 3    | 자격. 초대 토큰이 있으면 그 범위를 검증한다(SSO도 같음). 없으면 SSO 계정(해시), guest 모드의 방 생성이면 게스트 자격 | 403 `INVALID_INVITATION`                                    |
| 4    | 입장 시도 한도                                                                                                       | 429 `RATE_LIMITED`                                          |
| 5    | SSO 계정이 가진 살아 있는 세션 중 연결됐거나 자리가 RESERVED가 아닌 것이 있음                                        | 409 `ALREADY_IN_ROOM`. 미접속 예약만 있으면 무효화하고 계속 |
| 6    | 예약 정리 후 방 생성: 혼동 문자 없는 6자리 코드를 최대 64회 중복 회피                                                | 소진이나 세션 600개 초과 같은 예외는 503 `CAPACITY`         |
| 6a   | 생성 자리 예약 결과 `OWNER_LIMIT`                                                                                    | 429 `TOO_MANY_ROOMS`                                        |
| 6b   | 생성 자리 예약의 그 밖 실패(`ROOM_LIMIT`, `SERVICE_FULL`)                                                            | 503 `CAPACITY`                                              |
| 7    | 참가: 방 코드가 등록부에 없음, 또는 예약 결과 `ROOM_CLOSED`                                                          | 404 `ROOM_NOT_AVAILABLE`                                    |
| 7a   | 참가 예약 결과 `ROOM_FULL`                                                                                           | 503 `ROOM_FULL`                                             |
| 7b   | 참가 예약의 그 밖 실패                                                                                               | 503 `CAPACITY`                                              |
| 8    | 예약 뒤 admission 재검사                                                                                             | 503 `ADMISSION_CLOSED`(자리·세션 해제)                      |

방을 연 주체는 다음과 같이 센다. 게스트 생성은 출처 해시로 세고 한도는 `MAX_ROOMS_PER_ORIGIN`이다. SSO 생성은 계정으로 세고 한도는 `MAX_ROOMS_PER_ACCOUNT`다. 초대 링크로 만든 방은 세지 않는다. 초대 링크로 방을 만들면 그 방이 링크의 범위에 추가된다.

근거: [session.ts:7](../../packages/protocol/src/game-messages/session.ts#L7), [session.ts:43](../../packages/protocol/src/game-messages/session.ts#L43), [session.ts:47](../../packages/protocol/src/game-messages/session.ts#L47), [SessionRoutes.ts:30](../../server/src/session/SessionRoutes.ts#L30), [SessionRoutes.ts:33](../../server/src/session/SessionRoutes.ts#L33), [SessionRoutes.ts:96](../../server/src/session/SessionRoutes.ts#L96), [SessionRoutes.ts:101](../../server/src/session/SessionRoutes.ts#L101), [SessionRoutes.ts:111](../../server/src/session/SessionRoutes.ts#L111), [SessionRoutes.ts:123](../../server/src/session/SessionRoutes.ts#L123), [SessionRoutes.ts:136](../../server/src/session/SessionRoutes.ts#L136), [SessionRoutes.ts:138](../../server/src/session/SessionRoutes.ts#L138), [SessionRoutes.ts:151](../../server/src/session/SessionRoutes.ts#L151), [SessionRoutes.ts:155](../../server/src/session/SessionRoutes.ts#L155), [SessionRoutes.ts:165](../../server/src/session/SessionRoutes.ts#L165), [SessionRoutes.ts:177](../../server/src/session/SessionRoutes.ts#L177), [SessionRoutes.ts:178](../../server/src/session/SessionRoutes.ts#L178), [SessionRoutes.ts:182](../../server/src/session/SessionRoutes.ts#L182), [SessionRoutes.ts:192](../../server/src/session/SessionRoutes.ts#L192), [SessionRoutes.ts:203](../../server/src/session/SessionRoutes.ts#L203), [SessionRoutes.ts:208](../../server/src/session/SessionRoutes.ts#L208), [SessionRoutes.ts:214](../../server/src/session/SessionRoutes.ts#L214), [SessionRoutes.ts:246](../../server/src/session/SessionRoutes.ts#L246), [SessionRoutes.ts:255](../../server/src/session/SessionRoutes.ts#L255), [SessionRoutes.ts:259](../../server/src/session/SessionRoutes.ts#L259), [SessionRoutes.ts:262](../../server/src/session/SessionRoutes.ts#L262), [SessionRoutes.ts:277](../../server/src/session/SessionRoutes.ts#L277), [SessionRoutes.ts:282](../../server/src/session/SessionRoutes.ts#L282), [SessionRoutes.ts:285](../../server/src/session/SessionRoutes.ts#L285), [KkakkungRoom.ts:403](../../server/src/rooms/KkakkungRoom.ts#L403), [RoomInvitations.ts:31](../../server/src/session/RoomInvitations.ts#L31), [RoomInvitations.ts:42](../../server/src/session/RoomInvitations.ts#L42), [CapacityRoutes.ts:26](../../server/src/session/CapacityRoutes.ts#L26), [SlotRegistry.ts:241](../../server/src/session/SlotRegistry.ts#L241).

### 4.5 운영·데모·시연 경로

| 메서드·경로                                         | 인증·요청                                                                             | 성공                                                                                                                                                                 | 거절 → 응답                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/operations/invitations`                  | 운영 Bearer. `{scope:{allowCreate:boolean, roomCodes: 최대 16개 방 코드}, expiresAt}` | 201 `{inviteId, inviteToken, scope, expiresAt}`                                                                                                                      | 인증 401 `UNAUTHORIZED`. 형상 400 `INVALID_REQUEST`. 409 `NOT_READY`: 운영 준비 문 닫힘, `INVITE_MAX_TTL_MS` 없음, 저장 4,096개 초과. 409 `OUTSIDE_PUBLIC_WINDOW`: 공개창 없음, 창이 열리기 전, `expiresAt`이 닫힘 이후. 400 `INVALID_INVITATION`: `expiresAt`≤now 또는 now+`INVITE_MAX_TTL_MS` 초과, roomCode 중복, `allowCreate=false`인데 코드 0개, 모르는 방 코드 |
| POST `/api/operations/invitations/:inviteId/revoke` | 운영 Bearer, `inviteId`는 `^[0-9a-f-]{36}$`                                           | 204(모르는 ID도 204)                                                                                                                                                 | 401 `UNAUTHORIZED`, 400 `INVALID_REQUEST`                                                                                                                                                                                                                                                                                                                             |
| POST `/api/operations/demo-rooms`                   | 운영 Bearer. `{role:'runner'\|'tagger', nickname?}`                                   | 201 `{sessionToken, playerId, roomCode, role, expiresAt(첫 접속 기한), protocolVersion, entryFragment:'#demo=<토큰>&room=<코드>&player=<id>'}`. 기본 닉네임 `관리자` | 401 `UNAUTHORIZED`, 400 `INVALID_REQUEST`, 데모 방 한도 503 `DEMO_ROOM_LIMIT`, 그 밖 예약 실패·발급 예외 503 `CAPACITY`, `DEMO_ROOMS` 꺼짐 503 `DEMO_UNAVAILABLE`(인증 뒤)                                                                                                                                                                                            |
| POST `/api/demo-admin/rooms`                        | 신뢰 프록시의 `X-Demo-Admin`(1–256자)이 운영자 목록에 있음. 본문은 위와 같음          | 위와 같음                                                                                                                                                            | 위와 같음                                                                                                                                                                                                                                                                                                                                                             |
| POST `/api/showcase/rooms`                          | `X-Demo-Admin` 판정은 위와 같음. `{role, nickname?}`                                  | 201. `entryFragment:'#showcase=…&room=…&player=…'`, 기본 닉네임 `도망자`/`술래`. 빈자리가 있는 가장 먼저 열린 시연 방에 앉히고, 없으면 새 방을 연다                  | 인증 401 `UNAUTHORIZED`. `operationsReady` 거짓 503 `ADMISSION_CLOSED`. 본문 400 `INVALID_REQUEST`. 들어갈 방도 새로 열 여유도 없음 503 `CAPACITY`. 고른 역할 2자리 찼음 409 `ROLE_FULL`. `SHOWCASE_ROOMS=0`이면 인증 뒤 503 `SHOWCASE_UNAVAILABLE`                                                                                                                   |
| POST `/api/operations/commands`                     | 운영 Bearer                                                                           | [6.2](#62-운영-명령)                                                                                                                                                 | [6.1](#61-운영-http와-인증)                                                                                                                                                                                                                                                                                                                                           |
| GET `/api/operations/commands/:requestId`           | 운영 Bearer                                                                           | 200 작업 snapshot                                                                                                                                                    | [6.1](#61-운영-http와-인증)                                                                                                                                                                                                                                                                                                                                           |
| GET `/api/operations/status`                        | 운영 Bearer                                                                           | 200 운영 상태                                                                                                                                                        | [6.1](#61-운영-http와-인증)                                                                                                                                                                                                                                                                                                                                           |

- 운영자 목록 파일은 요청마다 다시 읽는다. 한 줄에 이메일 하나이고, 빈 줄과 `#` 줄은 건너뛰며, 대소문자를 무시한다.
- 경로가 없거나 파일 읽기에 실패하면 아무도 통과시키지 않는다. trustProxy가 아니면 헤더를 보지 않는다.
- **`OPS_TOKEN`이 없으면** 초대·데모·demo-admin 라우터가 등록되지 않는다. `/api/operations` 이하는 503 `OPERATOR_AUTH_UNAVAILABLE`, `/api/demo-admin/rooms`는 미등록 경로가 된다.
- 데모 HTTP는 준비 문을 보지 않는다. 방 접속 때 데모 준비 문을 본다.

근거: [invite-types.ts:2](../../server/src/session/invite-types.ts#L2), [InvitationRoutes.ts:12](../../server/src/session/InvitationRoutes.ts#L12), [InvitationRoutes.ts:25](../../server/src/session/InvitationRoutes.ts#L25), [InvitationRoutes.ts:50](../../server/src/session/InvitationRoutes.ts#L50), [InvitationRoutes.ts:55](../../server/src/session/InvitationRoutes.ts#L55), [InviteStore.ts:55](../../server/src/session/InviteStore.ts#L55), [InviteStore.ts:64](../../server/src/session/InviteStore.ts#L64), [InviteStore.ts:70](../../server/src/session/InviteStore.ts#L70), [InviteStore.ts:72](../../server/src/session/InviteStore.ts#L72), [InviteStore.ts:74](../../server/src/session/InviteStore.ts#L74), [InviteStore.ts:77](../../server/src/session/InviteStore.ts#L77), [InviteStore.ts:79](../../server/src/session/InviteStore.ts#L79), [DemoRoutes.ts:58](../../server/src/session/DemoRoutes.ts#L58), [DemoRoutes.ts:64](../../server/src/session/DemoRoutes.ts#L64), [DemoRoutes.ts:76](../../server/src/session/DemoRoutes.ts#L76), [DemoRoutes.ts:86](../../server/src/session/DemoRoutes.ts#L86), [DemoRoutes.ts:89](../../server/src/session/DemoRoutes.ts#L89), [DemoRoutes.ts:137](../../server/src/session/DemoRoutes.ts#L137), [ShowcaseRoutes.ts:51](../../server/src/session/ShowcaseRoutes.ts#L51), [ShowcaseRoutes.ts:52](../../server/src/session/ShowcaseRoutes.ts#L52), [ShowcaseRoutes.ts:59](../../server/src/session/ShowcaseRoutes.ts#L59), [ShowcaseRoutes.ts:65](../../server/src/session/ShowcaseRoutes.ts#L65), [ShowcaseRoutes.ts:79](../../server/src/session/ShowcaseRoutes.ts#L79), [ShowcaseRoutes.ts:111](../../server/src/session/ShowcaseRoutes.ts#L111), [SlotRegistry.ts:336](../../server/src/session/SlotRegistry.ts#L336), [operator-allowlist.ts:18](../../server/src/session/operator-allowlist.ts#L18), [operator-allowlist.ts:31](../../server/src/session/operator-allowlist.ts#L31), [operator-allowlist.ts:36](../../server/src/session/operator-allowlist.ts#L36), [operator-allowlist.ts:54](../../server/src/session/operator-allowlist.ts#L54), [bootstrap.ts:461](../../server/src/bootstrap.ts#L461), [bootstrap.ts:505](../../server/src/bootstrap.ts#L505).

### 4.6 health·config·media·개발 경로

| 메서드·경로                 | 조건                                         | 응답                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/health`               | 항상                                         | 200 `{ok:true, stage:'product-assembly'\|'skeleton'}`                                                                                                                                                                                                                                                                                       |
| GET `/health/live`          | media 있음                                   | 초기화 전 503 `{state:'INITIALIZING', reasonCodes:['INITIALIZATION_UNCONFIRMED']}`, 이후 200 `{state:'LIVE', reasonCodes:[]}`, `no-store`                                                                                                                                                                                                   |
| GET `/health/live`          | media 없음                                   | 200 `{status:'alive'}`                                                                                                                                                                                                                                                                                                                      |
| GET `/health/ready`         | media 있음                                   | 초기화 전 503 `INITIALIZING`. 이후 200 `{state:'READY', reasonCodes:[]}`는 READY ∧ historyComplete ∧ unresolved 0 ∧ 코드 0일 때만이고, 그 밖은 503 `{state:'RECOVERING'\|'LOCKED', reasonCodes}`. 투영 실패는 503 `LOCKED`/`READINESS_UNCONFIRMED`                                                                                          |
| GET `/health/ready`         | media 없음                                   | `listen` 완료 ∧ (skeleton ∨ readiness READY)면 200, 아니면 503. 본문 `{status:'ready'\|'recovering'\|'starting', stage, mvpReady:false, mediaEnabled, readiness, admission, productSecurityReady}`                                                                                                                                          |
| GET `/api/config`           | 항상                                         | 200 `{stage, protocolVersion(product면 '0.2.0', skeleton이면 '0.1.0'), roomName:'kkakkung', diagnosticRoomName:'sandbox', mediaEnabled, maxPlayers:6}`                                                                                                                                                                                      |
| POST `/api/livekit/webhook` | 항상 등록                                    | 본문은 raw text 256kb까지. media 없으면 503 `MEDIA_UNAVAILABLE`, 있으면 `handleWebhook` 결과를 200으로. 서명 검증은 media.md                                                                                                                                                                                                                |
| POST `/api/media/grants`    | 제품                                         | Bearer 401 `INVALID_SESSION`, 본문 400 `INVALID_REQUEST`, 방·matchId 불일치 409 `WRONG_SCOPE`, 범위 없음 409 `NOT_READY`, media 없음 503 `MEDIA_UNAVAILABLE`, `operationsReady` 거짓 409 `NOT_READY`, 준비 결과 없음 409 `WRONG_SCOPE`, 성공 200 grant, 실패는 unknown이면 503 나머지 409 `{error: 결과 코드}`. 범위 조건은 [8.1](#81-입장) |
| POST `/api/media/report`    | 제품                                         | 401 `INVALID_SESSION`, 400 `INVALID_REQUEST`, 방·matchId·보고 범위 불일치 409 `WRONG_SCOPE`, 성공 204                                                                                                                                                                                                                                       |
| POST `/api/dev-sessions`    | 항상 등록. strict면 핸들러가 즉시 404를 반환 | 비엄격이면 0.1 개발 세션([11절](#11-01sandbox-진단-경로)). strict에서 실제로 등록되지 않는 것은 이 경로가 아니라 `sandbox` 방(Colyseus `server.define`)이다                                                                                                                                                                                 |
| `/monitor`, `/playground`   | 비엄격일 때만                                | Colyseus 도구                                                                                                                                                                                                                                                                                                                               |
| `/matchmake/*`              | Colyseus                                     | 방 이름 `kkakkung`(제품은 `roomCode`로 filterBy), `sandbox`                                                                                                                                                                                                                                                                                 |

근거: [bootstrap.ts:362](../../server/src/bootstrap.ts#L362), [bootstrap.ts:368](../../server/src/bootstrap.ts#L368), [bootstrap.ts:369](../../server/src/bootstrap.ts#L369), [bootstrap.ts:373](../../server/src/bootstrap.ts#L373), [bootstrap.ts:377](../../server/src/bootstrap.ts#L377), [bootstrap.ts:380](../../server/src/bootstrap.ts#L380), [bootstrap.ts:391](../../server/src/bootstrap.ts#L391), [bootstrap.ts:354](../../server/src/bootstrap.ts#L354), [bootstrap.ts:511](../../server/src/bootstrap.ts#L511), [bootstrap.ts:521](../../server/src/bootstrap.ts#L521), [bootstrap.ts:524](../../server/src/bootstrap.ts#L524), [bootstrap.ts:526](../../server/src/bootstrap.ts#L526), [bootstrap.ts:528](../../server/src/bootstrap.ts#L528), [bootstrap.ts:536](../../server/src/bootstrap.ts#L536), [bootstrap.ts:550](../../server/src/bootstrap.ts#L550), [bootstrap.ts:402](../../server/src/bootstrap.ts#L402), [bootstrap.ts:563](../../server/src/bootstrap.ts#L563), [bootstrap.ts:611](../../server/src/bootstrap.ts#L611), [HealthHandlers.ts:12](../../server/src/health/HealthHandlers.ts#L12), [HealthHandlers.ts:38](../../server/src/health/HealthHandlers.ts#L38), [HealthHandlers.ts:49](../../server/src/health/HealthHandlers.ts#L49), [HealthHandlers.ts:59](../../server/src/health/HealthHandlers.ts#L59), [version.ts:2](../../packages/protocol/src/version.ts#L2), [version.ts:6](../../packages/protocol/src/version.ts#L6).

## 5. 세션과 자리

### 5.1 제품 세션

| 항목         | 값·규칙                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 토큰         | 32바이트 base64url 원문은 발급 응답에만 들어간다. 저장은 SHA-256이고, 전체를 상수 시간으로 비교한다. 512자 초과 토큰은 거절 |
| 첫 접속 기한 | 기본 60,000ms, 데모·시연은 `DEMO_ADMISSION_TTL_MS`. 초대 만료가 더 이르면 그 시각. 접속하면 기한이 사라짐                   |
| 활동 lease   | 30분. 명령 수락과 접속 claim 때만 연장. 발급 후 2시간을 넘지 않음                                                           |
| 동시 연결    | 세션당 1개. 다른 연결이 claim하면 `busy`                                                                                    |
| 저장 상한    | 600개. 초과하면 발급 예외(HTTP 503 `CAPACITY`)                                                                              |
| 무효화       | 일반 참가자의 연결 끊김, 방 소멸·만료, 잠금 시 RESERVED, 장치 점검 만료, 방장 초대 회전                                     |

근거: [ProductSessionStore.ts:19](../../server/src/session/ProductSessionStore.ts#L19), [ProductSessionStore.ts:39](../../server/src/session/ProductSessionStore.ts#L39), [ProductSessionStore.ts:76](../../server/src/session/ProductSessionStore.ts#L76), [ProductSessionStore.ts:77](../../server/src/session/ProductSessionStore.ts#L77), [ProductSessionStore.ts:88](../../server/src/session/ProductSessionStore.ts#L88), [ProductSessionStore.ts:109](../../server/src/session/ProductSessionStore.ts#L109), [ProductSessionStore.ts:144](../../server/src/session/ProductSessionStore.ts#L144), [ProductSessionStore.ts:147](../../server/src/session/ProductSessionStore.ts#L147), [ProductSessionStore.ts:162](../../server/src/session/ProductSessionStore.ts#L162), [KkakkungRoom.ts:881](../../server/src/rooms/KkakkungRoom.ts#L881).

### 5.2 자리 등록부

자리 상태는 `RESERVED`(세션 발급), `JOINED`(연결), `RETIRING`(떠났지만 원격 media 회수 미확인) 셋이다. RETIRING 자리는 좌석 수에 계속 들어가고, 회수 확인으로만 풀린다.

| 방 종류          | 정원          | 생성 예산                                                           | 좌석 총량에 포함 |
| ---------------- | ------------- | ------------------------------------------------------------------- | ---------------- |
| 일반(`match`)    | 6             | 일반 방 수 < `LOBBY_MAX_ROOMS`                                      | 예               |
| 시연(`showcase`) | 4(역할마다 2) | 사용 중인 시연 방(LOBBY~PLAYING, 닫히지 않은 것) < `SHOWCASE_ROOMS` | 예               |
| 데모(`demo`)     | 1(운영자)     | 데모 방 수 < `DEMO_MAX_ROOMS`                                       | 아니오           |

좌석 총량은 `max(LOBBY_MAX_ROOMS, MAX_ROOMS) × 6 + SHOWCASE_ROOMS × 4`다. 경기 예산은 연습~PLAYING인 일반 방 수 < `MAX_ROOMS`이며, 연습 시작 때만 검사한다.

`reserve` 판정 순서는 다음과 같다.

| 순서 | 조건                                  | 결과                                       |
| ---- | ------------------------------------- | ------------------------------------------ |
| 1    | 방이 없고 생성 요청이 아님            | `ROOM_CLOSED`                              |
| 2    | 데모·시연·일반 생성 예산 초과         | `DEMO_LIMIT` / `ROOM_LIMIT` / `ROOM_LIMIT` |
| 3    | 주체의 열린 방 수 ≥ 상한(계정/출처)   | `OWNER_LIMIT`                              |
| 4    | 닫는 중 또는 잠김                     | `ROOM_CLOSED`                              |
| 5    | 이미 자리 있음                        | `reserved`(멱등)                           |
| 6    | 단계가 LOBBY·DEVICE_CHECK 아님        | `ROOM_CLOSED`                              |
| 7    | 정원 참                               | `ROOM_FULL`                                |
| 8    | 데모가 아닌데 좌석 총량 참            | `SERVICE_FULL`                             |
| 9    | 시연 방에 역할 미지정 / 같은 역할 2명 | `ROOM_CLOSED` / `ROLE_FULL`                |

1초 예약 정리 루프는 다음을 한다.

- 세션이 사라진 RESERVED 자리를 해제한다.
- 살아 있는 Room이 없고 빈 방이면 닫는다. 이때 방의 세션을 무효화하고 초대를 회수한다.

근거: [SlotRegistry.ts:26](../../server/src/session/SlotRegistry.ts#L26), [SlotRegistry.ts:60](../../server/src/session/SlotRegistry.ts#L60), [SlotRegistry.ts:65](../../server/src/session/SlotRegistry.ts#L65), [SlotRegistry.ts:212](../../server/src/session/SlotRegistry.ts#L212), [SlotRegistry.ts:238](../../server/src/session/SlotRegistry.ts#L238), [SlotRegistry.ts:283](../../server/src/session/SlotRegistry.ts#L283), [SlotRegistry.ts:285](../../server/src/session/SlotRegistry.ts#L285), [SlotRegistry.ts:293](../../server/src/session/SlotRegistry.ts#L293), [SlotRegistry.ts:314](../../server/src/session/SlotRegistry.ts#L314), [SlotRegistry.ts:316](../../server/src/session/SlotRegistry.ts#L316), [SlotRegistry.ts:318](../../server/src/session/SlotRegistry.ts#L318), [SlotRegistry.ts:325](../../server/src/session/SlotRegistry.ts#L325), [SlotRegistry.ts:351](../../server/src/session/SlotRegistry.ts#L351), [SlotRegistry.ts:405](../../server/src/session/SlotRegistry.ts#L405), [bootstrap.ts:204](../../server/src/bootstrap.ts#L204), [ReservationCleanup.ts:14](../../server/src/session/ReservationCleanup.ts#L14), [ReservationCleanup.ts:18](../../server/src/session/ReservationCleanup.ts#L18).

## 6. 운영 경계

### 6.1 운영 HTTP와 인증

운영 인증은 플레이어 Bearer와 분리돼 있다.

- `Authorization: Bearer <토큰>`의 토큰이 `^[A-Za-z0-9._~+/-]+=*$`이고 앞뒤 공백이 없어야 한다.
- 설정 토큰과 길이가 같고 `timingSafeEqual`로 일치해야 한다.
- 설정 토큰 자체가 이 문법을 어기면 모든 요청이 거절된다.

운영 명령 세 경로는 media가 감사형 handler를 제공하면 그것을 쓰고, 아니면 간이 라우터를 쓴다. 두 구현의 응답은 다르다.

| 상황                       | 감사형 handler(`{code}` 본문)                                        | 간이 `OperationsRoutes`(`{error}` 본문) |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------- |
| 인증 실패                  | 403 `UNAUTHORIZED`, 감사에 `auth-failed` 기록                        | 401 `UNAUTHORIZED`                      |
| 본문·ID 형식 오류          | 400 `INVALID_COMMAND`(감사 쓰기 실패면 503 `OPERATIONS_UNAVAILABLE`) | 400 `INVALID_REQUEST`                   |
| 같은 requestId에 다른 내용 | 409 `REQUEST_ID_CONFLICT`                                            | 409 `<submission code>`                 |
| 대기열 포화                | 429 `OPERATIONS_BUSY`, `Retry-After: 1`                              | —                                       |
| snapshot 없음              | 404 `OPERATION_NOT_FOUND`                                            | 404 `NOT_FOUND`                         |
| 내부·응답 검증 실패        | 503 `OPERATIONS_UNAVAILABLE`, admission LOCKED, 감사 `locked`        | port 없음 503 `OPERATIONS_UNAVAILABLE`  |

requestId와 retirementId는 `^[A-Za-z0-9._:-]{1,128}$`이고 앞뒤 공백이 없어야 한다. 명령 본문은 `requestId`, `action`, (`retry-retirement`만) `retirementId` 외의 키, 접근자 속성, 비일반 prototype을 거절한다. 상태 응답은 `{admission, readiness, unresolvedCount, remainingMinutes, remainingBytes, checkedAtEpochMs, operatingMode?}`로 정제된다.

근거: [OperatorAuth.ts:5](../../server/src/operations/OperatorAuth.ts#L5), [OperatorAuth.ts:16](../../server/src/operations/OperatorAuth.ts#L16), [bootstrap.ts:492](../../server/src/bootstrap.ts#L492), [bootstrap.ts:499](../../server/src/bootstrap.ts#L499), [OperationsHandlers.ts:100](../../server/src/operations/OperationsHandlers.ts#L100), [OperationsHandlers.ts:107](../../server/src/operations/OperationsHandlers.ts#L107), [OperationsHandlers.ts:111](../../server/src/operations/OperationsHandlers.ts#L111), [OperationsHandlers.ts:127](../../server/src/operations/OperationsHandlers.ts#L127), [OperationsHandlers.ts:137](../../server/src/operations/OperationsHandlers.ts#L137), [OperationsHandlers.ts:152](../../server/src/operations/OperationsHandlers.ts#L152), [OperationsHandlers.ts:55](../../server/src/operations/OperationsHandlers.ts#L55), [OperationsRoutes.ts:25](../../server/src/session/OperationsRoutes.ts#L25), [OperationsRoutes.ts:41](../../server/src/session/OperationsRoutes.ts#L41), [OperationsRoutes.ts:52](../../server/src/session/OperationsRoutes.ts#L52), [InvitationRoutes.ts:25](../../server/src/session/InvitationRoutes.ts#L25), [OperationsController.ts:23](../../server/src/operations/OperationsController.ts#L23), [OperationsController.ts:30](../../server/src/operations/OperationsController.ts#L30).

### 6.2 운영 명령

명령은 직렬 비동기 큐에서 하나씩 실행된다.

- 202는 접수만 뜻하고, 결과는 snapshot `{requestId, operationId, action, status: pending | succeeded | failed, code, updatedAtEpochMs}`로 다시 읽는다.
- 같은 requestId와 같은 내용이면 기존 snapshot을 돌려준다.
- 대기 압력(작업 + 미완료 감사 쓰기 + 실행 중 효과)이 64 이상이면 거절한다. `drain`은 65까지 허용한다.
- 명령마다 기한은 `OPS_OPERATION_TIMEOUT_MS`다. `checkpoint`이고 미해결 복구가 있으며 재시도로 다시 관찰할 수 있을 때만 180,000ms로 늘어난다(그 밖의 `checkpoint`는 기본 기한). 이 재정의 값 자체도 0보다 크고 180,000ms 이하인 안전한 정수여야 하며, 벗어나면 `INVALID_OPERATION_TIMEOUT`로 접수 자체가 실패한다.
- 실패한 명령은 admission을 DRAINING으로 내린다.

| 명령               | 즉시 효과                                     | 성공 조건                                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drain`            | 접수 순간 admission DRAINING(LOCKED가 아니면) | 25ms 간격으로 저널을 flush하며 다음을 기다림: 활성 경기·연습·대기 예약 0, historyComplete, unresolved 0, 저널 쓰기 가능, 모든 저널 기록이 REVOKED 또는 빈 예약 중단, usage 쓰기 가능·무결성 ok, 모든 예약이 AWAITING_OFFICIAL/RELEASED, 모든 재시도 REVOKED                                                            |
| `resume`           | —                                             | 닫힘·잠김 아님, checkpoint 진행 중 아님, `productSecurityReady`, 공개창 안(continuous는 항상), readiness READY, unresolved 0, attested면 남은 분·바이트 > 0. 통과하면 admission OPEN                                                                                                                                   |
| `checkpoint`       | —                                             | 미해결 복구가 있으면 DRAINING·활동 0·재시도 전부 REVOKED일 때 복구 재관찰. attested는 `official-usage-input.json`을 읽어 증거 revision을 확인하고 공식 예산에 반영한 뒤, 저널상 전부 REVOKED인 AWAITING_OFFICIAL 예약을 RELEASED로 바꿈. continuous는 저널 flush와 usage 쓰기 가능만 확인. 끝나면 저널·usage 쓰기 가능 |
| `retry-retirement` | —                                             | 그 retirementId의 재시도 항목이 정확히 1개이고 UNRESOLVED, 운영자 재시도 결과 REVOKED, 저널 flush, 복구 소유면 재조정 결과 완전                                                                                                                                                                                        |

실패 코드(snapshot `code`)는 `OPERATION_TIMEOUT`, `OPERATIONS_CLOSED`, `INVALID_OPERATION_CLOCK`, `AUDIT_WRITE_FAILED`, `RESUME_NOT_READY`, `OPERATION_UNCONFIRMED`, `OPERATION_FAILED`다. `INVALID_OPERATION_CLOCK`과 `AUDIT_WRITE_FAILED`는 admission을 LOCKED로 만든다. 명령 내부 오류(`RETIREMENT_NOT_UNRESOLVED` 같은 것)는 모두 `OPERATION_FAILED`로 기록된다.

재시도 항목의 공급자 대기 시간이 불명(`providerWaitUnknown`)이면 운영 명령으로 재시도할 수 없다. 명령이 대기 종료 확인을 넘기지 않아 `PROVIDER_WAIT_UNCONFIRMED`로 실패한다.

운영 상태의 readiness는 다음 중 하나라도 해당하면 `LOCKED`로 덮인다: 닫힘, 잠김, 저널 쓰기 불가, 유효한 공식 예산 또는 continuous 공급자 할당 없음, `productSecurityReady` 거짓, historyComplete 거짓, unresolved > 0. media readiness를 관찰할 때 READY가 아니면 admission이 즉시 DRAINING으로 내려가고, 복구가 스스로 OPEN으로 되돌리지 않는다.

감사 저장은 `operations-audit.json`에 최대 4,096개 이벤트, 24시간을 보관한다. 같은 이벤트는 60초 안에 합친다. 감사 코드는 `INVALID_COMMAND`, `REQUEST_ID_CONFLICT`, `OPERATIONS_NOT_INITIALIZED`, `OPERATIONS_CLOSED`, `OPERATION_TIMEOUT`, `RESUME_NOT_READY`, `OPERATION_FAILED`, `OPERATION_UNCONFIRMED`, `AUDIT_WRITE_FAILED`, `OPERATIONS_AUDIT_CORRUPT`, `RECOVERY_UNCONFIRMED`, `INVALID_OPERATION_CLOCK`, `UNAUTHORIZED`다.

근거: [OperationsController.ts:15](../../server/src/operations/OperationsController.ts#L15), [OperationsController.ts:146](../../server/src/operations/OperationsController.ts#L146), [OperationsController.ts:157](../../server/src/operations/OperationsController.ts#L157), [OperationsController.ts:165](../../server/src/operations/OperationsController.ts#L165), [OperationsController.ts:181](../../server/src/operations/OperationsController.ts#L181), [OperationsController.ts:392](../../server/src/operations/OperationsController.ts#L392), [OperationsController.ts:461](../../server/src/operations/OperationsController.ts#L461), [OperationsController.ts:467](../../server/src/operations/OperationsController.ts#L467), [OperationsController.ts:509](../../server/src/operations/OperationsController.ts#L509), [OperationsController.ts:556](../../server/src/operations/OperationsController.ts#L556), [OperationsBindings.ts:95](../../server/src/operations/OperationsBindings.ts#L95), [OperationsBindings.ts:104](../../server/src/operations/OperationsBindings.ts#L104), [OperationsController.ts:165](../../server/src/operations/OperationsController.ts#L165), [OperationsBindings.ts:139](../../server/src/operations/OperationsBindings.ts#L139), [OperationsBindings.ts:163](../../server/src/operations/OperationsBindings.ts#L163), [OperationsBindings.ts:179](../../server/src/operations/OperationsBindings.ts#L179), [OperationsBindings.ts:193](../../server/src/operations/OperationsBindings.ts#L193), [OperationsBindings.ts:228](../../server/src/operations/OperationsBindings.ts#L228), [OperationsBindings.ts:259](../../server/src/operations/OperationsBindings.ts#L259), [OperationsBindings.ts:266](../../server/src/operations/OperationsBindings.ts#L266), [OperationsBindings.ts:303](../../server/src/operations/OperationsBindings.ts#L303), [OperationsBindings.ts:324](../../server/src/operations/OperationsBindings.ts#L324), [OperationsBindings.ts:394](../../server/src/operations/OperationsBindings.ts#L394), [OperationsBindings.ts:489](../../server/src/operations/OperationsBindings.ts#L489), [RevocationRetries.ts:249](../../server/src/operations/RevocationRetries.ts#L249), [ReadinessRuntime.ts:116](../../server/src/health/ReadinessRuntime.ts#L116), [OperationsAudit.ts:10](../../server/src/operations/OperationsAudit.ts#L10), [OperationsAudit.ts:40](../../server/src/operations/OperationsAudit.ts#L40), [OperationsAudit.ts:320](../../server/src/operations/OperationsAudit.ts#L320).

## 7. 운영 영속 상태와 복구

### 7.1 파일

`OPS_DATA_DIR` 아래 basename만 허용한다. 체크포인트는 같은 임시 파일을 sync한 뒤 이름을 바꾸는 방식으로 쓴다.

| 파일                                                                      | 쓰는 쪽         | 내용                                                                                            |
| ------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `writer.lock`, `writer-acquire.lock`                                      | 저널            | 단일 작성자 lease. 이미 있으면(`EEXIST`) `WRITER_CONFLICT`로 기동 실패                          |
| `media-journal.jsonl`, `media-journal.jsonl.checkpoint.json`              | 저널            | media 세대 기록(`PREPARED`/`REVOKING`/`REVOKED`/`UNRESOLVED`/`ABORTED`), checksum·순번 검사     |
| `usage-checkpoint.json`                                                   | 사용량 예산     | 공식 예산과 예약 목록                                                                           |
| `official-usage-input.json`                                               | 운영자 입력     | `checkpoint` 명령이 읽는 공식 사용량                                                            |
| `revocation-checkpoint.json`                                              | 재시도          | 이전·현재 프로세스 회수 재시도 항목                                                             |
| `cleanup-checkpoint.json`                                                 | media 복구 정리 | media.md                                                                                        |
| `operations-audit.json`                                                   | 운영 감사       | 명령 snapshot과 이벤트                                                                          |
| `runtime-evidence.json`(attested) / `service-operations.json`(continuous) | 운영자 증거     | namespace 소유, 첫 설치·첫 감사, 공식 예산 revision. 32KiB 이하, 1초마다 재검사, 검증 lease 5초 |
| `capability-report.json`, `livekit-monthly-usage.json`                    | media           | media.md                                                                                        |

`runtime-evidence.json`은 다음 조건을 지켜야 한다.

- 참조 문자열은 4–512자이고, `example`·`dummy`·`sample`·`placeholder`·`test`·`unknown`·`todo`·`pending` 같은 자리표시 값을 거절한다.
- 실패 사유는 `INITIAL_VALIDATION_FAILED`, `CLOCK_INVALID`, `CLOCK_ROLLBACK`, `EVIDENCE_FUTURE`, `EVIDENCE_EXPIRED`, `EVIDENCE_STALE`, `EPOCH_LEASE_EXPIRED`, `MONOTONIC_LEASE_EXPIRED`, `FILE_INVALID`, `FILE_CHANGED`, `FILE_READ_FAILED`, `CLOSED`다.
- 시계가 5ms 이내로 되돌아가는 것은 보정으로 허용한다.

근거: [CheckpointStore.ts:52](../../server/src/operations/CheckpointStore.ts#L52), [OperationJournal.ts:34](../../server/src/operations/OperationJournal.ts#L34), [OperationJournal.ts:270](../../server/src/operations/OperationJournal.ts#L270), [OperationJournal.ts:336](../../server/src/operations/OperationJournal.ts#L336), [OperationJournal.ts:476](../../server/src/operations/OperationJournal.ts#L476), [UsageCheckpoint.ts:269](../../server/src/operations/UsageCheckpoint.ts#L269), [UsageCheckpoint.ts:279](../../server/src/operations/UsageCheckpoint.ts#L279), [SharedRetryCheckpoint.ts:77](../../server/src/operations/SharedRetryCheckpoint.ts#L77), [OperationsAudit.ts:185](../../server/src/operations/OperationsAudit.ts#L185), [RuntimeEvidence.ts:29](../../server/src/config/RuntimeEvidence.ts#L29), [RuntimeEvidence.ts:71](../../server/src/config/RuntimeEvidence.ts#L71), [RuntimeEvidence.ts:130](../../server/src/config/RuntimeEvidence.ts#L130), [RuntimeEvidence.ts:134](../../server/src/config/RuntimeEvidence.ts#L134), [RuntimeEvidence.ts:139](../../server/src/config/RuntimeEvidence.ts#L139).

### 7.2 기동 복구

1. 저널을 복원한다. `WRITER_CONFLICT`면 fatal `WRITER_CONFLICT`, IO 실패면 fatal `INITIALIZATION_FAILED`다.
2. 재시도 체크포인트를 읽는다. 첫 설치 허가는 다음이 모두 참일 때만 쓴다: 저널 기록 0·순번 0, 재시도 체크포인트 없음, 증거의 첫 설치 확인. 허가되면 없는 usage 원장을 만들 수 있다.
3. usage 예산을 복원한다. 모든 저장소가 정상이면 이전 프로세스의 `PREPARED`/`RESERVING` 기록 중 예약도 재시도도 없는 것을 빈 중단(`ABORTED`)으로 닫는다.
4. 복구 기록을 재조정한다. 사유 코드가 나오면 readiness를 잠근다. 재조정 자체가 실패하면 `RECOVERY_UNCONFIRMED`, 재시도 체크포인트를 쓸 수 없으면 `RETRY_CHECKPOINT_UNREADABLE`로 잠근다.
5. 결과는 `initialized` + admission `DRAINING` + readiness `RECOVERING`/`LOCKED`다. 원격 정리는 기다리지 않고 비동기로 시작한다.
   - 정리 함수가 없으면 `CLEANUP_NOT_CONFIGURED`, 정리 예외는 `CLEANUP_FAILED`로 잠근다.
   - 이력 불완전(`JOURNAL_HISTORY_MISSING`, `USAGE_HISTORY_MISSING`, `RESERVATION_HISTORY_MISMATCH`만 있음)이어도 media 쪽 허가가 있으면 관찰된 자원 정리를 진행한다.
6. 이어 운영 감사를 복원한다. 실패하면 `AUDIT_WRITE_FAILED`로 잠근다.
7. 기동 후 OPEN은 `resume` 명령으로만 된다.
8. 닫을 때는 `CLOSED`로 잠그고 정리·usage·재시도 쓰기를 끝낸 뒤 저널 lease를 푼다.

근거: [RecoveryBootstrap.ts:99](../../server/src/operations/RecoveryBootstrap.ts#L99), [RecoveryBootstrap.ts:100](../../server/src/operations/RecoveryBootstrap.ts#L100), [RecoveryBootstrap.ts:106](../../server/src/operations/RecoveryBootstrap.ts#L106), [RecoveryBootstrap.ts:131](../../server/src/operations/RecoveryBootstrap.ts#L131), [RecoveryBootstrap.ts:142](../../server/src/operations/RecoveryBootstrap.ts#L142), [RecoveryBootstrap.ts:170](../../server/src/operations/RecoveryBootstrap.ts#L170), [RecoveryBootstrap.ts:173](../../server/src/operations/RecoveryBootstrap.ts#L173), [RecoveryBootstrap.ts:175](../../server/src/operations/RecoveryBootstrap.ts#L175), [RecoveryBootstrap.ts:185](../../server/src/operations/RecoveryBootstrap.ts#L185), [RecoveryBootstrap.ts:188](../../server/src/operations/RecoveryBootstrap.ts#L188), [RecoveryBootstrap.ts:200](../../server/src/operations/RecoveryBootstrap.ts#L200), [RecoveryBootstrap.ts:227](../../server/src/operations/RecoveryBootstrap.ts#L227), [RecoveryBootstrap.ts:248](../../server/src/operations/RecoveryBootstrap.ts#L248), [RecoveryBootstrap.ts:295](../../server/src/operations/RecoveryBootstrap.ts#L295), [ReadinessRuntime.ts:144](../../server/src/health/ReadinessRuntime.ts#L144), [ReadinessRuntime.ts:147](../../server/src/health/ReadinessRuntime.ts#L147).

### 7.3 사용량 예산

예약 한 건의 분은 `ceil(slots × expectedMinutes × (1+margin))`, 바이트는 `ceil(expectedBytes × (1+margin))`다. attested 모드의 목적별 몫(남은 공식 예산 대비 분/바이트)은 다음과 같다.

| 목적          | 분   | 바이트 |
| ------------- | ---- | ------ |
| `development` | 0.2  | 0.2    |
| `load`        | 0.24 | 0.2    |
| `public`      | 0.4  | 0.4    |
| `reserve`     | 0.16 | 0.2    |

예약 거절 코드와 조건은 다음과 같다.

| 코드                                    | 조건                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `STORAGE_FAILURE`                       | 닫힘, 쓰기 실패, 저장소 쓰기 불가                                       |
| `BUDGET_STALE`                          | 압축 시각보다 현재가 이름, 또는 공식 체크포인트가 최신성 한도 초과·미래 |
| `BUDGET_UNCONFIRMED`                    | 복원 전, 무결성 ok 아님, attested인데 공식 예산 없음                    |
| `UNRESOLVED_RETIREMENT`                 | RETIRING 예약 존재, 이미 종료된 예약 ID 재사용                          |
| `ISSUANCE_BLOCKED`                      | 발급 문(`canIssue`) 닫힘                                                |
| `ID_CONFLICT`                           | 같은 ID에 다른 내용                                                     |
| `INVALID_REQUEST`                       | 요청 형식, 압축 뒤 시각 불명 ID                                         |
| `MINUTES_EXHAUSTED` / `BYTES_EXHAUSTED` | 남은 공식 분/바이트 초과(attested)                                      |
| `BUCKET_EXHAUSTED`                      | 목적별 몫 초과(attested)                                                |

예약 상태는 `ACTIVE` → `RETIRING` → `AWAITING_OFFICIAL`(attested) 또는 `RELEASED`(continuous)로 간다. attested의 `RELEASED`는 다음이 모두 참일 때만이다.

- 원격 확인 뒤 새 공식 체크포인트가 들어옴
- 공식 체크포인트의 확인 시각이 회수·원격 확인 시각 이후임
- 같은 기간이면 버전이 더 높음

공식 예산 반영은 다음 경우 거절된다: 같은 revision에 다른 내용은 `REVISION_CONFLICT`, 더 오래된 시각이나 버전은 `STALE_REVISION`, 이력 없음은 `USAGE_HISTORY_MISSING`, continuous는 `PROVIDER_QUOTA_POLICY`. 24시간이 지난 RELEASED 묶음은 256개 단위로 압축된다. 이 작업은 media 유지보수 루프가 부른다. 예약 크기 추정은 media.md가 소유한다.

근거: [UsageBudget.ts:23](../../server/src/operations/UsageBudget.ts#L23), [UsageBudget.ts:37](../../server/src/operations/UsageBudget.ts#L37), [UsageBudget.ts:149](../../server/src/operations/UsageBudget.ts#L149), [UsageBudget.ts:151](../../server/src/operations/UsageBudget.ts#L151), [UsageBudget.ts:161](../../server/src/operations/UsageBudget.ts#L161), [UsageBudget.ts:287](../../server/src/operations/UsageBudget.ts#L287), [UsageBudget.ts:324](../../server/src/operations/UsageBudget.ts#L324), [UsageBudget.ts:329](../../server/src/operations/UsageBudget.ts#L329), [UsageBudget.ts:335](../../server/src/operations/UsageBudget.ts#L335), [UsageBudget.ts:358](../../server/src/operations/UsageBudget.ts#L358), [UsageBudget.ts:407](../../server/src/operations/UsageBudget.ts#L407), [UsageBudget.ts:484](../../server/src/operations/UsageBudget.ts#L484), [DurableRetentionPlan.ts:9](../../server/src/operations/DurableRetentionPlan.ts#L9), [DurableRetentionPlan.ts:10](../../server/src/operations/DurableRetentionPlan.ts#L10), [MediaCoordinator.ts:360](../../server/src/media/MediaCoordinator.ts#L360).

### 7.4 회수 재시도

| 규칙                                    | 값                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 첫 시도                                 | 시작 후 `max(1,000ms, 공급자 retryAfter)`                                                                                        |
| 자동 재시도 간격                        | 1,000 → 2,000 → 4,000ms(최대 3회), 공급자 retryAfter가 더 크면 그것                                                              |
| 전체 기한                               | 첫 회수 시각부터 10,000ms. 넘으면 `UNRESOLVED`(경보)                                                                             |
| 공급자 `blocked` 또는 잘못된 retryAfter | 즉시 `UNRESOLVED` + `providerWaitUnknown`                                                                                        |
| 운영자 재시도 거절                      | `RETRY_NOT_FOUND`, `RETRY_IN_FLIGHT`, `PROVIDER_WAIT_UNCONFIRMED`, `RETRY_NOT_DUE`, `OPERATOR_RETRY_CANCELLED`, `RETRIES_CLOSED` |
| 영속                                    | 각 상태 변경을 디스크에 쓴 뒤 반영. 쓰기 실패는 엔진을 닫는다                                                                    |

`UNRESOLVED` 전이는 `media.retirement.unresolved` metric과 이벤트로 이어져 `MEDIA_RETIREMENT_UNRESOLVED` 경보를 올린다.

근거: [RevocationRetries.ts:51](../../server/src/operations/RevocationRetries.ts#L51), [RevocationRetries.ts:162](../../server/src/operations/RevocationRetries.ts#L162), [RevocationRetries.ts:245](../../server/src/operations/RevocationRetries.ts#L245), [RevocationRetries.ts:256](../../server/src/operations/RevocationRetries.ts#L256), [RevocationRetries.ts:314](../../server/src/operations/RevocationRetries.ts#L314), [RevocationRetries.ts:450](../../server/src/operations/RevocationRetries.ts#L450), [RevocationRetries.ts:467](../../server/src/operations/RevocationRetries.ts#L467), [RevocationRetries.ts:492](../../server/src/operations/RevocationRetries.ts#L492), [RevocationRetries.ts:518](../../server/src/operations/RevocationRetries.ts#L518), [MediaCoordinator.ts:324](../../server/src/media/MediaCoordinator.ts#L324).

### 7.5 배포 전 점검

`checkProductDeployment`는 배포 스크립트가 쓰는 읽기 전용 점검이며 `PREPARED` 또는 `BLOCKED`를 돌려준다. 실패 사유는 다음과 같다.

| 사유                         | 조건                                               |
| ---------------------------- | -------------------------------------------------- |
| `PUBLIC_ORIGIN_INVALID`      | 공개 주소가 `^https://[a-z0-9.-]+$`가 아님         |
| `PRODUCT_ENV_INVALID`        | product+livekit+hops 1 강제 설정으로 검사 실패     |
| `PRODUCT_CAPACITY_MISSING`   | `MAX_ROOMS`나 `MAX_SLOTS`가 없음                   |
| `PRODUCT_POLICY_MISSING`     | alias, attested 예산 최신성, 공개창 중 하나가 없음 |
| `PUBLIC_WINDOW_TOO_SHORT`    | 창이 열리기 전이거나 330초 안에 닫힘               |
| `RUNTIME_EVIDENCE_INVALID`   | 증거 파일 검증 실패                                |
| `OFFICIAL_EVIDENCE_MISMATCH` | 공식 사용량과 증거 revision 불일치                 |
| `OFFICIAL_USAGE_INVALID`     | 공식 사용량 입력 오류                              |
| capability 사유              | capability 보고의 사유 그대로(media.md)            |

근거: [ProductDeployment.ts:15](../../server/src/config/ProductDeployment.ts#L15), [ProductDeployment.ts:29](../../server/src/config/ProductDeployment.ts#L29), [ProductDeployment.ts:32](../../server/src/config/ProductDeployment.ts#L32), [ProductDeployment.ts:39](../../server/src/config/ProductDeployment.ts#L39), [ProductDeployment.ts:43](../../server/src/config/ProductDeployment.ts#L43), [ProductDeployment.ts:63](../../server/src/config/ProductDeployment.ts#L63), [ProductDeployment.ts:67](../../server/src/config/ProductDeployment.ts#L67), [ProductDeployment.ts:69](../../server/src/config/ProductDeployment.ts#L69), [ProductDeployment.ts:74](../../server/src/config/ProductDeployment.ts#L74).

## 8. 제품 Room

### 8.1 입장

| 단계     | 거절                                 | 조건                                                                                                    | 상태      |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------- |
| onAuth   | `NOT_READY`                          | strict이고 준비 문이 없거나(`undefined`) 거짓. 데모 방 코드면 데모 준비 문                              | 503       |
| onAuth   | `INVALID_JOIN`                       | `productJoinOptionsSchema` `{token, roomCode, protocolVersion}` 불일치                                  | 400       |
| onAuth   | `PROTOCOL_MISMATCH`                  | 버전 ≠ `0.2.0`                                                                                          | 409       |
| onAuth   | `INVALID_SESSION`                    | 세션 인증 실패                                                                                          | 401       |
| onAuth   | `WRONG_ROOM`                         | 세션 방 ≠ 요청 방                                                                                       | 403       |
| onAuth   | `ROOM_CLOSED`                        | 자리 없음·RETIRING, RESERVED인데 가입 불가(닫는 중·잠김·대기 단계 아님), 대기 단계가 아닌데 JOINED 아님 | 403       |
| onAuth   | `SESSION_IN_USE`                     | 세션에 연결이 있음                                                                                      | 409       |
| onCreate | `ROOM_NOT_AVAILABLE`                 | `roomCode`가 등록부에 없음                                                                              | 404       |
| onJoin   | `ROOM_CLOSED`                        | 방 닫는 중, 단계가 LOBBY·DEVICE_CHECK 아님(데모는 PLAYING·RESULT·ABORTED도 허용), 자리 JOINED 전환 실패 | 403       |
| onJoin   | `NOT_READY`                          | 준비 문 재검사(onAuth와 같은 규칙: 문이 없거나 거짓)                                                    | 503       |
| onJoin   | `WRONG_ROOM`                         | 인증 결과가 이 방이 아님                                                                                | 403       |
| onJoin   | `SESSION_IN_USE` / `INVALID_SESSION` | 같은 플레이어 연결 있음·claim `busy` / claim `invalid`                                                  | 409 / 401 |

입장에 성공하면 다음이 순서대로 일어난다.

1. 자리가 JOINED가 되고 세션이 연결에 묶인다.
2. media 연결 상태를 통지한다.
3. 로비 명단에 추가한다(방장 재선정). 데모 방은 첫 입장 때 인형을 채운다.
4. 하트비트에 등록한다.
5. `room-access`·`room-map`·`room-roster`를 방송한다. 셋 다 다음 patch 뒤에 나가고, `room-access`는 값이 있을 때만 나간다.
6. 입장자에게 initial 개인 뷰를 보낸다. 데모 방은 데모 상태도 보낸다.
7. 대기 판정을 다시 하고(`evaluateWaiting()`: 정원이 찼으면 DEVICE_CHECK로 전이) 공개 상태를 동기화한다(`syncPublic()`).

준비 문(`gateFor`)이 없을 때의 취급은 호출부마다 다르다. onAuth·onJoin은 문이 없으면(`undefined`) 거짓과 같이 취급해 막지만, `REMATCH` 수락 판정과 새 라운드 시작 판정은 문이 없으면 통과로 본다(`gate && !gate()`, `gateFor(...)?.() ?? true`).

Room 설정은 `maxClients`=등록부 정원, `patchRate` 50ms, Colyseus `maxMessagesPerSecond` 120이다. 데모 방만 `autoDispose` 거짓이다.

Room이 media 범위를 내주는 조건은 다음이 모두 참일 때다: 단계가 RESULT·ABORTED가 아님, 연결 중, 현재 인스턴스 종류가 요청 목적과 같음, 코어상 ACTIVE, `mediaInstanceId`가 있음. grant는 이 범위에서 첫 media 프레임이 관찰된 뒤에만 준비를 시작하고, `canStart`가 거짓이면 준비하지 않는다.

근거: [KkakkungRoom.ts:595](../../server/src/rooms/KkakkungRoom.ts#L595), [KkakkungRoom.ts:597](../../server/src/rooms/KkakkungRoom.ts#L597), [KkakkungRoom.ts:599](../../server/src/rooms/KkakkungRoom.ts#L599), [KkakkungRoom.ts:601](../../server/src/rooms/KkakkungRoom.ts#L601), [KkakkungRoom.ts:602](../../server/src/rooms/KkakkungRoom.ts#L602), [KkakkungRoom.ts:604](../../server/src/rooms/KkakkungRoom.ts#L604), [KkakkungRoom.ts:608](../../server/src/rooms/KkakkungRoom.ts#L608), [KkakkungRoom.ts:611](../../server/src/rooms/KkakkungRoom.ts#L611), [KkakkungRoom.ts:621](../../server/src/rooms/KkakkungRoom.ts#L621), [KkakkungRoom.ts:695](../../server/src/rooms/KkakkungRoom.ts#L695), [KkakkungRoom.ts:696](../../server/src/rooms/KkakkungRoom.ts#L696), [KkakkungRoom.ts:698](../../server/src/rooms/KkakkungRoom.ts#L698), [KkakkungRoom.ts:700](../../server/src/rooms/KkakkungRoom.ts#L700), [KkakkungRoom.ts:704](../../server/src/rooms/KkakkungRoom.ts#L704), [KkakkungRoom.ts:707](../../server/src/rooms/KkakkungRoom.ts#L707), [KkakkungRoom.ts:713](../../server/src/rooms/KkakkungRoom.ts#L713), [KkakkungRoom.ts:726](../../server/src/rooms/KkakkungRoom.ts#L726), [KkakkungRoom.ts:728](../../server/src/rooms/KkakkungRoom.ts#L728), [KkakkungRoom.ts:230](../../server/src/rooms/KkakkungRoom.ts#L230), [KkakkungRoom.ts:627](../../server/src/rooms/KkakkungRoom.ts#L627), [KkakkungRoom.ts:635](../../server/src/rooms/KkakkungRoom.ts#L635), [KkakkungRoom.ts:636](../../server/src/rooms/KkakkungRoom.ts#L636), [KkakkungRoom.ts:413](../../server/src/rooms/KkakkungRoom.ts#L413), [KkakkungRoom.ts:433](../../server/src/rooms/KkakkungRoom.ts#L433), [KkakkungRoom.ts:461](../../server/src/rooms/KkakkungRoom.ts#L461), [KkakkungRoom.ts:2441](../../server/src/rooms/KkakkungRoom.ts#L2441), [KkakkungRoom.ts:226](../../server/src/rooms/KkakkungRoom.ts#L226), [KkakkungRoom.ts:735](../../server/src/rooms/KkakkungRoom.ts#L735), [KkakkungRoom.ts:736](../../server/src/rooms/KkakkungRoom.ts#L736), [KkakkungRoom.ts:932](../../server/src/rooms/KkakkungRoom.ts#L932), [KkakkungRoom.ts:933](../../server/src/rooms/KkakkungRoom.ts#L933), [KkakkungRoom.ts:1309](../../server/src/rooms/KkakkungRoom.ts#L1309), [KkakkungRoom.ts:2443](../../server/src/rooms/KkakkungRoom.ts#L2443), [KkakkungRoom.ts:2462](../../server/src/rooms/KkakkungRoom.ts#L2462).

### 8.2 클라이언트 메시지

모든 메시지는 먼저 연결별 수신 버킷(용량 90, 초당 45 보충)을 지난다. 방이 닫히는 중이거나 버킷이 비면 응답 없이 버린다. 메시지 이름은 [protocol.md](protocol.md)가 소유한다.

| 메시지(`PRODUCT_CLIENT_MESSAGES`) | 서버 처리                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`                         | [8.3](#83-명령)                                                                                                                                      |
| `requestStatus`                   | 자기 요청만 `pending`/`done`/`unknown`으로 응답                                                                                                      |
| `viewResync`                      | 현재 matchId일 때 초당 1회까지 전체 뷰 재전송                                                                                                        |
| `demoScenario`                    | 데모 방 운영자만, 현재 matchId, PLAYING일 때 대본 시작                                                                                               |
| `demoControl`                     | 데모 방 운영자만. `cancel-scenario`는 대본만 중단, `abort-round`는 MAP_FINALIZING·GAME_LOADING·COUNTDOWN·PLAYING에서 다음 틱에 `DEMO_OPERATOR_ABORT` |
| `heartbeatAck`                    | [9.4](#94-연결-끊김하트비트close-코드)                                                                                                               |
| `clockProbe`                      | 연결당 1초에 5회까지 `clockReply`(클라이언트 값 반사 + 서버 수신·송신 단조 시각 + epoch). 게임 상태·TTL·생존과 무관                                  |
| `mediaBindingsRefresh`            | 플레이어당 1초에 1회, 마지막 바인딩 재전송                                                                                                           |
| 그 밖의 이름                      | 무시                                                                                                                                                 |

근거: [KkakkungRoom.ts:238](../../server/src/rooms/KkakkungRoom.ts#L238), [KkakkungRoom.ts:640](../../server/src/rooms/KkakkungRoom.ts#L640), [KkakkungRoom.ts:647](../../server/src/rooms/KkakkungRoom.ts#L647), [KkakkungRoom.ts:650](../../server/src/rooms/KkakkungRoom.ts#L650), [KkakkungRoom.ts:654](../../server/src/rooms/KkakkungRoom.ts#L654), [KkakkungRoom.ts:660](../../server/src/rooms/KkakkungRoom.ts#L660), [KkakkungRoom.ts:670](../../server/src/rooms/KkakkungRoom.ts#L670), [KkakkungRoom.ts:680](../../server/src/rooms/KkakkungRoom.ts#L680), [KkakkungRoom.ts:685](../../server/src/rooms/KkakkungRoom.ts#L685), [KkakkungRoom.ts:1541](../../server/src/rooms/KkakkungRoom.ts#L1541), [CommandQueue.ts:217](../../server/src/game/CommandQueue.ts#L217), [EventDispatcher.ts:197](../../server/src/game/EventDispatcher.ts#L197), [events.ts:7](../../packages/protocol/src/game-messages/events.ts#L7), [ClockSync.ts:34](../../server/src/game/ClockSync.ts#L34), [heartbeat.ts:9](../../packages/protocol/src/game-messages/heartbeat.ts#L9).

### 8.3 명령

처리 순서는 다음과 같다.

1. **파싱**: UTF-8 4,096바이트 초과나 envelope 스키마 실패는 `INVALID_COMMAND`, 현재 matchId와 다르면 `WRONG_MATCH`.
2. **역할 지정 재경기**: 데모가 아닌 방의 `REMATCH`에 `role`이 있으면 `NOT_ALLOWED`.
3. **명령 버킷**: 연결별 용량 60, 초당 30 보충. 비면 `RATE_LIMITED`.
4. **수락 단계 gate**: 아래 표. 준비 명령 거절은 `room.command_rejected`로 기록한다.
5. **큐**: 같은 requestId를 다른 actor가 보냈거나 내용이 다르면, 또는(같은 requestId가 없을 때) sequence가 마지막 이하면 `STALE_REQUEST`. 이 중복 검사가 sequence 검사보다 먼저 실행된다. actor당 대기 64, 방당 384를 넘으면 `QUEUE_FULL`. 완전히 같은 requestId·내용의 중복이면 원래 receipt와(있으면) outcome을 재전송.
6. 수락하면 세션 lease를 연장하고 `commandResult`(receipt)를 보낸다. 적용 결과 `commandOutcome`은 틱에서 따로 보낸다.

core 명령은 `MOVE_INTENT`, `TURN`, `GRAB_INTENT`, `EXCHANGE_REQUEST`, `EXCHANGE_ACCEPT`, `EXCHANGE_CANCEL`, `INSTALL`, `INSTALL_CANCEL`, `EXIT_START`, `EXIT_CANCEL`, `EXIT_PROGRESS`다. 수락 조건은 단계가 `TEAM_PRACTICE`나 `PLAYING`이어야 하고(아니면 `INVALID_PHASE`), 참가자가 인스턴스에 있어야 한다(아니면 `NOT_ACTIVE`). 규칙 거절 코드는 [game-core.md](game-core.md)가 소유한다.

| 단계 명령        | 수락 단계                                                 | 수락 추가 조건                                  | 실행 시 거절                                                                                                                                                 |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `READY`          | DEVICE_CHECK                                              | —                                               | 단계 `INVALID_PHASE`, 미연결 `NOT_ACTIVE`                                                                                                                    |
| `ROOM_LOCK`      | LOBBY, DEVICE_CHECK                                       | 방장 아니면 `NOT_ALLOWED`                       | 데모 방 `NOT_ALLOWED`, 단계 `INVALID_PHASE`, 방장·연결 아님 `NOT_ALLOWED`                                                                                    |
| `ROOM_KICK`      | LOBBY, DEVICE_CHECK                                       | 방장                                            | 위와 같음, 대상 미연결·자기 자신 `NOT_ALLOWED`                                                                                                               |
| `ROOM_MAP_SIZE`  | LOBBY, DEVICE_CHECK. 시연 방은 없음(항상 `INVALID_PHASE`) | 방장                                            | 단계 `INVALID_PHASE`, 방장·연결 아님 `NOT_ALLOWED`                                                                                                           |
| `ROOM_START`     | DEVICE_CHECK                                              | 방장                                            | 단계 `INVALID_PHASE`, 방장·연결 아님 `NOT_ALLOWED`, 연결자 전원 준비 아님 `NOT_READY`                                                                        |
| `PRACTICE_READY` | TEAM_PRACTICE                                             | —                                               | 연습 비활성·팀 밖 `INVALID_PHASE`                                                                                                                            |
| `LOAD_READY`     | GAME_LOADING                                              | —                                               | 장벽 없음 `INVALID_PHASE`, loadId 다름 `EXPIRED`, mediaInstanceId 다름 `NOT_ALLOWED`, 수신 세대 없음·다름 `NOT_READY`                                        |
| `REMATCH`        | RESULT, ABORTED                                           | 시연 방 `NOT_ALLOWED`. 준비 문 거짓 `NOT_READY` | 단계 `INVALID_PHASE`, 방장 아님 `NOT_ALLOWED`                                                                                                                |
| `SPECTATE`       | PLAYING                                                   | —                                               | 경기 인스턴스 없음 `INVALID_PHASE`, 대상이 같은 팀 생존 도망자 후보에 없음 `NOT_ALLOWED`, 요청자가 개인 종료한 도망자가 아님(관전 대상이 없음) `NOT_ALLOWED` |

`ROOM_START`의 결과가 `applied`여도 연습이 바로 시작되지는 않는다. 다음 조건 중 하나에 걸리면 DEVICE_CHECK에 남고 `blockedReason`이 붙는다([9.2](#92-준비-실패-안내)).

- 준비 문 거짓: `NOT_READY`
- 이전 media 미회수: `PRACTICE_MEDIA_NOT_READY`
- 월 사용량 초과(데모 제외): `MEDIA_MONTHLY_LIMIT`
- 경기 예산 초과: `MATCH_CAPACITY`
- 코어·연습·튜닝 누락: `PRACTICE_PRODUCER_MISSING`
- 연습 배치 실패: `PRACTICE_LAYOUT:<사유 경로>`(공개값은 [9.2](#92-준비-실패-안내)의 `LAYOUT_UNAVAILABLE`)

`ROOM_LOCK`은 가입 잠금을 바꾸고, 잠글 때(`setWaitingLock(true)`) RESERVED 자리와 그 세션을 무효화한다. `ROOM_KICK`은 다음을 순서대로 한다: 먼저 같은 잠금 함수로 방을 잠그고 RESERVED 자리·세션을 무효화한 뒤, 현재 초대를 회수하고(`onKickRoom`은 초대 회수만 하고 자리는 건드리지 않는다), 대상을 제거한 뒤 close 4002 `REMOVED_BY_HOST`로 내보낸다.

근거: [CommandAdapter.ts:38](../../server/src/game/CommandAdapter.ts#L38), [CommandAdapter.ts:44](../../server/src/game/CommandAdapter.ts#L44), [product.ts:9](../../packages/protocol/src/game-messages/product.ts#L9), [product.ts:120](../../packages/protocol/src/game-messages/product.ts#L120), [KkakkungRoom.ts:848](../../server/src/rooms/KkakkungRoom.ts#L848), [KkakkungRoom.ts:854](../../server/src/rooms/KkakkungRoom.ts#L854), [CommandLimiter.ts:11](../../server/src/game/CommandLimiter.ts#L11), [KkakkungRoom.ts:860](../../server/src/rooms/KkakkungRoom.ts#L860), [KkakkungRoom.ts:881](../../server/src/rooms/KkakkungRoom.ts#L881), [KkakkungRoom.ts:889](../../server/src/rooms/KkakkungRoom.ts#L889), [KkakkungRoom.ts:904](../../server/src/rooms/KkakkungRoom.ts#L904), [KkakkungRoom.ts:907](../../server/src/rooms/KkakkungRoom.ts#L907), [KkakkungRoom.ts:922](../../server/src/rooms/KkakkungRoom.ts#L922), [KkakkungRoom.ts:928](../../server/src/rooms/KkakkungRoom.ts#L928), [KkakkungRoom.ts:933](../../server/src/rooms/KkakkungRoom.ts#L933), [KkakkungRoom.ts:976](../../server/src/rooms/KkakkungRoom.ts#L976), [KkakkungRoom.ts:986](../../server/src/rooms/KkakkungRoom.ts#L986), [KkakkungRoom.ts:989](../../server/src/rooms/KkakkungRoom.ts#L989), [KkakkungRoom.ts:994](../../server/src/rooms/KkakkungRoom.ts#L994), [KkakkungRoom.ts:1019](../../server/src/rooms/KkakkungRoom.ts#L1019), [KkakkungRoom.ts:1087](../../server/src/rooms/KkakkungRoom.ts#L1087), [KkakkungRoom.ts:1089](../../server/src/rooms/KkakkungRoom.ts#L1089), [KkakkungRoom.ts:1090](../../server/src/rooms/KkakkungRoom.ts#L1090), [KkakkungRoom.ts:1105](../../server/src/rooms/KkakkungRoom.ts#L1105), [KkakkungRoom.ts:1355](../../server/src/rooms/KkakkungRoom.ts#L1355), [KkakkungRoom.ts:1620](../../server/src/rooms/KkakkungRoom.ts#L1620), [Spectate.ts:30](../../server/src/game/Spectate.ts#L30), [Spectate.ts:31](../../server/src/game/Spectate.ts#L31), [LobbyCoordinator.ts:94](../../server/src/rooms/LobbyCoordinator.ts#L94), [PracticeCoordinator.ts:51](../../server/src/rooms/PracticeCoordinator.ts#L51), [LoadingCoordinator.ts:82](../../server/src/rooms/LoadingCoordinator.ts#L82), [RematchCoordinator.ts:32](../../server/src/rooms/RematchCoordinator.ts#L32), [CommandQueue.ts:17](../../server/src/game/CommandQueue.ts#L17), [CommandQueue.ts:92](../../server/src/game/CommandQueue.ts#L92), [CommandQueue.ts:94](../../server/src/game/CommandQueue.ts#L94), [CommandQueue.ts:103](../../server/src/game/CommandQueue.ts#L103), [CommandQueue.ts:105](../../server/src/game/CommandQueue.ts#L105), [KkakkungRoom.ts:989](../../server/src/rooms/KkakkungRoom.ts#L989), [bootstrap.ts:609](../../server/src/bootstrap.ts#L609).

### 8.4 틱

`RoomTickCoordinator`는 10ms 타이머로 돌고, 방마다 50ms마다 한 틱을 실행한다.

- 한 번 실행에 최대 4라운드까지 따라잡고, 시작 방은 돌아가며 바꾼다.
- 지연이 250ms를 넘으면 그 방은 재실행하지 않고 overload 콜백을 한 번 부른다. 경기 단계(연습~PLAYING)면 `SERVER_TICK_OVERLOAD`로 중단하고, 아니면 중단 없이 넘어간다. 재무장(`coordinator.rearm`)은 `finally`에 있어 중단 여부와 무관하게, 중단 처리가 던져도 항상 일어난다.
- 틱 예외도 같은 방식으로 격리한다: 경기 단계면 `SERVER_TICK_OVERLOAD`, `blockedReason`은 `TICK_FAILED:<원인>`. 재무장은 이때도 단계와 무관하게 `finally`에서 항상 일어난다. 다른 방은 계속 돈다.
- metric `tick.due`, `tick.catchup`, `tick.overload`, `tick.duration`, `eventLoop.lag`를 낸다.

한 방의 `tick()` 순서는 다음과 같다.

1. 결과가 불확실한 준비가 330,000ms를 넘었으면 놓는다.
2. 데모 중단 요청이 있으면 `DEMO_OPERATOR_ABORT`로 중단하고 끝낸다.
3. 하트비트를 보낼 차례인 연결에 보낸다. sweep에서 끊긴 연결은 즉시 제거하고 close 4000 `HEARTBEAT_TIMEOUT`으로 내보낸다.
4. media 제어(`MEDIA_PREPARED`/`MEDIA_RETIRED`/`MEDIA_FAILED`), 바인딩, 음성 정책을 적용한다. 적군 ID는 별칭으로 가린다.
5. `MatchDriver.tick()`:
   1. 누른 이동 TTL 500ms 만료를 `EXPIRE_MOVE` 제어로 만들고, 만료된 대기 이동은 `EXPIRED`로 취소한다.
   2. 입력을 동결한다. 단계 명령은 여기서 실행하고 결과를 기록한다. 대상 인스턴스가 없거나 중단·확정된 core 명령은 `CANCELED`/`ROUND_ENDED`로 취소한다.
   3. 인스턴스마다 `stepMatch`를 정확히 한 번 호출한다.
   4. 결과를 검증한다: 프레임 인스턴스 일치, 명령 수와 결과 수 일치, 중복·모르는 결과 없음. 위반이나 예외는 그 인스턴스를 중단하고 `INTEGRITY:<id>:<사유>`로 `abortReason` null 중단한다.
   5. 상태를 확정하고 뷰를 재투영한다. outcome, 청중 이벤트, media 의도, media 프레임을 전달한다.
6. 데모 방이면 대본을 한 틱 진행한다.
7. 코어 프레임에 `abortReason`이 있으면 중단한다.
8. 단계를 진행한다([9.1](#91-상태-기계)).
9. 만료를 검사한다.
10. 공개 상태를 동기화한다.

근거: [bootstrap.ts:722](../../server/src/bootstrap.ts#L722), [RoomTickCoordinator.ts:46](../../server/src/game/RoomTickCoordinator.ts#L46), [RoomTickCoordinator.ts:87](../../server/src/game/RoomTickCoordinator.ts#L87), [RoomTickCoordinator.ts:98](../../server/src/game/RoomTickCoordinator.ts#L98), [RoomTickCoordinator.ts:127](../../server/src/game/RoomTickCoordinator.ts#L127), [KkakkungRoom.ts:2516](../../server/src/rooms/KkakkungRoom.ts#L2516), [KkakkungRoom.ts:2519](../../server/src/rooms/KkakkungRoom.ts#L2519), [KkakkungRoom.ts:2524](../../server/src/rooms/KkakkungRoom.ts#L2524), [KkakkungRoom.ts:2560](../../server/src/rooms/KkakkungRoom.ts#L2560), [KkakkungRoom.ts:2562](../../server/src/rooms/KkakkungRoom.ts#L2562), [KkakkungRoom.ts:2567](../../server/src/rooms/KkakkungRoom.ts#L2567), [KkakkungRoom.ts:206](../../server/src/rooms/KkakkungRoom.ts#L206), [KkakkungRoom.ts:1118](../../server/src/rooms/KkakkungRoom.ts#L1118), [KkakkungRoom.ts:1119](../../server/src/rooms/KkakkungRoom.ts#L1119), [KkakkungRoom.ts:1125](../../server/src/rooms/KkakkungRoom.ts#L1125), [KkakkungRoom.ts:1142](../../server/src/rooms/KkakkungRoom.ts#L1142), [KkakkungRoom.ts:1144](../../server/src/rooms/KkakkungRoom.ts#L1144), [KkakkungRoom.ts:1163](../../server/src/rooms/KkakkungRoom.ts#L1163), [KkakkungRoom.ts:1171](../../server/src/rooms/KkakkungRoom.ts#L1171), [KkakkungRoom.ts:388](../../server/src/rooms/KkakkungRoom.ts#L388), [MatchDriver.ts:189](../../server/src/game/MatchDriver.ts#L189), [MatchDriver.ts:212](../../server/src/game/MatchDriver.ts#L212), [MatchDriver.ts:231](../../server/src/game/MatchDriver.ts#L231), [MatchDriver.ts:266](../../server/src/game/MatchDriver.ts#L266), [MatchDriver.ts:323](../../server/src/game/MatchDriver.ts#L323), [MatchDriver.ts:298](../../server/src/game/MatchDriver.ts#L298), [CommandQueue.ts:22](../../server/src/game/CommandQueue.ts#L22).

### 8.5 개인 뷰와 가림

- 개인 뷰는 전체 교체본이다. 다음 경우에 보낸다: 첫 전달, 내용 변경, 범위 변경, 공개 단계 변경, 재동기화 요청.
  - 내용 변경(`change`)이면 `stateVersion`을 올린다.
  - `initial`·`scope` 사유(재동기화 `resync`·단계 변경 `phase`는 제외)로 보낼 때, 계산된 `stateVersion`이 그 플레이어에게 이전에 전달한 버전 이하이면 한 번 더 올린다. 새로 뷰를 받는 플레이어나 범위가 바뀐 플레이어에게 과거 버전을 다시 보내지 않기 위해서다.
  - 지식 배열(`knownTerrain`, `knownActiveExits`)은 `change`이면서 지식이 그대로일 때만 생략한다. 이때 `knowledgeRevision`으로 재사용을 알린다.
- 이벤트는 받는 사람이 이벤트를 만든 인스턴스 범위에 있을 때만 보낸다.
- 투영 규칙은 다음과 같다.
  - ACTIVE가 아닌 자기는 최소 기록만 받는다.
  - 술래는 출구를 받지 않는다.
  - 센서는 벽면이 있을 때만 보인다.
  - 보이는 플레이어는 같은 역할이면 역할 표시를, 적군이면 역할 없이 별칭 ID(`anon-` + 12자)를 받는다.
- 별칭은 개인 뷰·media 바인딩·음성 정책에 같게 쓰이고, 인스턴스를 회수할 때 지워진다.
- 개인 종료한 도망자는 PLAYING 동안 같은 팀 생존 도망자의 뷰(`spectating` 포함)를 받는다. 대상은 선택이 살아 있으면 그 사람이고, 아니면 명단 순서 첫째다.

근거: [EventDispatcher.ts:112](../../server/src/game/EventDispatcher.ts#L112), [EventDispatcher.ts:122](../../server/src/game/EventDispatcher.ts#L122), [EventDispatcher.ts:124](../../server/src/game/EventDispatcher.ts#L124), [EventDispatcher.ts:130](../../server/src/game/EventDispatcher.ts#L130), [EventDispatcher.ts:147](../../server/src/game/EventDispatcher.ts#L147), [EventDispatcher.ts:166](../../server/src/game/EventDispatcher.ts#L166), [PlayerProjection.ts:103](../../server/src/game/PlayerProjection.ts#L103), [PlayerProjection.ts:107](../../server/src/game/PlayerProjection.ts#L107), [PlayerProjection.ts:234](../../server/src/game/PlayerProjection.ts#L234), [PlayerProjection.ts:250](../../server/src/game/PlayerProjection.ts#L250), [EnemyAliases.ts:37](../../server/src/game/EnemyAliases.ts#L37), [EnemyAliases.ts:55](../../server/src/game/EnemyAliases.ts#L55), [KkakkungRoom.ts:1983](../../server/src/rooms/KkakkungRoom.ts#L1983), [KkakkungRoom.ts:2389](../../server/src/rooms/KkakkungRoom.ts#L2389), [Spectate.ts:25](../../server/src/game/Spectate.ts#L25).

## 9. 방 생명주기

### 9.1 상태 기계

| 현재                    | 전이 조건                                                                             | 다음                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOBBY`                 | 연결 수 ≥ 정원(일반 6, 시연 4, 데모는 운영자 + 인형 5)                                | `DEVICE_CHECK`                                                                                                                                                         |
| `DEVICE_CHECK`          | 연결 수 < 정원                                                                        | READY 해제 후 `LOBBY`                                                                                                                                                  |
| `DEVICE_CHECK`          | `ROOM_START` 실행 + 연습 시작 조건 통과                                               | `TEAM_PRACTICE`(역할 3:3 또는 시연 2:2, 팀별 연습 인스턴스)                                                                                                            |
| `DEVICE_CHECK`          | 단계 시작 후 300,000ms                                                                | 미준비 연결자 close 4002 `DEVICE_CHECK_TIMEOUT`, RESERVED 해제 후 `LOBBY`. 제거할 사람이 없으면 방을 4001로 닫음                                                       |
| `TEAM_PRACTICE`         | 연결자 전원 `PRACTICE_READY`                                                          | 그 시점 장치 READY 여부와 무관하게 곧바로 `MAP_FINALIZING`                                                                                                             |
| `TEAM_PRACTICE`         | 60,000ms 경과(전원 `PRACTICE_READY`는 아님)                                           | 그 시점 연결자 전원이 장치 READY면 `MAP_FINALIZING`, 한 명이라도 아니면 `DEVICE_CHECK`                                                                                 |
| `TEAM_PRACTICE`         | 위 두 전이 전에 media가 있으면                                                        | 모두의 연습 세대가 확정될 때까지 보류. 60초까지 미확정이면 준비 대기 중이던 것이 있을 때 ABORTED `MEDIA_UNAVAILABLE`, 없으면 `DEVICE_CHECK` `PRACTICE_MEDIA_NOT_READY` |
| `MAP_FINALIZING`        | 미해결 media 없음 → 맵 준비 성공 → 경기 인스턴스 생성 성공                            | `GAME_LOADING`                                                                                                                                                         |
| `MAP_FINALIZING`        | 맵 준비 실패                                                                          | `DEVICE_CHECK`(`LAYOUT:<사유>`)                                                                                                                                        |
| `MAP_FINALIZING`        | 맵 준비는 성공했으나 경기 인스턴스 생성 실패(코어·튜닝 없음, 또는 `createMatch` 예외) | `DEVICE_CHECK`(`CORE_MISSING` 또는 `MATCH_CREATE:<원인>`)                                                                                                              |
| `MAP_FINALIZING`        | 30,000ms                                                                              | ABORTED(미해결 media 있으면 `MEDIA_UNAVAILABLE`, 없으면 사유 null)                                                                                                     |
| `GAME_LOADING`          | 전원 `LOAD_READY` ∧ (media 있으면 자기 얼굴 트랙 확인) ∧ 준비 문                      | `COUNTDOWN`(시작 = now+3,000ms)                                                                                                                                        |
| `GAME_LOADING`          | 30,000ms                                                                              | `DEVICE_CHECK`(`LOADING_TIMEOUT`)                                                                                                                                      |
| `COUNTDOWN`             | 3초 경과 → `START_PLAYING` 제어 → 코어 PLAYING                                        | `PLAYING`(마감 틱 = 시작 + `roundTicks`, 데모는 없음)                                                                                                                  |
| `COUNTDOWN`             | 15,000ms                                                                              | `DEVICE_CHECK`(`COUNTDOWN_TIMEOUT`)                                                                                                                                    |
| `PLAYING`               | 코어 결과                                                                             | `RESULT`(인스턴스 확정, 대기 명령 `ROUND_ENDED`)                                                                                                                       |
| 연습~PLAYING            | 중단 사유                                                                             | `ABORTED`                                                                                                                                                              |
| TEAM_PRACTICE~COUNTDOWN | 참가자 이탈                                                                           | 라운드 폐기 후 `LOBBY`(`PLAYER_LEFT_DURING_PREPARATION`)                                                                                                               |
| `RESULT`, `ABORTED`     | 방장 `REMATCH` 요청 ∧ 미해결 media 없음(불확실 준비 제외) ∧ 준비 문                   | 새 matchId의 `LOBBY`                                                                                                                                                   |

`returnToDeviceCheck` 경로라도 media 준비가 진행 중이면 대신 ABORTED `MEDIA_UNAVAILABLE`로 간다. RESULT에 도달한 라운드는 이후 실패로 ABORTED가 되지 않는다.

근거: [LobbyCoordinator.ts:118](../../server/src/rooms/LobbyCoordinator.ts#L118), [LobbyCoordinator.ts:120](../../server/src/rooms/LobbyCoordinator.ts#L120), [LobbyCoordinator.ts:133](../../server/src/rooms/LobbyCoordinator.ts#L133), [KkakkungRoom.ts:1317](../../server/src/rooms/KkakkungRoom.ts#L1317), [KkakkungRoom.ts:1731](../../server/src/rooms/KkakkungRoom.ts#L1731), [KkakkungRoom.ts:1763](../../server/src/rooms/KkakkungRoom.ts#L1763), [KkakkungRoom.ts:1768](../../server/src/rooms/KkakkungRoom.ts#L1768), [PracticeCoordinator.ts:9](../../server/src/rooms/PracticeCoordinator.ts#L9), [PracticeCoordinator.ts:67](../../server/src/rooms/PracticeCoordinator.ts#L67), [PracticeCoordinator.ts:79](../../server/src/rooms/PracticeCoordinator.ts#L79), [PracticeCoordinator.ts:83](../../server/src/rooms/PracticeCoordinator.ts#L83), [KkakkungRoom.ts:1224](../../server/src/rooms/KkakkungRoom.ts#L1224), [KkakkungRoom.ts:1828](../../server/src/rooms/KkakkungRoom.ts#L1828), [KkakkungRoom.ts:1844](../../server/src/rooms/KkakkungRoom.ts#L1844), [KkakkungRoom.ts:1850](../../server/src/rooms/KkakkungRoom.ts#L1850), [KkakkungRoom.ts:1205](../../server/src/rooms/KkakkungRoom.ts#L1205), [KkakkungRoom.ts:1219](../../server/src/rooms/KkakkungRoom.ts#L1219), [KkakkungRoom.ts:100](../../server/src/rooms/KkakkungRoom.ts#L100), [KkakkungRoom.ts:1233](../../server/src/rooms/KkakkungRoom.ts#L1233), [KkakkungRoom.ts:1247](../../server/src/rooms/KkakkungRoom.ts#L1247), [LoadingCoordinator.ts:10](../../server/src/rooms/LoadingCoordinator.ts#L10), [LoadingCoordinator.ts:122](../../server/src/rooms/LoadingCoordinator.ts#L122), [KkakkungRoom.ts:1872](../../server/src/rooms/KkakkungRoom.ts#L1872), [CountdownCoordinator.ts:6](../../server/src/rooms/CountdownCoordinator.ts#L6), [KkakkungRoom.ts:112](../../server/src/rooms/KkakkungRoom.ts#L112), [KkakkungRoom.ts:1283](../../server/src/rooms/KkakkungRoom.ts#L1283), [MatchContext.ts:102](../../server/src/game/MatchContext.ts#L102), [KkakkungRoom.ts:1883](../../server/src/rooms/KkakkungRoom.ts#L1883), [KkakkungRoom.ts:796](../../server/src/rooms/KkakkungRoom.ts#L796), [KkakkungRoom.ts:1709](../../server/src/rooms/KkakkungRoom.ts#L1709), [KkakkungRoom.ts:1304](../../server/src/rooms/KkakkungRoom.ts#L1304), [KkakkungRoom.ts:1959](../../server/src/rooms/KkakkungRoom.ts#L1959), [KkakkungRoom.ts:1929](../../server/src/rooms/KkakkungRoom.ts#L1929).

### 9.2 준비 실패 안내

`blockedReason`은 LOBBY·DEVICE_CHECK에서만 공개 `preparationIssue`로 바뀌어 나간다. 경로·식별자·예외 문구는 나가지 않는다.

| 내부 진단                                                                                                                   | 공개 값                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `NOT_READY`                                                                                                                 | `SERVICE_NOT_READY`                                                       |
| `LOADING_TIMEOUT`, `DEVICE_CHECK_TIMEOUT`                                                                                   | `DEVICE_LOADING_TIMEOUT`                                                  |
| `PRACTICE_MEDIA_NOT_READY`                                                                                                  | `MEDIA_NOT_READY`                                                         |
| `MEDIA_MONTHLY_LIMIT`                                                                                                       | `MEDIA_BUDGET_EXHAUSTED`                                                  |
| `MATCH_CAPACITY`                                                                                                            | `MATCH_CAPACITY_FULL`(매 틱 다시 보고, 자리가 나면 `MATCH_CAPACITY_OPEN`) |
| `MATCH_CAPACITY_OPEN`                                                                                                       | `MATCH_SLOT_AVAILABLE`                                                    |
| `LAYOUT:*`, `PRACTICE_LAYOUT:*`                                                                                             | `LAYOUT_UNAVAILABLE`                                                      |
| 그 밖(`COUNTDOWN_TIMEOUT`, `MATCH_CREATE:*`, `CORE_MISSING`, `PLAYER_LEFT_DURING_PREPARATION`, `PRACTICE_PRODUCER_MISSING`) | `PREPARATION_UNAVAILABLE`                                                 |

그 밖의 공개 필드는 다음과 같다.

- `rematchState`(RESULT·ABORTED에서만): 요청 있음 `requested`, 미해결 media `settling`, 그 밖 `available`
- `roomExpiresInSeconds`: 남은 수명이 60초 이하일 때만
- `abortedBy`: ABORTED이고 연결 상실로 무효가 됐을 때 끊긴 사람 닉네임

근거: [preparation-issue.ts:4](../../server/src/rooms/preparation-issue.ts#L4), [KkakkungRoom.ts:1183](../../server/src/rooms/KkakkungRoom.ts#L1183), [KkakkungRoom.ts:2479](../../server/src/rooms/KkakkungRoom.ts#L2479), [KkakkungRoom.ts:2482](../../server/src/rooms/KkakkungRoom.ts#L2482), [KkakkungRoom.ts:2495](../../server/src/rooms/KkakkungRoom.ts#L2495), [KkakkungRoom.ts:1943](../../server/src/rooms/KkakkungRoom.ts#L1943).

### 9.3 중단 사유

| 공개 `abortReason`       | 발생 조건                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAME_CONNECTION_LOST`   | 경기 참가자의 연결 상실 제어를 코어가 판정(코어 프레임)                                                                                                                                                                                                                                                                               |
| `SERVER_TICK_OVERLOAD`   | 틱 지연 250ms 초과, 틱 예외, 방의 미포착 예외(onCreate/onAuth/onJoin 제외)                                                                                                                                                                                                                                                            |
| `MEDIA_UNAVAILABLE`      | media 준비 실패(`MEDIA_PREPARE:<code>`), 연습 만료 시 준비 대기, MAP_FINALIZING 30초 + 미해결 media, MAP_FINALIZING에서 연습 회수 재시도 대상 세대의 회수 실패(코드가 `POLICY_UNKNOWN`이 아닌 `MEDIA_FAILED`), 로딩·연습 중 `MEDIA_FAILED`, PLAYING·COUNTDOWN 중 `MEDIA_FAILED`(코어 `ABORT_MATCH` 경유), 준비 대기 중 장치 점검 복귀 |
| `MEDIA_POLICY_UNCERTAIN` | `MEDIA_FAILED` 코드 `POLICY_UNKNOWN`(PLAYING·COUNTDOWN, MAP_FINALIZING의 회수 실패)                                                                                                                                                                                                                                                   |
| `DEMO_OPERATOR_ABORT`    | 데모 운영자 `abort-round`                                                                                                                                                                                                                                                                                                             |
| 없음(null)               | MAP_FINALIZING 30초에 미해결 media 없음, 인스턴스 무결성 실패(`INTEGRITY:*`)                                                                                                                                                                                                                                                          |

중단되면 다음이 일어난다.

- `room.preparation_failed`와 `room.match_aborted` 이벤트를 남긴다. 연결 상실 중단에는 끊긴 도망자·술래 수를 담는다.
- 모든 인스턴스를 회수하고 대기 명령을 `ROUND_ENDED`로 취소한다.

근거: [game-schema/product.ts:64](../../packages/protocol/src/game-schema/product.ts#L64), [KkakkungRoom.ts:2278](../../server/src/rooms/KkakkungRoom.ts#L2278), [KkakkungRoom.ts:2287](../../server/src/rooms/KkakkungRoom.ts#L2287), [KkakkungRoom.ts:1171](../../server/src/rooms/KkakkungRoom.ts#L1171), [KkakkungRoom.ts:2521](../../server/src/rooms/KkakkungRoom.ts#L2521), [KkakkungRoom.ts:2591](../../server/src/rooms/KkakkungRoom.ts#L2591), [KkakkungRoom.ts:2264](../../server/src/rooms/KkakkungRoom.ts#L2264), [KkakkungRoom.ts:2284](../../server/src/rooms/KkakkungRoom.ts#L2284), [KkakkungRoom.ts:2304](../../server/src/rooms/KkakkungRoom.ts#L2304), [KkakkungRoom.ts:2310](../../server/src/rooms/KkakkungRoom.ts#L2310), [KkakkungRoom.ts:1122](../../server/src/rooms/KkakkungRoom.ts#L1122), [KkakkungRoom.ts:1235](../../server/src/rooms/KkakkungRoom.ts#L1235), [KkakkungRoom.ts:1934](../../server/src/rooms/KkakkungRoom.ts#L1934).

### 9.4 연결 끊김·하트비트·close 코드

- 서버는 연결마다 2,000ms마다 `heartbeat {serverEpoch, matchId, heartbeatSeq, serverTick, serverTimeMs}`를 보낸다.
- ack는 같은 epoch·matchId이고, 보낸 적이 있으며, 아직 ack되지 않은 순번일 때만 생존을 갱신한다.
- 6,000ms 동안 유효 ack가 없으면 `CONNECTION_LOST`를 한 번 낸다.
- 서버 sweep 간격이 2,000ms 이상 벌어지면 그 멈춤 구간은 침묵으로 세지 않는다. 멈춤 직전까지의 침묵은 이어서 센다. 이때 `room.heartbeat_stall`(길이, 연결 수)을 남긴다.
- 소켓이 닫히면 즉시 한 번 끊김으로 처리한다. 새 라운드에는 생존 기록을 다시 시작한다.

끊긴 사람은 다음과 같이 처리된다.

- 연결·명령 버킷·클럭 창을 정리하고 세션 연결을 푼다.
- **데모가 아니면**:
  - 경기 인스턴스에 있던 사람은 끊김 기록에 남긴다(연습 중이면 남기지 않음). media 통지, 코어 `CONNECTION_LOST` 제어, 세대 회수를 한다.
  - 미해결 media가 있으면 자리를 RETIRING, 없으면 해제한다.
  - 명단에서 빼고 세션을 무효화한다. 일반 참가자는 같은 세션으로 다시 들어올 수 없다.
- LOBBY·DEVICE_CHECK에서 떠나면 자리를 해제하고 대기 단계를 재평가한다.
- TEAM_PRACTICE~COUNTDOWN에서 떠나면 라운드를 폐기하고 LOBBY로 간다.

| close 코드                        | 이유 문자열                                | 조건                                                                |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| 4000                              | `HEARTBEAT_TIMEOUT`                        | 하트비트 무응답                                                     |
| 4001 `ROOM_EXPIRED_CLOSE_CODE`    | —                                          | 방 만료, 데모 재입장 유예 종료, 장치 점검 만료에 제거할 사람이 없음 |
| 4002 `ROOM_REMOVED_CLOSE_CODE`    | `REMOVED_BY_HOST` / `DEVICE_CHECK_TIMEOUT` | 방장 추방 / 장치 점검 미준비                                        |
| 4003 `SHOWCASE_CLOSED_CLOSE_CODE` | —                                          | 시연 방장이 LOBBY·DEVICE_CHECK에서 떠남                             |

근거: [heartbeat.ts:7](../../packages/protocol/src/game-messages/heartbeat.ts#L7), [heartbeat.ts:8](../../packages/protocol/src/game-messages/heartbeat.ts#L8), [Heartbeat.ts:84](../../server/src/game/Heartbeat.ts#L84), [Heartbeat.ts:108](../../server/src/game/Heartbeat.ts#L108), [Heartbeat.ts:121](../../server/src/game/Heartbeat.ts#L121), [Heartbeat.ts:134](../../server/src/game/Heartbeat.ts#L134), [Heartbeat.ts:150](../../server/src/game/Heartbeat.ts#L150), [Heartbeat.ts:162](../../server/src/game/Heartbeat.ts#L162), [KkakkungRoom.ts:247](../../server/src/rooms/KkakkungRoom.ts#L247), [KkakkungRoom.ts:769](../../server/src/rooms/KkakkungRoom.ts#L769), [KkakkungRoom.ts:771](../../server/src/rooms/KkakkungRoom.ts#L771), [KkakkungRoom.ts:783](../../server/src/rooms/KkakkungRoom.ts#L783), [KkakkungRoom.ts:793](../../server/src/rooms/KkakkungRoom.ts#L793), [KkakkungRoom.ts:2324](../../server/src/rooms/KkakkungRoom.ts#L2324), [KkakkungRoom.ts:2339](../../server/src/rooms/KkakkungRoom.ts#L2339), [room.ts:29](../../packages/protocol/src/game-messages/room.ts#L29), [room.ts:31](../../packages/protocol/src/game-messages/room.ts#L31), [room.ts:36](../../packages/protocol/src/game-messages/room.ts#L36).

### 9.5 방 만료·방장·재경기

만료 판정은 LOBBY·DEVICE_CHECK·RESULT·ABORTED에서만 한다. 연습~PLAYING은 이 판정기가 건드리지 않는다.

| 판정                           | 조건                                                                                                             | 처리                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `expire-sessions`              | 방에 살아 있는 세션 0                                                                                            | 4001로 닫음                                                                                      |
| `recover-device-check`         | DEVICE_CHECK 300,000ms 경과 + 연결자 1 이상                                                                      | [9.1](#91-상태-기계)의 장치 점검 만료                                                            |
| `expire-empty` / `expire-idle` | LOBBY 무활동 `ROOM_IDLE_TTL_MS`, 또는 DEVICE_CHECK·RESULT·ABORTED 단계 시작 후 300,000ms, 이때 연결자 0 / 1 이상 | 4001로 닫음(DEVICE_CHECK는 연결자 0일 때만 `expire-empty`, 1 이상이면 위 `recover-device-check`) |

`ROOM_IDLE_TTL_MS`가 없으면(`idleTtlMs === null`) 시간 기반 만료(`expire-idle`/`expire-empty`/`recover-device-check`)가 전부 판정되지 않고, 세션이 모두 사라졌을 때의 `expire-sessions`만 남는다. 제품 프로필은 이 값을 필수로 요구하므로 실제로는 발생하지 않는다. 방장은 연결 중이고 세션이 살아 있는 사람 중 입장 순서가 가장 이른 사람이다. 현재 방장이 조건을 잃으면 곧바로 승계된다. 재경기 모드는 다음 셋이다.

- `same`: 남은 사람의 역할 유지
- `swap`: 역할 반전
- `lobby`: 새 추첨

첫 요청만 반영되고 반복 요청은 같은 결과를 돌려준다. 새 라운드에서는 matchId·시드·버전·틱·명령 큐·하트비트·뷰 기록·별칭·media 세대 기록이 모두 초기화되고, 이전 경기는 media에 반환된다.

근거: [RoomExpiry.ts:15](../../server/src/session/RoomExpiry.ts#L15), [RoomExpiry.ts:33](../../server/src/session/RoomExpiry.ts#L33), [RoomExpiry.ts:34](../../server/src/session/RoomExpiry.ts#L34), [RoomExpiry.ts:36](../../server/src/session/RoomExpiry.ts#L36), [RoomExpiry.ts:40](../../server/src/session/RoomExpiry.ts#L40), [RoomExpiry.ts:52](../../server/src/session/RoomExpiry.ts#L52), [RoomExpiry.ts:53](../../server/src/session/RoomExpiry.ts#L53), [RoomExpiry.ts:54](../../server/src/session/RoomExpiry.ts#L54), [RoomExpiry.ts:58](../../server/src/session/RoomExpiry.ts#L58), [RoomExpiry.ts:59](../../server/src/session/RoomExpiry.ts#L59), [KkakkungRoom.ts:2367](../../server/src/rooms/KkakkungRoom.ts#L2367), [KkakkungRoom.ts:2372](../../server/src/rooms/KkakkungRoom.ts#L2372), [RoomExpiry.ts:66](../../server/src/session/RoomExpiry.ts#L66), [RematchCoordinator.ts:34](../../server/src/rooms/RematchCoordinator.ts#L34), [RematchCoordinator.ts:42](../../server/src/rooms/RematchCoordinator.ts#L42), [KkakkungRoom.ts:2132](../../server/src/rooms/KkakkungRoom.ts#L2132), [MatchContext.ts:196](../../server/src/game/MatchContext.ts#L196).

### 9.6 방 종류별 특례

| 항목                    | 일반                                                                                                                                        | 데모                                                                                                  | 시연                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 진입                    | `/api/sessions`(초대·SSO·게스트)                                                                                                            | 운영 Bearer 또는 `X-Demo-Admin`                                                                       | `X-Demo-Admin`                                                                                                                                                                                                                                                                                                                                                               |
| 사람 좌석               | 6                                                                                                                                           | 1(운영자). 나머지 5는 서버 인형 `demo-puppet-1`~`5`, 이름 `인형 N`                                    | 4(역할마다 2)                                                                                                                                                                                                                                                                                                                                                                |
| 역할                    | 3:3 무작위(`Math.random`), 재경기 계획 우선                                                                                                 | 운영자 역할 기준 3:3, 인형이 나머지를 채움                                                            | 참가자가 고른 역할 2:2                                                                                                                                                                                                                                                                                                                                                       |
| 준비 문                 | `operationsReady`                                                                                                                           | `demoOperationsReady`                                                                                 | `operationsReady`                                                                                                                                                                                                                                                                                                                                                            |
| media                   | 사용                                                                                                                                        | 사용 안 함(발급·얼굴 확인·월 사용량 문 없음)                                                          | 사용, 월 사용량 문 적용                                                                                                                                                                                                                                                                                                                                                      |
| 경기 예산(`MAX_ROOMS`)  | 사용                                                                                                                                        | 안 씀                                                                                                 | 안 씀(`SHOWCASE_ROOMS` 예산)                                                                                                                                                                                                                                                                                                                                                 |
| 맵                      | 방장이 LOBBY·DEVICE_CHECK에서 `ROOM_MAP_SIZE`로 고름(크기를 바꿀 때만 `roomMapRevision`이 오름). 한 번도 안 바꿨으면 `PRODUCT_MAP_TEMPLATE` | 일반과 같음                                                                                           | `ROOM_MAP_SIZE`는 실행 시 항상 `INVALID_PHASE`([8.3](#83-명령))라 `roomMapRevision`이 절대 오르지 않는다. 방송 크기는 `small`이지만, [9.8](#98-맵-준비)에서 보듯 실제 맵 준비는 `PRODUCT_MAP_TEMPLATE`(기본 `maze-v1`, 31격자)을 쓴다 — 방송과 실경기 맵이 다르다([14절](#14-확인된-한계)). 시드는 고정 20260922. 빈 시작 자리를 `showcase-vacant-*`로 채워 준비한 뒤 떼어냄 |
| 라운드 마감             | 튜닝 `roundTicks`                                                                                                                           | 없음(`deadline:'none'`)                                                                               | 튜닝 `roundTicks` + `result:'timeout-only'`                                                                                                                                                                                                                                                                                                                                  |
| 준비 보고               | 사람이 보고                                                                                                                                 | 인형은 READY·PRACTICE_READY·LOAD_READY를 즉시 보고. 연습은 운영자가 끝내거나 60초 만료                | 사람이 보고                                                                                                                                                                                                                                                                                                                                                                  |
| `ROOM_LOCK`/`ROOM_KICK` | 방장                                                                                                                                        | `NOT_ALLOWED`                                                                                         | 방장                                                                                                                                                                                                                                                                                                                                                                         |
| 재입장                  | 불가(세션 무효)                                                                                                                             | 좌석·세션 유지. PLAYING·RESULT·ABORTED에도 재접속 가능. 비어 있는 채로 120,000ms가 지나면 4001로 닫음 | 불가                                                                                                                                                                                                                                                                                                                                                                         |
| 방장 이탈               | 승계                                                                                                                                        | —                                                                                                     | LOBBY·DEVICE_CHECK면 남은 사람을 4003으로 끊고 방을 닫음                                                                                                                                                                                                                                                                                                                     |
| 재경기                  | `same`/`swap`/`lobby`                                                                                                                       | `role` 지정 가능. `swap`은 운영자 역할을 뒤집음. 역할 계획은 항상 운영자 기준                         | `NOT_ALLOWED`                                                                                                                                                                                                                                                                                                                                                                |
| 방 소멸 시 자리         | 미해결 media 있는 자리는 RETIRING 유지                                                                                                      | 같음                                                                                                  | 회수 확인을 기다리지 않고 즉시 해제                                                                                                                                                                                                                                                                                                                                          |
| 운영자 중단             | —                                                                                                                                           | `abort-round` → `DEMO_OPERATOR_ABORT`                                                                 | —                                                                                                                                                                                                                                                                                                                                                                            |

근거: [KkakkungRoom.ts:114](../../server/src/rooms/KkakkungRoom.ts#L114), [KkakkungRoom.ts:1795](../../server/src/rooms/KkakkungRoom.ts#L1795), [KkakkungRoom.ts:1797](../../server/src/rooms/KkakkungRoom.ts#L1797), [KkakkungRoom.ts:1003](../../server/src/rooms/KkakkungRoom.ts#L1003), [KkakkungRoom.ts:1007](../../server/src/rooms/KkakkungRoom.ts#L1007), [KkakkungRoom.ts:1342](../../server/src/rooms/KkakkungRoom.ts#L1342), [KkakkungRoom.ts:1392](../../server/src/rooms/KkakkungRoom.ts#L1392), [KkakkungRoom.ts:1651](../../server/src/rooms/KkakkungRoom.ts#L1651), [LobbyCoordinator.ts:154](../../server/src/rooms/LobbyCoordinator.ts#L154), [KkakkungRoom.ts:221](../../server/src/rooms/KkakkungRoom.ts#L221), [KkakkungRoom.ts:343](../../server/src/rooms/KkakkungRoom.ts#L343), [KkakkungRoom.ts:1635](../../server/src/rooms/KkakkungRoom.ts#L1635), [SlotRegistry.ts:237](../../server/src/session/SlotRegistry.ts#L237), [KkakkungRoom.ts:628](../../server/src/rooms/KkakkungRoom.ts#L628), [KkakkungRoom.ts:117](../../server/src/rooms/KkakkungRoom.ts#L117), [KkakkungRoom.ts:1367](../../server/src/rooms/KkakkungRoom.ts#L1367), [KkakkungRoom.ts:1379](../../server/src/rooms/KkakkungRoom.ts#L1379), [KkakkungRoom.ts:1841](../../server/src/rooms/KkakkungRoom.ts#L1841), [KkakkungRoom.ts:1842](../../server/src/rooms/KkakkungRoom.ts#L1842), [KkakkungRoom.ts:1605](../../server/src/rooms/KkakkungRoom.ts#L1605), [KkakkungRoom.ts:768](../../server/src/rooms/KkakkungRoom.ts#L768), [KkakkungRoom.ts:125](../../server/src/rooms/KkakkungRoom.ts#L125), [KkakkungRoom.ts:2352](../../server/src/rooms/KkakkungRoom.ts#L2352), [KkakkungRoom.ts:756](../../server/src/rooms/KkakkungRoom.ts#L756), [KkakkungRoom.ts:1073](../../server/src/rooms/KkakkungRoom.ts#L1073), [KkakkungRoom.ts:2143](../../server/src/rooms/KkakkungRoom.ts#L2143), [KkakkungRoom.ts:820](../../server/src/rooms/KkakkungRoom.ts#L820).

### 9.7 데모 대본

운영자가 PLAYING 중에 대본을 고르면 인형 명령이 일반 명령 큐를 지난다. 판정은 모두 코어 규칙이 한다.

- 데모 상태 메시지는 대본 22개 전부를 담는다. 지금 시작할 수 없는 대본에는 거절 코드(`unavailable`)가 붙는다. 이 거절은 아래 "시작 거절"표의 코드다.
- 모든 대본은 시작 전 운영자가 ACTIVE여야 한다(`OPERATOR_NOT_ACTIVE`). 관리자 주도 대본(운영자의 설치·도전·교환 상태를 읽는 것)은 방이 그 상태를 아직 채우지 않았으면 `NO_OPERATOR_STATE`로 거절한다.
- 대본이 받지 않는 선택지 키가 오면 `UNSUPPORTED_OPTION`으로 거절한다.
- 시작을 통과하면 단계(step) 목록이 실행된다. 각 단계는 상한(`until` 단계는 `timeout` 필드 값, 그 밖은 기본 2,400틱)을 넘기면 `<단계 라벨>:TIMEOUT`(`until` 단계에 `failure` 코드가 있으면 그 코드)으로 대본을 끝낸다. 규칙이나 실행 조건이 그 단계를 거절하면 `<단계 라벨>:FAILED`로 끝난다. 운영자 취소(`cancel-scenario`)는 단계 라벨이 아니라 대본 이름 그대로 `<대본>:CANCELED`로 끝난다.
- `FAILED`가 나는 조건은 다음과 같다: 그 단계의 행위자(actor)가 ACTIVE가 아님, 배치(`place`) 단계가 10틱 안에 목표 칸·방향에 도달했음을 확인하지 못함, 이동·설치 등 명령 전송이 거절(`send`가 false)됨, `place`/`walk`/`face` 단계의 목표 칸을 계산할 수 없음(대상 인형이 없거나 갈 곳이 없음).

**시작 거절**(`DEMO_REJECTIONS`, 버튼을 누르기 전에 판정)

| 대본                                                   | 선택지                       | 필요 조건(없으면 거절 코드)                                                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `place-me-at-exit`                                     | —                            | 운영자 도망자 `OPERATOR_MUST_BE_RUNNER`, 운영자 상태 있음 `NO_OPERATOR_STATE`, 운영자 출구 `NO_OPERATOR_EXIT`. 출구 앞 칸을 인형 아닌 참가자가 막거나, 막은 인형을 옮길 빈 칸이 없으면 `CELL_UNAVAILABLE` |
| `place-puppet`                                         | role, side, distance, facing | 인형 `NO_PUPPET`, 빈 칸 `CELL_UNAVAILABLE`                                                                                                                                                                |
| `approach`                                             | role, distance               | 인형 `NO_PUPPET`                                                                                                                                                                                          |
| `cross-my-view`                                        | role                         | 인형 `NO_PUPPET`, 지나갈 칸 `NO_CROSSING_PATH`                                                                                                                                                            |
| `turn-before-me`                                       | role, distance               | 인형 `NO_PUPPET`                                                                                                                                                                                          |
| `trap`, `sensor`(인형이 설치)                          | installer                    | 술래 인형 `NO_TAGGER_PUPPET`, 설치 칸 `NO_ROOM_TO_INSTALL`(trap)/`NO_WALL_TO_MOUNT`(sensor), 물러설 칸 `NO_ROOM_TO_RETREAT`. 운영자가 술래면 밟을 도망자 인형도 필요(`NO_RUNNER_PUPPET`)                  |
| `trap`, `sensor`(`installer:'me'`, 운영자가 직접 설치) | installer                    | 운영자 술래 `OPERATOR_MUST_BE_TAGGER`, 운영자 상태 있음 `NO_OPERATOR_STATE`, 밟을 도망자 인형 `NO_RUNNER_PUPPET`, 시작 칸을 벗어났는데도 설치할 칸·벽이 없으면 `NO_ROOM_TO_INSTALL`/`NO_WALL_TO_MOUNT`    |
| `device-states`                                        | —                            | 술래·도망자 인형, 설치·후퇴 칸                                                                                                                                                                            |
| `double-trap-immunity`                                 | —                            | 운영자 도망자, 술래 인형, 함정 두 칸 `NO_ROOM_FOR_TWO_TRAPS`, 물러설 칸 `NO_ROOM_TO_RETREAT`                                                                                                              |
| `capture`                                              | —                            | 운영자 도망자, 술래 인형                                                                                                                                                                                  |
| `capture-one`, `result-tagger-win`                     | —                            | 술래·도망자 인형 쌍 1개 `NEED_ONE_PAIR` / 2개 `NEED_TWO_PAIRS`                                                                                                                                            |
| `capture-in-challenge`                                 | —                            | 운영자 술래, 도망자 인형, 인형 출구 `NO_EXIT_FOR_PUPPET`                                                                                                                                                  |
| `caught-in-my-challenge`                               | —                            | 운영자 도망자, 운영자 상태 있음 `NO_OPERATOR_STATE`, 운영자 출구 `NO_OPERATOR_EXIT`, 술래 인형 `NO_TAGGER_PUPPET`                                                                                         |
| `exit`                                                 | —                            | 도망자 인형 `NO_RUNNER_PUPPET`, 인형 출구 `NO_EXIT_FOR_PUPPET`                                                                                                                                            |
| `exchange`, `exchange-cancel`                          | —                            | 운영자 도망자, 교환할 지식이 남은 도망자 인형 `NO_EXCHANGE_PARTNER`                                                                                                                                       |
| `accept-my-exchange`                                   | —                            | 운영자 도망자, 운영자 상태 있음 `NO_OPERATOR_STATE`, 도망자 인형 있음 `NO_RUNNER_PUPPET`, 교환할 지식이 남은 상대 `NO_EXCHANGE_PARTNER`                                                                   |
| `exchange-trace`                                       | —                            | 운영자 술래, 도망자 인형 2 `NEED_TWO_RUNNER_PUPPETS`, 교환 쌍                                                                                                                                             |
| `spectate-then-capture`                                | —                            | 운영자 도망자, 술래 인형 2 `NEED_TWO_PAIRS`, 도망자 인형 1(코드명과 달리 요구 수는 1) `NEED_TWO_RUNNER_PUPPETS`                                                                                           |
| `result-runner-win`                                    | —                            | 도망자 인형 2, 각자 출구                                                                                                                                                                                  |
| `abort-connection-lost`                                | —                            | 인형 1. 인형 연결을 끊어 코어가 `GAME_CONNECTION_LOST`로 중단                                                                                                                                             |

**진행 중 실패**: `DEMO_FAILURE_REASONS`의 `NO_INSTALL_FROM_OPERATOR`·`NO_REQUEST_FROM_OPERATOR`·`NO_CHALLENGE_FROM_OPERATOR`는 위 시작 거절 목록에 없는 별도 코드다. 관리자가 직접 설치·요청·도전을 끝내기를 기다리는 `until` 단계가 상한 안에 끝나지 못하면 `<단계 라벨>:<이 코드>`로 대본이 실패한다.

| 코드                         | 붙는 대본과 단계                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `NO_INSTALL_FROM_OPERATOR`   | `trap`/`sensor`의 `installer:'me'` 경로, `operator-installs` 단계가 운영자의 무장 완료를 기다림 |
| `NO_REQUEST_FROM_OPERATOR`   | `accept-my-exchange`의 `operator-requests` 단계가 운영자의 교환 요청을 기다림                   |
| `NO_CHALLENGE_FROM_OPERATOR` | `caught-in-my-challenge`의 `operator-starts-challenge` 단계가 운영자의 탈출 도전 시작을 기다림  |

근거: [DemoScenarios.ts:11](../../server/src/rooms/DemoScenarios.ts#L11), [DemoScenarios.ts:65](../../server/src/rooms/DemoScenarios.ts#L65), [DemoScenarios.ts:95](../../server/src/rooms/DemoScenarios.ts#L95), [DemoScenarios.ts:116](../../server/src/rooms/DemoScenarios.ts#L116), [DemoScenarios.ts:123](../../server/src/rooms/DemoScenarios.ts#L123), [DemoScenarios.ts:130](../../server/src/rooms/DemoScenarios.ts#L130), [DemoScenarios.ts:217](../../server/src/rooms/DemoScenarios.ts#L217), [DemoScenarios.ts:221](../../server/src/rooms/DemoScenarios.ts#L221), [DemoScenarios.ts:223](../../server/src/rooms/DemoScenarios.ts#L223), [DemoScenarios.ts:233](../../server/src/rooms/DemoScenarios.ts#L233), [DemoScenarios.ts:248](../../server/src/rooms/DemoScenarios.ts#L248), [DemoScenarios.ts:330](../../server/src/rooms/DemoScenarios.ts#L330), [DemoScenarios.ts:344](../../server/src/rooms/DemoScenarios.ts#L344), [DemoScenarios.ts:394](../../server/src/rooms/DemoScenarios.ts#L394), [DemoScenarios.ts:408](../../server/src/rooms/DemoScenarios.ts#L408), [DemoScenarios.ts:417](../../server/src/rooms/DemoScenarios.ts#L417), [DemoScenarios.ts:452](../../server/src/rooms/DemoScenarios.ts#L452), [DemoScenarios.ts:456](../../server/src/rooms/DemoScenarios.ts#L456), [DemoScenarios.ts:460](../../server/src/rooms/DemoScenarios.ts#L460), [DemoScenarios.ts:473](../../server/src/rooms/DemoScenarios.ts#L473), [DemoScenarios.ts:486](../../server/src/rooms/DemoScenarios.ts#L486), [DemoScenarios.ts:737](../../server/src/rooms/DemoScenarios.ts#L737), [DemoScenarios.ts:750](../../server/src/rooms/DemoScenarios.ts#L750), [DemoScenarios.ts:751](../../server/src/rooms/DemoScenarios.ts#L751), [DemoScenarios.ts:764](../../server/src/rooms/DemoScenarios.ts#L764), [DemoScenarios.ts:766](../../server/src/rooms/DemoScenarios.ts#L766), [DemoScenarios.ts:863](../../server/src/rooms/DemoScenarios.ts#L863), [DemoScenarios.ts:864](../../server/src/rooms/DemoScenarios.ts#L864), [DemoScenarios.ts:885](../../server/src/rooms/DemoScenarios.ts#L885), [DemoScenarios.ts:905](../../server/src/rooms/DemoScenarios.ts#L905), [DemoScenarios.ts:974](../../server/src/rooms/DemoScenarios.ts#L974), [DemoScenarios.ts:1113](../../server/src/rooms/DemoScenarios.ts#L1113), [DemoScenarios.ts:1231](../../server/src/rooms/DemoScenarios.ts#L1231), [DemoScenarios.ts:1240](../../server/src/rooms/DemoScenarios.ts#L1240), [DemoScenarios.ts:1257](../../server/src/rooms/DemoScenarios.ts#L1257), [DemoScenarios.ts:1271](../../server/src/rooms/DemoScenarios.ts#L1271), [DemoScenarios.ts:1274](../../server/src/rooms/DemoScenarios.ts#L1274), [DemoScenarios.ts:1294](../../server/src/rooms/DemoScenarios.ts#L1294), [DemoScenarios.ts:1313](../../server/src/rooms/DemoScenarios.ts#L1313), [DemoScenarios.ts:1316](../../server/src/rooms/DemoScenarios.ts#L1316), [DemoScenarios.ts:1373](../../server/src/rooms/DemoScenarios.ts#L1373), [DemoScenarios.ts:1541](../../server/src/rooms/DemoScenarios.ts#L1541), [DemoScenarios.ts:1556](../../server/src/rooms/DemoScenarios.ts#L1556), [KkakkungRoom.ts:1519](../../server/src/rooms/KkakkungRoom.ts#L1519), [KkakkungRoom.ts:1579](../../server/src/rooms/KkakkungRoom.ts#L1579).

### 9.8 맵 준비

`startFinalizing`은 어떤 `masterPath`/`fallbackPath`/`templateId`/`templateVersion`을 로더에 넘길지 먼저 고른다. `this.roomMapRevision > 0`일 때만 `deps.layouts.bySize?.[this.roomMapSize]`(크기별 템플릿)를 쓰고, 아니면 `deps.layouts`(기본 `PRODUCT_MAP_TEMPLATE`, 시드 없는 방은 `maze-v1` 31격자)로 떨어진다. `roomMapRevision`은 `ROOM_MAP_SIZE`가 크기를 실제로 바꿀 때만 오르므로([9.6](#96-방-종류별-특례)), 크기를 한 번도 바꾸지 않은 방은 항상 기본 템플릿으로 경기한다. 시연 방은 `ROOM_MAP_SIZE`가 항상 `INVALID_PHASE`([8.3](#83-명령))라 `roomMapRevision`이 절대 오르지 않는다 — 방송하는 `small`과 무관하게 항상 기본 `PRODUCT_MAP_TEMPLATE`로 준비된다([14절](#14-확인된-한계)).

이렇게 고른 값으로 `MAP_FINALIZING`의 `LayoutLoader.prepare` 순서는 다음과 같다.

1. master 바이트를 읽고 SHA-256을 구한다.
2. 코어 `validateTemplate`, `createTemplateVariants`를 호출한다.
3. variantId 정렬 뒤 `seed % 변형 수`로 하나를 고른다.
4. 같은 출처의 fallback 배치를 찾아 먼저 인증한다.
5. 온라인 선택기를 돈다. 예산은 100ms·시도 256회·한 번에 최대 8개이고, 배치 사이마다 이벤트 루프에 양보한다.

실패 사유는 다음과 같으며, Room은 이것을 `LAYOUT:<사유>`로 받아 장치 점검으로 돌아간다.

- `master-read`, `master-json`, `template:<code>:<path>`, `variants:<code>`, `variants:empty`, `seed`, `fallback-structure`
- `online-unavailable`, `fallback-uncertified`
- 로더 예외는 `LOADER_THREW`, 조립 누락은 `LAYOUT_PRODUCER_MISSING`

시드는 라운드마다 4바이트 난수이고, 시연 방만 고정값이다.

근거: [LayoutLoader.ts:21](../../server/src/game/LayoutLoader.ts#L21), [LayoutLoader.ts:88](../../server/src/game/LayoutLoader.ts#L88), [LayoutLoader.ts:101](../../server/src/game/LayoutLoader.ts#L101), [LayoutLoader.ts:112](../../server/src/game/LayoutLoader.ts#L112), [LayoutLoader.ts:122](../../server/src/game/LayoutLoader.ts#L122), [LayoutLoader.ts:138](../../server/src/game/LayoutLoader.ts#L138), [LayoutLoader.ts:190](../../server/src/game/LayoutLoader.ts#L190), [KkakkungRoom.ts:1795](../../server/src/rooms/KkakkungRoom.ts#L1795), [KkakkungRoom.ts:1797](../../server/src/rooms/KkakkungRoom.ts#L1797), [KkakkungRoom.ts:1823](../../server/src/rooms/KkakkungRoom.ts#L1823), [KkakkungRoom.ts:1360](../../server/src/rooms/KkakkungRoom.ts#L1360), [KkakkungRoom.ts:1003](../../server/src/rooms/KkakkungRoom.ts#L1003), [showcase-room.test.ts:56](../../server/test/room/showcase-room.test.ts#L56).

### 9.9 한도 모음

| 자원              | 값                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| 일반 방·경기·좌석 | [5.2](#52-자리-등록부)                                                                                            |
| 세션              | 첫 접속 60초(데모·시연 10분), 활동 30분, 최대 2시간, 저장 600개                                                   |
| 초대              | 저장 4,096개, 운영 초대 방 코드 16개, 방장 초대 10분                                                              |
| HTTP              | [4.3](#43-속도-제한-층), 본문 2,048바이트·5초, webhook 256kb, WebSocket 8,192바이트                               |
| 방 메시지         | Colyseus 120/초, 수신 버킷 90/45, 명령 버킷 60/30, 명령 4,096바이트, 클럭 5/초, 재동기화 1/초, 바인딩 재요청 1/초 |
| 명령 큐           | actor 대기 64, 방 대기 384, 완료 기록 actor당 512개·120초, 누른 이동 500ms                                        |
| 틱                | 구동 10ms, 방 틱 50ms, 과부하 250ms, 따라잡기 4라운드                                                             |
| 운영              | 대기 64(+drain 1), 명령 기한 `OPS_OPERATION_TIMEOUT_MS`(checkpoint 180,000ms), 감사 4,096개·24시간                |
| 로그              | 깊이 3, 키 32, 문자열 512자, 배열 32, metric 큐 10,000                                                            |

근거: [ProductSessionStore.ts:19](../../server/src/session/ProductSessionStore.ts#L19), [InviteStore.ts:43](../../server/src/session/InviteStore.ts#L43), [InvitationRoutes.ts:15](../../server/src/session/InvitationRoutes.ts#L15), [bootstrap.ts:352](../../server/src/bootstrap.ts#L352), [KkakkungRoom.ts:230](../../server/src/rooms/KkakkungRoom.ts#L230), [CommandQueue.ts:17](../../server/src/game/CommandQueue.ts#L17), [RoomTickCoordinator.ts:46](../../server/src/game/RoomTickCoordinator.ts#L46), [StructuredEvents.ts:125](../../server/src/observability/StructuredEvents.ts#L125), [MetricRegistry.ts:199](../../server/src/observability/MetricRegistry.ts#L199).

## 10. 준비(readiness)와 관측

### 10.1 준비 판정

media readiness의 판정 규칙은 다음과 같다.

- **초기화 전**: `RECOVERING`이고 코드는 `INITIALIZATION_UNCONFIRMED`다. 잠금 사유가 있으면 `LOCKED`.
- **초기화 뒤**: 다음 코드를 모은다. `CLEANUP_PENDING` 하나만 있으면 `RECOVERING`, 다른 코드가 하나라도 있으면 `LOCKED`, 없으면 `READY`다.
- **READY 조건**: 이력 완전, 단일 작성자, 저널 무결성 ok/missing, 모든 저장소 쓰기 가능, 감사 쓰기 가능, media 모드 cloud, 제품 보안, namespace 소유, capability 일치, 예약 이력 일치, 유효 예산, 미확인 회수 0.
- **공개 투영**: 허용 집합에 없는 코드, 접근자 필드, READY인데 이력 불완전·미해결·코드가 있는 응답은 모두 `LOCKED`/`READINESS_UNCONFIRMED`로 바뀐다.

| 사유 코드                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 직접 발생 조건                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `INITIALIZATION_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 초기화 전                                                                                               |
| `INITIALIZATION_FAILED`, `WRITER_CONFLICT`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 복구 기동 fatal                                                                                         |
| `CLOSED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 복구·런타임 종료                                                                                        |
| `RECOVERY_LOCKED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 로컬 복구가 코드 없이 LOCKED                                                                            |
| `HISTORY_INCOMPLETE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 로컬 또는 복구 상태 이력 불완전                                                                         |
| `SINGLE_WRITER_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 단일 작성자 미확인                                                                                      |
| `JOURNAL_INTEGRITY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 저널 무결성이 ok/missing 아님                                                                           |
| `STORAGE_NOT_WRITABLE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 복구·저널·usage·재시도·정리 체크포인트 중 쓰기 불가(한 번 걸리면 유지)                                  |
| `AUDIT_WRITE_FAILED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 감사 쓰기 불가, 감사 복원 실패(유지)                                                                    |
| `MEDIA_MODE_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | media 모드가 cloud 아님                                                                                 |
| `PRODUCT_SECURITY_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `productSecurityReady` 거짓                                                                             |
| `NAMESPACE_OWNERSHIP_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 증거의 namespace 소유 미확인                                                                            |
| `CLOUD_CAPABILITY_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | capability 상태가 SUPPORTED 아님, 또는 구독 모드·alias·namespace·SDK 버전 불일치, 또는 시험 시각이 미래 |
| `USAGE_INTEGRITY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | usage 무결성이 ok 아님, 예약 검증 예외                                                                  |
| `RESERVATION_HISTORY_MISMATCH`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 저널·예약·세대 대조 불일치                                                                              |
| `BUDGET_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | attested 공식 예산 없음·무효, continuous인데 공급자 할당 정책 아님                                      |
| `BUDGET_OVERCOMMITTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 활성 예약 분·바이트가 공식 잔여 초과                                                                    |
| `REMOTE_RETIREMENT_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 미해결 수 > 0(로컬·대조·REVOKED 아닌 재시도 중 최댓값)                                                  |
| `CLEANUP_PENDING`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 로컬 복구가 RECOVERING                                                                                  |
| `RECOVERY_PENDING`, `CLEANUP_FAILED`, `CLEANUP_REPORT_INVALID`, `CLEANUP_NOT_CONFIGURED`, `RECOVERY_UNCONFIRMED`, `RECOVERY_CLOCK_INVALID`, `RETRY_CLOCK_INVALID`, `RETRY_CHECKPOINT_UNREADABLE`, `RETRY_CHECKPOINT_MISSING`, `RETRY_CHECKPOINT_INTEGRITY`, `RETRY_CHECKPOINT_AHEAD`, `RETRY_JOURNAL_MISMATCH`, `RETRY_HISTORY_CORRUPT`, `RETRY_JOURNAL_FAILED`, `JOURNAL_HISTORY_MISSING`, `JOURNAL_SCOPE_MISMATCH`, `JOURNAL_IDENTITY_CONFLICT`, `JOURNAL_WRITE_FAILED`, `USAGE_HISTORY_MISSING`, `USAGE_RESERVATION_UNCONFIRMED`, `RETIREMENT_UNRESOLVED`, `ISSUANCE_UNRESOLVED` | 복구 기동·재조정·정리·재시도 경로가 잠금으로 넣는 코드. 저널·재시도 대조 규칙은 [7.2](#72-기동-복구)    |
| `READINESS_UNCONFIRMED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 판정 예외, 허용 밖 코드, 운영 명령이 admission을 LOCKED로 만듦                                          |

예약 이력 대조는 다음과 같이 판정한다.

- 저널 기록마다 예약 의도가 usage와 맞고 현재 세대와 같아야 한다.
- 비종결 기록이 현재 프로세스의 PREPARED(준비 중 예외 포함)나 진행 중 회수가 아니면 미해결로 센다.
- 종결 기록인데 세대가 REVOKED가 아니면 불일치다.
- 예약은 정확히 한 저널 root에 속해야 한다.
- RELEASED·AWAITING_OFFICIAL 예약의 기록·세대는 모두 REVOKED여야 한다.

근거: [Readiness.ts:18](../../server/src/health/Readiness.ts#L18), [Readiness.ts:95](../../server/src/health/Readiness.ts#L95), [Readiness.ts:106](../../server/src/health/Readiness.ts#L106), [Readiness.ts:180](../../server/src/health/Readiness.ts#L180), [Readiness.ts:193](../../server/src/health/Readiness.ts#L193), [Readiness.ts:194](../../server/src/health/Readiness.ts#L194), [Readiness.ts:195](../../server/src/health/Readiness.ts#L195), [Readiness.ts:196](../../server/src/health/Readiness.ts#L196), [Readiness.ts:200](../../server/src/health/Readiness.ts#L200), [Readiness.ts:210](../../server/src/health/Readiness.ts#L210), [Readiness.ts:214](../../server/src/health/Readiness.ts#L214), [Readiness.ts:215](../../server/src/health/Readiness.ts#L215), [Readiness.ts:217](../../server/src/health/Readiness.ts#L217), [Readiness.ts:222](../../server/src/health/Readiness.ts#L222), [Readiness.ts:266](../../server/src/health/Readiness.ts#L266), [Readiness.ts:268](../../server/src/health/Readiness.ts#L268), [Readiness.ts:286](../../server/src/health/Readiness.ts#L286), [Readiness.ts:289](../../server/src/health/Readiness.ts#L289), [Readiness.ts:298](../../server/src/health/Readiness.ts#L298), [Readiness.ts:301](../../server/src/health/Readiness.ts#L301), [ReadinessRuntime.ts:100](../../server/src/health/ReadinessRuntime.ts#L100), [ReservationReadiness.ts:334](../../server/src/health/ReservationReadiness.ts#L334), [ReservationReadiness.ts:350](../../server/src/health/ReservationReadiness.ts#L350), [ReservationReadiness.ts:352](../../server/src/health/ReservationReadiness.ts#L352), [ReservationReadiness.ts:390](../../server/src/health/ReservationReadiness.ts#L390), [ReservationReadiness.ts:396](../../server/src/health/ReservationReadiness.ts#L396).

### 10.2 구조화 이벤트와 로그

이벤트는 허용된 이름·레벨(`info`/`warn`/`error`)·단조 시각과 허용 필드의 스칼라 값만 통과한다. 거절되면 `event_rejected` warn 한 줄을 남긴다.

- 허용 필드: `matchRef`, `generation`, `requestId`, `operationId`, `retirementId`, `alert`, `severity`, `code`, `reason`, `state`, `value`, `unit`, `limit`, `count`, `durationMs`, `port`, `stage`, `name`, `evidence`, `roomRef`, `phase`, `outcome`, `total`, `reported`, `faceConfirmed`, `unresolvedMedia`, `method`, `status`, `command`, `lostRunners`, `lostTaggers`
- 모든 로그 줄의 키 이름이 `token`, `jwt`, `secret`, `password`, `authorization`, `cookie`, `sdp`, `nickname`, `identity`, `map`(정확히), `seed`, `exit`, `position`, `x`/`y`/`z`(정확히), `frame`, `audio`, `apiKey` 패턴에 맞으면 값을 `[redacted]`로 바꾼다.
- 깊이 3, 키 32, 문자열 512자, 배열 32를 넘으면 자르고, 정제에 실패하면 `{observability:'formatter_failed'}`를 남긴다.

| 이벤트                                                                                                                                                                                                                                                  | 서버 코드의 발생 지점                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `room.phase`                                                                                                                                                                                                                                            | 단계 전이                                        |
| `room.preparation_failed`                                                                                                                                                                                                                               | 장치 점검 복귀, 중단, 장치 점검 만료             |
| `room.match_aborted`                                                                                                                                                                                                                                    | 중단(사유·방 종류·끊긴 인원)                     |
| `room.command_rejected`                                                                                                                                                                                                                                 | READY·PRACTICE_READY·LOAD_READY·REMATCH 거절     |
| `room.load_ready`                                                                                                                                                                                                                                       | LOAD_READY 적용                                  |
| `room.heartbeat_stall`                                                                                                                                                                                                                                  | 하트비트 멈춤 보정                               |
| `room.media_uncertain_released`                                                                                                                                                                                                                         | 불확실 준비 해제(라운드 종료·소멸·330초)         |
| `room.uncaught_exception`                                                                                                                                                                                                                               | 방 미포착 예외                                   |
| `process.fault`                                                                                                                                                                                                                                         | 프로세스 미포착 예외                             |
| `alert.raised`, `alert.cleared`                                                                                                                                                                                                                         | 경보 전이                                        |
| `alert.notify.failed`                                                                                                                                                                                                                                   | webhook 전송 실패                                |
| `media.api.failed`, `media.retirement.unresolved`, `media.budget.near_limit`, `media.prepare_failed`, `media.policy.uncertain`, `media.webhook`                                                                                                         | media 모듈(media.md)                             |
| `server.started`, `server.ready`, `server.locked`, `tick.overload`, `media.retirement.resolved`, `media.api.rate_limited`, `operations.journal.write_failed`, `operations.drain`, `operations.resume`, `operations.checkpoint`, `observability.dropped` | 허용 목록에만 있고 server/src에서 내는 곳이 없음 |

근거: [StructuredEvents.ts:18](../../server/src/observability/StructuredEvents.ts#L18), [StructuredEvents.ts:55](../../server/src/observability/StructuredEvents.ts#L55), [StructuredEvents.ts:105](../../server/src/observability/StructuredEvents.ts#L105), [StructuredEvents.ts:125](../../server/src/observability/StructuredEvents.ts#L125), [StructuredEvents.ts:200](../../server/src/observability/StructuredEvents.ts#L200), [StructuredEvents.ts:267](../../server/src/observability/StructuredEvents.ts#L267), [StructuredEvents.ts:316](../../server/src/observability/StructuredEvents.ts#L316), [KkakkungRoom.ts:2208](../../server/src/rooms/KkakkungRoom.ts#L2208), [KkakkungRoom.ts:1914](../../server/src/rooms/KkakkungRoom.ts#L1914), [KkakkungRoom.ts:1934](../../server/src/rooms/KkakkungRoom.ts#L1934), [KkakkungRoom.ts:890](../../server/src/rooms/KkakkungRoom.ts#L890), [KkakkungRoom.ts:1050](../../server/src/rooms/KkakkungRoom.ts#L1050), [KkakkungRoom.ts:2097](../../server/src/rooms/KkakkungRoom.ts#L2097), [KkakkungRoom.ts:2584](../../server/src/rooms/KkakkungRoom.ts#L2584), [bootstrap.ts:653](../../server/src/bootstrap.ts#L653), [bootstrap.ts:168](../../server/src/bootstrap.ts#L168), [MediaCoordinator.ts:177](../../server/src/media/MediaCoordinator.ts#L177).

### 10.3 metric

metric은 등록된 이름·단위만 받는다. 라벨은 `matchRef`, `generation`, `requestId`(128자 이하)만 허용하고, 큐가 10,000개로 차면 버린 개수를 `observability.dropped`로 낸다. 1초 계측 루프가 drain해서 `metric` info 로그를 쓰고 경보를 평가한다.

| metric(단위)                                                                                                                                                                                                                  | 내는 곳                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `tick.duration`(ms), `tick.due`, `tick.catchup`, `tick.overload`(count), `eventLoop.lag`(ms)                                                                                                                                  | 틱 coordinator                               |
| `eventLoop.delayP99`(ms), `process.memory`(bytes, RSS), `process.cpu`(ratio)                                                                                                                                                  | 프로세스 표본(1초)                           |
| `http.requests.active`, `http.requests.work`, `http.requests.rejected`(count)                                                                                                                                                 | 계측 루프가 제품 HTTP 한도 합계를 냄         |
| `operations.queue.pending`, `operations.queue.rejected`(count)                                                                                                                                                                | 운영 명령 큐 압력                            |
| `operations.audit.events`, `operations.audit.coalesced`, `operations.audit.retained`(count)                                                                                                                                   | 운영 감사                                    |
| `media.retirement.unresolved`(count), `media.policy.queueWait`, `media.policy.responseLatency`(ms)                                                                                                                            | media 모듈                                   |
| `observability.dropped`(count)                                                                                                                                                                                                | metric 큐 drain                              |
| `input.queueDepth`, `input.rejected`, `media.api.total60s`, `media.api.normal60s`, `media.api.429`, `media.policy.effectLatency`, `media.reservation.participantMs`, `media.reservation.bytes`, `operations.journal.writable` | 등록만 돼 있고 server/src에서 내는 곳이 없음 |

근거: [MetricRegistry.ts:31](../../server/src/observability/MetricRegistry.ts#L31), [MetricRegistry.ts:199](../../server/src/observability/MetricRegistry.ts#L199), [MetricRegistry.ts:274](../../server/src/observability/MetricRegistry.ts#L274), [MetricRegistry.ts:428](../../server/src/observability/MetricRegistry.ts#L428), [RoomTickCoordinator.ts:118](../../server/src/game/RoomTickCoordinator.ts#L118), [bootstrap.ts:734](../../server/src/bootstrap.ts#L734), [bootstrap.ts:743](../../server/src/bootstrap.ts#L743), [ReadinessRuntime.ts:85](../../server/src/health/ReadinessRuntime.ts#L85), [OperationsAudit.ts:313](../../server/src/operations/OperationsAudit.ts#L313), [MediaCoordinator.ts:324](../../server/src/media/MediaCoordinator.ts#L324).

### 10.4 경보와 외부 알림

| 경보                          | 심각도   | 원천                           | 발동                                     | 해제          |
| ----------------------------- | -------- | ------------------------------ | ---------------------------------------- | ------------- |
| `MEDIA_API_BUDGET_NEAR_LIMIT` | warning  | `media.api.total60s`           | ≥ ceil(total 상한×0.9)(기본 900이면 810) | 값이 내려가면 |
| `MEDIA_API_RATE_LIMITED`      | critical | `media.api.429`                | ≥1                                       | 값이 내려가면 |
| `MEDIA_POLICY_UNCERTAIN`      | warning  | `media.policy.responseLatency` | >1,000ms                                 | 1초 이하 표본 |
| `MEDIA_RETIREMENT_UNRESOLVED` | critical | `media.retirement.unresolved`  | ≥1                                       | 수동 확인만   |
| `JOURNAL_NOT_WRITABLE`        | critical | `operations.journal.writable`  | 값 0                                     | 1 표본        |
| `READINESS_LOCKED`            | critical | 1초 루프의 readiness           | LOCKED                                   | LOCKED 아님   |
| `TICK_OVERLOAD`               | critical | `tick.overload`                | ≥1                                       | 수동 확인만   |
| `OBSERVABILITY_DROPPED`       | warning  | `observability.dropped`        | ≥1                                       | 수동 확인만   |

`ALERT_WEBHOOK_URL`이 있으면 notifier가 critical 경보만 Mattermost/Slack 형식(`{text, username:'kkakkung-ops', channel?}`)으로 보낸다. 1초 계측 루프에서 한 번에 한 건씩 보낸다.

| 알림        | 조건                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `RAISED`    | 발동. 같은 경보를 300,000ms 안에 보냈으면 미룸                                                                    |
| `CLEARED`   | 해제 후 60,000ms 동안 다시 발동하지 않음                                                                          |
| `TRANSIENT` | 발동 알림을 보내기 전에 해제된 경우                                                                               |
| 실패        | 60,000ms 뒤 재시도, 전송 타임아웃 5,000ms. `alert.notify.failed`(`HTTP_<상태>`/`TIMEOUT`/`NETWORK`/`SEND_FAILED`) |

warning 경보는 로그에만 남는다. URL이 없으면 이벤트와 로컬 경보 상태만 남는다.

근거: [AlertPolicy.ts:41](../../server/src/observability/AlertPolicy.ts#L41), [AlertPolicy.ts:52](../../server/src/observability/AlertPolicy.ts#L52), [AlertPolicy.ts:157](../../server/src/observability/AlertPolicy.ts#L157), [AlertPolicy.ts:164](../../server/src/observability/AlertPolicy.ts#L164), [AlertPolicy.ts:181](../../server/src/observability/AlertPolicy.ts#L181), [AlertPolicy.ts:186](../../server/src/observability/AlertPolicy.ts#L186), [AlertPolicy.ts:190](../../server/src/observability/AlertPolicy.ts#L190), [AlertPolicy.ts:216](../../server/src/observability/AlertPolicy.ts#L216), [AlertPolicy.ts:273](../../server/src/observability/AlertPolicy.ts#L273), [bootstrap.ts:161](../../server/src/bootstrap.ts#L161), [bootstrap.ts:181](../../server/src/bootstrap.ts#L181), [bootstrap.ts:747](../../server/src/bootstrap.ts#L747), [AlertNotifier.ts:24](../../server/src/observability/AlertNotifier.ts#L24), [AlertNotifier.ts:37](../../server/src/observability/AlertNotifier.ts#L37), [AlertNotifier.ts:188](../../server/src/observability/AlertNotifier.ts#L188), [AlertNotifier.ts:225](../../server/src/observability/AlertNotifier.ts#L225), [AlertNotifier.ts:276](../../server/src/observability/AlertNotifier.ts#L276), [AlertNotifier.ts:291](../../server/src/observability/AlertNotifier.ts#L291).

## 11. 0.1·sandbox 진단 경로

이 절의 계약은 제품 0.2와 섞지 않는다. 이 경로는 strict 제품에서 등록되지 않는다.

- **개발 세션** `POST /api/dev-sessions`:
  - 본문은 `devSessionRequestSchema` `{nickname(1–20)}`이다. 실패하면 400 `INVALID_NICKNAME`.
  - 201 `{token, expiresAt}`를 준다. 토큰은 1회용이고 60초 동안 유효하며, 저장은 64개까지다. 초과하면 429 `SESSION_CAPACITY`.
  - `Cache-Control: no-store`를 붙인다.
- **`sandbox` 방**:
  - 입장은 `joinOptionsSchema` `{token, protocolVersion}`이다. 실패하면 400 `INVALID_JOIN`, 버전 ≠ `0.1.0`이면 409 `PROTOCOL_MISMATCH`, 토큰 소비 실패면 401 `INVALID_SESSION`.
  - 정원 6, `maxMessagesPerSecond` 40, 50ms 틱이다.
  - `move {seq, x(-1–1), z(-1–1)}`를 받는다. 형식 오류는 `command-rejected {code:'INVALID_MOVE'}`, 순번이 마지막 이하면 `STALE_SEQUENCE`, 다른 메시지는 `UNKNOWN_COMMAND`.
  - 150ms 넘은 입력은 버린다. 누적 250ms 초과면 `TICK_OVERLOAD`를 방송하고 4000으로 끊는다.
  - 공개 상태는 모든 플레이어 위치다.
- **개발 프로필의 `kkakkung` 방**(제품 프로필이 없을 때):
  - 빈 옵션은 그대로 입장한다. 옵션이 있으면 위 0.1 검사를 한다.
  - 미로 전체와 플레이어를 공개한다. 역할은 `onJoin` 시점의 `this.state.players.size`(자신을 추가하기 전 인원)가 짝수면 도망자, 홀수면 술래로 정해진다. 즉 입장 순서대로 도망자·술래가 번갈아 배정된다.
  - `move`·`turn`을 받는다. 스키마 검증에 실패하면 `rejected {seq, reason:'invalid-message'}`를 보내는데, `seq`는 payload에 안전한 정수 `seq`가 있으면 그 값, 없으면 -1이다. 스키마를 통과했지만 규칙이 거절한 이동은 `rejected {seq: 보낸 seq, reason: 규칙이 준 사유}`로 다르게 응답한다.
  - `ready`를 받는다. 형식 오류는 항상 `rejected {seq: -1, reason:'invalid-message'}`다(`ready` payload에는 `seq`가 없다).
  - 2명 이상이 모두 ready면 3분 라운드를 시작하고, 결과를 `result {winner}`로 방송한다.
- **방 수**: sandbox 방과 개발 `kkakkung` 방은 한 프로세스에서 함께 1개만 열 수 있다. 초과하면 503 `ROOM_CAPACITY`.
- **스모크**: `server/scripts/smoke.mjs`는 `joinOrCreate('kkakkung')`(옵션 없음)과 `joinById`로 로컬 2567의 개발 `kkakkung` 방에 두 클라이언트(A=runner, B=tagger)로 들어가, A만 `exits` 필드를 받고 B는 그 필드 자체가 없는지, 둘 다 `ready`를 보내면 `playing`으로 전환되는지, A가 이동한 위치를 B의 상태 스냅샷에서도 같게 보는지를 확인한다.

근거: [bootstrap.ts:401](../../server/src/bootstrap.ts#L401), [bootstrap.ts:406](../../server/src/bootstrap.ts#L406), [bootstrap.ts:412](../../server/src/bootstrap.ts#L412), [messages/index.ts:6](../../packages/protocol/src/messages/index.ts#L6), [messages/index.ts:11](../../packages/protocol/src/messages/index.ts#L11), [messages/index.ts:15](../../packages/protocol/src/messages/index.ts#L15), [SessionStore.ts:14](../../server/src/session/SessionStore.ts#L14), [SessionStore.ts:23](../../server/src/session/SessionStore.ts#L23), [SessionStore.ts:30](../../server/src/session/SessionStore.ts#L30), [GameRoom.ts:21](../../server/src/rooms/GameRoom.ts#L21), [GameRoom.ts:35](../../server/src/rooms/GameRoom.ts#L35), [GameRoom.ts:37](../../server/src/rooms/GameRoom.ts#L37), [GameRoom.ts:42](../../server/src/rooms/GameRoom.ts#L42), [GameRoom.ts:48](../../server/src/rooms/GameRoom.ts#L48), [GameRoom.ts:55](../../server/src/rooms/GameRoom.ts#L55), [GameRoom.ts:63](../../server/src/rooms/GameRoom.ts#L63), [TickScheduler.ts:8](../../server/src/game/TickScheduler.ts#L8), [bootstrap.ts:620](../../server/src/bootstrap.ts#L620), [DevKkakkungRoom.ts:21](../../server/src/rooms/DevKkakkungRoom.ts#L21), [DevKkakkungRoom.ts:45](../../server/src/rooms/DevKkakkungRoom.ts#L45), [DevKkakkungRoom.ts:70](../../server/src/rooms/DevKkakkungRoom.ts#L70), [DevKkakkungRoom.ts:72](../../server/src/rooms/DevKkakkungRoom.ts#L72), [DevKkakkungRoom.ts:22](../../server/src/rooms/DevKkakkungRoom.ts#L22), [DevKkakkungRoom.ts:62](../../server/src/rooms/DevKkakkungRoom.ts#L62), [DevKkakkungRoom.ts:119](../../server/src/rooms/DevKkakkungRoom.ts#L119), [DevKkakkungRoom.ts:144](../../server/src/rooms/DevKkakkungRoom.ts#L144), [RoomAdmission.ts:17](../../server/src/session/RoomAdmission.ts#L17), [RoomAdmission.ts:30](../../server/src/session/RoomAdmission.ts#L30), [smoke.mjs:4](../../server/scripts/smoke.mjs#L4), [smoke.mjs:14](../../server/scripts/smoke.mjs#L14), [smoke.mjs:28](../../server/scripts/smoke.mjs#L28), [smoke.mjs:38](../../server/scripts/smoke.mjs#L38), [smoke.mjs:48](../../server/scripts/smoke.mjs#L48).

## 12. 주요 흐름

1. **기동**: 설정 검사 → 제품 프로필 조립 → media가 있으면 초기화(admission DRAINING) → listen → HTTP 외부 경계, 10ms 틱, 1초 정리·계측 루프.
2. **개장**: 운영자가 `drain`/`checkpoint`로 상태를 맞춘다. readiness가 READY가 되면 `resume`으로 admission을 OPEN으로 연다.
3. **입장**: 브라우저가 `/api/sessions/access`로 방식을 확인한다. `POST /api/sessions`는 출처·본문·속도 경계를 지난 뒤 자격을 확인하고 자리를 예약해 토큰을 준다. 클라이언트는 `{token, roomCode, protocolVersion:'0.2.0'}`로 `kkakkung`에 붙는다.
4. **대기**: 정원이 차면 DEVICE_CHECK로 간다. 모두 READY를 보내면 방장이 `ROOM_START`를 누른다. 준비 문·media 회수·월 사용량·경기 예산을 통과하면 역할을 정하고 팀별 연습 인스턴스와 media 범위를 연다.
5. **연습 → 맵**: 전원 PRACTICE_READY 또는 60초 → 연습 media 회수 대기 → 맵 준비.
6. **로딩 → 경기**: 경기 인스턴스를 연다 → 전원 LOAD_READY와 얼굴 확인 → 3초 카운트다운 → `START_PLAYING` → PLAYING.
7. **경기**: 매 50ms 틱에 명령을 동결하고 `stepMatch`를 호출한다. 개인 뷰·이벤트·media 프레임을 내고 하트비트를 감시한다.
8. **종료**: 코어 결과면 RESULT, 중단 사유면 ABORTED. 방장이 `REMATCH`하면 media 회수 확인 뒤 새 matchId의 LOBBY로 간다.
9. **정리**: 대기·결과 단계의 수명이 다하거나 세션이 사라지면 방을 4001로 닫는다. 자리는 media 회수 확인 뒤 풀린다.

근거: [bootstrap.ts:660](../../server/src/bootstrap.ts#L660), [OperationsController.ts:556](../../server/src/operations/OperationsController.ts#L556), [SessionRoutes.ts:174](../../server/src/session/SessionRoutes.ts#L174), [KkakkungRoom.ts:585](../../server/src/rooms/KkakkungRoom.ts#L585), [KkakkungRoom.ts:1619](../../server/src/rooms/KkakkungRoom.ts#L1619), [KkakkungRoom.ts:1191](../../server/src/rooms/KkakkungRoom.ts#L1191), [KkakkungRoom.ts:1827](../../server/src/rooms/KkakkungRoom.ts#L1827), [MatchDriver.ts:180](../../server/src/game/MatchDriver.ts#L180), [KkakkungRoom.ts:2132](../../server/src/rooms/KkakkungRoom.ts#L2132), [KkakkungRoom.ts:2350](../../server/src/rooms/KkakkungRoom.ts#L2350).

## 13. 이 파트를 고정하는 시험

| 동작                                                                                                    | 시험 파일:줄                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| origin이 없으면 `absent`, 정확히 같으면 허용, `null`·빈 값·복수·모르는 값 거절                          | [http-boundary.test.ts:43](../../server/test/protocol/http-boundary.test.ts#L43)                                                                                                                                                                              |
| 2,049바이트 본문이 선언 길이·실제 바이트 모두 413이고 방 수가 늘지 않음                                 | [http-boundary.test.ts:128](../../server/test/protocol/http-boundary.test.ts#L128)                                                                                                                                                                            |
| 용량 조회가 방 정보 없이 경기·로비 숫자와 `mediaBlocked`를 돌려줌                                       | [capacity-routes.test.ts:51](../../server/test/session/capacity-routes.test.ts#L51)                                                                                                                                                                           |
| 참가 자리가 찬 방은 `ROOM_FULL`, 출처 상한 초과는 `TOO_MANY_ROOMS`, 연결된 SSO 계정은 `ALREADY_IN_ROOM` | [session-routes.test.ts:272](../../server/test/session/session-routes.test.ts#L272), [session-routes.test.ts:358](../../server/test/session/session-routes.test.ts#L358), [session-routes.test.ts:412](../../server/test/session/session-routes.test.ts#L412) |
| 운영 큐 포화 시 429 `Retry-After: 1`, drain 접수는 202이며 admission DRAINING                           | [operations-handlers.test.ts:157](../../server/test/operations/operations-handlers.test.ts#L157), [operations-handlers.test.ts:172](../../server/test/operations/operations-handlers.test.ts#L172)                                                            |
| 플레이어 Bearer는 403 `{code:'UNAUTHORIZED'}`이고 submit이 호출되지 않으며 감사에 `auth-failed`만 남음  | [operations-handlers.test.ts:192](../../server/test/operations/operations-handlers.test.ts#L192), [operations-handlers.test.ts:197](../../server/test/operations/operations-handlers.test.ts#L197)                                                            |
| 간이 운영 라우트에서 미발견 404, 같은 requestId 재제출은 같은 operationId                               | [operations-routes.test.ts:80](../../server/test/session/operations-routes.test.ts#L80), [operations-routes.test.ts:89](../../server/test/session/operations-routes.test.ts#L89)                                                                              |
| 초기화 직후 admission이 DRAINING이고, 준비가 끝나면 `/health/ready`가 200 READY                         | [readiness.test.ts:290](../../server/test/health/readiness.test.ts#L290), [readiness.test.ts:313](../../server/test/health/readiness.test.ts#L313)                                                                                                            |
| media 없는 제품 프로필은 readiness·admission이 LOCKED                                                   | [product-profile.test.ts:186](../../server/test/room/product-profile.test.ts#L186)                                                                                                                                                                            |
| 4,096바이트 초과 명령은 `INVALID_COMMAND`                                                               | [command-adapter.test.ts:81](../../server/test/protocol/command-adapter.test.ts#L81)                                                                                                                                                                          |
| 같은 requestId 다른 내용이나 오래된 sequence는 `STALE_REQUEST`, actor 대기 64 초과는 `QUEUE_FULL`       | [command-queue.test.ts:66](../../server/test/protocol/command-queue.test.ts#L66), [command-queue.test.ts:82](../../server/test/protocol/command-queue.test.ts#L82)                                                                                            |
| 과부하 방은 overload 콜백을 한 번 받고 재실행되지 않음                                                  | [tick-coordinator.test.ts:48](../../server/test/room/tick-coordinator.test.ts#L48)                                                                                                                                                                            |
| 서버 멈춤 7초는 침묵으로 세지 않고 stall 한 번으로 보고                                                 | [heartbeat.test.ts:83](../../server/test/room/heartbeat.test.ts#L83)                                                                                                                                                                                          |
| 만료 판정 `expire-idle`, `recover-device-check`, `expire-sessions`                                      | [room-expiry.test.ts:24](../../server/test/session/room-expiry.test.ts#L24), [room-expiry.test.ts:43](../../server/test/session/room-expiry.test.ts#L43), [room-expiry.test.ts:52](../../server/test/session/room-expiry.test.ts#L52)                         |
| 재경기 swap 계획의 역할 반전, media 회수 확인 전에는 시작 불가                                          | [rematch.test.ts:46](../../server/test/room/rematch.test.ts#L46), [rematch.test.ts:64](../../server/test/room/rematch.test.ts#L64)                                                                                                                            |
| 월 사용량 문과 경기 예산 문이 공개 `preparationIssue`로 나감                                            | [monthly-usage-gate.test.ts:73](../../server/test/room/monthly-usage-gate.test.ts#L73), [match-capacity-gate.test.ts:73](../../server/test/room/match-capacity-gate.test.ts#L73)                                                                              |
| 내부 진단 → 공개 준비 문제 매핑                                                                         | [preparation-issue.test.ts:5](../../server/test/room/preparation-issue.test.ts#L5)                                                                                                                                                                            |
| 시연 방이 시드 20260922, 6자리 템플릿 요청, `timeout-only`로 경기 생성, 방장 이탈 시 4003               | [showcase-room.test.ts:206](../../server/test/room/showcase-room.test.ts#L206), [showcase-room.test.ts:216](../../server/test/room/showcase-room.test.ts#L216), [showcase-room.test.ts:309](../../server/test/room/showcase-room.test.ts#L309)                |
| 데모 운영자가 떠난 방은 121초 뒤 자리가 비고 재입장 거절                                                | [demo-room.test.ts:355](../../server/test/room/demo-room.test.ts#L355)                                                                                                                                                                                        |
| audience가 입장 방식을 정함                                                                             | [config.test.ts:38](../../server/tests/config.test.ts#L38)                                                                                                                                                                                                    |

기본 실행에서 건너뛰거나 조건부인 시험은 다음과 같다.

| 대상                                                  | 조건                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `**/*.cloud.test.{ts,tsx}`                            | 기본 Vitest `exclude`. Cloud 설정·스크립트로만 실행          |
| `server/test/room/demo-scenarios.test.ts` 실시간 블록 | `KKAKKUNG_DEMO_SCENARIOS`가 없으면 `describe.skipIf`         |
| `server/test/media/multi-room-integration.test.ts`    | `KKAKKUNG_TEST_ROOMS`가 2–10 정수가 아니면 `describe.skipIf` |

로컬 단위 시험을 Cloud·실장치 통과 증거로 쓰지 않는다.

근거: [vitest.config.ts:15](../../vitest.config.ts#L15), [demo-scenarios.test.ts:434](../../server/test/room/demo-scenarios.test.ts#L434), [multi-room-integration.test.ts:39](../../server/test/media/multi-room-integration.test.ts#L39).

## 14. 확인된 한계

- **시연 방 맵이 소형이 아니다(독립 확인됨).** 시연 방은 `roomMapSize`만 `small`로 두고 `roomMapRevision`을 0에서 올리지 않는다(`ROOM_MAP_SIZE`가 항상 `INVALID_PHASE`). 그런데 `startFinalizing`은 `this.roomMapRevision > 0`일 때만 크기별 템플릿(`deps.layouts.bySize`)을 쓴다. 따라서 시연 방은 항상 `deps.layouts`(기본 `PRODUCT_MAP_TEMPLATE`, 기본값 `maze-v1` 31격자)로 준비되고, 방송하는 크기(`small`)와 실제 경기 맵이 다르다.
  - `server/test/room/showcase-room.test.ts`의 가짜 `LayoutLoader.prepare`는 `players`와 `seed`만 기록하고(`masterPath`·`templateId` 없음) 항상 같은 캔버스 소형 레이아웃을 반환하므로, 어느 템플릿 경로가 실제로 전달됐는지 시험이 구분하지 못해 이 문제를 잡지 못한다.
- **경보의 운영 잠금과 수동 해제가 연결되지 않았다.** `AlertPolicy.isLocked()`와 `acknowledgeResolved()`는 server/src 어디서도 호출되지 않는다. `locksOperations` 경보는 어떤 동작도 막지 않고, 수동 해제 경보(`MEDIA_RETIREMENT_UNRESOLVED`, `TICK_OVERLOAD`, `OBSERVABILITY_DROPPED`)는 재시작 전까지 켜져 있다.
- **일부 경보는 발동할 수 없다.** `media.api.total60s`, `media.api.429`, `operations.journal.writable` metric을 내는 코드가 없고 `ApiBudget`의 `onSnapshot`도 연결되지 않았다. 그래서 `MEDIA_API_BUDGET_NEAR_LIMIT`, `MEDIA_API_RATE_LIMITED`, `JOURNAL_NOT_WRITABLE`은 발동하지 않는다.
- **이벤트·metric 이름이 등록만 돼 있다.** 이벤트 11개와 metric 9개가 허용·등록 목록에만 있고 발생 지점이 없다([10.2](#102-구조화-이벤트와-로그), [10.3](#103-metric)).
- **`MAX_SLOTS` 이름이 오해를 부른다.** 설정 검사는 `MAX_ROOMS × 6`을 강제하지만 좌석 등록부는 `LOBBY_MAX_ROOMS × 6 + SHOWCASE_ROOMS × 4`로 좌석을 센다. 이 값은 media 동시 참가자 한도에만 쓰여, 이름이 실제 예약 좌석 총량을 뜻하지 않는다.
- **media 없는 제품 프로필은 운영자 입장만 된다.** 일반·시연 입장이 늘 닫히고 데모 방만 열린다. 의도인지 확인이 필요하다.
- **운영 경로 두 구현의 코드가 다르다.** 인증 실패가 403/401, 본문 키가 `code`/`error`, 형식 오류가 `INVALID_COMMAND`/`INVALID_REQUEST`로 갈린다.
- **`/api/capacity`는 인증을 검사하지 않는다.** 누가 통과하는지는 저장소 밖 프록시 설정에 달려 있다.
- **별칭 수명이 설명과 다르다.** `retireInstance`가 인스턴스 하나를 회수할 때마다 전체 별칭을 지운다. EnemyAliases 설명("라운드 동안 안정")과 달리 연습 인스턴스 회수 때 별칭이 바뀐다.
- **주석과 코드 불일치:**
  - `AlertPolicy.ts` 상단: 외부 알림 채널이 없다고 하지만 webhook notifier가 있다.
  - `env.ts` `SHOWCASE_ROOMS` 설명: "시연 방은 MAX_ROOMS 안에서 함께 센다"고 하지만 등록부는 별도 예산이다.
  - `SlotRegistry.ts` 상단: "service capacity is 60 seats"라고 하지만 계산식을 쓴다.
  - `KkakkungRoom.ts` `DEMO_REJOIN_GRACE_MS`: "frees its MAX_ROOMS slot"이라고 하지만 데모는 별도 예산이다.
  - `LobbyCoordinator.ts` 상단: 여섯이 준비하면 역할을 배정한다고 하지만 실제로는 방장 `ROOM_START`가 필요하다. "seeded random"이라고 하지만 실제로는 `Math.random`이다.
  - `HttpBoundary.ts` 상단: origin 거절이 본문을 읽기 전 403이라고 하지만, 실제로는 속도 검사가 origin보다 먼저 실행된다.

근거: [KkakkungRoom.ts:631](../../server/src/rooms/KkakkungRoom.ts#L631), [KkakkungRoom.ts:1795](../../server/src/rooms/KkakkungRoom.ts#L1795), [KkakkungRoom.ts:1797](../../server/src/rooms/KkakkungRoom.ts#L1797), [showcase-room.test.ts:56](../../server/test/room/showcase-room.test.ts#L56), [AlertPolicy.ts:224](../../server/src/observability/AlertPolicy.ts#L224), [AlertPolicy.ts:237](../../server/src/observability/AlertPolicy.ts#L237), [ApiBudget.ts:56](../../server/src/operations/ApiBudget.ts#L56), [env.ts:226](../../server/src/config/env.ts#L226), [bootstrap.ts:204](../../server/src/bootstrap.ts#L204), [ProductProfileLoader.ts:162](../../server/src/game/ProductProfileLoader.ts#L162), [bootstrap.ts:227](../../server/src/bootstrap.ts#L227), [CapacityRoutes.ts:24](../../server/src/session/CapacityRoutes.ts#L24), [KkakkungRoom.ts:1983](../../server/src/rooms/KkakkungRoom.ts#L1983), [EnemyAliases.ts:11](../../server/src/game/EnemyAliases.ts#L11), [AlertPolicy.ts:3](../../server/src/observability/AlertPolicy.ts#L3), [env.ts:120](../../server/src/config/env.ts#L120), [SlotRegistry.ts:4](../../server/src/session/SlotRegistry.ts#L4), [KkakkungRoom.ts:122](../../server/src/rooms/KkakkungRoom.ts#L122), [LobbyCoordinator.ts:4](../../server/src/rooms/LobbyCoordinator.ts#L4), [HttpBoundary.ts:7](../../server/src/session/HttpBoundary.ts#L7).

## 15. 다룬 파일

`git ls-files server`(293개)와 대조했다.

본문에서 동작을 설명한 파일:

- `server/src/`: `bootstrap.ts`, `main.ts`, `index.ts`(`main.js` import만 함), `process-guard.ts`
- `config/`: `env.ts`, `ProductDeployment.ts`, `RuntimeEvidence.ts`
- `game/`: `ProductProfileLoader.ts`, `map-templates.ts`, `LayoutLoader.ts`, `RoomTickCoordinator.ts`, `TickScheduler.ts`, `MatchDriver.ts`, `MatchContext.ts`, `EventDispatcher.ts`, `PlayerProjection.ts`, `EnemyAliases.ts`, `Spectate.ts`, `CommandAdapter.ts`, `CommandLimiter.ts`, `CommandQueue.ts`, `Heartbeat.ts`, `ClockSync.ts`, `ports.ts`
- `rooms/`: `KkakkungRoom.ts`, `LobbyCoordinator.ts`, `PracticeCoordinator.ts`, `LoadingCoordinator.ts`, `CountdownCoordinator.ts`, `RematchCoordinator.ts`, `preparation-issue.ts`, `DemoScenarios.ts`, `RoomDirectory.ts`, `GameRoom.ts`, `DevKkakkungRoom.ts`
- `session/`: `HttpBoundary.ts`, `client-origin.ts`, `ProductHttpLimiter.ts`, `AdmissionLimiter.ts`, `SessionRoutes.ts`, `CapacityRoutes.ts`, `InvitationRoutes.ts`, `invite-types.ts`, `InviteStore.ts`, `RoomInvitations.ts`, `DemoRoutes.ts`, `ShowcaseRoutes.ts`, `operator-allowlist.ts`, `OperationsRoutes.ts`, `ProductSessionStore.ts`, `SessionStore.ts`, `SlotRegistry.ts`, `ReservationCleanup.ts`, `RoomExpiry.ts`, `RoomAdmission.ts`
- `operations/`: `OperatorAuth.ts`, `OperationsHandlers.ts`, `OperationsController.ts`, `OperationsBindings.ts`, `OperationsAudit.ts`, `OperationJournal.ts`, `CheckpointStore.ts`, `UsageCheckpoint.ts`, `SharedRetryCheckpoint.ts`, `UsageBudget.ts`, `RevocationRetries.ts`, `RecoveryBootstrap.ts`, `DurableRetentionPlan.ts`, `ApiBudget.ts`
- `health/`: `HealthHandlers.ts`, `Readiness.ts`, `ReadinessRuntime.ts`, `ReservationReadiness.ts`
- `observability/`: `StructuredEvents.ts`, `MetricRegistry.ts`, `AlertPolicy.ts`, `AlertNotifier.ts`
- 그 밖: `server/scripts/smoke.mjs`, 13절에 적은 시험 파일

미설명:

- 운영 세부: `server/src/operations/CheckpointRename.ts`, `DurableRetention.ts`, `ExpiredRetirementProof.ts`, `ForwardIntent.ts`, `ImmutableSnapshot.ts`, `MediaUsageLease.ts`, `PreviousGenerationCleanup.ts`, `RecoveryCleanupBindings.ts`, `RecoveryRecords.ts`, `RecoveryState.ts`, `ReservationIntent.ts`, `RetentionPolicy.ts`, `RevocationRetryBindings.ts`, `SplitMediaOwnership.ts`, `UsageReservationId.ts`. 파일 이름·체크포인트 규칙만 7절에 쓰고, 각각의 세부 판정은 설명하지 않았다.
- 재수출: `server/src/domain/index.ts`, `server/src/domain/types.ts`(`@kkakkung/game-core/match` 재수출), `server/src/rooms/schema/GameState.ts`(`@kkakkung/protocol/game-schema` 재수출)
- 타입 전용: `server/src/session/session-types.ts`(세션 저장소·Room 인증 타입)
- 다른 문서 소유: `server/src/media/` 24개(media.md), `server/content/` 지도·배치 JSON과 `server/config/tuning/mvp-v1.json`(game-core.md)
- 근거 불인정 문서: `server/.env.example`, `server/README.md`, `server/docs/protocol.md`
- 빌드 설정: `server/package.json`, `server/tsconfig.json`
- 시험: 13절 표에 없는 `server/test/**`·`server/tests/**` 파일 전부. `server/test/media/**`와 `cloud/**`는 media.md 소유다.

근거: [index.ts:2](../../server/src/index.ts#L2), [domain/index.ts:1](../../server/src/domain/index.ts#L1), [GameState.ts:1](../../server/src/rooms/schema/GameState.ts#L1).
