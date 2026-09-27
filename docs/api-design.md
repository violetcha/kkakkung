> 기준: origin/develop f537580 (2026-09-28). 모든 값은 이 커밋의 코드에서 확인했다.

# 까꿍 API 설계서

이 문서는 브라우저·운영 도구·LiveKit이 게임 서버와 주고받는 공개 계약을 한곳에 모은다. 제품 규칙은 [기획서](product-spec.md), 요구사항은 [요구사항 명세서](requirements.md), 계약의 세부 형상과 구현 근거는 [protocol 구현 명세](impl/protocol.md)·[server 구현 명세](impl/server.md)가 소유한다. 여기서는 경로·메시지마다 무엇을 보내고 무엇을 받는지를 적는다.

## 목차

1. 개요
2. 인증
3. 공통 규칙
4. HTTP API 목록
5. HTTP API 상세
6. 실시간 API(Colyseus)
7. 미디어(LiveKit) 연동
8. 공개 주소 경계
9. 계약 파일

## 1. 개요

| 통로   | 방식                     | 용도                                               |
| ------ | ------------------------ | -------------------------------------------------- |
| HTTP   | JSON REST(`/api/…`)      | 입장 세션 발급, 용량 조회, 초대, 미디어 권한, 운영 |
| 실시간 | Colyseus WebSocket       | 방 입장, 게임 명령, 공개 상태·개인 뷰·이벤트 수신  |
| 미디어 | LiveKit Cloud(WebRTC)    | 가공 얼굴 영상·음성. 서버가 발급한 권한으로만 연결 |
| 웹훅   | LiveKit → 서버 HTTP POST | 트랙 게시·참가자 입퇴장 사건                       |

| 항목          | 값                                                   |
| ------------- | ---------------------------------------------------- |
| 제품 프로토콜 | `0.2.0`(`PRODUCT_PROTOCOL_VERSION`)                  |
| 제품 방 이름  | `kkakkung`, 방 코드(`roomCode`)로 구분               |
| 방 코드 형식  | 6자리, `^[A-HJ-NP-Z2-9]{6}$`(혼동 문자 I·O·0·1 제외) |
| 닉네임        | 1–20자                                               |
| 서버 틱       | 50ms                                                 |
| 진단 계약     | `0.1.0`·`sandbox` 방. 개발 프로필에서만 등록된다     |

제품 프로필(`SERVER_PROFILE=product`)은 늘 엄격 모드다. 개발 도구(`/monitor`·`/playground`·`sandbox` 방)는 엄격 모드에서 등록되지 않고, `/api/dev-sessions`는 404를 낸다.

## 2. 인증

| 방식              | 전달                                                            | 쓰는 경로                              |
| ----------------- | --------------------------------------------------------------- | -------------------------------------- |
| 세션 토큰         | `Authorization: Bearer <sessionToken>`                          | 세션 취소, 방장 초대, 미디어 권한·보고 |
| 방 입장 토큰      | Colyseus join 옵션 `token`(세션 토큰과 같은 값)                 | 실시간 입장                            |
| 초대 토큰         | 요청 본문 `inviteToken`(16–512자)                               | 세션 발급(초대 입장)                   |
| SSO 사용자        | 호스트 nginx가 넣는 `X-SSO-User`(로그인 사용자)                 | 세션 발급(`gitlab-sso` 입장 방식)      |
| 운영자 SSO        | 호스트 nginx가 넣는 `X-Demo-Admin`(로그인 이메일) + 운영자 목록 | 시연 방·데모 방(SSO) 발급              |
| 운영 토큰         | `Authorization: Bearer <OPS_TOKEN>`, 상수 시간 비교             | 운영 명령·초대 발급·데모 방(API)       |
| LiveKit 웹훅 서명 | `Authorization`(LiveKit 서명 JWT)                               | `/api/livekit/webhook`                 |

- SSO 헤더는 서버가 `trust proxy`로 설정됐을 때만 믿는다. 브라우저가 보낸 같은 헤더는 호스트 nginx가 비우거나 덮는다.
- 운영자 이메일 목록 파일은 요청마다 다시 읽고 대소문자를 무시한다.
- 세션 수명: 첫 접속 기한 60초(데모·시연 10분), 활동 30분마다 연장, 최대 2시간.

## 3. 공통 규칙

### 3.1 요청 처리 순서

1. 입구 속도 제한. 넘으면 429 `RATE_LIMITED`
2. Origin 검사. 헤더가 없으면 통과하고, 있으면 허용 목록과 정확히 같아야 한다. 아니면 403 `ORIGIN_NOT_ALLOWED`
3. 본문 검사(`/api/`·`/matchmake/`의 GET·HEAD·OPTIONS 외. 웹훅 제외)
   - 2,048바이트 초과 413 `PAYLOAD_TOO_LARGE`
   - 5초 안에 본문이 끝나지 않으면 408 `BODY_TIMEOUT`
   - JSON 구문 오류 400 `INVALID_JSON`. 빈 본문은 `{}`
