# B 공개 인계 기록

수정자: **B만** · [담당 계획](../b-game-server.md) · [공통 규칙](../common.md)

이 파일은 팀원 AI가 B의 전체 계획을 다시 읽지 않고 공개 산출물과 요청을 확인하는 장소다. 아래 상태는 2026-09-09 로컬 스토리별 스택 브랜치(아래 브랜치 표)의 실제 커밋 기준이며, **모든 항목은 LOCAL_VERIFIED이고 ACCEPTED는 0건**이다. 시험은 B 소유 harness의 FakeCore·가짜 맵/연습 포트·E test double로 실행했고 실제 A 엔진, E 미디어/운영, F 설정과의 결합은 아직 없다. 커밋은 담당자가 푸시·MR 생성 전이므로 원격에 없다.

## 스토리별 브랜치 (2026-09-09, 로컬·미푸시)

선형 이력을 Jira 스토리별 스택 브랜치로 잘랐다. 각 브랜치는 바로 위 행의 브랜치를 부모로 하며, MR도 같은 순서로 앞 브랜치를 대상으로 올린 뒤 앞 MR 병합 후 대상을 `develop`으로 바꾼다. 이전 선형 브랜치는 `backup/b-linear-2026-09-09`로 보존했고 최종 트리는 동일하다(`git diff` 없음). SHA는 cherry-pick으로 바뀌었으며 아래 표와 요약 표가 현재 값이다.

| 순서 | 브랜치                                              | 커밋                                                      | 작업 / Jira                                                                                                                                |
| ---- | --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `feat/S15P21C204-81-match-state-contract`           | `e4ac6bf`                                                 | B-01 / S15P21C204-81 · MR [!19](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/19) develop 병합 `0c9a733`(2026-09-09) |
| 2    | `feat/S15P21C204-82-command-envelope-http-boundary` | `4f21ff4`, `92f46f8`                                      | B-02 / S15P21C204-82 · MR [!21](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/21) develop 병합 `0397c09`(2026-09-09) |
| 3    | `feat/S15P21C204-83-command-queue-limits`           | `b7c55d4`                                                 | B-03 / S15P21C204-83 · MR [!22](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/22) develop 병합 `aeb49e8`(2026-09-09) |
| 4    | `feat/S15P21C204-84-match-driver-single-tick`       | `4d6c28f`                                                 | B-04 / S15P21C204-84 · MR [!23](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/23) develop 병합 `eebb0d9`(2026-09-09) |
| 5    | `feat/S15P21C204-85-room-tick-coordinator`          | `90d5e43`                                                 | B-05 / S15P21C204-85 · MR [!25](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/25) develop 병합 `229b4f1`(2026-09-09) |
| 6    | `feat/S15P21C204-86-invitation-issue-verify`        | `6dd3619`                                                 | B-06 / S15P21C204-86 · MR [!25](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/25) develop 병합 `229b4f1`(2026-09-09) |
| 7    | `feat/S15P21C204-88-product-session`                | `e0dff93`                                                 | B-08 / S15P21C204-88 · MR [!36](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/36) develop 병합 `1eed799`(2026-09-09) |
| 8    | `feat/S15P21C204-89-slot-registry`                  | `34addb0`                                                 | B-09 / S15P21C204-89 · MR [!39](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/39) develop 병합 `45057e1`(2026-09-09) |
| 9    | `feat/S15P21C204-87-session-routes-admission`       | `ee24c83`                                                 | B-07 / S15P21C204-87 · MR [!40](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/40) develop 병합 `d95d837`(2026-09-09) |
| 10   | `feat/S15P21C204-90-heartbeat-clock-sync`           | `4d47ba7`                                                 | B-10 / S15P21C204-90 · MR [!41](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/41) develop 병합 `b63de0e`(2026-09-09) |
| 11   | `feat/S15P21C204-94-private-view-projection`        | `9af13c4`                                                 | B-14 / S15P21C204-94 · MR [!42](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/42) develop 병합 `6c5bfa7`(2026-09-09) |
| 12   | `feat/S15P21C204-91-event-dispatcher-resync`        | `9a13eb3`                                                 | B-11 / S15P21C204-91                                                                                                                       |
| 13   | `feat/S15P21C204-93-room-expiry-host`               | `8c85e92`                                                 | B-13 / S15P21C204-93                                                                                                                       |
| 14   | `feat/S15P21C204-92-lobby-ready-roles`              | `14d6334`                                                 | B-12 / S15P21C204-92                                                                                                                       |
| 15   | `feat/S15P21C204-95-practice-coordinator`           | `dbb3a95`                                                 | B-15 / S15P21C204-95                                                                                                                       |
| 16   | `feat/S15P21C204-96-layout-loader-loading-barrier`  | `b75f7bd`                                                 | B-16 / S15P21C204-96                                                                                                                       |
| 17   | `feat/S15P21C204-97-countdown`                      | `1ec6356`                                                 | B-17 / S15P21C204-97                                                                                                                       |
| 18   | `feat/S15P21C204-98-rematch`                        | `e916cd2`                                                 | B-18 / S15P21C204-98                                                                                                                       |
| 19   | `feat/S15P21C204-84-kkakkung-room-assembly`         | `4a2b42a`(조립), `a70e95f`(문서), develop 병합, `b1be16d` | 조립: B-04 대표, 키 82·84·87·89~98                                                                                                         |

