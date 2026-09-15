# B 인계 · 게임 서버·입장·Room 조립

담당 정유림 · 2026-09-15 정리 · 코드 `server/src/{game,rooms,session}`, `packages/protocol`

B는 공개 전송 계약(protocol 0.2.0), HTTP 입장, Colyseus Room과 Tick 조립을 소유한다. `SERVER_PROFILE=product`에서 `ProductProfileLoader`가 A 코어·튜닝·맵 포트, E 미디어 coordinator·운영 인증, F 설정·관측을 조립한다. 전송 규약 전체는 [protocol.md](../protocol.md)가 기준이다.

## 상태

- 제품 Room의 로비 → 장치 점검 → 팀 연습 → 맵 확정 → 로딩 → 카운트다운 → 경기 → 결과/무효 → 재경기가 실제 A/E/F와 연결돼 있고 DP-06 배포 시험에서 매 배포 통과한다.
- 방장 제어(입장 잠금·로비 강퇴), 방장 친구 초대, 게스트 입장(`SERVICE_AUDIENCE=public`, publisher-permissions 미디어와 함께 부팅 가능, 운영 비활성), 체류 기한(로비 10분·준비/결과/중단 5분)이 병합돼 있다.
- F-REQ-15: 한 방의 tick 예외는 그 방만 `SERVER_TICK_OVERLOAD`로 끝내고 재무장한다(`tick-isolation.test.ts`로 Room 레벨 고정).
- F-REQ-17(GAME_LOADING 지연): 원인은 B tick이 아니라 E readiness 비교였고 E의 249로 해소. 연속 3빌드에서 `GAME_LOADING` 창 최대 lag < 100ms·CPU < 80ms 확인. B 코드 변경 없음, `overloadMs=250` 유지.

## 모듈 진입점

| 모듈                                           | 책임                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `server/src/game/ports.ts`                     | 서버 내부 포트: A `CorePort`, E `MediaCoordinator`·`OperationsPort`, F `EmitMetric`. 제품 코드는 이것을 import |
| `server/src/game/MatchContext.ts`              | serverEpoch·matchId·연속 stateVersion/serverTick, 논리 scope(practice/game/none) 레지스트리                    |
| `server/src/game/CommandAdapter.ts`            | wire 명령 검증 → core/phase 명령, actorId 주입                                                                 |
| `server/src/game/CommandQueue.ts`              | 중복·STALE·QUEUE_FULL, 유지 이동 500ms 만료. 대기 참가자당 64 / 방 384, 완료 기록 참가자당 512·2분             |
| `server/src/game/CommandLimiter.ts`            | 토큰 버킷 초당 30·버스트 60                                                                                    |
| `server/src/game/MatchDriver.ts`               | 한 Tick에 core step 1회, outcome 정확히 1개, 미디어 control 적용                                               |
| `server/src/game/RoomTickCoordinator.ts`       | 50ms Tick, catch-up 최대 4회, 250ms 초과 overload, 방별 예외 격리·재무장                                       |
| `server/src/game/EventDispatcher.ts`           | private-view 발행(구조 비교로 변경 판정), 사건 전달, view-resync                                               |
| `server/src/game/PlayerProjection.ts`          | 개인 뷰 투영. 공개 상태 키 allowlist, 술래 출구 빈 배열                                                        |
| `server/src/game/Heartbeat.ts`, `ClockSync.ts` | 2초 heartbeat, 6초 무응답 → CONNECTION_LOST, clock-probe 초당 5회                                              |
| `server/src/game/LayoutLoader.ts`              | 맵 파일 hash·variant·seed·fallback, 예산 100ms / 256 / 8                                                       |
| `server/src/rooms/KkakkungRoom.ts`             | 제품 Room 조립과 단계 전환                                                                                     |
| `server/src/rooms/*Coordinator.ts`             | Lobby(방장·준비·역할), Practice(60초/전원 준비), Loading(30초 장벽·자기 얼굴 확인), Countdown(3초), Rematch    |
| `server/src/session/SessionRoutes.ts`          | `POST /api/sessions`, `DELETE /api/sessions/current`, 방장 초대 라우트                                         |
| `server/src/session/ProductSessionStore.ts`    | 세션 lease 30분·최대 2시간, 메모리 토큰                                                                        |
| `server/src/session/SlotRegistry.ts`           | 방·좌석(6/방, `maxRooms`), RESERVED 60초, RETIRING 좌석은 회수 확인 전 유지                                    |
| `server/src/session/RoomExpiry.ts`             | 체류 기한 결정과 방장 위임                                                                                     |
| `server/src/session/HttpBoundary.ts`           | Origin 정확 일치, `/matchmake`·`/api` 본문 2,048B                                                              |

## HTTP