4. 경로 처리. 처리되지 않은 예외는 400 `INVALID_REQUEST`(동기 예외는 500 `INTERNAL_ERROR`)

WebSocket도 같은 Origin 규칙을 쓰고, 메시지 한 개는 8,192바이트까지다.

### 3.2 응답 형식

- 성공 본문은 경로마다 다르다(5장).
- 오류 본문은 대부분 `{ "error": "<코드>" }`다. 예외가 둘 있다.
  - 운영 명령 경로는 `{ "code": "<코드>" }`
  - 헬스 경로는 `{ "state": "...", "reasonCodes": [...] }`
- 세션·용량·초대·데모·시연·미디어·운영 응답에는 `Cache-Control: no-store`가 붙는다.
- 시각은 별도 표기가 없으면 epoch 밀리초다. 미디어 grant의 `expiresAt`만 epoch 초다.

### 3.3 속도 제한

| 대상                                 | 키                 | 한도(창 1초)                                   |
| ------------------------------------ | ------------------ | ---------------------------------------------- |
| 운영·미디어 경로, 인증 없음          | 접속 출처          | 키당 5, 전체 20, 동시 4                        |
| 운영 경로, 운영 토큰                 | 운영자 하나        | 60, 전체 120, 동시 16                          |
| 미디어 경로, 세션 토큰               | 세션               | 12, 전체 240, 동시 128                         |
| `/api/sessions*`·`/matchmake/*` 입구 | 접속 출처          | `SESSION_ATTEMPTS_PER_IP × 4` / 창             |
| `/api/sessions` 하위 전부            | 접속 출처          | `SESSION_ATTEMPTS_PER_IP` / 창, `Retry-After`  |
| `POST /api/sessions`                 | SSO 계정·출처·초대 | `PER_INVITE`, 출처당 `PER_IP`                  |
| 방장 초대                            | 세션·출처          | 따로 센다                                      |
| 실시간 메시지                        | 연결               | 초당 45(버킷 90). 게임 명령은 초당 30(버킷 60) |

## 4. HTTP API 목록

| #   | Method | Path                                           | 인증            | 성공 | 설명                              |
| --- | ------ | ---------------------------------------------- | --------------- | ---- | --------------------------------- |
| H1  | GET    | `/health`                                      | 없음            | 200  | 조립 단계                         |
| H2  | GET    | `/health/live`                                 | 없음            | 200  | 생존                              |
| H3  | GET    | `/health/ready`                                | 없음            | 200  | 입장 가능 준비 상태(아니면 503)   |
| C1  | GET    | `/api/config`                                  | 없음            | 200  | 프로토콜·방 이름·미디어 여부      |
| S1  | GET    | `/api/sessions/access`                         | (SSO 헤더)      | 200  | 이 사용자에게 적용될 입장 방식    |
| S2  | POST   | `/api/sessions`                                | 초대·SSO·게스트 | 201  | 방 만들기·참가 세션 발급          |
| S3  | DELETE | `/api/sessions/current`                        | 세션            | 204  | 접속 전 세션 취소                 |
| S4  | POST   | `/api/sessions/current/invitation`             | 세션(방장)      | 201  | 방장 초대 링크 발급(이전 것 회수) |
| S5  | DELETE | `/api/sessions/current/invitation`             | 세션(방장)      | 204  | 방장 초대 링크 회수               |
| S6  | GET    | `/api/capacity`                                | 없음            | 200  | 경기·대기방 여유                  |
| P1  | POST   | `/api/showcase/rooms`                          | 운영자 SSO      | 201  | 시연 방 자리 발급                 |
| P2  | POST   | `/api/demo-admin/rooms`                        | 운영자 SSO      | 201  | 데모 방 발급(`/demo` 화면용)      |
| M1  | POST   | `/api/media/grants`                            | 세션            | 200  | LiveKit 연결 권한 발급            |
| M2  | POST   | `/api/media/report`                            | 세션            | 204  | 미디어 연결 상태 보고             |
| M3  | POST   | `/api/livekit/webhook`                         | LiveKit 서명    | 200  | LiveKit 사건 수신                 |
| O1  | POST   | `/api/operations/commands`                     | 운영 토큰       | 202  | 운영 명령 제출                    |
| O2  | GET    | `/api/operations/commands/:requestId`          | 운영 토큰       | 200  | 운영 명령 결과 조회               |
| O3  | GET    | `/api/operations/status`                       | 운영 토큰       | 200  | 입장·준비·사용량 상태             |
| O4  | POST   | `/api/operations/invitations`                  | 운영 토큰       | 201  | 운영자 초대 발급                  |
| O5  | POST   | `/api/operations/invitations/:inviteId/revoke` | 운영 토큰       | 204  | 운영자 초대 회수                  |
| O6  | POST   | `/api/operations/demo-rooms`                   | 운영 토큰       | 201  | 데모 방 발급(API)                 |
| R1  | *      | `/matchmake/*`                                 | join 옵션 토큰  | —    | Colyseus 좌석 예약(6장)           |

