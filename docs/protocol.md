# 프로토콜

두 계약이 공존한다. **제품 계약 `0.2.0`**은 `kkakkung` Room과 `/api/sessions` 이하 제품 HTTP 경로에 적용되며 원본은 [`packages/protocol/src/game-messages`](../packages/protocol/src/game-messages/index.ts)와 [`game-schema/product.ts`](../packages/protocol/src/game-schema/product.ts)다. **진단 계약 `0.1.0`**은 개발용 `sandbox` Room과 제품 profile이 없을 때 등록되는 개발 `kkakkung` Room([server/docs/protocol.md](../server/docs/protocol.md))에만 남는다. 두 계약을 한 메시지로 섞지 않는다.

## 제품 0.2.0

### 입장

1. 클라이언트가 `GET /api/sessions/access`로 해당 요청의 `{method: 'gitlab-sso' | 'invitation' | 'guest'}`을 확인한다. no-store이며 실제 신원·토큰은 반환하지 않는다. 기본 invitation에서는 운영자가 `POST /api/operations/invitations`(OPS_TOKEN)로 발급한 초대 토큰이 필요하다. 토큰은 방 코드와 다른 고엔트로피 값이며 서버는 해시만 저장한다.
2. 클라이언트가 `POST /api/sessions`에 strict `SessionRequest`를 보낸다. 생성은 `{nickname, inviteToken?, createRoom: true}`(roomCode 금지), 참가는 `{nickname, inviteToken?, createRoom: false, roomCode}`다. inviteToken 생략은 명시적 GitLab SSO 모드에서 신뢰 프록시가 확인한 운영 등록 이메일 또는 명시적 guest 모드의 새 방 생성에서 가능하다. 게스트 친구 참가에는 방별 초대가 필요하며 명시한 링크는 생성/SSO 요청에서도 검증한다. POST는 매번 인증을 검사하며 access 응답이나 본문의 신원 주장으로 인증하지 않는다. 응답은 `SessionResponse {sessionToken, playerId, roomCode, expiresAt(epoch ms), protocolVersion: '0.2.0'}`이고 `Cache-Control: no-store`다.
3. `Client.joinOrCreate('kkakkung', { token: sessionToken, roomCode, protocolVersion: '0.2.0' })`. 서버는 매칭 전에 세션·방 코드·버전·좌석·중복 연결을 검사한다(400 INVALID_JOIN, 409 PROTOCOL_MISMATCH, 401 INVALID_SESSION, 403 WRONG_ROOM/ROOM_CLOSED, 409 SESSION_IN_USE).

새 참가는 LOBBY/DEVICE_CHECK에서만 허용하며 진행 중 충원과 같은 세션의 재접속 재개는 거절한다.

SSO 인증은 `SESSION_ADMISSION_MODE=gitlab-sso`와 제품·프록시 신뢰 설정이 모두 필요하다.
호스트 Nginx는 운영 등록 이메일 검사를 통과한 GitLab 신원으로 `X-SSO-User`를 덮어쓴다.
게임 포트는 외부에 공개하지 않고 web-proxy는 loopback에만 바인딩한다.
내부 smoke 프록시는 이 헤더를 제거하여 기존 초대 인증을 사용한다.
SSO 회원의 해시를 기존 inviteId 제한 버킷에 사용하고 IP·인원·방 상태·운영 잠금 검사는 동일하다.
이름을 바꿔도 회원별 입장 시도 제한을 초기화하지 않는다. 명시적 초대 경로와 0.2 게임 소켓 계약은 호환된다.

`SERVICE_AUDIENCE=team|public`이 각각 gitlab-sso/guest를 선택한다. 함께 지정한 기존 입장
모드가 다르면 부팅을 거절한다. guest는 전달된 SSO 신원을 사용하지 않고 생성 IP를 해시한
시도 버킷과 임의 세션 신원을 분리한다. public+livekit은 `MEDIA_SUBSCRIPTION_MODE=publisher-permissions`일 때만 허용하고 server-controlled는 거절한다(`PUBLIC_MEDIA_REQUIRES_PUBLISHER_PERMISSIONS`).
팀·기본 invitation 동작은 호환되며 이전 웹이 알 수 없는 guest 응답을 받으면 닫힌 상태를 유지한다.
게스트는 닉네임으로 방을 만들 수 있지만 방 코드만으로는 참가하지 못하고 방장이 만든 초대가 필요하다.
운영은 `team`이며 공개 대상 전환(ingress·배포 manifest 연동)은 후속이다.

### 방장 친구 초대와 방 제어

