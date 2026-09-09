# 까꿍 게임 서버

Node.js + Colyseus 서버 권위형 매치 서버. 제품 계약(0.2.0)은 [프로토콜 문서](../docs/protocol.md), [최신 결정 정정표](../docs/spec/decisions.md), [공통 실행 계약](../docs/execution/common.md), [B 실행 문서](../docs/execution/b-game-server.md), [B 인계 기록](../docs/execution/handoffs/B.md)을 따른다. [기존 개발 프로토콜](docs/protocol.md)은 개발 `kkakkung` Room의 0.1 호환 동작만 설명한다.

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

`main.ts`는 아직 **개발 profile**로 기동한다. 개발 profile은 진단 `sandbox`(0.1.0)와 개발 `kkakkung`(`DevKkakkungRoom`, 0.1 wire, 전체 maze 공개)을 등록하며 웹 e2e·Playground 회귀용이다. 제품 `kkakkung` Room은 `createApplication(config, product)`에 `ProductProfile`을 주입할 때만 등록된다. F의 설정 export가 도착하면 `main.ts`가 profile을 조립한다.

## 제품 조립 (`ProductProfile`)

`src/bootstrap.ts`의 `ProductProfile`은 담당별 산출물을 명시적으로 받는다.

| 필드                                                                                                                    | 소유             | 없을 때                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| `core`, `tuning`, `practice`, `layouts.maps/selection`                                                                  | A                | 준비 단계에서 멈추고 `blockedReason` 기록 |
| `createMediaCoordinator`, `mediaConfig`, `createOperatorAuth`                                                           | E(+F 값)         | 미디어 비활성, 운영 경로 503              |
| `maxRooms`, `inviteMaxTtlMs`, `publicWindow`, `sessionAttempts`, `roomIdleTtlMs`, `trustProxy`, `opsToken`, 콘텐츠 경로 | F                | 초대 발급 NOT_READY, admission LOCKED     |
| `developmentAdmission`                                                                                                  | 개발/테스트 전용 | production은 parseConfig가 거절           |

기동 순서: E `initialize()` → fatal이면 listen 없이 close → `server.listen` → `installHttpBoundary`(SDK 매칭·OPTIONS 이전 Origin/2KB) → `RoomTickCoordinator` 10ms 타이머.

## 구조

```
src/
├─ domain/       A 규칙 재노출 (손주연). Colyseus를 import하지 않는다
├─ game/         B. ports.ts(A/E/F 포트 타입), MatchContext, CommandAdapter/Queue/Limiter,
│                MatchDriver(단일 Tick), RoomTickCoordinator, Heartbeat, ClockSync,
│                EventDispatcher, PlayerProjection(allowlist 뷰), LayoutLoader
├─ session/      B. HttpBoundary, InviteStore/InvitationRoutes, ProductSessionStore,
│                SessionRoutes, AdmissionLimiter, SlotRegistry, RoomAdmission, RoomExpiry,
│                OperationsRoutes, SessionStore(개발 1회용)
├─ rooms/        B. KkakkungRoom(제품 0.2.0), DevKkakkungRoom(개발 0.1), GameRoom(sandbox),
│                Lobby/Practice/Loading/Countdown/Rematch coordinator, RoomDirectory
├─ media/ operations/ health/   E
├─ config/ observability/       F
└─ bootstrap.ts / main.ts        B 조립
```

시험: `server/tests/`(개발 회귀), `server/test/protocol|room|session/`(제품 단위·통합). `server/test/room/test-harness.ts`의 `FakeCore`는 서버 경계 검증용 double이며 A 엔진이 아니다. 이 harness로 통과한 결과는 LOCAL_VERIFIED이고 실제 A/E/F 결합 뒤에만 INTEGRATED/ACCEPTED다.

## 현재 단계

- [x] 0.2.0 공개 계약·개인 뷰 allowlist·명령 접수/종결 원장·단일 Tick 경로
- [x] 초대·세션·좌석·heartbeat·clock·재동기화·6인 준비·연습·맵 로더·로딩 장벽·카운트다운·재경기 (FakeCore 통합 시험)
- [x] SDK 매칭 이전 HTTP Origin/2KB 경계와 WS Origin
- [ ] A core/맵 포트, E 미디어·운영 인증, F 설정의 실제 결합 (blockedOn, [B 인계](../docs/execution/handoffs/B.md))
- [ ] G4 정보 은폐·G5 6대·10방 부하의 실제 검증

기본 loopback 설정을 유지하고 인증 없는 개발 관리 화면을 외부에 공개하지 않는다.