등록 조건

- S·M1·M2·P1은 제품 프로필이면 늘 있다. `SHOWCASE_ROOMS=0`이면 P1은 인증 뒤 503 `SHOWCASE_UNAVAILABLE`이다.
- O·P2는 운영 토큰과 운영자 인증이 구성됐을 때만 있다. 없으면 `/api/operations*`는 모두 503 `OPERATOR_AUTH_UNAVAILABLE`이다.
- 데모(O6·P2)는 `DEMO_ROOMS=1`일 때만 쓸 수 있다. 아니면 인증 뒤 503 `DEMO_UNAVAILABLE`이다.
- 공개 주소에서 O1–O6은 호스트 nginx가 404로 막는다(8장). 운영 명령은 호스트 안에서만 보낸다.

## 5. HTTP API 상세

### H1–H3 헬스

| 경로            | 미디어 구성 서버                                                                                                                    | 미디어 없는 서버                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `/health`       | 200 `{ ok: true, stage: "product-assembly" }`                                                                                       | 같음                                                                                  |
| `/health/live`  | 초기화 전 503 `{ state: "INITIALIZING", reasonCodes: ["INITIALIZATION_UNCONFIRMED"] }`, 뒤 200 `{ state: "LIVE", reasonCodes: [] }` | 200 `{ status: "alive" }`                                                             |
| `/health/ready` | 200 `{ state: "READY", reasonCodes: [] }`. 아니면 503 `{ state: "RECOVERING" \| "LOCKED", reasonCodes }`                            | 200/503 `{ status, stage, readiness, admission, mediaEnabled, productSecurityReady }` |

`READY`는 준비 상태가 READY이고, 미디어 기록 이력이 완전하며, 미해결 회수가 0이고, 사유 코드가 없을 때만이다.

### C1 `GET /api/config`

```json
{
  "stage": "product-assembly",
  "protocolVersion": "0.2.0",
  "roomName": "kkakkung",
  "diagnosticRoomName": "sandbox",
  "mediaEnabled": true,
  "maxPlayers": 6
}
```

### S1 `GET /api/sessions/access`

응답 `{ "method": "invitation" | "gitlab-sso" | "guest" }`. 입장 방식이 `gitlab-sso`이고 믿을 수 있는 프록시가 올바른 `X-SSO-User` 하나를 넘기면 `gitlab-sso`다. 게스트 방식이면 `guest`, 그 밖은 `invitation`이다. 오류는 속도 제한 429뿐이다.

### S2 `POST /api/sessions`

요청(두 모양 중 하나)

```json
{ "nickname": "까꿍", "createRoom": true, "inviteToken": "(선택)" }
{ "nickname": "까꿍", "createRoom": false, "roomCode": "K7M2PQ", "inviteToken": "(선택)" }
```

응답 201

```json
{
  "sessionToken": "…",
  "playerId": "…",
  "roomCode": "K7M2PQ",
  "expiresAt": 1790000000000,
  "protocolVersion": "0.2.0"
}
```

오류(판정 순서)

| 상태 | 코드                 | 조건                                                     |
| ---- | -------------------- | -------------------------------------------------------- |
| 400  | `INVALID_REQUEST`    | 스키마 불일치                                            |
| 503  | `ADMISSION_CLOSED`   | 서버가 입장을 받지 않음(점검·drain)                      |
| 403  | `INVALID_INVITATION` | 초대 토큰이 틀림. 토큰도 SSO도 없고 게스트 만들기도 아님 |
| 429  | `RATE_LIMITED`       | 시도 한도                                                |
| 409  | `ALREADY_IN_ROOM`    | 같은 SSO 계정이 다른 창에서 이미 방에 있음               |
| 429  | `TOO_MANY_ROOMS`     | 계정(또는 출처)당 방 생성 한도                           |
| 404  | `ROOM_NOT_AVAILABLE` | 참가하려는 방이 없거나 닫힘                              |
| 503  | `ROOM_FULL`          | 방 정원이 참                                             |
| 503  | `CAPACITY`           | 대기방·좌석 총량이 참, 발급 실패                         |

