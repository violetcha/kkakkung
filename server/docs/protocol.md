# 까꿍 서버 프로토콜 (계약 문서)

> 버전: 0.1 (0단계 뼈대) · 관리: 정유림
> 이 문서는 **프론트 ↔ 서버**, **서버 rooms/ ↔ domain/** 사이의 계약이다.
> 이름 변경·삭제는 관련자 합의 후에만. 필드 추가는 자유.

---

## 1. 접속

- 엔드포인트: `ws://localhost:2567` (배포 시 `wss://<domain>`)
- 룸 이름: `"kkakkung"`
- 방 코드: `state.roomCode` (roomId 앞 6자리). 참가는 `joinById(roomId)` — 코드 → roomId 매핑은 [E2 방·로비 관리]에서

```ts
const client = new Colyseus.Client("ws://localhost:2567");
const room = await client.joinOrCreate("kkakkung");
```

---

## 2. 상태 (서버 → 클라이언트, 자동 동기화)

### GameState
| 필드 | 타입 | 뜻 | 공개 범위 |
|---|---|---|---|
| `phase` | string | `waiting` `prep` `countdown` `playing` `result` | 전원 |
| `tick` | number | 서버 틱 번호 (20/s) | 전원 |
| `timeLeft` | number | 남은 시간 ms | 전원 |
| `roomCode` | string | 6자리 방 코드 | 전원 |
| `maze` | uint8[1024] | `index = y*32 + x`, 0 통로 1 벽 | 0단계 전원 → 1단계 시야 필터 |
| `players` | map\<Player\> | sessionId → Player | 0단계 전원 → 1단계 시야 필터 |
| `exits` | map\<Exit\> | ownerId → Exit | **도망자만.** 술래 패킷에 필드 없음 |

### Player
| 필드 | 타입 | 뜻 |
|---|---|---|
| `id` | string | sessionId |
| `role` | string | `runner` \| `tagger` |
| `x`, `y` | uint8 | 칸 좌표. 원점 좌상단, x 오른쪽+, **y 아래쪽+** |
| `dir` | uint8 | 0 북(y-) · 1 동(x+) · 2 남(y+) · 3 서(x-) |
| `status` | string | `alive` \| `escaped` \| `captured` |
| `trapped` | boolean | 덫 구속 중 |
| `ready` | boolean | 준비 완료 |

### Exit (개인 출구)
| 필드 | 타입 | 뜻 |
|---|---|---|
| `ownerId` | string | 소유 도망자 |
| `wallX`, `wallY` | uint8 | 출구가 붙은 벽 칸 |
| `side` | uint8 | 벽의 어느 면 (0~3, dir 과 같은 규약) |
| `approachX`, `approachY` | uint8 | 도망자가 서야 하는 칸 |
| `open` | boolean | 아직 열려 있는지 |

### 3단계에 추가 예정 (이름만 예약)
`devices{ id → {kind, x, y, ownerId} }` · `items{ id → {kind, x, y} }` · `zones{ taggerId → {cells[]} }` · `events[ {kind, x, y, tick} ]` · `Player.inventory[3]` · `Player.knownCells[]`

---

## 3. 메시지 (클라이언트 → 서버)

모든 메시지에 `seq`(클라이언트 증가 번호)를 넣는다. 0단계에서는 사용하지 않지만 자리를 유지한다.

| 이름 | 페이로드 | 보내는 쪽 | 서버 판정 |
|---|---|---|---|
| `move` | `{ seq, dir: "forward" \| "back" }` | 전원 | `domain.tryMove` |
| `turn` | `{ seq, dir: "left" \| "right" }` | 전원 | 즉시 |
| `ready` | `{}` | 전원 | 전원 ready 시 시작 |
| `exchange.request` | `{ seq, targetId }` | 도망자 | 2단계 |
| `exchange.accept` | `{ seq, requesterId }` | 도망자 | 2단계 |
| `pose.result` | `{ seq, ok: boolean }` | 도망자 | 2단계 |
| `device.place` | `{ seq, kind: "sensor" \| "trap" }` | 술래 | 3단계 |
| `item.use` | `{ seq }` | 도망자 | 3단계 |

## 4. 이벤트 (서버 → 클라이언트, 단발)

| 이름 | 페이로드 | 뜻 |
|---|---|---|
| `rejected` | `{ seq, reason }` | 명령 거부. 클라이언트는 예측 이동을 스냅백 |
| `captured` | `{ taggerId, runnerId, x, y }` | 포획 발생 |
| `result` | `{ winner: "runners" \| "taggers" }` | 라운드 종료 |

`reason` 값: `no-player` `not-alive` `trapped` `out-of-bounds` `wall` `occupied` `cooldown` `not-playing`

---

## 5. 도메인 함수 시그니처 (rooms/ → domain/)

담당 손주연. 유림은 스텁으로 먼저 진행한다. 시그니처 변경 시 양쪽 합의.

```ts
tryMove(state, playerId, dir: "forward"|"back", now): { ok, reason? }
turn(dir: Dir, to: "left"|"right"): Dir
checkCapture(state): CaptureEvent[]
checkWinCondition(state): "runners" | "taggers" | null
generateMaze(seed): Uint8Array            // 2단계: 랜덤 + BFS 검증
pickSpawn(maze, role, index): { x, y, dir }
// 2단계 추가
canExchangeMap(state, a, b): { ok, reason? }
mergeMaps(a, b): MapKnowledge
enterExit(state, playerId): { ok, reason? }
```

`tryMove` 는 `player.trapped` 이면 거부한다 (3단계 구속 덫이 이 플래그를 세움).

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
