# 까꿍 0.1 개발 Room 호환 프로토콜

> 버전: 0.1 (0단계 뼈대) · 관리: 정유림
> 이 문서는 기존 개발 `kkakkung`의 현재 동작과 rooms/domain 호환 경계만 설명한다. 제품 0.2.0의 구현 지시는 [프로토콜](../../docs/protocol.md)과 [결정 정정표](../../docs/spec/decisions.md)를 따른다.
> 공유 입력은 strict 스키마로 검사한다. 필드 추가·변경도 생산자와 소비자의 스키마·버전·회귀 시험을 함께 검토하며 임의 추가 필드는 거절한다.

---

## 1. 접속

- 엔드포인트: `ws://localhost:2567`. 이 개발 프로필의 production 기동은 차단되어 있다.
- 룸 이름: `"kkakkung"`
- 방 코드: `state.roomCode` (roomId 앞 6자리). 참가는 `joinById(roomId)` — 코드 → roomId 매핑은 [E2 방·로비 관리]에서

```ts
const client = new Colyseus.Client('ws://localhost:2567');
const room = await client.joinOrCreate('kkakkung');
```

이 빈 입장은 로컬 Playground 호환용이다. React 웹은 `/api/dev-sessions`의 일회성 토큰과 `protocolVersion: '0.1.0'`으로 입장한다. 초대 인증을 포함한 제품 접속과 혼용하지 않는다.

---

## 2. 상태 (서버 → 클라이언트, 자동 동기화)

### GameState

| 필드       | 타입          | 뜻                                              | 공개 범위                           |
| ---------- | ------------- | ----------------------------------------------- | ----------------------------------- |
| `phase`    | string        | `waiting` `prep` `countdown` `playing` `result` | 전원                                |
| `tick`     | number        | 서버 틱 번호 (20/s)                             | 전원                                |
| `timeLeft` | number        | 남은 시간 ms                                    | 전원                                |
| `roomCode` | string        | 6자리 방 코드                                   | 전원                                |
| `maze`     | uint8[1024]   | `index = y*32 + x`, 0 통로 1 벽                 | 0단계 전원 → 1단계 시야 필터        |
| `players`  | map\<Player\> | sessionId → Player                              | 0단계 전원 → 1단계 시야 필터        |
| `exits`    | map\<Exit\>   | ownerId → Exit                                  | **도망자만.** 술래 패킷에 필드 없음 |

### Player

| 필드      | 타입    | 뜻                                             |
| --------- | ------- | ---------------------------------------------- |
| `id`      | string  | sessionId                                      |
| `role`    | string  | `runner` \| `tagger`                           |
| `x`, `y`  | uint8   | 칸 좌표. 원점 좌상단, x 오른쪽+, **y 아래쪽+** |
| `dir`     | uint8   | 0 북(y-) · 1 동(x+) · 2 남(y+) · 3 서(x-)      |
| `status`  | string  | `alive` \| `escaped` \| `captured`             |
| `trapped` | boolean | 덫 구속 중                                     |
| `ready`   | boolean | 준비 완료                                      |

### Exit (개인 출구)

| 필드                     | 타입    | 뜻                                   |
| ------------------------ | ------- | ------------------------------------ |
| `ownerId`                | string  | 소유 도망자                          |
| `wallX`, `wallY`         | uint8   | 출구가 붙은 벽 칸                    |
| `side`                   | uint8   | 벽의 어느 면 (0~3, dir 과 같은 규약) |
| `approachX`, `approachY` | uint8   | 도망자가 서야 하는 칸                |
| `open`                   | boolean | 아직 열려 있는지                     |

제품의 술래 장비·개인 지식·사건은 공통 실행 계약의 공개 타입과 별도 제품 상태로 구현한다. 도망자 아이템은 제품 결정 대기이며 이 개발 스키마에 인벤토리·아이템 엔티티·사용 명령을 예약하거나 추가하지 않는다.

---

## 3. 메시지 (클라이언트 → 서버)

현재 처리하는 명령은 아래 세 가지다. `move`·`turn`의 `seq`는 비음수 안전 정수로 검사하지만 이 개발 Room은 아직 중복 제거에 사용하지 않는다. `ready`는 정확히 `{}`이며 `seq`를 추가해도 거절한다. 제품의 `sequence`·`requestId`·접수/종결 응답은 별도 공통 계약을 따른다.