## 요약 표

| 고정 번호 | 원본 ID | Jira          | localStage     | 구현 commit                     | blockedOn                                                  |
| --------- | ------- | ------------- | -------------- | ------------------------------- | ---------------------------------------------------------- |
| B-01      | SV-01   | S15P21C204-81 | LOCAL_VERIFIED | `e4ac6bf`                       | A core 실제 연결                                           |
| B-02      | SV-02   | S15P21C204-82 | LOCAL_VERIFIED | `4f21ff4`, `92f46f8`, `4a2b42a` | C pending 해제 소비자 시험                                 |
| B-03      | SV-03   | S15P21C204-83 | LOCAL_VERIFIED | `b7c55d4`                       | A RL-03 EXPIRE_MOVE 소비, F 계측 콜백                      |
| B-04      | SV-04   | S15P21C204-84 | LOCAL_VERIFIED | `4d6c28f`, `4a2b42a`            | A createMatch/stepMatch/selector, E observeFrame           |
| B-05      | SV-05   | S15P21C204-85 | LOCAL_VERIFIED | `90d5e43`, `4a2b42a`            | F MetricRegistry emitMetric, 실제 정지 통합 시험           |
| B-06      | AC-01   | S15P21C204-86 | LOCAL_VERIFIED | `6dd3619`, `4a2b42a`            | E createOperatorAuth, F inviteMaxTtlMs/공개창              |
| B-07      | AC-02   | S15P21C204-87 | LOCAL_VERIFIED | `ee24c83`, `4a2b42a`            | E OperationsPort/coordinator, F 세션 시도 설정·trust proxy |
| B-08      | AC-03   | S15P21C204-88 | LOCAL_VERIFIED | `e0dff93`, `4a2b42a`            | C 메모리 토큰 소비자 확인                                  |
| B-09      | AC-04   | S15P21C204-89 | LOCAL_VERIFIED | `34addb0`, `4a2b42a`            | E OP-04 retire 확인 control, F 검증 Room 수                |
| B-10      | SV-06   | S15P21C204-90 | LOCAL_VERIFIED | `4d47ba7`, `4a2b42a`            | C offset 소비자, A RL-08 CONNECTION_LOST 처리              |
| B-11      | SV-07   | S15P21C204-91 | LOCAL_VERIFIED | `9a13eb3`, `4a2b42a`            | C SessionRuntime 사건/뷰/outcome 처리기                    |
| B-12      | FL-01   | S15P21C204-92 | LOCAL_VERIFIED | `14d6334`, `4a2b42a`            | C AC-06/FL-02 roster·READY 소비자                          |
| B-13      | AC-05   | S15P21C204-93 | LOCAL_VERIFIED | `8c85e92`, `4a2b42a`            | E 회수 확인, F ROOM_IDLE_TTL_MS                            |
| B-14      | KN-04   | S15P21C204-94 | LOCAL_VERIFIED | `9af13c4`, `4a2b42a`            | A KN-02/KN-03 selector, C/D 소비자 시험                    |
| B-15      | FL-03   | S15P21C204-95 | LOCAL_VERIFIED | `dbb3a95`, `4a2b42a`            | A MP-01/RL-01 export·practice-v1.json, E MC-08             |
| B-16      | FL-05   | S15P21C204-96 | LOCAL_VERIFIED | `b75f7bd`, `4a2b42a`            | A MP-02/04/05 포트, F 콘텐츠 경로, E 세대 준비·binding     |
| B-17      | FL-06   | S15P21C204-97 | LOCAL_VERIFIED | `1ec6356`, `4a2b42a`            | A START_PLAYING 실제 적용, E MC-04                         |
| B-18      | FL-08   | S15P21C204-98 | LOCAL_VERIFIED | `e916cd2`, `4a2b42a`            | A RL-08, E MC-08 회수 확인                                 |

계약 기준은 모두 EXEC-CONTRACT-3 · D-2026-09-08-01이다. `4a2b42a`는 제품 Room·bootstrap 조립 커밋으로 위 leaf 모듈을 실제 Colyseus Room에 연결하고 `server/test/room/product-payload.test.ts`(6인 전체 흐름)과 `server/test/protocol/http-boundary.test.ts`로 검증했다. PRODUCT_DECISION_PENDING(MP-06·EQ-06~09·EQ-12)은 B 범위에 없으며 protocol에 아이템 명령·엔티티를 추가하지 않았다.

## 공개 계약 (C/D/E/F가 지금 소비할 수 있는 것)

### protocol 0.2.0 — `packages/protocol` (CONTRACT_READY, `e4ac6bf`·`4f21ff4`)