받은 `sessionToken`으로 첫 접속 기한(60초) 안에 실시간 입장(6.1)을 해야 한다.

### S3 `DELETE /api/sessions/current`

본문 `{}`. 접속 전(자리가 예약 상태) 세션만 취소한다. 성공 204(모르는 토큰도 204). 오류 401 `INVALID_SESSION`, 409 `SESSION_IN_USE`(이미 접속함).

### S4·S5 방장 초대

- 조건: `LOBBY`·`DEVICE_CHECK`, 방장, 접속 중. 데모·시연 방은 없다.
- S4 응답 201 `{ inviteToken, roomCode, expiresAt }`. 유효 약 10분. 새로 발급하면 이전 링크와 그 링크로 예약만 한 자리가 풀린다.
- S5 성공 204.
- 오류 401 `INVALID_SESSION`, 403 `INVITATION_UNAVAILABLE`, 429 `RATE_LIMITED`, (S4만) 503 `ADMISSION_CLOSED`.

초대 링크 모양: `/#invite=<inviteToken>&room=<roomCode>`.

### S6 `GET /api/capacity`

```json
{
  "matchesInUse": 2,
  "matchLimit": 10,
  "lobbyRoomsInUse": 5,
  "lobbyRoomLimit": 30,
  "admissionOpen": true,
  "mediaBlocked": false
}
```

일반 방만 센다(시연·데모 제외). `mediaBlocked`는 월 사용량 가드가 새 경기를 막는지다. 오류 코드는 없다. 홈 입장 창이 15초마다 부른다.

### P1 `POST /api/showcase/rooms`

요청 `{ "seat": "runner-1" | "runner-2" | "tagger-1" | "tagger-2" }`

응답 201

```json
{
  "sessionToken": "…",
  "playerId": "…",
  "roomCode": "…",
  "role": "runner",
  "expiresAt": 1790000000000,
  "protocolVersion": "0.2.0",
  "entryFragment": "#showcase=<token>&room=<code>&player=<id>"
}
```

표시 이름은 자리 이름(`도망자 1` 등)이다. 오류: 401 `UNAUTHORIZED`, 503 `ADMISSION_CLOSED`, 400 `INVALID_REQUEST`, 409 `SEAT_TAKEN`(이미 앉은 자리), 503 `CAPACITY`, 503 `SHOWCASE_UNAVAILABLE`.

### P2·O6 데모 방

요청 `{ "role": "runner" | "tagger", "nickname": "(선택, 기본 관리자)" }`. 응답 201은 P1과 같은 모양이고 `entryFragment`가 `#demo=…`다. 오류: 401 `UNAUTHORIZED`, 400 `INVALID_REQUEST`, 503 `DEMO_ROOM_LIMIT`, 503 `CAPACITY`, 503 `DEMO_UNAVAILABLE`. 데모 발급은 서버 입장 상태(drain 등)를 보지 않는다.

### M1 `POST /api/media/grants`

요청

```json
{ "matchId": "…", "purpose": "practice" | "game", "previousReceiverGeneration": 3 }
```

`previousReceiverGeneration`은 같은 경기에서 다시 받을 때(재연결·연습→경기) 직전 세대를 적는다.

응답 200

```json
{
  "matchId": "…",
  "mediaInstanceId": "…",
  "receiverGeneration": 4,
  "subscriptionMode": "publisher-permissions",
  "url": "wss://….livekit.cloud",
  "token": "…",
  "roomName": "…",
  "mediaIdentity": "…",
  "expiresAt": 1790000300
}
```

오류(판정 순서)

| 상태 | 코드                                                                               | 조건                                                |
| ---- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| 401  | `INVALID_SESSION`                                                                  | 세션이 없거나 만료                                  |
| 400  | `INVALID_REQUEST`                                                                  | 스키마 불일치                                       |
| 409  | `WRONG_SCOPE`                                                                      | 방이 없거나 현재 경기가 아님                        |
| 409  | `NOT_READY`                                                                        | 지금 단계에 이 목적의 미디어가 없음, 서버 입장 닫힘 |
| 503  | `MEDIA_UNAVAILABLE`                                                                | 미디어가 구성되지 않음                              |
| 409  | `BUDGET_EXHAUSTED`·`RETIREMENT_UNCONFIRMED`·`POLICY_UNKNOWN`·`STALE_GENERATION` 등 | 발급 거절                                           |
| 503  | `TIMEOUT`·`REMOTE_UNAVAILABLE`                                                     | 결과 불명                                           |

