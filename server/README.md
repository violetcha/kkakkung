# 까꿍 게임 서버

Node.js + Colyseus 서버 권위형 매치 서버. [기존 개발 프로토콜](docs/protocol.md)은 현재 0.1 개발 Room의 호환 동작만 설명한다. 제품 구현은 [최신 결정 정정표](../docs/spec/decisions.md), [공통 실행 계약](../docs/execution/common.md), [B 실행 문서](../docs/execution/b-game-server.md)를 따른다. 기존 문서의 개발 필드·빈 입장·전체 맵 공개를 제품 계약으로 확장하지 않는다.

## 실행

아래 명령은 모두 `server/`가 아니라 **저장소 루트**에서 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm dev:server
```

- 게임 서버: `ws://localhost:2567`
- 테스트 화면: http://localhost:2567/playground — 방 접속 · 메시지 전송 · 상태 확인
- 관리 화면: http://localhost:2567/monitor

playground 탭을 두 개 열어 각각 `kkakkung` 룸에 접속 → 둘 다 `ready` 전송 → 한쪽에서 `move {"seq":1,"dir":"forward"}` 를 보내면 다른 탭의 상태에서 좌표가 바뀐다.

서버는 기존 `kkakkung` Room 외에 새 React 연동 검증용 `sandbox` Room을 등록한다. 두 Room의 wire 계약은 서로 다르며 현재 프로세스 전체 Room 용량 하나를 공유하므로 동시에 사용하지 않는다. `/health`는 기존 호환 별칭이고 개발 profile에서 `/monitor`, `/playground`를 제공한다.

로컬 Playground의 빈 `{}` 입장은 기존 개발 흐름을 위해 development에서만 허용한다. join option에 토큰을 제공하면 엄격하게 검증하고 한 번만 소비한다. React 웹은 기본 `kkakkung`과 선택형 `sandbox` 모두 일회성 토큰을 사용한다. production은 두 방식 모두 현재 차단한다.

현재 Origin 감사에서 `/api/config`의 Express 검사는 작동하지만 SDK가 먼저 처리하는 `/matchmake/*`에는 같은 검사가 적용되지 않는 문제가 확인됐다. [B-02](../docs/execution/b-game-server.md#b-02)의 공통 HTTP 경계·예약 부작용 회귀 시험으로 수정할 계획이며 이 문서 변경만으로 해결된 것은 아니다. 기본 loopback 설정을 유지하고 인증 없는 개발 관리 화면을 외부에 공개하지 않는다.

## 구조

```
src/
├─ domain/      규칙 계산 (손주연). Colyseus 를 import 하지 않는다. 지금은 스텁
├─ rooms/       Room · Schema · StateView (정유림). domain 을 호출만 한다
│  ├─ KkakkungRoom.ts
│  └─ schema/GameState.ts
├─ integrations/  LiveKit 등 외부 연동 (3단계)
└─ index.ts     서버 기동
```

`src/domain`은 기존 담당과 함수 이름을 유지하면서 `@kkakkung/game-core/match` 경계를 재노출한다. `src/rooms/schema/GameState.ts`는 `@kkakkung/protocol/game-schema`를 재노출한다. 이 이동은 소유권 변경이나 스텁 완성을 뜻하지 않는다.

## 현재 단계: 0단계 뼈대

- [x] 6인 방, 입장 시 Player 생성, 고정 맵
- [x] move / turn / ready → domain 판정 → 상태 변경
- [x] 상태 머신 골격 waiting → playing → result
- [x] StateView 골격: 술래 패킷에 `exits` 없음
- [ ] [E2] 방 코드 참가 · 6인 강제
- [ ] [E2] 서버 역할 배정 (현재는 입장 순서 임시)
- [ ] [E2] StateView 시야 필터링 (1단계)

현재 전체 maze와 players 공개는 0단계 호환 동작이다. 입력 계약을 엄격히 검사하고 술래 상태에서 `exits` 골격을 제외해도 G4 전체 정보 은폐를 통과한 것은 아니다. 전체 게임 규칙과 실제 맵 검증도 후속 작업이다.