- `@kkakkung/protocol/version`: `PRODUCT_PROTOCOL_VERSION = '0.2.0'`, `PRODUCT_ROOM_NAME = 'kkakkung'`. sandbox는 `PROTOCOL_VERSION 0.1.0`/`ROOM_NAME 'sandbox'` 그대로.
- `@kkakkung/protocol/game-schema`: `PublicMatchState` Schema(phase/matchId/stateVersion/serverTick/startTick/startAt/deadlineTick/counts/result/abortReason만), `readPublicRoundState(state)` — **null 필드는 Schema에서 absent(undefined)로 전달되므로 이 함수로 정규화**한다. `result.winner === ''`도 null이다. 타입: Cell/Dir/WallFace/Role/PlayerStatus/Phase(PHASES)/Action/PrivateView/ActiveSelf/EndedSelf/VisibleEntity/KnownTerrain/KnownExit/GameViewScope/RoomRoster/LoadingView 등. 개발 GameState/Player/Exit는 0.1 회귀용으로 남아 있고 제품 Room은 전송하지 않는다.
- `@kkakkung/protocol/game-messages`:
  - 채널 상수 `PRODUCT_CLIENT_MESSAGES`(command/request-status/view-resync/game-heartbeat-ack/clock-probe/media-bindings-refresh), `PRODUCT_SERVER_MESSAGES`(command-result/command-outcome/request-status-result/room-roster/private-view/private-event/game-heartbeat/clock-reply/media-bindings/audio-policy).
  - `commandEnvelopeSchema`(활성 14종 strict discriminatedUnion), `commandReceiptSchema`, `commandOutcomeSchema`, `requestStatusSchema`, `requestStatusResultSchema`, `commandCodeSchema`/`COMMAND_CODES`, `MAX_COMMAND_BYTES=4096`, `measureJsonBytes`, `utf8ByteLength`, `isPhaseCommand`, `PHASE_COMMAND_TYPES`.
  - `sessionRequestSchema`(createRoom 판별 union), `sessionResponseSchema`, `productJoinOptionsSchema{token,roomCode,protocolVersion}`, `SESSION_ROUTE='/api/sessions'`, `SESSION_ERROR_CODES`, `ROOM_CODE_PATTERN` `/^[A-HJ-NP-Z2-9]{6}$/`.
  - `gameHeartbeatSchema`/`heartbeatAckSchema`/`clockProbeSchema`/`clockReplySchema`, `HEARTBEAT_INTERVAL_MS=2000`, `HEARTBEAT_TIMEOUT_MS=6000`, `CLOCK_PROBE_LIMIT_PER_SECOND=5`.
  - `privateEventSchema`(6 종), `privateViewSchema`, `viewResyncSchema`, `gameViewScopeSchema`, `FUTURE_EVENT_QUEUE_LIMIT=64`, `FUTURE_EVENT_WAIT_MS=1000`, `VIEW_RESYNC_LIMIT_PER_SECOND=1`.
  - `roomRosterSchema`.
  - `mediaBindingsSchema`/`audioPolicySchema`/`mediaGrantRequestSchema`/`mediaGrantSchema`/`mediaStatusReportSchema`/`mediaRefreshRequestSchema`, `MEDIA_ROUTES`(grants/report/webhook). E는 이 스키마 모양으로 `enqueueBindings`/`enqueueAudioPolicy` 메시지를 만든다.
- 검증: `pnpm exec vitest run packages/protocol` 7 파일 43 case 통과.

### 서버 내부 포트 — `server/src/game/ports.ts` (`e4ac6bf`)

A가 구현할 `CorePort<State>`(createMatch/createPractice/stepMatch/getPlayerKnowledge/getVisibleEntities/getPlayerSelf/getVisibleSurfaces/getFrame), `CoreCommand`(= CoreCommandEnvelope & actorId), `ControlIntent`, `CoreOutcome`, `DomainEvent`(audience 사건 | SPATIAL_SOUND), `MediaIntent`, `StepResult`, `MatchLayout`/`MatchTuning`/`CreateMatchInput`/`CreatePracticeInput`/`CoreReadFrame`, `MapPreparationPort`/`LayoutSelectionPort`/`PracticeLayoutPort`, E가 구현할 `MediaCoordinator`/`MediaCoordinatorDeps`/`CreateMediaCoordinator`/`CreateOperatorAuth`/`OperationsPort`, F의 `MetricSample`/`EmitMetric`. 문서 `docs/execution/contracts/types.ts`와 이름·필드가 같고 제품 코드는 이 파일을 import한다.

### HTTP 계약 (B 구현 완료, `4a2b42a`)

