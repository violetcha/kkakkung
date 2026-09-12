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

`main.ts`는 `SERVER_PROFILE=development`(기본값)와 `product`를 명시적으로 구분한다. 개발 profile은 진단 `sandbox`(0.1.0)와 개발 `kkakkung`(`DevKkakkungRoom`, 0.1 wire, 전체 maze 공개)을 등록하며 웹 e2e·Playground 회귀용이다. 제품 profile은 `ProductProfileLoader`로 실제 A 코어·맵·튜닝과 F 설정·E coordinator/운영 인증을 조립한다. 제품에서는 개발 세션·Playground·monitor·sandbox를 제공하지 않는다.

제품 profile에는 F의 admission 설정 묶음이 필요하다. `MEDIA_MODE=disabled`는 제품 공개 계약과 실제 게임 모듈을 로드하지만 readiness/admission은 `LOCKED`로 유지한다. `MEDIA_MODE=livekit`에는 전체 Cloud 설정·운영 정책이 필요하며, 설정만으로 공식 자격·예산·감사 증거를 대체하지 않는다. `NODE_ENV=production`은 배포 검증 전까지 거절한다. 환경 변수 목록과 설명은 [환경 설정 예시](.env.example)를 따른다.

## 제품 조립 (`ProductProfile`)

`src/bootstrap.ts`의 `ProductProfile`은 담당별 산출물을 명시적으로 받는다.

| 필드                                                                                                                    | 소유             | 없을 때                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| `core`, `tuning`, `practice`, `layouts.maps/selection`                                                                  | A                | 준비 단계에서 멈추고 `blockedReason` 기록 |
| `createMediaCoordinator`, `mediaConfig`, `createOperatorAuth`                                                           | E(+F 값)         | 미디어 비활성, 운영 경로 503              |
| `maxRooms`, `inviteMaxTtlMs`, `publicWindow`, `sessionAttempts`, `roomIdleTtlMs`, `trustProxy`, `opsToken`, 콘텐츠 경로 | F                | 초대 발급 NOT_READY, admission LOCKED     |
| `developmentAdmission`                                                                                                  | 개발/테스트 전용 | production은 parseConfig가 거절           |

기동 순서: 실제 콘텐츠/튜닝 검증 → E `initialize()` → fatal이면 listen 없이 close → `server.listen` → `installHttpBoundary`(SDK 매칭·OPTIONS 이전 Origin/2KB) → `RoomTickCoordinator` 10ms 타이머. F의 metric registry·alert policy·구조화 로그에 tick duration과 process 측정값을 전달한다.

미디어 발급은 인증된 `POST /api/media/grants`가 서버 requestId를 생성·재사용한다. 새 인스턴스의 첫 실제 프레임을 E가 관측할 때까지 발급을 대기시키며, 재시도도 E의 현재 권한·예산·토큰 만료 검사에 들어간다. B는 E의 control/bindings/audio 결과를 다음 tick에서 현재 인스턴스에만 적용하고, `/api/media/report`는 현재 인스턴스 및 정확한 발급 세대를 E lifecycle에 확인한다. 이전 인스턴스의 `closed` 보고와 원격 회수 확인은 단계 전환·재경기 장벽에 연결한다. 연습→경기 발급에는 이전 receiverGeneration이 필요하다. 모든 현재 연습 세대의 준비 결과를 tick에 적용하고 진행 중 발급이 끝나야 연습을 종료한다. 발급 결과가 불명인 상태로 기존 60초 기한을 넘거나 미디어 준비가 실패하면 `ABORTED/MEDIA_UNAVAILABLE`로 종료하며 같은 match의 세대를 추측해 재발급하지 않는다. 일반 장치 미준비·맵 준비 실패로 DEVICE_CHECK에 돌아가면 기존 READY를 지우고 다시 신고받는다.

운영 설정은 F의 `RuntimeEvidence`가 검증해 E에 공급한다. 상시 서비스는 명시적 `OPS_OPERATING_MODE=continuous`와 `service-operations.json`을 사용하며 날짜 경과로 잠그지 않는다. 기존 attested 모드는 `runtime-evidence.json`의 유효기간·공식 잔량 확인을 유지한다. 두 모드 모두 파일 없음·변경·scope 불일치, 기록 손상과 미확인 회수는 차단한다. 앱 종료나 기동 실패 시 감시 자원도 종료한다. 준비·예산·감사 파일에 값을 임의로 채워 성공으로 만들지 않는다. [상시 운영 절차](../docs/continuous-operations.md)를 따른다.

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
- [x] A core/맵·튜닝, E coordinator·lifecycle·운영/health, F 설정·관측의 제품 조립 경로
- [x] 실제 A 8개 fallback 변형·양팀 연습 맵과 strict 제품 HTTP 잠금 검증 (`product-profile.test.ts`)
- [x] 실제 A/B/C/E 6인 연습→경기→한 명 세대 교체→종료/회수→재경기 검증 (`product-integration.test.ts`, D 장치·Cloud 경계는 synthetic)
- [ ] 공식 Cloud 자격·예산·namespace/최초 감사 증거를 갖춘 실제 운영 검증 ([B 인계](../docs/execution/handoffs/B.md))
- [ ] G4 정보 은폐·G5 6대·10방 부하의 실제 검증

기본 loopback 설정을 유지하고 인증 없는 개발 관리 화면을 외부에 공개하지 않는다.