| 경로                                                     | 인증                 | 결과                                                                                              |
| -------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/sessions/access`                               | 없음                 | `{method: gitlab-sso\|invitation\|guest}`                                                         |
| `POST /api/sessions`                                     | SSO 헤더·초대·게스트 | 201 / 400 / 403 INVALID_INVITATION / 404 ROOM_NOT_AVAILABLE / 429 / 503 ADMISSION_CLOSED·CAPACITY |
| `DELETE /api/sessions/current`                           | 세션 Bearer          | 204 미가입 예약 반환 / 409 SESSION_IN_USE                                                         |
| `POST`·`DELETE /api/sessions/current/invitation`         | 방장 세션 Bearer     | 201 초대 / 204 회수                                                                               |
| `POST /api/operations/invitations`, `…/:inviteId/revoke` | OPS_TOKEN            | 운영 초대 발급·회수(invitation 모드·내부 시험)                                                    |
| `/api/operations/commands`, `…/:requestId`, `…/status`   | OPS_TOKEN            | E OperationsPort 위임. 인증 조립이 없으면 503, 토큰 틀리면 401                                    |
| `POST /api/media/grants`, `/api/media/report`            | 세션 Bearer          | E 발급·상태 보고 위임                                                                             |
| `POST /api/livekit/webhook`                              | 서명(raw body)       | express.json 이전에 등록                                                                          |

Room 입장: `joinOrCreate('kkakkung', { token, roomCode, protocolVersion: '0.2.0' })`. static onAuth에서 400 INVALID_JOIN / 409 PROTOCOL_MISMATCH / 401 INVALID_SESSION / 403 WRONG_ROOM·ROOM_CLOSED / 409 SESSION_IN_USE.

## 제품 프로파일과 배포 설정 (S15P21C204-239)

- 제품 배포는 `NODE_ENV=development`, `SERVER_PROFILE=product`, `MEDIA_MODE=livekit`. `NODE_ENV=production`은 `env.ts`에서 거절한다.
- 비밀·정책 env(원본 `infra/production.env.example`, 값은 Jenkins Secret file에만): `LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PROJECT_ALIAS`, `SERVICE_NAMESPACE`, `OPS_TOKEN`, `OPS_OPERATING_MODE`, `OPS_OPERATION_TIMEOUT_MS`, `MEDIA_MAX_NORMAL_API_CALLS_PER_60S`, `MEDIA_MAX_TOTAL_API_CALLS_PER_60S`, `INVITE_MAX_TTL_MS`, `SESSION_ATTEMPT_WINDOW_MS`, `SESSION_ATTEMPTS_PER_INVITE`, `SESSION_ATTEMPTS_PER_IP`. attested만 공개창 두 시각과 `OPS_OFFICIAL_BUDGET_MAX_AGE_MS`를 추가로 요구한다.
- 팀 continuous overlay가 고정하는 값: `TRUST_PROXY_HOPS=1`, `SERVICE_AUDIENCE=team`, `SESSION_ADMISSION_MODE=gitlab-sso`, `OPS_OPERATING_MODE=continuous`, `ROOM_IDLE_TTL_MS=600000`, `MAX_ROOMS`/`MAX_SLOTS`(`MAX_SLOTS = MAX_ROOMS × 6`).
- 배포 뒤 확인: loopback `GET http://127.0.0.1:8080/api/operations/status`(Bearer OPS_TOKEN) 200만으로 끝내지 않고 READY·admission OPEN·미확인 회수 0을 함께 본다.

## 재경기 뒤 입장 503 (S15P21C204-236)

- 상태 `LOCAL_NOT_REPRODUCED`(develop `a384077`). 실제 제품 서버·Colyseus·웹 product runtime으로 6인 경기 종료 → 재경기 → 기존 참가자 퇴장 → 새 세션·대체 참가자 입장 → 다음 경기 완료를 attested/continuous 두 모드에서 실행해 모두 통과했다(closed 72·실패 0·참가자 0·READY). `product-payload`·`media-retirement-lifecycle` 19개 시험도 통과해 `startNewRound`·좌석 수명 결함은 재현되지 않았다.
- 503은 두 경계 중 하나다. `POST /api/sessions` 503이면 `SessionRoutes`의 `ADMISSION_CLOSED` 또는 `CAPACITY`. 세션은 201인데 Colyseus matchmake가 503이면 `KkakkungRoom.onAuth`/`onJoin` 시점 `operationsReady()`가 false인 `NOT_READY`(발급과 소켓 입장 사이 readiness·admission·canIssue 변화로도 가능하나 미관측).
- 재발 시 같은 시각의 ① `/api/sessions` 상태·오류 JSON ② matchmake 상태·오류 코드 ③ 인증된 `/api/operations/status`의 readiness·admission ④ room phase·blockedReason을 함께 남긴다.

## 다른 역할과의 경계

- C: `readPublicRoundState(state)`로 absent 필드를 정규화한다. 명령은 rejected 접수 시 pending을 즉시 끝내고, accepted마다 outcome이 정확히 하나 온다.
- D/E: 미디어 바인딩·가청 정책은 E가 만들고 B가 `media-bindings`·`audio-policy`로 전달한다. `media-bindings-refresh`는 1초 1회.
- 늦게 도착한 맵·발급 결과는 현재 단계에 적용하지 않는다. 미디어 발급 실패·불명은 같은 match에서 숨은 세대를 재사용하지 않고 `ABORTED/MEDIA_UNAVAILABLE`로 끝낸다.

## 남은 일

- [S15P21C204-231](https://ssafy.atlassian.net/browse/S15P21C204-231) 준비 단계 30초 반복 실패 원인 확정과 수정.
- [S15P21C204-236](https://ssafy.atlassian.net/browse/S15P21C204-236) 재경기 뒤 입장 503: 로컬 재현 실패로 B 범위 종료(아래). 실제 6인 환경에서 재발하면 원인 확정.
- [S15P21C204-237](https://ssafy.atlassian.net/browse/S15P21C204-237) 6대 5판 단계 정지·늦은 메시지·세대 혼입 재현과 회귀.
- [S15P21C204-238](https://ssafy.atlassian.net/browse/S15P21C204-238) Tick·WS·세션 정리 결함과 미디어 IO의 tick 차단 확인.
- W07 공개 대상: ingress·배포 manifest의 audience 연동과 같은 이미지 team→public→team 리허설.