권한은 발급 5분 뒤 만료된다. `subscriptionMode`가 없으면 서버 제어 구독이다. 운영은 `publisher-permissions`다(7장).

### M2 `POST /api/media/report`

요청 `{ matchId, mediaInstanceId, receiverGeneration, status: "ready" | "recovering" | "failed" | "closed" }`. 성공 204. 오류 401 `INVALID_SESSION`, 400 `INVALID_REQUEST`, 409 `WRONG_SCOPE`(이미 다른 세대·인스턴스로 넘어간 보고).

`failed`·`recovering`은 서버가 10초 복구 기한을 걸고, 기한 안에 교체 연결이 없으면 경기를 무효로 한다. `closed`는 클라이언트가 스스로 연결을 닫았다는 뜻이다.

### M3 `POST /api/livekit/webhook`

본문은 LiveKit 원문(256KB 이하). 처리하는 사건은 `track_published`·`track_unpublished`·`participant_joined`·`participant_left`·`participant_connection_aborted`·`room_finished`다. 응답 200 `{ status: "accepted" | "ignored" }`(중복 id는 ignored). 서명이 틀리면 401 `INVALID_WEBHOOK`, 미디어가 없으면 503 `MEDIA_UNAVAILABLE`.

### O1–O3 운영 명령

요청

```json
{ "requestId": "deploy-2026-09-28-01", "action": "drain" | "resume" | "checkpoint" }
{ "requestId": "…", "action": "retry-retirement", "retirementId": "…" }
```

ID는 `^[A-Za-z0-9._:-]{1,128}$`. 명령은 비동기다.

| 명령               | 하는 일                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `drain`            | 새 입장을 닫고 진행 중인 연습·경기·예약·미디어 회수가 모두 끝나길 기다림 |
| `resume`           | 입장을 다시 연다(준비 상태가 READY일 때만)                               |
| `checkpoint`       | 미디어 기록·사용량 기록을 정리해 저장                                    |
| `retry-retirement` | 미해결 미디어 회수 한 건을 다시 시도                                     |

- O1 응답 202, O2 응답 200: `{ requestId, operationId, action, status: "pending" | "succeeded" | "failed", code, updatedAtEpochMs }`
- O3 응답 200: `{ admission: "OPEN" | "DRAINING" | "LOCKED", readiness, unresolvedCount, remainingMinutes, remainingBytes, checkedAtEpochMs, operatingMode? }`
- 오류(본문 키 `code`): 403 `UNAUTHORIZED`, 400 `INVALID_COMMAND`, 409 `REQUEST_ID_CONFLICT`, 429 `OPERATIONS_BUSY`(`Retry-After: 1`), 404 `OPERATION_NOT_FOUND`, 503 `OPERATIONS_UNAVAILABLE`

### O4·O5 운영자 초대

- O4 요청 `{ scope: { allowCreate: boolean, roomCodes: string[] (최대 16) }, expiresAt }`, 응답 201 `{ inviteId, inviteToken, scope, expiresAt }`
- O4 오류: 401 `UNAUTHORIZED`, 400 `INVALID_REQUEST`·`INVALID_INVITATION`, 409 `NOT_READY`·`OUTSIDE_PUBLIC_WINDOW`
- O5 성공 204(모르는 ID도 204). 400 `INVALID_REQUEST`는 ID 형식 오류

## 6. 실시간 API(Colyseus)

### 6.1 입장

- 방 이름 `kkakkung`, 방 코드로 거른다(`filterBy(['roomCode'])`).
- join 옵션 `{ token: <sessionToken>, roomCode, protocolVersion: "0.2.0" }`

| 거절 코드            | 상태 | 조건                                      |
| -------------------- | ---- | ----------------------------------------- |
| `NOT_READY`          | 503  | 서버가 입장을 받지 않음                   |
| `INVALID_JOIN`       | 400  | 옵션 형식 오류                            |
| `PROTOCOL_MISMATCH`  | 409  | 프로토콜 버전이 다름                      |
| `INVALID_SESSION`    | 401  | 세션 토큰이 틀리거나 만료                 |
| `WRONG_ROOM`         | 403  | 세션의 방과 다른 방                       |
| `ROOM_CLOSED`        | 403  | 자리가 없거나, 대기 단계가 아닌데 새 입장 |
| `SESSION_IN_USE`     | 409  | 같은 세션이 이미 연결됨                   |
| `ROOM_NOT_AVAILABLE` | 404  | 방 코드가 등록부에 없음                   |

경기 중 끊긴 연결은 Colyseus 재접속 토큰으로 25초 안에 같은 자리에 돌아온다(데모 제외). 새로고침한 페이지는 탭 저장소에 남긴 재접속 토큰을 쓴다.

