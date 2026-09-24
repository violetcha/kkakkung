> 기준: origin/develop 200d186273d7 (2026-09-24). 이 커밋 이후의 변경은 반영하지 않았다.

# protocol 구현 명세

## 1. 역할과 경계

`@kkakkung/protocol`은 웹과 서버가 함께 쓰는 전송 계약이다. zod 스키마로 Colyseus 메시지와 HTTP 본문의 형상을 검사하고, `@colyseus/schema`로 공개 방 상태를 정의한다. 규칙 판정·맵·튜닝·비밀은 담지 않는다. 런타임 의존성은 `@colyseus/schema` 5.0.27과 `zod` 4.5.4 두 개뿐이고, 소스의 다른 import는 패키지 안 상대 경로다. 빌드는 `tsc -b`, 타입 검사는 `tsc --noEmit`이며 `src/**/*.ts`만 `dist`로 컴파일하고 `src/**/*.test.ts`는 제외한다. 패키지 자체 시험은 `packages/protocol/test`에 있다.

근거: [package.json:36](../../packages/protocol/package.json#L36), [package.json:38](../../packages/protocol/package.json#L38), [package.json:41](../../packages/protocol/package.json#L41), [package.json:42](../../packages/protocol/package.json#L42), [tsconfig.json:11](../../packages/protocol/tsconfig.json#L11), [tsconfig.json:12](../../packages/protocol/tsconfig.json#L12).

import 경계는 ESLint가 아니라 `scripts/check-boundaries.mjs`가 강제한다. `packages/protocol`은 다른 작업 영역(`apps/web`, `server`, `packages/game-core`)을 import할 수 없고, 브라우저 경계라서 `node:` 모듈도 import할 수 없다. `apps/web`은 이 패키지만, `server`는 이 패키지와 `game-core`를 import할 수 있다. ESLint에는 이 패키지 전용 규칙이 없다.

근거: [check-boundaries.mjs:8](../../scripts/check-boundaries.mjs#L8), [check-boundaries.mjs:9](../../scripts/check-boundaries.mjs#L9), [check-boundaries.mjs:10](../../scripts/check-boundaries.mjs#L10), [check-boundaries.mjs:32](../../scripts/check-boundaries.mjs#L32), [check-boundaries.mjs:36](../../scripts/check-boundaries.mjs#L36).

| 상대             | 이 패키지가 주는 것                                                                                                                                                        | 상대가 실제로 쓰는 지점                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| server (Room)    | 메시지 이름, 명령 envelope, 수신 스키마(`productJoinOptionsSchema`, `requestStatusSchema`, `demoScenarioRequestSchema`, `demoControlSchema`), 공개 상태 `PublicMatchState` | `KkakkungRoom`의 `onAuth`·`onMessage` 등록과 송신                                                                                                |
| server (game)    | `commandEnvelopeSchema`, `isPhaseCommand`, 바이트 상한, 결과 형상, heartbeat·clock·resync 스키마와 상수                                                                    | `CommandAdapter`, `MatchDriver`, `CommandQueue`, `EventDispatcher`, `Heartbeat`, `ClockSync`                                                     |
| server (session) | HTTP 경로 상수, 요청 스키마, 오류 코드 타입                                                                                                                                | `SessionRoutes`, `DemoRoutes`, `ShowcaseRoutes`, `CapacityRoutes`                                                                                |
| server (media)   | 미디어 경로 상수, grant 요청·상태 보고 스키마                                                                                                                              | `bootstrap.ts`의 미디어 HTTP 경로                                                                                                                |
| web              | 응답·수신 스키마, `readPublicRoundState`, `restorePrivateView`, 코드 목록, 상수                                                                                            | `product-runtime.ts`, `product-session.ts`, `product-view.ts`, `private-events.ts`, `command-lifecycle.ts`, `game-heartbeat.ts`, `clock-sync.ts` |

근거: [KkakkungRoom.ts:596](../../server/src/rooms/KkakkungRoom.ts#L596), [KkakkungRoom.ts:644](../../server/src/rooms/KkakkungRoom.ts#L644), [CommandAdapter.ts:38](../../server/src/game/CommandAdapter.ts#L38), [MatchDriver.ts:212](../../server/src/game/MatchDriver.ts#L212), [EventDispatcher.ts:196](../../server/src/game/EventDispatcher.ts#L196), [Heartbeat.ts:105](../../server/src/game/Heartbeat.ts#L105), [ClockSync.ts:29](../../server/src/game/ClockSync.ts#L29), [SessionRoutes.ts:176](../../server/src/session/SessionRoutes.ts#L176), [bootstrap.ts:520](../../server/src/bootstrap.ts#L520), [product-runtime.ts:1115](../../apps/web/src/app/product-runtime.ts#L1115), [product-view.ts:119](../../apps/web/src/features/room/product-view.ts#L119), [private-events.ts:85](../../apps/web/src/features/room/private-events.ts#L85), [command-lifecycle.ts:95](../../apps/web/src/features/room/command-lifecycle.ts#L95).

서버가 이 계약을 어떤 단계에서 어떻게 집행하는지(입장 거절 전체, 방 생명주기, 한도)는 [server.md](server.md)가, 미디어 발급·음성 정책 계산은 [media.md](media.md)가, 화면이 코드를 어떤 문구로 보여 주는지는 [web.md](web.md)가 소유한다. 이 문서는 형상·값·코드 집합과 그 값이 어디서 만들어지고 읽히는지를 소유한다.

## 2. 진입점, 버전, 방 이름

패키지 루트 진입점(`.`)은 없다. 공개 진입점은 여섯 개이고, 각 진입점은 `dist`의 같은 이름 파일을 가리킨다.

| 진입점                              | 계약                     | 내용                                                                                        |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `@kkakkung/protocol/game-messages`  | 제품 0.2 **와** 개발 0.1 | 제품 zod 메시지 전부 + 0.1 팀 회귀 방의 `teamMoveSchema`·`teamTurnSchema`·`teamReadySchema` |
| `@kkakkung/protocol/game-schema`    | 제품 0.2 **와** 개발 0.1 | 제품 `PublicMatchState`와 타입 + 0.1 `Player`·`Exit`·`GameState`                            |
| `@kkakkung/protocol/messages`       | 진단 0.1                 | sandbox·dev 세션·0.1 join 스키마                                                            |
| `@kkakkung/protocol/schema`         | 진단 0.1                 | `SandboxState`, `PlayerState`                                                               |
| `@kkakkung/protocol/version`        | 둘 다                    | 버전 문자열과 방 이름                                                                       |
| `@kkakkung/protocol/schema-runtime` | 공통                     | zod JIT 끄기 스위치                                                                         |

근거: [package.json:9](../../packages/protocol/package.json#L9), [package.json:10](../../packages/protocol/package.json#L10), [package.json:14](../../packages/protocol/package.json#L14), [package.json:18](../../packages/protocol/package.json#L18), [package.json:22](../../packages/protocol/package.json#L22), [package.json:26](../../packages/protocol/package.json#L26), [package.json:30](../../packages/protocol/package.json#L30), [game-messages/index.ts:3](../../packages/protocol/src/game-messages/index.ts#L3), [game-messages/index.ts:16](../../packages/protocol/src/game-messages/index.ts#L16), [game-schema/index.ts:3](../../packages/protocol/src/game-schema/index.ts#L3), [game-schema/index.ts:39](../../packages/protocol/src/game-schema/index.ts#L39).

`game-messages`와 `game-schema` 두 barrel은 제품 0.2 모듈을 `export *`로 다시 내보낸 뒤, 같은 파일 아래쪽에 0.1 개발 방 계약을 함께 선언한다. 그래서 두 진입점 하나만 import해도 제품 계약과 0.1 계약이 같은 이름공간에 들어온다. 서버의 `rooms/schema/GameState.ts`는 `game-schema` 전체를 다시 내보내며, 0.1 개발 방은 그 파일에서 `GameState`·`Player`·`Exit`를 가져온다. 0.1 계약의 내용은 [18절](#18-개발-01-계약과-진단-sandbox-계약)에만 적는다.

근거: [game-messages/index.ts:3](../../packages/protocol/src/game-messages/index.ts#L3), [game-messages/index.ts:8](../../packages/protocol/src/game-messages/index.ts#L8), [game-schema/index.ts:3](../../packages/protocol/src/game-schema/index.ts#L3), [GameState.ts:1](../../server/src/rooms/schema/GameState.ts#L1), [DevKkakkungRoom.ts:15](../../server/src/rooms/DevKkakkungRoom.ts#L15), [DevKkakkungRoom.ts:29](../../server/src/rooms/DevKkakkungRoom.ts#L29), [DevKkakkungRoom.ts:74](../../server/src/rooms/DevKkakkungRoom.ts#L74), [DevKkakkungRoom.ts:87](../../server/src/rooms/DevKkakkungRoom.ts#L87).

| 상수                       | 값           | 쓰이는 곳                                                                                                        |
| -------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `PRODUCT_PROTOCOL_VERSION` | `'0.2.0'`    | 제품 join option 비교, 세션·데모·시연 응답의 `protocolVersion` 리터럴, `PublicMatchState.protocolVersion` 기본값 |
| `PRODUCT_ROOM_NAME`        | `'kkakkung'` | 서버의 제품 Room 등록 이름                                                                                       |
| `PROTOCOL_VERSION`         | `'0.1.0'`    | 진단 sandbox와 0.1 개발 방 join 비교, `SandboxState.protocolVersion` 기본값                                      |
| `ROOM_NAME`                | `'sandbox'`  | 진단 sandbox Room 등록 이름                                                                                      |

근거: [version.ts:2](../../packages/protocol/src/version.ts#L2), [version.ts:3](../../packages/protocol/src/version.ts#L3), [version.ts:6](../../packages/protocol/src/version.ts#L6), [version.ts:7](../../packages/protocol/src/version.ts#L7), [KkakkungRoom.ts:598](../../server/src/rooms/KkakkungRoom.ts#L598), [bootstrap.ts:563](../../server/src/bootstrap.ts#L563), [bootstrap.ts:611](../../server/src/bootstrap.ts#L611).

패키지 매니페스트의 `version`은 `0.1.0`이며, 이것은 npm 패키지 버전이지 전송 계약 버전이 아니다. 제품 계약 버전은 위 `PRODUCT_PROTOCOL_VERSION`이다.

근거: [package.json:3](../../packages/protocol/package.json#L3).

## 3. 공통 값 제약

여러 메시지에서 되풀이되는 zod 제약이다. 아래 표의 이름은 이후 표에서 그대로 쓴다. 제품 zod 객체는 모두 `z.strictObject`라서 선언하지 않은 키가 하나라도 있으면 거절된다.

| 이름                                 | 제약                                                        | 선언 위치                       |
| ------------------------------------ | ----------------------------------------------------------- | ------------------------------- |
| `matchId`                            | 문자열 1~64자                                               | `matchIdSchema`                 |
| `requestId`                          | UUID 문자열 (`z.uuid()`)                                    | `requestIdSchema`               |
| `sequence` · `tick` · `stateVersion` | 0 이상 안전 정수                                            | 각 스키마                       |
| 명령의 `playerId`                    | 문자열 1~64자                                               | 명령 파일 내부 `playerIdSchema` |
| 명령의 불투명 ID                     | 문자열 1~128자                                              | 명령 파일 내부 `opaqueIdSchema` |
| 이벤트·뷰·미디어의 ID                | 문자열 1~128자                                              | 각 파일 내부 `idSchema`         |
| `Cell`                               | `{ x, y }`, 각각 정수 0~31                                  | 이벤트·뷰                       |
| `Dir`                                | 리터럴 `0` \| `1` \| `2` \| `3`                             | 이벤트·뷰                       |
| `WallFace`                           | `Cell` + `side: Dir`                                        | 이벤트·뷰                       |
| `TracePoint`                         | `{ x, y }`, 각각 유한 실수 0~31(반 칸 허용)                 | `HUNTER_MARKER`                 |
| `nickname`                           | 문자열 1~20자                                               | 세션·데모·시연 요청             |
| `inviteToken`                        | 문자열 16~512자                                             | 세션 요청·초대 응답             |
| `roomCode`                           | 정규식 `^[A-HJ-NP-Z2-9]{6}$` (I·O·0·1 제외 대문자·숫자 6자) | `ROOM_CODE_PATTERN`             |

근거: [product.ts:60](../../packages/protocol/src/game-messages/product.ts#L60), [product.ts:61](../../packages/protocol/src/game-messages/product.ts#L61), [product.ts:62](../../packages/protocol/src/game-messages/product.ts#L62), [product.ts:63](../../packages/protocol/src/game-messages/product.ts#L63), [product.ts:64](../../packages/protocol/src/game-messages/product.ts#L64), [product.ts:65](../../packages/protocol/src/game-messages/product.ts#L65), [product.ts:66](../../packages/protocol/src/game-messages/product.ts#L66), [events.ts:9](../../packages/protocol/src/game-messages/events.ts#L9), [events.ts:10](../../packages/protocol/src/game-messages/events.ts#L10), [events.ts:14](../../packages/protocol/src/game-messages/events.ts#L14), [events.ts:16](../../packages/protocol/src/game-messages/events.ts#L16), [events.ts:20](../../packages/protocol/src/game-messages/events.ts#L20), [media.ts:7](../../packages/protocol/src/game-messages/media.ts#L7), [session.ts:41](../../packages/protocol/src/game-messages/session.ts#L41), [session.ts:43](../../packages/protocol/src/game-messages/session.ts#L43), [session.ts:44](../../packages/protocol/src/game-messages/session.ts#L44).

## 4. Colyseus 메시지 이름

### 클라이언트 → 서버

| 상수 키                | 메시지 이름              | payload 스키마                                                     | 서버 처리                                                                              |
| ---------------------- | ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `command`              | `command`                | `commandEnvelopeSchema` ([5절](#5-명령-envelope과-명령-종류))      | 바이트 상한·스키마·`matchId` 검사 후 큐 접수, `command-result`로 영수증                |
| `requestStatus`        | `request-status`         | `requestStatusSchema` = `{ matchId, requestId }`                   | 형상이 틀리면 무응답, 맞으면 `request-status-result`                                   |
| `viewResync`           | `view-resync`            | `viewResyncSchema` = `{ matchId, lastStateVersion: stateVersion }` | 현재 `matchId`만, 수신자당 초당 1회(`VIEW_RESYNC_LIMIT_PER_SECOND` = 1) 전체 뷰 재전송 |
| `heartbeatAck`         | `game-heartbeat-ack`     | `heartbeatAckSchema` ([13절](#13-heartbeat와-시계-탐침))           | 보낸 적 있고 아직 확인하지 않은 순번만 인정                                            |
| `clockProbe`           | `clock-probe`            | `clockProbeSchema`                                                 | 연결당 초당 5회(`CLOCK_PROBE_LIMIT_PER_SECOND`)까지 `clock-reply`                      |
| `mediaBindingsRefresh` | `media-bindings-refresh` | 서버는 payload를 읽지 않는다                                       | 참가자당 1000ms에 1회, 마지막으로 보낸 `media-bindings`를 다시 보냄                    |
| `demoScenario`         | `demo-scenario`          | `demoScenarioRequestSchema` ([16절](#16-데모-방-메시지))           | 데모 방의 운영자만, 그 외에는 무시                                                     |
| `demoControl`          | `demo-control`           | `demoControlSchema`                                                | 데모 방의 운영자만, 그 외에는 무시                                                     |

근거: [product.ts:11](../../packages/protocol/src/game-messages/product.ts#L11), [product.ts:153](../../packages/protocol/src/game-messages/product.ts#L153), [events.ts:7](../../packages/protocol/src/game-messages/events.ts#L7), [events.ts:95](../../packages/protocol/src/game-messages/events.ts#L95), [heartbeat.ts:9](../../packages/protocol/src/game-messages/heartbeat.ts#L9), [KkakkungRoom.ts:644](../../server/src/rooms/KkakkungRoom.ts#L644), [KkakkungRoom.ts:647](../../server/src/rooms/KkakkungRoom.ts#L647), [KkakkungRoom.ts:650](../../server/src/rooms/KkakkungRoom.ts#L650), [KkakkungRoom.ts:654](../../server/src/rooms/KkakkungRoom.ts#L654), [KkakkungRoom.ts:660](../../server/src/rooms/KkakkungRoom.ts#L660), [KkakkungRoom.ts:667](../../server/src/rooms/KkakkungRoom.ts#L667), [KkakkungRoom.ts:670](../../server/src/rooms/KkakkungRoom.ts#L670), [KkakkungRoom.ts:675](../../server/src/rooms/KkakkungRoom.ts#L675), [KkakkungRoom.ts:680](../../server/src/rooms/KkakkungRoom.ts#L680), [KkakkungRoom.ts:956](../../server/src/rooms/KkakkungRoom.ts#L956), [EventDispatcher.ts:197](../../server/src/game/EventDispatcher.ts#L197), [EventDispatcher.ts:200](../../server/src/game/EventDispatcher.ts#L200), [ClockSync.ts:34](../../server/src/game/ClockSync.ts#L34), [KkakkungRoom.ts:1524](../../server/src/rooms/KkakkungRoom.ts#L1524).

모든 수신 메시지는 방이 닫히는 중이 아니고 연결별 수신 제한기를 통과해야 처리된다. 등록되지 않은 이름은 `'*'` 처리기가 조용히 버린다. 웹은 위 이름을 상수가 아니라 같은 값의 문자열 리터럴로 보낸다.

근거: [KkakkungRoom.ts:638](../../server/src/rooms/KkakkungRoom.ts#L638), [KkakkungRoom.ts:640](../../server/src/rooms/KkakkungRoom.ts#L640), [KkakkungRoom.ts:685](../../server/src/rooms/KkakkungRoom.ts#L685), [command-lifecycle.ts:85](../../apps/web/src/features/room/command-lifecycle.ts#L85), [command-lifecycle.ts:132](../../apps/web/src/features/room/command-lifecycle.ts#L132), [product-runtime.ts:450](../../apps/web/src/app/product-runtime.ts#L450), [product-runtime.ts:506](../../apps/web/src/app/product-runtime.ts#L506), [product-runtime.ts:1083](../../apps/web/src/app/product-runtime.ts#L1083), [product-runtime.ts:1428](../../apps/web/src/app/product-runtime.ts#L1428).

### 서버 → 클라이언트

| 상수 키               | 메시지 이름             | payload 스키마                                             | 보내는 시점·대상                                                           | 웹이 버리는 조건                                                                                                                                                       |
| --------------------- | ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commandResult`       | `command-result`        | `commandReceiptSchema`                                     | 명령 하나당 영수증 하나, 보낸 연결에게                                     | 스키마 불일치, 다른 `matchId`, 보낸 적 없는 `requestId`, `sequence` 불일치, 이미 결과를 받음                                                                           |
| `commandOutcome`      | `command-outcome`       | `commandOutcomeSchema`                                     | 틱에서 처리·취소될 때 명령 주인에게; 중복 요청이면 영수증 직후 저장된 결과 | 스키마 불일치, 다른 `matchId`, 보낸 적 없는 `requestId`, `sequence` 불일치, 이미 결과를 받음                                                                           |
| `requestStatusResult` | `request-status-result` | `requestStatusResultSchema`                                | `request-status` 응답                                                      | 스키마 불일치, 다른 `matchId`, 모르는 `requestId`                                                                                                                      |
| `roomRoster`          | `room-roster`           | `roomRosterSchema` ([12절](#12-대기실-메시지와-종료-코드)) | 명단이 바뀔 때 방 전체에, 다음 패치 뒤                                     | 스키마 불일치, 다른 `matchId`, 이미 가진 것보다 낮은 `stateVersion`                                                                                                    |
| `roomAccess`          | `room-access`           | `roomAccessSchema`                                         | 명단 방송과 함께                                                           | 스키마 불일치, 다른 `matchId`, 낮은 `revision`                                                                                                                         |
| `roomMap`             | `room-map`              | `roomMapSchema`                                            | 명단 방송과 함께                                                           | 스키마 불일치, 다른 `matchId`, 낮은 `revision`                                                                                                                         |
| `privateView`         | `private-view`          | `privateViewSchema` ([10절](#10-개인-뷰))                  | 수신자별                                                                   | 스키마 불일치 또는 복원 불가 → resync                                                                                                                                  |
| `privateEvent`        | `private-event`         | `privateEventSchema` ([11절](#11-개인-이벤트))             | 이벤트 청중 중 같은 게임 인스턴스에 있는 수신자                            | 스키마 불일치 → resync. 다른 `matchId`·보유보다 낮은 `gameScope.revision`은 조용히 버림. 같은 revision인데 kind·인스턴스가 다르면 resync                               |
| `heartbeat`           | `game-heartbeat`        | `gameHeartbeatSchema`                                      | 연결별 2000ms 간격                                                         | 스키마 불일치, 다른 `matchId`, 다른 epoch, 이미 본 순번 이하                                                                                                           |
| `clockReply`          | `clock-reply`           | `clockReplySchema`                                         | `clock-probe` 응답                                                         | 스키마 불일치, 보낸 적 없는 `probeId`·다른 `clientSentAtMs`, epoch가 바뀌면 초기화 후 버림, 왕복 시간이 음수·1000ms 초과이거나 서버 송수신 시각이 뒤바뀌면 표본에서 뺌 |
| `mediaBindings`       | `media-bindings`        | `mediaBindingsSchema` ([14절](#14-미디어-메시지와-경로))   | 수신자별, 적 참가자는 별칭으로 가림                                        | 스키마 불일치, 다른 `matchId`·미디어 범위, 참여 중 아님, 가진 것 이하의 `bindingRevision`                                                                              |
| `audioPolicy`         | `audio-policy`          | `audioPolicySchema`                                        | 수신자별, 적 음성은 별칭으로 가림                                          | 다른 `matchId`·미디어 범위, 참여 중 아님                                                                                                                               |
| `demoState`           | `demo-state`            | `demoStateSchema` ([16절](#16-데모-방-메시지))             | 데모 방의 인형이 아닌 참가자에게, 내용이 바뀔 때만                         | 스키마 불일치는 버림. 라운드를 알기 전이면 보관했다가 라운드가 정해지면 다시 맞춰 봄. 라운드를 아는데 `matchId`가 다르면 버림                                          |

근거: [product.ts:24](../../packages/protocol/src/game-messages/product.ts#L24), [KkakkungRoom.ts:882](../../server/src/rooms/KkakkungRoom.ts#L882), [KkakkungRoom.ts:884](../../server/src/rooms/KkakkungRoom.ts#L884), [KkakkungRoom.ts:354](../../server/src/rooms/KkakkungRoom.ts#L354), [KkakkungRoom.ts:356](../../server/src/rooms/KkakkungRoom.ts#L356), [KkakkungRoom.ts:360](../../server/src/rooms/KkakkungRoom.ts#L360), [KkakkungRoom.ts:364](../../server/src/rooms/KkakkungRoom.ts#L364), [KkakkungRoom.ts:568](../../server/src/rooms/KkakkungRoom.ts#L568), [KkakkungRoom.ts:1134](../../server/src/rooms/KkakkungRoom.ts#L1134), [KkakkungRoom.ts:1158](../../server/src/rooms/KkakkungRoom.ts#L1158), [KkakkungRoom.ts:1572](../../server/src/rooms/KkakkungRoom.ts#L1572), [KkakkungRoom.ts:2446](../../server/src/rooms/KkakkungRoom.ts#L2446), [KkakkungRoom.ts:2451](../../server/src/rooms/KkakkungRoom.ts#L2451), [KkakkungRoom.ts:2457](../../server/src/rooms/KkakkungRoom.ts#L2457), [EventDispatcher.ts:166](../../server/src/game/EventDispatcher.ts#L166), [product-runtime.ts:1202](../../apps/web/src/app/product-runtime.ts#L1202), [product-runtime.ts:1213](../../apps/web/src/app/product-runtime.ts#L1213), [product-runtime.ts:1221](../../apps/web/src/app/product-runtime.ts#L1221), [product-runtime.ts:1230](../../apps/web/src/app/product-runtime.ts#L1230), [product-runtime.ts:1239](../../apps/web/src/app/product-runtime.ts#L1239), [product-runtime.ts:1263](../../apps/web/src/app/product-runtime.ts#L1263), [product-runtime.ts:1276](../../apps/web/src/app/product-runtime.ts#L1276), [product-view.ts:116](../../apps/web/src/features/room/product-view.ts#L116), [private-events.ts:87](../../apps/web/src/features/room/private-events.ts#L87), [game-heartbeat.ts:30](../../apps/web/src/features/room/game-heartbeat.ts#L30), [command-lifecycle.ts:96](../../apps/web/src/features/room/command-lifecycle.ts#L96), [command-lifecycle.ts:98](../../apps/web/src/features/room/command-lifecycle.ts#L98), [command-lifecycle.ts:47](../../apps/web/src/features/room/command-lifecycle.ts#L47), [command-lifecycle.ts:50](../../apps/web/src/features/room/command-lifecycle.ts#L50), [command-lifecycle.ts:107](../../apps/web/src/features/room/command-lifecycle.ts#L107), [command-lifecycle.ts:110](../../apps/web/src/features/room/command-lifecycle.ts#L110), [clock-sync.ts:51](../../apps/web/src/features/room/clock-sync.ts#L51), [clock-sync.ts:54](../../apps/web/src/features/room/clock-sync.ts#L54), [clock-sync.ts:55](../../apps/web/src/features/room/clock-sync.ts#L55).

## 5. 명령 envelope과 명령 종류

모든 제품 명령은 한 envelope 모양이다. `{ matchId, requestId, sequence, type, payload }`의 다섯 키만 허용하고 `payload`도 strict 객체다. 그래서 `actorId`·`playerId` 같은 신원 필드를 클라이언트가 넣으면 스키마에서 거절되고, 서버는 인증된 연결의 플레이어를 `actorId`로 붙인다. `type`으로 구분되는 union이며 선언된 종류는 20개다. 이름에 `ITEM`·`PICKUP`·`USE_`가 들어간 종류는 union에 없다.

근거: [product.ts:69](../../packages/protocol/src/game-messages/product.ts#L69), [product.ts:70](../../packages/protocol/src/game-messages/product.ts#L70), [product.ts:71](../../packages/protocol/src/game-messages/product.ts#L71), [product.ts:73](../../packages/protocol/src/game-messages/product.ts#L73), [product.ts:115](../../packages/protocol/src/game-messages/product.ts#L115), [CommandAdapter.ts:55](../../server/src/game/CommandAdapter.ts#L55), [product-commands.test.ts:53](../../packages/protocol/test/product-commands.test.ts#L53), [g3-room.test.ts:580](../../tests/contracts/g3-room.test.ts#L580).

`PHASE_COMMAND_TYPES`에 든 9개가 **단계 명령**이고 나머지 11개가 **코어 명령**이다. `isPhaseCommand`가 이 목록으로 가른다. 서버에서 단계 명령은 틱 안에서 Room의 `handlePhaseCommand`가 처리하고, 코어 명령은 `actorId`를 붙여 `game-core`의 `stepMatch`로 넘어간다. 접수 단계 검사도 둘이 다르다. 코어 명령은 방 단계가 `TEAM_PRACTICE` 또는 `PLAYING`이고 보낸 사람이 활성 게임 인스턴스에 있어야 하며, 단계 명령은 명령별 허용 단계 목록으로 검사한다.

근거: [product.ts:120](../../packages/protocol/src/game-messages/product.ts#L120), [product.ts:135](../../packages/protocol/src/game-messages/product.ts#L135), [CommandAdapter.ts:45](../../server/src/game/CommandAdapter.ts#L45), [MatchDriver.ts:212](../../server/src/game/MatchDriver.ts#L212), [MatchDriver.ts:213](../../server/src/game/MatchDriver.ts#L213), [KkakkungRoom.ts:204](../../server/src/rooms/KkakkungRoom.ts#L204), [KkakkungRoom.ts:903](../../server/src/rooms/KkakkungRoom.ts#L903), [KkakkungRoom.ts:907](../../server/src/rooms/KkakkungRoom.ts#L907).

### 단계 명령 (서버 Room 처리)

| `type`           | payload                                                                                   | 서버 접수 단계                                | 방 종류별 특례                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `READY`          | `{ ready: boolean }`                                                                      | `DEVICE_CHECK`                                | —                                                                                                       |
| `ROOM_LOCK`      | `{ locked: boolean }`                                                                     | `LOBBY`, `DEVICE_CHECK`                       | 방장만. 데모 방은 실행 시 `NOT_ALLOWED`                                                                 |
| `ROOM_KICK`      | `{ targetPlayerId: playerId }`                                                            | `LOBBY`, `DEVICE_CHECK`                       | 방장만, 자기 자신 불가. 데모 방은 실행 시 `NOT_ALLOWED`                                                 |
| `ROOM_MAP_SIZE`  | `{ size: 'small' \| 'medium' \| 'large' }`                                                | 일반·데모 `LOBBY`, `DEVICE_CHECK` / 시연 없음 | 방장만                                                                                                  |
| `ROOM_START`     | `{}`                                                                                      | `DEVICE_CHECK`                                | 방장만, 방 정원 전원이 준비해야 함(아니면 실행 시 `NOT_READY`)                                          |
| `PRACTICE_READY` | `{ ready: boolean }`                                                                      | `TEAM_PRACTICE`                               | —                                                                                                       |
| `LOAD_READY`     | `{ loadId: 불투명 ID, mediaInstanceId: 불투명 ID, receiverGeneration: 0 이상 안전 정수 }` | `GAME_LOADING`                                | —                                                                                                       |
| `REMATCH`        | `{ mode: 'same' \| 'swap' \| 'lobby', role?: 'runner' \| 'tagger' }`                      | `RESULT`, `ABORTED`                           | `role`은 데모 방만(그 외 `NOT_ALLOWED`). 시연 방은 `NOT_ALLOWED`. 시작 게이트가 닫혀 있으면 `NOT_READY` |
| `SPECTATE`       | `{ targetPlayerId: playerId }`                                                            | `PLAYING`                                     | 끝난 도망자가 같은 팀 생존 도망자만 고를 수 있음                                                        |

근거: [product.ts:77](../../packages/protocol/src/game-messages/product.ts#L77), [product.ts:78](../../packages/protocol/src/game-messages/product.ts#L78), [product.ts:79](../../packages/protocol/src/game-messages/product.ts#L79), [product.ts:81](../../packages/protocol/src/game-messages/product.ts#L81), [product.ts:83](../../packages/protocol/src/game-messages/product.ts#L83), [product.ts:84](../../packages/protocol/src/game-messages/product.ts#L84), [product.ts:85](../../packages/protocol/src/game-messages/product.ts#L85), [product.ts:102](../../packages/protocol/src/game-messages/product.ts#L102), [product.ts:108](../../packages/protocol/src/game-messages/product.ts#L108), [KkakkungRoom.ts:848](../../server/src/rooms/KkakkungRoom.ts#L848), [KkakkungRoom.ts:908](../../server/src/rooms/KkakkungRoom.ts#L908), [KkakkungRoom.ts:922](../../server/src/rooms/KkakkungRoom.ts#L922), [KkakkungRoom.ts:923](../../server/src/rooms/KkakkungRoom.ts#L923), [KkakkungRoom.ts:933](../../server/src/rooms/KkakkungRoom.ts#L933), [KkakkungRoom.ts:976](../../server/src/rooms/KkakkungRoom.ts#L976), [KkakkungRoom.ts:986](../../server/src/rooms/KkakkungRoom.ts#L986), [KkakkungRoom.ts:1019](../../server/src/rooms/KkakkungRoom.ts#L1019), [KkakkungRoom.ts:1087](../../server/src/rooms/KkakkungRoom.ts#L1087), [KkakkungRoom.ts:1355](../../server/src/rooms/KkakkungRoom.ts#L1355), [LobbyCoordinator.ts:122](../../server/src/rooms/LobbyCoordinator.ts#L122).

### 코어 명령 (`game-core` 처리)

| `type`             | payload                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `MOVE_INTENT`      | `{ direction: 'forward' \| 'back' \| null }` (`null`은 유지 이동 해제)     |
| `TURN`             | `{ direction: 'left' \| 'right' }`                                         |
| `GRAB_INTENT`      | `{}`                                                                       |
| `EXCHANGE_REQUEST` | `{ targetPlayerId: playerId }`                                             |
| `EXCHANGE_ACCEPT`  | `{ exchangeId: 불투명 ID }`                                                |
| `EXCHANGE_CANCEL`  | `{ exchangeId: 불투명 ID }`                                                |
| `INSTALL`          | `{ kind: 'sensor' \| 'trap' }`                                             |
| `INSTALL_CANCEL`   | `{ installationId: 불투명 ID }`                                            |
| `EXIT_START`       | `{ exitId: 불투명 ID }`                                                    |
| `EXIT_CANCEL`      | `{ challengeId: 불투명 ID }`                                               |
| `EXIT_PROGRESS`    | `{ challengeId: 불투명 ID, method: 'pose' \| 'keys', completed: boolean }` |

코어 명령은 방 단계가 `TEAM_PRACTICE`·`PLAYING`이 아니면 `INVALID_PHASE`, 보낸 사람이 활성 인스턴스에 없으면 `NOT_ACTIVE`로 영수증에서 거절된다. 명령별 규칙 판정과 거절은 [game-core.md](game-core.md)가 소유한다.

근거: [product.ts:74](../../packages/protocol/src/game-messages/product.ts#L74), [product.ts:75](../../packages/protocol/src/game-messages/product.ts#L75), [product.ts:76](../../packages/protocol/src/game-messages/product.ts#L76), [product.ts:90](../../packages/protocol/src/game-messages/product.ts#L90), [product.ts:91](../../packages/protocol/src/game-messages/product.ts#L91), [product.ts:92](../../packages/protocol/src/game-messages/product.ts#L92), [product.ts:93](../../packages/protocol/src/game-messages/product.ts#L93), [product.ts:94](../../packages/protocol/src/game-messages/product.ts#L94), [product.ts:95](../../packages/protocol/src/game-messages/product.ts#L95), [product.ts:96](../../packages/protocol/src/game-messages/product.ts#L96), [product.ts:97](../../packages/protocol/src/game-messages/product.ts#L97), [KkakkungRoom.ts:904](../../server/src/rooms/KkakkungRoom.ts#L904), [KkakkungRoom.ts:905](../../server/src/rooms/KkakkungRoom.ts#L905).

## 6. 명령 영수증·결과·상태 조회

명령 하나는 영수증 하나(`command-result`)와 최종 결과 최대 하나(`command-outcome`)를 받는다. 영수증과 결과는 envelope의 `matchId`·`requestId`·`sequence`를 되돌려 짝을 짓는다.

| 스키마                      | 필드                                                                         | 판별 값과 제약                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `commandReceiptSchema`      | `matchId`, `requestId`, `sequence`, `stateVersion`, `status`, `code`         | `status: 'accepted'`이면 `code: null`; `status: 'rejected'`이면 `code`는 `COMMAND_CODES` 중 하나     |
| `commandOutcomeSchema`      | `matchId`, `requestId`, `sequence`, `tick`, `stateVersion`, `result`, `code` | `result: 'applied'`이면 `code: null`; `'rejected'`·`'canceled'`이면 `code`는 `COMMAND_CODES` 중 하나 |
| `requestStatusSchema`       | `matchId`, `requestId`                                                       | 두 키만                                                                                              |
| `requestStatusResultSchema` | `matchId`, `requestId`, `status`, `outcome`                                  | `status: 'done'`이면 `outcome`이 `commandOutcomeSchema`; `'pending'`·`'unknown'`이면 `outcome: null` |

근거: [product.ts:138](../../packages/protocol/src/game-messages/product.ts#L138), [product.ts:139](../../packages/protocol/src/game-messages/product.ts#L139), [product.ts:145](../../packages/protocol/src/game-messages/product.ts#L145), [product.ts:146](../../packages/protocol/src/game-messages/product.ts#L146), [product.ts:153](../../packages/protocol/src/game-messages/product.ts#L153), [product.ts:159](../../packages/protocol/src/game-messages/product.ts#L159).

명령 payload는 JSON 문자열의 UTF-8 바이트로 4096바이트(`MAX_COMMAND_BYTES`)를 넘으면 스키마 검사 전에 거절된다. `utf8ByteLength`는 코드 포인트로 1~4바이트를 세며 DOM·Node 인코더를 쓰지 않는다. `measureJsonBytes`는 `JSON.stringify`가 실패하거나 `undefined`를 내면 무한대로 센다. 스키마 검사 전에 거절된 payload의 영수증에는 `correlateRejectedCommand`가 뽑은 값을 쓰는데, 형상이 맞는 `matchId`·`requestId`·`sequence`만 되돌리고 나머지는 `''`·`''`·`-1`로 채워 공격자 데이터를 그대로 반사하지 않는다.

근거: [product.ts:9](../../packages/protocol/src/game-messages/product.ts#L9), [product.ts:182](../../packages/protocol/src/game-messages/product.ts#L182), [product.ts:186](../../packages/protocol/src/game-messages/product.ts#L186), [product.ts:192](../../packages/protocol/src/game-messages/product.ts#L192), [product.ts:197](../../packages/protocol/src/game-messages/product.ts#L197), [product.ts:205](../../packages/protocol/src/game-messages/product.ts#L205), [product.ts:216](../../packages/protocol/src/game-messages/product.ts#L216), [CommandAdapter.ts:37](../../server/src/game/CommandAdapter.ts#L37), [CommandAdapter.ts:38](../../server/src/game/CommandAdapter.ts#L38).

## 7. 명령 거절 코드 `COMMAND_CODES`

13개 값이 영수증·결과·`EXCHANGE_CANCELED` 이벤트 `reason`·`EXIT_CHALLENGE_ENDED` 이벤트 `reason`의 공통 집합이다. `game-core`의 결과 코드 타입도 같은 13개를 따로 선언한다.

| 코드                | 만드는 곳과 조건                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INVALID_COMMAND`   | 서버 `CommandAdapter`: 4096바이트 초과 또는 envelope 스키마 불일치(영수증). 서버 단계 명령 처리의 알 수 없는 종류. `game-core`의 명령별 형상·대상 오류(결과)                                                                         |
| `PROTOCOL_MISMATCH` | 명령 경로에서 만드는 곳이 없다. 같은 문자열은 Room 입장 거절(`ServerError` 409)로만 쓰인다                                                                                                                                           |
| `WRONG_MATCH`       | 서버 `CommandAdapter`: envelope `matchId`가 현재 경기와 다름. `game-core`도 같은 검사                                                                                                                                                |
| `RATE_LIMITED`      | 서버 Room: 연결별 명령 속도 제한 초과(영수증)                                                                                                                                                                                        |
| `INVALID_PHASE`     | 서버 Room 접수·실행 단계 검사, `LobbyCoordinator`·`LoadingCoordinator`, `game-core` 단계 검사                                                                                                                                        |
| `NOT_ACTIVE`        | 서버 Room: 코어 명령인데 활성 인스턴스 없음. `LobbyCoordinator`: `READY` 보낸 사람이 연결 중이 아님. `game-core`의 종료·비활성 참가자                                                                                                |
| `NOT_ALLOWED`       | 서버 Room: 방장 전용 명령을 방장 아닌 사람이 보냄, 데모 아닌 방의 `REMATCH.role`, 시연 방 `REMATCH`, 잘못된 `SPECTATE` 대상, 데모 방의 잠금·강퇴. `LoadingCoordinator`: `LOAD_READY.mediaInstanceId` 불일치. `game-core`의 규칙 불허 |
| `EXPIRED`           | 서버 `MatchDriver`: 대기 중이던 이동 명령이 실제 시계 TTL을 넘김(`canceled`). `LoadingCoordinator`, `game-core`의 교환·탈출 만료                                                                                                     |
| `STALE_REQUEST`     | 서버 `CommandQueue`: 같은 `requestId`를 다른 행위자·다른 내용으로 재사용, 또는 `sequence`가 마지막 접수 값 이하. `game-core`의 지난 ID 참조                                                                                          |
| `NOT_READY`         | 서버 Room: `REMATCH` 시작 게이트가 닫힘, `ROOM_START` 때 정원 전원 준비 아님. `LoadingCoordinator`: `receiverGeneration` 미확정·불일치. `game-core` 탈출 완료 조건 미충족                                                            |
| `QUEUE_FULL`        | 서버 `CommandQueue`: 행위자별 또는 방 전체 대기 명령 수 상한                                                                                                                                                                         |
| `ROUND_ENDED`       | 서버 `MatchDriver`·Room: 결정된 인스턴스 또는 라운드 종료로 대기 명령 취소. `game-core`의 종료 후 명령                                                                                                                               |
| `CANCELED`          | 서버 `MatchDriver`: 대상 인스턴스가 분리·중단됨. `game-core`의 동작 취소(교환·탈출)                                                                                                                                                  |

근거: [product.ts:42](../../packages/protocol/src/game-messages/product.ts#L42), [events.ts:66](../../packages/protocol/src/game-messages/events.ts#L66), [events.ts:88](../../packages/protocol/src/game-messages/events.ts#L88), [core-types.ts:31](../../packages/game-core/src/match/core-types.ts#L31), [CommandAdapter.ts:39](../../server/src/game/CommandAdapter.ts#L39), [CommandAdapter.ts:41](../../server/src/game/CommandAdapter.ts#L41), [CommandAdapter.ts:44](../../server/src/game/CommandAdapter.ts#L44), [KkakkungRoom.ts:599](../../server/src/rooms/KkakkungRoom.ts#L599), [KkakkungRoom.ts:852](../../server/src/rooms/KkakkungRoom.ts#L852), [KkakkungRoom.ts:858](../../server/src/rooms/KkakkungRoom.ts#L858), [KkakkungRoom.ts:920](../../server/src/rooms/KkakkungRoom.ts#L920), [KkakkungRoom.ts:930](../../server/src/rooms/KkakkungRoom.ts#L930), [KkakkungRoom.ts:933](../../server/src/rooms/KkakkungRoom.ts#L933), [KkakkungRoom.ts:1020](../../server/src/rooms/KkakkungRoom.ts#L1020), [KkakkungRoom.ts:1096](../../server/src/rooms/KkakkungRoom.ts#L1096), [CommandQueue.ts:94](../../server/src/game/CommandQueue.ts#L94), [CommandQueue.ts:103](../../server/src/game/CommandQueue.ts#L103), [CommandQueue.ts:105](../../server/src/game/CommandQueue.ts#L105), [CommandQueue.ts:107](../../server/src/game/CommandQueue.ts#L107), [MatchDriver.ts:197](../../server/src/game/MatchDriver.ts#L197), [MatchDriver.ts:231](../../server/src/game/MatchDriver.ts#L231), [LoadingCoordinator.ts:82](../../server/src/rooms/LoadingCoordinator.ts#L82), [LoadingCoordinator.ts:83](../../server/src/rooms/LoadingCoordinator.ts#L83), [LoadingCoordinator.ts:85](../../server/src/rooms/LoadingCoordinator.ts#L85), [LoadingCoordinator.ts:90](../../server/src/rooms/LoadingCoordinator.ts#L90), [LobbyCoordinator.ts:94](../../server/src/rooms/LobbyCoordinator.ts#L94), [LobbyCoordinator.ts:96](../../server/src/rooms/LobbyCoordinator.ts#L96), [engine.ts:386](../../packages/game-core/src/match/engine.ts#L386), [engine.ts:538](../../packages/game-core/src/match/engine.ts#L538), [engine.ts:760](../../packages/game-core/src/match/engine.ts#L760), [engine.ts:899](../../packages/game-core/src/match/engine.ts#L899).

## 8. 공개 방 상태 `PublicMatchState`

Colyseus로 방 전체에 동기화되는 공개 상태는 라운드 메타데이터만 담는다. 지형·플레이어 좌표·출구·시드·튜닝은 이 스키마에 없고, 각 수신자는 자기 `private-view`를 따로 받는다. 허용 필드 이름은 `PUBLIC_MATCH_STATE_FIELDS` 15개로 고정되어 누출 시험의 기준이 된다.

| 필드                   | Schema 타입                   | 기본값                                                                                         | 뜻                                                                                                                                                              |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocolVersion`      | `string`                      | `'0.2.0'`                                                                                      | 제품 계약 버전                                                                                                                                                  |
| `phase`                | `string` (`Phase`)            | `'LOBBY'`                                                                                      | 방 단계                                                                                                                                                         |
| `matchId`              | `string`                      | `''`                                                                                           | 현재 경기 ID                                                                                                                                                    |
| `stateVersion`         | `number`                      | `0`                                                                                            | 공개 상태 버전                                                                                                                                                  |
| `serverTick`           | `number`                      | `0`                                                                                            | 서버 틱                                                                                                                                                         |
| `startTick`            | `number`                      | 없음                                                                                           | 경기 기준 시작 틱, `PLAYING` 전에는 비어 있음                                                                                                                   |
| `startAt`              | `number`                      | 없음                                                                                           | 서버 단조 시계 ms, `COUNTDOWN`이 정하기 전에는 비어 있음                                                                                                        |
| `deadlineTick`         | `number`                      | 없음                                                                                           | 종료 틱                                                                                                                                                         |
| `counts`               | `ref(RoundCounts)`            | 기본값 선언 없음. 시험이 `new PublicMatchState().counts`에 바로 쓰므로 생성 시 인스턴스가 있다 | `escaped`·`captured`, 각각 `uint8` 기본 `0`                                                                                                                     |
| `result`               | `ref(RoundResultState)`       | 기본값 선언 없음. 서버는 결과가 생길 때 없으면 새로 만든다                                     | `winner`·`reason` 문자열, 각각 기본 `''`(빈 문자열 = 결과 없음)                                                                                                 |
| `abortReason`          | `string` (`AbortReason`)      | 없음                                                                                           | 중단 사유                                                                                                                                                       |
| `roomExpiresInSeconds` | `number`                      | 없음                                                                                           | 방 만료까지 남은 시간이 60초 이하일 때만, 남은 ms를 초로 올림한 값                                                                                              |
| `preparationIssue`     | `string` (`PreparationIssue`) | 없음                                                                                           | 준비 단계 안내 코드. 서버는 `LOBBY`·`DEVICE_CHECK`에서만 넣는다                                                                                                 |
| `rematchState`         | `string` (`RematchState`)     | 없음                                                                                           | 재경기 진행 상태. 서버는 `RESULT`·`ABORTED`에서만 넣고, 대기 중인 재경기 요청이 있으면 `requested`, 미디어 정리가 안 끝났으면 `settling`, 그 밖에는 `available` |
| `abortedBy`            | `string`                      | 없음                                                                                           | 연결 상실로 무효가 된 경기에서 끊긴 참가자의 닉네임                                                                                                             |

근거: [game-schema/product.ts:280](../../packages/protocol/src/game-schema/product.ts#L280), [game-schema/product.ts:282](../../packages/protocol/src/game-schema/product.ts#L282), [game-schema/product.ts:289](../../packages/protocol/src/game-schema/product.ts#L289), [game-schema/product.ts:292](../../packages/protocol/src/game-schema/product.ts#L292), [game-schema/product.ts:300](../../packages/protocol/src/game-schema/product.ts#L300), [game-schema/product.ts:302](../../packages/protocol/src/game-schema/product.ts#L302), [game-schema/product.ts:303](../../packages/protocol/src/game-schema/product.ts#L303), [game-schema/product.ts:308](../../packages/protocol/src/game-schema/product.ts#L308), [game-schema/product.ts:310](../../packages/protocol/src/game-schema/product.ts#L310), [game-schema/product.ts:312](../../packages/protocol/src/game-schema/product.ts#L312), [game-schema/product.ts:313](../../packages/protocol/src/game-schema/product.ts#L313), [game-schema/product.ts:314](../../packages/protocol/src/game-schema/product.ts#L314), [game-schema/product.ts:322](../../packages/protocol/src/game-schema/product.ts#L322), [game-schema/product.ts:387](../../packages/protocol/src/game-schema/product.ts#L387), [product-state.test.ts:42](../../packages/protocol/test/product-state.test.ts#L42), [KkakkungRoom.ts:2509](../../server/src/rooms/KkakkungRoom.ts#L2509), [KkakkungRoom.ts:2481](../../server/src/rooms/KkakkungRoom.ts#L2481), [KkakkungRoom.ts:2484](../../server/src/rooms/KkakkungRoom.ts#L2484), [KkakkungRoom.ts:2486](../../server/src/rooms/KkakkungRoom.ts#L2486), [KkakkungRoom.ts:2488](../../server/src/rooms/KkakkungRoom.ts#L2488), [KkakkungRoom.ts:2498](../../server/src/rooms/KkakkungRoom.ts#L2498).

`@colyseus/schema`는 `null` 원시값을 필드 부재로 보내므로 디코딩한 클라이언트 상태에서는 `undefined`가 된다. 서버는 비어 있는 값을 `undefined`로 넣고, 읽는 쪽은 `readPublicRoundState`로 계약의 nullable 모양(`PublicRoundState`)을 만든다. 웹은 상태 패치마다 이 함수를 거친다. 정규화 규칙은 아래와 같다.

| 입력 필드                                        | 출력                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `phase`, `matchId`, `stateVersion`, `serverTick` | 그대로(`phase`는 검사 없이 `Phase`로 단언)                                                    |
| `startTick`, `startAt`, `deadlineTick`           | `undefined`·`null`이면 `null`, 아니면 그대로                                                  |
| `counts`                                         | 없으면 `{ escaped: 0, captured: 0 }`, 각 값도 없으면 `0`                                      |
| `result`                                         | 객체가 있고 `winner`·`reason`이 둘 다 비어 있지 않을 때만 `{ winner, reason }`, 아니면 `null` |
| `abortReason`                                    | `undefined`·`null`이면 `null`, 아니면 값 검사 없이 그대로                                     |
| `preparationIssue`                               | `PREPARATION_ISSUES`에 있는 값일 때만 키를 넣고, 아니면 키 자체를 뺀다                        |
| `rematchState`                                   | `REMATCH_STATES`에 있는 값일 때만 키를 넣고, 아니면 키를 뺀다                                 |
| `abortedBy`                                      | `phase`가 `'ABORTED'`이고 비어 있지 않은 문자열일 때만 키를 넣는다                            |
| `roomExpiresInSeconds`                           | 유한한 0 이상 숫자일 때만 키를 넣는다                                                         |
| `protocolVersion`                                | 출력에 없다                                                                                   |

근거: [game-schema/product.ts:328](../../packages/protocol/src/game-schema/product.ts#L328), [game-schema/product.ts:332](../../packages/protocol/src/game-schema/product.ts#L332), [game-schema/product.ts:350](../../packages/protocol/src/game-schema/product.ts#L350), [game-schema/product.ts:354](../../packages/protocol/src/game-schema/product.ts#L354), [game-schema/product.ts:357](../../packages/protocol/src/game-schema/product.ts#L357), [game-schema/product.ts:361](../../packages/protocol/src/game-schema/product.ts#L361), [game-schema/product.ts:368](../../packages/protocol/src/game-schema/product.ts#L368), [game-schema/product.ts:369](../../packages/protocol/src/game-schema/product.ts#L369), [game-schema/product.ts:372](../../packages/protocol/src/game-schema/product.ts#L372), [game-schema/product.ts:375](../../packages/protocol/src/game-schema/product.ts#L375), [game-schema/product.ts:378](../../packages/protocol/src/game-schema/product.ts#L378), [KkakkungRoom.ts:2476](../../server/src/rooms/KkakkungRoom.ts#L2476), [product-runtime.ts:1115](../../apps/web/src/app/product-runtime.ts#L1115).

## 9. enum 값

| 이름                                      | 값                                                                                                                                                                                         | 쓰이는 곳                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `PHASES` (`Phase`)                        | `LOBBY`, `DEVICE_CHECK`, `TEAM_PRACTICE`, `MAP_FINALIZING`, `GAME_LOADING`, `COUNTDOWN`, `PLAYING`, `RESULT`, `ABORTED`                                                                    | `PublicMatchState.phase`, `room-roster.phase`(zod enum) |
| `MAP_SIZES` (`MapSize`)                   | `small`, `medium`, `large`                                                                                                                                                                 | `ROOM_MAP_SIZE.size`, `room-map.size`                   |
| `ABORT_REASONS` (`AbortReason`)           | `GAME_CONNECTION_LOST`, `SERVER_TICK_OVERLOAD`, `MEDIA_POLICY_UNCERTAIN`, `MEDIA_UNAVAILABLE`, `DEMO_OPERATOR_ABORT`                                                                       | `PublicMatchState.abortReason`                          |
| `PREPARATION_ISSUES` (`PreparationIssue`) | `SERVICE_NOT_READY`, `LAYOUT_UNAVAILABLE`, `DEVICE_LOADING_TIMEOUT`, `MEDIA_NOT_READY`, `PREPARATION_UNAVAILABLE`, `MEDIA_BUDGET_EXHAUSTED`, `MATCH_CAPACITY_FULL`, `MATCH_SLOT_AVAILABLE` | `PublicMatchState.preparationIssue`                     |
| `REMATCH_STATES` (`RematchState`)         | `available`, `settling`, `requested`                                                                                                                                                       | `PublicMatchState.rematchState`                         |
| `RoundResult.winner`                      | `runners`, `taggers`                                                                                                                                                                       | `RoundResultState.winner`                               |
| `RoundResult.reason`                      | `two-escaped`, `two-captured`, `timeout`                                                                                                                                                   | `RoundResultState.reason`                               |
| `Role`                                    | `runner`, `tagger`                                                                                                                                                                         | 뷰·이벤트·데모·시연                                     |
| `PlayerStatus`                            | `ACTIVE`, `ESCAPED`, `CAPTURED`                                                                                                                                                            | 개인 뷰 `self.status`                                   |
| `PoseKind`                                | `left`, `right`, `y`                                                                                                                                                                       | 탈출 도전 `poseKind`                                    |
| `EquipmentKind`                           | `sensor`, `trap`                                                                                                                                                                           | `INSTALL.kind`, 설치·장비 뷰                            |
| 소유 장비 상태                            | `UNARMED`, `ARMED`, `SPENT`                                                                                                                                                                | `ownedEquipment[].state`                                |
| 보이는 장비 상태                          | `UNARMED`, `ARMED`                                                                                                                                                                         | `visibleEntities[]` 센서·함정의 `state`                 |
| `HUNTER_MARKER.kind`                      | `exchange`, `sensor`, `trap`                                                                                                                                                               | 술래 흔적 이벤트                                        |
| 탈출 도전 종료 `result`                   | `canceled`, `failed`, `escaped`                                                                                                                                                            | `EXIT_CHALLENGE_ENDED`                                  |
| 게임 범위 `kind`                          | `practice`, `game`, `none`                                                                                                                                                                 | `gameScope`                                             |
| 행동 `kind`                               | `move`, `turn`                                                                                                                                                                             | `Action`                                                |
| 교환 방향                                 | `incoming`, `outgoing`                                                                                                                                                                     | `self.exchange.direction`                               |
| 방 종류 `RoomKind`                        | `match`, `demo`, `showcase`                                                                                                                                                                | `room-roster.kind`                                      |
| 입장 방식                                 | `invitation`, `gitlab-sso`, `guest`                                                                                                                                                        | `GET /api/sessions/access` 응답                         |
| 미디어 구독 방식                          | `publisher-permissions`, `server-forwarding`                                                                                                                                               | `mediaGrantSchema.subscriptionMode`                     |
| 미디어 상태 보고                          | `ready`, `recovering`, `failed`, `closed`                                                                                                                                                  | `mediaStatusReportSchema.status`                        |
| 미디어 grant 목적                         | `practice`, `game`                                                                                                                                                                         | `mediaGrantRequestSchema.purpose`                       |
| 효과음 종류                               | `footstep`, `sensor`, `trap`                                                                                                                                                               | `audio-policy.effects[].kind`                           |

근거: [game-schema/product.ts:18](../../packages/protocol/src/game-schema/product.ts#L18), [game-schema/product.ts:19](../../packages/protocol/src/game-schema/product.ts#L19), [game-schema/product.ts:20](../../packages/protocol/src/game-schema/product.ts#L20), [game-schema/product.ts:36](../../packages/protocol/src/game-schema/product.ts#L36), [game-schema/product.ts:38](../../packages/protocol/src/game-schema/product.ts#L38), [game-schema/product.ts:39](../../packages/protocol/src/game-schema/product.ts#L39), [game-schema/product.ts:60](../../packages/protocol/src/game-schema/product.ts#L60), [game-schema/product.ts:64](../../packages/protocol/src/game-schema/product.ts#L64), [game-schema/product.ts:73](../../packages/protocol/src/game-schema/product.ts#L73), [game-schema/product.ts:96](../../packages/protocol/src/game-schema/product.ts#L96), [events.ts:22](../../packages/protocol/src/game-messages/events.ts#L22), [events.ts:24](../../packages/protocol/src/game-messages/events.ts#L24), [events.ts:28](../../packages/protocol/src/game-messages/events.ts#L28), [events.ts:35](../../packages/protocol/src/game-messages/events.ts#L35), [events.ts:75](../../packages/protocol/src/game-messages/events.ts#L75), [events.ts:87](../../packages/protocol/src/game-messages/events.ts#L87), [events.ts:102](../../packages/protocol/src/game-messages/events.ts#L102), [events.ts:111](../../packages/protocol/src/game-messages/events.ts#L111), [events.ts:153](../../packages/protocol/src/game-messages/events.ts#L153), [room.ts:22](../../packages/protocol/src/game-messages/room.ts#L22), [session.ts:9](../../packages/protocol/src/game-messages/session.ts#L9), [media.ts:60](../../packages/protocol/src/game-messages/media.ts#L60), [media.ts:72](../../packages/protocol/src/game-messages/media.ts#L72), [media.ts:79](../../packages/protocol/src/game-messages/media.ts#L79), [media.ts:110](../../packages/protocol/src/game-messages/media.ts#L110).

서버 없이 도는 혼자 연습과 문구를 위해 행동 시간의 사본도 둔다. `PRODUCT_TICK_MS`는 50, `PRODUCT_ACTION_TICKS`는 이동 12틱·회전 8틱, `PRODUCT_ACTION_MS`는 이동 600ms·회전 400ms다. 실제 경기의 행동은 매 `Action`의 `startTick`·`endTick`을 따르고 이 사본을 읽지 않는다. 서버 시험이 운영 튜닝의 `tickMs`·`moveTicks`·`turnTicks`와 이 사본이 같은지 확인한다. 웹은 혼자 연습 세계와 입력 튜닝에서 이 값을 쓴다.

근거: [game-schema/product.ts:53](../../packages/protocol/src/game-schema/product.ts#L53), [game-schema/product.ts:54](../../packages/protocol/src/game-schema/product.ts#L54), [game-schema/product.ts:55](../../packages/protocol/src/game-schema/product.ts#L55), [product-profile.test.ts:34](../../server/test/room/product-profile.test.ts#L34), [solo-world.ts:80](../../apps/web/src/features/game/solo/solo-world.ts#L80), [input-tuning.ts:69](../../apps/web/src/features/input/input-tuning.ts#L69).

## 10. 개인 뷰

### 전송 형상과 복원

`private-view`는 수신자 한 명의 시야·지식·자기 상태다. 선로 형상(`privateViewSchema`)과 수신자가 들고 있는 복원 형상(`completePrivateViewSchema`)이 다르다.

| 필드                | 타입·제약                             | 선로 형상 | 복원 형상      |
| ------------------- | ------------------------------------- | --------- | -------------- |
| `matchId`           | `matchId`                             | 필수      | 필수           |
| `gameScope`         | 활성 범위 또는 `none` 범위            | 필수      | 필수           |
| `stateVersion`      | `stateVersion`                        | 필수      | 필수           |
| `mapVersion`        | 0 이상 안전 정수                      | 필수      | 필수           |
| `knowledgeRevision` | 0 이상 안전 정수                      | 필수      | **허용 안 함** |
| `knownTerrain`      | `KnownTerrain[]`                      | 선택      | 필수           |
| `knownActiveExits`  | `KnownExit[]`                         | 선택      | 필수           |
| `self`              | `ActiveSelf` \| `EndedSelf` \| `null` | 필수      | 필수           |
| `visibleCells`      | `Cell[]`                              | 필수      | 필수           |
| `visibleWallFaces`  | `WallFace[]`                          | 필수      | 필수           |
| `visibleEntities`   | `VisibleEntity[]`                     | 필수      | 필수           |
| `spectating`        | `SpectateView`                        | 선택      | 선택           |

근거: [events.ts:214](../../packages/protocol/src/game-messages/events.ts#L214), [events.ts:215](../../packages/protocol/src/game-messages/events.ts#L215), [events.ts:221](../../packages/protocol/src/game-messages/events.ts#L221), [events.ts:225](../../packages/protocol/src/game-messages/events.ts#L225), [events.ts:233](../../packages/protocol/src/game-messages/events.ts#L233), [events.ts:235](../../packages/protocol/src/game-messages/events.ts#L235), [events.ts:236](../../packages/protocol/src/game-messages/events.ts#L236), [events.ts:240](../../packages/protocol/src/game-messages/events.ts#L240), [product-events.test.ts:123](../../packages/protocol/test/product-events.test.ts#L123), [product-events.test.ts:129](../../packages/protocol/test/product-events.test.ts#L129).

서버 `EventDispatcher`는 누적 지식(`knownTerrain`·`knownActiveExits`)의 내용이 바뀔 때만 `knowledgeRevision`을 1 올리고, 지식이 바뀌었거나 강제 전송(첫 전송·게임 범위 전환·단계 전환·resync)일 때만 두 배열을 싣는다. 받는 쪽의 `restorePrivateView(message, held)`가 복원 규칙의 유일한 구현이다.

| 받은 뷰                | `held`                        | 결과                                                                                            |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| 두 배열이 모두 있음    | 무관                          | 받은 배열로 뷰를 만들고, `{ revision: knowledgeRevision, 두 배열 }`을 새로 들 지식으로 돌려준다 |
| 두 배열 중 하나만 있음 | 무관                          | `null`(알 수 없는 송신자)                                                                       |
| 두 배열이 모두 없음    | `null` 또는 `revision`이 다름 | `null`(지식을 바꾼 뷰를 놓침)                                                                   |
| 두 배열이 모두 없음    | `revision`이 같음             | 들고 있던 배열로 뷰를 채운다                                                                    |

`null`이면 호출자는 옛 배열로 대체하지 않고 resync한다. 웹은 스키마 실패와 복원 실패 모두 `view-resync`를 보내고, 복원된 지식의 `revision`이 들고 있는 것 이상일 때만 교체한다. 새 경기에서는 들고 있던 지식을 버린다.

근거: [EventDispatcher.ts:133](../../server/src/game/EventDispatcher.ts#L133), [EventDispatcher.ts:137](../../server/src/game/EventDispatcher.ts#L137), [EventDispatcher.ts:147](../../server/src/game/EventDispatcher.ts#L147), [game-schema/product.ts:255](../../packages/protocol/src/game-schema/product.ts#L255), [game-schema/product.ts:260](../../packages/protocol/src/game-schema/product.ts#L260), [game-schema/product.ts:265](../../packages/protocol/src/game-schema/product.ts#L265), [game-schema/product.ts:266](../../packages/protocol/src/game-schema/product.ts#L266), [game-schema/product.ts:267](../../packages/protocol/src/game-schema/product.ts#L267), [product-view.ts:103](../../apps/web/src/features/room/product-view.ts#L103), [product-view.ts:116](../../apps/web/src/features/room/product-view.ts#L116), [product-view.ts:121](../../apps/web/src/features/room/product-view.ts#L121), [product-view.ts:127](../../apps/web/src/features/room/product-view.ts#L127).

### 게임 범위

| 형상                              | 필드                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| 활성 범위 `activeGameScopeSchema` | `gameInstanceId: ID`, `kind: 'practice' \| 'game'`, `revision: 0 이상 안전 정수` |
| 없음 범위                         | `gameInstanceId: null`, `kind: 'none'`, `revision: 0 이상 안전 정수`             |

개인 뷰의 `gameScope`는 둘 중 하나를 받고, 개인 이벤트의 `gameScope`는 활성 범위만 받는다. `none`에 문자열 ID를 넣으면 거절된다.

근거: [events.ts:26](../../packages/protocol/src/game-messages/events.ts#L26), [events.ts:31](../../packages/protocol/src/game-messages/events.ts#L31), [events.ts:53](../../packages/protocol/src/game-messages/events.ts#L53), [product-events.test.ts:41](../../packages/protocol/test/product-events.test.ts#L41), [product-events.test.ts:59](../../packages/protocol/test/product-events.test.ts#L59).

### 자기 상태 `self`

| 형상         | 필드                         | 타입·제약                                                                                                                                              |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EndedSelf`  | `playerId`, `role`, `status` | ID, `Role`, `'ESCAPED' \| 'CAPTURED'` (이 세 키만)                                                                                                     |
| `ActiveSelf` | `playerId`                   | ID                                                                                                                                                     |
|              | `role`                       | `Role`                                                                                                                                                 |
|              | `status`                     | `'ACTIVE'`                                                                                                                                             |
|              | `cell`, `dir`                | `Cell`, `Dir`                                                                                                                                          |
|              | `action`                     | `Action` \| `null`                                                                                                                                     |
|              | `equipment`                  | `{ sensor: 0 이상 정수, trap: 0 이상 정수 }` (남은 재고)                                                                                               |
|              | `ownedEquipment`             | `OwnedEquipment[]`                                                                                                                                     |
|              | `restraintUntilTick`         | `tick` \| `null`                                                                                                                                       |
|              | `restraintImmuneUntilTick`   | `tick` \| `null`                                                                                                                                       |
|              | `installation`               | `{ installationId: ID, kind: EquipmentKind, startTick, endTick, armedTick }` \| `null`                                                                 |
|              | `exchange`                   | `{ exchangeId: ID, fromPlayerId: ID, toPlayerId: ID, direction: 'incoming' \| 'outgoing', expiresAtTick }` \| `null`                                   |
|              | `challenge`                  | `ChallengeView` \| `null`                                                                                                                              |
|              | `loading`                    | `{ loadId: ID, initialViewVersion: stateVersion, mediaInstanceId: ID, receiverGeneration: 0 이상 안전 정수, assetVersion: 1자 이상 문자열 }` \| `null` |

근거: [events.ts:125](../../packages/protocol/src/game-messages/events.ts#L125), [events.ts:132](../../packages/protocol/src/game-messages/events.ts#L132), [events.ts:136](../../packages/protocol/src/game-messages/events.ts#L136), [events.ts:137](../../packages/protocol/src/game-messages/events.ts#L137), [events.ts:139](../../packages/protocol/src/game-messages/events.ts#L139), [events.ts:148](../../packages/protocol/src/game-messages/events.ts#L148), [events.ts:157](../../packages/protocol/src/game-messages/events.ts#L157), [events.ts:158](../../packages/protocol/src/game-messages/events.ts#L158), [events.ts:168](../../packages/protocol/src/game-messages/events.ts#L168).

### 보조 형상

| 형상                     | 필드                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `Action`                 | `kind: 'move' \| 'turn'`, `from: Cell + dir`, `to: Cell + dir`, `startTick`, `endTick`                                     |
| `OwnedEquipment` 센서    | `equipmentId: ID`, `state: 'UNARMED' \| 'ARMED' \| 'SPENT'`, `armedTick`, `kind: 'sensor'`, `cell: Cell`, `wall: WallFace` |
| `OwnedEquipment` 함정    | `equipmentId: ID`, `state: 'UNARMED' \| 'ARMED' \| 'SPENT'`, `armedTick`, `kind: 'trap'`, `cell: Cell` (`wall` 없음)       |
| `ChallengeView`          | `challengeId: ID`, `exitId: ID`, `poseKind: PoseKind`, `startedAtTick`, `minSuccessTick`, `expiresAtTick`                  |
| `VisibleEntity` 플레이어 | `id: ID`, `kind: 'player'`, `cell`, `dir`, `action: Action \| null`, `role?: Role`                                         |
| `VisibleEntity` 센서     | `id: ID`, `kind: 'sensor'`, `cell`, `wall: WallFace`(필수), `state: 'UNARMED' \| 'ARMED'`                                  |
| `VisibleEntity` 함정     | `id: ID`, `kind: 'trap'`, `cell`, `state: 'UNARMED' \| 'ARMED'` (`wall`이 있으면 거절)                                     |
| `KnownTerrain` 바닥      | `x`, `y`, `kind: 'floor'`                                                                                                  |
| `KnownTerrain` 벽        | `x`, `y`, `side: Dir`, `kind: 'wall'`                                                                                      |
| `KnownExit`              | `exitId: ID`, `ownerId: ID`, `wall: WallFace`, `approach: Cell`                                                            |
| `SpectateView`           | `targetId: ID`, `cell`, `dir`, `action: Action \| null`, `candidates: ID[]` 최대 3개                                       |

`spectating`은 `self`가 끝난 도망자이고 생존 도망자를 볼 때만 붙는다. 그때 나머지 뷰는 관전 대상의 시야·기억·출구를 싣고, `candidates`가 `SPECTATE`로 바꿀 수 있는 대상이다. `ownedEquipment`, `knownTerrain`, `knownActiveExits`, `visibleCells`, `visibleWallFaces`, `visibleEntities`에는 길이 상한이 없다.

근거: [events.ts:101](../../packages/protocol/src/game-messages/events.ts#L101), [events.ts:108](../../packages/protocol/src/game-messages/events.ts#L108), [events.ts:118](../../packages/protocol/src/game-messages/events.ts#L118), [events.ts:42](../../packages/protocol/src/game-messages/events.ts#L42), [events.ts:173](../../packages/protocol/src/game-messages/events.ts#L173), [events.ts:182](../../packages/protocol/src/game-messages/events.ts#L182), [events.ts:189](../../packages/protocol/src/game-messages/events.ts#L189), [events.ts:196](../../packages/protocol/src/game-messages/events.ts#L196), [events.ts:200](../../packages/protocol/src/game-messages/events.ts#L200), [events.ts:207](../../packages/protocol/src/game-messages/events.ts#L207), [events.ts:212](../../packages/protocol/src/game-messages/events.ts#L212), [events.ts:216](../../packages/protocol/src/game-messages/events.ts#L216), [events.ts:136](../../packages/protocol/src/game-messages/events.ts#L136), [events.ts:217](../../packages/protocol/src/game-messages/events.ts#L217), [events.ts:223](../../packages/protocol/src/game-messages/events.ts#L223), [events.ts:224](../../packages/protocol/src/game-messages/events.ts#L224), [g4-packets.test.ts:176](../../tests/contracts/g4-packets.test.ts#L176), [g4-packets.test.ts:179](../../tests/contracts/g4-packets.test.ts#L179), [product-events.test.ts:92](../../packages/protocol/test/product-events.test.ts#L92), [product-events.test.ts:98](../../packages/protocol/test/product-events.test.ts#L98).

## 11. 개인 이벤트

`private-event`는 공통 머리(`matchId`, `gameScope`(활성 범위만), `eventId: ID`, `tick`, `stateVersion`)에 `type`과 `payload`가 붙은 strict union이다. `stateVersion`은 수신자에게 적용 가능한 뷰 버전이다.

| `type`                 | payload                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `EXCHANGE_OFFER`       | `exchangeId: ID`, `fromPlayerId: ID`, `expiresAtTick: tick`                                                                |
| `EXCHANGE_CANCELED`    | `exchangeId: ID`, `reason: COMMAND_CODES 중 하나`                                                                          |
| `EXCHANGE_COMPLETED`   | `exchangeId: ID`, `mapVersion: 0 이상 안전 정수`                                                                           |
| `HUNTER_MARKER`        | `markerId: ID`, `kind: 'exchange' \| 'sensor' \| 'trap'`, `point: TracePoint`, `occurredTick`, `showAtTick`, `expiresTick` |
| `EXIT_CHALLENGE`       | `ChallengeView` 전체(`challengeId`, `exitId`, `poseKind`, `startedAtTick`, `minSuccessTick`, `expiresAtTick`)              |
| `EXIT_CHALLENGE_ENDED` | `challengeId: ID`, `result: 'canceled' \| 'failed' \| 'escaped'`, `reason: COMMAND_CODES 중 하나 \| null`                  |

근거: [events.ts:51](../../packages/protocol/src/game-messages/events.ts#L51), [events.ts:58](../../packages/protocol/src/game-messages/events.ts#L58), [events.ts:61](../../packages/protocol/src/game-messages/events.ts#L61), [events.ts:62](../../packages/protocol/src/game-messages/events.ts#L62), [events.ts:66](../../packages/protocol/src/game-messages/events.ts#L66), [events.ts:67](../../packages/protocol/src/game-messages/events.ts#L67), [events.ts:71](../../packages/protocol/src/game-messages/events.ts#L71), [events.ts:82](../../packages/protocol/src/game-messages/events.ts#L82), [events.ts:83](../../packages/protocol/src/game-messages/events.ts#L83), [EventDispatcher.ts:172](../../server/src/game/EventDispatcher.ts#L172).

아직 적용할 수 없는(미래) 이벤트는 수신자가 최대 64개(`FUTURE_EVENT_QUEUE_LIMIT`)까지 1000ms(`FUTURE_EVENT_WAIT_MS`) 동안 보관한다. 웹은 보관 수가 64개에 이르면 보관분을 버리고 resync하며, 같은 이벤트 키는 한 번만 처리한다.

근거: [events.ts:5](../../packages/protocol/src/game-messages/events.ts#L5), [events.ts:6](../../packages/protocol/src/game-messages/events.ts#L6), [private-events.ts:93](../../apps/web/src/features/room/private-events.ts#L93), [private-events.ts:95](../../apps/web/src/features/room/private-events.ts#L95), [private-events.ts:100](../../apps/web/src/features/room/private-events.ts#L100).

## 12. 대기실 메시지와 종료 코드

| 메시지        | 필드                            | 제약                                                                                                              |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `room-roster` | `matchId`                       | `matchId`                                                                                                         |
|               | `stateVersion`                  | `stateVersion`                                                                                                    |
|               | `phase`                         | `PHASES` 중 하나                                                                                                  |
|               | `hostId`                        | 1자 이상 문자열                                                                                                   |
|               | `players[]`                     | 최대 6개, 각 `{ playerId: 1자 이상, nickname: 1~20자, ready: boolean, connected: boolean }` (역할·좌표 키는 거절) |
|               | `kind?`                         | `'match' \| 'demo' \| 'showcase'`, 없으면 일반 경기                                                               |
|               | `capacity?`                     | 정수 1~6, 없으면 6                                                                                                |
| `room-access` | `matchId`, `revision`, `locked` | `matchId`, 0 이상 안전 정수, boolean                                                                              |
| `room-map`    | `matchId`, `revision`, `size`   | `matchId`, 0 이상 안전 정수, `MAP_SIZES` 중 하나                                                                  |

`room-access`와 `room-map`은 옛 클라이언트가 바뀌지 않은 명단을 읽을 수 있도록 명단과 채널을 나눈 것이다. 현재 서버는 명단을 보낼 때 세 메시지를 모두 다음 패치 뒤로 보내고, 명단에는 `kind`와 `capacity`를 항상 싣는다.

근거: [room.ts:6](../../packages/protocol/src/game-messages/room.ts#L6), [room.ts:9](../../packages/protocol/src/game-messages/room.ts#L9), [room.ts:10](../../packages/protocol/src/game-messages/room.ts#L10), [room.ts:11](../../packages/protocol/src/game-messages/room.ts#L11), [room.ts:15](../../packages/protocol/src/game-messages/room.ts#L15), [room.ts:20](../../packages/protocol/src/game-messages/room.ts#L20), [room.ts:22](../../packages/protocol/src/game-messages/room.ts#L22), [room.ts:24](../../packages/protocol/src/game-messages/room.ts#L24), [room.ts:38](../../packages/protocol/src/game-messages/room.ts#L38), [room.ts:48](../../packages/protocol/src/game-messages/room.ts#L48), [KkakkungRoom.ts:2449](../../server/src/rooms/KkakkungRoom.ts#L2449), [KkakkungRoom.ts:2461](../../server/src/rooms/KkakkungRoom.ts#L2461), [room-roster.test.ts:36](../../packages/protocol/test/room-roster.test.ts#L36).

| WebSocket 종료 코드          | 값   | 서버가 쓰는 때                                                                                                                                           |
| ---------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROOM_EXPIRED_CLOSE_CODE`    | 4001 | 대기실·결과 방 만료 판정(`roomExpiry`)으로 닫을 때, 데모 방이 비고 재접속 유예가 지났을 때, 장치 점검 시간 초과인데 멈춘 참가자·예약이 없어 방을 닫을 때 |
| `ROOM_REMOVED_CLOSE_CODE`    | 4002 | 방장 강퇴(`REMOVED_BY_HOST`), 장치 점검 시간 초과(`DEVICE_CHECK_TIMEOUT`)                                                                                |
| `SHOWCASE_CLOSED_CLOSE_CODE` | 4003 | 시연 방 방장이 대기실에서 나가 방이 닫힐 때                                                                                                              |
| (상수 없음)                  | 4000 | 서버 리터럴. heartbeat 시간 초과로 연결을 끊을 때(`HEARTBEAT_TIMEOUT`)                                                                                   |

근거: [room.ts:29](../../packages/protocol/src/game-messages/room.ts#L29), [room.ts:31](../../packages/protocol/src/game-messages/room.ts#L31), [room.ts:36](../../packages/protocol/src/game-messages/room.ts#L36), [KkakkungRoom.ts:2361](../../server/src/rooms/KkakkungRoom.ts#L2361), [KkakkungRoom.ts:2377](../../server/src/rooms/KkakkungRoom.ts#L2377), [KkakkungRoom.ts:2354](../../server/src/rooms/KkakkungRoom.ts#L2354), [KkakkungRoom.ts:2358](../../server/src/rooms/KkakkungRoom.ts#L2358), [KkakkungRoom.ts:1768](../../server/src/rooms/KkakkungRoom.ts#L1768), [KkakkungRoom.ts:1772](../../server/src/rooms/KkakkungRoom.ts#L1772), [KkakkungRoom.ts:994](../../server/src/rooms/KkakkungRoom.ts#L994), [KkakkungRoom.ts:1763](../../server/src/rooms/KkakkungRoom.ts#L1763), [KkakkungRoom.ts:790](../../server/src/rooms/KkakkungRoom.ts#L790), [KkakkungRoom.ts:1142](../../server/src/rooms/KkakkungRoom.ts#L1142).

웹은 연결이 끊길 때 종료 코드를 세 상수와 비교해 4001이면 방 만료, 4002이면 방장 강퇴, 4003이면 시연 방 닫힘으로 상태를 나눈다. 화면 문구는 [web.md](web.md)가 소유한다.

근거: [product-runtime.ts:440](../../apps/web/src/app/product-runtime.ts#L440), [product-runtime.ts:441](../../apps/web/src/app/product-runtime.ts#L441), [product-runtime.ts:442](../../apps/web/src/app/product-runtime.ts#L442).

## 13. heartbeat와 시계 탐침

| 스키마                        | 필드                                                                                | 제약                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `gameHeartbeatSchema` (서버→) | `serverEpoch`                                                                       | 1자 이상 문자열                                           |
|                               | `matchId`                                                                           | 1자 이상 문자열(명령의 `matchId`와 달리 64자 상한 없음)   |
|                               | `heartbeatSeq`, `serverTick`                                                        | 0 이상 안전 정수                                          |
|                               | `serverTimeMs`                                                                      | 유한 실수, 서버 단조 시계 ms                              |
| `heartbeatAckSchema` (→서버)  | `serverEpoch`, `matchId`, `heartbeatSeq`                                            | 위와 같음                                                 |
| `clockProbeSchema` (→서버)    | `probeId`                                                                           | 문자열 1~64자                                             |
|                               | `clientSentAtMs`                                                                    | 유한 실수(NaN·Infinity 거절), 신뢰하지 않고 되돌리기만 함 |
| `clockReplySchema` (서버→)    | `probeId`, `clientSentAtMs` + `serverReceivedAtMs`, `serverSentAtMs`, `serverEpoch` | 시각은 유한 실수, epoch는 1자 이상                        |

| 상수                           | 값   | 동작                                                                                                                                    |
| ------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `HEARTBEAT_INTERVAL_MS`        | 2000 | 서버가 연결마다 이 간격으로 순번을 1씩 올려 보낸다                                                                                      |
| `HEARTBEAT_TIMEOUT_MS`         | 6000 | 서버는 마지막 유효 ack 후 이 시간이 지나면 연결 상실로 처리한다. 웹은 마지막 유효 heartbeat 후 이 시간이 지나면 연결을 잃은 것으로 본다 |
| `CLOCK_PROBE_LIMIT_PER_SECOND` | 5    | 서버는 연결별 최근 1000ms 안의 탐침이 5개면 응답하지 않는다                                                                             |

서버는 같은 epoch·같은 경기의 ack 중 보낸 순번 이하이고 이미 확인한 순번보다 큰 것만 인정한다. 웹은 같은 경기·같은 epoch에서 본 순번보다 큰 heartbeat만 받아 곧바로 ack를 보낸다. 서버가 멈췄다 재개한 구간은 침묵 시간에 넣지 않는다.

근거: [heartbeat.ts:7](../../packages/protocol/src/game-messages/heartbeat.ts#L7), [heartbeat.ts:8](../../packages/protocol/src/game-messages/heartbeat.ts#L8), [heartbeat.ts:9](../../packages/protocol/src/game-messages/heartbeat.ts#L9), [heartbeat.ts:11](../../packages/protocol/src/game-messages/heartbeat.ts#L11), [heartbeat.ts:17](../../packages/protocol/src/game-messages/heartbeat.ts#L17), [heartbeat.ts:21](../../packages/protocol/src/game-messages/heartbeat.ts#L21), [heartbeat.ts:28](../../packages/protocol/src/game-messages/heartbeat.ts#L28), [heartbeat.ts:35](../../packages/protocol/src/game-messages/heartbeat.ts#L35), [Heartbeat.ts:78](../../server/src/game/Heartbeat.ts#L78), [Heartbeat.ts:108](../../server/src/game/Heartbeat.ts#L108), [Heartbeat.ts:109](../../server/src/game/Heartbeat.ts#L109), [Heartbeat.ts:128](../../server/src/game/Heartbeat.ts#L128), [Heartbeat.ts:134](../../server/src/game/Heartbeat.ts#L134), [ClockSync.ts:31](../../server/src/game/ClockSync.ts#L31), [ClockSync.ts:34](../../server/src/game/ClockSync.ts#L34), [game-heartbeat.ts:30](../../apps/web/src/features/room/game-heartbeat.ts#L30), [game-heartbeat.ts:39](../../apps/web/src/features/room/game-heartbeat.ts#L39), [game-heartbeat.ts:44](../../apps/web/src/features/room/game-heartbeat.ts#L44).

## 14. 미디어 메시지와 경로

미디어 범위(`mediaScopeSchema`)는 `matchId: ID(1~128자)`, `mediaInstanceId: ID`, `receiverGeneration: 0 이상 안전 정수`다. 이 식별자는 미디어 신원이며 게임의 `gameScope`를 대신하지 않는다. 발급 조건·세대 전이·음성 수식은 [media.md](media.md)가 소유한다.

| 스키마                                   | 필드                                                              | 타입·제약·상한                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mediaGrantRequestSchema` (HTTP 요청)    | `matchId`                                                         | ID                                                                                                                                                 |
|                                          | `purpose`                                                         | `'practice' \| 'game'`                                                                                                                             |
|                                          | `previousReceiverGeneration?`                                     | 0 이상 안전 정수                                                                                                                                   |
| `mediaGrantSchema` (HTTP 응답)           | 미디어 범위 3필드                                                 | 위와 같음                                                                                                                                          |
|                                          | `url`, `token`, `roomName`                                        | 각각 1자 이상 문자열                                                                                                                               |
|                                          | `mediaIdentity`                                                   | ID                                                                                                                                                 |
|                                          | `expiresAt`                                                       | 양의 안전 정수, **epoch 초**                                                                                                                       |
|                                          | `subscriptionMode?`                                               | `'publisher-permissions' \| 'server-forwarding'`                                                                                                   |
|                                          | `facePublication?`                                                | `{ url, token, roomName, mediaIdentity }`                                                                                                          |
| `mediaStatusReportSchema` (HTTP 요청)    | 미디어 범위 + `status`                                            | `'ready' \| 'recovering' \| 'failed' \| 'closed'`                                                                                                  |
| `mediaBindingsSchema` (`media-bindings`) | 미디어 범위 + `bindingRevision`                                   | 0 이상 안전 정수                                                                                                                                   |
|                                          | `participants[]`                                                  | **최대 6개**                                                                                                                                       |
| 참가자 항목                              | `playerId`, `mediaIdentity`, `participantSid`                     | ID                                                                                                                                                 |
|                                          | `publisherGeneration`                                             | 0 이상 안전 정수                                                                                                                                   |
|                                          | `facePublisher?`                                                  | `{ mediaIdentity: ID, participantSid: ID }`                                                                                                        |
|                                          | `faceTrackSid?`, `audioTrackSid?`                                 | ID                                                                                                                                                 |
| `audioPolicySchema` (`audio-policy`)     | 미디어 범위 + `policyRevision`, `bindingRevision`, `stateVersion` | 0 이상 안전 정수                                                                                                                                   |
|                                          | `publisherPermissions?`                                           | **최대 5개**, 각 `{ participantIdentity: ID, allowedTrackSids: ID[] 최대 2개 }`                                                                    |
|                                          | `voices[]`                                                        | 상한 없음, 각 `{ playerId: ID, trackSid: ID, gain: 0~1 유한, azimuthRad: 유한, lowpassHz: 양의 유한 }`                                             |
|                                          | `effects[]`                                                       | 상한 없음, 각 `{ eventId: ID, kind: 'footstep' \| 'sensor' \| 'trap', gain: 0~1, azimuthRad: 유한, lowpassHz: 양의 유한, tick: 0 이상 안전 정수 }` |
| `mediaRefreshRequestSchema`              | 미디어 범위 + `lastBindingRevision`                               | 0 이상 안전 정수                                                                                                                                   |

근거: [media.ts:8](../../packages/protocol/src/game-messages/media.ts#L8), [media.ts:11](../../packages/protocol/src/game-messages/media.ts#L11), [media.ts:18](../../packages/protocol/src/game-messages/media.ts#L18), [media.ts:23](../../packages/protocol/src/game-messages/media.ts#L23), [media.ts:24](../../packages/protocol/src/game-messages/media.ts#L24), [media.ts:27](../../packages/protocol/src/game-messages/media.ts#L27), [media.ts:29](../../packages/protocol/src/game-messages/media.ts#L29), [media.ts:33](../../packages/protocol/src/game-messages/media.ts#L33), [media.ts:34](../../packages/protocol/src/game-messages/media.ts#L34), [media.ts:40](../../packages/protocol/src/game-messages/media.ts#L40), [media.ts:43](../../packages/protocol/src/game-messages/media.ts#L43), [media.ts:48](../../packages/protocol/src/game-messages/media.ts#L48), [media.ts:57](../../packages/protocol/src/game-messages/media.ts#L57), [media.ts:70](../../packages/protocol/src/game-messages/media.ts#L70), [media.ts:77](../../packages/protocol/src/game-messages/media.ts#L77), [media.ts:79](../../packages/protocol/src/game-messages/media.ts#L79), [media.ts:80](../../packages/protocol/src/game-messages/media.ts#L80), [media.ts:93](../../packages/protocol/src/game-messages/media.ts#L93), [GrantIssuer.ts:266](../../server/src/media/GrantIssuer.ts#L266), [media.ts:109](../../packages/protocol/src/game-messages/media.ts#L109), [media.ts:114](../../packages/protocol/src/game-messages/media.ts#L114).

`mediaGrantSchema`는 추가 검사를 한다. `subscriptionMode`가 `'server-forwarding'`인 것과 `facePublication`이 있는 것이 정확히 일치해야 하고, `facePublication`이 있으면 그 `url`은 본 grant의 `url`과 같아야 하며 `token`·`roomName`·`mediaIdentity`는 본 grant와 모두 달라야 한다. 어기면 `INVALID_SPLIT_MEDIA_GRANT` 이슈로 거절된다. 웹이 grant 응답을 이 스키마로 파싱한다.

근거: [media.ts:95](../../packages/protocol/src/game-messages/media.ts#L95), [media.ts:98](../../packages/protocol/src/game-messages/media.ts#L98), [media.ts:100](../../packages/protocol/src/game-messages/media.ts#L100), [media.ts:105](../../packages/protocol/src/game-messages/media.ts#L105), [product-runtime.ts:570](../../apps/web/src/app/product-runtime.ts#L570).

서버는 `media-bindings`와 `audio-policy`를 수신자별로 보내기 전에 적 참가자의 `playerId`를 그 수신자에게 보이는 별칭으로 바꾼다. 그래서 두 메시지의 `playerId`는 실제 ID가 아닐 수 있고, 같은 별칭이 개인 뷰의 보이는 엔터티 ID와 맞춰진다. `media-bindings-refresh`에 대해 웹은 `mediaRefreshRequestSchema` 모양(`{ ...미디어 범위, lastBindingRevision }`)을 보내되 `lastBindingRevision`은 늘 `0`으로 고정해 보내고, 서버 처리기는 payload를 읽지 않는다.

근거: [KkakkungRoom.ts:563](../../server/src/rooms/KkakkungRoom.ts#L563), [KkakkungRoom.ts:565](../../server/src/rooms/KkakkungRoom.ts#L565), [KkakkungRoom.ts:1160](../../server/src/rooms/KkakkungRoom.ts#L1160), [KkakkungRoom.ts:675](../../server/src/rooms/KkakkungRoom.ts#L675), [product-runtime.ts:1083](../../apps/web/src/app/product-runtime.ts#L1083).

| `MEDIA_ROUTES` 키 | 경로                   | 서버에서의 사용                      |
| ----------------- | ---------------------- | ------------------------------------ |
| `grants`          | `/api/media/grants`    | POST, 본문 `mediaGrantRequestSchema` |
| `report`          | `/api/media/report`    | POST, 본문 `mediaStatusReportSchema` |
| `webhook`         | `/api/livekit/webhook` | POST, 원문 본문(서명 검증용)         |

근거: [media.ts:119](../../packages/protocol/src/game-messages/media.ts#L119), [bootstrap.ts:351](../../server/src/bootstrap.ts#L351), [bootstrap.ts:515](../../server/src/bootstrap.ts#L515), [bootstrap.ts:520](../../server/src/bootstrap.ts#L520), [bootstrap.ts:540](../../server/src/bootstrap.ts#L540), [bootstrap.ts:545](../../server/src/bootstrap.ts#L545), [bootstrap.ts:702](../../server/src/bootstrap.ts#L702).

## 15. HTTP 계약과 제품 join option

### 경로 상수

이 패키지가 가진 HTTP 경로 문자열은 아래가 전부다(미디어 3개는 14절). 이 패키지 상수가 아닌 경로 문자열은 모두 서버 리터럴이며 [server.md](server.md#4-http)가 소유한다.

| 상수                     | 경로                               | 메서드(서버 기준)                           | 요청 스키마                                       | 성공 응답 스키마                                                  |
| ------------------------ | ---------------------------------- | ------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| `SESSION_ROUTE`          | `/api/sessions`                    | POST                                        | `sessionRequestSchema`                            | `sessionResponseSchema` (201)                                     |
| `SESSION_ACCESS_ROUTE`   | `/api/sessions/access`             | GET                                         | 없음                                              | `sessionAccessResponseSchema`                                     |
| `SESSION_CANCEL_ROUTE`   | `/api/sessions/current`            | DELETE, `Authorization: Bearer <세션 토큰>` | `sessionCancelRequestSchema` = `{}`(빈 본문 허용) | 본문 없음 (204)                                                   |
| `ROOM_INVITATION_ROUTE`  | `/api/sessions/current/invitation` | POST(발급·회전)·DELETE(폐기), Bearer        | `roomInvitationRequestSchema` = `{}`              | POST `roomInvitationResponseSchema` (201), DELETE 본문 없음 (204) |
| `SERVICE_CAPACITY_ROUTE` | `/api/capacity`                    | GET                                         | 없음                                              | `serviceCapacitySchema`                                           |
| `DEMO_ROOM_ROUTE`        | `/api/operations/demo-rooms`       | POST, 운영 Bearer                           | `demoRoomRequestSchema`                           | `demoRoomResponseSchema` (201)                                    |
| `DEMO_ADMIN_ROOM_ROUTE`  | `/api/demo-admin/rooms`            | POST, SSO 관리자 헤더                       | `demoRoomRequestSchema`                           | `demoRoomResponseSchema` (201)                                    |
| `SHOWCASE_ROOM_ROUTE`    | `/api/showcase/rooms`              | POST, SSO 관리자 헤더                       | `showcaseRoomRequestSchema`                       | `showcaseRoomResponseSchema` (201)                                |

근거: [session.ts:5](../../packages/protocol/src/game-messages/session.ts#L5), [session.ts:7](../../packages/protocol/src/game-messages/session.ts#L7), [session.ts:13](../../packages/protocol/src/game-messages/session.ts#L13), [session.ts:14](../../packages/protocol/src/game-messages/session.ts#L14), [session.ts:26](../../packages/protocol/src/game-messages/session.ts#L26), [session.ts:73](../../packages/protocol/src/game-messages/session.ts#L73), [session.ts:74](../../packages/protocol/src/game-messages/session.ts#L74), [session.ts:96](../../packages/protocol/src/game-messages/session.ts#L96), [session.ts:102](../../packages/protocol/src/game-messages/session.ts#L102), [session.ts:125](../../packages/protocol/src/game-messages/session.ts#L125), [SessionRoutes.ts:99](../../server/src/session/SessionRoutes.ts#L99), [SessionRoutes.ts:143](../../server/src/session/SessionRoutes.ts#L143), [SessionRoutes.ts:144](../../server/src/session/SessionRoutes.ts#L144), [SessionRoutes.ts:145](../../server/src/session/SessionRoutes.ts#L145), [SessionRoutes.ts:297](../../server/src/session/SessionRoutes.ts#L297), [DemoRoutes.ts:48](../../server/src/session/DemoRoutes.ts#L48), [DemoRoutes.ts:107](../../server/src/session/DemoRoutes.ts#L107), [DemoRoutes.ts:124](../../server/src/session/DemoRoutes.ts#L124).

### 요청·응답 형상

| 스키마                             | 필드                                                                                                                                 | 제약                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `sessionRequestSchema` 방 만들기   | `nickname`, `inviteToken?`, `createRoom: true`                                                                                       | `roomCode`가 있으면 거절                  |
| `sessionRequestSchema` 방 들어가기 | `nickname`, `inviteToken?`, `createRoom: false`, `roomCode`                                                                          | `roomCode` 필수                           |
| `sessionResponseSchema`            | `sessionToken: 1자 이상`, `playerId: 1자 이상`, `roomCode`, `expiresAt: 양의 안전 정수(epoch ms)`, `protocolVersion: '0.2.0'` 리터럴 | 다른 버전 문자열이면 거절                 |
| `sessionAccessResponseSchema`      | `method`                                                                                                                             | `'invitation' \| 'gitlab-sso' \| 'guest'` |
| `roomInvitationResponseSchema`     | `inviteToken`, `roomCode`, `expiresAt: 양의 안전 정수`                                                                               | —                                         |
| `serviceCapacitySchema`            | `matchesInUse`, `matchLimit`, `lobbyRoomsInUse`, `lobbyRoomLimit`                                                                    | 각각 0 이상 정수                          |
|                                    | `admissionOpen`, `mediaBlocked`                                                                                                      | boolean                                   |
| `demoRoomRequestSchema`            | `role: 'runner' \| 'tagger'`, `nickname?`                                                                                            | —                                         |
| `demoRoomResponseSchema`           | `sessionToken`, `playerId`, `roomCode`, `role`, `expiresAt`, `protocolVersion: '0.2.0'`, `entryFragment: 1~1024자`                   | —                                         |
| `showcaseRoomRequestSchema`        | `role: 'runner' \| 'tagger'`, `nickname?`                                                                                            | —                                         |
| `showcaseRoomResponseSchema`       | 데모 응답과 같은 7필드                                                                                                               | `entryFragment` 1~1024자                  |

서버가 만드는 `entryFragment`는 데모가 `#demo=<토큰>&room=<코드>&player=<ID>`, 시연이 `#showcase=<토큰>&room=<코드>&player=<ID>`이다. 세션·초대 응답의 `expiresAt`은 epoch ms다. 데모·시연 응답의 `expiresAt`은 세션 만료가 아니라 첫 연결 전 입장 마감 시각(`admissionExpiresAt`, 없으면 세션 만료)이며 역시 epoch ms다. 미디어 grant의 `expiresAt`은 epoch 초라서 같은 이름의 단위가 다르다.

근거: [session.ts:47](../../packages/protocol/src/game-messages/session.ts#L47), [session.ts:48](../../packages/protocol/src/game-messages/session.ts#L48), [session.ts:53](../../packages/protocol/src/game-messages/session.ts#L53), [session.ts:62](../../packages/protocol/src/game-messages/session.ts#L62), [session.ts:67](../../packages/protocol/src/game-messages/session.ts#L67), [session.ts:68](../../packages/protocol/src/game-messages/session.ts#L68), [session.ts:8](../../packages/protocol/src/game-messages/session.ts#L8), [session.ts:75](../../packages/protocol/src/game-messages/session.ts#L75), [session.ts:28](../../packages/protocol/src/game-messages/session.ts#L28), [session.ts:103](../../packages/protocol/src/game-messages/session.ts#L103), [session.ts:108](../../packages/protocol/src/game-messages/session.ts#L108), [session.ts:116](../../packages/protocol/src/game-messages/session.ts#L116), [session.ts:126](../../packages/protocol/src/game-messages/session.ts#L126), [session.ts:131](../../packages/protocol/src/game-messages/session.ts#L131), [DemoRoutes.ts:88](../../server/src/session/DemoRoutes.ts#L88), [ShowcaseRoutes.ts:88](../../server/src/session/ShowcaseRoutes.ts#L88), [DemoRoutes.ts:86](../../server/src/session/DemoRoutes.ts#L86), [ShowcaseRoutes.ts:86](../../server/src/session/ShowcaseRoutes.ts#L86), [bootstrap.ts:195](../../server/src/bootstrap.ts#L195), [bootstrap.ts:272](../../server/src/bootstrap.ts#L272), [media.ts:93](../../packages/protocol/src/game-messages/media.ts#L93), [GrantIssuer.ts:266](../../server/src/media/GrantIssuer.ts#L266), [room-roster.test.ts:66](../../packages/protocol/test/room-roster.test.ts#L66).

### HTTP 오류 코드 세트

모든 오류 응답 본문은 `{ error: <코드> }`다. 아래 표에서 "세트"는 이 패키지가 선언한 목록이고, "데모"는 이 패키지에 목록이 없어 서버 리터럴을 옮겨 적은 것이다.

| 세트                          | 코드                     | HTTP 상태 | 서버가 내는 조건                                                       |
| ----------------------------- | ------------------------ | --------- | ---------------------------------------------------------------------- |
| `SESSION_ERROR_CODES`         | `INVALID_REQUEST`        | 400       | 본문이 `sessionRequestSchema`와 다름                                   |
|                               | `INVALID_INVITATION`     | 403       | 초대 토큰·SSO·게스트 생성 중 어느 것으로도 확인되지 않음               |
|                               | `ROOM_NOT_AVAILABLE`     | 404       | 들어가려는 방이 없거나 닫힘                                            |
|                               | `RATE_LIMITED`           | 429       | 출처별·초대(계정)별 시도 한도 초과                                     |
|                               | `ADMISSION_CLOSED`       | 503       | 입장이 열려 있지 않거나 한도기가 없음, 예약 도중 닫힘                  |
|                               | `CAPACITY`               | 503       | 서비스 방·좌석 한도, 발급 실패                                         |
|                               | `ROOM_FULL`              | 503       | 그 방의 자리가 참                                                      |
|                               | `TOO_MANY_ROOMS`         | 429       | 이 호출자(출처·계정)가 열어 둔 방 수 상한                              |
|                               | `ALREADY_IN_ROOM`        | 409       | 같은 SSO 계정이 이미 접속한 자리를 가짐                                |
| `SESSION_CANCEL_ERROR_CODES`  | `INVALID_REQUEST`        | 400       | 본문이 빈 객체가 아님                                                  |
|                               | `INVALID_SESSION`        | 401       | Bearer 헤더가 없거나 비어 있음(알 수 없는·만료 토큰은 204로 성공 처리) |
|                               | `SESSION_IN_USE`         | 409       | 그 세션이 접속 중이거나 자리가 `JOINED`·`RETIRING`                     |
| `ROOM_INVITATION_ERROR_CODES` | `INVALID_REQUEST`        | 400       | 본문이 빈 객체가 아님                                                  |
|                               | `INVALID_SESSION`        | 401       | Bearer 세션 인증 실패                                                  |
|                               | `INVITATION_UNAVAILABLE` | 403 / 503 | 초대 기능 없음·세션 미접속·관리 권한 없음(403), 회전 실패(503)         |
|                               | `RATE_LIMITED`           | 429       | 방장 초대 조작 한도 초과                                               |
|                               | `ADMISSION_CLOSED`       | 503       | 입장이 닫혀 있을 때의 발급(폐기는 허용)                                |
| `SHOWCASE_ERROR_CODES`        | `UNAUTHORIZED`           | 401       | SSO 관리자 요청이 아님                                                 |
|                               | `ADMISSION_CLOSED`       | 503       | 서버 준비 안 됨                                                        |
|                               | `INVALID_REQUEST`        | 400       | 본문 불일치                                                            |
|                               | `CAPACITY`               | 503       | 시연 방 한도·발급 실패·예약 실패                                       |
|                               | `ROLE_FULL`              | 409       | 고른 역할 자리가 참                                                    |
|                               | `SHOWCASE_UNAVAILABLE`   | 503       | 시연 기능이 꺼진 배포                                                  |
| 데모(목록 없음)               | `UNAUTHORIZED`           | 401       | 운영 Bearer 또는 SSO 관리자 확인 실패                                  |
|                               | `INVALID_REQUEST`        | 400       | 본문 불일치                                                            |
|                               | `CAPACITY`               | 503       | 방 코드·세션 발급 실패, 서비스 한도                                    |
|                               | `DEMO_ROOM_LIMIT`        | 503       | 데모 방 자체 한도                                                      |
|                               | `DEMO_UNAVAILABLE`       | 503       | 데모 기능이 꺼진 배포                                                  |

`/api/sessions`로 시작하는 모든 경로 앞에는 출처별 요청 한도 미들웨어가 붙어 429 `RATE_LIMITED`를 낸다. 그래서 취소 경로도 목록에 없는 `RATE_LIMITED`를 받을 수 있다.

근거: [SessionRoutes.ts:155](../../server/src/session/SessionRoutes.ts#L155), [SessionRoutes.ts:157](../../server/src/session/SessionRoutes.ts#L157), [session.ts:155](../../packages/protocol/src/game-messages/session.ts#L155), [session.ts:15](../../packages/protocol/src/game-messages/session.ts#L15), [session.ts:81](../../packages/protocol/src/game-messages/session.ts#L81), [session.ts:143](../../packages/protocol/src/game-messages/session.ts#L143), [SessionRoutes.ts:78](../../server/src/session/SessionRoutes.ts#L78), [SessionRoutes.ts:86](../../server/src/session/SessionRoutes.ts#L86), [SessionRoutes.ts:112](../../server/src/session/SessionRoutes.ts#L112), [SessionRoutes.ts:117](../../server/src/session/SessionRoutes.ts#L117), [SessionRoutes.ts:123](../../server/src/session/SessionRoutes.ts#L123), [SessionRoutes.ts:131](../../server/src/session/SessionRoutes.ts#L131), [SessionRoutes.ts:136](../../server/src/session/SessionRoutes.ts#L136), [SessionRoutes.ts:138](../../server/src/session/SessionRoutes.ts#L138), [SessionRoutes.ts:149](../../server/src/session/SessionRoutes.ts#L149), [SessionRoutes.ts:152](../../server/src/session/SessionRoutes.ts#L152), [SessionRoutes.ts:165](../../server/src/session/SessionRoutes.ts#L165), [SessionRoutes.ts:177](../../server/src/session/SessionRoutes.ts#L177), [SessionRoutes.ts:179](../../server/src/session/SessionRoutes.ts#L179), [SessionRoutes.ts:203](../../server/src/session/SessionRoutes.ts#L203), [SessionRoutes.ts:208](../../server/src/session/SessionRoutes.ts#L208), [SessionRoutes.ts:219](../../server/src/session/SessionRoutes.ts#L219), [SessionRoutes.ts:256](../../server/src/session/SessionRoutes.ts#L256), [SessionRoutes.ts:257](../../server/src/session/SessionRoutes.ts#L257), [SessionRoutes.ts:277](../../server/src/session/SessionRoutes.ts#L277), [SessionRoutes.ts:262](../../server/src/session/SessionRoutes.ts#L262), [SessionRoutes.ts:278](../../server/src/session/SessionRoutes.ts#L278), [SessionRoutes.ts:282](../../server/src/session/SessionRoutes.ts#L282), [SessionRoutes.ts:288](../../server/src/session/SessionRoutes.ts#L288), [ShowcaseRoutes.ts:51](../../server/src/session/ShowcaseRoutes.ts#L51), [ShowcaseRoutes.ts:52](../../server/src/session/ShowcaseRoutes.ts#L52), [ShowcaseRoutes.ts:54](../../server/src/session/ShowcaseRoutes.ts#L54), [ShowcaseRoutes.ts:59](../../server/src/session/ShowcaseRoutes.ts#L59), [ShowcaseRoutes.ts:71](../../server/src/session/ShowcaseRoutes.ts#L71), [ShowcaseRoutes.ts:79](../../server/src/session/ShowcaseRoutes.ts#L79), [ShowcaseRoutes.ts:111](../../server/src/session/ShowcaseRoutes.ts#L111), [DemoRoutes.ts:37](../../server/src/session/DemoRoutes.ts#L37), [DemoRoutes.ts:51](../../server/src/session/DemoRoutes.ts#L51), [DemoRoutes.ts:64](../../server/src/session/DemoRoutes.ts#L64), [DemoRoutes.ts:76](../../server/src/session/DemoRoutes.ts#L76), [DemoRoutes.ts:137](../../server/src/session/DemoRoutes.ts#L137).

위 세트는 각 라우트가 직접 내는 코드다. 라우트에 닿기 전 HTTP 경계가 같은 `{ error }` 모양으로 먼저 거절하는 코드가 따로 있다. 경계 순서와 한도 값은 [server.md](server.md#41-요청-경계와-순서)가 소유한다.

| 코드                 | HTTP 상태 | 경계가 내는 조건                                                                                                                            |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMITED`       | 429       | `/api/operations/*`·`/api/media/grants`·`/api/media/report` 요청 한도(`ProductHttpLimiter`), `/api/sessions*`·`/matchmake/*` 입장 요청 한도 |
| `ORIGIN_NOT_ALLOWED` | 403       | `Origin` 헤더가 허용 목록에 없음                                                                                                            |
| `PAYLOAD_TOO_LARGE`  | 413       | 본문이 있는 `/api/`·`/matchmake/` 요청의 본문이 상한 초과                                                                                   |
| `BODY_TIMEOUT`       | 408       | 본문 수신 시간 초과                                                                                                                         |
| `INVALID_JSON`       | 400       | `application/json` 본문 파싱 실패                                                                                                           |
| `INVALID_REQUEST`    | 400       | 본문 수신 중 스트림 오류, 서버 오류 처리기로 넘어간 요청                                                                                    |
| `INTERNAL_ERROR`     | 500       | 하위 요청 처리기가 예외를 던짐                                                                                                              |

그래서 `DEMO_ROOM_ROUTE`는 목록 밖의 429 `RATE_LIMITED`를, 모든 요청은 목록 밖의 403·500을, 본문이 있는 `/api/`·`/matchmake/` 요청은 413·408·400(`INVALID_JSON`)도 받을 수 있다. 웹 세션 발급은 이 코드들이 `SESSION_ERROR_CODES`에 없으면 `CONNECTION_FAILED`로 바꾼다.

근거: [HttpBoundary.ts:73](../../server/src/session/HttpBoundary.ts#L73), [HttpBoundary.ts:80](../../server/src/session/HttpBoundary.ts#L80), [HttpBoundary.ts:87](../../server/src/session/HttpBoundary.ts#L87), [HttpBoundary.ts:102](../../server/src/session/HttpBoundary.ts#L102), [HttpBoundary.ts:115](../../server/src/session/HttpBoundary.ts#L115), [HttpBoundary.ts:157](../../server/src/session/HttpBoundary.ts#L157), [HttpBoundary.ts:168](../../server/src/session/HttpBoundary.ts#L168), [ProductHttpLimiter.ts:45](../../server/src/session/ProductHttpLimiter.ts#L45), [ProductHttpLimiter.ts:46](../../server/src/session/ProductHttpLimiter.ts#L46), [bootstrap.ts:704](../../server/src/bootstrap.ts#L704), [bootstrap.ts:707](../../server/src/bootstrap.ts#L707), [bootstrap.ts:557](../../server/src/bootstrap.ts#L557), [product-session.ts:81](../../apps/web/src/features/room/product-session.ts#L81).

웹에서 코드 목록이 쓰이는 곳은 두 곳이다. 세션 발급 실패는 응답 코드가 `SESSION_ERROR_CODES`에 있으면 그 코드를, 없으면 `CONNECTION_FAILED`를 오류로 던진다. 초대 조작 실패는 `ROOM_INVITATION_ERROR_CODES`에 없으면 `UNKNOWN`으로 바꾼다. 데모·시연 발급 실패는 목록 대조 없이 `DEMO_REQUEST_FAILED:<상태>[:<코드>]`, `SHOWCASE_REQUEST_FAILED:<상태>[:<코드>]` 문자열로 넘긴다. `SESSION_CANCEL_ERROR_CODES`와 `SHOWCASE_ERROR_CODES`는 웹에서 목록으로 읽는 곳이 없다(서버는 `SHOWCASE_ERROR_CODES`에서 만든 타입 `ShowcaseErrorCode`로만 쓴다).

근거: [product-session.ts:81](../../apps/web/src/features/room/product-session.ts#L81), [RoomInvitationControls.tsx:62](../../apps/web/src/features/room/RoomInvitationControls.tsx#L62), [product-session.ts:122](../../apps/web/src/features/room/product-session.ts#L122), [product-session.ts:211](../../apps/web/src/features/room/product-session.ts#L211), [ShowcaseRoutes.ts:43](../../server/src/session/ShowcaseRoutes.ts#L43).

### 제품 Room join option

제품 `kkakkung` Room의 입장 option은 `productJoinOptionsSchema` = `{ token: 1자 이상 문자열, roomCode: roomCode, protocolVersion: 문자열 }`이다. `protocolVersion`은 스키마에서 아무 문자열이나 받고, 서버 `onAuth`가 `'0.2.0'`과 비교한다. 서버는 형상이 틀리면 400 `INVALID_JOIN`, 버전이 다르면 409 `PROTOCOL_MISMATCH`를 던진다. 웹은 세션 응답의 토큰·방 코드와 `PRODUCT_PROTOCOL_VERSION`으로 이 option을 만든다. 그 밖의 입장 거절 코드는 [server.md](server.md#8-제품-room)가 소유한다.

근거: [session.ts:181](../../packages/protocol/src/game-messages/session.ts#L181), [session.ts:184](../../packages/protocol/src/game-messages/session.ts#L184), [KkakkungRoom.ts:596](../../server/src/rooms/KkakkungRoom.ts#L596), [KkakkungRoom.ts:597](../../server/src/rooms/KkakkungRoom.ts#L597), [KkakkungRoom.ts:598](../../server/src/rooms/KkakkungRoom.ts#L598), [product-session.ts:132](../../apps/web/src/features/room/product-session.ts#L132), [room-roster.test.ts:106](../../packages/protocol/test/room-roster.test.ts#L106).

## 16. 데모 방 메시지

데모 방은 운영자 한 명과 서버가 움직이는 인형으로 채운 방이다. 시나리오 목록은 서버가 쥐고, 클라이언트는 받은 ID 중 하나를 고를 뿐 동작을 기술하지 않는다.

| 스키마                                        | 필드                              | 제약                                                                                                |
| --------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `demoScenarioRequestSchema` (`demo-scenario`) | `matchId`, `scenario`, `options?` | `scenario`는 `DEMO_SCENARIO_IDS` 중 하나                                                            |
| `demoScenarioOptionsSchema`                   | `role?`                           | `'runner' \| 'tagger'`                                                                              |
|                                               | `distance?`                       | 리터럴 `1` \| `2` \| `3` \| `4` \| `5`                                                              |
|                                               | `side?`                           | `'front' \| 'left' \| 'right' \| 'back'`                                                            |
|                                               | `facing?`                         | `'toward' \| 'away'`                                                                                |
|                                               | `installer?`                      | `'puppet' \| 'me'`                                                                                  |
| `demoControlSchema` (`demo-control`)          | `matchId`, `action`               | `'abort-round'`(라운드 중단) \| `'cancel-scenario'`(도는 대본만 내림)                               |
| `demoStateSchema` (`demo-state`)              | `matchId`                         | `matchId`                                                                                           |
|                                               | `available[]`                     | 최대 22개, 각 `{ id: 시나리오 ID, options: 옵션 키 배열 최대 5개, unavailable?: 64자 이하 문자열 }` |
|                                               | `running`                         | 시나리오 ID \| `null`                                                                               |
|                                               | `step`                            | 128자 이하 문자열 \| `null`                                                                         |
|                                               | `failureCode`                     | 128자 이하 문자열 \| `null`                                                                         |
|                                               | `completed`                       | 시나리오 ID \| `null`, 없으면 `null`로 채움                                                         |
|                                               | `outcomeSeq`                      | 0 이상 정수, 없으면 `0`으로 채움                                                                    |
|                                               | `operatorExit`                    | `{ x: 정수, y: 정수 }` \| `null`                                                                    |

근거: [product.ts:254](../../packages/protocol/src/game-messages/product.ts#L254), [product.ts:255](../../packages/protocol/src/game-messages/product.ts#L255), [product.ts:258](../../packages/protocol/src/game-messages/product.ts#L258), [product.ts:265](../../packages/protocol/src/game-messages/product.ts#L265), [product.ts:271](../../packages/protocol/src/game-messages/product.ts#L271), [product.ts:277](../../packages/protocol/src/game-messages/product.ts#L277), [product.ts:280](../../packages/protocol/src/game-messages/product.ts#L280), [product.ts:282](../../packages/protocol/src/game-messages/product.ts#L282), [product.ts:288](../../packages/protocol/src/game-messages/product.ts#L288), [product.ts:291](../../packages/protocol/src/game-messages/product.ts#L291), [product.ts:293](../../packages/protocol/src/game-messages/product.ts#L293), [product.ts:295](../../packages/protocol/src/game-messages/product.ts#L295), [product.ts:297](../../packages/protocol/src/game-messages/product.ts#L297), [product.ts:299](../../packages/protocol/src/game-messages/product.ts#L299), [product.ts:304](../../packages/protocol/src/game-messages/product.ts#L304), [product.ts:305](../../packages/protocol/src/game-messages/product.ts#L305).

`DEMO_SCENARIO_IDS`는 22개이며, 서버 `DEMO_SCENARIOS`와 같은 순서·같은 값이다. 옵션 도메인은 스키마가 정하지만 시나리오마다 실제로 받는 키는 서버 `SCENARIO_OPTIONS`가 정하고, 받지 않는 키가 오면 `UNSUPPORTED_OPTION`으로 거절된다. 서버는 각 `available` 항목의 `options`에 이 목록을 실어 보낸다.

| 순서 | 시나리오 ID              | 서버가 받는 옵션 키                  |
| ---: | ------------------------ | ------------------------------------ |
|    1 | `place-me-at-exit`       | 없음                                 |
|    2 | `place-puppet`           | `role`, `side`, `distance`, `facing` |
|    3 | `approach`               | `role`, `distance`                   |
|    4 | `cross-my-view`          | `role`                               |
|    5 | `turn-before-me`         | `role`, `distance`                   |
|    6 | `trap`                   | `installer`                          |
|    7 | `sensor`                 | `installer`                          |
|    8 | `device-states`          | 없음                                 |
|    9 | `double-trap-immunity`   | 없음                                 |
|   10 | `capture`                | 없음                                 |
|   11 | `capture-one`            | 없음                                 |
|   12 | `capture-in-challenge`   | 없음                                 |
|   13 | `caught-in-my-challenge` | 없음                                 |
|   14 | `exit`                   | 없음                                 |
|   15 | `exchange`               | 없음                                 |
|   16 | `exchange-cancel`        | 없음                                 |
|   17 | `accept-my-exchange`     | 없음                                 |
|   18 | `exchange-trace`         | 없음                                 |
|   19 | `spectate-then-capture`  | 없음                                 |
|   20 | `result-tagger-win`      | 없음                                 |
|   21 | `result-runner-win`      | 없음                                 |
|   22 | `abort-connection-lost`  | 없음                                 |

근거: [product.ts:226](../../packages/protocol/src/game-messages/product.ts#L226), [product.ts:230](../../packages/protocol/src/game-messages/product.ts#L230), [product.ts:251](../../packages/protocol/src/game-messages/product.ts#L251), [DemoScenarios.ts:11](../../server/src/rooms/DemoScenarios.ts#L11), [DemoScenarios.ts:65](../../server/src/rooms/DemoScenarios.ts#L65), [DemoScenarios.ts:344](../../server/src/rooms/DemoScenarios.ts#L344), [KkakkungRoom.ts:1555](../../server/src/rooms/KkakkungRoom.ts#L1555).

`available[].unavailable`과 `failureCode`는 스키마에서 길이만 제한한 문자열이고, 값은 서버가 채운다. `unavailable`에는 서버 `DEMO_REJECTIONS` 20개(`OPERATOR_NOT_ACTIVE`, `NO_OPERATOR_STATE`, `OPERATOR_MUST_BE_RUNNER`, `OPERATOR_MUST_BE_TAGGER`, `NO_OPERATOR_EXIT`, `NO_PUPPET`, `NO_TAGGER_PUPPET`, `NO_RUNNER_PUPPET`, `NEED_TWO_RUNNER_PUPPETS`, `NEED_ONE_PAIR`, `NEED_TWO_PAIRS`, `NO_EXIT_FOR_PUPPET`, `NO_ROOM_TO_INSTALL`, `NO_WALL_TO_MOUNT`, `NO_ROOM_TO_RETREAT`, `NO_ROOM_FOR_TWO_TRAPS`, `CELL_UNAVAILABLE`, `NO_CROSSING_PATH`, `NO_EXCHANGE_PARTNER`, `UNSUPPORTED_OPTION`) 중 하나가 들어간다. 경기 전에는 22개 전부를 `unavailable` 없이 보내고, 경기 중에도 22개 전부를 보내되 지금 시작할 수 없는 대본에만 `unavailable`(거절 코드)을 붙인다.

`failureCode`는 세 모양이다.

| 경우              | 모양                        | 이유 값                                                                                                                             |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 시작 거절         | `<시나리오 ID>:<거절 코드>` | `DEMO_REJECTIONS` 20개 중 하나(옵션이 맞지 않으면 `UNSUPPORTED_OPTION`)                                                             |
| 운영자 취소       | `<시나리오 ID>:CANCELED`    | `CANCELED`                                                                                                                          |
| 진행 중 단계 실패 | `<단계 라벨>:<이유>`        | `DEMO_FAILURE_REASONS` 중 `TIMEOUT`, `FAILED`, `NO_INSTALL_FROM_OPERATOR`, `NO_REQUEST_FROM_OPERATOR`, `NO_CHALLENGE_FROM_OPERATOR` |

`DEMO_FAILURE_REASONS`는 이 6개(`TIMEOUT`, `FAILED`, `CANCELED`, `NO_INSTALL_FROM_OPERATOR`, `NO_REQUEST_FROM_OPERATOR`, `NO_CHALLENGE_FROM_OPERATOR`)이며 명령 코드 `COMMAND_CODES`의 `CANCELED`와는 다른 집합이다.

근거: [DemoScenarios.ts:95](../../server/src/rooms/DemoScenarios.ts#L95), [DemoScenarios.ts:123](../../server/src/rooms/DemoScenarios.ts#L123), [DemoScenarios.ts:333](../../server/src/rooms/DemoScenarios.ts#L333), [DemoScenarios.ts:335](../../server/src/rooms/DemoScenarios.ts#L335), [DemoScenarios.ts:395](../../server/src/rooms/DemoScenarios.ts#L395), [DemoScenarios.ts:408](../../server/src/rooms/DemoScenarios.ts#L408), [DemoScenarios.ts:421](../../server/src/rooms/DemoScenarios.ts#L421), [DemoScenarios.ts:424](../../server/src/rooms/DemoScenarios.ts#L424), [KkakkungRoom.ts:1552](../../server/src/rooms/KkakkungRoom.ts#L1552), [KkakkungRoom.ts:1563](../../server/src/rooms/KkakkungRoom.ts#L1563).

서버는 `demo-scenario`·`demo-control`을 스키마와 현재 `matchId`로 검사하고, 데모 방이 아니거나 보낸 사람이 운영자가 아니면 아무 응답 없이 무시한다. `abort-round`는 `MAP_FINALIZING`·`GAME_LOADING`·`COUNTDOWN`·`PLAYING`에서만 다음 틱의 `DEMO_OPERATOR_ABORT` 중단을 예약한다.

근거: [KkakkungRoom.ts:657](../../server/src/rooms/KkakkungRoom.ts#L657), [KkakkungRoom.ts:663](../../server/src/rooms/KkakkungRoom.ts#L663), [KkakkungRoom.ts:1524](../../server/src/rooms/KkakkungRoom.ts#L1524), [KkakkungRoom.ts:1533](../../server/src/rooms/KkakkungRoom.ts#L1533), [KkakkungRoom.ts:1541](../../server/src/rooms/KkakkungRoom.ts#L1541), [KkakkungRoom.ts:1122](../../server/src/rooms/KkakkungRoom.ts#L1122).

## 17. 스키마 런타임 스위치

`useJitlessSchemas()`는 zod 전역 설정을 `{ jitless: true }`로 바꿔, 객체 스키마 파서를 `new Function`으로 만들지 않게 한다. 그러면 브라우저 CSP에 `'unsafe-eval'`이 필요 없다. 첫 parse 전에 불러야 하며 이미 만들어진 파서는 되돌리지 않는다. 웹은 앱 모듈에서 import 시점에 한 번 부르고, 서버는 부르지 않는다.

근거: [schema-runtime.ts:15](../../packages/protocol/src/schema-runtime.ts#L15), [schema-runtime.ts:16](../../packages/protocol/src/schema-runtime.ts#L16), [schema-runtime.ts (web):8](../../apps/web/src/app/schema-runtime.ts#L8).

## 18. 개발 0.1 계약과 진단 sandbox 계약

이 절의 계약은 제품 `kkakkung` 0.2 경계에 쓰이지 않는다.

### 0.1 개발(팀 회귀) 방

제품 프로필이 없을 때 서버는 `DevKkakkungRoom`을 상속한 방을 **제품과 같은 이름 `kkakkung`**으로 등록한다. 이 방은 `joinOptionsSchema`(아래)로 option을 검사하고 버전을 `'0.1.0'`과 비교하며, option이 없거나 빈 객체면 그대로 들인다. 웹의 개발 화면은 `'kkakkung'`에 `PROTOCOL_VERSION`으로 들어간다.

| 메시지(클라→서버) | 스키마            | 필드                                                |
| ----------------- | ----------------- | --------------------------------------------------- |
| `move`            | `teamMoveSchema`  | `seq: 0 이상 안전 정수`, `dir: 'forward' \| 'back'` |
| `turn`            | `teamTurnSchema`  | `seq`, `dir: 'left' \| 'right'`                     |
| `ready`           | `teamReadySchema` | `{}`                                                |

스키마가 틀리면 방은 이 패키지에 없는 `rejected` 메시지(`{ seq, reason: 'invalid-message' }`)를 보낸다.

| 0.1 Schema  | 필드: 타입 = 기본값                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Player`    | `id: string = ''`, `role: string('runner'\|'tagger') = 'runner'`, `x: uint8 = 0`, `y: uint8 = 0`, `dir: uint8(0~3) = 0`, `status: string('alive'\|'escaped'\|'captured') = 'alive'`, `trapped: boolean = false`, `ready: boolean = false` |
| `Exit`      | `ownerId: string = ''`, `wallX`·`wallY: uint8 = 0`, `side: uint8(0~3) = 0`, `approachX`·`approachY: uint8 = 0`, `open: boolean = true`                                                                                                    |
| `GameState` | `phase: string('waiting'\|'prep'\|'countdown'\|'playing'\|'result') = 'waiting'`, `tick: number = 0`, `timeLeft: number = 0`, `roomCode: string = ''`, `maze: array<uint8>`, `players: map<Player>`, `exits: map<Exit>` + `.view()`       |

`GameState.maze`는 전체 미로를 모든 참가자에게 공개하며, `exits`는 `StateView`에 포함된 출구만 보인다. `GameState`에는 `stateVersion`이 없다.

근거: [bootstrap.ts:613](../../server/src/bootstrap.ts#L613), [bootstrap.ts:617](../../server/src/bootstrap.ts#L617), [bootstrap.ts:621](../../server/src/bootstrap.ts#L621), [bootstrap.ts:623](../../server/src/bootstrap.ts#L623), [bootstrap.ts:630](../../server/src/bootstrap.ts#L630), [colyseus-session.ts:45](../../apps/web/src/features/room/colyseus-session.ts#L45), [game-messages/index.ts:16](../../packages/protocol/src/game-messages/index.ts#L16), [game-messages/index.ts:21](../../packages/protocol/src/game-messages/index.ts#L21), [game-messages/index.ts:26](../../packages/protocol/src/game-messages/index.ts#L26), [DevKkakkungRoom.ts:42](../../server/src/rooms/DevKkakkungRoom.ts#L42), [DevKkakkungRoom.ts:45](../../server/src/rooms/DevKkakkungRoom.ts#L45), [DevKkakkungRoom.ts:60](../../server/src/rooms/DevKkakkungRoom.ts#L60), [game-schema/index.ts:10](../../packages/protocol/src/game-schema/index.ts#L10), [game-schema/index.ts:25](../../packages/protocol/src/game-schema/index.ts#L25), [game-schema/index.ts:39](../../packages/protocol/src/game-schema/index.ts#L39), [game-schema/index.ts:46](../../packages/protocol/src/game-schema/index.ts#L46), [game-schema/index.ts:49](../../packages/protocol/src/game-schema/index.ts#L49), [product-state.test.ts:30](../../packages/protocol/test/product-state.test.ts#L30).

### 진단 sandbox 방

`sandbox` 방은 엄격 제품 프로필이 아닐 때만 등록된다. 연속 좌표 월드를 쓰며 `SandboxState`를 동기화한다.

| 계약                                        | 값·필드                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `joinOptionsSchema`                         | `{ token: string, protocolVersion: string }` strict (`roomCode` 없음)                                             |
| `devSessionRequestSchema`                   | `{ nickname: 1~20자 }` — `POST /api/dev-sessions` 본문                                                            |
| `moveCommandSchema`                         | `{ seq: 0 이상 안전 정수, x: 유한 -1~1, z: 유한 -1~1 }`                                                           |
| `commandRejectedSchema`                     | `{ code: string }` strict                                                                                         |
| `MOVE_MESSAGE` / `COMMAND_REJECTED_MESSAGE` | `'move'` / `'command-rejected'`                                                                                   |
| `PlayerState`                               | `playerId: string = ''`, `nickname: string = ''`, `x: number = 0`, `z: number = 0`                                |
| `SandboxState`                              | `protocolVersion: string = '0.1.0'`, `phase: string = 'sandbox'`, `tick: number = 0`, `players: map<PlayerState>` |

서버 sandbox 방은 `move`를 `moveCommandSchema`로 검사해 `command-rejected`로 `INVALID_MOVE`·`STALE_SEQUENCE`·`UNKNOWN_COMMAND`·`TICK_OVERLOAD`를 보낸다. 이 코드들은 패키지에 목록이 없다. 서버는 메시지 이름 상수 대신 같은 값의 리터럴을 쓴다. 틱 처리가 실패하면 방 전체에 `TICK_OVERLOAD`를 방송한 뒤 상수 없는 종료 코드 4000으로 방을 닫는다.

근거: [bootstrap.ts:563](../../server/src/bootstrap.ts#L563), [messages/index.ts:3](../../packages/protocol/src/messages/index.ts#L3), [messages/index.ts:4](../../packages/protocol/src/messages/index.ts#L4), [messages/index.ts:6](../../packages/protocol/src/messages/index.ts#L6), [messages/index.ts:11](../../packages/protocol/src/messages/index.ts#L11), [messages/index.ts:15](../../packages/protocol/src/messages/index.ts#L15), [messages/index.ts:21](../../packages/protocol/src/messages/index.ts#L21), [schema/index.ts:5](../../packages/protocol/src/schema/index.ts#L5), [schema/index.ts:16](../../packages/protocol/src/schema/index.ts#L16), [bootstrap.ts:404](../../server/src/bootstrap.ts#L404), [GameRoom.ts:33](../../server/src/rooms/GameRoom.ts#L33), [GameRoom.ts:35](../../server/src/rooms/GameRoom.ts#L35), [GameRoom.ts:37](../../server/src/rooms/GameRoom.ts#L37), [GameRoom.ts:42](../../server/src/rooms/GameRoom.ts#L42), [GameRoom.ts:55](../../server/src/rooms/GameRoom.ts#L55), [GameRoom.ts:56](../../server/src/rooms/GameRoom.ts#L56), [GameRoom.ts:62](../../server/src/rooms/GameRoom.ts#L62), [CommandAdapter.ts:18](../../server/src/game/CommandAdapter.ts#L18).

## 19. 주요 흐름

1. 웹이 `GET /api/sessions/access`로 입장 방식을 묻고, `POST /api/sessions`에 `sessionRequestSchema` 본문을 보낸다. 성공하면 `sessionResponseSchema`로 검사한 세션을, 실패하면 `SESSION_ERROR_CODES` 코드 또는 `CONNECTION_FAILED`를 얻는다.
2. 웹이 `kkakkung` Room에 `{ token, roomCode, protocolVersion: '0.2.0' }`로 들어간다. 서버 `onAuth`가 `productJoinOptionsSchema`와 버전을 확인한다.
3. 서버가 `PublicMatchState`를 동기화하고, 웹은 패치마다 `readPublicRoundState`로 nullable 모양을 얻는다. 명단 변경 때마다 `room-access`·`room-map`·`room-roster`가 온다.
4. 웹이 명령을 envelope으로 보낸다. 서버는 4096바이트·스키마·`matchId`·`REMATCH.role`·속도·단계/활성 검사·큐 한도를 차례로 보고 `command-result` 영수증을 보낸다.
5. 틱마다 단계 명령은 Room이, 코어 명령은 `game-core`가 처리하고, 명령 주인에게 `command-outcome` 하나가 간다. 영수증 뒤 결과를 놓친 웹은 `request-status`로 `done`·`pending`·`unknown`을 묻는다.
6. 뷰가 바뀌면 수신자별 `private-view`가 오고, 웹은 `restorePrivateView`로 생략된 지식을 채운다. 채울 수 없으면 `view-resync`를 보내고 서버는 초당 1회까지 전체 뷰를 다시 보낸다.
7. 수신자 대상 사건은 `private-event`로 오며, 아직 적용할 수 없는 사건은 64개·1000ms까지 보관된다.
8. 서버는 2000ms마다 `game-heartbeat`를 보내고 웹은 ack한다. 어느 쪽이든 6000ms 동안 유효한 상대 신호가 없으면 연결 상실로 본다.
9. 미디어 grant는 HTTP로 받고, 바인딩과 음성 정책은 `media-bindings`·`audio-policy`로 받는다. 바인딩을 놓쳤으면 `media-bindings-refresh`로 마지막 값을 다시 받는다.

근거: [product-session.ts:48](../../apps/web/src/features/room/product-session.ts#L48), [product-session.ts:67](../../apps/web/src/features/room/product-session.ts#L67), [product-session.ts:81](../../apps/web/src/features/room/product-session.ts#L81), [product-session.ts:132](../../apps/web/src/features/room/product-session.ts#L132), [KkakkungRoom.ts:596](../../server/src/rooms/KkakkungRoom.ts#L596), [product-runtime.ts:1115](../../apps/web/src/app/product-runtime.ts#L1115), [KkakkungRoom.ts:835](../../server/src/rooms/KkakkungRoom.ts#L835), [KkakkungRoom.ts:854](../../server/src/rooms/KkakkungRoom.ts#L854), [KkakkungRoom.ts:860](../../server/src/rooms/KkakkungRoom.ts#L860), [KkakkungRoom.ts:866](../../server/src/rooms/KkakkungRoom.ts#L866), [MatchDriver.ts:212](../../server/src/game/MatchDriver.ts#L212), [command-lifecycle.ts:132](../../apps/web/src/features/room/command-lifecycle.ts#L132), [product-view.ts:119](../../apps/web/src/features/room/product-view.ts#L119), [EventDispatcher.ts:200](../../server/src/game/EventDispatcher.ts#L200), [private-events.ts:95](../../apps/web/src/features/room/private-events.ts#L95), [Heartbeat.ts:134](../../server/src/game/Heartbeat.ts#L134), [game-heartbeat.ts:44](../../apps/web/src/features/room/game-heartbeat.ts#L44), [KkakkungRoom.ts:683](../../server/src/rooms/KkakkungRoom.ts#L683).

## 20. 상태 기계

이 패키지는 전이를 실행하지 않는다. 아래는 계약 값이 표현하는 상태와, 그 값에 대해 계약이 강제하는 제약이다. 전이 조건은 [server.md](server.md)와 [game-core.md](game-core.md)가 소유한다.

| 상태 대상   | 상태                                                                                   | 계약이 강제하는 것                                                     |
| ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 명령 영수증 | `accepted` → (틱) → 결과                                                               | `accepted`는 `code: null`, `rejected`는 코드 필수                      |
| 명령 결과   | `applied` / `rejected` / `canceled`                                                    | `applied`만 `code: null`                                               |
| 요청 조회   | `pending` → `done` / `unknown`                                                         | `done`만 `outcome`을 싣는다                                            |
| 게임 범위   | `none` ↔ `practice` / `game`                                                           | `none`은 `gameInstanceId: null`, 이벤트에는 `none` 불가                |
| 자기 상태   | `ACTIVE` → `ESCAPED` / `CAPTURED`                                                      | 끝난 상태는 `playerId`·`role`·`status` 세 키만                         |
| 개인 지식   | revision N 보유 → 같은 N 생략 뷰(재사용) / 새 N 전체 뷰(교체) / 다른 N 생략 뷰(resync) | `restorePrivateView` 표(10절)                                          |
| 탈출 도전   | `EXIT_CHALLENGE` → `EXIT_CHALLENGE_ENDED`(`canceled`·`failed`·`escaped`)               | `reason`은 코드 또는 `null`                                            |
| 방 단계     | `PHASES` 9개                                                                           | `room-roster.phase`는 enum 검사, 공개 상태 `phase`는 읽을 때 검사 없음 |
| 재경기      | 없음 → `available` / `settling` / `requested`                                          | 모르는 값은 읽을 때 버린다                                             |
| 데모 대본   | `running: null` ↔ 시나리오 ID, 끝날 때 `outcomeSeq` 증가                               | `completed`는 끝까지 간 것만                                           |

근거: [product.ts:139](../../packages/protocol/src/game-messages/product.ts#L139), [product.ts:146](../../packages/protocol/src/game-messages/product.ts#L146), [product.ts:159](../../packages/protocol/src/game-messages/product.ts#L159), [events.ts:31](../../packages/protocol/src/game-messages/events.ts#L31), [events.ts:53](../../packages/protocol/src/game-messages/events.ts#L53), [events.ts:168](../../packages/protocol/src/game-messages/events.ts#L168), [events.ts:83](../../packages/protocol/src/game-messages/events.ts#L83), [room.ts:9](../../packages/protocol/src/game-messages/room.ts#L9), [game-schema/product.ts:255](../../packages/protocol/src/game-schema/product.ts#L255), [game-schema/product.ts:350](../../packages/protocol/src/game-schema/product.ts#L350), [game-schema/product.ts:372](../../packages/protocol/src/game-schema/product.ts#L372), [product.ts:299](../../packages/protocol/src/game-messages/product.ts#L299), [product.ts:304](../../packages/protocol/src/game-messages/product.ts#L304).

## 21. 이 파트를 고정하는 시험

패키지 시험 7개는 루트 `vitest.config.ts`의 `packages/**/*.test.{ts,tsx}` 포함 범위에 들어 기본 `pnpm test`에서 돈다. 이 파일들에 `skip`·조건부 실행·환경 변수 분기는 없다.

근거: [vitest.config.ts:9](../../vitest.config.ts#L9), [vitest.config.ts:15](../../vitest.config.ts#L15), [package.json(root):22](../../package.json#L22).

| 동작                                      | 고정하는 시험                                                                                                                                                                                                                                                                | assert 하는 것                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 명령 종류 20개와 단계 명령 9개            | [product-commands.test.ts:29](../../packages/protocol/test/product-commands.test.ts#L29)                                                                                                                                                                                     | `COMMAND_TYPES` 집합, `USE_ITEM` 부재, `PHASE_COMMAND_TYPES` 순서                                                                                |
| 단계/코어 분류                            | [product-commands.test.ts:70](../../packages/protocol/test/product-commands.test.ts#L70), [product-commands.test.ts:77](../../packages/protocol/test/product-commands.test.ts#L77), [product-commands.test.ts:93](../../packages/protocol/test/product-commands.test.ts#L93) | `MOVE_INTENT`는 코어, `READY`·`ROOM_LOCK`·`ROOM_KICK`는 단계, `direction: null` 허용                                                             |
| 신원 필드·잘못된 대상 거절                | [product-commands.test.ts:95](../../packages/protocol/test/product-commands.test.ts#L95)                                                                                                                                                                                     | `actorId` 추가, 빈 `targetPlayerId`, 문자열 `locked` 거절                                                                                        |
| envelope 거절 11가지                      | [product-commands.test.ts:111](../../packages/protocol/test/product-commands.test.ts#L111)                                                                                                                                                                                   | 0.1 `seq` 모양, 소수·음수·안전 범위 밖 `sequence`, 잘못된 UUID, 추가 키, `playerId`, 알 수 없는 종류, 잘못된 방향, ID 없는 취소, 추가 payload 키 |
| UTF-8 바이트 측정                         | [product-commands.test.ts:134](../../packages/protocol/test/product-commands.test.ts#L134)                                                                                                                                                                                   | 1·3·4바이트, 글자 수는 작아도 바이트로 4096 초과                                                                                                 |
| 거절 상관값                               | [product-commands.test.ts:144](../../packages/protocol/test/product-commands.test.ts#L144)                                                                                                                                                                                   | 형상이 틀리면 `''`·`''`·`-1`, 맞으면 그대로                                                                                                      |
| 영수증·결과·조회 판별                     | [product-commands.test.ts:166](../../packages/protocol/test/product-commands.test.ts#L166)                                                                                                                                                                                   | `accepted`+코드, `rejected`+`null`, `applied`+코드, `pending`+결과 거절                                                                          |
| 미래 이벤트 상수                          | [product-events.test.ts:34](../../packages/protocol/test/product-events.test.ts#L34)                                                                                                                                                                                         | 64와 1000                                                                                                                                        |
| 이벤트 범위·종류·좌표                     | [product-events.test.ts:39](../../packages/protocol/test/product-events.test.ts#L39)                                                                                                                                                                                         | `none` 범위·`ITEM_PICKED`·x=40 거절, 뷰 범위 `none`에 ID 넣으면 거절                                                                             |
| 센서 벽 필수·함정 벽 금지, 선로/복원 형상 | [product-events.test.ts:90](../../packages/protocol/test/product-events.test.ts#L90)                                                                                                                                                                                         | 벽 없는 센서·벽 있는 함정·`maze` 키 거절, 지식 생략 허용, `knowledgeRevision` 필수, 복원 형상은 반대                                             |
| resync·미디어 형상                        | [product-events.test.ts:135](../../packages/protocol/test/product-events.test.ts#L135)                                                                                                                                                                                       | 음수 버전 거절, 바인딩 추가 키 거절, `gain: 2` 거절                                                                                              |
| 버전 분리                                 | [product-state.test.ts:25](../../packages/protocol/test/product-state.test.ts#L25)                                                                                                                                                                                           | `0.1.0`·`sandbox`·`0.2.0`, 0.1 `GameState`에 `stateVersion` 없음                                                                                 |
| 공개 상태 누출 금지와 정규화              | [product-state.test.ts:45](../../packages/protocol/test/product-state.test.ts#L45)                                                                                                                                                                                           | 인코딩 결과 키가 허용 목록 안, 좌표·맵 키 부재, `readPublicRoundState` 결과                                                                      |
| `abortedBy` 조건                          | [product-state.test.ts:69](../../packages/protocol/test/product-state.test.ts#L69)                                                                                                                                                                                           | `ABORTED`에서만 읽힘                                                                                                                             |
| null 필드 부재 전송·복원                  | [product-state.test.ts:83](../../packages/protocol/test/product-state.test.ts#L83)                                                                                                                                                                                           | 결과 없음→`null`, 디코딩 `undefined`→`null`                                                                                                      |
| 만료 경고·준비·재경기 필드                | [product-state.test.ts:106](../../packages/protocol/test/product-state.test.ts#L106)                                                                                                                                                                                         | 값 전송과 해제 시 키 제거                                                                                                                        |
| 모르는 진단 문자열 제거                   | [product-state.test.ts:142](../../packages/protocol/test/product-state.test.ts#L142)                                                                                                                                                                                         | 목록 밖 `preparationIssue`·`rematchState`는 키 제거                                                                                              |
| 접근·명단 형상                            | [room-roster.test.ts:19](../../packages/protocol/test/room-roster.test.ts#L19)                                                                                                                                                                                               | 4002, 음수·소수 revision·`hostId` 추가 거절, 명단의 `role`·`x`·옛 단계·7명 거절                                                                  |
| 세션 요청 union·응답·join option          | [room-roster.test.ts:50](../../packages/protocol/test/room-roster.test.ts#L50)                                                                                                                                                                                               | 초대 없는 요청 허용, 만들기+방 코드·들어가기−방 코드·빈 닉네임·짧은 토큰·소문자 코드 거절, `0.1.0` 응답 거절, `roomCode` 없는 join 거절          |
| heartbeat·탐침                            | [heartbeat.test.ts:14](../../packages/protocol/test/heartbeat.test.ts#L14)                                                                                                                                                                                                   | 2000·6000, 추가 키·음수 순번·순번 누락 거절, NaN·Infinity·숫자 ID·빈 ID 거절                                                                     |
| 데모 거리와 0.1 메시지                    | [messages.test.ts:15](../../packages/protocol/test/messages.test.ts#L15)                                                                                                                                                                                                     | 거리 5 허용·6 거절, 0.1 join 추가 키 거절, 닉네임 0·21자 거절, 이동 범위 밖 거절, 이름 상수                                                      |
| sandbox 상태                              | [schema.test.ts:10](../../packages/protocol/test/schema.test.ts#L10)                                                                                                                                                                                                         | 기본값과 전체·패치 왕복                                                                                                                          |

패키지 밖에서 이 계약을 함께 고정하는 시험도 있다. `tests/contracts`의 시험들은 같은 기본 실행에 포함된다.

| 동작                          | 고정하는 시험                                                                                      | assert 하는 것                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 행동 시간 사본 = 운영 튜닝    | [product-profile.test.ts:34](../../server/test/room/product-profile.test.ts#L34)                   | `tickMs`·`moveTicks`·`turnTicks`가 `PRODUCT_TICK_MS`·`PRODUCT_ACTION_TICKS`와 같음 |
| 실제 투영 뷰가 복원 형상 통과 | [producer-consumer.test.ts:31](../../tests/contracts/producer-consumer.test.ts#L31)                | 여섯 명 뷰가 `completePrivateViewSchema` 통과, 술래의 출구 목록 비어 있음          |
| 끝난 도망자 최소 뷰와 결과    | [producer-consumer.test.ts:57](../../tests/contracts/producer-consumer.test.ts#L57)                | `self` 세 키, 빈 지식, 이후 명령 결과 `NOT_ACTIVE`                                 |
| 공개 상태에 좌표 필드 없음    | [g4-packets.test.ts:329](../../tests/contracts/g4-packets.test.ts#L329)                            | 허용 필드 이름에 좌표류 없음, 실제 공개 상태 키 = 선택 필드를 뺀 허용 목록         |
| 아이템 명령 없음              | [g3-room.test.ts:580](../../tests/contracts/g3-room.test.ts#L580)                                  | `COMMAND_TYPES`에 `ITEM`·`PICKUP`·`USE_` 없음                                      |
| 중단 사유마다 다른 문구       | [result-presenter.test.ts:19](../../apps/web/src/features/game/flow/result-presenter.test.ts#L19)  | `ABORT_REASONS` 각각의 결과 문구가 서로 다름                                       |
| 세션 코드마다 문구            | [session-error-labels.test.ts:9](../../apps/web/src/features/room/session-error-labels.test.ts#L9) | `SESSION_ERROR_CODES` 전부에 문구가 있음                                           |

기본 실행에서 건너뛰는 시험: 이 패키지 시험에는 없다.

## 22. 확인된 한계와 코드 쪽 발견

### 코드 쪽 발견 (주석·선언과 코드의 불일치)

1. `PHASE_COMMAND_TYPES` 바로 위 주석은 "게임 코어가 처리하는 명령. 나머지는 서버가 처리하는 방 단계 명령"이라고 적지만, 이 목록은 서버 Room이 처리하는 단계 명령이고 코어가 처리하는 것은 목록 **밖**의 11개다. 주석이 반대로 적혀 있다.

   근거: [product.ts:119](../../packages/protocol/src/game-messages/product.ts#L119), [product.ts:120](../../packages/protocol/src/game-messages/product.ts#L120), [MatchDriver.ts:212](../../server/src/game/MatchDriver.ts#L212).

2. `room-map` 주석은 맵 크기가 "LOBBY 에서만 바뀐다"고 적지만 서버는 일반·데모 방에서 `LOBBY`와 `DEVICE_CHECK` 둘 다 받고, 시연 방은 어느 단계에서도 받지 않는다.

   근거: [room.ts:46](../../packages/protocol/src/game-messages/room.ts#L46), [KkakkungRoom.ts:1355](../../server/src/rooms/KkakkungRoom.ts#L1355).

3. `ROOM_START` 주석은 "여섯 명이 모두 준비한 뒤"라고 적지만 서버는 방 정원(`capacity`, 시연 방은 4, 데모 방의 자리 정원은 1) 전원의 준비를 본다.

   근거: [product.ts:82](../../packages/protocol/src/game-messages/product.ts#L82), [LobbyCoordinator.ts:122](../../server/src/rooms/LobbyCoordinator.ts#L122), [SlotRegistry.ts:26](../../server/src/session/SlotRegistry.ts#L26), [SlotRegistry.ts:299](../../server/src/session/SlotRegistry.ts#L299).

4. `demoScenario` 상수 주석은 "일반 방은 거절한다"고 적지만 서버는 거절 응답 없이 무시한다.

   근거: [product.ts:18](../../packages/protocol/src/game-messages/product.ts#L18), [KkakkungRoom.ts:1524](../../server/src/rooms/KkakkungRoom.ts#L1524).

5. `REMATCH.role` 주석은 "일반 방은 방 경계에서 거절한다"고 적고 실제로 `NOT_ALLOWED` 영수증을 보낸다(일치). 다만 시연 방은 `role`과 무관하게 `REMATCH` 자체를 `NOT_ALLOWED`로 거절하는데, 계약에는 이 사실이 드러나지 않는다.

   근거: [product.ts:104](../../packages/protocol/src/game-messages/product.ts#L104), [KkakkungRoom.ts:848](../../server/src/rooms/KkakkungRoom.ts#L848), [KkakkungRoom.ts:922](../../server/src/rooms/KkakkungRoom.ts#L922).

6. `publishDemoState` 주석은 경기 중에는 운영자 역할과 살아 있는 인형이 실행할 수 있는 대본만 내보낸다고 적지만, 코드는 경기 중에도 22개 전부를 보내고 시작할 수 없는 대본에 `unavailable` 거절 코드만 붙인다. 이 주석은 server 파일에 있지만 `demo-state` 계약의 의미를 흐리므로 여기 적는다.

   근거: [KkakkungRoom.ts:1546](../../server/src/rooms/KkakkungRoom.ts#L1546), [KkakkungRoom.ts:1547](../../server/src/rooms/KkakkungRoom.ts#L1547), [KkakkungRoom.ts:1552](../../server/src/rooms/KkakkungRoom.ts#L1552), [DemoScenarios.ts:333](../../server/src/rooms/DemoScenarios.ts#L333), [DemoScenarios.ts:335](../../server/src/rooms/DemoScenarios.ts#L335).

### 코드 간 모순·미사용

7. `COMMAND_CODES`의 `PROTOCOL_MISMATCH`는 서버·코어 어디서도 명령 결과로 만들지 않는다. 같은 문자열은 Room 입장 거절에만 쓰인다.

   근거: [product.ts:44](../../packages/protocol/src/game-messages/product.ts#L44), [KkakkungRoom.ts:599](../../server/src/rooms/KkakkungRoom.ts#L599).

8. `mediaRefreshRequestSchema`는 어디서도 parse되지 않는다. 웹은 그 모양으로 보내되 `lastBindingRevision`을 늘 `0`으로 고정하고, 서버 `media-bindings-refresh` 처리기는 payload를 보지 않고 `lastBindingRevision`도 쓰지 않는다.

   근거: [media.ts:114](../../packages/protocol/src/game-messages/media.ts#L114), [KkakkungRoom.ts:675](../../server/src/rooms/KkakkungRoom.ts#L675), [product-runtime.ts:1083](../../apps/web/src/app/product-runtime.ts#L1083).

9. `SESSION_CANCEL_ERROR_CODES`는 서버·웹 제품 코드 어디서도 참조되지 않고, 서버 취소 경로는 문자열 리터럴로 응답한다. 또 `/api/sessions` 접두 미들웨어 때문에 취소·초대·접근 경로도 429 `RATE_LIMITED`를 받을 수 있는데, 취소 코드 목록에는 `RATE_LIMITED`가 없다.

   근거: [session.ts:15](../../packages/protocol/src/game-messages/session.ts#L15), [SessionRoutes.ts:78](../../server/src/session/SessionRoutes.ts#L78), [SessionRoutes.ts:149](../../server/src/session/SessionRoutes.ts#L149).

10. 데모 발급 오류(`UNAUTHORIZED`, `INVALID_REQUEST`, `CAPACITY`, `DEMO_ROOM_LIMIT`, `DEMO_UNAVAILABLE`)와 sandbox `command-rejected` 코드, 0.1 개발 방의 `rejected` 메시지는 이 패키지에 목록이 없어 서버 리터럴로만 존재한다. heartbeat 끊김과 sandbox 틱 과부하에 쓰는 종료 코드 4000도 상수가 없다.

    근거: [DemoRoutes.ts:76](../../server/src/session/DemoRoutes.ts#L76), [DemoRoutes.ts:137](../../server/src/session/DemoRoutes.ts#L137), [GameRoom.ts:35](../../server/src/rooms/GameRoom.ts#L35), [DevKkakkungRoom.ts:45](../../server/src/rooms/DevKkakkungRoom.ts#L45), [KkakkungRoom.ts:1142](../../server/src/rooms/KkakkungRoom.ts#L1142), [GameRoom.ts:56](../../server/src/rooms/GameRoom.ts#L56).

11. 웹은 메시지 이름(`PRODUCT_CLIENT_MESSAGES`·`PRODUCT_SERVER_MESSAGES`), 세션 경로(`SESSION_ROUTE`), 방 이름(`PRODUCT_ROOM_NAME`), 방 코드 정규식(`ROOM_CODE_PATTERN`)을 상수 대신 같은 값의 리터럴로 한 번 더 적는다. 값이 지금은 같지만 계약 쪽을 바꾸면 웹이 따라오지 않는다.

    근거: [product-runtime.ts:1202](../../apps/web/src/app/product-runtime.ts#L1202), [product-session.ts:32](../../apps/web/src/features/room/product-session.ts#L32), [product-session.ts:67](../../apps/web/src/features/room/product-session.ts#L67), [product-session.ts:132](../../apps/web/src/features/room/product-session.ts#L132).

12. `game-schema`의 `RoomRoster` 타입에는 `kind`·`capacity`가 없지만 zod `roomRosterSchema`와 서버 송신에는 있다. 같은 이름의 타입 선언 두 벌이 다르다.

    근거: [game-schema/product.ts:272](../../packages/protocol/src/game-schema/product.ts#L272), [room.ts:22](../../packages/protocol/src/game-messages/room.ts#L22), [KkakkungRoom.ts:2461](../../server/src/rooms/KkakkungRoom.ts#L2461).

13. `readPublicRoundState`는 `preparationIssue`·`rematchState`는 목록에 없으면 버리지만, `abortReason`과 `phase`는 값 검사 없이 단언만 한다. 모르는 중단 사유가 오면 그대로 화면까지 간다.

    근거: [game-schema/product.ts:350](../../packages/protocol/src/game-schema/product.ts#L350), [game-schema/product.ts:368](../../packages/protocol/src/game-schema/product.ts#L368), [game-schema/product.ts:369](../../packages/protocol/src/game-schema/product.ts#L369).

14. 0.1 개발 방은 제품 Room과 같은 이름 `kkakkung`으로 등록된다(제품 프로필이 없을 때). 같은 이름에 두 계약이 서버 프로필에 따라 갈린다.

    근거: [bootstrap.ts:611](../../server/src/bootstrap.ts#L611), [bootstrap.ts:630](../../server/src/bootstrap.ts#L630).

15. `DEMO_SCENARIO_IDS`와 서버 `DEMO_SCENARIOS`가 같은지 비교하는 런타임 시험은 없다. 지금 두 목록은 같은 22개·같은 순서이며, 서로 대입하는 서버 코드의 타입 검사가 유일한 연결이다.

    근거: [product.ts:226](../../packages/protocol/src/game-messages/product.ts#L226), [DemoScenarios.ts:11](../../server/src/rooms/DemoScenarios.ts#L11), [KkakkungRoom.ts:658](../../server/src/rooms/KkakkungRoom.ts#L658).

16. `audio-policy`의 `voices`·`effects`와 개인 뷰의 배열 필드에는 길이 상한이 없다. 상한이 있는 배열은 명단 6, 바인딩 6, `publisherPermissions` 5(트랙 2), 관전 후보 3, 데모 목록 22(옵션 5)뿐이다.

    근거: [media.ts:48](../../packages/protocol/src/game-messages/media.ts#L48), [media.ts:57](../../packages/protocol/src/game-messages/media.ts#L57), [events.ts:222](../../packages/protocol/src/game-messages/events.ts#L222).

17. 같은 이름 `expiresAt`이 세션·초대·데모·시연 응답에서는 epoch ms, 미디어 grant에서는 epoch 초다. `matchId` 제약도 명령·뷰(1–64자), 미디어(1–128자), heartbeat(1자 이상, 상한 없음)가 서로 다르다.

    근거: [session.ts:67](../../packages/protocol/src/game-messages/session.ts#L67), [bootstrap.ts:195](../../server/src/bootstrap.ts#L195), [DemoRoutes.ts:86](../../server/src/session/DemoRoutes.ts#L86), [media.ts:93](../../packages/protocol/src/game-messages/media.ts#L93), [GrantIssuer.ts:266](../../server/src/media/GrantIssuer.ts#L266), [product.ts:60](../../packages/protocol/src/game-messages/product.ts#L60), [media.ts:12](../../packages/protocol/src/game-messages/media.ts#L12), [heartbeat.ts:13](../../packages/protocol/src/game-messages/heartbeat.ts#L13).

## 23. 다룬 파일

`git ls-files packages/protocol` 결과 23개와 대조했다.

### 코드·설정

| 파일                                               | 설명한 절    |
| -------------------------------------------------- | ------------ |
| `packages/protocol/package.json`                   | 1, 2         |
| `packages/protocol/tsconfig.json`                  | 1            |
| `packages/protocol/src/version.ts`                 | 2            |
| `packages/protocol/src/schema-runtime.ts`          | 17           |
| `packages/protocol/src/game-messages/index.ts`     | 2, 18        |
| `packages/protocol/src/game-messages/product.ts`   | 3~7, 16, 22  |
| `packages/protocol/src/game-messages/events.ts`    | 3, 4, 10, 11 |
| `packages/protocol/src/game-messages/session.ts`   | 3, 15        |
| `packages/protocol/src/game-messages/room.ts`      | 12           |
| `packages/protocol/src/game-messages/heartbeat.ts` | 13           |
| `packages/protocol/src/game-messages/media.ts`     | 14           |
| `packages/protocol/src/game-schema/index.ts`       | 2, 18        |
| `packages/protocol/src/game-schema/product.ts`     | 8, 9, 10     |
| `packages/protocol/src/messages/index.ts`          | 18           |
| `packages/protocol/src/schema/index.ts`            | 18           |

### 시험

| 파일                                              | 설명한 절 |
| ------------------------------------------------- | --------- |
| `packages/protocol/test/product-commands.test.ts` | 21        |
| `packages/protocol/test/product-events.test.ts`   | 21        |
| `packages/protocol/test/product-state.test.ts`    | 21        |
| `packages/protocol/test/room-roster.test.ts`      | 21        |
| `packages/protocol/test/heartbeat.test.ts`        | 21        |
| `packages/protocol/test/messages.test.ts`         | 21        |
| `packages/protocol/test/schema.test.ts`           | 21        |

### 미설명

| 파일                          | 이유                       |
| ----------------------------- | -------------------------- |
| `packages/protocol/README.md` | `.md`는 근거로 쓰지 않는다 |
