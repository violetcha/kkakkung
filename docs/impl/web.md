> 기준: origin/develop 200d186273d7 (2026-09-24). 이후 S15P21C204-376(시연 방 맵)·377(시야·안개) 변경을 반영했다.

# 웹 구현 명세

## 1. 역할과 경계

웹은 브라우저의 입장, 화면 선택, 장치 조작, 개인 상태 표시와 3D 장면을 맡는다. 권위 있는 이동·포획·승패는 서버가 보낸 공개 상태·개인 뷰·명령 결과를 받아 그린다. 얼굴 게시·원격 얼굴·음성 연결의 규칙(`features/media`)은 [media.md](media.md)가 소유한다. 이 문서는 화면이 미디어 상태를 어떻게 보여 주는지만 다룬다.

ESLint는 `apps/web/**/*.{ts,tsx}`에서 `@kkakkung/game-core`, `@kkakkung/game-core/*`, `**/game-server/**`, `**/server/**`, `**/packages/game-core/**` import를 오류로 막는다. 실제 웹 코드에는 이 경로의 import가 없다. 웹이 쓰는 protocol 진입점은 `@kkakkung/protocol/game-messages`, `game-schema`, `version`, `schema-runtime`이다. 진단 경로는 `@kkakkung/protocol/schema`도 쓴다.

| 상대 파트 | 웹이 쓰는 계약                                                                              | 웹의 책임                                                  |
| --------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| protocol  | 세션·초대·데모·시연·여유 HTTP 형상, `PublicMatchState`, 개인 뷰, 명령 envelope, Room 메시지 | 응답을 스키마로 파싱하고, 상태에 맞는 화면과 입력을 고른다 |
| server    | 3절의 HTTP 경로와 `kkakkung` Room                                                           | 입장 예약, Room 연결, 명령 전송, 끊김 안내                 |
| media     | 처리된 얼굴 면·원격 얼굴 텍스처·음성 상태                                                   | 동의·점검·얼굴 타일·음량 제어 표시                         |