### 6.2 클라이언트 → 서버 메시지

| 이름                     | 페이로드                                                  | 설명                                                   |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| `command`                | 명령 envelope(6.4)                                        | 모든 게임·단계 명령                                    |
| `request-status`         | `{ matchId, requestId }`                                  | 결과를 못 받은 명령의 상태 조회                        |
| `view-resync`            | `{ matchId, lastStateVersion }`                           | 개인 뷰 전체 재전송 요청(초당 1회)                     |
| `game-heartbeat-ack`     | `{ serverEpoch, matchId, heartbeatSeq }`                  | 하트비트 응답                                          |
| `clock-probe`            | `{ probeId, clientSentAtMs }`                             | 시계 동기화(초당 5회까지)                              |
| `media-bindings-refresh` | 없음                                                      | 마지막 미디어 참가자 연결표 재전송(1초 1회)            |
| `lobby-face`             | `{ image: "data:image/jpeg;base64,…" }`(6,000자 이하)     | 대기실 가공 얼굴 사진(`LOBBY`·`DEVICE_CHECK`, 2초 1회) |
| `lobby-face-sync`        | 없음                                                      | 같은 방 다른 사람들의 대기실 사진 요청                 |
| `demo-scenario`          | `{ matchId, scenario, options? }`                         | 데모 운영자: 22개 대본 중 하나 실행                    |
| `demo-control`           | `{ matchId, action: "abort-round" \| "cancel-scenario" }` | 데모 운영자: 라운드 끝내기·대본 취소                   |

모르는 메시지 이름은 조용히 버린다.

### 6.3 서버 → 클라이언트 메시지

| 이름                    | 내용                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 공개 상태(Schema 패치)  | `phase`·`matchId`·`stateVersion`·`serverTick`·시작/마감 틱·집계·결과·중단 사유·방 만료·준비 실패 사유·재경기 상태(6.6)       |
| `command-result`        | 명령 영수증 `{ matchId, requestId, sequence, stateVersion, status: accepted \| rejected, code }`                             |
| `command-outcome`       | 명령 결과 `{ …, tick, result: applied \| rejected \| canceled, code }`                                                       |
| `request-status-result` | `{ matchId, requestId, status: done \| pending \| unknown, outcome }`                                                        |
| `room-roster`           | 참가자 목록 `{ matchId, phase, hostId, players[{ playerId, nickname, ready, connected }], kind, capacity }`                  |
| `room-access`           | 입장 잠금 `{ matchId, revision, locked }`                                                                                    |
| `room-map`              | 맵 크기 `{ matchId, revision, size: small \| medium \| large }`                                                              |
| `private-view`          | 개인 뷰: 내 상태, 보이는 칸·벽면·참가자·장비, 개인 지도, 관전 대상                                                           |
| `private-event`         | 개인 사건: `EXCHANGE_OFFER`·`EXCHANGE_CANCELED`·`EXCHANGE_COMPLETED`·`HUNTER_MARKER`·`EXIT_CHALLENGE`·`EXIT_CHALLENGE_ENDED` |
| `game-heartbeat`        | `{ serverEpoch, matchId, heartbeatSeq, serverTick, serverTimeMs }`, 2초마다                                                  |
| `clock-reply`           | probe 값 + 서버 수신·송신 시각                                                                                               |
| `media-bindings`        | 미디어 참가자 연결표(누구의 어느 트랙이 누구 얼굴·목소리인지). 적은 별칭 ID로 보낸다                                         |
| `audio-policy`          | 들리는 목소리의 음량·방위·먹먹함, 효과음, 게시 권한 목록                                                                     |
| `demo-state`            | 데모 대본 목록과 실행 상태                                                                                                   |
| `lobby-face`            | `{ playerId, image \| null }`                                                                                                |

개인 뷰와 사건은 받는 사람이 볼 수 있는 것만 담는다. 적 참가자는 경기마다 바뀌는 별칭 ID로 나온다.

### 6.4 명령 envelope

```json
{
  "matchId": "…",
  "requestId": "<uuid>",
  "sequence": 17,
  "type": "MOVE_INTENT",
  "payload": { "direction": "forward" }
}
```

- UTF-8 4,096바이트 이하. `sequence`는 연결마다 늘어나야 한다.
- 서버는 받자마자 `command-result`(영수증)를, 틱에서 처리한 뒤 `command-outcome`(결과)을 보낸다.

**게임 명령**(`TEAM_PRACTICE`·`PLAYING`, 활성 참가자만)

