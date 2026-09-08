# 아키텍처

까꿍은 4개 workspace를 가진 단일 저장소다.

```text
apps/web ───────────────> packages/protocol
server ─────────────────> packages/protocol
server ─────────────────> packages/game-core
```

`game-core`는 protocol에도 의존하지 않는다. 서버 adapter가 검증된 wire 명령에 서버가 정한 playerId를 붙여 도메인 명령으로 바꾼다. 현재 공개 `SandboxState`는 연결 시험을 위한 플레이어 닉네임·좌표·Tick만 전달하며 실제 게임의 전체 맵·적 위치·서버 내부 상태를 담지 않는다.

서버가 위치와 규칙의 권위자다. 웹은 `kkakkung`의 서버 셀 `x/y`를 장면 `x/z`로 바꾸어 표현하고, `sandbox` 위치도 렌더링할 뿐 판정을 만들지 않는다. 현재 팀 개발 maze는 전원에게 공개된다. 이후 실제 게임에서는 서버 전체 상태와 수신자별 projection을 분리하고 각 참가자가 볼 수 있는 상태와 사건만 보낸다.

`sandbox`는 단일 20Hz Tick에서 주입된 `dtSeconds`로 연속 이동을 계산한다. 기존 `kkakkung`은 `move`·`turn` 메시지가 도착할 때 셀 상태를 바꾸고 별도 20Hz 시계를 진행한다. 팀 명령을 Tick마다 모아 처리하는 전체 게임 직렬화는 후속 작업이다. Cloud 응답도 후속 구현에서 큐를 통해 권위 실행 흐름으로 돌아와야 한다.

현재는 `MEDIA_MODE=disabled`인 로컬 개발 스켈레톤이다. LiveKit, MediaPipe, 운영 저널과 복구 장벽은 문서로 경계를 정의한 미구현 상태이며 production 시작은 막는다.

통합 서버는 기존 `kkakkung` Room과 새 `sandbox` Room을 함께 등록한다. `server/src/domain`은 `packages/game-core`의 match 경계를 재노출하고, `server/src/rooms/schema/GameState`는 `packages/protocol`의 game schema를 재노출한다. 기존 wire 필드와 담당 경계는 유지한다. 현재 전역 Room 용량은 둘을 합쳐 하나이므로 두 Room을 동시에 띄우는 개발 흐름은 지원하지 않는다.

웹 조립점은 `apps/web/src/app/App.tsx`와 `SessionRuntime.ts`, 장면은 `apps/web/src/features/game/scene/WorldCanvas.tsx`다. 개발 API는 Vite의 `/api` proxy를 사용하지만 Colyseus Room WebSocket은 `ws://127.0.0.1:2567`로 직접 연결한다. production의 API와 Colyseus는 같은 출처를 기준으로 한다.

## 후속 기능의 배치

아래 경로는 구현을 시작할 때 필요한 파일과 함께 만든다. 현재는 빈 폴더나 소비자 없는 인터페이스를 두지 않는다.

| 예정 경로                       | 책임                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `apps/web/src/features/devices` | 원본 카메라·마이크 장치 수명                                                 |
| `apps/web/src/features/vision`  | MediaPipe 추론과 Worker. 실제 Worker 추가 시 별도 WebWorker 타입 검사도 추가 |
| `apps/web/src/features/media`   | 가공 트랙·LiveKit 연결·미디어 세대 정리                                      |
| `server/src/media`              | 미디어 권한·Identity 발급과 회수                                             |
| `server/src/operations`         | 지속 저널, API·사용량 예산, 이전 세대 회수와 준비 장벽                       |
| `server/content/maps`           | 서버 전용 전체 맵과 비공개 후보                                              |
| `server/content/placements`     | 제약을 검증한 fallback 배치와 후보                                           |
| `server/config/tuning`          | 경기 시작 시 고정해 game-core에 주입할 수치와 tuningVersion                  |

서버 자료는 web/public이나 protocol로 복사하지 않는다. 실제 content·config 파일을 추가할 때는 `server/package.json`의 배포 포함 목록에도 등록한다. 현재 sandbox의 `halfExtent=8`, `speed=4`는 연결 시험용 값이다. 미디어와 게임 참가 수명의 분리는 [미디어 수명](media-lifecycle.md)을 따른다.
