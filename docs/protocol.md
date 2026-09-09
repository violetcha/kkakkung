# 프로토콜

두 계약이 공존한다. **제품 계약 `0.2.0`**은 `kkakkung` Room과 `/api/sessions` 이하 제품 HTTP 경로에 적용되며 원본은 [`packages/protocol/src/game-messages`](../packages/protocol/src/game-messages/index.ts)와 [`game-schema/product.ts`](../packages/protocol/src/game-schema/product.ts)다. **진단 계약 `0.1.0`**은 개발용 `sandbox` Room과 제품 profile이 없을 때 등록되는 개발 `kkakkung` Room([server/docs/protocol.md](../server/docs/protocol.md))에만 남는다. 두 계약을 한 메시지로 섞지 않는다.

## 제품 0.2.0

### 입장

1. 운영자가 `POST /api/operations/invitations`(OPS_TOKEN)로 초대 토큰을 발급한다. 초대 토큰은 방 코드와 다른 고엔트로피 값이며 서버는 해시만 저장한다.
2. 클라이언트가 `POST /api/sessions`에 strict `SessionRequest`를 보낸다. 생성은 `{nickname, inviteToken, createRoom: true}`(roomCode 금지), 참가는 `{nickname, inviteToken, createRoom: false, roomCode}`다. 응답은 `SessionResponse {sessionToken, playerId, roomCode, expiresAt(epoch ms), protocolVersion: '0.2.0'}`이고 `Cache-Control: no-store`다.
3. `Client.joinOrCreate('kkakkung', { token: sessionToken, roomCode, protocolVersion: '0.2.0' })`. 서버는 매칭 전에 세션·방 코드·버전·좌석·중복 연결을 검사한다(400 INVALID_JOIN, 409 PROTOCOL_MISMATCH, 401 INVALID_SESSION, 403 WRONG_ROOM/ROOM_CLOSED, 409 SESSION_IN_USE).

새 참가는 LOBBY/DEVICE_CHECK에서만 허용하며 진행 중 충원과 같은 세션의 재접속 재개는 거절한다.

### 채널

| 방향      | 채널                                       | 본문                                                                                                                         |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| C→S       | `command`                                  | `CommandEnvelope {matchId, requestId(UUID), sequence, type, payload}` — 활성 14종만                                          |
| S→C       | `command-result`                           | `CommandReceipt` accepted(code null) / rejected(CommandCode). 접수 단계 결과                                                 |
| S→C       | `command-outcome`                          | `CommandOutcome {…, tick, stateVersion, result: applied\|rejected\|canceled, code}` — accepted마다 정확히 하나, 요청자에게만 |
| C→S / S→C | `request-status` / `request-status-result` | 자기 원장의 pending / done(원래 outcome) / unknown                                                                           |
| S→C       | `room-roster`                              | 대기 단계 목록. role/좌표/출구 없음                                                                                          |
| S→C       | `private-view`                             | 수신자 전용 전체 교체 뷰. `gameScope`는 practice/game/none + revision                                                        |
| S→C       | `private-event`                            | audience 사건. `gameScope`는 ActiveGameScope                                                                                 |
| C→S       | `view-resync`                              | `{matchId, lastStateVersion}`, 수신자당 1초 1회                                                                              |
| S→C / C→S | `game-heartbeat` / `game-heartbeat-ack`    | 2초 간격, 6초 무응답 또는 close → 연결 상실                                                                                  |
| C→S / S→C | `clock-probe` / `clock-reply`              | 표시용 시각 추정. 서버 monotonic ms, 초당 5회                                                                                |
| S→C       | `media-bindings`, `audio-policy`           | E가 만든 허용 목록. scope는 미디어 식별자                                                                                    |
| C→S       | `media-bindings-refresh`                   | 현재 목록 재전송 요청, 1초 1회                                                                                               |

공개 Colyseus 상태 `PublicMatchState`는 `phase, matchId, stateVersion, serverTick, startTick, startAt, deadlineTick, counts, result, abortReason`만 가진다. null 필드는 Schema에서 **absent(undefined)** 로 전달되므로 소비자는 `readPublicRoundState(state)`로 정규화한다. 전체 맵·플레이어·출구·seed·튜닝은 공개 상태에 없다.

### 거절과 크기

- 명령 payload는 UTF-8 4,096바이트 상한, sequence는 비음수 safe integer, requestId는 UUID, 추가 필드는 거절이다. 클라이언트가 보낸 playerId/좌표/팀은 받지 않는다.
- HTTP `/matchmake/*`·`/api/*` JSON 본문은 2,048바이트 상한이며 Content-Length와 실제 수신 바이트 모두 검사한다. Origin이 있으면 ALLOWED_ORIGINS의 정확한 값만 허용하고 `null`·빈 값·복수·비허용은 403이다. 거절된 요청은 방·좌석·세션을 만들지 않는다.
- 접수 거절 코드는 `INVALID_COMMAND, PROTOCOL_MISMATCH, WRONG_MATCH, RATE_LIMITED, INVALID_PHASE, NOT_ACTIVE, QUEUE_FULL, STALE_REQUEST`, 종결 코드는 위와 `NOT_ALLOWED, EXPIRED, NOT_READY, ROUND_ENDED, CANCELED`를 사용한다.

계약을 변경할 때는 Zod 검증, Colyseus Schema, 문서 원본 `docs/execution/contracts/types.ts`, 웹·서버 소비자 시험을 함께 변경한다.

## 진단 0.1.0 (sandbox)

`joinOptionsSchema`는 `{ token: string, protocolVersion: string }`만 허용한다. 서버는 일회성 개발 토큰을 소비하고 playerId를 발급한다. 메시지 `move {seq, x, z}`는 `seq`가 0 이상의 안전한 정수, 축 값이 유한한 `-1..1`이며 잘못된 명령은 `command-rejected {code}`로 알린다. `PlayerState {playerId, nickname, x, z}`, `SandboxState {protocolVersion, phase=sandbox, tick, players}`는 연결 시험용 공개 상태다.

개발 `kkakkung`(0.1.0)의 `move {seq, dir}`, `turn`, `ready`, 셀 `x/y`와 sandbox의 `{seq,x,z}`, 제품 0.2.0의 `command` 봉투를 같은 메시지로 간주하지 않는다.