| type               | payload                                                | 누가   |
| ------------------ | ------------------------------------------------------ | ------ |
| `MOVE_INTENT`      | `{ direction: "forward" \| "back" \| null }`           | 모두   |
| `TURN`             | `{ direction: "left" \| "right" }`                     | 모두   |
| `GRAB_INTENT`      | `{}`                                                   | 술래   |
| `INSTALL`          | `{ kind: "sensor" \| "trap" }`                         | 술래   |
| `INSTALL_CANCEL`   | `{ installationId }`                                   | 술래   |
| `EXCHANGE_REQUEST` | `{ targetPlayerId }`                                   | 도망자 |
| `EXCHANGE_ACCEPT`  | `{ exchangeId }`                                       | 도망자 |
| `EXCHANGE_CANCEL`  | `{ exchangeId }`                                       | 도망자 |
| `EXIT_START`       | `{ exitId }`                                           | 도망자 |
| `EXIT_PROGRESS`    | `{ challengeId, method: "pose" \| "keys", completed }` | 도망자 |
| `EXIT_CANCEL`      | `{ challengeId }`                                      | 도망자 |

**단계 명령**

| type             | payload                                           | 단계                   | 제약                                      |
| ---------------- | ------------------------------------------------- | ---------------------- | ----------------------------------------- |
| `READY`          | `{ ready }`                                       | `DEVICE_CHECK`         | —                                         |
| `ROOM_LOCK`      | `{ locked }`                                      | `LOBBY`·`DEVICE_CHECK` | 방장. 데모 방 불가                        |
| `ROOM_KICK`      | `{ targetPlayerId }`                              | `LOBBY`·`DEVICE_CHECK` | 방장, 자기 자신 불가                      |
| `ROOM_MAP_SIZE`  | `{ size }`                                        | `LOBBY`·`DEVICE_CHECK` | 방장. 시연 방 불가                        |
| `ROOM_START`     | `{}`                                              | `DEVICE_CHECK`         | 방장, 전원 준비                           |
| `PRACTICE_READY` | `{ ready }`                                       | `TEAM_PRACTICE`        | —                                         |
| `LOAD_READY`     | `{ loadId, mediaInstanceId, receiverGeneration }` | `GAME_LOADING`         | 현재 로딩 ID와 같아야 함                  |
| `REMATCH`        | `{ mode: "same" \| "swap" \| "lobby", role? }`    | `RESULT`·`ABORTED`     | 방장. `role`은 데모만, `swap`은 시연 불가 |
| `SPECTATE`       | `{ targetPlayerId }`                              | `PLAYING`              | 끝난 도망자가 생존 도망자 중에서          |

**거절 코드**

| 코드                | 뜻                                         |
| ------------------- | ------------------------------------------ |
| `INVALID_COMMAND`   | 형식 오류·크기 초과·모르는 종류            |
| `PROTOCOL_MISMATCH` | 버전 불일치(입장 단계에서만 쓰임)          |
| `WRONG_MATCH`       | 현재 경기가 아님                           |
| `RATE_LIMITED`      | 연결당 명령 한도 초과                      |
| `INVALID_PHASE`     | 지금 단계에서 받지 않는 명령               |
| `NOT_ACTIVE`        | 경기에 활성 참가자가 아님                  |
| `NOT_ALLOWED`       | 권한 없음(방장 전용 등)                    |
| `EXPIRED`           | 기한이 지남                                |
| `STALE_REQUEST`     | 이미 쓴 requestId이거나 sequence가 뒤로 감 |
| `NOT_READY`         | 준비 조건 불충족                           |
| `QUEUE_FULL`        | 대기열 초과(참가자당 64, 방당 384)         |
| `ROUND_ENDED`       | 라운드가 끝남                              |
| `CANCELED`          | 처리 전에 취소됨                           |

게임 규칙상의 실패(벽으로 이동, 잡기 헛침 등)는 `command-outcome`의 `result`와 `code`로 온다.

### 6.5 단계 흐름