| 경로                                                                                                     | 인증                            | 결과                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/sessions`                                                                                     | 없음(초대 토큰 본문)            | 201 SessionResponse(no-store) / 400 INVALID_REQUEST / 403 INVALID_INVITATION / 404 ROOM_NOT_AVAILABLE / 429 RATE_LIMITED / 503 ADMISSION_CLOSED·CAPACITY |
| `POST /api/operations/invitations`                                                                       | OPS_TOKEN(E createOperatorAuth) | 201 IssuedInvitation / 400 / 409 NOT_READY·OUTSIDE_PUBLIC_WINDOW / 401                                                                                   |
| `POST /api/operations/invitations/:inviteId/revoke`                                                      | OPS_TOKEN                       | 204(멱등)                                                                                                                                                |
| `POST /api/operations/commands`, `GET /api/operations/commands/:requestId`, `GET /api/operations/status` | OPS_TOKEN                       | E OperationsPort에 위임. 202/409/404/200, 포트 없음 503                                                                                                  |
| `POST /api/media/grants`, `POST /api/media/report`                                                       | 세션 Bearer                     | E prepareGeneration 위임(ready 200 grant, rejected 409, unknown 503), report 204                                                                         |
| `POST /api/livekit/webhook`                                                                              | E handleWebhook(raw body)       | express.json 이전에 raw text로 등록                                                                                                                      |
| 모든 HTTP/OPTIONS/WS                                                                                     | —                               | Origin 정확 일치(absent 허용, null/빈/복수/비허용 403), /matchmake·/api POST 본문 2,048B 초과 413, 예약 부작용 0                                         |

제품 Room 입장: `Client.joinOrCreate('kkakkung', { token: sessionToken, roomCode, protocolVersion: '0.2.0' })`. 매칭 전 static onAuth에서 INVALID_JOIN(400)/PROTOCOL_MISMATCH(409)/INVALID_SESSION(401)/WRONG_ROOM·ROOM_CLOSED(403)/SESSION_IN_USE(409)로 거절한다.

## 항목별 인계

### B-01 · SV-01 · S15P21C204-81 — `e4ac6bf`

- localStage LOCAL_VERIFIED. 공개 진입점 위 protocol 절 + `server/src/game/MatchContext.ts`(`MatchContext`: serverEpoch·matchId·연속 stateVersion/serverTick·scheduleStart/fixStart·scope 레지스트리 `scopeOf/createInstance/enterInstance/leaveInstance/retireInstance`·`startNewRound`·`fixRoundInputs({tuning,seed})`).
- 검증: `pnpm exec vitest run packages/protocol/test/product-state.test.ts server/test/protocol/match-context.test.ts` exit 0(none/0→practice/1→none/2→game/3 연속성, 공개 Schema에 maze/players/exit/seed 없음).
- blockedOn: A tuning(`server/config/tuning`)과 실제 core. 다음: A가 `MatchTuning` 값을 export하면 `ProductProfile.tuning`에 주입.

### B-02 · SV-02 · S15P21C204-82 — `4f21ff4`(계약·adapter) `92f46f8`(HttpBoundary) `4a2b42a`(bootstrap 설치·시험)

- 진입점 `server/src/game/CommandAdapter.ts`: `toProductCommand(payload,{currentMatchId})` → accepted(kind core|phase) | rejected(INVALID_COMMAND/WRONG_MATCH + 안전 correlation), `toCoreCommand(actorId, envelope)`; sandbox `toMoveCommand` 유지. `server/src/session/HttpBoundary.ts`: `checkOrigin`, `installHttpBoundary(httpServer, policy)`.
- 검증: `product-commands.test.ts`(14종 union, seq/소수/UUID/추가 좌표/4097B 거절, UTF-8 바이트), `command-adapter.test.ts`, `http-boundary.test.ts`(`/api/config`·`/matchmake/joinOrCreate|create/kkakkung`·`/matchmake/joinOrCreate/sandbox` + OPTIONS 비허용 403·Room 수 불변, null·복수 Origin 403, 허용 Origin 200/204, 2,049B·chunked 2,049B·/api/dev-sessions 2,100B 413·예약 0, 2,048B 통과, WS upgrade 비허용 거절/허용 open). 모두 exit 0.
- blockedOn: C SessionRuntime이 rejected 접수에서 pending을 즉시 끝내는 소비자 시험. F에 Origin/2KB 결과 인계 완료(이 문서).

### B-03 · SV-03 · S15P21C204-83 — `b7c55d4`

- 진입점 `server/src/game/CommandQueue.ts`(`CommandQueue.accept/freeze/complete/cancelPending/status/expireHeldMoves/expiredQueuedMoves/pruneCompleted/reset`, `QUEUE_LIMITS` 64/384/512/2분/500ms), `server/src/game/CommandLimiter.ts`(`TokenBucket` 30/s·60, `CommandLimiter`).
- 검증: `command-queue.test.ts`(중복 재전달·STALE_REQUEST·64/384 QUEUE_FULL·held move 500ms 1회 EXPIRE_MOVE·매치 종료 canceled·513/2분 정리), `command-limiter.test.ts`(60 burst → 61번째 거절 → refill) exit 0.
- 인계: A RL-03은 `ControlIntent{type:'EXPIRE_MOVE',playerId,sequence}`와 arrivalOrdinal 순서만 받는다. F: rate/큐 값은 현재 상수, 설정화 요청은 아래 요청 목록.

### B-04 · SV-04 · S15P21C204-84 — `4d6c28f` `4a2b42a`

- 진입점 `server/src/game/MatchDriver.ts`(`MatchDriver<State>`: attach/detach/enqueueControl/enqueueMediaControl/drainMediaControls/cancelAllPending/tick). `server/test/room/test-harness.ts`: `FakeCore`(경계 검증용, A 엔진 아님), `layoutFor`, `openTopology`, `fakeMapPorts`, `fakePracticePort`, `createTestOperatorAuth`, `fakeClock`, `productProfile`, `writeLayoutFiles`, `bootProductApplication` — F QA-07 외부 시험이 import 가능.
- 검증: `match-driver.test.ts`(단일 step·outcome 3개 종결·SPATIAL_SOUND는 frame만·HUNTER_MARKER는 술래 audience만, core 거절→rejected outcome 상태 불변, control 다음 Tick, detach 취소, 누락/중복 outcome 미커밋+ROUND_ENDED, held move 만료) exit 0.
- blockedOn: A `@kkakkung/game-core/match` 실제 facade. mock core 결과는 LOCAL_VERIFIED로만 계산.

### B-05 · SV-05 · S15P21C204-85 — `90d5e43` `4a2b42a`

- 진입점 `server/src/game/RoomTickCoordinator.ts`(`register/unregister/run/rearm/lagOf`, tickMs 50·overloadMs 250·maxRounds 4, `emitMetric` 주입). bootstrap이 `setInterval(run,10)`으로 구동, Room은 onTick/onOverload 등록. Room의 overload는 진행 phase면 `ABORTED/SERVER_TICK_OVERLOAD` + pending ROUND_ENDED.
- 검증: `tick-coordinator.test.ts`(4회 catch-up 후 양보, 2s 정지 → 재생 0·overload 1회, 한 Room만 251ms, 전체 정지 시 모두 1회, 정확히 250ms는 유효, 이름 allowlist) exit 0.
- blockedOn: F `server/src/observability/MetricRegistry.ts` emitMetric, 실제 정지 통합 시험.

### B-06 · AC-01 · S15P21C204-86 — `6dd3619` `4a2b42a`

- 진입점 `server/src/session/InviteStore.ts`(`InviteStore implements InvitationPort`: issue/revoke/verify/bindCreatedRoom/forgetRoom/describe), `invite-types.ts`, `InvitationRoutes.ts`(`createInvitationRoutes({invites, authorize})`, `requireOperator`).
- 검증: `invite-store.test.ts`, `invitation-routes.test.ts`(실제 express 서버로 201/401/400/409/204) exit 0. 원문 토큰은 어떤 로그/메타데이터에도 없다.
- blockedOn: E `createOperatorAuth` 실제 구현(현재 test double), F `INVITE_MAX_TTL_MS`·공개창 값. 이 값 없으면 `issue`는 NOT_READY/OUTSIDE_PUBLIC_WINDOW.

### B-07 · AC-02 · S15P21C204-87 — `ee24c83` `4a2b42a`

- 진입점 `server/src/session/SessionRoutes.ts`(`createSessionRoutes`, `generateRoomCode`), `AdmissionLimiter.ts`, `OperationsRoutes.ts`(`OPERATIONS_ROUTES`, `operationsCommandSchema`). bootstrap: `ProductProfile`로 F 설정·E factory 주입, `MediaCoordinatorDeps` 명시 매핑(`getGameActivity` = `SlotRegistry.activity()` 사본), `initialize()` fatal → listen 0회.
- 검증: `session-routes.test.ts`(생성/참가/타 초대 403/malformed 400/rate 429/DRAINING 503), `admission-limiter.test.ts`, `operations-routes.test.ts`(202 pending·같은 body 같은 operationId·409·404·401·포트 없음 503) exit 0. `product-payload.test.ts`에서 7번째 세션 503.
- blockedOn: E `createMediaCoordinator`/`OperationsPort` 실제 구현, F `SESSION_ATTEMPT_*`·trust proxy·`MediaConfiguration` 매핑 값. await 중 drain 경합은 admission 재검사 코드로만 검증(E 없음).

### B-08 · AC-03 · S15P21C204-88 — `e0dff93` `4a2b42a`

- 진입점 `server/src/session/ProductSessionStore.ts`(issue/authenticate/get/getByPlayer/claimConnection/releaseConnection/touch/invalidate/invalidateRoom/sessionsInRoom/prune, `SESSION_LIMITS` 30분 lease·2시간 최대), `session-types.ts`(`SessionAuth`).
- 검증: `product-session.test.ts`, 기존 `server/tests/session.test.ts` exit 0. 통합: 같은 세션 두 번째 join → SESSION_IN_USE.
- 인계 C: sessionToken은 메모리에만, expiresAt은 epoch ms.

### B-09 · AC-04 · S15P21C204-89 — `34addb0` `4a2b42a`

- 진입점 `server/src/session/SlotRegistry.ts`(reserve/markJoined/markRetiring/release{confirmedRetirement}/closeRoom/setPhase/activity 등), `RoomAdmission.ts`(maxRooms 집합, 개발 싱글턴 1 유지). 제품 Room은 `filterBy(['roomCode'])`.
- 검증: `slot-registry.test.ts`(6/60/ROOM_LIMIT, RETIRING 점유 유지, 진행 중 ROOM_CLOSED, 멱등 closeRoom, activity), `room-admission.test.ts` exit 0.
- blockedOn: E OP-04 retire 확인 control(현재 미디어 없으면 좌석 즉시 해제), F 검증 Room 수(`ProductProfile.maxRooms`).

### B-10 · SV-06 · S15P21C204-90 — `4d47ba7` `4a2b42a`

- 진입점 `server/src/game/Heartbeat.ts`(`HeartbeatTracker.register/due/ack/sweep/close/resetForMatch`), `server/src/game/ClockSync.ts`(`ClockSync.handle` → reply|rejected|limited).
- 검증: `heartbeat.test.ts`, `clock-sync.test.ts`, `packages/protocol/test/heartbeat.test.ts` exit 0.
- 인계 C FL-10/SessionRuntime: `game-heartbeat` 2초, ack는 같은 epoch/match/seq만 인정, 6초 무응답·close → CONNECTION_LOST 1회. `clock-reply`는 서버 monotonic ms.

### B-11 · SV-07 · S15P21C204-91 — `9a13eb3` `4a2b42a`

- 진입점 `server/src/game/EventDispatcher.ts`(`publishView(playerId, reason, phase)`, `dispatchEvent(event, gameInstanceId)`, `handleResync`, `applicableVersion`, `EMPTY_VIEW_BODY`, `PrivateViewBody`).
- 검증: `event-dispatcher.test.ts`, `command-outcome.test.ts`(accepted EXIT_START → core 거절 → 마지막 뷰 버전의 rejected outcome → request-status done → 타인 unknown → 재전송 core 재호출 없음) exit 0.
- blockedOn: C 처리기(미래 사건 64/1초 큐, scope/phase 장벽) 실제 연결.

### B-12 · FL-01 · S15P21C204-92 — `14d6334` `4a2b42a`

- 진입점 `server/src/rooms/LobbyCoordinator.ts`(add/remove/setConnected/applyReady/evaluate/assignRoles/roster/host).
- 검증: `lobby-ready.test.ts`, `room-roster.test.ts`, 통합에서 6명 → DEVICE_CHECK → 전원 READY → TEAM_PRACTICE 3:3 exit 0.
- 인계 C AC-06/FL-02: `room-roster` 예시 `{matchId,stateVersion,phase,hostId,players:[{playerId,nickname,ready,connected}]}`; READY는 DEVICE_CHECK에서만 applied, 다른 단계 INVALID_PHASE.

### B-13 · AC-05 · S15P21C204-93 — `8c85e92` `4a2b42a`

- 진입점 `server/src/session/RoomExpiry.ts`(`RoomExpiry.decide`, `selectHost`). Room: LOBBY/DEVICE_CHECK 이탈 시 좌석 해제·세션 무효화, 진행 중 이탈은 CONNECTION_LOST control + (미디어 시) RETIRING.
- 검증: `room-expiry.test.ts`, `host-transfer.test.ts` exit 0.
- blockedOn: F `ROOM_IDLE_TTL_MS`(없으면 idle 만료 없음), E 회수 확인.

### B-14 · KN-04 · S15P21C204-94 — `9af13c4` `4a2b42a`

- 진입점 `server/src/game/PlayerProjection.ts`(`projectPrivateBody(core,state,playerId,loading)`, `projectVisibleEntities`, `projectSelf`; sandbox `projectSandbox` 유지).
- 검증: `private-view.test.ts`, 통합 `product-payload.test.ts`(공개 상태 키 allowlist, 술래 knownActiveExits [], 도망자 자기 출구만, 종료자 최소 self) exit 0.
- blockedOn: A KN-02/03 selector 실제 구현. C/D에 fixture 전달: `server/test/protocol/private-view.test.ts` 기대값과 `packages/protocol/src/game-messages/events.ts` `privateViewSchema`.

### B-15 · FL-03 · S15P21C204-95 — `dbb3a95` `4a2b42a`

- 진입점 `server/src/rooms/PracticeCoordinator.ts`. Room `startPractice`: A `preparePracticeLayout(raw, players, role)` ready layout → `createPractice`, 팀별 gameInstanceId·(미디어 시) mediaInstanceId, 60초/전원 PRACTICE_READY, 종료 시 none 빈 뷰·pending canceled.
- 검증: `practice.test.ts`, 통합에서 practice/1 → none/2 → game/3 exit 0.
- blockedOn: A MP-01(`PracticeLayoutPort`, practice-v1.json), RL-01 createPractice, E MC-08.

### B-16 · FL-05 · S15P21C204-96 — `b75f7bd` `4a2b42a`

- 진입점 `server/src/game/LayoutLoader.ts`(`LayoutLoader.prepare`, `LAYOUT_BUDGET` 100ms/256/8), `server/src/rooms/LoadingCoordinator.ts`(open/setReceiverGeneration/applyLoadReady/confirmSelfFace/evaluate/invalidate/loadingView, `LOADING_TIMEOUT_MS`).
- 검증: `layout-loader.test.ts`(hash·variant 정렬·seed 선택·fallback 바인딩·budget return·invalid-progress·파일/JSON/템플릿/fallback 구조 실패), `loading-barrier.test.ts`, 통합에서 실제 파일 loader 경로 exit 0.
- blockedOn: A MP-02/04/05 실제 포트, F 콘텐츠 경로(`ProductProfile.layouts.masterPath/fallbackPath/templateId/templateVersion`), E 세대 준비/binding self faceTrackSid(현재 미디어 없음 → receiverGeneration 0·얼굴 확인 생략, LOCAL_VERIFIED만).

### B-17 · FL-06 · S15P21C204-97 — `1ec6356` `4a2b42a`

- 진입점 `server/src/rooms/CountdownCoordinator.ts`(`arm/due/cancel`, `COUNTDOWN_MS`). Room: startAt 공개, due 시 `START_PLAYING{startTick}` 1회, core frame PLAYING 확인 후 `fixStart` → deadlineTick=startTick+3600.
- 검증: `countdown.test.ts`, 통합에서 COUNTDOWN 중 MOVE INVALID_PHASE·PLAYING deadline 고정 exit 0.
- blockedOn: A START_PLAYING 실제 적용, E MC-04.

### B-18 · FL-08 · S15P21C204-98 — `e916cd2` `4a2b42a`

- 진입점 `server/src/rooms/RematchCoordinator.ts`(`apply/canStart/take/pending`). Room `startNewRound`: 새 matchId·큐 reset·heartbeat/dispatcher reset·역할 계획 보관·LOBBY 복귀.
- 검증: `rematch.test.ts`, 통합에서 비방장 NOT_ALLOWED·방장 swap applied(구 matchId outcome)·새 matchId·구 matchId 명령 WRONG_MATCH exit 0.
- blockedOn: A RL-08, E MC-08 회수 확인(`pendingRetirements` 0이어야 새 라운드).

## 2026-09-08 원격 확인과 develop 병합

`origin/develop`(`48f7efa`)을 `a7a264f`로 병합했다. 겹치는 파일은 없고 병합 후 `pnpm exec vitest run` 59 파일 320 case, `pnpm typecheck` 통과.

| 담당 | 도착한 것                                                                                                                                                                                                                                                                                                  | B 연결 상태                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E    | develop에 E-01~~E-10(`server/src/media/*`, `server/src/operations/*`, MR !5~~!14). `server/src/media/types.ts`의 `MediaCoordinatorDeps`/`MediaConfiguration`/`OperationsPort`는 `server/src/game/ports.ts`와 필드가 같다                                                                                   | `createMediaCoordinator`·`createOperatorAuth` factory export는 아직 없음(GrantIssuer/RetirementBarrier/LiveKitWebhook 등 부품만). B-REQ-E-1/E-2 유지, `ProductProfile.media/createOperatorAuth`는 null |
| F    | `origin/ci/S15P21C204-41-jenkins-pipeline`(미병합)에 `parseConfig()`의 `admission{inviteMaxTtlMs,sessionAttemptWindowMs,sessionAttemptsPerInvite,sessionAttemptsPerIp,roomIdleTtlMs}`, `opsToken`, `publicWindow`, `livekit`, `officialBudgetMaxAgeMs`, `operationTimeoutMs`, `mediaApiLimits`, `maxRooms` | develop 병합 전이므로 `main.ts` 매핑은 보류. 병합되면 B가 `ProductProfile`로 매핑(B-REQ-F-1). `MetricRegistry`는 아직 없음                                                                             |
| D    | `origin/feat/S15P21C204-118-vision-media-input-runtime`(D-01~D-17 LOCAL_VERIFIED, 미병합). B 소유 파일 변경 없음. REQ-D-05로 실제 grant 발급 경로(E/B) 요청                                                                                                                                                | B `POST /api/media/grants`는 구현됨, E factory 도착 후 실동작                                                                                                                                          |
| A    | 도착 없음(`handoffs/A.md` 양식 상태)                                                                                                                                                                                                                                                                       | B-REQ-A-1/A-2 유지                                                                                                                                                                                     |

## 다른 소유자에게 요청할 변경

| 요청 ID   | 대상 | 대상 파일                                                             | 필요한 export / 값                                                                                                                                                                                                                             | 이유 · 연결 작업                                                                             | 완료 확인                                                                                             |
| --------- | ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| B-REQ-A-1 | A    | `packages/game-core/src/match/index.ts`, `server/src/domain/index.ts` | `CorePort<State>` 구현(createMatch/createPractice/stepMatch/getPlayerKnowledge/getVisibleEntities/getPlayerSelf/getVisibleSurfaces/getFrame) + `MatchTuning` 값 export. 타입은 `server/src/game/ports.ts`와 동일 형태                          | B-04/B-14/B-15/B-17: `ProductProfile.core/tuning` 주입 후 FakeCore 시험을 실제 core로 재실행 | `pnpm exec vitest run server/test/room/product-payload.test.ts server/test/room/match-driver.test.ts` |
| B-REQ-A-2 | A    | `packages/game-core/src/match/map/*`                                  | `MapPreparationPort`, `LayoutSelectionPort`(certifyFallback/selectWithFallback generator, next당 ≤8 후보), `PracticeLayoutPort` + practice-v1.json 위치                                                                                        | B-15/B-16: `ProductProfile.layouts/practice` 주입                                            | `server/test/room/layout-loader.test.ts`를 실제 포트로 재실행                                         |
| B-REQ-E-1 | E    | `server/src/operations/*`                                             | `createOperatorAuth(token)`                                                                                                                                                                                                                    | B-06/B-07 운영 라우트 인증(현재 test double `createTestOperatorAuth`)                        | `invitation-routes.test.ts`, `operations-routes.test.ts`                                              |
| B-REQ-E-2 | E    | `server/src/media/*`                                                  | `createMediaCoordinator(deps)`: `MediaCoordinatorDeps` 그대로, `enqueueControl/enqueueBindings/enqueueAudioPolicy`는 B `RoomDirectory`가 matchId로 라우팅                                                                                      | B-07 initialize 순서, B-09 RETIRING 해제, B-16 binding self faceTrackSid, B-18 회수 확인     | 통합 시험에 E 실제 coordinator 주입                                                                   |
| B-REQ-F-1 | F    | `server/src/config/env.ts`                                            | AppConfig에 `inviteMaxTtlMs`, `sessionAttemptWindowMs/PerInvite/PerIp`, `roomIdleTtlMs`, `opsToken`, `maxRooms`(검증 Room 수), `publicWindow`, `MediaConfiguration` 필드, trust proxy, 콘텐츠 경로(master/fallback/templateId/templateVersion) | `server/src/main.ts`에서 `ProductProfile`로 매핑(B가 수정)                                   | F export 도착 후 B가 main.ts 연결 커밋                                                                |
| B-REQ-F-2 | F    | `server/src/observability/MetricRegistry.ts`                          | `emitMetric(sample: MetricSample): void`                                                                                                                                                                                                       | B-05 coordinator·E deps에 같은 callback 주입                                                 | `tick-coordinator.test.ts` 이름 allowlist 유지                                                        |
| B-REQ-F-3 | F    | 루트                                                                  | Node 24.19.0 vs 현재 로컬 24.18.0 engine 경고 확인                                                                                                                                                                                             | 검증 환경 기록                                                                               | `pnpm install --frozen-lockfile` 경고 유무                                                            |
| B-REQ-C-1 | C    | `apps/web/src/app/SessionRuntime.ts`                                  | 위 채널·스키마 소비, `readPublicRoundState`로 null 정규화, 개발 `joinTeamRoom('kkakkung',0.1.0)`은 제품 profile 서버에서는 PROTOCOL_MISMATCH                                                                                                   | B-02/B-11/B-14 소비자 시험                                                                   | C 인계 기록                                                                                           |
| B-REQ-D-1 | D    | `apps/web/src/features/media/*`                                       | `mediaBindingsSchema`/`audioPolicySchema` 모양 소비, `media-bindings-refresh` 1초 1회                                                                                                                                                          | B-11 재대조 시험                                                                             | D 인계 기록                                                                                           |

## 재개 시 확인

1. `git log b12cb9c..HEAD`의 20개 커밋이 현재 checkout에 있는지 확인한다(원격 push 전).
2. `pnpm build:packages && pnpm exec vitest run` — 2026-09-08 결과 46 파일 200 case 통과. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:execution`, `node scripts/check-role-scope.mjs --role B --base b12cb9c` 모두 통과.
3. A/E/F export가 도착하면 `ProductProfile`에 주입하고 `product-payload.test.ts`·`match-driver.test.ts`·`layout-loader.test.ts`를 실제 포트로 재실행한 뒤에만 INTEGRATED로 올린다. 미디어가 있는 로딩 장벽(binding self faceTrackSid)·회수 확인·drain 경합은 E 결합 후 재검증한다.
4. 개발 회귀(`server/tests/integration/kkakkung.test.ts`, 웹 e2e team-room)는 제품 profile이 없을 때 `DevKkakkungRoom`으로 유지된다. `main.ts`는 아직 개발 profile로 기동한다(F 설정 도착 후 제품 profile 연결).