- `POST /api/sessions/current/invitation`(빈 본문, 현재 게임 세션 Bearer) → 201 `{inviteToken, roomCode, expiresAt}`. 현재 접속한 방장만, LOBBY·DEVICE_CHECK에서, admission OPEN일 때 발급한다. 현 방 참가 전용이며 최대 10분, 서버는 digest만 저장하고 방마다 최신 초대 하나만 추적한다.
- `DELETE /api/sessions/current/invitation` → 204. 반복 회수 가능, DRAINING에서도 허용. 회수·재발급은 이전 초대와 그 초대로 예약만 한 세션을 함께 무효화하며, 이미 참가한 사람의 좌석은 보존한다.
- 공유 URL은 `/#invite=…&room=…`이며 세션 토큰을 담지 않는다. 웹은 fragment를 읽은 즉시 주소에서 지운다.
- 방장은 `ROOM_LOCK`으로 대기방 새 입장을 잠그고 `ROOM_KICK`으로 로비 참가자를 내보낸다. 초대 회수는 강퇴나 팀원 권한 취소를 대신하지 않는다. 방장이 나가면 연결된 참가자 중 먼저 들어온 사람에게 위임한다.

HTTP 발급 후 첫 게임 소켓 연결은 60초 안에 완료해야 한다. 이 미가입 기한은 세션의 활동 기반 30분 lease와 별도이며, 연결을 점유하면 해제된다. 응답을 받지 못했거나 탭이 닫힌 예약은 서버의 1초 정리 주기 또는 다음 입장 요청에서 반환된다. 이미 JOINED/RETIRING인 좌석은 미가입 정리로 반환하지 않는다.

입장 취소·소켓 연결 실패·새 초대에 의한 이전 요청 폐기 시 웹은 `DELETE /api/sessions/current`를 보낸다. 소유자의 세션 Bearer로만 식별하며 본문은 없거나 빈 객체다. playerId·roomCode를 본문으로 지정할 수 없다. 입장 잠금 중에도 정리는 가능하며, Origin·본문 크기 제한은 동일하게 적용한다.

| 응답                | 의미                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| 204, 빈 본문        | 미가입 예약 반환, 또는 이미 취소·만료된 토큰. 반복 호출은 다른 예약에 영향을 주지 않는다. |
| 400 INVALID_REQUEST | 신원 지정 등 허용하지 않는 본문                                                           |
| 401 INVALID_SESSION | Bearer 누락 또는 빈 값                                                                    |
| 409 SESSION_IN_USE  | 활성 연결 또는 JOINED/RETIRING. 게임 퇴장·미디어 회수 경로로만 반환                       |

새 초대 hash는 같은 탭에서도 읽은 즉시 주소에서 제거한다. 입장 화면의 새 초대는 이전 입장 요청을 폐기하고 방 코드를 갱신한다. 진행 중인 참가자는 유지하고 새 초대는 다음 입장에 적용한다. 브라우저 영구 저장소에는 토큰을 기록하지 않는다.

### 채널

| 방향      | 채널                                       | 본문                                                                                                                                                                                                  |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C→S       | `command`                                  | `CommandEnvelope {matchId, requestId(UUID), sequence, type, payload}` — 17종. 게임 코어 명령과 방 단계 명령(`READY`, `ROOM_LOCK`, `ROOM_KICK`, `PRACTICE_READY`, `LOAD_READY`, `REMATCH`, `SPECTATE`) |
| S→C       | `command-result`                           | `CommandReceipt` accepted(code null) / rejected(CommandCode). 접수 단계 결과                                                                                                                          |
| S→C       | `command-outcome`                          | `CommandOutcome {…, tick, stateVersion, result: applied\|rejected\|canceled, code}` — accepted마다 정확히 하나, 요청자에게만                                                                          |
| C→S / S→C | `request-status` / `request-status-result` | 자기 원장의 pending / done(원래 outcome) / unknown                                                                                                                                                    |
| C→S / S→C | `demo-scenario` / `demo-state`             | 관리자 데모 방 전용(259). 일반 방은 보내지도 받지도 않는다                                                                                                                                            |
| S→C       | `room-roster`                              | 대기 단계 목록. role/좌표/출구 없음                                                                                                                                                                   |
| S→C       | `private-view`                             | 수신자 전용 전체 교체 뷰. `gameScope`는 practice/game/none + revision. 개인 종료한 도망자가 생존 도망자를 관전하는 동안만 `spectating {targetId, cell, dir, action, candidates}`가 붙는다(269)        |
| S→C       | `private-event`                            | audience 사건. `gameScope`는 ActiveGameScope                                                                                                                                                          |
| C→S       | `view-resync`                              | `{matchId, lastStateVersion}`, 수신자당 1초 1회                                                                                                                                                       |
| S→C / C→S | `game-heartbeat` / `game-heartbeat-ack`    | 2초 간격, 6초 무응답 또는 close → 연결 상실                                                                                                                                                           |
| C→S / S→C | `clock-probe` / `clock-reply`              | 표시용 시각 추정. 서버 monotonic ms, 초당 5회                                                                                                                                                         |
| S→C       | `media-bindings`, `audio-policy`           | E가 만든 허용 목록. scope는 미디어 식별자                                                                                                                                                             |
| C→S       | `media-bindings-refresh`                   | 현재 목록 재전송 요청, 1초 1회                                                                                                                                                                        |