`LOBBY` → `DEVICE_CHECK` → `TEAM_PRACTICE` → `MAP_FINALIZING` → `GAME_LOADING` → `COUNTDOWN` → `PLAYING` → `RESULT` | `ABORTED`. 전환 조건은 [기획서 4.2](product-spec.md#42-단계별-경험과-전환).

### 6.6 공개 상태 필드

`protocolVersion`, `phase`, `matchId`, `stateVersion`, `serverTick`, `startTick`, `startAt`, `deadlineTick`, `counts{ escaped, captured }`, `result{ winner, reason }`, `abortReason`, `roomExpiresInSeconds`, `preparationIssue`, `rematchState`, `abortedBy`. 모든 참가자에게 같은 값이 간다. 위치·지도 같은 비공개 정보는 여기에 없다.

### 6.7 연결 종료 코드

| 코드 | 뜻                                                             | 브라우저 동작                    |
| ---- | -------------------------------------------------------------- | -------------------------------- |
| 4000 | 하트비트 6초 무응답(재접속 유예 대상 아님)                     | 연결 끊김 화면                   |
| 4001 | 방 만료(대기 시간 끝, 데모 방이 비고 120초)                    | `방의 대기 시간이 끝났습니다`    |
| 4002 | 방장이 내보냄 / 장치 점검 시간 초과                            | `방장이 대기방에서 내보냈습니다` |
| 4003 | 시연 방 방장이 대기 중 떠남                                    | 2.5초 뒤 `/showcase`로           |
| 4010 | 경기 중 무응답(Colyseus `MAY_TRY_RECONNECT`). 25초 재접속 유예 | 자동 재접속                      |

4000–4003은 Colyseus 자체 종료 코드(`CONSENTED`·`SERVER_SHUTDOWN`·`WITH_ERROR`·`FAILED_TO_RECONNECT`)와 숫자가 같다. 브라우저는 방 안에서 받은 코드를 이 표로 해석한다.

## 7. 미디어(LiveKit) 연동

1. 연습·로딩 단계에서 브라우저가 M1로 권한을 받는다(`purpose`는 `practice` 또는 `game`).
2. 받은 `url`·`token`으로 LiveKit 방에 `autoSubscribe=false`로 연결하고, 가공 얼굴 영상(160×160, 10fps, 흑백)과 선택한 마이크를 게시한다.
3. 서버는 웹훅(M3)으로 게시를 확인하고 `media-bindings`로 참가자 연결표를 보낸다. 브라우저는 이 표와 트랙 ID가 맞을 때만 얼굴을 붙인다.
4. 운영 모드 `publisher-permissions`에서 서버는 수신자별 구독을 LiveKit 서버 API로 켜고, 각 게시자는 `audio-policy`의 `publisherPermissions`대로 누가 자기 트랙을 받을지 LiveKit에 설정한다. 얼굴은 같은 경기의 모든 참가자에게 열고, 음성은 들리는 거리 안의 사람에게만 연다.
5. 단계가 바뀌면 서버가 이전 세대를 회수(LiveKit에서 참가자 제거)하고, 브라우저는 `previousReceiverGeneration`을 넣어 새 권한을 받는다. 회수로 끊겨도 브라우저의 가공 얼굴·마이크 트랙은 멈추지 않는다(`stopLocalTrackOnUnpublish=false`).

## 8. 공개 주소 경계

호스트 nginx(`infra/nginx/host.conf`)가 공개 주소 앞에서 다음을 지킨다.

| 경로                                                            | 공개 주소에서                                     |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `/`(화면, `/api/…`, 실시간)                                     | GitLab SSO 로그인 뒤 통과. `X-SSO-User`를 채운다  |
| `/demo`·`/showcase`·`/api/demo-admin`·`/api/showcase`           | 늘 SSO. `X-Demo-Admin`에 로그인 이메일을 채운다   |
| `/health/…`                                                     | SSO 없이 통과(`/health` 정확 경로는 SSO를 거친다) |
| `/api/livekit/webhook`                                          | SSO 없이 POST만(본문 1MB)                         |
| `/api/operations…`·`/api/dev-sessions`·`/monitor`·`/playground` | 404                                               |

## 9. 계약 파일

| 파일(`packages/protocol/src/`) | 담는 계약                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| `version.ts`                   | 프로토콜 버전, 방 이름                                              |
| `game-messages/session.ts`     | 세션·용량·초대·데모·시연 HTTP 경로와 요청·응답·오류 코드, join 옵션 |
| `game-messages/product.ts`     | 실시간 메시지 이름, 명령 envelope·종류·거절 코드, 데모 대본         |
| `game-messages/room.ts`        | 참가자 목록·입장 잠금·맵 크기, 종료 코드, 대기실 얼굴 사진          |
| `game-messages/events.ts`      | 개인 뷰·개인 사건·뷰 재전송                                         |
| `game-messages/heartbeat.ts`   | 하트비트·시계 동기화                                                |
| `game-messages/media.ts`       | 미디어 권한·보고·연결표·음성 정책, `MEDIA_ROUTES`                   |
| `game-schema/product.ts`       | 공개 상태 Schema, 단계·중단 사유·준비 실패 사유 enum, 틱 상수       |

운영 명령(`OPERATIONS_ROUTES`)과 운영자 초대(`INVITATION_ROUTES`) 경로는 브라우저 계약이 아니라 `server/src/session/` 안에만 있다. 계약을 바꾸면 웹·서버 소비자와 거절 동작을 함께 확인한다([AGENTS.md](../AGENTS.md)).