| 이름    | 페이로드                            | 보내는 쪽 | 서버 판정                        |
| ------- | ----------------------------------- | --------- | -------------------------------- |
| `move`  | `{ seq, dir: "forward" \| "back" }` | 전원      | `domain.tryMove`                 |
| `turn`  | `{ seq, dir: "left" \| "right" }`   | 전원      | 즉시                             |
| `ready` | `{}`                                | 전원      | 현재 2명 이상 전원 ready 시 시작 |

과거 개발 확장용 메시지 이름은 제품 구현 지시로 사용하지 않는다. 제품은 `CommandEnvelope`의 현재 판별 union만 구현하며 지도 교환·장비 설치·출구 진행도 해당 계약을 따른다.

## 4. 이벤트 (서버 → 클라이언트, 단발)

| 이름       | 페이로드                             | 뜻                                      |
| ---------- | ------------------------------------ | --------------------------------------- |
| `rejected` | `{ seq, reason }`                    | 개발 명령 거부. 서버 상태를 계속 렌더링 |
| `captured` | `{ taggerId, runnerId, x, y }`       | 포획 발생                               |
| `result`   | `{ winner: "runners" \| "taggers" }` | 라운드 종료                             |

현재 입력 스키마 거절은 `invalid-message`를 사용한다. 도메인 이동 스텁은 `no-player`·`not-alive`·`trapped`·`out-of-bounds`를 반환한다. 경기 단계 밖 입력은 현재 handler에서 무시한다. 벽·점유·cooldown 판정과 제품 명령의 정확한 종결 응답은 후속 구현이며 이 개발 이벤트를 제품 완료 증거로 사용하지 않는다.

---

## 5. 도메인 함수 시그니처 (rooms/ → domain/)

담당 손주연. 유림은 스텁으로 먼저 진행한다. 시그니처 변경 시 양쪽 합의.

```ts
tryMove(state, playerId, dir: "forward"|"back", now): { ok, reason? }
turn(dir: Dir, to: "left"|"right"): Dir
checkCapture(state): CaptureEvent[]
checkWinCondition(state): "runner" | "tagger" | null
generateMaze(seed): Uint8Array            // 현재는 고정 개발 맵
pickSpawn(maze, role, index): { x, y, dir }
```

`tryMove`는 현재 플레이어 상태·구속·맵 경계만 검사하는 스텁이다. `checkCapture`는 빈 배열, `checkWinCondition`은 null을 반환한다. 후자를 기존 개발 경로에서 구현할 경우 단수 Role을 반환해야 하며 `KkakkungRoom`이 `s`를 붙여 개발 `result.winner`를 만든다. 제품의 `RoundResult.winner`는 처음부터 `runners` 또는 `taggers`이므로 이 접미사 변환을 재사용하지 않는다. 제품 `CorePort` 함수는 A/B의 실행 문서에서 별도로 구현한다.

---

## 6. 좌표·방향 규약 (한 번 정하고 안 바꾼다)

```
(0,0) ─── x+ ───▶
  │
  y+
  ▼
북 = dir 0 = y-1     동 = dir 1 = x+1
남 = dir 2 = y+1     서 = dir 3 = x-1
우회전 = (dir+1)%4   좌회전 = (dir+3)%4
```

---

## 7. pnpm workspace 통합 메모

이 문서의 `kkakkung` Room 이름, 사용자 상태 필드, `move {seq,dir}`·`turn`·`ready`, 셀 `x/y` 규약은 개발 회귀 경로에서 유지한다. 제품 0.2.0의 상태·명령과 섞지 않으며 production에서는 개발 빈 입장·전체 맵 공개·관리 화면 경로를 차단한다. 런타임 입력은 공유 protocol의 엄격한 스키마로 검증하며 알 수 없는 필드와 잘못된 union 값을 거절한다.

`server/src/domain`은 `@kkakkung/game-core/match`, `server/src/rooms/schema/GameState.ts`는 `@kkakkung/protocol/game-schema`를 재노출한다. 기존 담당 이름과 스텁 범위는 그대로다. 별도 `sandbox` Room은 새 React 연결 검증용이며 이 문서의 wire 계약을 대체하지 않는다. 두 Room은 현재 서버 전체 용량 하나를 공유하므로 동시에 만들지 않는다.

Colyseus 0.18과 Schema 5로 옮긴 것은 SDK 호환 마이그레이션이다. 전체 규칙·시야 projection·맵 은폐·G1~G6 완료를 뜻하지 않는다.