근거: [eslint.config.mjs:47](../../eslint.config.mjs#L47), [eslint.config.mjs:53](../../eslint.config.mjs#L53), [product-session.ts:129](../../apps/web/src/features/room/product-session.ts#L129), [product-runtime.ts:1195](../../apps/web/src/app/product-runtime.ts#L1195), [colyseus-session.ts:3](../../apps/web/src/features/room/colyseus-session.ts#L3), [schema-runtime.ts:8](../../apps/web/src/app/schema-runtime.ts#L8)

## 2. 진입 경로와 주소 처리

### 2.1 경로 분기

`App`은 아래 순서로 화면을 고른다. 개발 전용 화면(`DevelopmentApp`, `PreviewApp`)은 `import.meta.env.DEV`일 때만 lazy import로 만든다. 배포 빌드에서는 두 화면이 `null`이라 로드되지 않는다.

| 조건                                                     | 화면                           |
| -------------------------------------------------------- | ------------------------------ |
| 개발 빌드이고 경로가 정확히 `/preview`                   | `PreviewApp`(합성 검수, 2.4)   |
| 경로가 `/demo` 또는 `/demo/`                             | `DemoAdminApp`(데모 발급, 2.5) |
| 경로가 `/showcase` 또는 `/showcase/`                     | `ShowcaseApp`(시연 발급, 2.5)  |
| 개발 빌드이고 경로가 `/play`가 아니고 주소에 hash도 없음 | `DevelopmentApp`(진단, 2.3)    |
| 그 밖의 모든 경로(배포 빌드의 `/preview` 포함)           | `ProductApp`(제품)             |

근거: [App.tsx:13](../../apps/web/src/app/App.tsx#L13), [App.tsx:15](../../apps/web/src/app/App.tsx#L15), [App.tsx:17](../../apps/web/src/app/App.tsx#L17), [App.tsx:23](../../apps/web/src/app/App.tsx#L23), [App.tsx:58](../../apps/web/src/app/App.tsx#L58), [App.tsx:64](../../apps/web/src/app/App.tsx#L64), [App.tsx:66](../../apps/web/src/app/App.tsx#L66)

### 2.2 fragment와 쿼리

`/demo`·`/showcase`가 아닌 경로에서는 모듈이 읽힐 때 데모 → 시연 → 초대 순으로 fragment를 소비한다. 앞 단계가 세션을 얻으면 뒤 단계는 건너뛴다. 데모·시연 세션이 있으면 초대 방 힌트와 초대 토큰은 빈 값이다.

| 주소 입력                                          | 처리                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `#demo=<token>&room=<code>&player=<id>`            | 토큰과 player가 있고 room이 `ROOM_CODE_PATTERN`에 맞으면 세션으로 받고 `replaceState`로 hash를 지운다. 세션을 이 탭의 `sessionStorage`에 저장한다(16절). 형식이 깨졌으면 무시하고 hash도 지우지 않는다.            |
| hash가 없고 `sessionStorage`에 데모 세션이 있음    | 저장된 세션으로 다시 입장한다(새로고침 재입장). 저장값이 잘못됐으면 지운다.                                                                                                                                        |
| `#showcase=<token>&room=<code>&player=<id>`        | 데모와 같은 검증을 거쳐 소비하고 hash를 지운다. 저장소에는 남기지 않는다.                                                                                                                                          |
| `#invite=<token>` 또는 `#inviteToken=<token>`      | `inviteToken`을 먼저 읽는다. hash가 있으면 무조건 지운다. `room` 값이 `^[A-HJ-NP-Z2-9]{6}$`이면 입장 폼의 방 코드 힌트로 쓴다.                                                                                     |
| 입장 뒤 `hashchange`로 `invite`/`inviteToken`이 옴 | 초대를 다시 소비한다. 진단 화면이었으면 제품 화면으로 바꾼다. 아직 Room이 없을 때만 폼을 초대 기준으로 초기화한다(진행 중인 입장을 취소하고 방 코드·참가 모드를 적용). Room에 있으면 다음 입장을 위해 보관만 한다. |
| `?theme=block` / `?theme=facility`                 | 렌더 테마를 저장값보다 먼저 쓴다(15.2).                                                                                                                                                                            |
| `?metrics=1`                                       | 이 페이지에서만 계측기를 만들고 `window.__kkakkungMetrics`에 `read()` 접근자를 게시한다.                                                                                                                           |

fragment로 받은 데모·시연 세션의 `expiresAt`은 받은 시각에 `60000ms`를 더한 값이다. 초대의 `room` 힌트는 이동 편의일 뿐이고, 실제 방 권한은 세션 발급과 Room 입장에서 서버가 검사한다.

근거: [App.tsx:26](../../apps/web/src/app/App.tsx#L26), [App.tsx:28](../../apps/web/src/app/App.tsx#L28), [App.tsx:36](../../apps/web/src/app/App.tsx#L36), [App.tsx:44](../../apps/web/src/app/App.tsx#L44), [product-session.ts:30](../../apps/web/src/features/room/product-session.ts#L30), [product-session.ts:39](../../apps/web/src/features/room/product-session.ts#L39), [product-session.ts:248](../../apps/web/src/features/room/product-session.ts#L248), [product-session.ts:263](../../apps/web/src/features/room/product-session.ts#L263), [product-session.ts:283](../../apps/web/src/features/room/product-session.ts#L283), [product-session.ts:297](../../apps/web/src/features/room/product-session.ts#L297), [product-session.ts:315](../../apps/web/src/features/room/product-session.ts#L315), [ProductApp.tsx:304](../../apps/web/src/app/ProductApp.tsx#L304), [runtime-metrics.ts:277](../../apps/web/src/app/runtime-metrics.ts#L277), [runtime-metrics.ts:288](../../apps/web/src/app/runtime-metrics.ts#L288)

### 2.3 진단 화면(개발 빌드 전용)

진단 화면은 제품 상태(`ProductSnapshot`)와 다른 저장소(`useAppStore`)를 쓴다. 0.1 계약의 개발 세션으로 들어간다.

- 연동 모드는 `team`(기존 룸 연동)과 `sandbox`(이동 샘플) 둘이다.
- 닉네임이 1~20자가 아니면 `닉네임은 1~20자로 입력해 주세요.`를 표시한다. 통과하면 `POST {VITE_API_BASE_URL}/dev-sessions`로 토큰을 받는다.
- `team`은 `kkakkung` Room에 0.1 `PROTOCOL_VERSION`으로 들어가 `GameState`의 `waiting`/`prep`/`countdown`/`playing`/`result`를 표시한다. `waiting`에서만 `ready`를 보내고, `move`·`turn` 메시지를 보낸다.
- `sandbox`는 `ROOM_NAME` Room에서 50ms마다 정규화된 이동 벡터를 보낸다.
- 이 화면의 `카메라·비전·음성 미디어는 아직 구현되지 않았습니다.` 문구는 진단 경로에만 있다. 제품 경로의 상태가 아니다.

근거: [DevelopmentApp.tsx:15](../../apps/web/src/app/DevelopmentApp.tsx#L15), [DevelopmentApp.tsx:28](../../apps/web/src/app/DevelopmentApp.tsx#L28), [DevelopmentApp.tsx:52](../../apps/web/src/app/DevelopmentApp.tsx#L52), [DevelopmentApp.tsx:75](../../apps/web/src/app/DevelopmentApp.tsx#L75), [DevelopmentApp.tsx:178](../../apps/web/src/app/DevelopmentApp.tsx#L178), [DevelopmentApp.tsx:198](../../apps/web/src/app/DevelopmentApp.tsx#L198), [DevelopmentApp.tsx:284](../../apps/web/src/app/DevelopmentApp.tsx#L284), [colyseus-session.ts:16](../../apps/web/src/features/room/colyseus-session.ts#L16), [colyseus-session.ts:37](../../apps/web/src/features/room/colyseus-session.ts#L37), [movement-controller.ts:58](../../apps/web/src/features/input/movement-controller.ts#L58), [SessionRuntime.ts:38](../../apps/web/src/app/SessionRuntime.ts#L38)

### 2.4 `/preview` 검수 화면(개발 빌드 전용)

`PreviewApp`은 합성 fixture 화면이다. 항목은 `로비`, `장치 점검`, `경기 HUD`, `미로`, `장비`, `교환`, `포즈`, `키 도전`, `연습`, `로딩`, `결과`, `연결 상실`, `렌더 검수`이다. `렌더 검수`(`RenderPreview`)는 제품 경로에서 유일하게 테마 선택을 `kkakkung.scene-theme`에 저장하는 곳이다.

`장치 점검` 항목은 `DeviceCheckScreen`을 쓴다. 제품 대기실은 이 컴포넌트를 쓰지 않는다(제품 흐름은 8절). 이 화면은 동의 전에는 `ConsentGate`만 그리고, 동의 뒤 네 단계를 판정한다.

| 단계   | 판정                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 카메라 | camera나 vision이 `failed`면 막힘. 둘 다 `ready`면 통과. camera `requesting`이나 vision `loading`이면 진행 중.                             |
| 자세   | calibration `failed`면 막힘, `running`이면 진행 중. `ready`이고 앞 기울이기·고개 돌리기를 봤으면 통과(동작 신호가 없으면 보정만으로 통과). |
| 소리   | audioPlayback `failed`면 막힘, `ready`면 통과. 마이크는 보지 않음.                                                                         |
| 완료   | camera·vision·calibration·audioPlayback이 모두 `ready`.                                                                                    |

통과한 단계는 기억해 두어, 일시적인 추적 손실로 앞 단계로 되돌리지 않는다. 막힌 단계는 기억을 지운다. 한 단계라도 막히면 `완료`를 해제한다. 오류 코드가 `CALIBRATION_`로 시작하면 자세, `MICROPHONE_`·`AUDIO_`면 소리, 그 밖은 카메라 단계에 표시한다. 데모 방이면 먼저 `데모 방 준비` 화면에서 `장치 점검 없이 준비 완료`와 `장치 점검 진행`을 고르게 한다.

근거: [PreviewApp.tsx:46](../../apps/web/src/app/PreviewApp.tsx#L46), [PreviewApp.tsx:98](../../apps/web/src/app/PreviewApp.tsx#L98), [PreviewApp.tsx:170](../../apps/web/src/app/PreviewApp.tsx#L170), [RenderPreview.tsx:46](../../apps/web/src/app/RenderPreview.tsx#L46), [device-check-steps.ts:26](../../apps/web/src/features/game/flow/device-check-steps.ts#L26), [device-check-steps.ts:37](../../apps/web/src/features/game/flow/device-check-steps.ts#L37), [device-check-steps.ts:45](../../apps/web/src/features/game/flow/device-check-steps.ts#L45), [device-check-steps.ts:60](../../apps/web/src/features/game/flow/device-check-steps.ts#L60), [device-check-steps.ts:97](../../apps/web/src/features/game/flow/device-check-steps.ts#L97), [device-check-steps.ts:132](../../apps/web/src/features/game/flow/device-check-steps.ts#L132), [DeviceCheckScreen.tsx:114](../../apps/web/src/features/game/flow/DeviceCheckScreen.tsx#L114), [DeviceCheckScreen.tsx:142](../../apps/web/src/features/game/flow/DeviceCheckScreen.tsx#L142)

### 2.5 `/demo`와 `/showcase` 발급 화면

두 화면은 역할(`runner`/`tagger`, 기본 `runner`)과 최대 20자의 표시 이름을 받는다. 데모의 기본 이름은 `관리자`, 시연은 빈 값이다. 빈 이름은 보내지 않는다. 발급에 성공하면 `/play` + 응답의 `entryFragment`로 이동한다. SSO 보호는 이 컴포넌트가 하지 않는다. 호스트 경계가 맡는다(저장소 밖).

| 화면        | 실패 조건               | 문구                                                                                                             |
| ----------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/demo`     | 상태 `401`              | 관리자 권한을 확인하지 못했습니다. 다시 로그인해 주세요.                                                         |
| `/demo`     | 코드 `DEMO_ROOM_LIMIT`  | 다른 데모 방이 아직 열려 있습니다. 그 방에서 라운드를 끝내고 나가거나, 나간 지 2분이 지나면 다시 열 수 있습니다. |
| `/demo`     | 그 밖의 `503`           | 데모 방을 지금 열 수 없습니다. 운영 설정(DEMO_ROOMS)이나 서비스 상태를 확인해 주세요.                            |
| `/demo`     | 그 밖                   | 데모 방을 열지 못했습니다. 네트워크와 운영 상태를 확인한 뒤 다시 시도해 주세요.                                  |
| `/showcase` | 코드 `ADMISSION_CLOSED` | 지금은 입장을 받고 있지 않습니다. 서버가 준비되면 다시 시도해 주세요.                                            |
| `/showcase` | `401`                   | 팀원 로그인을 확인하지 못했습니다. 다시 로그인해 주세요.                                                         |
| `/showcase` | `409`                   | 그 역할은 이미 두 명이 골랐습니다. 다른 역할을 골라 주세요.                                                      |
| `/showcase` | `503`                   | 시연 방을 지금 열 수 없습니다. 열려 있는 방이 가득 찼거나 운영 설정이 꺼져 있습니다.                             |
| `/showcase` | 그 밖                   | 시연 방에 들어가지 못했습니다. 네트워크와 로그인 상태를 확인한 뒤 다시 시도해 주세요.                            |

근거: [DemoAdminApp.tsx:5](../../apps/web/src/app/DemoAdminApp.tsx#L5), [DemoAdminApp.tsx:20](../../apps/web/src/app/DemoAdminApp.tsx#L20), [DemoAdminApp.tsx:36](../../apps/web/src/app/DemoAdminApp.tsx#L36), [ShowcaseApp.tsx:6](../../apps/web/src/app/ShowcaseApp.tsx#L6), [ShowcaseApp.tsx:48](../../apps/web/src/app/ShowcaseApp.tsx#L48), [ShowcaseApp.tsx:74](../../apps/web/src/app/ShowcaseApp.tsx#L74), [product-session.ts:122](../../apps/web/src/features/room/product-session.ts#L122), [product-session.ts:211](../../apps/web/src/features/room/product-session.ts#L211)

## 3. HTTP 호출 경로

제품 경로는 모두 상대 경로이고 `redirect: 'error'`, `cache: 'no-store'`를 쓴다. `/api/media/*`의 상세 동작은 [media.md](media.md)에 있다.

| 메서드        | 경로                                     | 호출 시점                                                | 시간 제한 | 실패 처리                                                                                                                |
| ------------- | ---------------------------------------- | -------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET           | `/api/sessions/access`                   | 홈 표시 때와 `접속 상태 다시 확인`                       | 10000ms   | `404`면 `invitation`으로 간주한다. 그 밖의 비정상 응답이나 예외는 `failed`.                                              |
| POST          | `/api/sessions`                          | 입장 폼 제출                                             | 10000ms   | 본문 `error`가 `SESSION_ERROR_CODES` 중 하나면 그 코드, 아니면 `CONNECTION_FAILED`. 응답 파싱 실패는 `INVALID_RESPONSE`. |
| DELETE        | `/api/sessions/current`                  | 웹이 발급받은 예약의 취소(Bearer 세션 토큰, `keepalive`) | 5000ms    | 오류는 무시한다(서버의 입장 기한이 정리한다).                                                                            |
| GET           | `/api/capacity`                          | 입장 패널이 보이는 동안 즉시, 이후 15000ms마다           | 5000ms    | 실패·`404`·모르는 형식은 표시만 뺀다.                                                                                    |
| POST / DELETE | `/api/sessions/current/invitation`       | 방장의 초대 링크 발급(`201`) / 회수(`204`)               | 10000ms   | 7.4절 문구.                                                                                                              |
| POST          | `/api/demo-admin/rooms`                  | `/demo` 제출(`credentials: same-origin`)                 | 10000ms   | `DEMO_REQUEST_FAILED:<상태>[:<코드>]`.                                                                                   |
| POST          | `/api/showcase/rooms`                    | `/showcase` 제출(`credentials: same-origin`)             | 10000ms   | `SHOWCASE_REQUEST_FAILED:<상태>[:<코드>]`.                                                                               |
| POST          | `/api/media/grants`, `/api/media/report` | 미디어 발급·보고                                         | —         | [media.md](media.md).                                                                                                    |
| POST          | `{VITE_API_BASE_URL}/dev-sessions`       | 진단 화면만                                              | 없음      | 본문 `message` 또는 `개발 세션을 만들 수 없습니다.`                                                                      |

근거: [session.ts:5](../../packages/protocol/src/game-messages/session.ts#L5), [session.ts:7](../../packages/protocol/src/game-messages/session.ts#L7), [session.ts:13](../../packages/protocol/src/game-messages/session.ts#L13), [session.ts:26](../../packages/protocol/src/game-messages/session.ts#L26), [session.ts:73](../../packages/protocol/src/game-messages/session.ts#L73), [session.ts:102](../../packages/protocol/src/game-messages/session.ts#L102), [session.ts:125](../../packages/protocol/src/game-messages/session.ts#L125), [media.ts:120](../../packages/protocol/src/game-messages/media.ts#L120), [product-session.ts:48](../../apps/web/src/features/room/product-session.ts#L48), [product-session.ts:54](../../apps/web/src/features/room/product-session.ts#L54), [product-session.ts:67](../../apps/web/src/features/room/product-session.ts#L67), [product-session.ts:81](../../apps/web/src/features/room/product-session.ts#L81), [product-session.ts:144](../../apps/web/src/features/room/product-session.ts#L144), [product-session.ts:149](../../apps/web/src/features/room/product-session.ts#L149), [service-capacity.ts:14](../../apps/web/src/features/room/service-capacity.ts#L14), [service-capacity.ts:63](../../apps/web/src/features/room/service-capacity.ts#L63), [RoomInvitationControls.tsx:51](../../apps/web/src/features/room/RoomInvitationControls.tsx#L51), [RoomInvitationControls.tsx:65](../../apps/web/src/features/room/RoomInvitationControls.tsx#L65), [product-runtime.ts:570](../../apps/web/src/app/product-runtime.ts#L570), [colyseus-session.ts:16](../../apps/web/src/features/room/colyseus-session.ts#L16)

## 4. 홈과 입장 폼

### 4.1 홈 패널

- `homePanel`은 `title`/`admission`/`options` 세 값이다. 초대 토큰이나 방 힌트가 있으면 처음부터 `admission`이다.
- `title`에서는 `시작하기`(→`admission`)와 `옵션`(→`options`)을 고른다.
- `options`에서 Esc(반복 제외)를 누르면 `title`로 돌아간다.
- 옵션 창의 갈래는 `화면`(품질·배경 움직임·디버그 오버레이), `소리`(음량·전체 끄기), `조작`(조작 안내), `카메라 · 장치`이다. `카메라 · 장치`는 `카메라 점검은 방에 들어간 뒤 Esc 설정에서 합니다. 홈에서는 카메라를 켜지 않아요.`로 잠겨 있다.
- 입장 창의 갈래는 `방 잡기`(입장 폼), `튜토리얼`(누르면 혼자 연습으로 전환, 14절), `게임 방법`(안내 문구)이다.
- 입장 창의 발치에는 `6인 멀티플레이`·`PC · 카메라 필수`와 `/licenses/index.html`(오픈소스 고지) 링크가 있다.

근거: [ProductApp.tsx:107](../../apps/web/src/app/ProductApp.tsx#L107), [ProductApp.tsx:111](../../apps/web/src/app/ProductApp.tsx#L111), [ProductApp.tsx:692](../../apps/web/src/app/ProductApp.tsx#L692), [ProductApp.tsx:716](../../apps/web/src/app/ProductApp.tsx#L716), [ProductApp.tsx:739](../../apps/web/src/app/ProductApp.tsx#L739), [ProductApp.tsx:760](../../apps/web/src/app/ProductApp.tsx#L760), [ProductApp.tsx:769](../../apps/web/src/app/ProductApp.tsx#L769), [ProductApp.tsx:899](../../apps/web/src/app/ProductApp.tsx#L899)

### 4.2 입장 폼 규칙

| 항목        | 규칙                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 닉네임      | `maxLength=20`, `required`. 전송할 때 양끝 공백을 지운다. 스키마는 1~20자.                                                                           |
| 입장 방법   | `새 방 만들기`/`친구 방 참가` 라디오. 초기값은 방 힌트가 없으면 만들기.                                                                              |
| 방 코드     | 참가일 때만 보인다. `maxLength=6`, `required`. 전송 전 trim하고 대문자로 바꾼다. 스키마 `^[A-HJ-NP-Z2-9]{6}$`.                                       |
| 초대 토큰   | 있으면 `inviteToken`으로 함께 보낸다. 스키마 16~512자.                                                                                               |
| 사전 검사   | `sessionRequestSchema`에 맞지 않으면 요청하지 않고 `INVALID_REQUEST`로 처리한다.                                                                     |
| 제출 비활성 | `joining` 중이거나, 만들기인데 여유 표시의 `createBlocked`가 참이거나, 초대 토큰이 없고 `access`가 `gitlab-sso`가 아니며 `guest`+만들기도 아닌 경우. |
| 단추 문구   | `입장 중…` / `방 만들기` / `방 참가`. `joining` 동안 입력을 잠그고 `입장 취소`를 표시한다.                                                           |

근거: [ProductApp.tsx:93](../../apps/web/src/app/ProductApp.tsx#L93), [ProductApp.tsx:380](../../apps/web/src/app/ProductApp.tsx#L380), [ProductApp.tsx:388](../../apps/web/src/app/ProductApp.tsx#L388), [ProductApp.tsx:786](../../apps/web/src/app/ProductApp.tsx#L786), [ProductApp.tsx:828](../../apps/web/src/app/ProductApp.tsx#L828), [ProductApp.tsx:840](../../apps/web/src/app/ProductApp.tsx#L840), [ProductApp.tsx:848](../../apps/web/src/app/ProductApp.tsx#L848), [session.ts:43](../../packages/protocol/src/game-messages/session.ts#L43), [product-session.ts:63](../../apps/web/src/features/room/product-session.ts#L63)

### 4.3 접속 방식별 안내

| `access`     | 안내 문구                                                                                                                                                                                                                        | 초대 없이 제출   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `checking`   | 초대가 없을 때 `접속 상태 확인 중…`                                                                                                                                                                                              | 불가             |
| `invitation` | 초대가 없을 때 `유효한 초대 링크로 열어 주세요.`                                                                                                                                                                                 | 불가             |
| `gitlab-sso` | `팀원 로그인이 확인됐습니다. 바로 방을 만들거나 참가하세요.`                                                                                                                                                                     | 만들기·참가 가능 |
| `guest`      | 만들기: `가입 없이 시작해요. 방을 만든 뒤 초대 링크를 공유하세요.` / 참가+초대: `초대받은 방에 참가합니다. 링크가 만료됐다면 방장에게 새 링크를 받아 주세요.` / 참가+초대 없음: `친구 방은 방장이 보낸 초대 링크로 열어 주세요.` | 만들기만         |
| `failed`     | `접속 상태를 확인하지 못했습니다. 로그인과 네트워크 상태를 확인해 주세요.` + `접속 상태 다시 확인` 단추(조회를 다시 한다)                                                                                                        | 불가             |

초대 토큰이 있으면 `access` 값과 무관하게 만들기와 참가 모두 제출할 수 있다.

근거: [ProductApp.tsx:216](../../apps/web/src/app/ProductApp.tsx#L216), [ProductApp.tsx:862](../../apps/web/src/app/ProductApp.tsx#L862), [ProductApp.tsx:868](../../apps/web/src/app/ProductApp.tsx#L868), [ProductApp.tsx:873](../../apps/web/src/app/ProductApp.tsx#L873), [ProductApp.tsx:882](../../apps/web/src/app/ProductApp.tsx#L882)

### 4.4 대기방 여유 표시

스냅샷이 없고, 혼자 연습이 아니고, `homePanel === 'admission'`일 때만 `/api/capacity`를 부른다. `지금 경기 가능 a/b · 대기방 여유 c/d`에서 `a = max(0, matchLimit - matchesInUse)`, `c = max(0, lobbyRoomLimit - lobbyRoomsInUse)`이다.

| 조건(위부터 먼저)                   | 표시                                                                                            | 방 만들기 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | --------- |
| `admissionOpen=false`               | 지금은 점검 중이라 입장을 받지 않습니다. 잠시 뒤 다시 시도해 주세요.                            | 막음      |
| `lobbyRoomsInUse >= lobbyRoomLimit` | `<여유>` · 열 수 있는 방이 모두 사용 중입니다. 방 코드로 참가하거나 잠시 뒤 다시 시도해 주세요. | 막음      |
| `mediaBlocked=true`                 | 이번 달 영상·음성 사용량이 한도에 가까워 새 경기를 시작할 수 없습니다.                          | 허용      |
| `matchesInUse >= matchLimit`        | `<여유>` · 방은 만들 수 있지만 경기를 시작하려면 자리가 날 때까지 기다려야 합니다.              | 허용      |
| 그 밖                               | `<여유>`                                                                                        | 허용      |

참가는 어느 경우에도 막지 않는다.

근거: [ProductApp.tsx:276](../../apps/web/src/app/ProductApp.tsx#L276), [ProductApp.tsx:857](../../apps/web/src/app/ProductApp.tsx#L857), [service-capacity.ts:33](../../apps/web/src/features/room/service-capacity.ts#L33), [service-capacity.ts:42](../../apps/web/src/features/room/service-capacity.ts#L42), [service-capacity.ts:66](../../apps/web/src/features/room/service-capacity.ts#L66)

### 4.5 입장 오류 문구

입장이 실패하면 오류 메시지를 `sessionErrorLabel`로 바꾼다. Room 입장 오류도 같은 경로를 탄다(메시지가 아래 코드와 같을 때만 해당 문구가 나온다).

| 코드                                                        | 문구                                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_REQUEST`                                           | 닉네임·초대 링크·방 코드를 확인해 주세요.                                                                                                            |
| `INVALID_INVITATION`                                        | 유효한 초대 링크가 필요합니다. (`access === 'gitlab-sso'`이고 초대가 없으면: 로그인을 확인할 수 없습니다. 페이지를 새로고침해 다시 로그인해 주세요.) |
| `ROOM_NOT_AVAILABLE`                                        | 입장할 수 없는 방입니다.                                                                                                                             |
| `RATE_LIMITED`                                              | 잠시 기다린 뒤 다시 시도해 주세요.                                                                                                                   |
| `ADMISSION_CLOSED`                                          | 지금은 입장을 받고 있지 않습니다.                                                                                                                    |
| `CAPACITY`                                                  | 지금은 열 수 있는 방이 모두 사용 중입니다. 잠시 뒤 다시 시도해 주세요.                                                                               |
| `ROOM_FULL`                                                 | 이 방은 인원이 모두 찼습니다. 방 코드를 확인하거나 새 방을 만들어 주세요.                                                                            |
| `TOO_MANY_ROOMS`                                            | 이미 열어 둔 방이 있습니다. 쓰지 않는 방을 닫거나 잠시 뒤 다시 시도해 주세요.                                                                        |
| `ALREADY_IN_ROOM`                                           | 다른 창이나 탭에서 이미 방에 참가 중입니다. 그 창을 닫은 뒤 다시 시도해 주세요.                                                                      |
| `INVALID_SESSION`                                           | 입장 시간이 만료됐습니다. 다시 입장해 주세요.                                                                                                        |
| 그 밖(`CONNECTION_FAILED`, `INVALID_RESPONSE`, 모르는 코드) | 연결할 수 없습니다. 로그인과 네트워크 상태를 확인해 주세요.                                                                                          |

근거: [session-error-labels.ts:5](../../apps/web/src/features/room/session-error-labels.ts#L5), [session-error-labels.ts:21](../../apps/web/src/features/room/session-error-labels.ts#L21), [session-error-labels.ts:30](../../apps/web/src/features/room/session-error-labels.ts#L30), [ProductApp.tsx:439](../../apps/web/src/app/ProductApp.tsx#L439)

## 5. Room 연결, 동기화와 끊김

### 5.1 입장과 예약 취소

1. `enter`는 이미 `joining`이거나 Room이 있거나 혼자 연습 중이면 아무것도 하지 않는다. 입장마다 세대 번호를 올린다.
2. 폼 입장은 세션을 발급받고 그 예약을 보관한다. 데모·시연 세션은 받은 즉시(`useEffect`) 입장하고, 앞선 입장 시도가 끝난 뒤에 이어 실행한다. 이 세션은 웹이 발급한 것이 아니므로 예약 취소 대상이 아니다.
3. Room 연결 주소는 `VITE_COLYSEUS_URL`(trim), 없으면 개발 `ws://127.0.0.1:2567`, 배포 `window.location.origin`이다. `joinOrCreate('kkakkung', { token, roomCode, protocolVersion: PRODUCT_PROTOCOL_VERSION })`으로 들어가고 자동 재접속을 끈다.
4. 세대가 바뀐 뒤 도착한 세션·Room은 버린다. 웹이 발급한 예약이면 `DELETE`로 취소한다.
5. 입장 뒤 홈 옵션의 품질·음량·음소거를 이 Room에 한 번 적용한다.
6. 실패하면:
   - 데모 세션은 `sessionStorage`에서 지운다.
   - 시연 세션은 `/showcase`로 이동한다.
   - 웹이 발급한 예약은 취소하고 4.5 문구를 표시한다.
7. `입장 취소`와 머리말 `나가기`는 `leaveByChoice`를 부른다. 데모면 저장된 세션을 지우고, 방을 정리한 뒤 시연이면 `/showcase`로 이동한다.

근거: [ProductApp.tsx:350](../../apps/web/src/app/ProductApp.tsx#L350), [ProductApp.tsx:368](../../apps/web/src/app/ProductApp.tsx#L368), [ProductApp.tsx:390](../../apps/web/src/app/ProductApp.tsx#L390), [ProductApp.tsx:413](../../apps/web/src/app/ProductApp.tsx#L413), [ProductApp.tsx:424](../../apps/web/src/app/ProductApp.tsx#L424), [ProductApp.tsx:279](../../apps/web/src/app/ProductApp.tsx#L279), [product-session.ts:130](../../apps/web/src/features/room/product-session.ts#L130), [product-session.ts:155](../../apps/web/src/features/room/product-session.ts#L155)

### 5.2 페이지 활성과 주기 작업

- 입력 활성은 `visibilityState === 'visible' && document.hasFocus()`이다. `blur`면 즉시 비활성이다.
- `pagehide`면 Room을 정리한다(`leave`). 이때 데모 세션은 지우지 않아 새로고침하면 같은 경기로 돌아온다.
- ProductApp은 100ms마다 런타임 `poll()`을 부르고 서버 시각을 읽는다.

근거: [ProductApp.tsx:320](../../apps/web/src/app/ProductApp.tsx#L320), [ProductApp.tsx:331](../../apps/web/src/app/ProductApp.tsx#L331)

### 5.3 시계, 명령, 개인 이벤트

| 대상        | 규칙                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 시계 동기화 | `clock-probe`를 250ms 간격으로 5번 보내고, 그다음은 10000ms 뒤에 다음 묶음을 보낸다. 2000ms 넘은 대기 probe는 버린다. 왕복 0~1000ms인 응답만 쓴다. 표본 3개 이상이면 왕복이 가장 짧은 3개의 오프셋 중간값을 쓴다. 서버 epoch가 바뀌면 초기화한다. 렌더 tick은 하트비트 앵커의 `serverTick + (서버 시각 - serverTimeMs)/50`이다. |
| 명령 수명   | `command` 메시지로 보낸 뒤 상태는 `pending`이다. `command-result`가 거절이면 `rejected`, `command-outcome`이 applied이고 아직 그 상태판이 안 왔으면 `waiting-view`다. 2000ms마다 `request-status`를 최대 3번 묻고, 그래도 없으면 `unconfirmed` 뒤 `view-resync`를 보낸다.                                                       |
| 개인 이벤트 | `private-event`는 범위(revision·kind·gameInstanceId)와 `stateVersion`이 현재 뷰에 도달할 때까지 최대 1000ms, 최대 64개까지 기다린다. 넘치거나 기한이 지나면 `view-resync`를 보낸다. 중복 제거 기록은 2048개까지다. 개인 종료 뒤에는 받지 않는다.                                                                                |
| 재동기화    | `view-resync`는 1000ms에 한 번까지만 보낸다.                                                                                                                                                                                                                                                                                    |

근거: [clock-sync.ts:15](../../apps/web/src/features/room/clock-sync.ts#L15), [clock-sync.ts:26](../../apps/web/src/features/room/clock-sync.ts#L26), [clock-sync.ts:46](../../apps/web/src/features/room/clock-sync.ts#L46), [clock-sync.ts:63](../../apps/web/src/features/room/clock-sync.ts#L63), [clock-sync.ts:80](../../apps/web/src/features/room/clock-sync.ts#L80), [command-lifecycle.ts:52](../../apps/web/src/features/room/command-lifecycle.ts#L52), [command-lifecycle.ts:81](../../apps/web/src/features/room/command-lifecycle.ts#L81), [command-lifecycle.ts:126](../../apps/web/src/features/room/command-lifecycle.ts#L126), [private-events.ts:41](../../apps/web/src/features/room/private-events.ts#L41), [private-events.ts:51](../../apps/web/src/features/room/private-events.ts#L51), [private-events.ts:95](../../apps/web/src/features/room/private-events.ts#L95), [events.ts:5](../../packages/protocol/src/game-messages/events.ts#L5), [product-runtime.ts:296](../../apps/web/src/app/product-runtime.ts#L296), [product-runtime.ts:1202](../../apps/web/src/app/product-runtime.ts#L1202)

### 5.4 명령 피드백 문구

화면 아래 상태 줄은 `REMATCH` 외의 마지막 요청을 `commandFeedback`으로 표시한다. `pending`·`applied`이거나 `MOVE_INTENT`·`TURN`이면 표시하지 않는다.

| 조건(위부터)                              | 문구                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `waiting-view`                            | 처리가 끝나 갱신된 화면을 기다리고 있습니다.                                                                                   |
| `unconfirmed`                             | 응답을 확인하지 못했습니다. 화면의 현재 상태를 확인한 뒤 다시 시도해 주세요.                                                   |
| `RATE_LIMITED`                            | 요청이 너무 빠릅니다. 잠시 기다린 뒤 다시 시도해 주세요.                                                                       |
| `INVALID_PHASE`, `ROUND_ENDED`            | 경기 단계가 바뀌었습니다. 현재 화면에서 가능한 행동을 선택해 주세요.                                                           |
| `NOT_ACTIVE`                              | 참가가 종료되어 이 행동을 할 수 없습니다.                                                                                      |
| `EXPIRED`, `STALE_REQUEST`                | 요청 시간이 지났습니다. 현재 상태를 확인하고 새로 요청해 주세요.                                                               |
| `canceled`                                | 요청이 취소되었습니다.                                                                                                         |
| `ROOM_MAP_SIZE` 실패                      | 맵 크기를 바꾸지 못했습니다. 방장인지와 대기방 단계인지 확인해 주세요.                                                         |
| `ROOM_LOCK`·`ROOM_KICK` 실패              | 방 관리를 처리하지 못했습니다. 현재 방장과 참가자, 대기 단계를 확인해 주세요.                                                  |
| `EXCHANGE_REQUEST`·`EXCHANGE_ACCEPT` 실패 | 지도를 교환하지 못했습니다. 바로 옆 도망자 아군과 서로 다른 지도 정보가 있어야 하며, 구속·탈출 동작 중에는 교환할 수 없습니다. |
| `INSTALL` 실패                            | 설치하지 못했습니다. 이동을 멈추고 남은 장비와 설치 위치를 확인해 주세요.                                                      |
| `REMATCH` 실패                            | 재경기를 시작하지 못했습니다. 방장과 현재 참가자를 확인한 뒤 다시 시도해 주세요.                                               |
| 그 밖                                     | 지금은 이 행동을 할 수 없습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.                                                     |

근거: [command-feedback.ts:3](../../apps/web/src/features/game/flow/command-feedback.ts#L3), [command-feedback.ts:8](../../apps/web/src/features/game/flow/command-feedback.ts#L8), [ProductApp.tsx:1280](../../apps/web/src/app/ProductApp.tsx#L1280)

### 5.5 연결 끊김

아래 경우 스냅샷을 `lost`로 바꾸고, 시계와 하트비트를 멈추고, 참가를 정리한다. 음량 설정은 기본값으로 되돌린다.

- Room의 `onLeave`·`onDrop`·`onError`
- 같은 경기의 새 하트비트가 `HEARTBEAT_TIMEOUT_MS = 6000`ms 동안 오지 않음

하트비트는 matchId가 같고, epoch가 처음 본 값과 같고, `heartbeatSeq`가 늘어난 것만 받는다. 받은 하트비트마다 `game-heartbeat-ack`를 보낸다. 닫힘 코드로 끊김 종류를 가른다.

| 코드                       | 스냅샷 표식      | 제목                           | 본문                                                                                                                                     |
| -------------------------- | ---------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `4003`                     | `showcaseClosed` | 시연이 종료되었습니다          | 방장이 시연 방을 나가 방을 닫았습니다. 잠시 뒤 시연 입장 화면으로 돌아갑니다. (2500ms 뒤 자동으로 `/showcase`)                           |
| `4002`                     | `removedByHost`  | 방장이 대기방에서 내보냈습니다 | 이 방의 참가가 종료됐습니다. 입장 화면으로 돌아가 새 방을 만들거나 친구에게 다시 초대를 요청해 주세요.                                   |
| `4001`                     | `roomExpired`    | 방의 대기 시간이 끝났습니다    | 사용하지 않는 방을 정리했습니다. + (시연) 시연 입장 화면에서 다시 들어와 주세요. / (그 밖) 입장 화면에서 새 방을 만들거나 참가해 주세요. |
| 그 밖, 시연 세션           | —                | 게임 연결이 끊겼습니다         | 진행 중인 경기는 복원할 수 없습니다. 시연 입장 화면에서 다시 들어와 주세요.                                                              |
| 그 밖, 다시 참가 코드 있음 | —                | 게임 연결이 끊겼습니다         | 진행 중인 경기는 복원할 수 없습니다. 방장이 로비로 돌아가면 방 코드 `<코드>`로 다시 참가할 수 있습니다.                                  |
| 그 밖                      | —                | 게임 연결이 끊겼습니다         | 진행 중인 경기는 복원할 수 없습니다. 입장 화면에서 다시 참가해 주세요.                                                                   |

다시 참가 코드는 만료·내보냄이 아니고, 시연·데모 세션이 아니고, 방 코드가 있을 때만 준다. 단추(`입장 화면으로`/시연은 `시연 입장 화면으로`)를 누르면 이 코드로 참가 폼을 채운 뒤 `leaveByChoice`를 부른다.

근거: [product-session.ts:166](../../apps/web/src/features/room/product-session.ts#L166), [product-runtime.ts:434](../../apps/web/src/app/product-runtime.ts#L434), [product-runtime.ts:448](../../apps/web/src/app/product-runtime.ts#L448), [game-heartbeat.ts:30](../../apps/web/src/features/room/game-heartbeat.ts#L30), [game-heartbeat.ts:44](../../apps/web/src/features/room/game-heartbeat.ts#L44), [heartbeat.ts:8](../../packages/protocol/src/game-messages/heartbeat.ts#L8), [room.ts:29](../../packages/protocol/src/game-messages/room.ts#L29), [room.ts:31](../../packages/protocol/src/game-messages/room.ts#L31), [room.ts:36](../../packages/protocol/src/game-messages/room.ts#L36), [ConnectionLostScreen.tsx:27](../../apps/web/src/features/game/flow/ConnectionLostScreen.tsx#L27), [ConnectionLostScreen.tsx:36](../../apps/web/src/features/game/flow/ConnectionLostScreen.tsx#L36), [ProductApp.tsx:288](../../apps/web/src/app/ProductApp.tsx#L288), [ProductApp.tsx:298](../../apps/web/src/app/ProductApp.tsx#L298), [ProductApp.tsx:931](../../apps/web/src/app/ProductApp.tsx#L931)

### 5.6 재경기와 단계 전환

- 새 `matchId`가 오면 재경기로 본다. 얼굴 텍스처, 개인 뷰, 명부, 방 접근, 맵, 종료 상태, 장치 상태, 미디어, 요청을 비운다. 이전 미디어 세대를 회수한 뒤 새 입력·미디어 연결을 만든다.
- 단계만 바뀌면 연습 준비 보고, 도전 진행, 요청 기록, 오류 문구를 비운다.
- 같은 경기의 더 낮은 `stateVersion`은 버린다.

근거: [product-runtime.ts:1113](../../apps/web/src/app/product-runtime.ts#L1113), [product-runtime.ts:1121](../../apps/web/src/app/product-runtime.ts#L1121), [product-runtime.ts:1166](../../apps/web/src/app/product-runtime.ts#L1166)

## 6. 제품 화면 선택

`round`는 공개 상태, `view`는 개인 뷰다. 판정 값은 다음과 같다.

- `activeSelf`: `view.self.status === 'ACTIVE'`일 때의 본인
- `spectating`: `PLAYING`에서만 쓰는 관전 대상
- `ended`: `endedSelf` 또는 활동 중이 아닌 본인
- `inResult`: `(!spectating && ended)` 또는 단계가 `RESULT`·`ABORTED`
- `worldVisible`: 결과가 아니고, 단계가 `PLAYING`·`TEAM_PRACTICE`이고, `activeSelf`나 `spectating`이 있음
- `interactiveWorld`: `worldVisible && activeSelf`

| 상태                                                            | 화면                                     |
| --------------------------------------------------------------- | ---------------------------------------- |
| 스냅샷 없음, `solo`                                             | 혼자 연습(14절).                         |
| 스냅샷 없음, `homePanel`이 `title`·`options`                    | 제목 메뉴와 옵션 창.                     |
| 스냅샷 없음, `admission`                                        | 입장 창(4절).                            |
| `snapshot.lost`                                                 | 연결 끊김 화면(5.5).                     |
| 명부 있음, `LOBBY`·`DEVICE_CHECK`                               | 대기실(7절). 준비를 누르면 점검 창(8절). |
| `MAP_FINALIZING`·`GAME_LOADING`·`COUNTDOWN`(결과가 아닐 때)     | 전면 로딩(9.2).                          |
| `TEAM_PRACTICE` + `activeSelf`                                  | 세계 화면과 연습 과제(9.1, 10절).        |
| `PLAYING` + `activeSelf`                                        | 세계 화면과 HUD(10절).                   |
| `PLAYING` + 개인 종료 + 관전 대상 있음                          | 관전 대상 시점의 세계 화면과 관전 막대.  |
| `PLAYING` + 개인 종료 + 관전 대상 없음, 또는 `RESULT`·`ABORTED` | 결과 화면(11절).                         |

- 세계 화면이 아닐 때는 머리말에 로고가 있다. 방 안이면서 대기실이 아닐 때는 `설정`과 `나가기` 단추도 있다.
- 방 안에서는 준비 실패 안내(9.3)가 alert로 나온다. 로딩 화면이 덮는 동안은 로딩 화면 안에서 보여 준다.
- `roomExpiresInSeconds`가 있으면 `이 방은 N초 후 정리됩니다. 준비를 마치거나 새 경기를 시작해 주세요.`를 표시한다.
- 전면 플래시(`CueFlash`)와 명령 피드백 줄은 방 안 어디서나 그린다.

근거: [ProductApp.tsx:450](../../apps/web/src/app/ProductApp.tsx#L450), [ProductApp.tsx:455](../../apps/web/src/app/ProductApp.tsx#L455), [ProductApp.tsx:457](../../apps/web/src/app/ProductApp.tsx#L457), [ProductApp.tsx:616](../../apps/web/src/app/ProductApp.tsx#L616), [ProductApp.tsx:673](../../apps/web/src/app/ProductApp.tsx#L673), [ProductApp.tsx:688](../../apps/web/src/app/ProductApp.tsx#L688), [ProductApp.tsx:929](../../apps/web/src/app/ProductApp.tsx#L929), [ProductApp.tsx:947](../../apps/web/src/app/ProductApp.tsx#L947), [ProductApp.tsx:952](../../apps/web/src/app/ProductApp.tsx#L952), [ProductApp.tsx:959](../../apps/web/src/app/ProductApp.tsx#L959), [ProductApp.tsx:1024](../../apps/web/src/app/ProductApp.tsx#L1024), [ProductApp.tsx:1044](../../apps/web/src/app/ProductApp.tsx#L1044), [ProductApp.tsx:1047](../../apps/web/src/app/ProductApp.tsx#L1047), [ProductApp.tsx:1278](../../apps/web/src/app/ProductApp.tsx#L1278)

## 7. 대기실

### 7.1 자리와 표시

| 요소          | 규칙                                                                                                                                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 제목          | 시연 방은 `시연 참가자를 기다리는 중`, 그 밖은 `친구들을 기다리는 중입니다.`                                                                                                                                                                                                 |
| 자리 수       | `roster.capacity`. 없으면 `6`.                                                                                                                                                                                                                                               |
| 인원 줄       | `<참가자 수>/<자리> \| 준비 <준비 수>/<자리>`                                                                                                                                                                                                                                |
| 방 코드       | 복사 단추. 성공하면 1600ms 동안 복사 표시.                                                                                                                                                                                                                                   |
| 자리 상태     | 빈 자리 `빈 자리`, 끊김 `연결 끊김`, 준비 `준비 완료` 도장, 그 밖 `준비 전`. 방장은 `♛`와 `방장`, 본인은 `나`. 본인이 방장이면 `방장`만 보인다(방장이 우선).                                                                                                                 |
| 초대 칸       | 첫 빈 자리이고, 본인이 방장이고, 초대 영역이 주어졌을 때만 `+ 참가자 초대`. 초대 영역은 세션 토큰이 있고, 데모 방이 아니고, 방장이고, 시연 방이 아닐 때만 만든다.                                                                                                            |
| 준비 단추     | `준비하기`/`준비 취소`. `DEVICE_CHECK`에서만, 입장·준비 처리 중이 아닐 때 누를 수 있다. `LOBBY`에서는 `자리가 다 차면 준비를 누를 수 있어요. 그때 카메라가 켜집니다.`                                                                                                        |
| 시작 단추     | 모든 자리가 찼고, 모두 연결·준비됐고, 본인이 방장일 때만 `게임 시작`(`ROOM_START`). 요청 중에는 `시작하는 중…`.                                                                                                                                                              |
| 안내 줄       | 모두 준비: (방장) `여섯 명이 모두 준비했어요. 시작을 누르면 팀 연습으로 넘어갑니다.` / (그 밖) `…방장이 시작하기를 기다리는 중입니다.` / 본인 준비: `준비 완료. 여섯 명이 모두 준비하면 방장이 시작합니다.` / 그 밖: 준비 안내                                               |
| 방 소식       | 들어온 뒤의 명부 변화(입장·끊김·복귀·준비·나감)를 `[HH:MM]`과 함께 최근 6줄 표시.                                                                                                                                                                                            |
| 내 장치 상태  | 준비했고 장치 줄이 있을 때 `웹캠`·`얼굴 추적`·`중립 자세 보정`·`마이크`를 표시. 상태 문구는 `idle` 꺼짐, `off` 사용 안 함, `ready` 준비됨, `locked` 권한 필요, `denied` 허용 안 됨, `failed` 다시 점검, `requesting` 권한 확인 중, `loading` 불러오는 중, `running` 보정 중. |
| 개인정보 안내 | 맵 칸 안의 접힘 상자에 `PRIVACY_NOTICE` 문장.                                                                                                                                                                                                                                |

근거: [LobbyScreen.tsx:17](../../apps/web/src/features/room/LobbyScreen.tsx#L17), [LobbyScreen.tsx:27](../../apps/web/src/features/room/LobbyScreen.tsx#L27), [LobbyScreen.tsx:141](../../apps/web/src/features/room/LobbyScreen.tsx#L141), [LobbyScreen.tsx:146](../../apps/web/src/features/room/LobbyScreen.tsx#L146), [LobbyScreen.tsx:157](../../apps/web/src/features/room/LobbyScreen.tsx#L157), [LobbyScreen.tsx:167](../../apps/web/src/features/room/LobbyScreen.tsx#L167), [LobbyScreen.tsx:193](../../apps/web/src/features/room/LobbyScreen.tsx#L193), [LobbyScreen.tsx:207](../../apps/web/src/features/room/LobbyScreen.tsx#L207), [LobbyScreen.tsx:231](../../apps/web/src/features/room/LobbyScreen.tsx#L231), [LobbyScreen.tsx:255](../../apps/web/src/features/room/LobbyScreen.tsx#L255), [LobbyScreen.tsx:265](../../apps/web/src/features/room/LobbyScreen.tsx#L265), [LobbyScreen.tsx:299](../../apps/web/src/features/room/LobbyScreen.tsx#L299), [LobbyScreen.tsx:306](../../apps/web/src/features/room/LobbyScreen.tsx#L306), [ProductApp.tsx:494](../../apps/web/src/app/ProductApp.tsx#L494), [ProductApp.tsx:994](../../apps/web/src/app/ProductApp.tsx#L994), [ProductApp.tsx:1008](../../apps/web/src/app/ProductApp.tsx#L1008)

### 7.2 대기실 얼굴

- 본인 자리의 얼굴은 런타임의 `processedFaceSurface()` 캔버스로 만든 `CanvasTexture`(sRGB)다. 캔버스가 바뀔 때만 새로 만들고 이전 것은 dispose한다.
- 남의 얼굴은 `runtime.faces.get(playerId)`(원격 얼굴 텍스처)다.
- 본인 자리에는 1px 펌프 자리가 있어, 점검 창을 닫은 뒤에도 미리보기 video가 문서에 붙어 재생된다.
- `PlayerTileView`는 얼굴 텍스처가 없으면 Canvas 없이 SVG 자리표시(원 `#a4a59e`, 눈·입 `#252622`)를 그린다.
- 얼굴이 있으면 Canvas를 연다. 설정은 `dpr 1`, `antialias true`, `powerPreference low-power`, 카메라 `[0, 0.72, -1.05]`·`fov 30`·near/far `0.05/10`·`lookAtY 0.72`이다. 역할 없는 `Avatar`(중립 회색, `ally` 배지)에 그 텍스처를 `standIn`으로 붙인다.
- 텍스처는 80ms마다 `needsUpdate`로 올린다. 처음에는 120ms 간격으로 8번 더 다시 그린다.

근거: [ProductApp.tsx:166](../../apps/web/src/app/ProductApp.tsx#L166), [ProductApp.tsx:247](../../apps/web/src/app/ProductApp.tsx#L247), [LobbyScreen.tsx:317](../../apps/web/src/features/room/LobbyScreen.tsx#L317), [PlayerTileView.tsx:14](../../apps/web/src/features/room/PlayerTileView.tsx#L14), [PlayerTileView.tsx:24](../../apps/web/src/features/room/PlayerTileView.tsx#L24), [PlayerTileView.tsx:36](../../apps/web/src/features/room/PlayerTileView.tsx#L36), [PlayerTileView.tsx:65](../../apps/web/src/features/room/PlayerTileView.tsx#L65), [PlayerTileView.tsx:77](../../apps/web/src/features/room/PlayerTileView.tsx#L77), [PlayerTileView.tsx:91](../../apps/web/src/features/room/PlayerTileView.tsx#L91)

### 7.3 방 관리와 맵 크기

**입장 잠금과 내보내기**

- 방장만 `입장 잠그기`/`입장 잠금 해제`(`ROOM_LOCK`)와 연결된 다른 참가자의 `<이름> 내보내기`(`ROOM_KICK`)를 쓴다.
- 내보내기는 확인 창(`<이름>님을 내보내면 새 참가자 입장도 잠깁니다. …`)을 거친다.
- 방 관리 요청 중이거나 이 경기의 접근 상태를 아직 모르면 단추를 잠근다.
- 데모 방에는 잠금과 내보내기 단추가 없다.

**맵 크기**

- 선택지는 `small`(표기 `16x16`, 격자 15), `medium`(`24x24`, 23), `large`(`32x32`, 31)이다. 기본은 `large`다.
- 방장이 `LOBBY`·`DEVICE_CHECK`에서 고르면 `ROOM_MAP_SIZE`를 보낸다.
- 시연 방은 `small`로 고정되고 `시연 맵은 16x16으로 고정되어 있습니다.`를 표시한다.
- 데모 방에는 `준비 완료를 누르기 전까지 고를 수 있습니다. 시연은 인형이 덜 걷는 15×15 가 빠릅니다.` 안내가 붙는다.

근거: [LobbyScreen.tsx:247](../../apps/web/src/features/room/LobbyScreen.tsx#L247), [LobbyScreen.tsx:280](../../apps/web/src/features/room/LobbyScreen.tsx#L280), [LobbyScreen.tsx:344](../../apps/web/src/features/room/LobbyScreen.tsx#L344), [LobbyScreen.tsx:386](../../apps/web/src/features/room/LobbyScreen.tsx#L386), [map-size.ts:23](../../apps/web/src/features/room/map-size.ts#L23), [map-size.ts:35](../../apps/web/src/features/room/map-size.ts#L35), [ProductApp.tsx:969](../../apps/web/src/app/ProductApp.tsx#L969), [ProductApp.tsx:977](../../apps/web/src/app/ProductApp.tsx#L977)

### 7.4 초대 링크

- 방장의 `초대 링크 만들기`/`초대 링크 재발급`은 `POST`(`201` 기대), `기존 초대 링크 회수`는 `DELETE`(`204` 기대)를 보낸다. 둘 다 Bearer 세션 토큰을 쓴다.
- 링크는 `<origin>/#invite=<token>&room=<code>`다. 만료 전까지 `약 N분 동안 사용할 수 있습니다.`(분 올림, 최소 1)를 표시하고 복사할 수 있다.
- 만료되면 `초대 링크가 만료됐습니다. 새 링크를 만들어 주세요.`를 표시한다.
- `gitlab-sso` 접속이면 `팀원 로그인은 계속 필요합니다. 방 코드를 아는 팀원의 입장까지 막으려면 입장을 잠가 주세요.`를 덧붙인다.

| 오류                     | 문구                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `INVALID_SESSION`        | 접속이 만료됐습니다. 방에 다시 참가해 주세요.                                              |
| `INVITATION_UNAVAILABLE` | 대기 중인 방장만 초대를 관리할 수 있습니다. 방 상태를 확인해 주세요.                       |
| `RATE_LIMITED`           | 잠시 후 다시 시도해 주세요.                                                                |
| `ADMISSION_CLOSED`       | 현재 새 참가자를 받을 수 없습니다. 잠시 후 다시 시도해 주세요.                             |
| 그 밖                    | 처리 결과를 확인하지 못했습니다. 다시 시도해 새 링크를 만들거나 기존 링크를 회수해 주세요. |

근거: [RoomInvitationControls.tsx:38](../../apps/web/src/features/room/RoomInvitationControls.tsx#L38), [RoomInvitationControls.tsx:52](../../apps/web/src/features/room/RoomInvitationControls.tsx#L52), [RoomInvitationControls.tsx:78](../../apps/web/src/features/room/RoomInvitationControls.tsx#L78), [RoomInvitationControls.tsx:125](../../apps/web/src/features/room/RoomInvitationControls.tsx#L125), [RoomInvitationControls.tsx:133](../../apps/web/src/features/room/RoomInvitationControls.tsx#L133)

## 8. 동의와 장치 점검(제품)

### 8.1 동의 게이트

- 카메라를 켜는 경로(대기실 준비, 우상단 카메라 단추)는 동의가 없으면 `카메라 사용 동의` 대화상자를 연다.
- `ConsentGate`는 `위 내용을 읽고 동의합니다.`와 `만 14세 이상입니다.`를 모두 체크해야 `동의합니다`를 누를 수 있다. `동의하지 않기`는 창만 닫는다.
- 동의하면 `kkakkung.media-consent`에 `{ version, atMs, ageConfirmed: true }`를 저장하고, 페이지 메모리에도 동의를 기록한다.
- 이어서 `DEVICE_CHECK`이면 준비 흐름을, 그 밖이면 카메라 시작만 한다.
- 저장된 동의는 `version`이 `PRIVACY_NOTICE_VERSION = '2026-09-20'`과 같고 `ageConfirmed === true`일 때만 유효하다.

근거: [ConsentGate.tsx:20](../../apps/web/src/features/room/ConsentGate.tsx#L20), [ConsentGate.tsx:41](../../apps/web/src/features/room/ConsentGate.tsx#L41), [use-media-consent.ts:27](../../apps/web/src/features/room/use-media-consent.ts#L27), [consent.ts:28](../../apps/web/src/features/room/consent.ts#L28), [consent.ts:48](../../apps/web/src/features/room/consent.ts#L48), [consent.ts:107](../../apps/web/src/features/room/consent.ts#L107), [privacy-notice.ts:11](../../apps/web/src/features/room/privacy-notice.ts#L11), [ProductApp.tsx:1404](../../apps/web/src/app/ProductApp.tsx#L1404), [ProductApp.tsx:1413](../../apps/web/src/app/ProductApp.tsx#L1413)

### 8.2 준비 흐름(`ReadyCheck`)

1. 대기실 `준비하기` → 동의가 없으면 8.1로 간다.
2. 이미 장치가 모두 준비됐고 앞 기울이기·고개 돌리기를 봤으면 창 없이 `READY true`를 다시 보낸다.
3. 그 밖이면 점검 창(`deviceCheck`)을 열고 `startDevices(false)`로 카메라를 켠다(마이크 없이). 실패하면 `카메라를 켜지 못했습니다. 권한을 확인하고 다시 눌러 주세요.`를 표시한다.
4. 창이 열린 채 camera·vision이 `ready`이고 calibration이 `idle`이면 중립 자세 보정을 자동으로 한 번 시작한다.
5. 창에는 카메라 미리보기와 안내 한 줄을 띄운다. 안내는 `카메라를 켜는 중…` → `얼굴 추적을 준비하는 중…` → `정면을 보고 가만히 계세요` → `몸을 앞으로 기울여 보세요` → `고개를 왼쪽으로 돌려 보세요` → `확인 완료` 순이다. 그 아래 `앞으로 기울이기`·`고개 돌리기` 체크 목록이 있다.
6. 기울이기는 보정 뒤 `leanRelative >= forwardEnter`, 회전은 `|yawRelative| >= turnEnter`를 한 번 보면 기록한다. 다시 보정하면 기록을 비운다.
7. 두 확인이 끝나면 `READY true`를 시도한다. 소리 재생이 잠겨 거절되면 확인음을 재생한 뒤 한 번 더 시도한다.
8. 명부에서 본인이 준비 상태가 되면 창이 닫힌다.
9. camera나 vision이 `failed`면 장치 오류 문구(없으면 `카메라를 켜지 못했습니다.`)와 `다시 시도`를 표시한다. `나중에 하기`는 창을 닫는다.
10. 데모 방이고 아직 준비하지 않았으면 `점검 없이 준비 (데모)` 단추가 보인다.

`READY true`는 `DEVICE_CHECK`에서 camera·vision·calibration·audioPlayback이 모두 `ready`일 때만 보낸다(데모 방은 면제). 준비를 보고한 뒤 이 조건이 깨지면 `READY false`를 자동으로 보낸다.

근거: [ProductApp.tsx:133](../../apps/web/src/app/ProductApp.tsx#L133), [ProductApp.tsx:529](../../apps/web/src/app/ProductApp.tsx#L529), [ProductApp.tsx:535](../../apps/web/src/app/ProductApp.tsx#L535), [ProductApp.tsx:550](../../apps/web/src/app/ProductApp.tsx#L550), [ProductApp.tsx:554](../../apps/web/src/app/ProductApp.tsx#L554), [ProductApp.tsx:565](../../apps/web/src/app/ProductApp.tsx#L565), [ProductApp.tsx:1374](../../apps/web/src/app/ProductApp.tsx#L1374), [ProductApp.tsx:1390](../../apps/web/src/app/ProductApp.tsx#L1390), [ReadyCheck.tsx:10](../../apps/web/src/features/room/ReadyCheck.tsx#L10), [ReadyCheck.tsx:34](../../apps/web/src/features/room/ReadyCheck.tsx#L34), [ReadyCheck.tsx:58](../../apps/web/src/features/room/ReadyCheck.tsx#L58), [ReadyCheck.tsx:75](../../apps/web/src/features/room/ReadyCheck.tsx#L75), [motion-check.ts:18](../../apps/web/src/features/game/flow/motion-check.ts#L18), [device-readiness.ts:2](../../apps/web/src/features/game/flow/device-readiness.ts#L2), [interaction-bridge.ts:72](../../apps/web/src/app/interaction-bridge.ts#L72), [interaction-bridge.ts:145](../../apps/web/src/app/interaction-bridge.ts#L145), [product-runtime.ts:676](../../apps/web/src/app/product-runtime.ts#L676)

### 8.3 경기 중 장치 제어

- 로비가 아닌 방 화면의 HUD 서랍과 설정 창에는 `LocalControls`가 있다.
  - 전체 변형: `키보드로 조작`, `보정 후 모션으로 조작`, `장치 다시 연결·점검`, `마이크 끄기`/`마이크 연결·재시도`. 카메라·마이크 단추는 동의 뒤에만 그린다.
  - `DEVICE_CHECK`·`TEAM_PRACTICE`·`PLAYING`에서만 복구 단추를 누를 수 있다.
  - 팀 연습의 `quiet` 변형: 미리보기와 복구 배너만 둔다. 배너는 camera나 vision이 `ready`가 아니거나 보정이 실패하면 나오고, 문구는 `카메라 추적이 끊겼습니다. 연습과 경기는 키보드로 계속할 수 있습니다.`다.
  - 경기(`full`)에는 이 배너가 없다. 대신 카메라가 준비되지 않았다는 안내나 보정 안내 문장이 나온다.
- 우상단 캐릭터 창 아래 단추는 순서대로 바뀐다.
  1. `카메라 연결`/`카메라 다시 연결`
  2. `카메라 연결 중`(비활성)
  3. `중립 자세 보정`/`중립 자세 다시 보정`
  4. `중립 자세 보정 중`(비활성)
- `TEAM_PRACTICE`에서 연습 준비를 보고한 뒤 장치 조건이 깨지면 `PRACTICE_READY false`를 자동으로 보낸다.

근거: [ProductApp.tsx:623](../../apps/web/src/app/ProductApp.tsx#L623), [ProductApp.tsx:641](../../apps/web/src/app/ProductApp.tsx#L641), [LocalControls.tsx:50](../../apps/web/src/features/game/flow/LocalControls.tsx#L50), [LocalControls.tsx:56](../../apps/web/src/features/game/flow/LocalControls.tsx#L56), [LocalControls.tsx:87](../../apps/web/src/features/game/flow/LocalControls.tsx#L87), [LocalControls.tsx:127](../../apps/web/src/features/game/flow/LocalControls.tsx#L127), [device-readiness.ts:11](../../apps/web/src/features/game/flow/device-readiness.ts#L11), [camera-action.ts:19](../../apps/web/src/features/game/flow/camera-action.ts#L19), [product-runtime.ts:592](../../apps/web/src/app/product-runtime.ts#L592)

## 9. 팀 연습, 로딩, 준비 실패

### 9.1 팀 연습 과제

- 무대 왼쪽 `PracticeQuests`의 과제는 `한 칸 전진`(W), `한 칸 후진`(S), `왼쪽 90° 회전`(A), `오른쪽 90° 회전`(D), `중립으로 멈추기`(키 놓기)이다. 여기에 역할 과제 `도망자 · 탈출 도전`(E) 또는 `술래 · 장비 설치`(F)가 붙는다.
- 완료 판정은 개인 뷰의 변화만 본다.
  - 앞뒤: 바라보던 방향으로 한 칸 이동
  - 좌우: 방향이 한 칸 회전
  - 중립: 이동을 해 본 뒤 행동이 없는 순간
  - 도망자: 도전을 연 순간
  - 술래: 설치를 시작하거나 설치물이 있는 순간
- `연습 준비 완료`(`PRACTICE_READY true`)는 장치가 준비됐을 때만 누를 수 있다. 문구는 다음과 같다.
  - 장치 미준비: `장치 준비가 필요해요. 시간이 지나도 준비를 대신 누르지 않습니다.`
  - 모두 완료: `다 해 봤어요. 전원이 준비하거나 60초가 지나면 경기로 넘어갑니다.`
  - 그 밖: `전원 준비 또는 최대 60초 뒤에 다음 단계로 넘어갑니다.`
- 연습 단계를 벗어나면 기록을 비운다.

근거: [PracticeQuests.tsx:7](../../apps/web/src/features/game/flow/PracticeQuests.tsx#L7), [PracticeQuests.tsx:59](../../apps/web/src/features/game/flow/PracticeQuests.tsx#L59), [PracticeQuests.tsx:63](../../apps/web/src/features/game/flow/PracticeQuests.tsx#L63), [practice-lessons.ts:44](../../apps/web/src/features/game/flow/practice-lessons.ts#L44), [solo-world.ts:15](../../apps/web/src/features/game/solo/solo-world.ts#L15), [ProductApp.tsx:597](../../apps/web/src/app/ProductApp.tsx#L597), [ProductApp.tsx:1117](../../apps/web/src/app/ProductApp.tsx#L1117)

### 9.2 로딩 화면

`경기를 준비하고 있어요`에 세 단계 `미로 준비`(`MAP_FINALIZING`), `화면·연결 확인`(`GAME_LOADING`), `시작`(`COUNTDOWN`)을 표시한다. 지난 단계는 ✓, 현재 단계는 진행 중이다.

- `COUNTDOWN`: 남은 초를 숫자로, 0이면 `시작 확인 중`을 보여 준다.
- `GAME_LOADING`: 내 미완료 준비 항목이 있으면 `내 준비 대기: …`, 없으면 `모든 참가자의 화면과 연결을 확인하고 있습니다.`
- `MAP_FINALIZING`: `미로를 만들고 모두에게 같은 지도를 나눠 주는 중입니다.`
- 준비 실패 사유가 있으면 그 문구를, 없으면 `준비가 끝나면 자동으로 시작합니다.`를 표시한다.

근거: [LoadingOverlay.tsx:24](../../apps/web/src/features/game/flow/LoadingOverlay.tsx#L24), [LoadingOverlay.tsx:37](../../apps/web/src/features/game/flow/LoadingOverlay.tsx#L37), [LoadingOverlay.tsx:48](../../apps/web/src/features/game/flow/LoadingOverlay.tsx#L48), [loading-progress.ts:18](../../apps/web/src/features/game/flow/loading-progress.ts#L18), [loading-progress.ts:27](../../apps/web/src/features/game/flow/loading-progress.ts#L27), [loading-progress.ts:65](../../apps/web/src/features/game/flow/loading-progress.ts#L65)

### 9.3 준비 실패 사유(`preparationIssue`)

| 사유                      | 문구                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SERVICE_NOT_READY`       | 서버가 아직 경기를 시작할 수 없습니다. 잠시 후 다시 준비해 주세요.                                                               |
| `LAYOUT_UNAVAILABLE`      | 경기장을 준비하지 못했습니다. 모두 다시 준비를 눌러 재시도해 주세요.                                                             |
| `DEVICE_LOADING_TIMEOUT`  | 제한 시간 안에 모든 참가자의 화면·카메라 연결을 준비하지 못했습니다. 장치와 네트워크를 확인한 뒤 다시 준비해 주세요.             |
| `MEDIA_NOT_READY`         | 연습 중 카메라·음성 연결을 준비하지 못했습니다. 장치 연결을 확인한 뒤 다시 준비해 주세요.                                        |
| `PREPARATION_UNAVAILABLE` | 경기 준비에 실패했습니다. 잠시 후 다시 준비해 주세요. 반복되면 방을 다시 만들어 주세요.                                          |
| `MEDIA_BUDGET_EXHAUSTED`  | 이번 달 영상·음성 사용량이 한도에 가까워 새 경기를 시작할 수 없습니다. 진행 중인 경기는 영향이 없습니다. 운영자에게 알려 주세요. |
| `MATCH_CAPACITY_FULL`     | 지금은 동시에 진행할 수 있는 경기가 모두 사용 중입니다. 방은 그대로 유지되니 자리가 나면 여기서 알려 드립니다.                   |
| `MATCH_SLOT_AVAILABLE`    | 경기 자리가 났습니다. 방장이 지금 시작하면 바로 들어갑니다.                                                                      |

근거: [preparation-feedback.ts:3](../../apps/web/src/features/game/flow/preparation-feedback.ts#L3), [preparation-feedback.ts:21](../../apps/web/src/features/game/flow/preparation-feedback.ts#L21)

## 10. 경기 화면

### 10.1 배치

| 영역             | 조건                                    | 내용                                                                                                                                                                                 |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 전면 3D          | `worldVisible`                          | `WorldCanvas`(15절). 구속 중(`restraintSeconds > 0`)이면 무대에 `data-restrained`를 붙인다.                                                                                          |
| 맨 위 시계       | 항상                                    | `remainingSeconds = ceil((deadlineTick - serverTick)/20)`를 `mm:ss`로 표시하고, 30초 이하면 low다. `deadlineTick === null`(데모 라운드)이면 마운트 뒤 지난 시간을 `hh:mm:ss`로 센다. |
| 시점 캡션        | 시연 방만                               | 활동 중이면 `도망자 · 내 이름`/`술래 · 내 이름`, 관전 중이면 `관전 · 대상 이름`. 일반 방은 그리지 않는다.                                                                            |
| 화면 테두리      | 항상                                    | 술래는 `TaggerVeins`, 그 밖(도망자·관전)은 `REC`와 녹화 시간이 있는 캠코더 테두리.                                                                                                   |
| 접근성 상태      | 항상                                    | `GameHud`(역할, `조작 연습`/시간/`데모 진행`, 승리 조건, `탈출 n/2`·`포획 n/2`, 구속·면역 초, 조작 방식·행동 상태)와 활동 중일 때의 사건 기록. 화면에는 접근성 레이어로만 둔다.      |
| 우상단 캐릭터 창 | `activeSelf`이고 설정 창이 닫혀 있음    | `SelfCorner`(15.5)와 카메라/보정 단추.                                                                                                                                               |
| 왼쪽 연습 과제   | `TEAM_PRACTICE` + `activeSelf`          | 9.1.                                                                                                                                                                                 |
| 얼굴 안내        | `interactiveWorld`                      | 런타임의 얼굴 조건 안내 문구를 그대로 표시([media.md](media.md)).                                                                                                                    |
| 십자선           | `interactiveWorld`                      | 술래는 설치 가능하면 `ready`, 막혔으면 `blocked`. 도망자는 `none`.                                                                                                                   |
| 상호작용 줄      | `interactiveWorld`이고 해당 행동이 있음 | `E 지도 교환 수락` → `E 탈출 도전` → `E 지도 교환 요청` 순으로 하나. 도전 중이면 없다.                                                                                               |
| 아래 가운데 핫바 | `interactiveWorld`                      | 10.2.                                                                                                                                                                                |
| 관전 막대        | `spectating`                            | 10.5.                                                                                                                                                                                |
| 우하단 미니맵    | `worldVisible`                          | 10.6.                                                                                                                                                                                |
| 접히는 서랍      | `interactiveWorld`                      | `교환 · 도전 · 장치 · 소리`. 도전 중이거나 들어온 교환이 있으면 펼친 채 시작한다. 연습 화면, 도전 패널, 자세 미리보기, 교환 패널, 교환 안내, 장비 HUD, 장치·소리 제어가 들어 있다.   |
| 데모 패널        | 데모 방                                 | 무대 옆 열. 서버에 `demo-scenario`(선택지 역할·거리·위치·방향·설치자)와 `demo-control`(`abort-round`·`cancel-scenario`)을 보낸다.                                                    |

근거: [ProductApp.tsx:619](../../apps/web/src/app/ProductApp.tsx#L619), [ProductApp.tsx:1050](../../apps/web/src/app/ProductApp.tsx#L1050), [ProductApp.tsx:1070](../../apps/web/src/app/ProductApp.tsx#L1070), [ProductApp.tsx:1080](../../apps/web/src/app/ProductApp.tsx#L1080), [ProductApp.tsx:1102](../../apps/web/src/app/ProductApp.tsx#L1102), [ProductApp.tsx:1129](../../apps/web/src/app/ProductApp.tsx#L1129), [ProductApp.tsx:1131](../../apps/web/src/app/ProductApp.tsx#L1131), [ProductApp.tsx:1139](../../apps/web/src/app/ProductApp.tsx#L1139), [ProductApp.tsx:1157](../../apps/web/src/app/ProductApp.tsx#L1157), [ProductApp.tsx:1167](../../apps/web/src/app/ProductApp.tsx#L1167), [ProductApp.tsx:1178](../../apps/web/src/app/ProductApp.tsx#L1178), [ProductApp.tsx:1264](../../apps/web/src/app/ProductApp.tsx#L1264), [CamcorderOverlay.tsx:62](../../apps/web/src/features/game/flow/CamcorderOverlay.tsx#L62), [CamcorderOverlay.tsx:73](../../apps/web/src/features/game/flow/CamcorderOverlay.tsx#L73), [CamcorderOverlay.tsx:99](../../apps/web/src/features/game/flow/CamcorderOverlay.tsx#L99), [CamcorderOverlay.tsx:140](../../apps/web/src/features/game/flow/CamcorderOverlay.tsx#L140), [GameHud.tsx:28](../../apps/web/src/features/game/flow/GameHud.tsx#L28), [GameHud.tsx:45](../../apps/web/src/features/game/flow/GameHud.tsx#L45), [interact-prompt.ts:17](../../apps/web/src/features/game/flow/interact-prompt.ts#L17), [install-hint.ts:82](../../apps/web/src/features/game/flow/install-hint.ts#L82), [product-runtime.ts:1428](../../apps/web/src/app/product-runtime.ts#L1428)

### 10.2 핫바와 설치 힌트

- 핫바는 5칸이다.
  - 술래: 1 `▣ 감지기`, 2 `▲ 덫`(남은 개수)과 빈 칸 3개. 개수가 0이거나 잠김(행동 중·도전 중·구속 중)이면 `unavailable`, 선택한 칸은 `selected`다. 칸을 누르면 장비를 고른다.
  - 도망자: 교환 대상 판정이 가능할 때 빈 칸 5개만 둔다(도망자 아이템 없음).
- 술래에게는 핫바 위에 설치 힌트 한 줄이 뜬다.

| 막힘(판정 순서)                            | 문구                                            |
| ------------------------------------------ | ----------------------------------------------- |
| 설치 중                                    | 설치 중입니다. 다시 누르면 취소해요.            |
| 구속 중                                    | 구속이 풀리면 설치할 수 있어요.                 |
| 행동 중                                    | 멈춘 뒤에 설치할 수 있어요.                     |
| 남은 개수 0                                | 남은 개수가 없어요. 다른 장비를 골라 보세요.    |
| 감지기인데 마주 본 앞칸 벽면이 보이지 않음 | 벽을 마주 보고 서면 감지기를 붙일 수 있어요.    |
| 이 칸에 내 장비나 보이는 장비가 있음       | 이 칸에는 이미 장비가 있어요.                   |
| 통과                                       | `▣ 감지기`/`▲ 덫`를 여기에 설치할 수 있어요 · F |

이 힌트는 화면이 아는 것만 본다. 최종 판정은 서버가 한다. 한 경기에 한 번, 아직 설치하지 않은 술래가 설치할 수 있게 된 순간 `지금 F를 누르면 장비를 설치합니다. 1·2로 감지기와 덫을 고릅니다.` 안내를 낸다.

근거: [hotbar-model.ts:25](../../apps/web/src/features/game/flow/hotbar-model.ts#L25), [hotbar-model.ts:48](../../apps/web/src/features/game/flow/hotbar-model.ts#L48), [hotbar-model.ts:69](../../apps/web/src/features/game/flow/hotbar-model.ts#L69), [Hotbar.tsx:31](../../apps/web/src/features/game/flow/Hotbar.tsx#L31), [equipment-presenter.ts:23](../../apps/web/src/features/game/equipment/equipment-presenter.ts#L23), [install-hint.ts:17](../../apps/web/src/features/game/flow/install-hint.ts#L17), [install-hint.ts:56](../../apps/web/src/features/game/flow/install-hint.ts#L56), [install-hint.ts:91](../../apps/web/src/features/game/flow/install-hint.ts#L91), [product-runtime.ts:386](../../apps/web/src/app/product-runtime.ts#L386)

### 10.3 장비 HUD와 교환 패널(서랍)

- 장비 HUD(술래):
  - 장비 선택 단추 `1 · ▣ 감지기 n개`, `2 · ▲ 덫 n개`
  - 설치 중이면 진행률 `설치 중 · N%`와 `설치 취소`(`INSTALL_CANCEL`)
  - 그 밖이면 설치 단추(`INSTALL`, 요청 중에는 `서버 확인 중…`, 잠김·개수 0이면 비활성)
  - 내 설치물 목록: `소모됨`/`무장됨`/`무장 대기 N.N초`
- 교환 패널(도망자):
  - 후보는 보이는 도망자 중 맨해튼 거리 1 이하인 아군이다. 가까운 순, 같으면 ID 순으로 정렬한다.
  - 교환이 없으면 대상 선택과 `교환 요청 · E`를 둔다. 교환이 있으면 방향 문구(`아군이 지도를 나누려고 합니다.`/`아군의 수락을 기다립니다.`)와 남은 초, `수락 · E`(들어온 요청일 때만), `교환 취소`를 둔다.
  - 도전 중이거나 구속 중이면 요청·수락을 막는다.
  - 웹은 이 조건에 맞지 않는 교환 명령을 보내지 않는다.

근거: [EquipmentHud.tsx:30](../../apps/web/src/features/game/equipment/EquipmentHud.tsx#L30), [EquipmentHud.tsx:42](../../apps/web/src/features/game/equipment/EquipmentHud.tsx#L42), [EquipmentHud.tsx:58](../../apps/web/src/features/game/equipment/EquipmentHud.tsx#L58), [EquipmentHud.tsx:70](../../apps/web/src/features/game/equipment/EquipmentHud.tsx#L70), [exchange-presenter.ts:7](../../apps/web/src/features/game/map/exchange-presenter.ts#L7), [exchange-presenter.ts:20](../../apps/web/src/features/game/map/exchange-presenter.ts#L20), [exchange-presenter.ts:38](../../apps/web/src/features/game/map/exchange-presenter.ts#L38), [ExchangePanel.tsx:27](../../apps/web/src/features/game/map/ExchangePanel.tsx#L27), [product-runtime.ts:841](../../apps/web/src/app/product-runtime.ts#L841)

### 10.4 출구 도전

- 도전 후보는 내 출구이고, 접근 칸이 내 칸이며, 그 벽면이 지금 보이는 출구다. 벽을 마주 봐야(`dir === (wall.side + 2) % 4`) 시작할 수 있다.
- 모션 모드에서는 `PoseChallenge`(도망자 전용)를 쓴다.
  - 자세 이름은 `내 왼팔 들기`/`내 오른팔 들기`/`양팔 Y자`다.
  - 안내 `얼굴과 양 어깨가 카메라에 들어오게 하고 자세를 1.2초 유지하세요. 도전 중에도 포획될 수 있습니다.`, 진행 막대, 남은 초, `도전 취소`가 있다.
  - 실제 카메라 미리보기는 서랍 안 자세 미리보기 자리로 옮겨 붙인다.
- 판정 규칙:
  - 관절 visibility `0.5` 이상만 쓴다.
  - 여유 `margin = max(0.04, 어깨 너비 × 0.2)`이다.
  - 팔을 든 상태는 손목이 어깨보다 margin 위, 손목이 팔꿈치보다 위, 팔꿈치가 어깨 + margin보다 위일 때다.
  - 한 팔 자세는 드는 팔만 보이면 되고, 반대 팔은 보일 때만 내려 있어야 한다.
  - Y자는 두 팔을 들고 두 손목이 각자 바깥쪽에 있어야 한다.
- 유지 시간:
  - 표본 나이 300ms 이하, 표본 간격 300ms 이하만 센다.
  - 자세가 200ms 안에 돌아오면 누적을 유지하되 깨진 구간은 세지 않는다.
  - 1200ms를 채우고 `minSuccessTick`이 지나면 `EXIT_PROGRESS`(`completed: true`)를 보낸다.
  - `NOT_READY`로 거절되면 500ms 뒤 한 번 더 보낸다(최대 2회).
- 막힌 이유가 같은 값으로 500ms 이상 이어지면 안내 문구를 띄운다.
  - `sensor`: `카메라 자세 인식이 끊겼습니다. 얼굴이 화면에 들어오게 해 주세요.`
  - `trunk`: `얼굴과 양 어깨가 함께 보이게 해 주세요.`
  - `arm-offscreen`: `<팔>의 팔꿈치나 손목이 화면 밖입니다. 카메라에서 조금 물러나 주세요.`
  - `arm-low`: `<팔>을 어깨 위로 더 올려 주세요.`
  - `arm-spread`: `두 팔을 바깥쪽으로 벌려 Y자를 만들어 주세요.`
  - `other-arm`: 왼팔 자세면 `오른팔은 내려 주세요.`, 그 밖이면 `왼팔은 내려 주세요.`
  - `<팔>`은 자세가 `left`면 `왼팔`, `right`면 `오른팔`, `y`면 `두 팔`이다.
- 키보드 모드에서는 `KeyChallenge`를 쓴다(13.1). 네 방향을 모두 맞게 누르면 유지 1200ms로 간주한다.

근거: [challenge-controller.ts:7](../../apps/web/src/features/game/pose/challenge-controller.ts#L7), [challenge-controller.ts:15](../../apps/web/src/features/game/pose/challenge-controller.ts#L15), [challenge-controller.ts:88](../../apps/web/src/features/game/pose/challenge-controller.ts#L88), [challenge-controller.ts:104](../../apps/web/src/features/game/pose/challenge-controller.ts#L104), [challenge-controller.ts:109](../../apps/web/src/features/game/pose/challenge-controller.ts#L109), [pose-evaluator.ts:4](../../apps/web/src/features/game/pose/pose-evaluator.ts#L4), [pose-evaluator.ts:18](../../apps/web/src/features/game/pose/pose-evaluator.ts#L18), [pose-evaluator.ts:42](../../apps/web/src/features/game/pose/pose-evaluator.ts#L42), [pose-evaluator.ts:67](../../apps/web/src/features/game/pose/pose-evaluator.ts#L67), [pose-evaluator.ts:84](../../apps/web/src/features/game/pose/pose-evaluator.ts#L84), [pose-evaluator.ts:185](../../apps/web/src/features/game/pose/pose-evaluator.ts#L185), [PoseChallenge.tsx:6](../../apps/web/src/features/game/pose/PoseChallenge.tsx#L6), [PoseChallenge.tsx:36](../../apps/web/src/features/game/pose/PoseChallenge.tsx#L36), [PoseChallenge.tsx:73](../../apps/web/src/features/game/pose/PoseChallenge.tsx#L73), [ProductApp.tsx:1198](../../apps/web/src/app/ProductApp.tsx#L1198), [ProductApp.tsx:1228](../../apps/web/src/app/ProductApp.tsx#L1228)

### 10.5 관전

- 관전 막대는 `관전 · <이름> 시점`을 보여 주고, 후보별로 `SPECTATE`(`targetPlayerId`) 단추를 둔다. 현재 대상은 비활성이다.
- 명부에 이름이 없으면 `도망자 N`, 후보가 아니면 `생존 도망자`로 표시한다.
- 안내는 `생존 도망자가 보고 듣는 범위만 함께 봅니다.`다.
- 관전 중 1인칭 손에는 지도 도구를 든다(block 테마).

근거: [SpectatorBar.tsx:24](../../apps/web/src/features/game/flow/SpectatorBar.tsx#L24), [SpectatorBar.tsx:41](../../apps/web/src/features/game/flow/SpectatorBar.tsx#L41), [SpectatorBar.tsx:54](../../apps/web/src/features/game/flow/SpectatorBar.tsx#L54), [ProductApp.tsx:1161](../../apps/web/src/app/ProductApp.tsx#L1161), [WorldCanvas.tsx:79](../../apps/web/src/features/game/scene/WorldCanvas.tsx#L79)

### 10.6 미니맵

- 기본은 내 주변 `11`칸 창이고, 전체 지도는 `32`칸이다.
- M 키로 둘 사이를 180ms 동안 smoothstep 곡선으로 전환한다. 전환 중에 다시 누르면 지금 위치에서 되돌아간다. 세계 화면이 사라지면 창 모드로 되돌린다.
- 창 모드의 그리기:
  - 어두운 바탕, 가 본 바닥 사각형, 뼛빛 벽 선
  - 가운데 흰 점과 반지름 `3.2`칸·폭 90°의 시선 부채꼴
  - 출구는 벽면의 굵은 띠와 번호. 내 출구 `#d9b25a`, 남의 출구 `#9d9889`.
  - 북쪽 `N` 표시
- 전체 지도의 그리기:
  - 안 가 본 칸의 옅은 격자(창에서 전환이 절반을 넘으면 켬), 채운 바닥, 칸 경계의 벽 띠
  - 내 위치는 역할 색 삼각형
- 공통 표시:
  - 술래에게는 출구를 그리지 않는다.
  - 술래의 과거 사건 표식(`HUNTER_MARKER`)은 `showAtTick <= tick < expiresTick` 동안 빈 원으로 그린다.
  - 데모의 운영자 출구는 원 안 마름모와 `O`로 따로 그린다.
- 그릴 결과(크기·축척·보간 위치·지형 수·출구·표식)가 같으면 다시 그리지 않는다. 칸 크기는 정수 픽셀이고, 배율은 `devicePixelRatio`의 내림값을 1~2로 제한한다.

근거: [minimap-render.ts:9](../../apps/web/src/features/game/map/minimap-render.ts#L9), [minimap-render.ts:14](../../apps/web/src/features/game/map/minimap-render.ts#L14), [minimap-render.ts:47](../../apps/web/src/features/game/map/minimap-render.ts#L47), [minimap-render.ts:229](../../apps/web/src/features/game/map/minimap-render.ts#L229), [minimap-render.ts:270](../../apps/web/src/features/game/map/minimap-render.ts#L270), [minimap-render.ts:351](../../apps/web/src/features/game/map/minimap-render.ts#L351), [minimap-render.ts:414](../../apps/web/src/features/game/map/minimap-render.ts#L414), [map-draw-model.ts:13](../../apps/web/src/features/game/map/map-draw-model.ts#L13), [past-event-markers.ts:9](../../apps/web/src/features/game/map/past-event-markers.ts#L9), [MiniMap.tsx:37](../../apps/web/src/features/game/map/MiniMap.tsx#L37), [MiniMap.tsx:58](../../apps/web/src/features/game/map/MiniMap.tsx#L58), [minimap-zoom.ts:8](../../apps/web/src/features/game/map/minimap-zoom.ts#L8), [minimap-zoom.ts:47](../../apps/web/src/features/game/map/minimap-zoom.ts#L47), [ProductApp.tsx:466](../../apps/web/src/app/ProductApp.tsx#L466)

### 10.7 플래시와 사건 기록

- 전면 플래시는 900ms 동안 보인다. 종류와 문구는 `capture-success` 도망자 포획!, `captured` 포획되었습니다, `escaped` 탈출했습니다, `exit-failed` 탈출에 실패했습니다, `restrained` 덫에 걸렸습니다, `victory` 승리, `defeat` 패배, `sensor` 감지기가 울렸습니다, `trap` 덫이 작동했습니다이다.
- 사건 기록은 안내음을 글줄로 바꾼다. 최근 4줄을 6000ms 동안 남긴다. 줄은 `경기 시작`, `덫에 걸렸습니다`, `포획되었습니다`, `탈출했습니다`, `탈출에 실패했습니다`, `지도 교환 요청이 왔습니다`, `지도 교환 완료`, `우리 팀이 한 걸음 앞섰습니다`, `상대 팀이 한 걸음 앞섰습니다`, `승리`, `패배`, `경기 무효`다.
- 누계 안내음은 300ms 미룬다.

근거: [match-cues.ts:113](../../apps/web/src/features/game/flow/match-cues.ts#L113), [match-cues.ts:143](../../apps/web/src/features/game/flow/match-cues.ts#L143), [CueFlash.tsx:7](../../apps/web/src/features/game/flow/CueFlash.tsx#L7), [event-log.ts:8](../../apps/web/src/features/game/flow/event-log.ts#L8), [event-log.ts:12](../../apps/web/src/features/game/flow/event-log.ts#L12)

## 11. 결과, 중단과 재경기

### 11.1 결과 문구

| 경우                           | 제목                       | 본문                                                                                                                                 |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ABORTED`                      | 경기 무효                  | 11.2의 중단 사유 문구. 사유가 없으면 `경기를 계속할 수 없어 무효 처리되었습니다. 연결 정리가 끝나면 방장이 다시 시작할 수 있습니다.` |
| `RESULT`, `two-escaped`        | 도망자 승리                | 도망자 2명이 탈출하여 도망자 팀이 승리했습니다.                                                                                      |
| `RESULT`, `two-captured`       | 술래 승리                  | 도망자 2명을 포획하여 술래 팀이 승리했습니다.                                                                                        |
| `RESULT`, `timeout`, 도망자 승 | 도망자 승리                | 제한 시간이 끝났고 탈출이 포획보다 많아 도망자 팀이 승리했습니다.                                                                    |
| `RESULT`, `timeout`, 술래 승   | 술래 승리                  | 제한 시간이 끝나 술래 팀이 승리했습니다.                                                                                             |
| `PLAYING` 중 개인 종료         | 탈출 성공 / 포획되었습니다 | 참가가 종료되었습니다. 경기가 끝날 때까지 팀의 공개 결과를 확인할 수 있습니다.                                                       |

- 개인 줄은 `나의 결과: 탈출 성공|포획됨`이다. `ABORTED`면 `경기 중 기록: 탈출|포획 · 경기는 무효 처리되었습니다.`
- 팀 줄은 `우리 팀 승리`/`우리 팀 패배`다.
- 집계 줄은 `탈출 n · 포획 n · 종료 시 남은 도망자/활동 중인 도망자 n`이다. 도망자 수는 `capacity / 2`다.
- 경기 중이면 `남은 시간 N초`를 표시한다.

근거: [result-presenter.ts:17](../../apps/web/src/features/game/flow/result-presenter.ts#L17), [result-presenter.ts:33](../../apps/web/src/features/game/flow/result-presenter.ts#L33), [result-presenter.ts:47](../../apps/web/src/features/game/flow/result-presenter.ts#L47), [result-presenter.ts:65](../../apps/web/src/features/game/flow/result-presenter.ts#L65), [ResultScreen.tsx:32](../../apps/web/src/features/game/flow/ResultScreen.tsx#L32), [ResultScreen.tsx:43](../../apps/web/src/features/game/flow/ResultScreen.tsx#L43)

### 11.2 중단 사유

| `abortReason`                        | 문구                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| `GAME_CONNECTION_LOST` + `abortedBy` | `<abortedBy>`님의 연결이 끊겨 경기가 무효 처리되었습니다. |
| `GAME_CONNECTION_LOST`               | 게임 연결이 끊겨 경기가 무효 처리되었습니다.              |
| `SERVER_TICK_OVERLOAD`               | 서버 지연으로 경기가 무효 처리되었습니다.                 |
| `MEDIA_POLICY_UNCERTAIN`             | 미디어 권한을 확인하지 못해 경기가 무효 처리되었습니다.   |
| `MEDIA_UNAVAILABLE`                  | 미디어 연결을 사용할 수 없어 경기가 무효 처리되었습니다.  |
| `DEMO_OPERATOR_ABORT`                | 관리자가 라운드를 끝냈습니다.                             |

근거: [result-presenter.ts:2](../../apps/web/src/features/game/flow/result-presenter.ts#L2), [result-presenter.ts:48](../../apps/web/src/features/game/flow/result-presenter.ts#L48)

### 11.3 재경기 선택

| 방                             | 표시                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 시연 방(`kind === 'showcase'`) | `시연이 끝났습니다. 다음 시연은 /showcase 에서 새 방으로 시작합니다.` 선택지 없음.                                                                                                                                                  |
| 데모 방                        | 방장에게 `도망자로 재경기`/`술래로 재경기`(`REMATCH { mode: 'same', role }`). 안내 `다음 경기에서 맡을 역할을 고르세요. 인형이 준비를 대신합니다.`                                                                                  |
| 일반 방                        | 방장에게 `같은 팀으로 재경기`(`same`), `역할 바꿔 재경기`(`swap`), `로비로 돌아가기`(`lobby`). 방장 안내 `재경기 방식을 선택해 주세요. 모두 다시 준비한 뒤 시작합니다.`, 그 밖은 `방장이 다음 경기를 선택하기를 기다리고 있습니다.` |

- `rematchState === 'requested'`이거나 요청이 진행 중이면 `다음 경기를 준비하고 있습니다. 잠시 기다려 주세요.`를 표시하고 단추를 잠근다.
- `settling`이면 `다음 경기를 위해 연결을 정리하고 있습니다. 재경기를 선택하면 준비되는 대로 이동합니다.`
- 일반 방에서 연결 인원이 자리보다 적으면 `현재 n/capacity명입니다. 로비에서 추가 참가자를 모은 뒤 시작할 수 있습니다.`를 표시한다. 연결 끊김 중단이면 로비 재참가 안내를 덧붙인다.

근거: [ResultScreen.tsx:33](../../apps/web/src/features/game/flow/ResultScreen.tsx#L33), [ResultScreen.tsx:48](../../apps/web/src/features/game/flow/ResultScreen.tsx#L48), [ResultScreen.tsx:53](../../apps/web/src/features/game/flow/ResultScreen.tsx#L53), [ResultScreen.tsx:66](../../apps/web/src/features/game/flow/ResultScreen.tsx#L66), [ResultScreen.tsx:79](../../apps/web/src/features/game/flow/ResultScreen.tsx#L79), [ResultScreen.tsx:93](../../apps/web/src/features/game/flow/ResultScreen.tsx#L93), [ProductApp.tsx:1034](../../apps/web/src/app/ProductApp.tsx#L1034)

## 12. 방 안 설정 창

- 방 안에서 Esc(반복 제외)를 누르거나 머리말 또는 대기실의 `ESC 설정`을 누르면 설정 창이 열린다. Esc는 열고 닫기를 번갈아 한다. 방을 벗어나면 닫힌다.
- 창의 위 단추는 `방 나가기`(`leave()` 직접 호출), 아래 단추는 `닫기`다.
- 갈래는 세 개다.

| 갈래                     | 내용                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `조작 · 장치`(처음 열림) | `TEAM_PRACTICE`·`PLAYING`이면 `받은 상대 얼굴 N개 · 지금 보이는 사람 N명`. 그 아래 `LocalControls` 전체 변형.                                                              |
| `소리`                   | `AudioControls`: 듣는 음량(0~100%), `모든 소리 끄기`, 마이크 입력 크기 막대(100ms마다 갱신), `확인음 듣기`(`DEVICE_CHECK`·`TEAM_PRACTICE`만), 친구별 `<이름> 목소리 끄기`. |
| `화면`                   | `QualityControl`로 이 방의 품질을 바꾼다.                                                                                                                                  |

방 안에서 바꾼 음량·품질은 런타임에만 적용되고 홈 설정 저장소에는 쓰지 않는다. 설정 창이 열려 있는 동안 우상단 캐릭터 창(WebGL)을 내린다. 세계 Canvas는 멈추지 않는다.

근거: [ProductApp.tsx:585](../../apps/web/src/app/ProductApp.tsx#L585), [ProductApp.tsx:593](../../apps/web/src/app/ProductApp.tsx#L593), [ProductApp.tsx:1284](../../apps/web/src/app/ProductApp.tsx#L1284), [ProductApp.tsx:1291](../../apps/web/src/app/ProductApp.tsx#L1291), [ProductApp.tsx:1302](../../apps/web/src/app/ProductApp.tsx#L1302), [ProductApp.tsx:1346](../../apps/web/src/app/ProductApp.tsx#L1346), [ProductApp.tsx:1364](../../apps/web/src/app/ProductApp.tsx#L1364), [ProductApp.tsx:202](../../apps/web/src/app/ProductApp.tsx#L202), [AudioControls.tsx:42](../../apps/web/src/features/game/flow/AudioControls.tsx#L42), [AudioControls.tsx:103](../../apps/web/src/features/game/flow/AudioControls.tsx#L103), [AudioControls.tsx:126](../../apps/web/src/features/game/flow/AudioControls.tsx#L126), [SettingsWindow.tsx:62](../../apps/web/src/features/game/flow/SettingsWindow.tsx#L62)

## 13. 입력

### 13.1 키

입력 문맥은 페이지 활성, 본인 `ACTIVE`, 단계 `TEAM_PRACTICE`·`COUNTDOWN`·`PLAYING`일 때만 받는다. 도전 중이면 취소 외 행동과 이동·회전을 막는다. 키는 `event.code`로 읽는다.

| 키                                                      | 모드             | 효과                                                                                                                                                                                                              |
| ------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KeyW`/`ArrowUp`, `KeyS`/`ArrowDown`                    | 키보드 모드만    | 전진·후진. 전진 180ms, 후진 320ms를 누르고 있어야 의도가 된다. 의도를 보내고 100ms 뒤 해제해 한 칸만 가고, 누른 지 400ms가 되면 100ms마다 갱신하는 연속 이동으로 바뀐다. 두 키를 함께 누르면 중립. 놓으면 멈춘다. |
| `KeyA`/`ArrowLeft`, `KeyD`/`ArrowRight`                 | 키보드 모드만    | 90° 회전(`TURN`). 150ms 누르면 한 번 발동하고 잠긴다. 모든 키를 놓고 150ms가 지나야 다음 회전을 받는다. 두 방향을 함께 누르면 버린다.                                                                             |
| `KeyE`                                                  | 두 모드          | 들어온 교환 수락 → 마주 본 내 출구 도전 시작(`EXIT_START`) → 옆 아군에게 교환 요청. 이미 보낸 요청이 있으면 새 요청을 만들지 않는다.                                                                              |
| `KeyF`                                                  | 두 모드          | 술래만. 설치 중이면 `INSTALL_CANCEL`, 아니면 선택 장비 `INSTALL`. 도망자에게는 행동이 없다.                                                                                                                       |
| `KeyG`                                                  | 두 모드          | `PLAYING`의 술래만 `GRAB_INTENT`.                                                                                                                                                                                 |
| `Digit1`, `Digit2`                                      | 두 모드          | 술래만 장비 선택 `sensor`/`trap`.                                                                                                                                                                                 |
| `Escape`                                                | 두 모드          | 도전 중이면 `EXIT_CANCEL`(입력 문맥과 무관하게). 방 안에서는 설정 창 토글도 함께 일어난다(21절 한계). 홈 옵션에서는 제목으로.                                                                                     |
| `KeyM`                                                  | 세계 화면        | 미니맵 축척 전환. repeat·IME·입력창·Ctrl/Meta/Alt 조합은 무시.                                                                                                                                                    |
| `ArrowUp`/`ArrowRight`/`ArrowDown`/`ArrowLeft`(도전 중) | 키보드 모드      | `KeyChallenge`. 순서는 도전 ID의 FNV-1a32 해시로 `up, right, down, left`를 회전한 것이다. 틀리면 처음부터, repeat은 무시한다. Alt/Ctrl/Meta 조합과 입력창은 무시한다. 화면 방향 단추로도 누를 수 있다.            |
| `Ctrl+Shift+D`                                          | 혼자 연습 화면만 | 추적 디버그 오버레이 토글. `INPUT`·`TEXTAREA` 안에서는 무시.                                                                                                                                                      |

게임 keydown(`InteractionRuntime`)은 `isComposing`이거나, 대상이 `INPUT`·`TEXTAREA`·`SELECT`이거나, contentEditable이면 무시한다. 행동 키(E·F·G·1·2·Escape)는 repeat이면 무시한다.

근거: [interaction-context.ts:69](../../apps/web/src/features/input/interaction-context.ts#L69), [interaction-context.ts:79](../../apps/web/src/features/input/interaction-context.ts#L79), [InteractionRuntime.ts:515](../../apps/web/src/features/input/InteractionRuntime.ts#L515), [InteractionRuntime.ts:527](../../apps/web/src/features/input/InteractionRuntime.ts#L527), [InteractionRuntime.ts:537](../../apps/web/src/features/input/InteractionRuntime.ts#L537), [InteractionRuntime.ts:1372](../../apps/web/src/features/input/InteractionRuntime.ts#L1372), [InteractionRuntime.ts:1380](../../apps/web/src/features/input/InteractionRuntime.ts#L1380), [gesture-intent.ts:96](../../apps/web/src/features/input/gesture-intent.ts#L96), [gesture-intent.ts:124](../../apps/web/src/features/input/gesture-intent.ts#L124), [gesture-intent.ts:232](../../apps/web/src/features/input/gesture-intent.ts#L232), [gesture-intent.ts:243](../../apps/web/src/features/input/gesture-intent.ts#L243), [move-intent.ts:58](../../apps/web/src/features/input/move-intent.ts#L58), [move-intent.ts:183](../../apps/web/src/features/input/move-intent.ts#L183), [move-intent.ts:246](../../apps/web/src/features/input/move-intent.ts#L246), [move-intent.ts:350](../../apps/web/src/features/input/move-intent.ts#L350), [turn-intent.ts:166](../../apps/web/src/features/input/turn-intent.ts#L166), [turn-intent.ts:185](../../apps/web/src/features/input/turn-intent.ts#L185), [key-challenge.ts:4](../../apps/web/src/features/game/pose/key-challenge.ts#L4), [KeyChallenge.tsx:24](../../apps/web/src/features/game/pose/KeyChallenge.tsx#L24), [minimap-zoom.ts:18](../../apps/web/src/features/game/map/minimap-zoom.ts#L18), [debug-feed.ts:84](../../apps/web/src/features/debug/debug-feed.ts#L84), [SoloPracticeScreen.tsx:80](../../apps/web/src/features/game/solo/SoloPracticeScreen.tsx#L80), [ProductApp.tsx:111](../../apps/web/src/app/ProductApp.tsx#L111)

### 13.2 모션과 손동작

제품 방의 기본 입력 모드는 `motion`이다. 모션 모드에서는 이동·회전 키가 아무 일도 하지 않는다.

| 입력        | 규칙                                                                                                                                                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전후 기울임 | 어깨 거리 신호 `ln(현재/중립)`. 전진 발동/해제 `0.12/0.06`, 후진 `0.09/0.045`. 발동 유지 전진 180ms, 후진 320ms. 이후 한 칸/연속 규칙은 키보드와 같다(연속 전환 `400ms`). 고개가 `0.2094rad`보다 돌아가 있으면 전후 이동을 만들지 않는다.                                                                              |
| 고개 회전   | 발동/해제 `0.3491/0.2094rad`. 150ms 유지로 한 번 발동하고, 해제 임계 안에서 150ms 중립을 유지해야 다음 회전을 받는다.                                                                                                                                                                                                  |
| 주먹        | 모션 모드의 `PLAYING` 술래만. 즉시 `GRAB_INTENT`를 보내고, 유지하면 200ms마다 다시 보낸다.                                                                                                                                                                                                                             |
| 펼친 손바닥 | 600ms 유지 뒤 교환 수락·요청(출구 시작은 안 함). 손을 내렸다가(`none`) 다시 해야 재발동.                                                                                                                                                                                                                               |
| V 손동작    | 600ms 유지 뒤 술래 설치·취소.                                                                                                                                                                                                                                                                                          |
| 보정        | 신선한 표본 8개, 산포 `0.1745rad` 이하.                                                                                                                                                                                                                                                                                |
| 필터        | One Euro(최소 차단 1Hz, beta 0.01, 도함수 차단 1Hz). 간격이 500ms를 넘으면 필터와 유지를 초기화.                                                                                                                                                                                                                       |
| 장애 폴백   | 새 추론 결과가 1500ms 동안 없거나(`INFERENCE_STALLED`), 얼굴이 1500ms 동안 계속 무효하거나(`FACE_INVALID`), 카메라 종료(`CAMERA_ENDED`)·Worker 오류(`WORKER_ERROR`)가 나면 키보드 모드로 바꾸고 유지 중인 입력을 버린다. 모션 복귀는 새 보정과 명시적 모션 선택이 모두 있어야 한다. 마이크만 실패하면 모션을 유지한다. |

근거: [input-tuning.ts:45](../../apps/web/src/features/input/input-tuning.ts#L45), [input-tuning.ts:51](../../apps/web/src/features/input/input-tuning.ts#L51), [input-tuning.ts:55](../../apps/web/src/features/input/input-tuning.ts#L55), [input-tuning.ts:57](../../apps/web/src/features/input/input-tuning.ts#L57), [input-tuning.ts:59](../../apps/web/src/features/input/input-tuning.ts#L59), [input-tuning.ts:75](../../apps/web/src/features/input/input-tuning.ts#L75), [move-intent.ts:306](../../apps/web/src/features/input/move-intent.ts#L306), [turn-intent.ts:131](../../apps/web/src/features/input/turn-intent.ts#L131), [gesture-intent.ts:14](../../apps/web/src/features/input/gesture-intent.ts#L14), [gesture-intent.ts:185](../../apps/web/src/features/input/gesture-intent.ts#L185), [gesture-intent.ts:202](../../apps/web/src/features/input/gesture-intent.ts#L202), [input-fallback.ts:10](../../apps/web/src/features/input/input-fallback.ts#L10), [input-fallback.ts:55](../../apps/web/src/features/input/input-fallback.ts#L55), [input-fallback.ts:115](../../apps/web/src/features/input/input-fallback.ts#L115), [product-runtime.ts:185](../../apps/web/src/app/product-runtime.ts#L185), [InteractionRuntime.ts:879](../../apps/web/src/features/input/InteractionRuntime.ts#L879)

## 14. 혼자 연습(튜토리얼)

혼자 연습은 Room과 서버 없이 로컬 세계에서 돈다. 미디어 발급·보고는 `SOLO_MEDIA_UNAVAILABLE`로 거절하므로 LiveKit을 쓰지 않는다.

| 항목      | 값·규칙                                                                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 맵        | 폭 1칸 미로. 바닥은 `x=2, y=1..5`, `y∈{1,3,5}`의 `x=3..5`, `(1,3)`로 모두 15칸이다.                                                                                                                             |
| 시작      | `(2,3)`, 북쪽(dir 0), 도망자. 장비 감지기 1·덫 1.                                                                                                                                                               |
| 역할 전환 | 도망자는 `(2,1)` 북쪽(내 출구 앞), 술래는 `(1,3)` 서쪽. 장비와 설치물을 초기화한다.                                                                                                                             |
| 출구      | 접근 `(2,1)`, 벽 `(2,0) side 2`. 도전은 `y` 자세. 최소 24 tick, 만료 200 tick.                                                                                                                                  |
| 설치      | 10 tick. 감지기는 앞 벽이 있어야 한다.                                                                                                                                                                          |
| 행동 시간 | 서버와 같은 `PRODUCT_ACTION_MS`(이동 12 tick, 회전 8 tick). tick은 `performance.now()/PRODUCT_TICK_MS`.                                                                                                         |
| 이동 의도 | 350ms 동안 갱신이 없으면 버린다. 이동 뒤 500ms 멈추면 `중립으로 멈추기`를 완료로 센다.                                                                                                                          |
| 입력 모드 | 처음에는 `keyboard`. 카메라 시작이나 보정이 성공하면 `motion`으로 바꾼다.                                                                                                                                       |
| 페이지    | 메뉴가 닫혀 있으면 세계 Canvas와 우상단 `내 캐릭터`(`SelfAvatarView`) Canvas 2개, 메뉴가 열리면 세계 Canvas만. 80ms마다 poll. `blur`는 입력만 멈추고, `pagehide`면 `화면 이동으로 체험을 종료했어요.`로 끝낸다. |
| 메뉴      | Esc로 체험 메뉴를 연다. 도전 중에는 Esc를 도전 취소에 양보하고 메뉴를 열지 않는다. 메뉴가 열린 동안 세계 Canvas를 `frameloop='never'`로 멈춘다.                                                                 |
| 설정      | 음량·품질 변경을 홈 설정 저장소에 즉시 쓴다.                                                                                                                                                                    |
| 디버그    | `Ctrl+Shift+D`와 옵션 체크박스로 오버레이 토글.                                                                                                                                                                 |
| 캐릭터 창 | `SelfAvatarView`(15.5).                                                                                                                                                                                         |

근거: [solo-world.ts:34](../../apps/web/src/features/game/solo/solo-world.ts#L34), [solo-world.ts:53](../../apps/web/src/features/game/solo/solo-world.ts#L53), [solo-world.ts:81](../../apps/web/src/features/game/solo/solo-world.ts#L81), [solo-world.ts:132](../../apps/web/src/features/game/solo/solo-world.ts#L132), [solo-world.ts:177](../../apps/web/src/features/game/solo/solo-world.ts#L177), [solo-world.ts:185](../../apps/web/src/features/game/solo/solo-world.ts#L185), [solo-world.ts:249](../../apps/web/src/features/game/solo/solo-world.ts#L249), [solo-world.ts:271](../../apps/web/src/features/game/solo/solo-world.ts#L271), [solo-world.ts:321](../../apps/web/src/features/game/solo/solo-world.ts#L321), [solo-session.ts:28](../../apps/web/src/features/game/solo/solo-session.ts#L28), [solo-session.ts:100](../../apps/web/src/features/game/solo/solo-session.ts#L100), [solo-session.ts:190](../../apps/web/src/features/game/solo/solo-session.ts#L190), [SoloPracticeScreen.tsx:93](../../apps/web/src/features/game/solo/SoloPracticeScreen.tsx#L93), [SoloPracticeScreen.tsx:104](../../apps/web/src/features/game/solo/SoloPracticeScreen.tsx#L104), [SoloPracticeScreen.tsx:167](../../apps/web/src/features/game/solo/SoloPracticeScreen.tsx#L167), [SoloPracticeScreen.tsx:176](../../apps/web/src/features/game/solo/SoloPracticeScreen.tsx#L176), [SoloPracticeScreen.tsx:323](../../apps/web/src/features/game/solo/SoloPracticeScreen.tsx#L323), [product.ts:54](../../packages/protocol/src/game-schema/product.ts#L54)

## 15. 장면과 아바타

### 15.1 카메라

- 1인칭 카메라는 보간된 셀·방향을 따른다. 눈높이는 `CHARACTER.eyeHeight = 0.8`이고, 시선 방향으로 `0.001` 앞당긴다.
- 세로 FOV는 가로 반시야각 40°를 화면비로 환산한 `2·atan(tan40°/max(0.1, aspect))`다.
- 제품 Canvas는 near `0.03`, far `CAMERA_FAR = 3.6`(서버 시야 3.5보다 조금 멀고, 두 테마의 안개가 닫힌 뒤), 초기 위치 `[0, 0.8, 0]`, `antialias false`, `dpr = QUALITY_PRESETS[quality].dpr`다. 프레임 루프는 `paused`일 때만 `never`인데, 제품 방은 `paused`를 넘기지 않는다.
- 진단 Canvas는 카메라 `[0, 36, 30]`, 고정 FOV 48°의 격자·상자 화면이다.

근거: [FirstPersonCamera.tsx:6](../../apps/web/src/features/game/scene/FirstPersonCamera.tsx#L6), [FirstPersonCamera.tsx:13](../../apps/web/src/features/game/scene/FirstPersonCamera.tsx#L13), [scene-model.ts:3](../../apps/web/src/features/game/scene/scene-model.ts#L3), [WorldCanvas.tsx:84](../../apps/web/src/features/game/scene/WorldCanvas.tsx#L84), [WorldCanvas.tsx:87](../../apps/web/src/features/game/scene/WorldCanvas.tsx#L87), [WorldCanvas.tsx:127](../../apps/web/src/features/game/scene/WorldCanvas.tsx#L127)

### 15.2 테마와 품질

테마는 URL `?theme=`, 저장값 `kkakkung.scene-theme`, 기본 `facility` 순으로 정한다.

| 선택                        | 값                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facility`(백룸 복도, 기본) | 배경 `#211b0e`, 안개 `1.8`–`3.4`, 벽 높이 `1.9`. 벽 색 텍스처는 공개 `/textures/backrooms/seamless.png`(가로 반복, 세로 거울 반복, `repeat 1×2`, 선형 필터와 mipmap)다. 불러오지 못하면 코드가 만든 128×128 벽 텍스처와 색 `#b18b36`을 쓴다. 바닥은 코드가 만든 128×128 텍스처다. roughness·normal map은 두 품질 모두 쓰지 않는다(경로가 `null`). |
| `block`(어두운 블록)        | 배경 `#030303`, 안개 `1.6`–`3.4`, 벽 높이 `1.2`. 코드가 만든 `16×16` DataTexture(돌·이끼·바닥·천장)를 nearest 필터, mipmap 없이 쓴다. `(x·7 + y·3 + side) % 5 === 0`인 벽면은 이끼. 1인칭 손 도구를 든다.                                                                                                                                         |
| `medium`                    | `dpr [1, 1.25]`(기기 배율을 따르되 1~1.25로 자름). facility의 패널·레일·이음 형상을 그린다.                                                                                                                                                                                                                                                       |
| `low`                       | `dpr [1, 1]`. facility의 패널·레일·이음 형상을 빼고 그린다.                                                                                                                                                                                                                                                                                       |

프리셋의 `antialias: false`와 `postprocessing: false` 필드는 어디서도 읽지 않는다. 적용되는 값은 `dpr`뿐이다. 술래에게는 1인칭 잡기 손(`GrabHand`)을 그리고, 잡기 입력마다 손 연출을 다시 시작한다.

근거: [scene-theme.ts:7](../../apps/web/src/features/game/scene/scene-theme.ts#L7), [scene-theme.ts:25](../../apps/web/src/features/game/scene/scene-theme.ts#L25), [facility-theme.ts:14](../../apps/web/src/features/game/scene/facility-theme.ts#L14), [facility-theme.ts:94](../../apps/web/src/features/game/scene/facility-theme.ts#L94), [facility-theme.ts:105](../../apps/web/src/features/game/scene/facility-theme.ts#L105), [backrooms-textures.ts:24](../../apps/web/src/features/game/scene/backrooms-textures.ts#L24), [backrooms-textures.ts:30](../../apps/web/src/features/game/scene/backrooms-textures.ts#L30), [primitives.tsx:105](../../apps/web/src/features/game/scene/primitives.tsx#L105), [block-theme.ts:22](../../apps/web/src/features/game/scene/block-theme.ts#L22), [block-theme.ts:149](../../apps/web/src/features/game/scene/block-theme.ts#L149), [block-theme.ts:194](../../apps/web/src/features/game/scene/block-theme.ts#L194), [quality-presets.ts:9](../../apps/web/src/features/game/scene/quality-presets.ts#L9), [WorldCanvas.tsx:101](../../apps/web/src/features/game/scene/WorldCanvas.tsx#L101)

### 15.3 보이는 것

`VisibleTerrain`은 개인 뷰의 가시 셀·벽면으로 지형을 그리고, 보이는 출구, 장비, 플레이어 아바타를 얹는다. 마스크는 개인 뷰가 바뀔 때만 다시 계산한다.

근거: [VisibleTerrain.tsx:33](../../apps/web/src/features/game/scene/VisibleTerrain.tsx#L33)

### 15.4 아바타

- 모든 부위는 단위 큐브 하나를 부위별로 늘려 쓴다. 머리 큐브 한 변 `0.48`(`CHARACTER.head`), `headY 0.72`, `torsoY 0.33`, 몸통 높이 `0.3`·깊이 `0.18`, 팔 길이 `0.28`, 다리 `0.235`, 팔다리 폭 `0.1`.
- 얼굴 판은 `0.418×0.418` 평면이다. 머리 앞(`z -0.241`)에 180° 돌려 붙이고 조명의 영향을 받지 않는다.
- 얼굴 텍스처는 매 프레임 `faces.get(player.id)` → `standIn` → 없음 순으로 고른다.
  - 없음이면 색 `#7c8984`, 텍스처가 있으면 흰색.
  - `standIn`은 세계에서는 데모 방의 공통 그림 얼굴, 대기실·캐릭터 창에서는 7.2·15.5의 값이다.
  - VideoTexture는 매 프레임 `needsUpdate`로 올린다.
- 역할별 실루엣:

| 역할       | 어깨 폭 | 모양 | 옷/강조/신발 색                   |
| ---------- | ------- | ---- | --------------------------------- |
| `tagger`   | `0.42`  | 챙   | `#b8402f` / `#f0a070` / `#3a1a14` |
| `runner`   | `0.32`  | 가방 | `#2f9f96` / `#8fe6d8` / `#12302e` |
| 없음(중립) | `0.36`  | 없음 | `#5e5a52` / `#8a857b` / `#1f2223` |

- 보는 사람과 같은 역할이면 머리 위(`y 1.035`)에 아군 배지 구(반지름 `0.032`)를 단다.
- 위치·방향은 서버 행동의 보간을 따른다. 팔다리 흔들림은 같은 진행도에서 만든 장식이다.

근거: [FaceAvatar.tsx:27](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L27), [FaceAvatar.tsx:43](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L43), [FaceAvatar.tsx:64](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L64), [FaceAvatar.tsx:133](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L133), [FaceAvatar.tsx:141](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L141), [FaceAvatar.tsx:145](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L145), [FaceAvatar.tsx:163](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L163), [FaceAvatar.tsx:226](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L226), [FaceAvatar.tsx:251](../../apps/web/src/features/game/scene/FaceAvatar.tsx#L251), [role-colors.ts:9](../../apps/web/src/features/game/scene/role-colors.ts#L9), [role-colors.ts:18](../../apps/web/src/features/game/scene/role-colors.ts#L18), [scene-model.ts:3](../../apps/web/src/features/game/scene/scene-model.ts#L3), [ProductApp.tsx:212](../../apps/web/src/app/ProductApp.tsx#L212)

### 15.5 내 캐릭터 창

- `SelfAvatarView`는 혼자 연습 화면과 제품의 `SelfCorner`(팀 연습·경기의 우상단, `activeSelf`이고 설정 창이 닫혀 있을 때) 두 곳에서 쓴다.
- 게시되는 것과 같은 가공 얼굴 스트림을 화면에 붙이지 않은 video(음소거)로 받아 VideoTexture로 만든다. 스트림이 없으면 그림 얼굴(`createDemoFaceTexture`)을 쓴다.
- Canvas 설정은 `dpr [1, 1.5]`, `antialias true`, `alpha true`, 카메라 `[0, 0.8, -1.75]`·`fov 30`·near/far `0.05/10`·`lookAtY 0.5`다.
- 아바타는 제자리에 두고, 방향은 매 프레임 차이의 `0.1`만큼 따라 돌아 회전이 보이게 한다.

근거: [SelfCorner.tsx:46](../../apps/web/src/features/game/flow/SelfCorner.tsx#L46), [SelfCorner.tsx:50](../../apps/web/src/features/game/flow/SelfCorner.tsx#L50), [SelfAvatarView.tsx:22](../../apps/web/src/features/game/solo/SelfAvatarView.tsx#L22), [SelfAvatarView.tsx:24](../../apps/web/src/features/game/solo/SelfAvatarView.tsx#L24), [SelfAvatarView.tsx:35](../../apps/web/src/features/game/solo/SelfAvatarView.tsx#L35), [SelfAvatarView.tsx:75](../../apps/web/src/features/game/solo/SelfAvatarView.tsx#L75), [SelfAvatarView.tsx:99](../../apps/web/src/features/game/solo/SelfAvatarView.tsx#L99), [SelfAvatarView.tsx:111](../../apps/web/src/features/game/solo/SelfAvatarView.tsx#L111), [ProductApp.tsx:1102](../../apps/web/src/app/ProductApp.tsx#L1102)

### 15.6 홈·대기실 배경

- 홈(스냅샷 없음, 혼자 연습 아님)과 대기실에서는 장식 복도를 그린다. 경기 지형이나 세션을 쓰지 않는다.
- 홈에서는 폭 3칸·길이 84칸 복도와 등 19개를 그리고, 카메라가 천천히 흔들린다.
- 대기실에서는 짧은 복도 끝에 출구 문을 세운다.
- 등은 13초 주기로 두 번 어두워진다.
- 홈 옵션의 배경 움직임을 끄거나 기기가 `prefers-reduced-motion: reduce`면 멈춘다. 멈췄거나 탭이 숨겨졌으면 `frameloop='demand'`다.
- 렌더 오류가 나면 배경만 빠진다.

근거: [LobbyBackdrop.tsx:8](../../apps/web/src/features/room/LobbyBackdrop.tsx#L8), [LobbyBackdrop.tsx:45](../../apps/web/src/features/room/LobbyBackdrop.tsx#L45), [LobbyBackdrop.tsx:100](../../apps/web/src/features/room/LobbyBackdrop.tsx#L100), [LobbyBackdrop.tsx:137](../../apps/web/src/features/room/LobbyBackdrop.tsx#L137), [LobbyBackdrop.tsx:163](../../apps/web/src/features/room/LobbyBackdrop.tsx#L163), [ProductApp.tsx:670](../../apps/web/src/app/ProductApp.tsx#L670)

## 16. 브라우저 저장소

| 키                       | 저장소           | 값                                                                                                          | 실패 시                                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kkakkung.media-consent` | `localStorage`   | `{ version, atMs, ageConfirmed: true }`                                                                     | 읽기 실패·손상·판 불일치는 동의 없음. 쓰기 실패여도 이 페이지에서는 동의가 유지되고(메모리), 다음 방문에 다시 묻는다.                                                                                                                                                        |
| `kkakkung.home-settings` | `localStorage`   | `{ quality: 'medium'\|'low', volume: 0~1, muted, backgroundMotion }`. 기본 `medium`, `0.7`, `false`, `true` | 깨진 JSON이나 읽기 실패는 전부 기본값. 항목별로 모르는 값은 기본값(품질), 음량은 0~1로 보정. 쓰기 실패는 무시(이번 세션 값만 유지).                                                                                                                                          |
| `kkakkung.scene-theme`   | `localStorage`   | `block`/`facility`                                                                                          | 읽기 실패·무효값은 `facility`. 쓰기는 `/preview` 렌더 검수에서만 하고, 실패는 무시한다.                                                                                                                                                                                      |
| `kkakkung.debug-overlay` | `localStorage`   | `'1'`(켬)/`'0'`(끔)                                                                                         | 읽기 실패는 꺼짐. 쓰기 실패는 이번 페이지에서만 토글 유지.                                                                                                                                                                                                                   |
| `kkakkung.demo-session`  | `sessionStorage` | `{ sessionToken, roomCode, playerId }`                                                                      | 접근 자체가 던지면 저장소 없음으로 본다. 저장 실패는 이번 입장만 된다. JSON 파싱이 실패하면 재입장하지 않지만 항목은 남긴다. 파싱은 됐지만 값이 잘못됐으면(`sessionToken`·`playerId` 없음, 방 코드 형식 불일치) 재입장하지 않고 지운다. 스스로 나가기·입장 거절 뒤에 지운다. |

근거: [consent.ts:10](../../apps/web/src/features/room/consent.ts#L10), [consent.ts:68](../../apps/web/src/features/room/consent.ts#L68), [consent.ts:99](../../apps/web/src/features/room/consent.ts#L99), [home-settings.ts:15](../../apps/web/src/features/room/home-settings.ts#L15), [home-settings.ts:17](../../apps/web/src/features/room/home-settings.ts#L17), [home-settings.ts:36](../../apps/web/src/features/room/home-settings.ts#L36), [home-settings.ts:48](../../apps/web/src/features/room/home-settings.ts#L48), [home-settings.ts:58](../../apps/web/src/features/room/home-settings.ts#L58), [scene-theme.ts:10](../../apps/web/src/features/game/scene/scene-theme.ts#L10), [scene-theme.ts:43](../../apps/web/src/features/game/scene/scene-theme.ts#L43), [debug-feed.ts:15](../../apps/web/src/features/debug/debug-feed.ts#L15), [debug-feed.ts:21](../../apps/web/src/features/debug/debug-feed.ts#L21), [debug-feed.ts:57](../../apps/web/src/features/debug/debug-feed.ts#L57), [product-session.ts:224](../../apps/web/src/features/room/product-session.ts#L224), [product-session.ts:227](../../apps/web/src/features/room/product-session.ts#L227), [product-session.ts:255](../../apps/web/src/features/room/product-session.ts#L255), [product-session.ts:322](../../apps/web/src/features/room/product-session.ts#L322)

## 17. 빌드, CSP와 정적 자산

| 항목                  | 값                                                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 개발 서버             | `vite --host 127.0.0.1`, 포트 `5173`, `/api` → `http://127.0.0.1:2567` 프록시(`changeOrigin`).                                                                                                                                                                                          |
| 개발 서버 WASM loader | `/models/mediapipe/1.0.1/wasm/vision_wasm_module_internal.js`를 Vite 변환 없이 `text/javascript`로 그대로 준다. 파일이 없으면 `404`.                                                                                                                                                    |
| 빌드·검사             | `vite build`, `tsc --noEmit && tsc --noEmit -p tsconfig.worker.json`.                                                                                                                                                                                                                   |
| `VITE_API_BASE_URL`   | 진단 개발 세션만 사용. 빈 값이면 `/api`, 끝의 `/` 제거. 직접 지정하면 `/api`까지 포함해야 한다.                                                                                                                                                                                         |
| `VITE_COLYSEUS_URL`   | 제품·진단 Room 연결. 빈 값이면 개발 `ws://127.0.0.1:2567`, 배포는 같은 origin. 끝의 `/` 제거는 진단 경로에서만 한다.                                                                                                                                                                    |
| CSP                   | `main.tsx`의 첫 import가 `app/schema-runtime`이고, 여기서 `useJitlessSchemas()`를 호출해 스키마 파싱이 `new Function`을 쓰지 않게 한다. 그래서 `unsafe-eval`이 필요 없다.                                                                                                               |
| 비전 모델             | Worker는 `/models/face/face_landmarker.task`, `/models/pose/pose_landmarker.task`, `/models/gesture/gesture_recognizer.task`와 `/models/mediapipe/1.0.1/wasm`만 쓴다. 모델 바이트의 SHA-256이 고정값과 다르면 `MODEL_HASH_MISMATCH`로 Worker를 닫는다. 로드 실패는 `MODEL_LOAD_FAILED`. |
| manifest              | `public/models/manifest.json`에 모델 3개와 WASM 6개 파일, 라이선스 고지 파일 3개의 sha256·크기가 기록되어 있다. 런타임에서 해시를 대조하는 것은 모델 3개뿐이다. WASM과 고지 파일은 기록만 있다.                                                                                         |
| 기타 공개 자산        | `/licenses/index.html`(옵션·입장 창의 `오픈소스 고지` 링크), `/brand/kkakkung-logo.png`(favicon), `/textures/backrooms/seamless.png`(facility 벽).                                                                                                                                      |

`VITE_*`는 공개 빌드 값이다. 실제 배포 값은 저장소 밖이라 확인할 수 없다.

근거: [package.json:7](../../apps/web/package.json#L7), [package.json:9](../../apps/web/package.json#L9), [vite.config.ts:8](../../apps/web/vite.config.ts#L8), [vite.config.ts:17](../../apps/web/vite.config.ts#L17), [vite.config.ts:36](../../apps/web/vite.config.ts#L36), [vite.config.ts:38](../../apps/web/vite.config.ts#L38), [.env.example:1](../../apps/web/.env.example#L1), [colyseus-session.ts:8](../../apps/web/src/features/room/colyseus-session.ts#L8), [product-session.ts:130](../../apps/web/src/features/room/product-session.ts#L130), [main.tsx:2](../../apps/web/src/main.tsx#L2), [schema-runtime.ts:8](../../apps/web/src/app/schema-runtime.ts#L8), [worker-protocol.ts:17](../../apps/web/src/features/vision/worker-protocol.ts#L17), [worker-protocol.ts:30](../../apps/web/src/features/vision/worker-protocol.ts#L30), [vision.worker.ts:35](../../apps/web/src/features/vision/vision.worker.ts#L35), [vision.worker.ts:158](../../apps/web/src/features/vision/vision.worker.ts#L158), [manifest.json:14](../../apps/web/public/models/manifest.json#L14), [manifest.json:161](../../apps/web/public/models/manifest.json#L161), [manifest.json:269](../../apps/web/public/models/manifest.json#L269), [index.html:7](../../apps/web/index.html#L7)

## 18. 주요 흐름

1. **진입**
   1. 사용자가 주소를 연다. `App`이 경로를 분기하고 데모·시연·초대 fragment를 소비해 지운다(2절).
   2. 홈이 접속 방식을 조회한다. 입장 패널이면 서비스 여유를 15초마다 조회한다(4.4).
2. **입장**
   1. 사용자가 닉네임과 만들기·참가를 고른다. 웹은 요청 스키마를 검사하고 세션을 발급받아 `kkakkung` Room에 들어간다(5.1).
   2. 데모·시연 세션은 폼 없이 바로 들어간다.
3. **대기실과 점검**
   1. 명부가 오면 대기실을 그린다.
   2. 자리가 다 차 `DEVICE_CHECK`가 되면 준비를 누를 수 있다.
   3. 준비는 동의 → 카메라 → 자동 보정 → 앞 기울이기·고개 돌리기 → `READY true`(필요하면 확인음 뒤 재시도) 순이다(8.2).
   4. 모두 준비하면 방장이 `ROOM_START`를 보낸다.
4. **팀 연습**: 과제를 해 보고 `PRACTICE_READY`를 보낸다(9.1).
5. **로딩**: `MAP_FINALIZING` → `GAME_LOADING` → `COUNTDOWN`을 로딩 화면이 덮는다(9.2).
6. **경기**
   1. `PLAYING`에서 입력을 명령으로 보내고, 결과·개인 뷰로 HUD와 장면을 갱신한다(10·13절).
   2. 개인이 종료되면 관전 또는 결과로 간다.
7. **결과**: `RESULT`/`ABORTED`에서 미디어를 정리하고 결과·재경기 선택을 보인다(11절). 새 `matchId`가 오면 이전 세대를 비우고 새 세대를 시작한다(5.6).
8. **끊김**: 어느 단계든 Room 이탈·오류·하트비트 6000ms 초과면 연결 끊김 화면으로 간다(5.5).

근거: [App.tsx:28](../../apps/web/src/app/App.tsx#L28), [ProductApp.tsx:216](../../apps/web/src/app/ProductApp.tsx#L216), [ProductApp.tsx:367](../../apps/web/src/app/ProductApp.tsx#L367), [ProductApp.tsx:523](../../apps/web/src/app/ProductApp.tsx#L523), [LobbyScreen.tsx:157](../../apps/web/src/features/room/LobbyScreen.tsx#L157), [product-runtime.ts:836](../../apps/web/src/app/product-runtime.ts#L836), [product-runtime.ts:1121](../../apps/web/src/app/product-runtime.ts#L1121), [product-runtime.ts:1188](../../apps/web/src/app/product-runtime.ts#L1188)

## 19. 상태 기계

| 상태 변수       | 값                                                                           | 전이와 조건                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `access`        | `checking` → `invitation`\|`gitlab-sso`\|`guest`\|`failed`                   | 마운트와 `접속 상태 다시 확인` 때 `checking`. 응답 `method`로 바뀐다. `404`는 `invitation`, 그 밖의 실패는 `failed`.                           |
| `homePanel`     | `title`/`admission`/`options`                                                | 시작 `admission`(초대·방 힌트 있음) 또는 `title`. `시작하기`→`admission`, `옵션`→`options`, `돌아가기`·Esc(옵션)→`title`, 새 초대→`admission`. |
| `joining`       | `false`/`true`                                                               | 제출 또는 데모·시연 입장 시작에 `true`. 성공·실패·세대 변경·`leave`에 `false`.                                                                 |
| `solo`          | `false`/`true`                                                               | `튜토리얼`에 `true`, 체험 종료에 `false`. `solo`이면 입장을 막는다.                                                                            |
| `snapshot`      | `null` / 값                                                                  | Room 연결 뒤 런타임 변경마다 갱신. `leave`에 `null`.                                                                                           |
| `snapshot.lost` | `false` → `true`                                                             | Room `onLeave`·`onDrop`·`onError`, 하트비트 6000ms 초과. 되돌아가지 않는다(나가서 새로 입장).                                                  |
| `deviceCheck`   | `false`/`true`                                                               | 준비 흐름 시작에 `true`. 본인 준비 상태가 되거나 `나중에 하기`에 `false`. `DEVICE_CHECK`일 때만 보인다.                                        |
| `consentAsk`    | `false`/`true`                                                               | 동의 없이 준비·카메라를 누르면 `true`. `동의합니다`·`동의하지 않기`에 `false`.                                                                 |
| `readying`      | `false`/`true`                                                               | 준비 흐름의 카메라 시작 동안 `true`. 이 동안 준비 단추가 잠긴다.                                                                               |
| `roomMenu`      | `false`/`true`                                                               | 방 안 Esc 토글, `설정` 단추에 `true`, `닫기`에 `false`. 방을 나가면 `false`.                                                                   |
| `mapZoomedOut`  | `false`/`true`                                                               | 세계 화면에서 M 토글. 세계 화면이 사라지면 `false`.                                                                                            |
| 명령 요청       | `pending` → `rejected`\|`waiting-view`\|`applied`\|`canceled`\|`unconfirmed` | 5.3. 단계가 바뀌거나 재경기면 비운다.                                                                                                          |
| 입력 모드       | `motion` ↔ `keyboard`                                                        | `키보드로 조작`이나 장치 장애로 `keyboard`. 보정 성공과 모션 선택이 모두 있으면 `motion`.                                                      |

근거: [ProductApp.tsx:146](../../apps/web/src/app/ProductApp.tsx#L146), [ProductApp.tsx:107](../../apps/web/src/app/ProductApp.tsx#L107), [ProductApp.tsx:94](../../apps/web/src/app/ProductApp.tsx#L94), [ProductApp.tsx:95](../../apps/web/src/app/ProductApp.tsx#L95), [ProductApp.tsx:261](../../apps/web/src/app/ProductApp.tsx#L261), [ProductApp.tsx:125](../../apps/web/src/app/ProductApp.tsx#L125), [ProductApp.tsx:127](../../apps/web/src/app/ProductApp.tsx#L127), [ProductApp.tsx:129](../../apps/web/src/app/ProductApp.tsx#L129), [ProductApp.tsx:131](../../apps/web/src/app/ProductApp.tsx#L131), [ProductApp.tsx:152](../../apps/web/src/app/ProductApp.tsx#L152), [ProductApp.tsx:549](../../apps/web/src/app/ProductApp.tsx#L549), [product-runtime.ts:434](../../apps/web/src/app/product-runtime.ts#L434), [command-lifecycle.ts:16](../../apps/web/src/features/room/command-lifecycle.ts#L16), [input-fallback.ts:55](../../apps/web/src/features/input/input-fallback.ts#L55)

## 20. 이 파트를 고정하는 시험

아래 시험은 기본 Vitest 설정의 `apps/**/*.test.{ts,tsx}`에 포함된다. `apps/web` 시험 파일에서 `skip`·`skipIf`·`runIf`·`todo`·`only`·`BLOCKED` 조건을 찾지 못했다. 각 행은 시험 제목이 아니라 assertion의 내용이다.

| 고정하는 동작                                                                                                          | 시험 근거                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 초대 fragment를 지우되 경로와 쿼리는 남기고, 세션 요청 본문이 만들기/참가에 따라 `roomCode`를 빼고/넣는다              | [product-session.test.ts:19](../../apps/web/src/features/room/product-session.test.ts#L19), [product-session.test.ts:32](../../apps/web/src/features/room/product-session.test.ts#L32), [product-session.test.ts:34](../../apps/web/src/features/room/product-session.test.ts#L34)                                                                                                                                     |
| 데모 fragment를 세션으로 읽고 `/play`로 지우며, 깨진 fragment는 null이고 주소를 건드리지 않는다                        | [demo-session.test.ts:16](../../apps/web/src/features/room/demo-session.test.ts#L16), [demo-session.test.ts:23](../../apps/web/src/features/room/demo-session.test.ts#L23), [demo-session.test.ts:34](../../apps/web/src/features/room/demo-session.test.ts#L34)                                                                                                                                                       |
| 모든 세션 오류 코드에 문구가 있고, `INVALID_SESSION`은 재입장, 모르는 코드는 null, 서비스 포화와 방 만원 문구가 다르다 | [session-error-labels.test.ts:10](../../apps/web/src/features/room/session-error-labels.test.ts#L10), [session-error-labels.test.ts:11](../../apps/web/src/features/room/session-error-labels.test.ts#L11), [session-error-labels.test.ts:12](../../apps/web/src/features/room/session-error-labels.test.ts#L12), [session-error-labels.test.ts:18](../../apps/web/src/features/room/session-error-labels.test.ts#L18) |
| 여유 표시가 대기방 여유 0/30을 보이고, 대기방 가득·점검 중에는 만들기를 막는다                                         | [service-capacity.test.ts:21](../../apps/web/src/features/room/service-capacity.test.ts#L21), [service-capacity.test.ts:26](../../apps/web/src/features/room/service-capacity.test.ts#L26), [service-capacity.test.ts:29](../../apps/web/src/features/room/service-capacity.test.ts#L29)                                                                                                                               |
| 비방장에게 잠금·내보내기가 없고, 처리 중에는 비활성이며, 방장에게는 보인다                                             | [lobby-screen.test.ts:36](../../apps/web/src/features/room/lobby-screen.test.ts#L36), [lobby-screen.test.ts:40](../../apps/web/src/features/room/lobby-screen.test.ts#L40), [lobby-screen.test.ts:43](../../apps/web/src/features/room/lobby-screen.test.ts#L43)                                                                                                                                                       |
| 동의 기록은 빈 값·깨진 JSON·14세 확인 없음이면 무효다                                                                  | [consent.test.ts:27](../../apps/web/src/features/room/consent.test.ts#L27), [consent.test.ts:29](../../apps/web/src/features/room/consent.test.ts#L29), [consent.test.ts:33](../../apps/web/src/features/room/consent.test.ts#L33)                                                                                                                                                                                     |
| 홈 설정은 저장값이 없거나 깨지면 기본값, 유효한 값만 보존한다                                                          | [home-settings.test.ts:23](../../apps/web/src/features/room/home-settings.test.ts#L23), [home-settings.test.ts:39](../../apps/web/src/features/room/home-settings.test.ts#L39)                                                                                                                                                                                                                                         |
| 테마 기본값 `facility`, URL이 저장값보다 우선한다                                                                      | [scene-theme.test.ts:12](../../apps/web/src/features/game/scene/scene-theme.test.ts#L12), [scene-theme.test.ts:18](../../apps/web/src/features/game/scene/scene-theme.test.ts#L18), [scene-theme.test.ts:19](../../apps/web/src/features/game/scene/scene-theme.test.ts#L19)                                                                                                                                           |
| 하트비트는 낡은 seq·epoch·match를 거부하고, 6000ms에서 한 번만 lost를 낸다                                             | [game-heartbeat.test.ts:23](../../apps/web/src/features/room/game-heartbeat.test.ts#L23), [game-heartbeat.test.ts:25](../../apps/web/src/features/room/game-heartbeat.test.ts#L25), [game-heartbeat.test.ts:29](../../apps/web/src/features/room/game-heartbeat.test.ts#L29)                                                                                                                                           |
| 시계 오프셋과 렌더 tick을 계산하고, epoch가 바뀌면 초기화한다                                                          | [clock-sync.test.ts:28](../../apps/web/src/features/room/clock-sync.test.ts#L28), [clock-sync.test.ts:36](../../apps/web/src/features/room/clock-sync.test.ts#L36), [clock-sync.test.ts:44](../../apps/web/src/features/room/clock-sync.test.ts#L44)                                                                                                                                                                   |
| 명령이 거절되면 `rejected`, 적용됐는데 상태판이 늦으면 `waiting-view`                                                  | [command-lifecycle.test.ts:29](../../apps/web/src/features/room/command-lifecycle.test.ts#L29), [command-lifecycle.test.ts:35](../../apps/web/src/features/room/command-lifecycle.test.ts#L35)                                                                                                                                                                                                                         |
| 개인 이벤트는 맞는 뷰가 올 때까지 기다리고 중복을 한 번만 적용한다                                                     | [private-events.test.ts:35](../../apps/web/src/features/room/private-events.test.ts#L35), [private-events.test.ts:39](../../apps/web/src/features/room/private-events.test.ts#L39)                                                                                                                                                                                                                                     |
| 입력 문맥은 활성일 때 입력을 받고, 경기·교환 변경이면 유지를 버린다                                                    | [interaction-context.test.ts:23](../../apps/web/src/features/input/interaction-context.test.ts#L23), [interaction-context.test.ts:33](../../apps/web/src/features/input/interaction-context.test.ts#L33), [interaction-context.test.ts:41](../../apps/web/src/features/input/interaction-context.test.ts#L41)                                                                                                          |
| E·F·G 키가 역할과 문맥에 맞는 행동을 낸다                                                                              | [gesture-intent.test.ts:234](../../apps/web/src/features/input/gesture-intent.test.ts#L234), [gesture-intent.test.ts:247](../../apps/web/src/features/input/gesture-intent.test.ts#L247), [gesture-intent.test.ts:267](../../apps/web/src/features/input/gesture-intent.test.ts#L267)                                                                                                                                  |
| 손동작은 유지 시간을 채워야 한 번 발동한다                                                                             | [gesture-intent.test.ts:99](../../apps/web/src/features/input/gesture-intent.test.ts#L99), [gesture-intent.test.ts:163](../../apps/web/src/features/input/gesture-intent.test.ts#L163)                                                                                                                                                                                                                                 |
| 회전은 유지 시간 뒤 한 번만 발동하고 잠긴다                                                                            | [turn-intent.test.ts:59](../../apps/web/src/features/input/turn-intent.test.ts#L59), [turn-intent.test.ts:62](../../apps/web/src/features/input/turn-intent.test.ts#L62), [turn-intent.test.ts:67](../../apps/web/src/features/input/turn-intent.test.ts#L67)                                                                                                                                                          |
| 전진은 180ms, 후진은 더 긴 320ms를 채워야 의도가 된다                                                                  | [move-intent.test.ts:66](../../apps/web/src/features/input/move-intent.test.ts#L66), [move-intent.test.ts:69](../../apps/web/src/features/input/move-intent.test.ts#L69), [move-intent.test.ts:77](../../apps/web/src/features/input/move-intent.test.ts#L77), [move-intent.test.ts:80](../../apps/web/src/features/input/move-intent.test.ts#L80)                                                                     |
| 카메라 종료 시 키보드로 바꾸고 장애 상태가 된다                                                                        | [input-fallback.test.ts:52](../../apps/web/src/features/input/input-fallback.test.ts#L52), [input-fallback.test.ts:61](../../apps/web/src/features/input/input-fallback.test.ts#L61)                                                                                                                                                                                                                                   |
| 방향키 도전 순서는 네 방향 회전이고, repeat은 무시하며 틀리면 0으로                                                    | [key-challenge.test.ts:7](../../apps/web/src/features/game/pose/key-challenge.test.ts#L7), [key-challenge.test.ts:10](../../apps/web/src/features/game/pose/key-challenge.test.ts#L10), [key-challenge.test.ts:12](../../apps/web/src/features/game/pose/key-challenge.test.ts#L12)                                                                                                                                    |
| 자세 판정이 맞는 자세를 통과시키고 `uncertain` 품질을 거부한다                                                         | [pose-evaluator.test.ts:14](../../apps/web/src/features/game/pose/pose-evaluator.test.ts#L14), [pose-evaluator.test.ts:18](../../apps/web/src/features/game/pose/pose-evaluator.test.ts#L18)                                                                                                                                                                                                                           |
| M 키만 토글하고 repeat·IME·수식키·입력창은 무시한다                                                                    | [minimap-zoom.test.ts:11](../../apps/web/src/features/game/map/minimap-zoom.test.ts#L11), [minimap-zoom.test.ts:13](../../apps/web/src/features/game/map/minimap-zoom.test.ts#L13), [minimap-zoom.test.ts:16](../../apps/web/src/features/game/map/minimap-zoom.test.ts#L16), [minimap-zoom.test.ts:18](../../apps/web/src/features/game/map/minimap-zoom.test.ts#L18)                                                 |
| 교환 대상은 가까운 아군을 기본으로 고르고, 적은 후보에서 뺀다                                                          | [exchange-presenter.test.ts:15](../../apps/web/src/features/game/map/exchange-presenter.test.ts#L15), [exchange-presenter.test.ts:20](../../apps/web/src/features/game/map/exchange-presenter.test.ts#L20)                                                                                                                                                                                                             |
| 설치 힌트가 통과일 때 `F`를 포함한 안내를 낸다                                                                         | [install-hint.test.ts:36](../../apps/web/src/features/game/flow/install-hint.test.ts#L36), [install-hint.test.ts:39](../../apps/web/src/features/game/flow/install-hint.test.ts#L39)                                                                                                                                                                                                                                   |
| 결과 제목·집계와 중단 사유별 문구가 서로 다르다                                                                        | [result-presenter.test.ts:14](../../apps/web/src/features/game/flow/result-presenter.test.ts#L14), [result-presenter.test.ts:23](../../apps/web/src/features/game/flow/result-presenter.test.ts#L23), [result-presenter.test.ts:24](../../apps/web/src/features/game/flow/result-presenter.test.ts#L24)                                                                                                                |
| 녹화 시간 표기 `hh:mm:ss`와 캠코더 테두리 렌더                                                                         | [camcorder-overlay.test.ts:8](../../apps/web/src/features/game/flow/camcorder-overlay.test.ts#L8), [camcorder-overlay.test.ts:23](../../apps/web/src/features/game/flow/camcorder-overlay.test.ts#L23)                                                                                                                                                                                                                 |
| `/preview` 장치 점검 단계 판정(초기·카메라·자세·전체 준비)                                                             | [device-check-steps.test.ts:23](../../apps/web/src/features/game/flow/device-check-steps.test.ts#L23), [device-check-steps.test.ts:29](../../apps/web/src/features/game/flow/device-check-steps.test.ts#L29), [device-check-steps.test.ts:31](../../apps/web/src/features/game/flow/device-check-steps.test.ts#L31)                                                                                                    |
| 시연 입장 화면에 역할 선택과 `16x16`이 있다                                                                            | [showcase-screens.test.ts:32](../../apps/web/src/app/showcase-screens.test.ts#L32), [showcase-screens.test.ts:35](../../apps/web/src/app/showcase-screens.test.ts#L35)                                                                                                                                                                                                                                                 |
| 품질 전환은 값이 바뀔 때만 적용되고 low dpr 상한 < medium dpr 상한, 배율 1 화면은 1배                                  | [quality-presets.test.ts:9](../../apps/web/src/features/game/scene/quality-presets.test.ts#L9), [quality-presets.test.ts:10](../../apps/web/src/features/game/scene/quality-presets.test.ts#L10)                                                                                                                                                                                                                       |
| 역할 색이 밝기 하한과 색상 분리를 지킨다                                                                               | [role-colors.test.ts:6](../../apps/web/src/features/game/scene/role-colors.test.ts#L6), [role-colors.test.ts:17](../../apps/web/src/features/game/scene/role-colors.test.ts#L17)                                                                                                                                                                                                                                       |
| 카메라 눈이 회전 중 벽 평면 뒤로 가지 않고 눈높이를 따른다                                                             | [first-person-camera.test.ts:34](../../apps/web/src/features/game/scene/first-person-camera.test.ts#L34), [first-person-camera.test.ts:40](../../apps/web/src/features/game/scene/first-person-camera.test.ts#L40)                                                                                                                                                                                                     |
| 얼굴 텍스처는 보이는 개체에만 만들고, 새 게시를 낡은 제거가 지우지 않는다                                              | [face-textures.test.ts:20](../../apps/web/src/features/game/scene/face-textures.test.ts#L20), [face-textures.test.ts:40](../../apps/web/src/features/game/scene/face-textures.test.ts#L40)                                                                                                                                                                                                                             |
| 혼자 연습 맵은 15칸이고, 키보드로 움직이며, 종료 시 리스너를 지우고 LiveKit을 로드하지 않는다                          | [solo-world.test.ts:12](../../apps/web/src/features/game/solo/solo-world.test.ts#L12), [solo-session.test.ts:82](../../apps/web/src/features/game/solo/solo-session.test.ts#L82), [solo-session.test.ts:100](../../apps/web/src/features/game/solo/solo-session.test.ts#L100), [solo-session.test.ts:102](../../apps/web/src/features/game/solo/solo-session.test.ts#L102)                                             |
| 고정 모델 해시가 manifest와 같고, 변조 바이트를 거부한다                                                               | [worker-protocol.test.ts:19](../../apps/web/src/features/vision/worker-protocol.test.ts#L19), [worker-protocol.test.ts:57](../../apps/web/src/features/vision/worker-protocol.test.ts#L57), [worker-protocol.test.ts:75](../../apps/web/src/features/vision/worker-protocol.test.ts#L75)                                                                                                                               |

기본 실행에서 건너뛰는 시험:

| 대상                       | 조건                                                    |
| -------------------------- | ------------------------------------------------------- |
| `**/*.cloud.test.{ts,tsx}` | 기본 설정의 `exclude`. `apps/web`에는 해당 파일이 없다. |

위 표는 로컬 자동 시험이 고정하는 동작이다. 실제 카메라·마이크, 원격 미디어, 배포 브라우저 검증을 대신하지 않는다. ProductApp 전체 화면 전환(6절)과 ReadyCheck 흐름(8.2)을 직접 렌더해 고정하는 시험은 이 목록에서 찾지 못했다.

근거: [vitest.config.ts:10](../../vitest.config.ts#L10), [vitest.config.ts:15](../../vitest.config.ts#L15)

## 21. 확인된 한계와 코드 쪽 발견

**동작 한계**

- 방 안 Esc: 출구 도전 중 Esc를 누르면 `EXIT_CANCEL`과 설정 창 토글이 동시에 일어난다. ProductApp의 Esc 리스너는 도전 여부를 보지 않는다(혼자 연습은 도전 중 토글을 건너뛴다). 입력창 안에서도 방 안 Esc는 설정 창을 연다.
- 설정 창 `방 나가기`는 `leaveByChoice`가 아니라 `leave()`를 부른다. 그래서 데모 세션을 지우지 않고(새로고침하면 다시 들어감), 시연 세션도 `/showcase`로 보내지 않고 제품 홈에 떨어뜨린다. 머리말·대기실 `나가기`와 동작이 다르다.
- `SettingsWindow`는 `lead.disabled`와 `lead.danger`를 읽지 않는다. 입장 창의 `돌아가기`(`disabled: joining`)는 입장 중에도 눌린다.
- 모션 모드에서는 W/S/A/D·방향키가 이동을 만들지 않는다. 카메라 추적이 살아 있는데 키로 움직이려면 `키보드로 조작`을 먼저 눌러야 한다. 키보드 악용을 막기 위한 의도된 동작이다([결정 정정표](../spec/decisions.md), 2026-09-24).
- 공개 `albedo.png`·`roughness.png`·`normal.png`는 어떤 코드 경로도 읽지 않는다.
- 품질 프리셋의 `antialias`·`postprocessing` 필드는 읽히지 않는다.
- 미니맵 전체 지도는 `32`칸 고정이다. 작은 맵(격자 15·23)에서는 지도 일부만 쓴다.
- manifest의 `bundledNoticesReview`는 `pending`이고, gesture 모델 `license`도 `pending`이다.
- 데모 세션이 `sessionStorage`에 남아 있으면, 개발 빌드 루트(`/`, hash 없음)에서 진단 화면이 떠 저장된 세션은 쓰이지 않는다.
- `?metrics=1` 계측과 `/preview` 합성 화면은 opt-in 검수 경로다. 카메라·LiveKit·실경기 성능의 통과 증거가 아니다.
- 저장소 밖 — 확인 불가: 실제 SSO 경계, 운영 `VITE_*`·서버 환경 값, LiveKit Cloud 설정과 사용량, 실장치 결과.

**코드와 주석의 불일치(코드 쪽 발견)**

- `turn-intent.ts` 머리 주석은 "서버 6 Tick 행동"이라 하지만 `PRODUCT_ACTION_TICKS.turn`은 `8`이다.
- `PlayerTileView.tsx` 머리 주석은 `frameloop="demand"`라고 한다. Canvas가 얼굴이 있을 때만 그려지므로 실제로는 언제나 `'always'`다.
- `block-theme.ts`의 이끼 벽 주석은 "Every third wall face"이지만 식은 `% 5`다.
- `session-error-labels.ts`의 `INVALID_SESSION` 주석은 "클라이언트가 스스로 내는 코드"라고 하지만, 웹 코드 어디도 이 값을 던지지 않는다. Room 입장 오류 메시지가 이 값과 같을 때만 쓰인다.
- `SettingsPanes.tsx` 머리 주석은 "게임 안에서 바꾼 값도 즉시 저장"이라 하지만 제품 방의 소리·화면 변경은 저장되지 않는다(혼자 연습만 저장).
- `index.html`의 제목과 설명이 제품 빌드에서도 `KKAKKUNG 연동 시험장`/`KKAKKUNG 공개 연동 시험장`이다.

근거: [WorldCanvas.tsx:29](../../apps/web/src/features/game/scene/WorldCanvas.tsx#L29), [WorldCanvas.tsx:87](../../apps/web/src/features/game/scene/WorldCanvas.tsx#L87), [visibility.ts:33](../../packages/game-core/src/match/vision/visibility.ts#L33), [block-theme.ts:37](../../apps/web/src/features/game/scene/block-theme.ts#L37), [minimap-render.ts:46](../../apps/web/src/features/game/map/minimap-render.ts#L46), [ProductApp.tsx:585](../../apps/web/src/app/ProductApp.tsx#L585), [InteractionRuntime.ts:1373](../../apps/web/src/features/input/InteractionRuntime.ts#L1373), [SoloPracticeScreen.tsx:96](../../apps/web/src/features/game/solo/SoloPracticeScreen.tsx#L96), [ProductApp.tsx:1291](../../apps/web/src/app/ProductApp.tsx#L1291), [ProductApp.tsx:757](../../apps/web/src/app/ProductApp.tsx#L757), [SettingsWindow.tsx:63](../../apps/web/src/features/game/flow/SettingsWindow.tsx#L63), [move-intent.ts:352](../../apps/web/src/features/input/move-intent.ts#L352), [backrooms-textures.ts:27](../../apps/web/src/features/game/scene/backrooms-textures.ts#L27), [quality-presets.ts:10](../../apps/web/src/features/game/scene/quality-presets.ts#L10), [minimap-render.ts:9](../../apps/web/src/features/game/map/minimap-render.ts#L9), [manifest.json:56](../../apps/web/public/models/manifest.json#L56), [manifest.json:231](../../apps/web/public/models/manifest.json#L231), [App.tsx:17](../../apps/web/src/app/App.tsx#L17), [turn-intent.ts:3](../../apps/web/src/features/input/turn-intent.ts#L3), [product.ts:54](../../packages/protocol/src/game-schema/product.ts#L54), [PlayerTileView.tsx:3](../../apps/web/src/features/room/PlayerTileView.tsx#L3), [PlayerTileView.tsx:92](../../apps/web/src/features/room/PlayerTileView.tsx#L92), [block-theme.ts:173](../../apps/web/src/features/game/scene/block-theme.ts#L173), [session-error-labels.ts:20](../../apps/web/src/features/room/session-error-labels.ts#L20), [SettingsPanes.tsx:2](../../apps/web/src/features/game/flow/SettingsPanes.tsx#L2), [index.html:8](../../apps/web/index.html#L8)

## 22. 다룬 파일과 미설명 파일

`git ls-files apps/web` 기준이다. `apps/web/src/features/media/**`는 [media.md](media.md) 소유라 이 목록에서 뺀다. `.md` 파일(`public/models/README.md`, `features/debug/README.md`)은 근거가 아니라 다루지 않는다.

**다룬 파일(본문에서 동작을 설명함)**

- 설정·루트: `.env.example`, `index.html`, `package.json`, `vite.config.ts`, `src/main.tsx`
- 공개 자산: `public/models/manifest.json`, `public/models/face/face_landmarker.task`, `public/models/pose/pose_landmarker.task`, `public/models/gesture/gesture_recognizer.task`, `public/models/mediapipe/1.0.1/wasm/vision_wasm_internal.js`, `vision_wasm_internal.wasm`, `vision_wasm_module_internal.js`, `vision_wasm_module_internal.wasm`, `vision_wasm_nosimd_internal.js`, `vision_wasm_nosimd_internal.wasm`, `public/textures/backrooms/seamless.png`, `albedo.png`, `normal.png`, `roughness.png`, `public/licenses/index.html`, `public/brand/kkakkung-logo.png`
- `src/app`: `App.tsx`, `DemoAdminApp.tsx`, `DevelopmentApp.tsx`, `PreviewApp.tsx`, `ProductApp.tsx`, `RenderPreview.tsx`, `SessionRuntime.ts`, `ShowcaseApp.tsx`, `interaction-bridge.ts`, `product-runtime.ts`, `runtime-metrics.ts`, `schema-runtime.ts`, `showcase-screens.test.ts`
- `features/debug`: `debug-feed.ts`
- `features/game/equipment`: `EquipmentHud.tsx`, `equipment-presenter.ts`, `restraint-presenter.ts`
- `features/game/flow`: `AudioControls.tsx`, `CamcorderOverlay.tsx`, `ConnectionLostScreen.tsx`, `CueFlash.tsx`, `DemoPanel.tsx`, `DeviceCheckScreen.tsx`, `FaceGuidanceNotice.tsx`, `GameHud.tsx`, `Hotbar.tsx`, `LoadingOverlay.tsx`, `LocalControls.tsx`, `PracticeQuests.tsx`, `ResultScreen.tsx`, `SelfCorner.tsx`, `SettingsPanes.tsx`, `SettingsWindow.tsx`, `SpectatorBar.tsx`, `camera-action.ts`, `command-feedback.ts`, `device-check-steps.ts`, `device-readiness.ts`, `event-log.ts`, `hotbar-model.ts`, `install-hint.ts`, `interact-prompt.ts`, `loading-progress.ts`, `match-cues.ts`(플래시·지연 상수만), `motion-check.ts`, `practice-lessons.ts`, `preparation-feedback.ts`, `result-presenter.ts`, 시험 `camcorder-overlay.test.ts`, `device-check-steps.test.ts`, `install-hint.test.ts`, `result-presenter.test.ts`
- `features/game/map`: `ExchangePanel.tsx`, `MiniMap.tsx`, `exchange-presenter.ts`, `map-draw-model.ts`, `minimap-render.ts`, `minimap-zoom.ts`, `past-event-markers.ts`, 시험 `exchange-presenter.test.ts`, `minimap-zoom.test.ts`
- `features/game/pose`: `KeyChallenge.tsx`, `PoseChallenge.tsx`, `challenge-controller.ts`, `key-challenge.ts`, `pose-evaluator.ts`, 시험 `key-challenge.test.ts`, `pose-evaluator.test.ts`
- `features/game/scene`: `FaceAvatar.tsx`, `FirstPersonCamera.tsx`, `VisibleTerrain.tsx`, `WorldCanvas.tsx`, `backrooms-textures.ts`, `block-theme.ts`, `facility-theme.ts`, `primitives.tsx`(텍스처 로드), `quality-presets.ts`, `role-colors.ts`, `scene-model.ts`, `scene-theme.ts`, 시험 `face-textures.test.ts`, `first-person-camera.test.ts`, `quality-presets.test.ts`, `role-colors.test.ts`, `scene-theme.test.ts`
- `features/game/solo`: `SelfAvatarView.tsx`, `SoloPracticeScreen.tsx`, `solo-session.ts`, `solo-world.ts`, 시험 `solo-session.test.ts`, `solo-world.test.ts`
- `features/input`: `InteractionRuntime.ts`(키·명령 연결), `gesture-intent.ts`, `input-fallback.ts`, `input-tuning.ts`, `interaction-context.ts`, `move-intent.ts`, `movement-controller.ts`, `turn-intent.ts`, 시험 `gesture-intent.test.ts`, `input-fallback.test.ts`, `interaction-context.test.ts`, `move-intent.test.ts`, `turn-intent.test.ts`
- `features/room`: `ConsentGate.tsx`, `LobbyBackdrop.tsx`, `LobbyScreen.tsx`, `PlayerTileView.tsx`, `ReadyCheck.tsx`, `RoomInvitationControls.tsx`, `clock-sync.ts`, `colyseus-session.ts`, `command-lifecycle.ts`, `consent.ts`, `game-heartbeat.ts`, `home-settings.ts`, `map-size.ts`, `privacy-notice.ts`, `private-events.ts`, `product-session.ts`, `service-capacity.ts`, `session-error-labels.ts`, `use-media-consent.ts`, 시험 `clock-sync.test.ts`, `command-lifecycle.test.ts`, `consent.test.ts`, `demo-session.test.ts`, `game-heartbeat.test.ts`, `home-settings.test.ts`, `lobby-screen.test.ts`, `private-events.test.ts`, `product-session.test.ts`, `service-capacity.test.ts`, `session-error-labels.test.ts`
- `features/vision`: `vision.worker.ts`(모델 해시 경로), `worker-protocol.ts`, 시험 `worker-protocol.test.ts`

**미설명(목록에만 있고 본문에서 동작을 설명하지 않음)**

- 공개 자산: `public/fonts/Galmuri11-Bold.woff2`, `Galmuri11.woff2`, `Galmuri14.woff2`, `Galmuri9.woff2`, `NanumMyeongjo-korean-400.woff2`, `NanumMyeongjo-latin-400.woff2`, `OFL-1.1.txt`, `public/licenses/Apache-2.0.txt`, `public/licenses/notices.css`
- 기타: `src/styles.css`, `test-fixtures/room-invitation.html`, `tsconfig.json`, `tsconfig.worker.json`
- `src/app`: `BrandLogo.tsx`, `HudPreview.tsx`, `WorkflowPreview.tsx`, `product-integration-fixture.ts`, 시험 `SessionRuntime.test.ts`, `brand-logo.test.ts`, `demo-admin-app.test.tsx`, `design-foundation.test.ts`, `interaction-bridge.test.ts`, `product-runtime.test.ts`, `runtime-metrics.test.ts`
- `features/debug`: `DebugOverlay.tsx`, `draw-debug.ts`, `debug-overlay.test.ts`
- `features/devices`: `device-manager.ts`, `device-status.ts`, `readiness-trace.ts`, 시험 `device-manager.test.ts`, `readiness-trace.test.ts`
- `features/game/equipment`: `RestraintHud.tsx`, 시험 `equipment-hud.test.ts`, `equipment-presenter.test.ts`, `hud-colors.test.ts`, `restraint-hud.test.ts`, `restraint-presenter.test.ts`
- `features/game/flow`: `EventLog.tsx`, `PracticeScreen.tsx`, `QualityControl.tsx`(품질 선택만 언급), `RoughDefs.tsx`, `TaggerVeins.tsx`(사용 조건만 언급), `demo-scenario-guide.ts`, `device-feedback.ts`, `loading-controller.ts`, `practice-presenter.ts`, 시험 `cue-flash.test.ts`, `demo-panel.test.ts`, `device-check-carousel.test.ts`, `device-readiness.test.ts`, `face-guidance-notice.test.ts`, `feedback.test.ts`, `game-hud.test.ts`, `hotbar-model.test.ts`, `loading-controller.test.ts`, `loading-progress.test.ts`, `match-cues.test.ts`, `motion-check.test.ts`, `practice-controls.test.ts`, `practice-presenter.test.ts`, `result-screen.test.ts`, `spectator-bar.test.ts`
- `features/game/map`: 시험 `map-draw-model.test.ts`, `minimap-caption.test.ts`, `minimap-render.test.ts`, `past-event-markers.test.ts`
- `features/game/pose`: `pose-fixture.ts`, 시험 `challenge-controller.test.ts`, `pose-challenge.test.ts`
- `features/game/scene`: `BlockLighting.tsx`, `EquipmentObjects.tsx`, `ExitOwnerLabel.tsx`, `FacilityLighting.tsx`, `FrameMetrics.tsx`, `GrabHand.tsx`(사용 조건만 언급), `HeldTool.tsx`(사용 조건만 언급), `VisibleExits.tsx`, `action-interpolation.ts`, `demo-face.ts`, `equipment-model.ts`, `face-textures.ts`, `grab-hand.ts`, `held-tool.ts`, `render-fixture.ts`, `visibility-mask.ts`, `visible-exit-model.ts`, `walk-pose.ts`, 시험 `action-interpolation.test.ts`, `backrooms-textures.test.ts`, `block-theme.test.ts`, `demo-face.test.ts`, `equipment-model.test.ts`, `facility-lighting.test.ts`, `facility-rendering.test.ts`, `grab-hand.test.ts`, `held-tool.test.ts`, `scene-model.test.ts`, `visibility-mask.test.ts`, `visible-exit-model.test.ts`, `walk-pose.test.ts`
- `features/game/solo`: `DevicePane.tsx`, `MotionGauges.tsx`, `SoloPracticeHud.tsx`, `StaticNoise.tsx`, 시험 `solo-practice-hud.test.ts`
- `features/input`: `calibration.ts`, `lean-signal.ts`, `motion-debug.ts`, `motion-sample-filter.ts`, `one-euro-filter.ts`, `team-controller.ts`, 시험 `InteractionRuntime.test.ts`, `calibration.test.ts`, `device-recovery.test.ts`, `lean-signal.test.ts`, `motion-sample-filter.test.ts`, `movement-controller.test.ts`, `one-euro-filter.test.ts`, `team-controller.test.ts`
- `features/room`: `MapSizeChoice.tsx`, `consent-fixture.ts`, `product-fixture.ts`, `product-view.ts`, `snapshot.ts`, `store.ts`, `team-snapshot.ts`, 시험 `consent-bypass.test.ts`, `consent-gate.test.ts`, `map-size-choice.test.ts`, `product-view.test.ts`, `snapshot.test.ts`
- `features/vision`: `face-sensor.ts`, `frame-pump.ts`, `gesture-sensor.ts`, `pose-sensor.ts`, `sensor-types.ts`, `worker-scheduler.ts`, 시험 `face-sensor.test.ts`, `frame-pump.test.ts`, `gesture-sensor.test.ts`, `pose-sensor.test.ts`, `worker-scheduler.test.ts`

얼굴 경로(`devices`, `vision`의 센서)는 [media.md](media.md)가 함께 다룬다. 위의 미설명 파일은 이 문서가 다뤘다고 집계하지 않는다.

근거: 기준 커밋의 `git ls-files apps/web` 결과.