공개 Colyseus 상태 `PublicMatchState`는 `phase, matchId, stateVersion, serverTick, startTick, startAt, deadlineTick, counts, result, abortReason`과 선택 안내 필드만 가진다. null 필드는 Schema에서 **absent(undefined)** 로 전달되므로 소비자는 `readPublicRoundState(state)`로 정규화한다. 전체 맵·플레이어·출구·seed·튜닝은 공개 상태에 없다.

- `roomExpiresInSeconds`: 대기/결과 방 만료 60초 전부터 표시한다. 방 만료 소켓 종료 코드는 4001이다.
- `preparationIssue`: LOBBY/DEVICE_CHECK의 준비 실패를 `SERVICE_NOT_READY`, `LAYOUT_UNAVAILABLE`, `DEVICE_LOADING_TIMEOUT`, `MEDIA_NOT_READY`, `PREPARATION_UNAVAILABLE`로만 전달한다. 내부 blockedReason·경로·맵 정보는 전달하지 않고 재시도 단계에 진입하면 지운다.
- `rematchState`: RESULT/ABORTED에서 `settling`(연결 회수 대기), `available`(재경기 선택 가능), `requested`(방장이 요청하여 전환 대기)를 전달한다. 회수 중에도 방장은 요청할 수 있으며 회수가 확인되면 로비로 전환한다. 인원이 6명 미만이면 로비에서 모집한다. 새 경기에서는 필드를 지운다.

새 필드는 뒤에 추가한 선택 메타데이터다. 이전 0.2 서버는 생략할 수 있고 웹은 일반 준비/재경기 안내를 유지한다. 알 수 없는 준비·재경기 값은 화면에 노출하지 않는다.

**관전(269).** PLAYING 중 개인 종료(포획·탈출)한 도망자는 결과 화면 대신 생존 도망자 한 명의 뷰를 받는다. `private-view`의 `knownTerrain·knownActiveExits·visibleCells·visibleWallFaces·visibleEntities`는 **대상의 것**이고 `self`는 자기 종료 기록 그대로, `spectating`에 대상 id·칸·방향·행동과 전환 가능한 후보(`candidates`, 생존 도망자 id)가 온다. 대상은 `SPECTATE {targetPlayerId}` 방 단계 명령으로 바꾸며(PLAYING에서만, 후보 밖이면 `NOT_ALLOWED`), 고르지 않으면 명단 순서의 첫 생존 도망자다. 대상이 종료되면 다음 생존 도망자로 자동 전환되고 생존 도망자가 없으면 라운드가 끝난다. 관전자는 게임 명령을 낼 수 없고(`NOT_ACTIVE`), 미디어는 **대상 위치를 가청 기준**으로 받는다 — 대상이 듣는 음성(대상 본인 목소리 제외)과 대상이 보는 얼굴. 관전자 본인의 얼굴·음성은 누구에게도 가지 않는다(ACTIVE 발신자만 가청·가시). 술래는 개인 종료가 없어 관전하지 않는다. 이 필드와 명령은 0.2.0 안의 추가분이며 관전자에게만 붙는다.

### 거절과 크기

- 명령 payload는 UTF-8 4,096바이트 상한, sequence는 비음수 safe integer, requestId는 UUID, 추가 필드는 거절이다. 클라이언트가 보낸 playerId/좌표/팀은 받지 않는다.
- HTTP `/matchmake/*`·`/api/*` JSON 본문은 2,048바이트 상한이며 Content-Length와 실제 수신 바이트 모두 검사한다. Origin이 있으면 ALLOWED_ORIGINS의 정확한 값만 허용하고 `null`·빈 값·복수·비허용은 403이다. 거절된 요청은 방·좌석·세션을 만들지 않는다.
- 접수 거절 코드는 `INVALID_COMMAND, PROTOCOL_MISMATCH, WRONG_MATCH, RATE_LIMITED, INVALID_PHASE, NOT_ACTIVE, QUEUE_FULL, STALE_REQUEST`, 종결 코드는 위와 `NOT_ALLOWED, EXPIRED, NOT_READY, ROUND_ENDED, CANCELED`를 사용한다.

계약을 변경할 때는 Zod 검증, Colyseus Schema, 시험용 공유 계약 `tests/contracts/shared/`, 웹·서버 소비자 시험을 함께 변경하고 생산자·소비자 담당이 함께 검토한다.

## 진단 0.1.0 (sandbox)

`joinOptionsSchema`는 `{ token: string, protocolVersion: string }`만 허용한다. 서버는 일회성 개발 토큰을 소비하고 playerId를 발급한다. 메시지 `move {seq, x, z}`는 `seq`가 0 이상의 안전한 정수, 축 값이 유한한 `-1..1`이며 잘못된 명령은 `command-rejected {code}`로 알린다. `PlayerState {playerId, nickname, x, z}`, `SandboxState {protocolVersion, phase=sandbox, tick, players}`는 연결 시험용 공개 상태다.

개발 `kkakkung`(0.1.0)의 `move {seq, dir}`, `turn`, `ready`, 셀 `x/y`와 sandbox의 `{seq,x,z}`, 제품 0.2.0의 `command` 봉투를 같은 메시지로 간주하지 않는다.
