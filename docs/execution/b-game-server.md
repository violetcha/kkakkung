# B · 프로토콜·게임 서버·경기 흐름 실행 문서

작성 기준: 2026-09-08 · 현재 스켈레톤에서 실행 전 확인 · **EXEC-CONTRACT-3**
담당 범위: 공개 계약, 세션, Room, 권위 Tick과 서버 모듈 조립  
원본 작업: **18개** · 리뷰 상대: **A** · 현재 상태: **모두 구현 계획**

이 문서와 [최신 결정 정정표](../spec/decisions.md), 아래의 담당 읽기 경로를 실행 입력으로 사용한다. 보관된 v0.0.8보다 최신 결정과 공통 계약을 먼저 적용한다. 팀원에게 다른 담당 실행 문서 전체를 찾아 오도록 요구하지 않는다. [6인 전체 일정](README.md)은 인계 시점을 확인하는 안내다.

목표는 **9월 8일(화)·9일(수) 핵심 구현, 10일(목) 통합·검증·수정, 11일(금) 오전 MVP 인수**다. 작업 개수는 소요시간이나 완료 보증이 아니다. 선행 작업·실제 Cloud·장치가 준비되지 않은 조건은 완료로 계산하지 않는다.

## B가 작업을 시작할 때 읽을 자료

1. 루트 [AGENTS.md](../../AGENTS.md), [CONTRIBUTING.md](../../CONTRIBUTING.md), [요구사항](../../requirements.md), [아키텍처](../architecture.md), [최신 결정](../spec/decisions.md)을 읽고 현재 브랜치·미커밋 변경을 확인한다.
2. 이 문서의 공통 블록과 요청 번호 본문, [타입 원본](contracts/types.ts), [fixture](contracts/fixtures.ts), [fixture 검사](contracts/fixtures.test.ts)를 읽는다. 공통 계약 변경이 필요하면 common·타입·fixture 원본을 함께 수정하고 소비자에게 인계한 뒤 사본을 동기화한다.
3. [서버 README](../../server/README.md), [protocol README](../../packages/protocol/README.md), `server/src/bootstrap.ts`, `server/src/rooms/KkakkungRoom.ts`, `server/src/game`·`session`의 변경 대상과 해당 기존 시험을 읽는다. `server/docs/protocol.md`는 현재 0.1 개발 흐름의 회귀 기준이고 새 제품 계약의 원본이 아니다.
4. 기획 근거를 재확인할 때만 [HTML 원본](../spec/까꿍_3대3_MVP_기획_구현_기준서_v0.0.8.html)의 해당 장을 읽는다. B-01–05·10–11은 07·17·24장, B-06–09·13은 18·22장, B-12·15–18은 04·05·24장, B-14는 08·09·17장이다. 공통 미디어 포트를 조립할 때는 [미디어 수명](../media-lifecycle.md)도 확인한다.
5. [B 인계 기록](handoffs/B.md)에서 기존 진행을 확인하고, 필요한 A/E/F의 인계 기록에 적힌 public export와 검증 결과를 소비한다. 다른 담당의 실행 문서 전체나 내부 상태 구현을 전제하지 않는다. 기존 `server/test`의 예정 파일은 실제로 생성해야 하며 경로가 없다고 검사를 skip하지 않는다.

```bash
# 고정 번호 B-01~B-05
node scripts/prepare-execution.mjs --role B --tasks 1-5
# 9월 9일 오늘 번호 1~5 = B-14~B-18
node scripts/prepare-execution.mjs --role B --day D2 --tasks 1-5
```

위 명령은 읽기 전용 범위 확인이다. 요청 밖의 A/E/F 작업이나 같은 담당 선행 기능을 자동 구현하지 않는다. 선행이 없으면 공통 포트를 사용하는 자기 단위 구현/시험까지 수행하고 `localStage`와 `blockedOn`을 나누어 남긴다. 문서 fixture의 성공을 실제 core·Cloud 성공으로 바꾸지 않는다.

## B의 선행 결과와 충돌 없는 조립

본문의 “선행 완료 결과”는 **계약·단위 인계**와 **최종 연결**로 나누어 확인한다. B-01/02의 공개 타입·검증기는 A 엔진 전체와 C 화면 전체를 기다리지 않는다. B-04의 단위 어댑터를 만들기 위해 A-33이나 E의 Cloud 완료까지 먼저 요구하지 않으며, 그 결과만으로 실제 게임 인수를 완료하지도 않는다.

| 요청 범위  | 자기 영역에서 먼저 만들 결과                           | 실제 연결에 필요한 인계                                                                     | 완료를 보류할 조건                                                 |
| ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| B-01–03    | 0.2.0 공개 타입/Zod, strict HTTP 경계, bounded 원장/큐 | 공통 CorePort, A CoreOutcome, C 명령/조회 소비자                                            | 실제 A 거절→B 종결→C pending 해제 미연결                           |
| B-04–05    | 단일 Tick writer·이벤트 분기·과부하/취소·공정 스케줄러 | A createMatch/stepMatch/selectors, E coordinator, F 계측 소비자                             | 실제 규칙/미디어 연결·실제 정지 시험 미실시                        |
| B-06–09·13 | 초대/논리 세션/원자 슬롯·만료·방장 정책                | F 운영 설정, E OperationsPort·회수 결과                                                     | 공개창/초대 설정·readiness·원격 회수 미확인                        |
| B-10–12    | heartbeat/clock·개인 사건/뷰 전송·6인 준비             | A 이탈 selector/개인 뷰, C 상태/사건 처리기                                                 | 개인 종료 이탈·권위 상실·준비 철회의 실제 연결 미실시              |
| B-14       | 허용 목록의 개인 projection·none/종료 뷰               | A CorePort의 실제 지식/시야/self selector                                                   | 실제 Room wire에 개발 maze/players가 남음                          |
| B-15       | 팀별 practice 조립·60초/전원 준비 전환                 | A createPractice·practice 자료·이동/회전/지식/교환/장비, E prepare/retire, C 연습 화면      | 실제 연습 기능 또는 이전 미디어 회수 미완료                        |
| B-16–18    | LayoutLoader·로딩 장벽·카운트다운·재경기               | A MapPreparationPort/LayoutSelectionPort·core, E 세대/실제 얼굴 binding·회수, C 로딩 소비자 | 인증 배치·현재 게시 확인·구 세대 회수·전원 준비 중 하나라도 미충족 |

개발 `kkakkung`은 메시지 callback에서 위치를 바꾸며 전체 maze/players를 전송하고, sandbox는 별도 20Hz 연속 이동을 쓴다. 제품 전환 시 B만 Room/조립부를 바꾼다. A에게 서버 Room을 수정시키거나 B가 game-core/서버 콘텐츠를 대신 구현하지 않는다. 기존 개발 회귀는 개발 profile에서 유지하고 production의 개발 Room·관리 화면·빈 입장은 닫힌 상태를 시험한다.

B는 protocol 소스/시험, 서버 rooms/game/session, bootstrap/index/main과 지정 서버 시험을 수정한다. A의 domain 재노출, E의 media/operations/health, F의 env.ts/manifest/lockfile/공통 tests와 설정은 해당 담당에게 [B 인계 기록](handoffs/B.md)으로 정확한 요청을 남긴다. 특히 E가 포트를 구현해도 HTTP 라우트 등록·인증 actor 주입·Room callback과 listen 순서는 B가 조립한다.

`bootstrap.ts`, `KkakkungRoom.ts`, `MatchDriver.ts`, protocol barrel은 B의 단일 조립점이다. B 내부 병렬 작업은 leaf 처리기와 시험만 나누고 조립점은 한 작업자가 순차 통합한다. F용 Room 시험 하네스는 B가 `server/test/room/test-harness.ts`에 만들고 F의 외부 연결 시험이 import하게 한다. 하네스는 fake clock/transport 주입과 실제 B/A 모듈 기동을 구분하며 production 전용 우회 endpoint를 만들지 않는다.

인계마다 실제 export·채널/HTTP 형태·정상/거절 재현 명령·검증 commit·남은 상대 연결을 기록한다. 실행한 파일의 검증만 LOCAL_VERIFIED로 계산하고 해당 ID의 생산자/소비자 연결과 필수 Cloud/장치 증거가 갖춰지면 INTEGRATED/ACCEPTED를 갱신한다. `.local` MR 초안만 만들고 다른 담당이 인계를 읽을 수 있다고 가정하지 않는다.

## 날짜별 오늘 작업표

각 날짜에서 오늘 번호를 1부터 다시 센다. 예를 들어 9월 9일에 “오늘 1번부터 5번”을 요청하면 **D2 표의 1–5번**을 수행한다. `B-01` 같은 고정 번호와 원본 ID는 날짜가 지나도 바꾸지 않는다. 일정 이후에는 날짜 또는 고정 번호를 명시한다.

### D1 · 2026-09-08 화요일

계약·환경과 병렬 구현 기반을 만들고 권위 이동·장치 점검을 연결. 새 원본 작업 13개.

| 오늘 번호 | 고정 번호                     | 원본 ID | 완료할 결과                          |
| --------- | ----------------------------- | ------- | ------------------------------------ |
| 1         | [B-01](b-game-server.md#b-01) | SV-01   | 매치 상태·버전·튜닝 계약             |
| 2         | [B-02](b-game-server.md#b-02) | SV-02   | 명령 공통 봉투·런타임 검증           |
| 3         | [B-03](b-game-server.md#b-03) | SV-03   | 입력 큐·중복·전송량 제한             |
| 4         | [B-04](b-game-server.md#b-04) | SV-04   | 권위 상태를 단일 Tick 경로로 변경    |
| 5         | [B-05](b-game-server.md#b-05) | SV-05   | Tick 지연·과부하 보호                |
| 6         | [B-06](b-game-server.md#b-06) | AC-01   | 테스트 초대 발급·검증                |
| 7         | [B-07](b-game-server.md#b-07) | AC-02   | 방 생성·참가 API와 시도 제한         |
| 8         | [B-08](b-game-server.md#b-08) | AC-03   | 논리 세션과 중복 접속 처리           |
| 9         | [B-09](b-game-server.md#b-09) | AC-04   | 방·서비스 슬롯 상한 적용             |
| 10        | [B-10](b-game-server.md#b-10) | SV-06   | 게임 서버 heartbeat와 권위 상실 신호 |
| 11        | [B-11](b-game-server.md#b-11) | SV-07   | 개인 사건 버전·중복과 뷰 재동기화    |
| 12        | [B-12](b-game-server.md#b-12) | FL-01   | 6인 준비 단계와 역할 배정            |
| 13        | [B-13](b-game-server.md#b-13) | AC-05   | 대기 방 정리와 방장 위임             |

### D2 · 2026-09-09 수요일

MVP 핵심 기능을 구현하고 생산자·소비자를 통합. 새 원본 작업 5개.

| 오늘 번호 | 고정 번호                     | 원본 ID | 완료할 결과                 |
| --------- | ----------------------------- | ------- | --------------------------- |
| 1         | [B-14](b-game-server.md#b-14) | KN-04   | 수신자별 상태 projection    |
| 2         | [B-15](b-game-server.md#b-15) | FL-03   | 팀별 연습 인스턴스와 종료   |
| 3         | [B-16](b-game-server.md#b-16) | FL-05   | 맵 확정과 로딩 준비 장벽    |
| 4         | [B-17](b-game-server.md#b-17) | FL-06   | 카운트다운과 공통 시작 시각 |
| 5         | [B-18](b-game-server.md#b-18) | FL-08   | 재경기 초기화와 준비 재확인 |

### D3 · 2026-09-10 목요일

최종 흐름·실기기·Cloud·부하 검증과 결함 수정. 새 원본 작업 없이 기존 작업의 통합과 결함을 마무리한다.

| 오늘 번호 | 고정 번호        | 원본 ID      | 완료할 결과                                                                                     |
| --------- | ---------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| 1         | 기존 B 작업 후속 | 신규 ID 없음 | C-18·C-19가 붙이는 GAME_LOADING/RESULT/재경기 payload를 실제 Room에서 확인한다.                 |
| 2         | 기존 B 작업 후속 | 신규 ID 없음 | QA-07·QA-08의 동시 판정·정보 누출·접속 상실 실패를 서버 조립/프로토콜 소유 파일에서 수정한다.   |
| 3         | 기존 B 작업 후속 | 신규 ID 없음 | 6대 5판 중 단계 정지·늦은 메시지·세대 혼입을 matchId/requestId/생성 시각으로 재현하고 회귀한다. |
| 4         | 기존 B 작업 후속 | 신규 ID 없음 | QA-11·QA-12의 Tick/WS/세션 정리 결함을 수정하고 미디어 IO가 Tick을 막지 않는지 확인한다.        |
| 5         | 기존 B 작업 후속 | 신규 ID 없음 | 통합 commit에서 6인/개인 종료/무효 처리/재경기 연결 결과를 F에 인계한다.                        |

D3 결함 수정은 원본 122개 작업의 후속 처리다. 별도 스토리 수를 늘리지 않는다. 수정한 파일 소유자가 검증 후 `fix:` 커밋과 MR 본문을 남긴다. C/F의 신규 D3 항목이 있더라도 같은 날 발견한 자기 소유 결함은 함께 마무리한다.

<!-- BEGIN EXEC-CONTRACT-3 COMMON -->

# 공통 실행 계약 원본

버전: **EXEC-CONTRACT-3** · 적용 결정: **D-2026-09-08-01** · 갱신일: 2026-09-08

이 파일은 여섯 담당 문서에 자동 삽입하는 유일한 공통 원본이다. EXEC-CONTRACT-3은 이전 계약의 맵 영역 입력·게임 논리 인스턴스·미디어 초기화·격리 배포 순서를 보완한다. 기존 작업 번호와 제품 범위는 유지하며, 기획서 원본을 새 승인 내용으로 소급 수정하지 않는다. [최신 결정 정정표](../spec/decisions.md)가 v0.0.8과 충돌하는 부분에 우선한다. 계약 타입·fixture·문서를 바꾼 것만으로 Origin 보안이나 제품 기능의 런타임 수정이 완료된 것은 아니다.

## 이 문서로 실행하는 방법

담당자가 작업 번호의 실행을 요청하면 구현·검증·작업별 로컬 커밋·MR 본문 작성까지 수행한다. 푸시·GitLab MR 생성·원격 병합은 담당자가 직접 한다. 문서를 검토하거나 읽는 요청만으로 제품 구현을 시작하지 않는다.

```text
내 담당 실행 문서와 docs/spec/decisions.md, v0.0.8 기획서를 기준으로
내 담당의 고정 번호 01번부터 05번까지 진행해줘.
결정 대기 작업은 구현하지 말고 해당 번호를 보류한 뒤 다음 번호를 진행해줘.
검증된 중간 산출물과 완료 작업은 내 Git 신원으로 각각 로컬 커밋해줘.
작업별 MR 본문과 이번 실행분 합본을 작성하고 전체 본문을 보여줘.
푸시·MR 생성·원격 병합은 하지 마.
```

- 오늘 번호는 날짜별 표에서 찾고 고정 번호·원본 ID는 유지한다. 같은 작업 재요청 시 코드·Git 로그·진행 기록으로 중복 커밋을 방지한다.
- 코드·지침·설치된 SDK 타입·계약 파일은 AI가 직접 읽는다. 사람에게 함수명·파일 위치를 찾아 전달하도록 요구하지 않는다.
- **MP-06, EQ-06, EQ-07, EQ-08, EQ-09, EQ-12는 PRODUCT_DECISION_PENDING**이다. 종류·효과·수량·획득·소지·사용이 정해지기 전 구현·가짜 완료·대체 아이템 설계를 하지 않는다.
- EQ-11은 구속 상태 HUD만 진행한다. 술래 감지기·덫, 자연 구속 만료·유예, 회전·포획, 공통 후보 우선순위는 유지한다.
- 제품 계약에 아이템 종류·인벤토리·아이템 사용 명령·아이템 엔티티를 추가하지 않는다. 결정 대기 상태는 완료나 승인된 범위 제외로 바꾸지 않는다.
- 목표는 9/8–9 핵심 구현, 9/10 통합·검증·수정, 9/11 금요일 오전 인수다. 확정 범위의 G1–G6 증거와 미정 아이템의 상태를 함께 보고한다. 기존 v0.0.8 전체 요구가 완료됐다고 선언하지 않는다.

## 설치와 공통 검사

### 담당 문서만으로 시작하는 읽기 경로

공통 필수 자료는 `AGENTS.md`, `CONTRIBUTING.md`, `requirements.md`, `docs/architecture.md`, `docs/spec/decisions.md`다. 이후 자기 담당 문서의 시작 절차와 지정 작업만 읽고, 각 작업의 기획 근거 장을 원본 HTML에서 확인한다. 이 공통 블록과 타입은 자기 담당 문서에도 들어 있으므로 다른 다섯 역할의 전체 문서를 읽을 필요는 없다. 다른 역할의 **공개 타입·실제 export·시험 fixture·인계 기록**은 연결 근거로 직접 확인한다. SDK 사실은 설치된 버전의 타입·구현을 확인한다.

```bash
node scripts/prepare-execution.mjs --role A --tasks 1-5
node scripts/prepare-execution.mjs --role A --day D2 --tasks 1-5
```

첫 명령은 고정 번호 A-01–A-05, 둘째는 D2 오늘 번호 1–5(A-19–A-23)다. 도구는 읽을 자료·기획 장·범위 밖 선행·파일 존재 여부를 출력하는 읽기 전용 도구다. 파일 존재를 구현 완료로 계산하지 않는다. `--day`가 없으면 현재 날짜를 추측하지 않는다. 유효하지 않은 범위를 일부만 실행하지 않고 오류로 알려 준다. D3에 신규 고정 번호가 없는 역할의 후속 작업은 담당 D3 표를 따른다.

### 선행 작업과 범위 제한

작업 본문의 `선행 완료 결과`는 **최종 연결 전에 필요한 산출물 목록**이다. 모든 선행의 ACCEPTED를 기다려야 코딩할 수 있다는 뜻이 아니다. 공개 계약이 고정되면 자신의 단위 구현과 합성 fixture 시험을 진행할 수 있다. 실제 생산자 구현·통합 commit이 없으면 LOCAL_VERIFIED까지만 기록하고 실제 연결은 차단 조건으로 남긴다.

다음 일차의 실제 생산자까지 필요한 경우 `통합 인수 선행`을 별도 적는다. prepare 출력도 이 목록을 단독 구현 선행과 분리한다. 예를 들어 C-03의 합성 action 보간은 먼저 구현하지만 실제 인수에는 B-14 개인 뷰가 필요하다. 미래 생산자가 있다는 이유로 해당 날짜의 단위 구현이 불가능하다고 처리하지 않는다.

요청 범위 밖의 자기 선행 구현도 자동으로 추가하지 않는다. 현재 checkout에서 선행 산출물을 확인하고, 없으면 지정 범위의 독립 가능한 작업을 먼저 끝낸 뒤 필요한 고정 번호·export·시험을 인계 기록에 요청한다. 다른 담당의 파일·manifest를 대신 수정하거나 범위를 채우기 위한 성공 stub을 만들지 않는다. 계약 변경이 필요하면 소비자는 자신의 인계 문서에 구체 요청을 남기고 계약 담당 B가 원본을 수정한다.

Node.js 24.19.0 / pnpm 11.19.0 / TypeScript 6.0.3과 루트 lockfile을 유지한다.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm exec playwright install chromium
pnpm build:packages
node scripts/check-execution-plan.mjs
```

공통 계약·fixture의 타입 검사는 계획 정합성 검사다. 실제 모듈 통합·Cloud·장치·부하 검증이 아니다. 새 시험/runner는 해당 작업에서 만들 산출물이며 파일이 없다고 skip 또는 성공으로 처리하지 않는다. 작업별 검증 후 타입·lint·빌드를 확인하고 일차 인계 전에는 `pnpm verify`를 실행한다. 기본 verify는 실제 Cloud나 장시간 부하를 자동 실행하지 않는다.

## 단독 수정 영역과 공통 계약 변경

| 담당 | 단독 수정 영역                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | game-core의 match 소스/시험, server/content, server/config/tuning, 기존 server/src/domain/index.ts·types.ts 재노출                                                              |
| B    | protocol의 src/test, server/src/rooms·game·session, bootstrap.ts/index.ts/main.ts, 서버 room/protocol/session 시험과 기존 server/tests/integration·tick.test.ts·session.test.ts |
| C    | 웹 app, features/room·game, styles.css, 화면/장면 시험, 3D 자산                                                                                                                 |
| D    | 웹 features/devices·vision·input·media와 해당 시험, public/models, tsconfig.worker.json                                                                                         |
| E    | server/src/media·operations·health와 해당 server/test                                                                                                                           |
| F    | manifest/lockfile·공통 설정·env.ts, infra/Jenkins/scripts/tests, server/src/observability, 검증·배포 문서                                                                       |

B만 서버 최종 조립을, C만 웹 최종 조립을, F만 공통 설정과 의존성을 수정한다. A는 protocol을 import하지 않고 B가 변환한다. 웹은 서버 실제 맵·game-core·운영 내부값을 import하지 않는다. 제품은 0.2.0의 kkakkung, sandbox 0.1.0은 개발 진단용으로 격리한다. 기존 공개 maze·빈 입장·Playground와 개발 adapter는 production 라우트에서 차단한다. 개발 회귀용 경로만 유지하며 제품 기능을 위해 진단 API를 확장하지 않는다.

구체 파일의 단일 수정자는 [소유권 원본](ownership.json)으로 판별한다. 경로가 가장 구체적인 규칙이 우선하며, 예를 들어 웹 public 자산은 C지만 `public/models/`는 D다. 선언되지 않은 새 경로는 임의 소유로 간주하지 않고 F에게 등록을 요청한다. 작업의 수정·생성 파일에는 glob이나 디렉터리 전체 대신 실제 파일명을 적는다. `check:execution`은 각 선언 경로가 담당의 소유권에 맞는지도 검사한다.

구현 checkout의 시작 SHA를 기록한 뒤 `node scripts/check-role-scope.mjs --role A --base <시작-SHA>`로 commit·stage·미커밋·미추적 변경을 검사한다. rename은 원래 경로와 새 경로 모두 검사한다. 다른 역할의 변경이 섞인 공동 checkout에서는 먼저 담당별 checkout/브랜치로 분리한다. 이 명령은 삭제·수정 권한을 부여하지 않는다. 공통 문서 정비처럼 여러 소유자가 참여하는 변경은 단일 역할 구현 검사와 구분한다.

B의 계약 변경이나 F의 사본 동기화에서만 scope 명령 끝에 `--contract-sync`를 붙인다. 다른 역할 문서는 원본과 일치하는 공통 블록만 바뀌고 역할 본문은 시작 SHA와 같아야 한다. 도구는 commit·stage·working 각각의 수정 버전을 검사하며, 일반 코드·역할 지시 변경이나 F의 B 소유 common 원본 변경까지 면제하지 않는다. 사본 예외 검사 뒤에도 `check:execution`을 실행한다.

- manifest·lockfile·공통 config 요청은 각자 `handoffs/<역할>.md`에 패키지명/정확 버전/실행 또는 개발 의존성/소비 import/필요 script와 이유를 기록한다. F만 한 번에 install·lock 갱신·검증하여 commit을 돌려준다. A–E의 AI가 직접 `pnpm add`를 하지 않으며 어느 역할도 전체 자동 포맷으로 타인 파일을 바꾸지 않는다.
- 새 asset 출처·라이선스·버전·hash는 소유 자산 옆 README 또는 자기 인계에 기록하고 F가 `docs/third-party-assets.md`를 집계한다. 모든 역할이 같은 집계 문서를 동시에 편집하지 않는다.
- 개인 산출물/인계 문서는 각 역할만 수정한다. 공통 블록 변경과 `--sync`는 B 계약 변경 또는 F 문서 정비 MR에서만 수행하고 역할 구현 MR에는 다른 다섯 문서의 자동 갱신을 섞지 않는다.

공통 의미 변경은 B가 총괄하여 `docs/execution/common.md`와 `contracts/types.ts`·fixture를 수정한다. D 센서·E 미디어처럼 실제 생산자/소비자가 검토한다. F는 동기화 검사기를 소유한다. A–F 문서의 공통 블록은 직접 편집하지 않고 아래 명령으로 갱신한다.

```bash
node scripts/check-execution-plan.mjs --sync
node scripts/check-execution-plan.mjs
```

일반 리뷰 쌍은 A↔B, C↔D, E↔F다. 공개 경계 변경에는 해당 소비자를 추가한다: B 명령/개인 뷰는 C·D, E 세대/바인딩은 B·D, D callback은 C, F Worker/CSP/모델은 D, readiness는 B·E. 모든 사람이 모든 변경을 리뷰할 필요는 없다.

## 좌표·시간·라운드 수명

- Cell은 정수 x/y=0–31, Dir은 0북(y−1)/1동(x+1)/2남(y+1)/3서(x−1)다. 3D는 x=cell.x,z=cell.y, 셀 크기 1이며 기존 −15.5 보정을 섞지 않는다. TracePoint만 교환 중점의 0.5 좌표를 허용한다.
- matchId는 로비 라운드부터 유지하고 새 라운드에 교체한다. serverTick은 연습을 포함해 50ms/20Hz로 연속 증가하고 공개 stateVersion도 같은 match 안에서 연속 증가한다. 본 경기 로딩에서 matchId·Tick·stateVersion을 다시 만들지 않는다.
- PLAYING startTick과 deadlineTick=startTick+3600을 고정한다. 이동 9 Tick·회전 6 Tick이다. startAt/서버 timeout은 서버 monotonic ms, JWT 만료/회수는 epoch 초다.
- 웹 표시 시간은 `clock-probe/clock-reply`로 추정한다. 시작·재접속 뒤 5회 probe를 250ms 간격으로 보내고 RTT가 가장 작은 3회의 offset 중앙값을 사용한다. RTT=(수신클라이언트시각−clientSentAtMs)−(serverSentAtMs−serverReceivedAtMs), offset=((serverReceivedAtMs−clientSentAtMs)+(serverSentAtMs−클라이언트수신시각))/2다. 음수/RTT>1000ms 표본은 버리고 10초마다 재측정한다. serverEpoch가 바뀌면 표본을 폐기한다.
- 클라이언트 추정 시각은 렌더링/안내용이다. serverTick·startAt·포즈 최소 시간을 브라우저 시계와 직접 비교하지 않고 환산한다. 실제 성공 판정은 서버가 한다.
- B의 온라인 맵 선택은 A Generator의 `next()` 전후로 monotonic deadline을 확인한다. 첫 구현 설정은 maxAttempts=256, onlineMapBudgetMs=100, 한 next의 후보 상한=8이다. 이는 버전 관리할 계산 예산이며 게임 밸런스 값이 아니다. 유한 그리드 검사 후 다음 묶음 전에 이벤트 루프로 반환한다. 같은 스레드의 setTimeout이 동기 무한 루프를 중단한다고 가정하지 않는다. 인증 fallback은 먼저 검증하고, 시간/시도 소진 시 iterator.return(인증 결과)로 종료한다.

## 맵 영역과 fallback 입력 — A/B

A의 `MapPreparationPort`는 원본 검증과 변형 생성을 담당한다. B loader는 `validateTemplate(raw, source)`의 valid 결과만 `createTemplateVariants(template)`로 전달하고 invalid 결과에서 선택기를 실행하지 않는다. 두 결과 union의 error code/path는 내부 진단이며 실제 topology/hash를 공개 오류에 싣지 않는다. 함수명을 각자 다시 정하지 않고 검사 가능한 원본 타입을 사용한다.

A-01은 `PracticeLayoutTemplate`과 `PracticeLayoutPort.preparePracticeLayout(raw, players, role)`도 제공한다. B-15가 팀별 1–3명의 현재 playerId를 넘기면 A가 정적 역할 슬롯을 바인딩한 ready/layout 또는 invalid 결과를 반환한다. 연습의 소형 맵·동일 팀 인원·유효 시작점을 검사하되 본경기의 32×32·6인·3출구·거리 제약을 연습에 강제하지 않는다. 연습 layout의 exits는 비우고 포획·승패도 비활성화한다.

`LayoutSelectionInput.fallback`은 구조적으로 유효한 객체가 필수다. 파일 부재·JSON/shape 오류면 B loader가 준비 단계로 복귀하고 dummy fallback을 만들지 않는다. 객체 구조는 맞지만 출처·배치 규칙 인증에 실패한 경우에만 fallback을 불가 상태로 두고 온라인 선발을 시도할 수 있다. 둘 다 사용할 수 없으면 LAYOUT_UNAVAILABLE이며 맵 선택 완료로 처리하지 않는다.

- `LayoutTemplate`은 한 개의 정규화된 변형이다. `MapSource`의 templateId/templateVersion/templateHash/variantId와 topology, taggerRegions 3개, runnerSpawnRegions 3개, exitCandidates를 함께 전달한다. `SpawnRegion`은 regionId/cells/spawnCandidates를 가지며 평면 후보 목록으로 영역 정보를 없애지 않는다.
- A MP-01/02가 영역·후보·출구 벽면/방향을 함께 검증·변형한다. 역할별 영역 ID는 유일하고 각 영역·후보는 비어 있지 않아야 한다. 술래 영역끼리, 도망자 시작 영역끼리는 겹치지 않으며 후보는 자기 영역의 유효 통로에 속해야 한다. 술래 구역과 도망자 시작 영역 사이의 중첩 금지라는 새 게임 규칙을 추가하지 않는다.
- B loader는 파일을 읽어 원본 바이트의 SHA-256을 계산하고 승인된 templateId/version과 함께 A에 전달한다. templateHash는 이 원본 바이트 hash이며 변형마다 임의로 재정의하지 않는다. A는 이미 파싱된 자료를 검증한다. 실제 맵·영역·후보·hash·seed는 서버 내부 자료로 유지한다.
- B는 A가 반환한 검증 변형을 variantId 오름차순으로 정렬하여 `seed % variants.length`(seed는 uint32)로 하나를 선택한다. 빈 목록은 실패다. 선택된 변형과 같은 MapSource 4개 필드의 `FallbackLayout`을 입력한다. A MP-04는 이 변형 안에서 술래 3명에게 서로 다른 구역을 배정하고, 도망자 시작 영역 3개에서 각각 한 후보를 선택한 뒤 출구를 선발한다. selector 내부에서 다른 변형으로 다시 바꾸지 않는다.
- `LayoutSelectionInput`에는 template/players/seed/maxAttempts/fallback만 있다. 선발 전의 playerId 배정 territories를 받지 않으며, 확정 배정은 기존 `MatchLayout.territories`로 반환한다. fallback은 `{...MapSource,layout}`이며 변형별 자료를 A가 제공한다.
- 정적 fallback의 playerId/ownerId는 역할별 안정 슬롯 `tagger-1`–`tagger-3`, `runner-1`–`runner-3`으로 저장한다. A의 `certifyFallback`이 input.players를 역할별 playerId 기본 문자열 오름차순(로케일 정렬 금지)으로 정렬하여 슬롯 번호와 일대일 대응하고 players.playerId/exits.ownerId/territories.playerId를 함께 치환한다. 입력을 변경하지 않고 새 layout을 만들며 중복·누락·역할 불일치·미치환 슬롯을 거절한다. B는 정적 슬롯을 실제 코어 참가자로 전달하지 않는다.
- `certifyFallback`은 출처 4개 필드, topology의 버전·크기·통로 배열, 현재 영역/후보 소속과 기존 거리·연결성·출구 제약을 모두 재검사한다. hash 일치만으로 인증하지 않는다. 성공은 실제 플레이어로 바인딩된 `{status:'selected',layout,source:'fallback'}`, 실패는 `{status:'unavailable',code:'LAYOUT_UNAVAILABLE'}`로 기존 LayoutSelectionResult를 유지한다. 다른 변형/과거 템플릿 자료를 현재 fallback으로 사용하지 않는다. 정상 온라인 결과는 사용 가능하지만 fallback이 인증되지 않았다면 탐색 소진 시 LAYOUT_UNAVAILABLE로 끝낸다.

## 게임 논리 인스턴스와 개인 데이터 폐기 — A/B/C/D

- B는 두 팀 연습과 본 경기마다 역할·좌표를 인코딩하지 않는 새 UUID `gameInstanceId`를 발급한다. A의 CreateMatchInput/CreatePracticeInput과 CoreReadFrame이 이를 전달한다. A의 practice 입력에는 mediaInstanceId를 넣지 않는다. B가 게임 인스턴스와 E의 미디어 인스턴스 관계를 별도로 관리한다.
- PrivateView.gameScope는 `{gameInstanceId,kind:'practice'|'game',revision}` 또는 `{gameInstanceId:null,kind:'none',revision}`이다. B는 수신자별로 같은 match 안에서 revision을 증가시킨다. 시작은 none/0이며 연습 진입→연습 폐기→본 경기 진입의 예는 practice/1→none/2→game/3이다. 새 라운드는 matchId도 바뀐다. 같은 게임 인스턴스의 미디어 재연결만으로 이 ID/revision을 바꾸지 않는다.
- scope의 생성·전환·폐기는 내용 변경으로 취급하여 전체 PrivateView를 보낸다. none은 self=null이고 기억 지형/출구·가시 셀/벽면/엔티티가 모두 빈 배열이다. `TEAM_PRACTICE`는 practice, `GAME_LOADING/COUNTDOWN/PLAYING/RESULT`는 game, 나머지 phase는 none으로 정의한다. 폐기 시 C는 이전 지도·장면·교환/출구 문맥·보류 사건을 비운다. D의 MediaScope·트랙 회수는 별도 계약으로 수행한다.
- C는 `(matchId,gameScope.revision,gameInstanceId)`로 개인 자료를 구분한다. 낮은 revision과 이미 적용한 개인 뷰보다 낮은 stateVersion은 폐기한다. 같은 revision에 다른 ID/kind가 오면 화면에 적용하지 않고 resync한다. 높은 revision은 현재 권위 phase에 맞는 전체 뷰로만 전환하며 새 자료를 이전 지도에 합치지 않는다.
- 공개 phase가 바뀌면 C는 현재 개인 화면을 즉시 비우고 관측한 전환 stateVersion을 하한으로 저장한다. B는 scope/개인 내용이 같아도 phase 변경마다 해당 전환 stateVersion 이상의 전체 뷰를 한 번 발행한다. C는 하한보다 오래된 뷰를 적용하지 않는다. 공개 상태보다 앞선 뷰는 최신 1개만 최대 1초 보류하고 공개 상태가 따라오면 phase/scope/버전을 다시 검사한다. phase 변경 후 유효한 전체 뷰가 없으면 보류 뷰 유무와 무관하게 최대 1초 동기화 타이머를 시작한다. 하한 때문에 새 초기 뷰를 버렸거나 타이머가 만료되면 기존 view-resync를 요청한다. B는 수신자당 1초에 1회로 제한하고 현재 scope/권위 stateVersion으로 다시 직렬화한 전체 뷰를 보내며 옛 캐시 버전으로 응답하지 않는다.
- PrivateEvent.gameScope는 ActiveGameScope다. B는 사건을 만든 게임 인스턴스와 수신자의 당시 revision을 붙이며 늦은 작업의 사건을 새 인스턴스로 재표기하지 않는다. C는 과거 scope를 즉시 폐기하고 미래 scope의 사건으로 scope를 전환하지 않는다. 필요한 전체 뷰/참조 버전을 기다리는 사건은 기존 한도인 총 64개/1초 안에서 보류한다. 같은 revision의 ID/kind 불일치와 만료는 폐기·resync한다.
- B는 접수한 core 명령의 대상 gameInstanceId를 서버 큐 메타데이터에 고정하고 전환 시 옛 큐를 취소·종결한다. CommandEnvelope/receipt/outcome에 임의 필드를 추가하지 않는다. 옛 인스턴스의 accepted 요청도 원래 matchId/requestId로 canceled outcome을 받지만, 그 결과를 새 지도나 도전 생성으로 해석하지 않는다.

## 명령의 접수와 종결

채널은 아래 ClientMessages/ServerMessages의 정확한 키를 사용한다. 구조는 `contracts/types.ts`의 판별 가능한 타입을 기준으로 strict 런타임 스키마로 구현한다. 모르는 필드·범위 밖 좌표·안전 정수가 아닌 sequence·잘못된 UUID는 거절한다. 신원은 인증된 연결에서만 주입한다.

1. B는 인증·봉투·단계별 기본 조건·큐 한도를 검사하고 `command-result`를 보낸다. accepted는 큐 접수다. rejected이면 큐에 넣지 않으며 별도 실행 결과는 없다.
2. **accepted인 모든 명령은 반드시 한 개의 논리적 command-outcome으로 종결한다.** A의 순수 명령은 StepResult.outcomes, B의 READY/LOAD_READY/REMATCH는 B 단계 처리 결과에서 만든다. 실패로 상태가 전혀 변하지 않아도 requestId/sequence에 연결해 보낸다.
3. applied는 의도 반영·행동 예약·교환/도전 생성 등이 처리됐다는 뜻이다. 이동 도착·설치 완료·탈출 성공은 이후 권위 상태/사건으로 확인한다. 적용 후 다른 판정으로 취소되어도 같은 명령의 terminal 결과를 다시 바꾸지 않는다.
4. 동일 requestId/동일 내용은 최초 접수/종결 결과를 재전송하고 core를 다시 호출하지 않는다. 다른 내용 재사용은 STALE_REQUEST로 거절한다. pending 요청은 캐시에서 퇴출하지 않는다. 연결별 pending 최대 64, completed 최대 512개/2분으로 제한하고 큐를 넣기 전에 한도를 검사한다. 매치 종료 때 미처리 수용 요청은 ROUND_ENDED의 canceled로 정리한다.
5. C는 접수 결과가 rejected이면 즉시 pending을 끝내고 안전 code와 재요청 UI를 표시한다. 이 경우 outcome·조회 타이머를 기다리지 않는다. accepted만으로 spinner를 끝내거나 성공을 표시하지 않는다. outcome을 받으면 요청 pending은 끝내고 필요한 private-view/event를 별도로 기다린다. EXIT_START가 rejected/canceled이면 재요청 UI를 복구하며 challenge를 만들어내지 않는다.
6. accepted 후 2초 동안 종결이 없으면 request-status를 요청한다. 2초 간격 최대 3회, done이면 결과 적용, pending이면 대기한다. unknown/연속 무응답은 개인 뷰 resync와 UNCONFIRMED 안내로 spinner를 끝내며 성공/실패로 추정하거나 자동 재실행하지 않는다.
7. command-outcome.stateVersion은 수신자가 필요한 개인 뷰 버전이다. 개인 내용 변경이 없으면 마지막 개인 뷰 버전을 사용한다. 아직 개인 뷰가 없는 로비의 READY 결과는 해당 공개 라운드 버전이며 C는 존재하지 않는 개인 뷰를 기다리지 않는다.

필수 연결 시험은 **accepted → core 거절(상태 불변) → requestId에 맞는 outcome → UI pending 종료 → 새 요청 가능**이다. 동일 요청 재전송·매치 종료·결과 지연·상태 조회도 실제 A/B/C 코드로 검사한다.

## 개인 상태·출구·교환·준비

개인 뷰는 초기/허용 내용 변경/scope 전환/공개 phase 변경/명시적 resync 때 전체 교체한다. 일반적인 stateVersion 증가만으로 같은 지형을 계속 전송하지 않는다. phase 전환은 새 하한을 확인할 전체 뷰를 한 번 보내고 resync는 현재 버전으로 재직렬화한다. 사건 stateVersion은 참조 개인 뷰 버전이고 발생 시각은 tick이다. 미래 사건은 최대 64개/1초 대기 후 resync, 구 match·구 gameScope·중복·만료 사건은 폐기한다.

- visibleEntities는 종류별 필수 필드가 다르다. **가시 sensor는 wall이 필수**이며 자기 기억인 ownedEquipment와 분리한다. sensor.cell은 접근 셀, wall은 실제 부착 면이다. 다른 장비 위치를 전원에게 전송하지 않는다.
- self.exchange의 incoming/outgoing은 수신자 기준이다. C는 incoming만 D의 incomingExchangeId로 보내고 요청자는 outgoing 대기를 표시한다. 서버는 toPlayerId만 수락할 수 있게 검사한다.
- C는 현재 가시 아군만 교환 후보로 삼는다. 기존 후보가 계속 보이면 유지하고, 없으면 셀 제곱 거리·동률 playerId 순으로 고른다. 후보 선택은 서버의 거리·활동·지식 차이 검사를 대신하지 않는다.
- **READY true는 DEVICE_CHECK에서 로컬 장치 점검을 완료했다는 클라이언트 신고**다. 카메라·vision·calibration이 ready일 때만 보내고 장치 장애·취소는 false로 갱신한다. 마이크는 선택이다. 서버는 신고·인원·단계를 검증하며 원격 웹캠 정상 여부를 독립 증명한다고 쓰지 않는다.
- vision ready는 모델 로드만 뜻하지 않는다. 현재 유효 얼굴·첫 안전 가공 프레임·살아있는 가공 트랙까지 확보해야 한다. 실패 원인은 DeviceStatus.errorCode로 보고한다.
- 미니맵은 기억한 허용 출구를 표시할 수 있지만, **3D 포털·소유자 식별은 현재 관찰 중인 출구 벽면에만** 그린다. 폐쇄 시 같은 벽면의 일반 벽을 복원한다. 술래에게 출구를 보내지 않는다.
- 포즈 탈출 완료는 C가 단독 전송한다. 새롭고 유효한 동일 pose 관측으로 1.2초 유지하고 minSuccessTick도 충족해야 한다. 키 폴백은 challengeId 해시로 고정한 4방향 순환 순서를 사용한다. 최소 시간 조기 거절은 동일 도전·기한·유효 조건을 재확인한 경우에만 새 requestId로 제한 재시도한다.

## 서버 미디어와 브라우저 결합

mediaInstanceId는 팀별 연습/본 경기의 논리 미디어 인스턴스다. receiverGeneration은 이 메시지를 받는 플레이어 자신의 연결 세대, participants의 publisherGeneration은 원격 송신자 세대다. bindingRevision은 수신자·인스턴스·연결 세대 안에서 증가하며, 한 사람만 재연결했다고 다른 다섯 명의 receiverGeneration을 바꾸지 않는다. 새 Identity는 회수 완료 후에만 발급한다.

### 초기화 완료와 서비스 준비 — B/E/F

1. E의 동기 factory는 즉시 RECOVERING/readiness와 DRAINING/admission을 제공하고 발급·입장을 잠근다. B는 `await coordinator.initialize()`를 호출하며 중복 호출은 같은 진행 Promise/최초 결과를 공유한다.
2. initialized 결과는 writer lock과 저널/체크포인트의 복원 판단, 관찰 가능한 RECOVERING 또는 LOCKED 상태를 준비했다는 뜻이다. 안전하게 잠긴 손상/미확인 상태도 reasonCodes와 함께 initialized/LOCKED로 관찰 가능하다. Cloud 회수·예산 확인 완료를 의미하지 않는다.
3. 중복 writer 등 안전한 인스턴스를 유지할 수 없는 오류는 fatal(WRITER_CONFLICT 또는 INITIALIZATION_FAILED)이다. B는 HTTP listen을 시작하지 않고 close로 자원을 정리한다. 예상하지 못한 Promise 거절도 같은 부팅 실패로 처리한다. 초기화 중에는 listen이 0회여야 한다.
4. initialized 이후 B가 HTTP를 열어 `/health/live`, 503인 `/health/ready`, 인증된 운영 경로와 서명 검증 Webhook으로 상태를 관찰·복구할 수 있게 한다. E는 이후 Cloud 잔존 정리·공식 예산·저널 쓰기 상태를 확인한다. 완료 전 새 입장·grant·자동 시작은 0이며 복구 실패는 LOCKED로 남겨 관찰한다.
5. 조건이 충족되면 readiness만 READY로 바뀐다. admission은 DRAINING을 유지하고 운영 resume의 terminal 성공 후에만 OPEN이 된다. 첫 설치·재시작 모두 자동 OPEN하지 않는다. initialize를 다시 호출하여 복구 실패나 잠금을 초기화하지 않는다.

- E는 내부 Gateway·Journal·예산 큐를 소유한다. B가 주입하는 deps/config와 요청·trusted frame·비동기 결과는 아래 정확한 타입을 따른다. E 콜백은 B의 큐로만 들어가며 Tick 상태를 직접 변경하지 않는다.
- prepareGeneration은 expectedPreviousGeneration을 검사하고 E가 새 세대를 할당한다. 동일 requestId는 같은 논리 결과를 반환한다. Promise 결과는 HTTP 응답용이고 enqueueControl 결과는 게임 큐용이며 B는 requestId+scope로 중복 적용을 막는다. rejected/unknown이면 grant는 null이고, 세대 할당 전 rejected의 receiverGeneration은 null이다. ready는 grant 발급 완료이며 게시 확인 완료가 아니다. 요청 없이 생긴 MEDIA_FAILED는 eventId+scope로 중복 제거한다.
- media-bindings에는 자기 게시를 서버가 확인한 self 항목도 포함할 수 있다. 이때 publisherGeneration=receiverGeneration이다. B는 현재 scope의 self faceTrackSid 확인과 클라이언트 LOAD_READY를 모두 받아 로딩 장벽을 통과시킨다. D는 self 항목을 원격 얼굴/음성 attach 대상으로 사용하지 않는다. A의 self.loading은 null이며 B가 로딩 조정 상태를 덧붙인다.
- observeFrame은 게임의 권위 좌표·지형·현재 참가 상태만 받는다. E가 자신의 확인된 Identity/SID 레지스트리와 결합한다. 동기 호출 구간에 네트워크 대기·파일 쓰기·긴 계산을 넣지 않는다.
- 내부 6인 시험 예외(2026-09-11 승인): `MediaGrant.subscriptionMode=publisher-permissions`인 경우 `AudioPolicy.publisherPermissions`에 송신자의 전체 수신 대상 Identity·허용 트랙 SID를 전달한다. D는 현재 scope·bindingRevision을 검증하고 자기 게시 SID만 허용한다. 게시 전 차단, 새 정책 revision으로 1.5초 lease 갱신, 종료·연결 상실·lease 만료 시 빈 목록 적용이 필수다. E는 동일 내용이어도 새 권위 프레임에서 정책을 갱신한다. 정상 송신 앱을 전제로 하며 공개 운영의 서버 단독 권한 통과와 구분한다. 자세한 승인 경계는 [최신 결정](../spec/decisions.md)을 따른다.
- 서버는 `media-bindings`, `audio-policy` 채널로 전체 허용 목록을 전송한다. AudioPolicy의 scope·bindingRevision이 현재 바인딩과 맞아야 적용한다. 같거나 낮은 policyRevision은 중복/과거로 폐기한다. 비어 있는 최신 voices는 기존 음성을 즉시 닫는다.
- D는 트랙·바인딩·음향 정책을 각각 저장하고 **어느 입력이 바뀌어도 reconcile**한다. 알 수 없는 트랙은 화면/오디오에 붙이지 않는다. 보류는 최대 12개/2초, 넘으면 detach/구독 중지 및 bindings-refresh를 요청한다. 바인딩이 뒤늦게 오면 SDK에 이미 존재하는 publication도 다시 대조한다. nickname/metadata로 매핑을 추측하지 않는다.
- 바인딩 refresh는 B의 현재 검증 목록 재전송이며 임의 Cloud 조회 증폭을 허용하지 않는다. 수신자당 1초에 1회로 제한한다. 목록이 불명확하면 E의 공유 예산 대조 큐에 합쳐 신규 허용을 막는다.
- AudioPolicy가 바인딩보다 미래이면 최대 1개 최신 정책을 2초 보류한다. 과거 바인딩 정책은 폐기한다. 트랙 없이 온 정책은 최신 상태로 보관하고 트랙 도착 시 재대조한다. scope가 바뀌면 pending과 실제 그래프를 함께 비운다.
- 가청은 미허용 pair의 거리≤5에서 진입, 이미 허용된 pair의 거리>6에서 이탈한다. 시험은 **5→6→7→6→5**로 하며 이전 허용 상태를 함께 기록한다.
- 서버 Webhook은 track_published/track_unpublished/participant_joined/participant_left/participant_connection_aborted 등 실제 서버 이름을 쓴다. D의 RoomEvent와 B의 클라이언트 신고를 혼합하지 않는다. 서명 검증·역순/중복 처리, 누락 대비 대조는 공유 API 예산 안에서 실행한다.
- **새 SID 게시**는 기본 차단→확인→현재 정책 허용, **같은 SID replaceTrack**은 기존 권한·새 표식·불허 수신 유지, **전체 재연결**은 옛 Identity 회수·새 세대 격리로 각각 시험한다. 같은 SID 소스 교체에 새 Webhook이 반드시 온다고 가정하지 않는다.
- D가 video/track·장치를, C가 VideoTexture를 소유한다. onFaceTrack의 null은 기존 텍스처 해제 신호다. onLocalPreview는 장치 점검·연습·본경기 동안 유지하는 로컬 원본 미리보기이며 게시 트랙이 아니다. 같은 element를 상태 갱신마다 다시 부착하지 않으며 개인 종료·이탈 때 분리한다.

## 센서·입력 callback 수명

C만 `App.tsx`·`SessionRuntime.ts`·room store·`main.tsx`·화면과 CSS를 조립한다. D만 `InteractionRuntime`·제품 입력 listener·장치·video element·track 수명을 소유한다. C는 `onLocalPreview(element)`를 화면 host에 부착하고 null·교체·unmount 때 host 연결만 해제한다. srcObject·track.stop·D element의 미디어 정리는 D가 처리한다. C의 3D texture/geometry는 C가 정리한다. 하나의 제품 세션에는 D runtime 하나만 기동하며 기존 `bindTeamInput`/개발 input을 동시에 연결하지 않는다. React 반복 mount·원격 leave·페이지 비활성·연습→본경기에서 이 소유권을 시험한다.

한 SensorSnapshot의 emittedAtMs를 새 센서 관측으로 해석하지 않는다. 각 Sample은 실제 프레임의 sampledAtMs/frameId를 보존한다. 해당 모델을 실행하지 않은 발행에서는 Sample을 갱신하지 않는다. 미검출은 새 frameId의 missing/null이며, 세대 시작부터 아직 실행하지 않은 센서는 null이다.

- sampledAtMs/receivedAtMs/emittedAtMs는 브라우저 main performance 시간축이다. Worker는 main이 전달한 frameId·sampledAtMs를 그대로 돌려주고 main이 receivedAtMs를 붙인다. 서버 시계와 섞지 않는다.
- face/pose age>300ms, gesture age>400ms면 사용 불가다. C의 pose 유지 누적은 증가한 pose.frameId만 사용하고 유효 표본 사이 간격≤300ms여야 한다. 미검출·uncertain·만료·구 세대는 누적을 초기화한다.
- 두 손이 서로 다른 유효 제스처를 보이면 none이다. 같은 종류면 최고 score 한 개를 선택한다. 손별 후보 배열을 다른 모듈로 넘기지 않는다.
- D는 위치/좌우/유효성을 정규화하고 C는 탈출 포즈 임계값을 소유한다. sensorTuningVersion은 D, poseTuningVersion은 C가 검사 증거에 남긴다.
- startDevices는 중복 카메라 취득을 합치고 dispose 중 늦은 결과는 즉시 닫는다. callback 등록은 기동 전이다. 새 세대 시작 시 이전 onFaceTrack null·미디어 closed를 먼저 알리고 새 상태를 내보낸다. dispose 완료 뒤 callback은 발생하지 않는다.
- pageActive=false이면 입력·버퍼를 비우고 새 의도를 막는다. 복귀 때 새 키/중립 복귀를 요구하며 서버 phase를 꾸며내지 않는다.
- C가 장치/미디어·교환·출구 문맥을 setContext로 반영한다. D가 슬롯·입력 모드를 바꾸면 onInteractionState로 알리고 같은 값의 재적용은 callback을 반복하지 않는다.

## HTTP·WebSocket 진입 보안 — B

- 공통 Origin 검사는 SDK의 OPTIONS 응답과 `/matchmake/*` 실행보다 먼저 적용한다. Express의 `/api/config` 검사만으로 매칭 경로를 보호했다고 보지 않는다. 독립 request listener 하나가 403을 보낸 뒤 다른 SDK listener가 예약을 진행하지 않도록 실제 진입/dispatch 순서를 확인한다.
- HTTP/WS는 ALLOWED_ORIGINS의 정확한 http/https origin 목록을 공유한다. 목록의 Origin은 허용하고 비허용·문자열 null·빈 값·복수 Origin은 403으로 거절한다. Origin 헤더 자체가 없는 개발 CLI/health 및 서버 간 요청은 기존 정책대로 허용하되, 제품 세션/초대·OPS_TOKEN·Webhook 서명 검사를 대신하지 않는다.
- 거절한 POST/OPTIONS/WS는 방 생성·좌석 예약·세션 소비를 일으키지 않는다. CORS 허용 헤더만 바꾸고 매칭 실행은 진행시키지 않는다. 허용 OPTIONS는 예약 없이 끝내고 허용 웹/Playground 접속은 유지한다.
- 매칭 JSON은 2,048바이트로 제한한다. Content-Length 사전 검사와 실제 수신 바이트 상한을 함께 적용하여 길이 누락·chunked에서도 초과를 413으로 끝내고 JSON 파싱/예약을 진행하지 않는다. WebSocket은 기존 8,192바이트 한도를 유지한다. LiveKit raw-body 서명 경로를 JSON 재직렬화하거나 매칭 전용 본문 제한으로 일괄 변경하지 않는다.
- B의 필수 회귀 시험은 두 룸의 매칭 POST/OPTIONS, 일반 API, WS upgrade에 허용/비허용 Origin을 대입하고 응답과 처리 전후 방/예약 수를 함께 검사한다. 경계 2,048/2,049바이트·길이 없는 초과 본문·Origin 없는 개발 요청도 포함한다. 이 문서는 수정 계획이며 실제 bootstrap과 통합 시험을 구현·실행해야 보안 수정 완료다.

## 운영 HTTP 계약

2026-09-12 사용자 승인에 따라 상시 서비스는 명시적 `OPS_OPERATING_MODE=continuous`를 사용한다.
이 모드의 `publicWindow={mode:'continuous'}`에는 종료 날짜가 없고,
`officialBudgetMaxAgeMs=0`은 사용하지 않는 필드다. 기존 유효기간·공식 잔량 조건은
`attested` 시험 모드에 적용한다. 설정 파서 기본값은 기존 호환성을 위해 attested이며,
제품 배포 러너는 continuous를 기본 선택하고 매니페스트와 Compose에서 일치시킨다.
프로젝트·namespace·Cloud origin은 `service-operations.json`의 고정 운영 설정으로 검증하고,
실제 capability·인증·저널 무결성·단일 writer·회수·API/인원 제한은 계속 검사한다.
공식 잔량을 추정해 채우지 않는다. 공급자 할당량 정책을 사용할 때 운영 상태는
`operatingMode='continuous'`, remainingMinutes/remainingBytes/checkedAtEpochMs 모두 null이다.
로컬 예약은 기록 후 발급하고 실제 회수가 확인되어야 RELEASED가 된다.
checkpoint-budget는 이 모드에서 로컬 기록 flush와 쓰기 가능 여부를 확인하며 공식 대시보드
갱신을 요구하지 않는다. 사용량 파일이나 최초 설치·감사 marker를 삭제하여 재초기화하지 않는다.
상세 운영 절차와 기존 시험 정책의 적용 경계는 [상시 운영](../continuous-operations.md)을 따른다.

B는 중앙 `INVITATION_ROUTES`의 issue/revoke를 자기 session 모듈에서 구현한다. E의 `CreateOperatorAuth`로 생성한 인증 함수를 B가 `/api/operations` 전체와 초대 경로보다 앞에 적용한다. `OPS_TOKEN`은 인증 factory에만 주입하고 브라우저/protocol로 전달하지 않는다. F 운영 스크립트도 이 경로를 소비하며 별도 비인증 발급 CLI나 초대 endpoint를 만들지 않는다.

F는 `MediaConfiguration`의 projectAlias·publicWindow·officialBudgetMaxAgeMs·operationTimeoutMs를 실제 운영 입력에서 검증하고 B가 factory에 전달한다. publicWindow=null은 공개 창 미정으로 잠금이며 예시 창·예시 잔량을 실제 허용으로 쓰지 않는다. productSecurityReady는 환경의 임의 true가 아니라 B가 제품 인증·입장 보호 초기화를 확인해 주입하는 서버 내부 값이다. E는 이 값과 회수·저널·예산·창 조건을 함께 검사한다. operationTimeoutMs 이후에도 미완료 회수는 성공으로 바꾸지 않고 unknown/LOCKED와 작업 상태 조회에 남긴다. 정확한 env 매핑은 F의 시작 절차를 따르며 다른 담당은 F의 config export를 읽는다.

관측은 F가 소유하는 `MetricSample` 수집 callback을 B가 조립하여 B Tick/queue와 `MediaCoordinatorDeps.emitMetric`에 주입한다. F의 `MetricRegistry`가 name/unit allowlist를 정의하고 B/E는 같은 목록을 소비한다. atMs는 서버 monotonic ms이고 matchRef는 비식별 상관값이다. 토큰·nickname·원본 mediaIdentity·좌표·전체 객체를 label로 넣지 않는다. callback은 유계 큐에 수치/enum을 적재하며 게임 Tick이나 E 정책 실행에서 IO 대기·throw를 하지 않는다. 실제 관측 구현이 없으면 관측 인수를 완료로 기록하지 않는다.

B가 경로를 등록하고 E가 핸들러를, F가 secret 주입·배포 보호를 맡는다. 세션용 Bearer와 운영용 OPS_TOKEN을 혼용하지 않는다. 운영 명령은 실제 운영 작업을 승인받은 실행에서만 호출하며 문서 작성만으로 원격 실행하지 않는다.

B는 coordinator.getOperations()의 OperationsPort를 위임받아 submit/getSnapshot/getStatus를 각 경로에 연결한다. submit은 accepted+snapshot 또는 conflict를 즉시 반환하고 긴 작업은 E 내부 큐에서 처리한다. drain 접수 시 admission을 먼저 DRAINING으로 바꾼다. B는 입장 승인 직전에 getStatus().admission을 검사하며 await 뒤에도 재검사한다. E는 주입된 getGameActivity()의 진행 경기·연습·입장 수가 모두 0이고 회수가 확인되어야 drain을 succeeded로 바꾼다. 시간 초과는 failed로 종결하고 신규 입장 차단을 유지한다. E가 B의 Room registry를 직접 수정하거나 정의되지 않은 callback을 추가하지 않는다.

- GET /api/sessions/access: 해당 요청의 입장 방식만 SessionAccessResponse로 반환한다(no-store). GitLab 신원·토큰은 반환하지 않으며 이 응답은 후속 POST의 인증이 아니다.
- POST /api/sessions: SessionRequest → SessionResponse. 기본 invitation 모드는 유효한 inviteToken이 필수다. 명시적 SESSION_ADMISSION_MODE=gitlab-sso와 신뢰 프록시 설정을 함께 적용한 제품 서버만 호스트 SSO 검증 후 덮어쓴 X-SSO-User를 인정하여 inviteToken 없는 생성·방 코드 참가를 허용한다. 신원이 없으면 기존 초대 검사를 수행한다. 회원별 해시를 기존 inviteId 제한 버킷에 사용하며 IP·좌석·운영 잠금·예약 반환은 동일하다. 게임 신원은 서버가 발급하고 no-store·메모리 보관, fragment 초대는 읽은 뒤 주소에서 지운다. SessionResponse.expiresAt은 epoch ms이며 MediaGrant.expiresAt은 epoch 초다.
- DELETE /api/sessions/current: 자기 세션 Bearer만으로 미가입 RESERVED를 반환한다. 본문은 없거나 빈 객체이며 신원 지정은 400, Bearer 누락은 401, 활성 연결·JOINED·RETIRING은 409로 거절한다. 이미 취소·만료된 토큰은 204로 끝난다. 첫 연결 기한은 발급 후 60초이며 가입 후 활동 기반 lease와 구분한다. 상세 HTTP 계약은 docs/protocol.md를 따른다.
- POST /api/media/grants: Bearer 세션 + MediaGrantRequest → MediaGrant. 이전 회수/예산/phase 불충족은 409, 인증 오류 401/403, 공급자 불명 503으로 안전 code만 반환한다.
- POST /api/media/report: Bearer 세션 + MediaStatusReport → 204. 수신자 신원과 scope를 검사한다. 신고만으로 원격 회수·권한 성공을 확정하지 않는다.
- POST /api/livekit/webhook: raw body + 공급자 Authorization을 E가 검증하며 JSON 재직렬화·인증 생략을 하지 않는다.
- POST /api/operations/commands: OPS_TOKEN + OperationsCommand → 202 OperationSnapshot(pending). 같은 requestId/같은 본문은 같은 operationId, 다른 본문 재사용은 409다. retry-retirement에만 retirementId를 요구한다.
- GET /api/operations/commands/:requestId: OPS_TOKEN → 200 OperationSnapshot 또는 404. 완료 상태는 succeeded/failed이며 HTTP 202를 작업 성공으로 해석하지 않는다.
- GET /api/operations/status: OPS_TOKEN → OperationsStatus. remaining 값이 null이면 미확인이고 0으로 바꾸지 않는다.
- /health/live는 프로세스 생존, /health/ready는 회수·저널·예산·인증 준비의 conjunction이다. RECOVERING을 재시작 루프로 우회하지 않는다.
- admission과 readiness는 독립이다. 정상 drain은 admission만 DRAINING으로 바꾸고 건강한 readiness는 READY를 유지한다. 새 입장/grant는 readiness=READY이고 admission=OPEN일 때만 허용한다. resume은 READY를 확인한 뒤 OPEN으로 전환한다. 실제 저널·보안·예산 장애는 readiness를 LOCKED로 만든다.
- checkpoint-budget는 `OPS_DATA_DIR/official-usage-input.json`의 OfficialBudgetCheckpoint를 읽어 검증한다. F가 실제 Cloud 사용량 보고서의 조회 시각·잔량·근거를 넣고 E가 신선도·비음수·같은 프로젝트 여부를 검사한다. 예시 잔량이나 클라이언트 신고를 공식 증거로 쓰지 않는다.

## 격리 상태의 배포 검증 — B/E/F

외부 공개 여부는 F의 네트워크/프록시 접근 경계이고 admission은 E의 게임 입장 상태다. 서로 다른 두 조건을 하나의 boolean으로 합치지 않는다. 외부 접근 차단은 진행 중 게임의 정상 종료·회수를 방해하지 않도록 기존 연결과 인증된 운영/검증 경로를 유지하면서 일반 이용자의 새 접속을 차단한다.

1. F가 외부 일반 참가자는 새 HTTP 세션·매칭·WS 접속을 못 하고 지정 검증 참가자 6명과 운영자만 접근 가능한 격리를 확인한다. 모든 앱 진입 경로에 적용하고 이름뿐인 smoke 플래그나 클라이언트 claim으로 우회하지 않는다. 격리 수단/검증 참가자/공식 예산·검증 시간 창이 준비되지 않으면 BLOCKED다.
2. OPS drain의 terminal succeeded와 진행 경기/연습/입장 대기 0, 회수·저널 반영 및 미해결 0을 확인한 뒤 같은 검증 SHA/digest로 교체한다. 격리는 재시작·롤백 동안 유지한다.
3. B/E의 initialize→HTTP 관찰→RECOVERING 정리→READY를 확인한다. 이때 admission은 여전히 DRAINING이다. READY만 보고 공개하거나 자동 입장시키지 않는다.
4. 격리를 다시 확인한 후 승인된 검증 시간 창/실제 잔량 조건으로 resume을 요청하고 terminal succeeded 및 READY/OPEN을 확인한다. 일반 이용자는 계속 차단된 상태에서 검증 참가자만 입장하여 6인 smoke를 수행한다. DRAINING에서 입장하는 시험용 예외 API는 만들지 않는다.
5. 시험 성공 후 검증 참가자 퇴장, 진행 활동 0, 시험 미디어 회수·저널 반영·미해결 0을 확인한다. 공개 시간 창·잔량·READY/OPEN을 다시 검사하고 F가 외부 격리를 해제한다. 격리 해제 전에 하나라도 실패하면 공개하지 않는다.
6. smoke 실패나 resume 이후 실패에는 격리를 유지한 채 별도 requestId로 다시 drain하고 회수·활동 0을 확인한 뒤 이전 digest로 복귀한다. 회수가 불명확하면 이미지를 교체하여 미해결 상태를 숨기지 않고 ROLLBACK_BLOCKED로 남긴다. 롤백 후에도 같은 초기화·복구·격리 시험 순서를 통과해야 공개할 수 있다.

F의 기존 DP-03이 격리 수단과 검증 접근을 준비하고 DP-06이 배포 순서를 구현하며 QA-13이 인계 증거를 확인한다. Jenkins·nginx·배포 스크립트의 실제 구현과 원격 적용은 F 작업이다. 공통 문서와 fixture의 순서 검사만으로 해당 구현·원격 시험을 완료 처리하지 않는다.

## 작업 상태·커밋·MR·인계

실행 상태는 PLANNED → CONTRACT_READY → LOCAL_VERIFIED → INTEGRATED → ACCEPTED로 기록한다. 외부 전제 부재는 BLOCKED, 미정 콘텐츠는 PRODUCT_DECISION_PENDING이다. 이 상태는 문서/로컬 진행 기록이며 Jira 상태를 자동 변경하지 않는다.

진행 기록에는 `localStage`와 `blockedOn`을 분리한다. 예를 들어 단위 시험이 통과했지만 Cloud가 없는 작업은 `localStage: LOCAL_VERIFIED`, `blockedOn: [실제 Cloud 권한·예산]`, 최종 상태 `BLOCKED`로 기록한다. 차단되었다고 검증한 단계까지 없애거나, 단위 통과를 ACCEPTED로 올리지 않는다. 결정 대기 6개는 localStage 없이 PRODUCT_DECISION_PENDING을 유지한다.

공유 인계는 추적되는 `docs/execution/handoffs/A.md`부터 `F.md`까지 **자기 파일 하나**에 작성한다. 작업 ID·단계·실제 export 경로와 signature·적용 commit·실행한 명령과 결과·필요한 소비자 확인·blockedOn·다음 요청을 기록한다. 자신의 구현 commit을 만든 뒤 그 SHA를 인계 문서에 적어 별도 인계 commit으로 남길 수 있다. 아직 존재하지 않는 미래 SHA나 실행하지 않은 성공 기록을 넣지 않는다. 소비자는 다른 역할의 전체 계획 대신 이 공개 인계와 실제 코드를 확인한다. `.local/` 기록은 개인 재개용이며 다른 팀원이 자동으로 읽을 수 있다고 가정하지 않는다. 원격 인계는 담당자의 push/MR 병합 후에야 도착한 것으로 처리한다.

1. 계약/fixture 또는 단위 구현이 검증되면 **중간 커밋을 허용한다.** 작업 ID·이번 단계·실제 검증·미통합 조건을 커밋/MR에 적는다. 깨진 빌드·빈 성공 stub을 인계하지 않는다.
2. 담당의 완료 조건과 실제 생산자·소비자 연결, 필요한 Cloud/장치 증거가 있어야 ACCEPTED다. 중간 커밋/합병을 기능 완료로 세지 않는다. 완료마다 최종 변경 커밋을 남기되 같은 결과를 중복 커밋하지 않는다.
3. git status/name/email을 확인하고 실제 담당자 신원을 유지한다. 타인 --author·신원 변경·AI 공동 저자·기존 커밋 재작성은 하지 않는다. 신원 누락 시 구현은 진행하되 커밋만 보류한다.
4. 실제 Jira가 있으면 정상 브랜치 형식을 사용한다. 없으면 담당/일차 feat/mvp-a-d1(F는 ci/mvp-f-d1)처럼 쓰고 가짜 키를 만들지 않는다. 기존 담당 브랜치와 다른 미커밋 변경을 먼저 확인한다.
5. 해당 파일만 명시적으로 stage하고 diff를 확인한다. 제목은 scope 없는 type: 변경 내용, Jira 키는 실제 키만 마지막 문단에 단독 줄로 넣는다. Refs:와 AI 공동 저자는 넣지 않는다. 한글 메시지는 UTF-8 파일과 git commit -F로 전달한다.
6. .local/execution/<담당>.json에 ID/단계/검증/commit/선행 통합/결정 대기를 기록한다. .local/mr/<담당>/<ID>.md와 <일차>-combined.md에 아래 다섯 항목의 완성된 MR 본문을 작성하고 파일 링크와 전체 본문을 담당자에게 제공한다.
7. 중간 인계 시점마다 담당자가 직접 push·MR 생성·리뷰·병합한다. AI가 원격 작업을 대신하지 않는다. 이후 선행 코드를 반영해 연결 시험을 수행한다.

```markdown
## 관련 Jira

실제 키 또는 미등록 사유, 담당 고정 번호와 원본 ID

## 변경 사항

실제 변경 동작·파일·commit SHA, CONTRACT_READY/LOCAL_VERIFIED/INTEGRATED/ACCEPTED 단계

## 변경 이유

이전 동작의 문제와 이번 단계에서 가능해진 동작

## 리뷰 포인트

공개 타입·실패 처리·수명·정보 은폐, 필요한 생산자/소비자 확인, 선행 반영 상태

## see also

기획 장·최신 결정·계약 버전·실제 검사 결과·미검증/결정 대기 항목
```

## 타입·fixture와 필수 연결 시험

아래 타입은 [검사 가능한 원본](contracts/types.ts)에서 자동 삽입한다. [fixture](contracts/fixtures.ts)는 정상/실패·순서 교차 입력과 기대 상태를 제공하고 [검사](contracts/fixtures.test.ts)는 계약 자료의 정합성을 확인한다. 제품 타입·serializer·reducer·Room·Coordinator 구현과 실제 연결은 각 담당 작업에서 수행한다. 문서용 타입을 제품 런타임 의존성으로 import하지 않는다. 필요한 공개 타입은 해당 소유 모듈에 옮기고 원본과 소비자 호환을 검사한다.

필수 계약 연결 사례: accepted 후 core 거절, 요청 중 매치 종료/중복/조회, 영역별 맵 입력과 다른 출처 fallback 거절, 같은 match의 연습→none→본경기와 구 scope 지연 데이터 폐기, initialize 완료/READY/OPEN 분리와 fatal 기동 차단, 격리 유지 resume→6인 시험→회수→공개 및 실패 rollback, 한 명만 미디어 세대 교체, 트랙/바인딩 양쪽 순서와 오디오 세 입력 순열, 같은 SID/새 SID 구분, 얼굴만 새 결과와 오래된 pose, 양손 충돌, 요청자/수락자 다른 UI, READY false 취소, 비소유자 가시 sensor.wall, 관찰 출구 표시/폐쇄, 5→6→7 음성 차단, 매칭 Origin 거절 뒤 예약 0. F가 실제 모듈을 연결하되 생산자와 소비자가 자기 계약 시험을 먼저 제공한다.

<!-- BEGIN CONTRACT-TYPES -->

```ts
// EXEC-CONTRACT-3. Planning contracts; product modules do not exist merely because these types do.
export const CONTRACT_VERSION = 'EXEC-CONTRACT-3' as const;
export const SCOPE_VERSION = 'D-2026-09-08-01' as const;
export type Cell = Readonly<{ x: number; y: number }>;
export type TracePoint = Readonly<{ x: number; y: number }>;
export type Dir = 0 | 1 | 2 | 3;
export type WallFace = Cell & Readonly<{ side: Dir }>;
export type Role = 'runner' | 'tagger';
export type SessionRequest = Readonly<{ nickname: string; inviteToken?: string }> &
  ({ createRoom: true; roomCode?: never } | { createRoom: false; roomCode: string });
export const SESSION_ACCESS_ROUTE = '/api/sessions/access' as const;
export type SessionAccessResponse = Readonly<{ method: 'invitation' | 'gitlab-sso' }>;
export type SessionResponse = Readonly<{
  sessionToken: string;
  playerId: string;
  roomCode: string;
  expiresAt: number;
  protocolVersion: '0.2.0';
}>;
// Owner-only cancellation before the first game connection; no identity in the body.
export const SESSION_CANCEL_ROUTE = '/api/sessions/current' as const;
export type SessionCancelErrorCode = 'INVALID_REQUEST' | 'INVALID_SESSION' | 'SESSION_IN_USE';
// Server/operator-only. These endpoints do not accept a player's session Bearer token.
export const INVITATION_ROUTES = {
  issue: '/api/operations/invitations',
  revoke: '/api/operations/invitations/:inviteId/revoke',
} as const;
export type InvitationScope = Readonly<{
  allowCreate: boolean;
  roomCodes: readonly string[];
}>;
export type IssueInvitation = Readonly<{ scope: InvitationScope; expiresAt: number }>;
export type IssuedInvitation = IssueInvitation &
  Readonly<{ inviteId: string; inviteToken: string }>;
export type InvitationDenialCode = 'INVALID_INVITATION' | 'NOT_READY' | 'OUTSIDE_PUBLIC_WINDOW';
export type InvitationIssueResult =
  | Readonly<{ status: 'issued'; invitation: IssuedInvitation }>
  | Readonly<{ status: 'rejected'; code: InvitationDenialCode }>;
export type InvitationCheck = Readonly<{ inviteToken: string }> &
  ({ createRoom: true; roomCode?: never } | { createRoom: false; roomCode: string });
export interface InvitationPort {
  issue(input: IssueInvitation): InvitationIssueResult;
  revoke(inviteId: string): void;
  verify(input: InvitationCheck): Readonly<{ inviteId: string }> | null;
  bindCreatedRoom(inviteId: string, roomCode: string): void;
}
export type PlayerStatus = 'ACTIVE' | 'ESCAPED' | 'CAPTURED';
export type Phase =
  | 'LOBBY'
  | 'DEVICE_CHECK'
  | 'TEAM_PRACTICE'
  | 'MAP_FINALIZING'
  | 'GAME_LOADING'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'RESULT'
  | 'ABORTED';
export type EquipmentKind = 'sensor' | 'trap';
export type PoseKind = 'left' | 'right' | 'y';
export type Action = Readonly<{
  kind: 'move' | 'turn';
  from: Cell & { dir: Dir };
  to: Cell & { dir: Dir };
  startTick: number;
  endTick: number;
}>;
export type CommandCode =
  | 'INVALID_COMMAND'
  | 'PROTOCOL_MISMATCH'
  | 'WRONG_MATCH'
  | 'RATE_LIMITED'
  | 'INVALID_PHASE'
  | 'NOT_ACTIVE'
  | 'NOT_ALLOWED'
  | 'EXPIRED'
  | 'STALE_REQUEST'
  | 'NOT_READY'
  | 'QUEUE_FULL'
  | 'ROUND_ENDED'
  | 'CANCELED';
export type CommandPayloads = {
  MOVE_INTENT: { direction: 'forward' | 'back' | null };
  TURN: { direction: 'left' | 'right' };
  READY: { ready: boolean };
  PRACTICE_READY: { ready: boolean };
  LOAD_READY: { loadId: string; mediaInstanceId: string; receiverGeneration: number };
  EXCHANGE_REQUEST: { targetPlayerId: string };
  EXCHANGE_ACCEPT: { exchangeId: string };
  EXCHANGE_CANCEL: { exchangeId: string };
  INSTALL: { kind: EquipmentKind };
  INSTALL_CANCEL: { installationId: string };
  EXIT_START: { exitId: string };
  EXIT_CANCEL: { challengeId: string };
  EXIT_PROGRESS: { challengeId: string; method: 'pose' | 'keys'; completed: boolean };
  REMATCH: { mode: 'same' | 'swap' | 'lobby' };
};
export type CommandType = keyof CommandPayloads;
export type CommandEnvelope<K extends CommandType = CommandType> = {
  [T in K]: Readonly<{
    matchId: string;
    requestId: string;
    sequence: number;
    type: T;
    payload: CommandPayloads[T];
  }>;
}[K];
export type CommandReceipt = Readonly<{
  matchId: string;
  requestId: string;
  sequence: number;
  stateVersion: number;
}> &
  ({ status: 'accepted'; code: null } | { status: 'rejected'; code: CommandCode });
export type OutcomeResult =
  { result: 'applied'; code: null } | { result: 'rejected' | 'canceled'; code: CommandCode };
export type CommandOutcome = Readonly<{
  matchId: string;
  requestId: string;
  sequence: number;
  tick: number;
  stateVersion: number;
}> &
  OutcomeResult;
export type RequestStatus = Readonly<{ matchId: string; requestId: string }>;
export type RequestStatusResult = RequestStatus &
  ({ status: 'done'; outcome: CommandOutcome } | { status: 'pending' | 'unknown'; outcome: null });
export type ExchangeView = Readonly<{
  exchangeId: string;
  fromPlayerId: string;
  toPlayerId: string;
  direction: 'incoming' | 'outgoing';
  expiresAtTick: number;
}>;
export type InstallationView = Readonly<{
  installationId: string;
  kind: EquipmentKind;
  startTick: number;
  endTick: number;
  armedTick: number;
}>;
export type ChallengeView = Readonly<{
  challengeId: string;
  exitId: string;
  poseKind: PoseKind;
  startedAtTick: number;
  minSuccessTick: number;
  expiresAtTick: number;
}>;
export type LoadingView = Readonly<{
  loadId: string;
  initialViewVersion: number;
  mediaInstanceId: string;
  receiverGeneration: number;
  assetVersion: string;
}>;
export type OwnedEquipment = Readonly<{
  equipmentId: string;
  state: 'UNARMED' | 'ARMED' | 'SPENT';
  armedTick: number;
}> &
  ({ kind: 'sensor'; cell: Cell; wall: WallFace } | { kind: 'trap'; cell: Cell });
export type ActiveSelf = Readonly<{
  playerId: string;
  role: Role;
  status: 'ACTIVE';
  cell: Cell;
  dir: Dir;
  action: Action | null;
  equipment: { sensor: number; trap: number };
  ownedEquipment: readonly OwnedEquipment[];
  restraintUntilTick: number | null;
  restraintImmuneUntilTick: number | null;
  installation: InstallationView | null;
  exchange: ExchangeView | null;
  challenge: ChallengeView | null;
  loading: LoadingView | null;
}>;
export type EndedSelf = Readonly<{ playerId: string; role: Role; status: 'ESCAPED' | 'CAPTURED' }>;
export type VisibleEntity =
  | Readonly<{
      id: string;
      kind: 'player';
      cell: Cell;
      dir: Dir;
      action: Action | null;
      role?: Role;
    }>
  | Readonly<{ id: string; kind: 'sensor'; cell: Cell; wall: WallFace; state: 'UNARMED' | 'ARMED' }>
  | Readonly<{ id: string; kind: 'trap'; cell: Cell; state: 'UNARMED' | 'ARMED' }>;
export type KnownTerrain =
  Readonly<Cell & { kind: 'floor' }> | Readonly<WallFace & { kind: 'wall' }>;
export type KnownExit = Readonly<{
  exitId: string;
  ownerId: string;
  wall: WallFace;
  approach: Cell;
}>;
export type PlayerKnowledge = Readonly<{
  mapVersion: number;
  knownTerrain: readonly KnownTerrain[];
  knownActiveExits: readonly KnownExit[];
}>;
export type ActiveGameScope = Readonly<{
  gameInstanceId: string;
  kind: 'practice' | 'game';
  revision: number;
}>;
export type GameViewScope =
  ActiveGameScope | Readonly<{ gameInstanceId: null; kind: 'none'; revision: number }>;
export type PrivateView = PlayerKnowledge &
  Readonly<{
    matchId: string;
    gameScope: GameViewScope;
    stateVersion: number;
    self: ActiveSelf | EndedSelf | null;
    visibleCells: readonly Cell[];
    visibleWallFaces: readonly WallFace[];
    visibleEntities: readonly VisibleEntity[];
  }>;
export type Counts = Readonly<{ escaped: number; captured: number }>;
export type RoundResult = Readonly<{
  winner: 'runners' | 'taggers';
  reason: 'two-escaped' | 'two-captured' | 'timeout';
}>;
export type AbortReason =
  'GAME_CONNECTION_LOST' | 'SERVER_TICK_OVERLOAD' | 'MEDIA_POLICY_UNCERTAIN' | 'MEDIA_UNAVAILABLE';
export type PublicRoundState = Readonly<{
  phase: Phase;
  matchId: string;
  stateVersion: number;
  serverTick: number;
  startTick: number | null;
  startAt: number | null;
  deadlineTick: number | null;
  counts: Counts;
  result: RoundResult | null;
  abortReason: AbortReason | null;
  /** D-2026-09-13-01: waiting/result room warning, present only in the last 60 seconds. */
  roomExpiresInSeconds?: number;
}>;
export const ROOM_EXPIRED_CLOSE_CODE = 4001;
export type RoomRoster = Readonly<{
  matchId: string;
  stateVersion: number;
  phase: Phase;
  hostId: string;
  players: readonly { playerId: string; nickname: string; ready: boolean; connected: boolean }[];
}>;
export type EventPayloads = {
  EXCHANGE_OFFER: { exchangeId: string; fromPlayerId: string; expiresAtTick: number };
  EXCHANGE_CANCELED: { exchangeId: string; reason: CommandCode };
  EXCHANGE_COMPLETED: { exchangeId: string; mapVersion: number };
  HUNTER_MARKER: {
    markerId: string;
    kind: 'exchange' | 'sensor' | 'trap';
    point: TracePoint;
    occurredTick: number;
    showAtTick: number;
    expiresTick: number;
  };
  EXIT_CHALLENGE: ChallengeView;
  EXIT_CHALLENGE_ENDED: {
    challengeId: string;
    result: 'canceled' | 'failed' | 'escaped';
    reason: CommandCode | null;
  };
};
export type EventType = keyof EventPayloads;
export type PrivateEvent = {
  [K in EventType]: Readonly<{
    matchId: string;
    gameScope: ActiveGameScope;
    eventId: string;
    tick: number;
    stateVersion: number;
    type: K;
    payload: EventPayloads[K];
  }>;
}[EventType];
export type GameHeartbeat = Readonly<{
  serverEpoch: string;
  matchId: string;
  heartbeatSeq: number;
  serverTick: number;
  serverTimeMs: number;
}>;
export type HeartbeatAck = Readonly<{ serverEpoch: string; matchId: string; heartbeatSeq: number }>;
export type ClockProbe = Readonly<{ probeId: string; clientSentAtMs: number }>;
export type ClockReply = ClockProbe &
  Readonly<{ serverReceivedAtMs: number; serverSentAtMs: number; serverEpoch: string }>;
export type ViewResync = Readonly<{ matchId: string; lastStateVersion: number }>;
export type CoreCommandType = Exclude<
  CommandType,
  'READY' | 'PRACTICE_READY' | 'LOAD_READY' | 'REMATCH'
>;
export type CoreCommand = CommandEnvelope<CoreCommandType> & Readonly<{ actorId: string }>;
export type ControlIntent =
  | Readonly<{ type: 'EXPIRE_MOVE'; playerId: string; sequence: number }>
  | Readonly<{ type: 'CONNECTION_LOST'; playerId: string }>
  | Readonly<{ type: 'ABORT_MATCH'; reason: AbortReason }>
  | Readonly<{ type: 'START_PLAYING'; startTick: number }>;
export type CoreOutcome = Omit<CommandOutcome, 'stateVersion' | 'result' | 'code'> &
  OutcomeResult &
  Readonly<{ actorId: string }>;
export type DomainEvent =
  | {
      [K in EventType]: Readonly<{
        eventId: string;
        tick: number;
        audience: readonly string[];
        type: K;
        payload: EventPayloads[K];
      }>;
    }[EventType]
  | Readonly<{ type: 'SPATIAL_SOUND'; sound: SpatialSoundEvent }>;
export type MediaIntent =
  | Readonly<{
      type: 'RETIRE_PLAYER';
      playerId: string;
      reason: 'personal-ended' | 'connection-lost';
    }>
  | Readonly<{ type: 'RETIRE_INSTANCE'; reason: 'phase-change' | 'round-ended' | 'aborted' }>;
export type StepResult<State> = Readonly<{
  state: State;
  outcomes: readonly CoreOutcome[];
  events: readonly DomainEvent[];
  mediaIntents: readonly MediaIntent[];
}>;
export type Topology = Readonly<{
  topologyVersion: string;
  width: number;
  height: number;
  walkable: readonly boolean[];
}>;
export type MatchLayout = Readonly<{
  layoutId: string;
  topology: Topology;
  players: readonly { playerId: string; role: Role; cell: Cell; dir: Dir }[];
  exits: readonly (KnownExit & { poseKind: PoseKind })[];
  territories: readonly { playerId: string; cells: readonly Cell[] }[];
}>;
export type MatchTuning = Readonly<{
  tuningVersion: string;
  tickMs: 50;
  moveTicks: 9;
  turnTicks: 6;
  roundTicks: 3600;
  installationTicks: 10;
  armTicks: 20;
  restraintTicks: 30;
  restraintImmunityTicks: 40;
  exchangeExpiryTicks: 40;
  exitMinimumTicks: 40;
  exitExpiryTicks: 160;
  exitRetryTicks: 10;
}>;
export type CreateMatchInput = Readonly<{
  matchId: string;
  gameInstanceId: string;
  seed: number;
  tuning: MatchTuning;
  layout: MatchLayout;
  players: readonly { playerId: string; role: Role }[];
}>;
export type CreatePracticeInput = CreateMatchInput & Readonly<{ role: Role }>;
export type GameSubject = Readonly<{
  playerId: string;
  role: Role;
  status: PlayerStatus;
  cell: Cell;
  dir: Dir;
  action: Action | null;
}>;
export type CoreReadFrame = Readonly<{
  matchId: string;
  gameInstanceId: string;
  tick: number;
  phase: Phase;
  counts: Counts;
  result: RoundResult | null;
  abortReason: AbortReason | null;
  participants: readonly GameSubject[];
}>;
export interface CorePort<State> {
  createMatch(input: CreateMatchInput): State;
  createPractice(input: CreatePracticeInput): State;
  stepMatch(
    state: State,
    input: { tick: number; commands: readonly CoreCommand[]; controls: readonly ControlIntent[] },
  ): StepResult<State>;
  getPlayerKnowledge(state: State, playerId: string): PlayerKnowledge;
  getVisibleEntities(state: State, playerId: string): readonly VisibleEntity[];
  getPlayerSelf(state: State, playerId: string): ActiveSelf | EndedSelf | null;
  getVisibleSurfaces(
    state: State,
    playerId: string,
  ): { visibleCells: readonly Cell[]; visibleWallFaces: readonly WallFace[] };
  getFrame(state: State): CoreReadFrame;
}
export type SelectionProgress = Readonly<{ attempted: number; batchAttempts: number }>;
export type LayoutSelectionResult =
  | Readonly<{ status: 'selected'; layout: MatchLayout; source: 'online' | 'fallback' }>
  | Readonly<{ status: 'unavailable'; code: 'LAYOUT_UNAVAILABLE' }>;
export type MapSource = Readonly<{
  templateId: string;
  templateVersion: string;
  templateHash: string;
  variantId: string;
}>;
export type SpawnRegion = Readonly<{
  regionId: string;
  cells: readonly Cell[];
  spawnCandidates: readonly Cell[];
}>;
export type LayoutTemplate = MapSource &
  Readonly<{
    topology: Topology;
    taggerRegions: readonly [SpawnRegion, SpawnRegion, SpawnRegion];
    runnerSpawnRegions: readonly [SpawnRegion, SpawnRegion, SpawnRegion];
    exitCandidates: readonly WallFace[];
  }>;
export type MapPreparationFailure = Readonly<{
  status: 'invalid';
  code: 'INVALID_MAP_SOURCE' | 'INVALID_TEMPLATE';
  path: readonly (string | number)[];
}>;
export type MapTemplateResult =
  Readonly<{ status: 'valid'; template: LayoutTemplate }> | MapPreparationFailure;
export type MapVariantsResult =
  Readonly<{ status: 'valid'; variants: readonly LayoutTemplate[] }> | MapPreparationFailure;
export interface MapPreparationPort {
  validateTemplate(raw: unknown, source: MapSource): MapTemplateResult;
  createTemplateVariants(template: LayoutTemplate): MapVariantsResult;
}
// Fixed, isolated practice layouts use role slots, never real session IDs in JSON.
export type PracticeLayoutTemplate = Readonly<{
  practiceVersion: string;
  layouts: Readonly<Record<Role, MatchLayout>>;
}>;
export type PracticeLayoutResult =
  | Readonly<{ status: 'ready'; layout: MatchLayout }>
  | Readonly<{
      status: 'invalid';
      code: 'INVALID_PRACTICE_LAYOUT';
      path: readonly (string | number)[];
    }>;
export interface PracticeLayoutPort {
  preparePracticeLayout(
    raw: unknown,
    players: readonly { playerId: string; role: Role }[],
    role: Role,
  ): PracticeLayoutResult;
}
// Stored layout IDs are tagger-1..3/runner-1..3 slots. certifyFallback binds all
// player/exit/territory references to role-sorted input.players before validation.
export type FallbackLayout = MapSource & Readonly<{ layout: MatchLayout }>;
export type LayoutSelectionInput = Readonly<{
  template: LayoutTemplate;
  players: readonly { playerId: string; role: Role }[];
  seed: number;
  maxAttempts: number;
  fallback: FallbackLayout;
}>;
export interface LayoutSelectionPort {
  certifyFallback(input: LayoutSelectionInput): LayoutSelectionResult;
  selectWithFallback(
    input: LayoutSelectionInput,
  ): Generator<SelectionProgress, LayoutSelectionResult, void>;
}
export type MediaScope = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  receiverGeneration: number;
}>;
export type MediaBinding = Readonly<{
  playerId: string;
  publisherGeneration: number;
  mediaIdentity: string;
  participantSid: string;
  faceTrackSid?: string;
  audioTrackSid?: string;
}>;
export type MediaBindings = MediaScope &
  Readonly<{ bindingRevision: number; participants: readonly MediaBinding[] }>;
export type AudioPolicy = MediaScope &
  Readonly<{
    publisherPermissions?: readonly Readonly<{
      participantIdentity: string;
      allowedTrackSids: readonly string[];
    }>[];
    policyRevision: number;
    bindingRevision: number;
    stateVersion: number;
    voices: readonly {
      playerId: string;
      trackSid: string;
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
    }[];
    effects: readonly {
      eventId: string;
      kind: 'footstep' | 'sensor' | 'trap';
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
      tick: number;
    }[];
  }>;
export type MediaGrant = MediaScope &
  Readonly<{
    subscriptionMode?: 'publisher-permissions';
    url: string;
    token: string;
    roomName: string;
    mediaIdentity: string;
    expiresAt: number;
  }>;
export type MediaGrantRequest = Readonly<{
  matchId: string;
  purpose: 'practice' | 'game';
  previousReceiverGeneration?: number;
}>;
export type MediaStatusReport = MediaScope &
  Readonly<{ status: 'ready' | 'recovering' | 'failed' | 'closed' }>;
export type MediaRefreshRequest = MediaScope & Readonly<{ lastBindingRevision: number }>;
export type MediaFailureCode =
  | 'NOT_READY'
  | 'WRONG_SCOPE'
  | 'BUDGET_EXHAUSTED'
  | 'RETIREMENT_UNCONFIRMED'
  | 'POLICY_UNKNOWN'
  | 'REMOTE_UNAVAILABLE'
  | 'STALE_GENERATION'
  | 'TIMEOUT';
export type PrepareGenerationRequest = Readonly<{
  requestId: string;
  matchId: string;
  playerId: string;
  mediaInstanceId: string;
  purpose: 'practice' | 'game';
  expectedPreviousGeneration: number | null;
}>;
export type PreparationResult = Readonly<{
  requestId: string;
  matchId: string;
  playerId: string;
  mediaInstanceId: string;
}> &
  (
    | { status: 'ready'; receiverGeneration: number; grant: MediaGrant; code: null }
    | { status: 'unknown'; receiverGeneration: number; grant: null; code: MediaFailureCode }
    | { status: 'rejected'; receiverGeneration: number | null; grant: null; code: MediaFailureCode }
  );
export type RetireGenerationRequest = MediaScope &
  Readonly<{
    requestId: string;
    playerId: string;
    reason:
      | 'phase-change'
      | 'personal-ended'
      | 'connection-lost'
      | 'policy-unknown'
      | 'round-ended'
      | 'reconnect'
      | 'shutdown';
  }>;
export type RetirementResult = RetireGenerationRequest &
  ({ status: 'confirmed'; code: null } | { status: 'unknown'; code: MediaFailureCode });
export type TrustedMediaFrame = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  instancePurpose: 'practice' | 'game';
  frameRevision: number;
  tick: number;
  phase: Phase;
  topology: Topology;
  participants: readonly GameSubject[];
  events: readonly SpatialSoundEvent[];
}>;
export type SpatialSoundEvent = Readonly<{
  eventId: string;
  tick: number;
  kind: 'footstep' | 'sensor' | 'trap';
  cell: Cell;
  sourcePlayerId?: string;
}>;
export type MediaControl =
  | Readonly<{ type: 'MEDIA_PREPARED'; result: PreparationResult }>
  | Readonly<{ type: 'MEDIA_RETIRED'; result: RetirementResult }>
  | Readonly<
      MediaScope & {
        type: 'MEDIA_FAILED';
        eventId: string;
        playerId: string;
        code: MediaFailureCode;
      }
    >;
export type Readiness = Readonly<{
  state: 'READY' | 'RECOVERING' | 'LOCKED';
  reasonCodes: readonly string[];
  historyComplete: boolean;
  unresolvedCount: number;
}>;
export type MediaInitializationResult =
  | Readonly<{
      status: 'initialized';
      readiness: Readiness & Readonly<{ state: 'RECOVERING' | 'LOCKED' }>;
      admission: 'DRAINING';
    }>
  | Readonly<{ status: 'fatal'; code: 'WRITER_CONFLICT' | 'INITIALIZATION_FAILED' }>;
export interface MediaCoordinator {
  initialize(): Promise<MediaInitializationResult>;
  prepareGeneration(input: PrepareGenerationRequest): Promise<PreparationResult>;
  observeFrame(frame: TrustedMediaFrame): void;
  retireGeneration(input: RetireGenerationRequest): Promise<RetirementResult>;
  handleWebhook(
    rawBody: string,
    authorization: string,
  ): Promise<{ status: 'accepted' | 'ignored' }>;
  getReadiness(): Readiness;
  getOperations(): OperationsPort;
  close(): Promise<void>;
}
export type MediaCoordinatorDeps = Readonly<{
  config: MediaConfiguration;
  emitMetric: (sample: MetricSample) => void;
  enqueueControl: (control: MediaControl) => void;
  enqueueBindings: (playerId: string, message: MediaBindings) => void;
  enqueueAudioPolicy: (playerId: string, message: AudioPolicy) => void;
  monotonicNow: () => number;
  epochNowSeconds: () => number;
  getGameActivity: () => Readonly<{
    activeMatches: number;
    activePractices: number;
    pendingAdmissions: number;
  }>;
}>;
export type MediaConfiguration = Readonly<{
  operatingMode?: 'attested' | 'continuous';
  httpUrl: string;
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
  namespace: string;
  opsDataDir: string;
  projectAlias: string;
  publicWindow:
    | Readonly<{ opensAtEpochMs: number; closesAtEpochMs: number }>
    | Readonly<{ mode: 'continuous' }>
    | null;
  officialBudgetMaxAgeMs: number;
  operationTimeoutMs: number;
  productSecurityReady: boolean;
  initialBudget: {
    remainingMinutes: number;
    remainingBytes: number;
    checkedAtEpochMs: number;
  } | null;
  maxConcurrentParticipants: number;
  maxNormalApiCallsPer60s: number;
  maxTotalApiCallsPer60s: number;
}>;
export type CreateMediaCoordinator = (deps: MediaCoordinatorDeps) => MediaCoordinator;
export type MetricSample = Readonly<{
  name: string;
  value: number;
  unit: 'count' | 'ms' | 'bytes' | 'ratio';
  atMs: number;
  matchRef?: string;
  generation?: number;
  requestId?: string;
}>;
// E implements the authentication factory; B mounts it before every operator route.
// This is server-internal configuration, never a client-authorized claim.
export type CreateOperatorAuth = (token: string) => (authorization: string | undefined) => boolean;
export type NormalizedLandmark = Readonly<{ x: number; y: number; z: number }>;
export type FaceSensor = Readonly<{
  landmarks: readonly NormalizedLandmark[];
  yawRad: number;
  quality: 'valid' | 'uncertain' | 'missing';
}>;
export type PoseSensor = Readonly<{
  landmarks: readonly (NormalizedLandmark & { visibility: number })[];
  quality: 'valid' | 'uncertain' | 'missing';
}>;
export type GestureSensor = Readonly<{ kind: 'palm' | 'victory' | 'none'; score: number }>;
export type Sample<T> = Readonly<{ frameId: number; sampledAtMs: number; receivedAtMs: number }> &
  ({ status: 'valid'; data: T } | { status: 'missing'; data: null });
export type SensorSnapshot = Readonly<{
  runtimeGeneration: number;
  emittedAtMs: number;
  face: Sample<FaceSensor> | null;
  pose: Sample<PoseSensor> | null;
  gesture: Sample<GestureSensor> | null;
}>;
export type DeviceStatus = Readonly<{
  camera: 'idle' | 'requesting' | 'ready' | 'failed';
  microphone: 'off' | 'requesting' | 'ready' | 'denied' | 'failed';
  vision: 'idle' | 'loading' | 'ready' | 'failed';
  calibration: 'idle' | 'running' | 'ready' | 'failed';
  audioPlayback: 'locked' | 'ready' | 'failed';
  errorCode: string | null;
}>;
export type MediaStatus = Readonly<{
  matchId: string | null;
  mediaInstanceId: string | null;
  receiverGeneration: number | null;
  state: 'idle' | 'connecting' | 'connected' | 'recovering' | 'closed' | 'failed';
  code: string | null;
}>;
export type InteractionContext = Readonly<{
  matchId: string;
  selfPlayerId: string;
  role: Role | null;
  phase: Phase;
  status: PlayerStatus;
  targetPlayerId?: string;
  incomingExchangeId?: string;
  outgoingExchangeId?: string;
  challengeId?: string;
  exitId?: string;
  poseKind?: PoseKind;
  selectedEquipment?: EquipmentKind;
  installationId?: string;
  mode: 'motion' | 'keyboard';
  pageActive: boolean;
}>;
export type InteractionState = Readonly<{
  selectedEquipment: EquipmentKind;
  mode: 'motion' | 'keyboard';
}>;
export type FaceTrackEvent = MediaScope &
  Readonly<{
    playerId: string;
    publisherGeneration: number;
    trackSid: string;
    element: HTMLVideoElement | null;
  }>;
export type CommandInput = {
  [K in CommandType]: { type: K; payload: CommandPayloads[K] };
}[CommandType];
export type InteractionDeps = Readonly<{
  sendCommand: (command: CommandInput) => string;
  requestMediaGrant: (request: MediaGrantRequest) => Promise<MediaGrant>;
  reportMediaStatus: (report: MediaStatusReport) => Promise<void>;
  requestBindingsRefresh: (request: MediaRefreshRequest) => void;
  onDeviceStatus: (status: DeviceStatus) => void;
  onFaceTrack: (event: FaceTrackEvent) => void;
  onMediaStatus: (status: MediaStatus) => void;
  onSensors: (snapshot: SensorSnapshot) => void;
  onInteractionState: (state: InteractionState) => void;
  onLocalPreview: (element: HTMLVideoElement | null) => void;
}>;
export interface InteractionRuntime {
  startDevices(input: { microphone: boolean }): Promise<DeviceStatus>;
  calibrate(): Promise<DeviceStatus>;
  setContext(context: InteractionContext): void;
  connectMedia(grant: MediaGrant): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): void;
  applyMediaBindings(bindings: MediaBindings): void;
  setQualityPreset(preset: 'medium' | 'low'): void;
  retireMediaGeneration(): Promise<void>;
  endParticipation(): Promise<void>;
  dispose(): Promise<void>;
}
export type CreateInteractionRuntime = (deps: InteractionDeps) => InteractionRuntime;
export type OperationsCommand =
  | Readonly<{ requestId: string; action: 'drain' | 'resume' | 'checkpoint' }>
  | Readonly<{ requestId: string; action: 'retry-retirement'; retirementId: string }>;
export type OperationSnapshot = Readonly<{
  requestId: string;
  operationId: string;
  action: OperationsCommand['action'];
  status: 'pending' | 'succeeded' | 'failed';
  code: string | null;
  updatedAtEpochMs: number;
}>;
export type OperationsStatus = Readonly<{
  /** Absent means legacy attested operation; continuous balances remain unknown (null). */
  operatingMode?: 'attested' | 'continuous';
  admission: 'OPEN' | 'DRAINING' | 'LOCKED';
  readiness: Readiness['state'];
  unresolvedCount: number;
  remainingMinutes: number | null;
  remainingBytes: number | null;
  checkedAtEpochMs: number | null;
}>;
export type OperationSubmission =
  | Readonly<{ status: 'accepted'; snapshot: OperationSnapshot }>
  | Readonly<{ status: 'conflict'; code: 'REQUEST_ID_CONFLICT' }>;
export interface OperationsPort {
  submit(command: OperationsCommand): OperationSubmission;
  getSnapshot(requestId: string): OperationSnapshot | null;
  getStatus(): OperationsStatus;
}
export type OfficialBudgetCheckpoint = Readonly<{
  projectAlias: string;
  remainingMinutes: number;
  remainingBytes: number;
  checkedAtEpochMs: number;
  source: 'cloud-dashboard';
  checkedBy: string;
}>;
export type ClientMessages = {
  command: CommandEnvelope;
  'request-status': RequestStatus;
  'view-resync': ViewResync;
  'game-heartbeat-ack': HeartbeatAck;
  'clock-probe': ClockProbe;
  'media-bindings-refresh': MediaRefreshRequest;
};
export type ServerMessages = {
  'command-result': CommandReceipt;
  'command-outcome': CommandOutcome;
  'request-status-result': RequestStatusResult;
  'room-roster': RoomRoster;
  'private-view': PrivateView;
  'private-event': PrivateEvent;
  'game-heartbeat': GameHeartbeat;
  'clock-reply': ClockReply;
  'media-bindings': MediaBindings;
  'audio-policy': AudioPolicy;
};
```

<!-- END CONTRACT-TYPES -->

<!-- END EXEC-CONTRACT-3 COMMON -->

## 작업별 구현 지시

각 항목의 파일은 **수정 또는 생성할 예정 경로**다. 현재 존재 여부는 AI가 확인한다. 아래 순서를 그대로 수행하되 선행 결과가 없는 항목은 계약에 따른 단위 구현까지만 진행하고 실제 연결 완료를 별도 기록한다. 모든 완료 항목은 작업별 커밋과 MR 본문으로 끝낸다.

### B-01

**SV-01 · [BE] 매치 상태·버전·튜닝 계약**  
일정: D1 2026-09-08 · **오늘 1번**  
기획 근거: v0.0.8 **04, 07, 17, 25장**  
선행 완료 결과: 문서 내부 선행 없음; Node/pnpm/설치·공통 검사 진입점은 [F 인계 기록](handoffs/F.md)에서 확인하며 F 전체 인수를 기다리지 않는다.

**수정·생성 파일**

- `packages/protocol/src/version.ts`
- `packages/protocol/src/game-schema/product.ts`
- `packages/protocol/src/game-schema/index.ts`
- `server/src/game/MatchContext.ts`
- `server/src/rooms/KkakkungRoom.ts`

**구현 순서**

1. PROTOCOL_VERSION=0.1.0과 sandbox 계약을 유지하고 PRODUCT_PROTOCOL_VERSION=0.2.0을 별도 export한다. 기존 개발 GameState와 제품 PublicMatchState/PrivateView 타입을 분리해 명시적 legacy adapter 외 seq/sequence와 소문자 상태 혼용을 막는다.
2. EXEC-CONTRACT-3의 Cell/Dir/Action/Role/PlayerStatus/Phase를 공개 타입에 고정한다. 공용 Schema는 phase/matchId/stateVersion/serverTick/startTick/startAt/deadlineTick/counts/result/abortReason만 두고 전체 maze/players/exit를 넣지 않는다.
3. MatchContext는 서버 process의 serverEpoch, matchId, tuningVersion, monotonic startAt을 보관한다. A 제공 tuning/Layout/seed를 core 생성에 주입하며 seed/튜닝 원문을 공개 Schema에 복사하지 않는다.
4. A의 제품 타입이 아직 도착하지 않았으면 공개 계약과 adapter 단위 fixture까지 진행하고 실제 core 연결은 인계 대기로 기록한다. A의 types.ts를 B가 직접 바꾸거나 동작 없는 임시 core를 제품으로 등록하지 않는다.
5. [공통 타입 원본](contracts/types.ts)과 [정상·실패 fixture](contracts/fixtures.ts)를 기준으로 공개 상태와 A/E/C/D 포트 타입을 맞춘다. 문서 타입 fixture의 성공과 실제 protocol Zod·core·Room 생산자/소비자 시험을 구분한다. 내부 core State는 A의 generic으로 유지하고 B 전용 복제 엔진 상태를 만들지 않는다.
6. MatchContext에 논리 공간 레지스트리를 두고 참가자별 GameViewScope를 `{gameInstanceId:null,kind:none,revision:0}`부터 관리한다. 연습 진입/퇴장·본 경기 진입/퇴장마다 revision을 증가시키고 팀별 practice와 game의 gameInstanceId를 별도로 생성한다. 미디어 연결만 교체할 때는 논리 ID/revision을 유지한다. PublicMatchState의 전역 stateVersion·serverTick은 같은 matchId 안에서 연속이며 scope 전환마다 초기화하지 않는다.

**연결 계약과 경계**

- startAt/serverTimeMs는 서버 monotonic ms, serverTick/deadlineTick은 매치 상대 정수; JWT expiresAt과 혼합하지 않는다.
- 서버 snapshot의 role은 runner/tagger, 상태는 대문자; 기존 개발 schema 변환은 B의 명시적 legacy 경로에만 둔다.
- serverTick은 라운드 생성부터 20Hz로 증가한다. PLAYING 진입 시 그때의 startTick을 확정하고 deadlineTick=startTick+3600으로 둔다. 연습 Action도 동일 serverTick 기준을 사용하며 startAt은 서버 monotonic ms이다.
- PrivateView.gameScope는 GameViewScope, PrivateEvent.gameScope는 ActiveGameScope다. mediaInstanceId·receiverGeneration은 논리 게임 scope의 대체 키가 아니다. 새 matchId에 들어갈 때만 참가자 scope revision과 매치 문맥을 새로 시작한다.

**시험 입력 → 기대 결과**

- sandbox protocol0.1.0 연결 -> 기존 계약 유지; 제품0.2.0 필드가 진단방에 섞이지 않음.
- 제품 PublicMatchState 직렬화 -> 좌표/maze/출구/seed 없음.
- 새 matchId 생성 -> stateVersion/Tick 초기화, 이전 command와 event의 매치가 구분됨.
- 한 matchId에서 none revision0 → practice revision1 → none revision2 → game revision3: stateVersion/Tick은 연속이고 논리 공간 전환마다 새 scope가 기록된다. 같은 game에서 LiveKit 재연결 → gameInstanceId/revision 불변.

**추가·보완할 시험 파일**

- `packages/protocol/test/product-state.test.ts`
- `server/test/protocol/match-context.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/protocol/test/product-state.test.ts
pnpm exec vitest run server/test/protocol/match-context.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

matchId/stateVersion/startTick/deadlineTick 및 개인 종료·ABORTED 상태를 정의한다. 설정과 seeded RNG를 매치 시작에 주입·고정하고 판 중 변경 및 구판 명령을 구분한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 제품 매치 상태와 버전 계약 정의
```

**MR 본문에 채울 변경 사항**

- 진단/제품 프로토콜 버전 분리
- 공개 상태와 서버 전용 매치 문맥 분리

**MR 리뷰 포인트**

- monotonic ms와 Tick/epoch 단위 구분
- public Schema에 개발 전체 맵이 남지 않는지

**완료 인계**

- A MP-01/RL-01에 제품 타입과 facade 요구를 D1 초반 인계
- C/D/E/F에 protocol0.2.0 타입·샘플 상태·버전 거절 기준 전달
- 다른 담당자는 task 전체 DONE 전에도 공통 타입·실패 fixture의 검증된 CONTRACT_READY 체크포인트를 소비할 수 있다. 실제 모듈 통합 전에는 해당 작업을 DONE으로 표시하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/SV-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-02

**SV-02 · [BE] 명령 공통 봉투·런타임 검증**  
일정: D1 2026-09-08 · **오늘 2번**  
기획 근거: v0.0.8 **17장**  
선행 완료 결과: [B-01](b-game-server.md#b-01) (SV-01, D1)

**수정·생성 파일**

- `packages/protocol/src/game-messages/product.ts`
- `packages/protocol/src/game-messages/index.ts`
- `packages/protocol/src/game-schema/product.ts`
- `server/src/game/CommandAdapter.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/bootstrap.ts`

**구현 순서**

1. 제품 command 채널에 EXEC-CONTRACT-3 CommandEnvelope의 strict discriminatedUnion을 붙인다. MOVE_INTENT, TURN, READY, PRACTICE_READY, LOAD_READY, EXCHANGE_REQUEST/ACCEPT/CANCEL, INSTALL/INSTALL_CANCEL, EXIT_START/CANCEL/PROGRESS, REMATCH만 정의한다. 미정 콘텐츠용 명령·enum·빈 구현을 추가하지 않는다.
2. UTF-8 실제 payload 4096바이트 상한, 비음수 safe integer sequence, UUID requestId, enum/추가 필드를 검증한다. 세션 actor와 현재 matchId를 확인하며 클라이언트 playerId/x/y/team은 계약의 상호작용 대상 ID 외 금지한다.
3. CommandAdapter의 기존 toMoveCommand sandbox export를 보존하며 toProductCommand를 추가한다. CoreCommand는 코어 처리 CommandEnvelope에 인증 actorId를 주입한 타입이다. READY/PRACTICE_READY/LOAD_READY/REMATCH는 B 단계 처리기로 분기하고 A domain re-export는 수정하지 않는다.
4. command-result는 접수 결과 {matchId,requestId,sequence,status,code,stateVersion}만 보낸다. 큐 수용 뒤 A 또는 B가 command-outcome {requestId,sequence,matchId,tick,result,code,stateVersion}을 반드시 한 번 종결하도록 연결한다. result=applied일 때 code=null이고 rejected/canceled는 공통 CommandCode를 사용한다. 접수 단계 rejected는 큐에 넣지 않고 terminal outcome 대상이 되지 않는다.
5. request-status {matchId,requestId}와 request-status-result {matchId,requestId,status:pending|done|unknown,outcome}의 strict 스키마를 제공한다. actor는 연결에서 결정하며 다른 사람의 원장을 조회할 수 없다. 원장이 pending이면 outcome:null, done이면 원래 CommandOutcome, 조회 불가/기록 없음이면 unknown/null이다. malformed 입력은 transport 오류로 처리하며 원문 payload·토큰은 로그에 남기지 않는다.
6. 설치된 Colyseus의 라우팅 순서를 먼저 확인하고 `/matchmake/*`와 OPTIONS가 실행되기 전 공통 HTTP 진입점에서 Origin을 검사한다. Express `app.use`만 추가하거나 SDK의 CORS 응답 헤더만 바꿔 완료 처리하지 않는다. 비허용 Origin은 본문 파싱·Room 생성·좌석 예약 전에 403으로 끝낸다. WebSocket beforeUpgrade에도 같은 허용 목록을 적용한다.
7. session/matchmaking JSON의 2KB 상한을 같은 HTTP 진입점에서 실제 UTF-8 바이트 수로 검사한다. Content-Length만 신뢰하지 말고 chunked 본문도 상한을 적용하며 초과 시 413과 예약 부작용 0을 보장한다. 이 2KB HTTP 상한과 제품 명령의 4096바이트 상한을 구분한다. LiveKit webhook의 서명용 원본 본문은 E가 정한 별도 유한 크기·raw-body 계약을 보존한다.
8. Origin 없는 development health/CLI 요청은 기존 명시적 개발 예외를 유지하고 인증을 대신한다고 설명하지 않는다. 제품 웹·서버 간 webhook·운영 요청의 예외와 인증은 각 경로의 명시적 정책으로 구분한다. 거절된 OPTIONS도 SDK 자동 응답까지 도달하지 않아야 한다.

**연결 계약과 경계**

- [EXEC-CONTRACT-3 타입](contracts/types.ts)을 공개 타입/Zod와 연결한다. INSTALL_CANCEL은 installationId 필수이며 sensor/trap의 제품 계약만 활성이다.
- CoreOutcome은 A가 만들고 B가 수신자 적용 가능 stateVersion을 붙인다. phase 처리 명령은 B가 같은 terminal 형식으로 만든다. applied는 의도/예약 반영이며 후속 행동 완료 보증이 아니다.
- 오류는 INVALID_COMMAND/PROTOCOL_MISMATCH/WRONG_MATCH/RATE_LIMITED/INVALID_PHASE/NOT_ACTIVE/NOT_ALLOWED/EXPIRED/STALE_REQUEST/NOT_READY 등 공통 code를 사용하고 숨은 출구 이유를 세분화하지 않는다.

**시험 입력 → 기대 결과**

- 정상 MOVE_INTENT 봉투 → CoreCommand.actorId는 인증 세션 값이며 matchId/requestId/sequence를 보존한다.
- seq만 존재·소수 sequence·잘못된 UUID·추가 좌표·4097바이트 → 접수 rejected, core 입력/게임 상태 불변이다.
- 정상 EXIT_START 접수 → accepted 뒤 core가 재시도 제한을 거절하면 같은 요청의 rejected command-outcome을 발송한다. 상태/사건이 없어도 종결 응답은 생략하지 않는다.
- READY accepted 뒤 phase 전환으로 처리 불가 → B의 INVALID_PHASE rejected outcome 1개다. request-status는 해당 원래 outcome을 반환한다.
- 공통 활성 명령 union에 없는 타입 → INVALID_COMMAND이며 임시 handler나 미래 제품 타입을 생성하지 않는다.
- 동일 비허용 Origin의 `/api/config`, `/matchmake/joinOrCreate/kkakkung`, `/matchmake/create/kkakkung` 및 OPTIONS → 모두 403; 실제 Room/예약 수 변화 0. 허용 Origin과 유효 개발 입력 → 기존 접속 성공. router handler만 호출하지 말고 실제 전체 HTTP 핸들러 또는 격리된 로컬 HTTP 서버로 검사한다.
- matchmaking JSON 2049바이트 또는 여러 chunk 합계 2049바이트 → 413과 Room/예약 생성 0; 허용 크기의 유효 요청은 정상 처리한다. 오류에 토큰·원문을 포함하지 않는다.
- WebSocket 비허용 Origin → upgrade 거절, 허용 Origin → 기존 연결 성공. Origin 없는 개발 health/CLI → 명시적 예외 정책의 기존 정상 동작이며 제품 인증 우회로 확장되지 않는다.

**추가·보완할 시험 파일**

- `packages/protocol/test/product-commands.test.ts`
- `server/test/protocol/command-adapter.test.ts`
- `server/test/protocol/http-boundary.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/protocol/test/product-commands.test.ts
pnpm exec vitest run server/test/protocol/command-adapter.test.ts
pnpm exec vitest run server/test/protocol/http-boundary.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

엄격한 봉투·신원·역할·매치 검증과 접수/종결/상태 조회 채널을 제공한다. SDK matchmaking·OPTIONS보다 앞선 HTTP Origin·2KB 경계를 적용하고 거절 시 Room/예약 부작용 0 및 WebSocket 회귀를 확인한다. A/B 모든 수용 명령의 요청 상관관계를 보존하고 문서 fixture, 실제 Zod/adapter, C 소비자의 pending 해제 연결을 각각 검증한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 계약 fixture 통과와 실제 생산자·소비자 연결 시험 통과를 구분해 진행 기록과 MR 본문에 남긴다.

**작업 완료 커밋 제목**

```text
feat: 제품 명령 봉투와 런타임 검증 적용
```

**MR 본문에 채울 변경 사항**

- 활성 strict 명령 union과 접수/종결/요청 상태 조회 계약
- 인증 actorId 기반 CoreCommand와 B phase command 분리

**MR 리뷰 포인트**

- CommandAdapter가 기존 sandbox export를 깨지 않는지
- payload 크기는 문자 수가 아닌 UTF-8 바이트인지

**완료 인계**

- C/D에 모든 메시지 채널·정상/거절 JSON fixture 인계
- A에 코어 명령 필드와 safe error 매핑 전달; production auth/phase는 AC/FL 연결 후 재검증
- C에 조기 탈출 거절·설치 실패·교환 실패·phase 변경 실패의 실제 command-outcome을 인계해 SessionRuntime에서 pending을 끝내는 연결 시험을 확인한다.
- F에 허용/비허용 Origin의 HTTP·OPTIONS·WebSocket 결과와 2KB 초과 시 예약 0 증거를 전달한다. 문서에 계획을 추가한 것과 실제 서버 경계를 수정·검증한 결과를 구분한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/SV-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-03

**SV-03 · [BE] 입력 큐·중복·전송량 제한**  
일정: D1 2026-09-08 · **오늘 3번**  
기획 근거: v0.0.8 **07.1, 17장**  
선행 완료 결과: [B-02](b-game-server.md#b-02) (SV-02, D1)

**수정·생성 파일**

- `server/src/game/CommandQueue.ts`
- `server/src/game/CommandLimiter.ts`
- `server/src/game/CommandAdapter.ts`
- `server/src/rooms/KkakkungRoom.ts`

**구현 순서**

1. 연결별 lastSequence와 인증 playerId/matchId/requestId 원장을 둔다. accepted는 pending으로 등록한 뒤 한 번만 큐에 넣고, 같은 요청 재전송은 기존 접수 결과와 존재하는 원래 outcome을 재전달한다. 같은 ID에 다른 payload/sequence를 덮어쓰거나 재실행하지 않는다.
2. 서버 monotonic receivedAtMs와 room arrivalOrdinal을 저장하고 token bucket 초당 30 refill·capacity 60을 적용한다. 연결별 pending 상한은 64개, 6명 Room 합계 상한은 384개다. 두 상한과 전송량을 모두 검사한 뒤 원장에 insert하며 pending 상한 초과는 접수 단계 QUEUE_FULL, 전송량 초과는 RATE_LIMITED로 거절한다. 기존 pending은 임의 evict하지 않는다.
3. 매 Tick 입력 묶음을 freeze해 큐에서 core/phase 처리기로 옮기되 종결 전까지 원장은 pending으로 유지한다. 최신 sequence의 held MOVE 수신 이후 500ms를 실제 시계로 매 Tick 직전에 검사해 EXPIRE_MOVE를 주입한다. 수용 뒤 실행 전 이미 만료된 이동 명령은 canceled/EXPIRED로 종결하고 core에서 새 행동을 시작하지 않는다.
4. A/B outcome을 pending→done으로 한 번만 기록한다. 이미 done인 요청을 재종결하지 않고 원래 결과를 보존한다. close/terminal/새 match에서는 아직 accepted인 pending 각각을 canceled로 끝낸 뒤 실행 큐·held timestamp를 정리한다. 연결이 끊겨 전달하지 못해도 서버 원장은 종결되며 재실행하지 않는다.
5. request-status는 해당 인증자 원장의 pending/done/unknown을 반환한다. pending은 종결 전 제거하지 않는다. done은 연결별 최근 512개와 완료 후 2분을 상한으로 보존하며 더 먼저 만나는 한도에서 완료 기록만 정리한다. 정리된 완료 기록 조회는 unknown이며 sequence 역행/동일 sequence를 새 명령으로 재실행하지 않는다. 매치 교체 후 늦은 조회/재전송은 현재 경기를 바꾸지 않는다. accepted 이후 2초가 지나도 pending인 경우 C가 최대 3회 조회하는 fixture를 실제 원장에 연결한다.

**연결 계약과 경계**

- 요청별 정확히 하나는 서버 논리 종결 횟수다. 같은 종결 응답의 재전달은 허용하지만 행동·상태·사건을 두 번 적용하지 않는다.
- A에는 CoreCommand와 arrivalOrdinal 순서만 전달하고 B가 TTL·수신량·요청 원장을 소유한다. RL-03 행동 한 칸 버퍼는 별도 규칙이다.
- 거절 명령의 게임 상태는 불변이다. 원장/진단 계수 갱신과 다른 정상 명령·자연 Tick 효과는 거절 명령의 효과와 분리해 비교한다.

**시험 입력 → 기대 결과**

- 같은 requestId/sequence 두 번 → core 입력 1개; 첫 완료 뒤 재전송/상태 조회 → 원래 outcome이며 상태 변화는 1회다.
- 초기 burst 60개 후 61번째 → 접수 RATE_LIMITED. refill 후 연결 pending 64개 또는 Room pending 384개인 새 요청 → QUEUE_FULL이며 기존 pending 유실 없음.
- receivedAt=0/now=501인 미실행 이동 → canceled EXPIRED 1개와 새 행동 없음. 이미 applied인 유지 의도 만료 → EXPIRE_MOVE만, 추가 outcome 없음.
- accepted EXIT_START 후 core 거절 + private-view 변화 없음 → done/rejected 원장과 종결 응답; 조회가 pending에 영원히 남지 않는다.
- 매치 종료 때 accepted 3개가 미처리 → canceled 3개로 종결하고 큐 정리; 이미 applied 1개는 재취소하지 않는다. 같은 ID의 다른 payload는 원래 기록을 덮어쓰지 않는다.
- done 513개 또는 완료 후 2분 경과 → 오래된 done만 정리하고 pending은 보존한다. 정리된 ID 조회는 unknown이며 이전 sequence의 재전송은 core에 재투입하지 않는다.

**추가·보완할 시험 파일**

- `server/test/protocol/command-queue.test.ts`
- `server/test/protocol/command-limiter.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/protocol/command-queue.test.ts
pnpm exec vitest run server/test/protocol/command-limiter.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

유한 큐와 전송량 제한, 실제 시각 TTL, 요청 원장의 pending→done 종결을 구현한다. 모든 accepted는 applied/rejected/canceled 하나로 끝나고 중복 재전달·상태 조회·매치 종료에서도 재실행과 pending 유실이 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 계약 fixture 통과와 실제 생산자·소비자 연결 시험 통과를 구분해 진행 기록과 MR 본문에 남긴다.

**작업 완료 커밋 제목**

```text
feat: 명령 큐와 중복 및 전송량 제한
```

**MR 본문에 채울 변경 사항**

- bounded 큐·dedupe와tokenbucket
- monotonic TTL와만료control

**MR 리뷰 포인트**

- 큐거절때ack만성공으로남기지않는지
- 캐시/세션정리로장시간메모리누수없는지

**완료 인계**

- A RL-03에 EXPIRE_MOVE playerId/sequence와입력정렬규칙인계
- F에큐상한·rate값설정요청,QA-10용계측콜백전달
- C SV-09/EX-05와 F QA-07에 accepted→거절/취소→조회 결과 fixture, pending 상한과 실제 원장 결합 시험을 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/SV-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-04

**SV-04 · [BE] 권위 상태를 단일 Tick 경로로 변경**  
일정: D1 2026-09-08 · **오늘 4번**  
기획 근거: v0.0.8 **07, 17장**  
선행 완료 결과: [B-03](b-game-server.md#b-03) (SV-03, D1)

**수정·생성 파일**

- `server/src/rooms/KkakkungRoom.ts`
- `server/src/game/MatchDriver.ts`
- `server/src/game/CommandAdapter.ts`
- `server/src/game/PlayerProjection.ts`
- `server/test/room/test-harness.ts`

**구현 순서**

1. onMessage/onLeave/미디어 async 콜백은 CommandQueue/ControlQueue에만 쓴다. MatchDriver의 단일 Tick 경로에서 CorePort.stepMatch와 nextState 교체를 수행하며 B phase 명령도 같은 직렬 실행 경계에서 처리한다.
2. Tick 시작 입력과 상태를 고정하고 만료/무장→예약 완료→포획→술래 장비→포즈→교환 지식→승패/연결 상실 순서로 A facade를 연결한다. 원본 07장의 미정 콘텐츠 단계는 사용자 재승인 전 구현하지 않는다. 합성 단계 fixture는 호출 순서만 검증하며 실제 A 규칙 결합 완료를 대신하지 않는다.
3. StepResult.outcomes를 요청 원장과 먼저 대조해 처리 명령별 CoreOutcome 한 개 및 actorId/matchId/requestId/sequence 일치를 확인한다. 정상 결과만 state로 커밋하고 공개/개인 뷰로 투영한다. actorId는 라우팅에만 사용하고 공개 CommandOutcome에서는 제거하며 수신자 적용 가능 stateVersion을 붙인다. 누락/중복/모르는 요청 outcome이면 그 step을 커밋하지 않고 내부 계약 오류로 매치를 중단해 pending을 canceled/ROUND_ENDED로 닫는다. 임의 applied를 만들어 보충하지 않는다.
4. DomainEvent.type을 판별해 SPATIAL_SOUND이면 sound를 TrustedMediaFrame.events에만 담고, 그 외 EventType이면 audience를 확인해 SV-07 private-event로 보낸다. HUNTER_MARKER를 음향으로 변환하거나 SPATIAL_SOUND를 공개 사건으로 직렬화하지 않는다. MediaIntent와 TrustedMediaFrame은 공통 typed E 포트로 넘긴다. Tick에서 네트워크 Promise를 await하지 않으며 E 반환은 typed MediaControl로 B의 다음 큐에 들어온다. B가 준비/회수 결과를 단계 상태에 반영하고, core가 알아야 할 실패만 ABORT_MATCH 등의 ControlIntent로 변환한다. terminal 뒤 미처리 accepted는 canceled로 원장을 닫는다.
5. 게임 Tick 50ms와 patchRate 50ms 상한을 각각 설정한다. 개인 뷰가 변하지 않은 rejected outcome도 최신 적용 가능 뷰 버전으로 즉시 전달한다. 빈 patch 생성을 위해 임의 상태를 토글하지 않는다.

**연결 계약과 경계**

- A facade=createMatch/stepMatch/createPractice, B 호출경로는 server/domain 기존 re-export. B는 core함수를 재구현하지 않는다.
- E observeFrame은 trusted서버전용 좌표/graph를 받아도 공개메타데이터로내보내지 않으며동기부분에서네트워크IO를하지않는다.
- 이 작업의 fixture는 Tick 어댑터의 단일 writer/큐 경계만 증명한다. 실제 A 규칙 전체·E미디어 연결의 완료는 FL-05와 QA-07에서 확인한다. A RL-01 순수 구현은 이 어댑터의 완료를 기다리지 않는다.
- [공통 타입](contracts/types.ts)의 CorePort<State>·StepResult·TrustedMediaFrame을 생산자/소비자 모두 import 또는 동등성 검사한다. 원본 fixture를 복사해 서로 다른 private 타입으로 성공시키지 않는다.
- A getFrame/getVisibleSurfaces/getPlayerSelf selector와 B가 보관한 Topology로 TrustedMediaFrame을 만든다. E는 MediaControl을 반환하며 Core ControlIntent를 직접 구성하지 않는다. Promise 반환과 enqueueControl 알림이 같은 결과를 가리키면 requestId/scope로 한 번만 반영한다.
- 각 core 호출과 CoreReadFrame.gameInstanceId를 B 레지스트리의 논리 공간 ID와 대조한다. 폐기한 practice의 늦은 결과를 현재 game scope로 다시 표시하거나 새 core에 적용하지 않는다. B가 논리 ID와 현재 mediaInstanceId의 대응을 관리하고 A에 미디어 식별자를 주입하지 않는다.

**시험 입력 → 기대 결과**

- move 2개와 turn 1개 → 고정된 한 Tick 입력으로 step 1회, 결과 outcome 3개와 원장 종결 3개; callback 중 직접 위치 변경 없음.
- Cloud Promise가 Tick 중 해결 → typed control은 다음 Tick에서만 반영하고 진행 상태 불변이다.
- EXIT_START accepted→실제 A 재시도 제한 rejected→B command-outcome→C pending 해제 → private-view 변화가 없어도 새 요청 가능하다.
- 개인 종료+이탈 같은 Tick → A 우선순위 유지; terminal 뒤 미처리 accepted는 canceled이고 새 게임 사건은 없다.
- fixture core가 처리 명령의 outcome을 누락/중복 → 통합 계약 오류를 검출하고 임의 applied를 전송하지 않는다. 정상/실패 fixture 통과와 실제 A/E/C 결합 통과를 별도로 기록한다.
- 실제 A 결과에 footstep/sensor/trap SPATIAL_SOUND와 HUNTER_MARKER 혼재 → E frame에는 SpatialSoundEvent만, SV-07에는 지도 사건만 전달된다. E가 만든 공개 audio-policy에 cell/sourcePlayerId가 없고 지도 audience 밖 수신자에게 표식을 보내지 않는다.
- practice 상태에서 시작한 늦은 callback/step 결과가 game 진입 후 반환 → 폐기한 gameInstanceId임을 검출해 현재 상태·뷰·음향에 적용하지 않는다. 현재 core frame만 대응하는 E frame과 수신자 scope로 변환한다.

**추가·보완할 시험 파일**

- `server/test/room/match-driver.test.ts`
- `server/tests/integration/kkakkung.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/match-driver.test.ts
pnpm exec vitest run server/tests/integration/kkakkung.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

권위 상태와 phase 명령을 단일 Tick 경로로 변경한다. 활성 규칙 순서·typed A/E 포트·정확히 하나의 명령 종결·비동기 control 큐를 연결하고, 실제 A 거절이 C pending을 해제하는 생산자·소비자 시험을 통과해야 최종 연결 완료다. Tick/patch 상한은 각각 20Hz다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 계약 fixture 통과와 실제 생산자·소비자 연결 시험 통과를 구분해 진행 기록과 MR 본문에 남긴다.

**작업 완료 커밋 제목**

```text
feat: 매치 권위 상태의 단일 Tick 실행 연결
```

**MR 본문에 채울 변경 사항**

- 메시지/비동기변경을명령큐로통합
- core결과와projection/미디어의분리
- SPATIAL_SOUND와 개인 사건의 판별 분기 및 A→B→E 음향 연결

**MR 리뷰 포인트**

- 임시fixture통과를전도메인완료라고쓰지않는지
- 기존개발Room시험을제품6인조건에맞추되개발adapter시험을별도유지

**완료 인계**

- E에createMediaCoordinator/enqueueControl조립점과trustedframe인계
- B가 소유한 `server/test/room/test-harness.ts`에 실제 Room·A core와 fake monotonic/transport 주입 방법을 제공하고 F가 자기 통합 시험에서 import하도록 인계한다. mock CorePort로만 실행한 검사는 별도 이름으로 구분한다.
- F QA-07에실제Room생성·tick주입테스트harness제공
- A/B/C 경계 시험은 packages/game-core 실제 구현과 Room/클라이언트 처리기를 연결해 수행하고, mock port만 사용한 계약 시험 결과와 분리해 F에 전달한다.
- A/E와 실제 생성 사건·Room 분기·수신자 audio-policy를 연결한 결과를 F에 전달한다. fixture enum 분기만 통과한 결과와 실제 발소리/장비 발동 시험을 구분한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/SV-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-05

**SV-05 · [BE] Tick 지연·과부하 보호**  
일정: D1 2026-09-08 · **오늘 5번**  
기획 근거: v0.0.8 **07.2, 24, G3-D장**  
선행 완료 결과: [B-04](b-game-server.md#b-04) (SV-04, D1)

**수정·생성 파일**

- `server/src/game/TickScheduler.ts`
- `server/src/game/RoomTickCoordinator.ts`
- `server/src/game/MatchDriver.ts`
- `server/src/bootstrap.ts`

**구현 순서**

1. sandbox가쓰는기존TickScheduler API를호환하게유지하거나제품용스케줄러를분리한다. 제품Room의nextDue를monotonic시간으로보관하고콜백진입/각실행직전L=max(0,now-nextDue)를다시잰다.
2. 한스케줄러턴에서실행기한이온Room을공정한순서로최대4라운드처리한뒤이벤트루프에양보한다. 10개Room각각무제한catch-up하는타이머구조를피하고Room별nextDue는실행된Tick만50ms증가시킨다.
3. L>250ms인Room은게임사건을처리하기전에ControlIntent {type:ABORT_MATCH,reason:SERVER_TICK_OVERLOAD}로 ABORTED를 확정하고신규입장/허용/입력을닫는다. 프로세스전체지연이면영향받은진행Room모두대상이며E비동기회수경로로넘긴다.
4. 입력TTL은각Tick실제now로재검사하며startAt/deadline을미루거나중간Tick을건너뛰지않는다. F관측용due/lag/catchup/abort콜백을노출하고core내부IO는추가하지않는다.
5. 과부하로 게임 명령 실행을 생략하는 경우에도 accepted 원장의 미처리 요청은 B가 canceled/ROUND_ENDED로 각각 종결한다. 종료 응답은 요청자가 마지막으로 받은 유효 개인 뷰 버전을 사용하며 이미 종결된 요청을 재취소하지 않는다.

**연결 계약과 경계**

- 250ms는초과(>)가무효조건,4회뒤yield. fakeclock단위검증과실제정지통합검증은구분.
- 현재sandbox의TICK_OVERLOAD disconnect와제품ABORTED결과계약을섞지않는다.
- F의 `server/src/observability/MetricRegistry.ts`가 제공하는 `emitMetric(sample:MetricSample):void`를 B의 scheduler/queue deps와 E의 MediaCoordinatorDeps에 같은 callback으로 주입한다. B는 실제 due/lag/catchup/queue/abort 측정 시점에 호출하고 F의 name/unit 허용 목록에 맞춘다. atMs는 서버 monotonic ms이며 사용자 식별자·좌표·토큰을 metric name/값에 넣지 않는다. F 소스나 루트 관측 설정은 B가 수정하지 않는다.

**시험 입력 → 기대 결과**

- 100–200ms지연 -> 기한온Tick순서대로최대4회후양보,deadline불변.
- 2초정지후재개 -> 40Tick처리없이ABORTED,만료이동재생없음.
- 두Room중하나만L251ms ->영향Room무효;전체정지로모두251ms ->모두회수의도,반복abort중복없음.
- pending 요청이 있는 Room에서 L=251ms → core 행동 재생 없이 ABORTED와 요청별 canceled outcome, 원장 pending 0; 동일 abort 반복에도 논리 종결은 1회다.
- 과부하 입력 → core에 {type:ABORT_MATCH,reason:SERVER_TICK_OVERLOAD} 한 개 전달; 정의되지 않은 SERVER_TICK_OVERLOAD type의 control은 만들지 않는다.

**추가·보완할 시험 파일**

- `server/test/room/tick-coordinator.test.ts`
- `server/tests/tick.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/tick-coordinator.test.ts
pnpm exec vitest run server/tests/tick.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

monotonic nextDue를 매 Tick 전 재검사한다. catch-up 최대 4회 후 양보하며 지연 250ms 초과 시 영향 매치를 무효화한다. 2초 정지 뒤 40 Tick 재생·deadline 연장·만료 입력 부활이 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 다중 Room Tick 지연과 과부하 보호
```

**MR 본문에 채울 변경 사항**

- monotonic기한과최대catchup
- 영향Room무효와비동기정리

**MR 리뷰 포인트**

- deadline연장·Tick생략으로시험을통과시키지않는지
- sandbox기존스케줄러계약유지

**완료 인계**

- F DP-05/QA-10에metrics콜백·정지주입harness인계
- E에overload회수/새허용차단control인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/SV-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-06

**AC-01 · [BE] 테스트 초대 발급·검증**  
일정: D1 2026-09-08 · **오늘 6번**  
기획 근거: v0.0.8 **18장**  
선행 완료 결과: 문서 내부 선행 없음; 운영 설정과 createOperatorAuth는 [F 인계 기록](handoffs/F.md)·[E 인계 기록](handoffs/E.md)에서 확인한다. InviteStore 순수 검증은 실제 운영 공개를 기다리지 않는다.

**수정·생성 파일**

- `server/src/session/InviteStore.ts`
- `server/src/session/invite-types.ts`
- `server/src/session/InvitationRoutes.ts`
- `server/src/bootstrap.ts`

**구현 순서**

1. crypto.randomBytes로방코드와별개고엔트로피초대토큰을발급하고서버에는해시/초대ID·허용범위·만료·폐기상태를저장한다. 토큰값이나nickname을로그에넣지않는다.
2. 검증은constant-time비교가가능한고정길이해시로수행하고폐기/만료/다른범위사용을동일한안전거절로반환한다. 방코드조회는초대검증뒤에만가능하게한다.
3. 공통 InvitationPort의 issue/revoke/verify/bindCreatedRoom을 구현하고 B가 `POST /api/operations/invitations`와 `POST /api/operations/invitations/:inviteId/revoke`를 등록한다. 두 경로는 E가 제공하는 `createOperatorAuth(OPS_TOKEN)`으로 Authorization을 검사한다. 게임 sessionToken으로 호출할 수 없고 E의 OperationsCommand action에 초대 명령을 추가하지 않는다.
4. issue 본문은 strict IssueInvitation `{scope:{allowCreate,roomCodes},expiresAt}`다. expiresAt은 epoch ms이며 현재보다 미래, F의 inviteMaxTtlMs 이내와 승인된 공개창 안이어야 한다. scope는 allowCreate=true 또는 유효 roomCodes 한 개 이상이어야 한다. roomCodes는 중복 없이 서버가 알고 있는 방 코드만 허용한다. E 운영 상태 READY/OPEN·공개창·필수 설정을 검사하고 발급 성공이면 201과 IssuedInvitation, 잘못된 요청은 400, 운영 잠금/공개창 밖은 409의 안전 code로 끝낸다.
5. 초대 생성 권한으로 성공적으로 예약한 방은 같은 InviteStore의 bindCreatedRoom(inviteId,roomCode)로 해당 초대 범위에 추가한다. 방 코드를 아는 것만으로 다른 초대에 생성된 방에 입장하지 못한다. 초대의 명시적 roomCodes 또는 해당 초대에서 생성한 방만 join에 허용한다. revoke는 원문 토큰 대신 inviteId를 받고 이미 폐기/없는 ID에도 204를 반환한다. 폐기는 신규 사용을 막으며 이미 연결된 경기를 자동 강퇴하는 명령으로 바꾸지 않는다.
6. issue 응답은 no-store이며 inviteToken 원문은 이 응답에서만 운영자에게 제공한다. 조회 API·애플리케이션 로그·인계 문서·MR에 원문을 남기지 않는다. token 원문 없는 서버 메타데이터로 유효·만료·폐기·다른 scope·무권한 호출을 시험한다.

**연결 계약과 경계**

- 초대는URLfragment전달,C가읽은뒤history에서제거. session/API에는requestbody로만전달하고Cache-Control:no-store사용.
- 초대 만료/공개창은 운영 설정이며 무기한 발급 기본값을 두지 않는다. F의 `INVITE_MAX_TTL_MS → AppConfig.inviteMaxTtlMs`는 필수 양의 safe integer다. 공개창은 E/F의 epoch ms 운영 설정을 사용한다. 설정 부재 시 단위 시험의 명시적 fixture로만 진행하고 실제 공개 인수는 BLOCKED로 남긴다.
- InvitationPort와 INVITATION_ROUTES는 서버 운영 경계다. 실제 구현 타입은 `server/src/session/invite-types.ts`에 두고 브라우저 공개 protocol로 운영 토큰·원문 초대 레지스트리를 export하지 않는다.

**시험 입력 → 기대 결과**

- 유효초대+허용범위 -> 검증성공/초대ID반환.
- 같은방코드만제출또는토큰변조 ->입장/조회거절.
- 폐기된초대/만료경계시각토큰 ->동일거절,기존연결강퇴여부는별도운영의도로처리.
- 운영자 발급→해당 초대로 방 생성·bindCreatedRoom→동일 초대 참가 → 허용. 별도 scope 초대+방 코드 → 거절. 폐기 후 신규 session 요청 → 거절이며 기존 진행 경기 상태는 유지한다.
- 게임 세션 Bearer로 issue/revoke → 401/403·발급/폐기 없음. 정상 운영자도 READY/OPEN 또는 공개창/TTL이 맞지 않으면 issue 거절; 같은 inviteId revoke 반복 → 204, 중복 부작용 없음.

**추가·보완할 시험 파일**

- `server/test/session/invite-store.test.ts`
- `server/test/session/invitation-routes.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/session/invite-store.test.ts
pnpm exec vitest run server/test/session/invitation-routes.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

방 코드와 별도 고엔트로피 초대를 발급하고 범위·만료·폐기를 검사한다. 방 코드만으로 접근하거나 폐기·변조 초대를 재사용하는 요청이 거절된다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 제한 공개 초대 발급과 검증
```

**MR 본문에 채울 변경 사항**

- 고엔트로피초대와scope/만료
- 발급/폐기운영service경계

**MR 리뷰 포인트**

- 원본토큰을예외/로그/영속자료에저장하지않는지
- 방코드가접근자격이되지않는지

**완료 인계**

- E OP-07에권한보호inviteissue/revoke인터페이스전달
- C AC-06에초대fragment처리와안전거절응답예시인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/AC-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-07

**AC-02 · [BE] 방 생성·참가 API와 시도 제한**  
일정: D1 2026-09-08 · **오늘 7번**  
기획 근거: v0.0.8 **18장**  
선행 완료 결과: [B-06](b-game-server.md#b-06) (AC-01, D1)

**수정·생성 파일**

- `server/src/session/SessionRoutes.ts`
- `server/src/session/AdmissionLimiter.ts`
- `server/src/bootstrap.ts`
- `packages/protocol/src/game-messages/session.ts`

**구현 순서**

1. POST /api/sessions를 공통 SessionRequest의 strict 판별 union으로 검증한다. createRoom=true이면 roomCode가 금지되고 createRoom=false이면 roomCode:string이 필수다. nickname/inviteToken 검증 후 생성 또는 허용된 방 코드를 해결하며 SessionResponse {sessionToken,playerId,roomCode,expiresAt,protocolVersion:0.2.0}를 no-store로 보낸다.
2. 초대ID별 생성/입장 시도 제한을 우선 적용하고 학교 NAT의 IP 공유를 고려한 보조 bucket을 별도로 둔다. F가 제공하는 sessionAttemptWindowMs/sessionAttemptsPerInvite/sessionAttemptsPerIp를 사용하고 세 값은 필수 양의 safe integer로 검증한다. 승인되지 않은 기본 rate 값을 만들지 않는다. proxyIP는 신뢰된 Nginx 경로에서만 해석하도록 F의 trust proxy 설정과 맞춘다.
3. SV-02에서 구현한 SDK matchmaking·OPTIONS 이전의 공통 HTTP Origin/2KB 경계를 새 session·제품 입장 경로에도 적용한다. Express middleware만으로 SDK 경로가 보호된다고 가정하지 않는다. HTTP와 WebSocket beforeUpgrade의 허용 목록을 통일하고 비허용 Origin은 생성·예약 전에 403으로 거절한다. Origin 없는 development health/CLI 예외는 명시적 프로필에만 유지하며 서버 간 webhook/운영 경로의 서명·토큰 인증은 별도로 검증한다.
4. LiveKit webhook은express.json보다앞에서rawBody라우트로등록할자리와E핸들러주입점을준비한다. 실제검증은E코드로위임하고게임세션/미디어/운영secret권한을분리한다.
5. E coordinator.getOperations()의 OperationsPort를 받아 POST /api/operations/commands는 submit(command), GET /api/operations/commands/:requestId는 getSnapshot(requestId), GET /api/operations/status는 getStatus()에 정확히 위임한다. OPS_TOKEN을 검증하고 accepted 제출은 202와 snapshot, requestId 내용 충돌은 409, 미존재 snapshot은 404로 변환한다. 202/pending을 운영 작업 성공으로 응답하지 않는다.
6. E 생성 deps.getGameActivity에는 B Room/입장 레지스트리에서 복사한 {activeMatches,activePractices,pendingAdmissions}의 읽기 전용 현재 snapshot을 제공한다. E는 이를 조회만 하고 B 레지스트리·참가자·Room 상태를 직접 변경하지 않는다. 동일 실체를 여러 번 세지 않도록 각 카운트 정의를 B 레지스트리에 한 번 적용한다.
7. drain 제출 때 E가 admission=DRAINING을 즉시 반영하도록 연결한다. B 입장 처리기는 E getOperations().getStatus().admission이 OPEN인지 예약 전과 각 await 뒤, 세션/미디어 응답 반환 직전에 재검사한다. 중간에 DRAINING/LOCKED가 되면 새 입장을 확정하지 않고 B의 미사용 예약을 정리한다. 이미 발급된 미디어가 있다면 E 회수 경로를 거치며 원격 정리 확인 전 슬롯을 해제하지 않는다.
8. prepareGeneration 결과는 공통 PreparationResult의 status로 좁힌다. ready는 receiverGeneration:number와 grant, unknown은 할당된 receiverGeneration:number와 grant:null, rejected는 receiverGeneration:number|null와 grant:null이다. 할당 전 거절의 null을 0이나 새 세대로 바꾸지 않는다. HTTP 실패 코드로 변환하고 동일 결과의 enqueueControl 처리는 requestId/scope로 한 번만 반영한다.
9. 서버 조립은 동기 createMediaCoordinator(deps)로 포트를 만든 뒤 initialize()를 await한다. initialized 결과는 readiness RECOVERING 또는 LOCKED, admission DRAINING이며 이때부터 health/운영 HTTP를 제공할 수 있다. 원격 정리·저널·공식 예산 확인 완료 후 READY가 되어도 admission은 자동 OPEN으로 바꾸지 않고 명시적 resume을 요구한다. fatal(WRITER_CONFLICT/INITIALIZATION_FAILED)이면 listen하지 않고 close로 자원을 정리한다. 반복 initialize는 E가 같은 in-flight Promise/결과로 합치므로 B도 중복 기동·이중 listen을 만들지 않는다.
10. F의 검증된 AppConfig에서 MediaCoordinatorDeps의 필드를 이름·단위별로 명시적으로 매핑하고 `createOperatorAuth(config.opsToken)`과 MetricRegistry의 emitMetric을 주입한다. config 전체 spread, `process.env`를 E 내부에서 재독해 기본값 생성, 부재한 E 결과를 ready로 대체하는 adapter는 만들지 않는다. 초대 발급/폐기는 AC-01의 B 라우트와 같은 운영 인증을 사용한다.

**연결 계약과 경계**

- C는반환roomCode로joinOrCreate(kkakkung,{token:sessionToken,roomCode,protocolVersion:0.2.0});B는roomCode filterBy+초대scope를검사.
- 공개방목록은없으며미존재방/권한없는방오류에숨은방내용을노출하지않는다.
- B의 미디어 HTTP/WS 어댑터는 공통 MediaGrantRequest/MediaGrant/MediaStatusReport/MediaRefreshRequest와 OperationsCommand/OperationSnapshot을 그대로 검증해 E에 위임한다. grants/report/webhook·운영 경로와 응답 상태는 공통 HTTP 표를 따르며 raw-body 검증은 handleWebhook에 넘긴다.
- SessionRequest/SessionResponse, PreparationResult, OperationsPort, MediaCoordinatorDeps.getGameActivity는 [공통 타입](contracts/types.ts)의 정확한 형태를 사용한다. E의 운영 상태가 변경돼도 기존 B Room의 경기 상태를 E가 직접 바꾸지 않는다.
- MediaInitializationResult는 부팅 장벽의 결과이며 readiness READY나 신규 입장 허용을 뜻하지 않는다. E 초기화 결과와 B HTTP listen, F readiness probe/운영 resume 순서를 실제 연결 시험으로 구분한다.

**시험 입력 → 기대 결과**

- 유효초대createRoom=true -> 새roomCode/세션반환,2회동시생성은제한정책에맞게원자처리.
- 다른scope초대+기존roomCode ->조회/입장거절.
- 허용밖Origin HTTP/WSS ->403;같은학교IP에서서로다른유효초대정상범위 ->불필요일괄차단없음.
- createRoom=true+roomCode 또는 createRoom=false인데 roomCode 없음 → HTTP 입력 거절/예약 없음. 유효한 각 분기는 대응하는 SessionResponse를 반환한다.
- generation 할당 전 PreparationResult rejected/null → 실패 응답이며 세대 생성·성공 grant 없음. unknown/숫자 세대 → 503과 안전 코드, 해당 미확인 세대를 성공 또는 미할당으로 처리하지 않는다.
- 같은 운영 requestId/본문 재전송 → 같은 operationId; 다른 본문 → 409. GET 미존재 → 404, 202 pending 뒤 getSnapshot으로 최종 상태를 조회한다.
- 입장 예약 뒤 await 중 drain 제출 → E admission은 즉시 DRAINING, B의 후속 입장/응답은 차단되고 기존 경기 Room은 유지된다. 미사용 예약은 정리하며 발급된 미디어의 원격 회수는 E로 전달한다.
- B snapshot이 activeMatches=2,activePractices=1,pendingAdmissions=1 → E는 같은 복사값을 읽는다. E 운영 메서드가 B Room 레지스트리를 직접 변경하는 호출은 없다.
- 허용 밖 Origin의 session/matchmaking/OPTIONS → 403과 Room·좌석 예약 0; 2KB 초과 session/matchmaking JSON → 413과 예약 0. 허용 Origin의 유효 초대는 정상이며 같은 Origin이 초대 검증을 대체하지 않는다.
- initialize pending → listen 0회; initialized/RECOVERING/DRAINING → health/운영 HTTP만 가용하고 새 입장·grant 거절. 복구 후 READY도 resume 전에는 DRAINING이다. fatal → listen 0회와 자원 정리, 초기화 반복 → 같은 결과와 기동 1회다.

**추가·보완할 시험 파일**

- `server/test/session/session-routes.test.ts`
- `server/test/session/admission-limiter.test.ts`
- `server/test/session/operations-routes.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/session/session-routes.test.ts
pnpm exec vitest run server/test/session/admission-limiter.test.ts
pnpm exec vitest run server/test/session/operations-routes.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

유효 초대와 strict SessionRequest 분기로만 방을 생성·참가한다. 공개 목록 없이 초대 단위 우선 rate limit·NAT 보조 제한·HTTP/WSS Origin을 검사한다. OperationsPort의 제출/조회/status HTTP 위임, 할당 전 미디어 거절의 null 세대, await 중 drain의 입장 차단과 B 소유 활동 snapshot을 실제 E 포트와 검증한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 초대 기반 방 참가 API와 시도 제한
```

**MR 본문에 채울 변경 사항**

- 세션입장HTTP계약
- 초대우선rate와HTTP/WSS Origin검사
- SessionRequest 분기·미디어 준비 실패 형태·OperationsPort 위임·drain 중 입장 경쟁 처리

**MR 리뷰 포인트**

- webhook rawbody를일반JSON파서가소비하지않는지
- NAT IP단위로정상참가전체를차단하지않는지
- 할당 전 rejected/null을 가짜 receiverGeneration으로 바꾸거나 202를 완료로 해석하지 않는지

**완료 인계**

- C에세션성공/실패fixture와joinOrCreateoptions전달
- E에미디어grant/report/webhookrouterfactory조립계약,F에env/trustproxy요청
- C에 생성/참가 strict 요청 fixture, E/F에 OperationsPort HTTP 매핑·getGameActivity snapshot·drain await 경합 시험을 전달한다. CONTRACT_READY fixture와 실제 E 모듈 결합 완료는 분리한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/AC-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-08

**AC-03 · [BE] 논리 세션과 중복 접속 처리**  
일정: D1 2026-09-08 · **오늘 8번**  
기획 근거: v0.0.8 **18장**  
선행 완료 결과: [B-06](b-game-server.md#b-06) (AC-01, D1)

**수정·생성 파일**

- `server/src/session/ProductSessionStore.ts`
- `server/src/session/session-types.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/bootstrap.ts`

**구현 순서**

1. 개발1회용 SessionStore는sandbox용으로남기고ProductSessionStore에난수논리playerId/sessionId·tokenHash·inviteId·roomCode·expiresAt·activeConnectionId를저장한다. nickname을신원키로쓰지않는다.
2. joinAuth에서세션scope/만료/제품버전을검사하고activeConnectionId가없을때만원자점유한다. 이미연결된같은세션은새연결을거절하고기존연결을내쫓거나추가슬롯을만들지않는다.
3. 유효활동시세션유효기간을정책의2시간이내로갱신하되단순토큰반복제출로활동을위조하지못하게한다. 방종료/강퇴는레지스트리에서무효화하고게임진행중새연결재개는거절한다.
4. BHTTP미디어grant/report에서도같은세션검사를재사용한다. logicalplayerId와ColyseussessionId를명시적으로매핑해소켓종료시매치기록을삭제하지않는다.

**연결 계약과 경계**

- 반환sessionToken은C메모리에만보관. expiresAt은HTTPepoch밀리초로고정하고게임monotonic시간과구분해문서화.
- 2시간활동갱신정책은leaseTTL로한곳에정의하고A는세션만료를읽지않는다.

**시험 입력 → 기대 결과**

- 같은세션두브라우저동시join ->1개성공/1개거절,슬롯1개.
- nickname동일한두정상세션 ->서로다른playerId로입장가능.
- 만료또는방종료후이전token으로join/grant ->거절;진행중close후새join ->복원거절.

**추가·보완할 시험 파일**

- `server/test/session/product-session.test.ts`
- `server/tests/session.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/session/product-session.test.ts
pnpm exec vitest run server/tests/session.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

난수 playerId/sessionId를 Room·초대 범위에 묶는다. 최대 2시간·활동 갱신·방 종료 무효화와 동일 세션 중복 입장 거절을 검사한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 논리 세션과 중복 접속 제어
```

**MR 본문에 채울 변경 사항**

- 초대/Room에묶인제품세션
- 개발1회용토큰과수명분리

**MR 리뷰 포인트**

- 기존sandboxSessionStore동작유지
- 소켓ID를게임playerId로다시사용하지않는지

**완료 인계**

- C에메모리token·expiresAt·중복거절계약전달
- E에세션검증후trustedplayercontext공급인터페이스인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/AC-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-09

**AC-04 · [BE] 방·서비스 슬롯 상한 적용**  
일정: D1 2026-09-08 · **오늘 9번**  
기획 근거: v0.0.8 **02, 18, 22장**  
선행 완료 결과: [B-07](b-game-server.md#b-07) (AC-02, D1), [B-08](b-game-server.md#b-08) (AC-03, D1)

**수정·생성 파일**

- `server/src/session/RoomAdmission.ts`
- `server/src/session/SlotRegistry.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/bootstrap.ts`

**구현 순서**

1. 개발단일active필드를서비스Room/슬롯레지스트리로확장하고roomCode별같은ColyseusRoom이선택되도록server.define.filterBy와sessionRoomscope검사를연결한다. 동시에같은코드로요청해도두Room을만들지않도록create예약을직렬화한다.
2. RESERVED/JOINED/RETIRING등슬롯수명을구분해LOBBY/연습/경기/결과/미디어정리대기까지논리점유를합산한다. 방당6명·서비스60명·현재검증된Room상한을동시에검사한다.
3. 미디어가한번도없는실패예약은해제할수있지만E회수미확인세대가있는슬롯은OP-04확인전해제하지않는다. 같은논리플레이어의게임/미디어연결을중복슬롯으로세지도않고잔여원격점유를없다고보지도않는다.
4. production상한은F설정의검증된방수로시작한다. 스펙목표10방을검증없이기본활성화하지않고부하시험은격리된테스트profile로설정한다.

**연결 계약과 경계**

- B슬롯수명과E예산예약은별도상태이며retirement확인control로만최종해제.
- 신규 참가와 빈자리 충원은 LOBBY/DEVICE_CHECK에서만 허용한다. TEAM_PRACTICE/MAP_FINALIZING/GAME_LOADING/COUNTDOWN/PLAYING/RESULT/ABORTED에는 새 참가자가 들어오지 못하며, FL-08이 새 라운드의 준비 단계로 전환한 뒤 다시 연다. 진행 중 동일 세션 재접속 거절 정책도 유지한다.

**시험 입력 → 기대 결과**

- 방에5명+동시2명join ->1명만추가/총6명.
- 서비스59슬롯+동시2예약 ->총60이하;RETIRING1개가남으면빈슬롯으로안센다.
- 동일roomCode동시join ->동일roomId,다른초대scope는거절.

**추가·보완할 시험 파일**

- `server/test/session/slot-registry.test.ts`
- `server/test/room/room-admission.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/session/slot-registry.test.ts
pnpm exec vitest run server/test/room/room-admission.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

로비·연습·경기·결과를 합산한 방당 6명·서비스 최대 60슬롯을 검사한다. 방 상한은 검증된 단계의 설정값을 사용하며 동시 입장으로 초과하지 않는다. 미디어 예약 해제는 OP-04에 연결한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 방과 서비스 슬롯 상한 적용
```

**MR 본문에 채울 변경 사항**

- roomCode원자선택과다중Room용량
- 미디어회수전슬롯점유유지

**MR 리뷰 포인트**

- 전역Room객체가앱테스트간남지않는지
- 회수미확인/실패예약해제를같게취급하지않는지

**완료 인계**

- E OP-04에releaseConfirmed만호출가능한slot接口인계
- F QA-10에상한1/3/5/10테스트설정,C에6슬롯로비자료전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/AC-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-10

**SV-06 · [BE] 게임 서버 heartbeat와 권위 상실 신호**  
일정: D1 2026-09-08 · **오늘 10번**  
기획 근거: v0.0.8 **17.1, 24장**  
선행 완료 결과: [B-01](b-game-server.md#b-01) (SV-01, D1), [B-08](b-game-server.md#b-08) (AC-03, D1)

**수정·생성 파일**

- `packages/protocol/src/game-messages/heartbeat.ts`
- `packages/protocol/src/game-messages/index.ts`
- `server/src/game/Heartbeat.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/game/ClockSync.ts`

**구현 순서**

1. game-heartbeat {serverEpoch,matchId,heartbeatSeq,serverTick,serverTimeMs}를2초마다보내고연결별마지막유효ack시각을monotonic으로기록한다. serverEpoch는프로세스시작한번만생성한다.
2. game-heartbeat-ack의epoch/match/seq를현재발송범위와대조하고구판·중복·미발송미래seq는생존갱신으로인정하지않는다. LiveKit자체heartbeat와미디어report는대체응답이아니다.
3. 마지막유효ack후6초이상또는socketclose즉시에ControlIntent {type:CONNECTION_LOST,playerId}를 플레이어별 한 번 큐에 넣는다. 그자리에서Astate를삭제/패배처리하지않고RL-08이같은Tick종료우선순위를결정한다.
4. Room dispose/개인종료뒤실제세션종료시타이머·ack레지스트리를정리한다. 종료자의close도control은전달할수있지만남은경기무효로미리판정하지않는다.
5. clock-probe {probeId,clientSentAtMs}를 공통 ClockProbe strict 스키마로 검증한다. probeId는 문자열, clientSentAtMs는 유한 number이며 추가 필드·NaN/Infinity는 거절한다. clientSentAtMs는 불신 입력을 그대로 echo하는 용도이고 서버 현재 시각과 크기를 비교하거나 epoch인지 추측해 승인하지 않는다. 이 값으로 게임 상태·TTL·생존 시각을 갱신하지 않는다.
6. 핸들러 진입 시 serverReceivedAtMs, 응답 직전 serverSentAtMs를 같은 서버 monotonic clock에서 읽어 clock-reply {probeId,clientSentAtMs,serverReceivedAtMs,serverSentAtMs,serverEpoch}를 해당 연결에 보낸다. 연결별 1초 최대 5회로 초기 250ms 간격 5회 측정을 허용하고 초과 probe는 안전하게 제한한다. 정상 클라이언트는 공통 규칙대로 10초마다 재측정한다. 이 채널은 게임 명령 큐/command-outcome 대상이 아니다.

**연결 계약과 경계**

- heartbeat는 권위 연결 생존 신호, clock-probe/reply는 표시용 시각 오프셋 추정이다. 서버 응답 시각은 monotonic ms이며 JWT epoch와 혼합하지 않는다. 클라이언트가 보낸 유한 시각은 echo만 하고 서버 판정 근거로 사용하지 않는다.
- 명시적socketclose는6초를기다리지않고큐로전달.

**시험 입력 → 기대 결과**

- 정상2초ack반복 ->활동자유지.
- 구epochack또는미발송seq만수신 ->유효생존갱신없고6초에control1개.
- 5.9초정상후close ->즉시이탈의도;이미ESCAPED인사용자는A가계속경기를판정.
- 서버 fake monotonic 수신=100/송신=102와 유효 probe → 두 서버 시각·동일 probeId/clientSentAtMs·현재 serverEpoch의 reply. 클라이언트 시각 크기가 서버와 달라도 게임 상태·서버 시각은 불변이다.
- 초기 250ms 간격 5개 probe → 모두 응답 가능; 동일 1초 창의 6번째 → 제한. 10초 뒤 정상 재측정 허용, probe 수신은 heartbeat ack를 대신하지 않는다.
- NaN/Infinity·추가 필드·문자열이 아닌 probeId → 안전 거절과 상태 불변; socket close는 {type:CONNECTION_LOST,playerId} 한 개로 A에 전달한다.

**추가·보완할 시험 파일**

- `server/test/room/heartbeat.test.ts`
- `packages/protocol/test/heartbeat.test.ts`
- `server/test/room/clock-sync.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/heartbeat.test.ts
pnpm exec vitest run server/test/room/clock-sync.test.ts
pnpm exec vitest run packages/protocol/test/heartbeat.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

2초마다 serverEpoch/matchId/heartbeatSeq를 전송한다. 서버도 유효 응답 시각을 추적해 6초 무응답·socket close를 권위 큐의 이탈 의도로 전달한다. 과거 세대·LiveKit heartbeat로 게임 생존을 대체하지 않는다. 최종 무효/계속 판정은 RL-08에서 한다. 별도 clock-probe/reply의 strict 검증·서버 수신/송신 monotonic 시각·초기 5회와 정상 재측정 제한을 실제 C 오프셋 소비자와 검증한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 게임 서버 heartbeat와 연결 상실 감지
```

**MR 본문에 채울 변경 사항**

- epoch/match별생존확인
- 6초무응답과즉시closecontrol
- heartbeat와 분리된 clock-probe/reply 서버 처리 및 불신 클라이언트 시각 격리

**MR 리뷰 포인트**

- 타이머개수/중복이탈의도
- 서버와클라이언트monotonic절대값직접비교없는지

**완료 인계**

- C FL-10에heartbeat/ackJSON과6초cleanup기준인계
- A RL-08에단일이탈control,F QA-05에SIGKILL시나리오전달
- C SessionRuntime에 clock reply의 실제 서버 handler fixture와 비대칭 지연 표본을 전달해 RTT/offset 계산·serverEpoch 변경 폐기를 연결한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/SV-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-11

**SV-07 · [BE] 개인 사건 버전·중복과 뷰 재동기화**  
일정: D1 2026-09-08 · **오늘 11번**  
기획 근거: v0.0.8 **17장**  
선행 완료 결과: [B-01](b-game-server.md#b-01) (SV-01, D1), [B-02](b-game-server.md#b-02) (SV-02, D1)

**수정·생성 파일**

- `packages/protocol/src/game-messages/events.ts`
- `packages/protocol/src/game-messages/index.ts`
- `server/src/game/EventDispatcher.ts`
- `server/src/game/PlayerProjection.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/test/protocol/command-outcome.test.ts`

**구현 순서**

1. private-event는 공통 PrivateEvent의 matchId/gameScope/eventId/tick/stateVersion/type/payload로 포장한다. gameScope는 사건이 발생한 논리 gameInstanceId/kind와 해당 수신자에게 유효했던 revision이며 B 레지스트리에서 고정한다. A/E의 허용 audience에게만 전달하고 전역 broadcast 후 클라이언트 숨김을 사용하지 않는다. none scope에서는 공간 사건을 발행하지 않는다.
2. private-view는 최초/내용 변경/scope 전환/공개 phase 전환/resync 때 전체 replace이며 KN-04의 허용 뷰만 직렬화한다. 공개 phase 전환 때는 내용이 같아도 전환 stateVersion 이상의 전체 뷰를 한 번 보낸다. 사건에 뷰 변경이 필요하면 새 뷰 버전을 참조하고, 필요 없으면 수신자에게 마지막으로 보낸 뷰 버전을 참조한다. 일반 전역 stateVersion만 증가한 사건을 미래 뷰 대기로 만들지 않는다. 뷰 제공자가 없을 때 전체 권위 state를 대신 보내지 않는다.
3. view-resync {matchId,lastStateVersion}를 strict 검증하고 연결별 rate limit과 동일 요청 coalescing으로 현재 scope의 개인 전체 뷰 한 개를 다시 직렬화한다. 응답 stateVersion은 현재 권위 버전이며 해당 phase 전환 하한 이상이어야 한다. 내용이 같아도 옛 cached stateVersion의 뷰를 그대로 재전송하지 않는다. 틀린 match/종료자 요청은 허용된 최소 뷰 또는 안전 거절로 처리한다.
4. C의미래event큐상한64개/1초·중복폐기를검증할송수신fixture를만든다. eventid재전송은가능해도중복게임효과를만들지않으며오래된매치event를새매치에재발행하지않는다.
5. command-outcome은 일반 효과 사건과 별도 채널로 요청자에게만 발송한다. A CoreOutcome에 수신자의 applicableStateVersion을 붙이고 원장을 pending→done으로 저장한다. 실패로 뷰가 불변이면 마지막 유효 뷰 버전을 사용해 새 private-view 대기를 만들지 않는다. phase 명령도 같은 발송 경로를 사용한다.
6. request-status-result는 인증자의 원장을 조회해 pending/done/unknown과 원래 outcome을 반환한다. outcome 재전달은 가능하지만 상태 변경·사건 재생은 금지한다. EXCHANGE/INSTALL/EXIT의 규칙 거절에서 payload 변화 없이도 C의 pending이 종료되는 실제 처리기 연결 시험을 붙인다.

**연결 계약과 경계**

- HUNTER_MARKER는payload.point{x,y}가반셀소수가능하고현재Cell정수검사와분리.
- self종료최소뷰/허용별eventenum은KN-04와공통스키마로고정. B는Ainternalpayload전체를spread하지않는다.
- media-bindings는 수신자의 {matchId,mediaInstanceId,receiverGeneration,bindingRevision}와 참가자별 publisherGeneration/SID를 보존해 전용 채널로 전달한다. audio-policy도 같은 scope와 policyRevision/bindingRevision을 보존한다. WS와 트랙의 도착 순서를 가정하지 않고 D의 재대조 처리기 연결을 확인한다.
- 늦은 사건을 현재 gameScope/revision으로 재포장하지 않는다. 원래 scope가 폐기되면 송신을 중단하고 C의 미래 scope 사건은 해당 full view 도착까지 최대 64개/1초만 보관한 뒤 resync하도록 같은 사례를 인계한다.

**시험 입력 → 기대 결과**

- 술래대상흔적 ->술래만수신,도망자에payload없음.
- 구matchresync ->새매치전체state누출없이거절.
- 같은private-event2회 ->동일eventId;Cfixture에선효과1회,미래version은view도착까지대기후만료시resync.
- accepted EXIT_START 후 A rejected + 개인 뷰 변화 없음 → 현재 유효 버전의 command-outcome 즉시 전송, C pending 해제. 같은 응답 재전달은 UI 효과/행동을 중복하지 않는다.
- 완료 응답 전송 누락을 주입하고 request-status 조회 → done과 원래 outcome으로 회복; 처리 전이면 pending/null, 다른 인증자 요청 ID는 unknown/null이다.
- 원격 트랙이 먼저 도착한 뒤 B의 media-bindings/audio-policy가 도착 → D가 저장된 트랙을 재대조해 허용된 트랙만 연결한다. 바인딩과 정책의 순서를 뒤집어도 같은 결과이며 구 scope/낮은 revision은 적용하지 않는다.
- 연습 revision1 사건이 none2 또는 game3 전환 후 도착 → 옛 scope로 구분되어 현재 지도·음향·포즈에 적용되지 않는다. 현재 scope의 사건이 대응 full view보다 먼저 오면 C가 유한 큐에 보관하고 view 일치 후 한 번만 적용한다.
- 공개 phase 전환으로 C가 비운 뒤 current view를 잃어 1초 후 view-resync 요청 → 현재 권위 stateVersion과 현재 scope로 새 full view를 반환해 전환 하한을 통과한다. 캐시에 이전 phase 버전만 남아 있어도 이를 그대로 돌려주는 반복 resync 상태를 만들지 않는다.

**추가·보완할 시험 파일**

- `packages/protocol/test/product-events.test.ts`
- `server/test/protocol/event-dispatcher.test.ts`
- `server/test/protocol/command-outcome.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/protocol/test/product-events.test.ts
pnpm exec vitest run server/test/protocol/event-dispatcher.test.ts
pnpm exec vitest run server/test/protocol/command-outcome.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

허용 개인 사건·뷰 재동기화와 요청자 전용 명령 종결/상태 조회를 연결한다. 뷰가 바뀌지 않은 규칙 거절도 pending을 끝내며 event/outcome 중복·구판·도착 순서 오류를 실제 C 처리기와 함께 검증한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 계약 fixture 통과와 실제 생산자·소비자 연결 시험 통과를 구분해 진행 기록과 MR 본문에 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 사건 버전과 뷰 재동기화 계약
```

**MR 본문에 채울 변경 사항**

- audience고정사건과전체replace개인뷰
- resync제한과순서fixture

**MR 리뷰 포인트**

- 허용뷰미완상태를전체snapshot으로대체하지않는지
- 과거사건좌표와현재위치필드를구분하는지

**완료 인계**

- C SessionRuntime에메시지명/버전/큐정책fixture인계
- A KN-08/E음향에안전이벤트변환기와F G4packet수집hook전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/SV-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-12

**FL-01 · [BE] 6인 준비 단계와 역할 배정**  
일정: D1 2026-09-08 · **오늘 12번**  
기획 근거: v0.0.8 **04, 05장**  
선행 완료 결과: [B-09](b-game-server.md#b-09) (AC-04, D1), [B-01](b-game-server.md#b-01) (SV-01, D1)

**수정·생성 파일**

- `server/src/rooms/LobbyCoordinator.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `packages/protocol/src/game-schema/product.ts`
- `packages/protocol/src/game-messages/room.ts`

**구현 순서**

1. 6명논리슬롯확보전에는LOBBY를유지하고6명확보시DEVICE_CHECK로전환한다. 기존players.length>=2 ready코드는제품경로에서제거하며legacy개발adapter에만남긴다.
2. READY {ready} 자체를 DEVICE_CHECK의 로컬 장치 점검 완료/철회 신고로 수용한다. 인증한 본인 boolean만 갱신하고 같은 값은 멱등 applied로 처리한다. 별도 장치 보고나 서버 웹캠 증명을 요구하지 않는다. 다른 단계는 INVALID_PHASE이며 6명 연결과 전원 ready=true가 충족되어야 전환한다.
3. 첫 경기 또는 lobby 모드의 새 준비는 서버 seed로 3runner/3tagger를 배정하고 개인 뷰에 자기 role만 전달한다. FL-08의 same/swap 재경기이면 B MatchContext의 다음 역할 계획을 소비하고 여기서 다시 무작위로 덮어쓰지 않는다. 전원 로컬 장치 준비 신고를 확인한 뒤 TEAM_PRACTICE 전환 때 역할별 논리 instance를 결정하며 전역 역할표를 적팀에 공개하지 않는다.
4. room-roster {matchId,stateVersion,phase,hostId,players:[{playerId,nickname,ready,connected}]}를 현재 준비 단계의 변경 때 전송한다. ready는 해당 단계의 준비값이며 role/coords/exit는 포함하지 않는다. 공용 게임 위치 Schema와 분리하고 C가 같은 계약을 소비하는 시험을 붙인다.
5. 접수와 Tick 적용 사이 phase가 바뀌면 게임 상태를 바꾸지 않고 INVALID_PHASE rejected command-outcome을 반환한다. READY 적용 또는 동일 값의 멱등 확인은 applied 한 개다. ready=false 신고/이탈 시 준비 장벽을 다시 평가하며 다른 사람의 준비값을 대신 갱신하지 않는다.

**연결 계약과 경계**

- READY/PRACTICE_READY/LOAD_READY는다른단계의독립확인이다. ready한번으로모든로딩/미디어를통과시키지않는다.
- 로비roster는대기단계UI용;PLAYING의visibleEntities계약에닉네임/적role를그대로복사하지않음.
- room-roster의 matchId/stateVersion으로 구판 목록을 폐기하며 PLAYING에서 roster가 적 이름표·위치 정보의 대체 경로가 되지 않게 한다.
- READY는 브라우저 장치 점검 신고다. 서버 보장은 인증자·인원·단계·신고 상태 검사이며 실제 카메라 동작의 독립 증명이나 이후 LiveKit 준비 보장을 의미하지 않는다.

**시험 입력 → 기대 결과**

- 2명 또는 5명 → DEVICE_CHECK/경기 전환 없음; 단계 밖 READY는 명시적 거절이다.
- 6명 DEVICE_CHECK에서 자기 READY true → 본인 값만 변경, 전원 true가 되면 역할 3:3과 연습 전환 1회다.
- 동일 READY 반복 → 각 신규 요청은 멱등 applied, 역할 재배정/중복 전환 없음; ready=false는 현재 단계 준비 신고를 철회한다.
- READY accepted 뒤 처리 전 PLAYING 전환 → INVALID_PHASE rejected outcome 1개, 서버는 별도 웹캠 보고를 기다리지 않는다.

**추가·보완할 시험 파일**

- `server/test/room/lobby-ready.test.ts`
- `packages/protocol/test/room-roster.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/lobby-ready.test.ts
pnpm exec vitest run packages/protocol/test/room-roster.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

LOBBY→DEVICE_CHECK의 서버 전이와 3:3 역할 배정을 구현한다. 현재 2명 ready로 시작하는 개발 조건을 제품 모드에서 제거하고, 6명 미만·중복 ready·단계 밖 요청을 거절한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 6인 준비 단계와 서버 역할 배정
```

**MR 본문에 채울 변경 사항**

- 제품6인장벽과3:3역할
- 준비상태/로비정보의분리

**MR 리뷰 포인트**

- 간이2명개발시작이제품경로에남지않는지
- 다른사람ready/장치상태를clientplayerId로설정못하는지

**완료 인계**

- C AC-06/FL-02에roster·자기role·준비거절예시를D1중인계
- A/BFL-03에역할별3명instance입력과전이control전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/FL-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-13

**AC-05 · [BE] 대기 방 정리와 방장 위임**  
일정: D1 2026-09-08 · **오늘 13번**  
기획 근거: v0.0.8 **18, 22, 24장**  
선행 완료 결과: [B-09](b-game-server.md#b-09) (AC-04, D1)

**수정·생성 파일**

- `server/src/session/RoomExpiry.ts`
- `server/src/session/SlotRegistry.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/bootstrap.ts`

**구현 순서**

1. LOBBY/DEVICE_CHECK의 마지막 유효 활동 시각과 세션 expiresAt을 추적해 만료/빈방/장기방치를 정리한다. 방치 TTL은 F의 `ROOM_IDLE_TTL_MS → AppConfig.roomIdleTtlMs` 필수 양의 safe integer를 사용한다. 운영값이 없으면 production 준비 실패로 기록하고 현재 진행 매치를 로비 타이머로 삭제하지 않는다.
2. 경기전방장close/만료시남은정상세션중서버가입순번최초자를새방장으로선정한다. 방장권한은로비/재경기전환요청에한정하며포획/승패판정을위임하지않는다.
3. 로컬게임접속종료는control로알리고미디어가있는슬롯은E retireGeneration을요청해RETIRING으로남긴다. 원격정리성공control뒤에만AC-04점유를해제하고실패/UNKNOWN은예약을보존한다.
4. 빈방삭제와초대/세션무효화를멱등하게연결하고Roomdispose가두번호출돼도다른방슬롯을풀지않는다. 진행중퇴장/개인종료후보충입장은다음매치전까지계속거절한다.

**연결 계약과 경계**

- 현재참가자연결객체와A매치기록을분리;B는onLeave에서Aplayers를삭제하지않음.
- E회수결과가없는pureunit는정리의도까지만완료;실제통합은MC-07/OP-04인계뒤검증.

**시험 입력 → 기대 결과**

- 경기전방장A이탈,정상B/C남음 -> B위임,다른슬롯유지.
- 미디어RETIRING상태에서cleanup반복 ->slot예약유지/회수중복키동일.
- 종료도망자퇴장+진행매치빈자리 ->신규참가거절,개인결과기록유지.

**추가·보완할 시험 파일**

- `server/test/session/room-expiry.test.ts`
- `server/test/room/host-transfer.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/session/room-expiry.test.ts
pnpm exec vitest run server/test/room/host-transfer.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

만료·빈 방·장기 방치 슬롯을 정리하고 경기 전 방장 이탈 시 남은 사람에게 위임한다. 진행 중 충원은 거절하며 실제 원격 미디어 정리는 MC-07에 위임한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 대기 방 정리와 방장 위임
```

**MR 본문에 채울 변경 사항**

- 만료/방치정리와멱등slot해제
- 게임판정권한없는방장위임

**MR 리뷰 포인트**

- 원격회수미확인예약을빈방삭제로잃지않는지
- 타이머가다음matchId에적용되지않는지

**완료 인계**

- C AC-06에host변경/slot상태자료인계
- E OP-04에정리완료control연결,F에방치TTL설정요청

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/AC-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-14

**KN-04 · [BE] 수신자별 상태 projection**  
일정: D2 2026-09-09 · **오늘 1번**  
기획 근거: v0.0.8 **04, 08, 09, 17장**  
선행 완료 결과: [A-17](a-game-core.md#a-17) (KN-02, D1), [A-18](a-game-core.md#a-18) (KN-03, D1), [B-11](b-game-server.md#b-11) (SV-07, D1)

**수정·생성 파일**

- `packages/protocol/src/game-schema/product.ts`
- `server/src/game/PlayerProjection.ts`
- `server/src/game/EventDispatcher.ts`
- `server/src/rooms/KkakkungRoom.ts`

**구현 순서**

1. A getPlayerKnowledge/getVisibleEntities/getPlayerSelf/getVisibleSurfaces를 호출해명시적allowlist로PrivateView를만든다. floor{x,y,kind}와wall{x,y,kind,side}를구분하고전체맵객체를spread하지않는다.
2. self에는 자기 cell/dir/action/status/role·술래 장비·구속·도전·설치·교환 상태만 담는다. visibleEntities는 player/sensor/trap discriminated union으로 만들고 각종 현재 관찰 자격을 검사한다. sensor는 접근 cell과 wall:{x,y,side}가 필수이고 trap에는 wall을 보내지 않는다. 적 role/이름표는 제거하고 아군 표식에 필요한 role만 허용한다.
3. 도망자의 knownActiveExits는 발견한 현재 active 집합이고 술래에게는 빈 배열을 보낸다. self.ownedEquipment는 해당 설치자의 장비만 ID·kind·cell·wall·state·armedTick 허용 목록으로 변환한다. UNARMED/ARMED/SPENT를 구분하고 소유자 개인 종료/새 라운드에는 비운다. 다른 술래 장비나 작동 대상 신원을 추가하지 않는다.
4. 종료자는 최소 self 결과와 공개 counts만 유지하고 지형·엔티티·미디어 허용 정보를 계속 받지 않는다. 개인 뷰는 초기 전송, 실제 허용 내용 변경, scope/공개 phase 전환, 명시적 resync 때 전체 replace로 보낸다. 공개 phase가 바뀌면 C가 화면을 비우므로 내용·scope가 같아도 전환 stateVersion 이상의 전체 뷰를 한 번 전송한다. 일반 전역 stateVersion 증가만으로 같은 뷰를 재전송하지 않으며 삭제·폐쇄·시야 이탈은 변경된 전체 뷰에 반영한다.
5. 새매치/초기/resync/개인종료의실제직렬화JSON을세역할fixture로검사한다. production에서기존GameState.maze/players공유필드가전송되지않는것도Room통합으로확인한다.
6. PrivateView.gameScope에 B 레지스트리의 GameViewScope를 붙인다. 논리 공간 진입/퇴장 시 revision을 먼저 증가시키고 전환 사실을 완전한 새 뷰로 전송한다. none에서는 gameInstanceId:null/kind:none과 self:null·빈 지형/출구/가시 셀/벽면/엔티티를 보낸다. core가 없다는 이유로 전송을 생략하거나 연습 데이터를 남기지 않는다. phase 변경의 stateVersion도 C가 폐기 장벽으로 적용하도록 함께 보낸다.

**연결 계약과 경계**

- mapVersion은지식/활성출구변경, stateVersion은권위반영. visibleCells/visibleWallFaces는현재FOV이고knownTerrain는기억이다.
- protocol0.2.0 self와가시entity의nullable/optional필드목록을C/D와고정한뒤소비자를검사.
- 공통 self는 equipment/ownedEquipment/restraintUntilTick/restraintImmuneUntilTick/installation/exchange/challenge/loading을 사용한다. exchange는 null 또는 {exchangeId,fromPlayerId,toPlayerId,direction:incoming|outgoing,expiresAtTick}이며 인증 수신자 기준으로 방향을 계산한다. challenge.poseKind는 left/right/y, startedAtTick/minSuccessTick/expiresAtTick을 쓴다. 내부 core 이름은 B allowlist adapter에서 한 번만 변환한다.
- B는 A 내부 State 필드에 접근하지 않고 CorePort selector를 사용한다. getPlayerSelf의 loading:null에는 B가 소유한 LoadingView를 결합하며 loadId/mediaInstanceId/receiverGeneration/initialViewVersion/assetVersion을 공통 타입 그대로 보낸다.
- ActiveGameScope는 gameInstanceId/kind(practice|game)/revision이며 미디어 세대와 독립이다. B는 A CoreReadFrame.gameInstanceId와 수신자 scope를 확인한 뒤 뷰를 만들고, 같은 matchId의 지식 전체 교체도 scope 변경이면 반드시 전송한다.

**시험 입력 → 기대 결과**

- 술래가출구벽과다른도망자미탐색통로근처 ->출구/미관찰지형/시야밖좌표미전송.
- 엔티티 시야 이탈 또는 소모 장비의 관찰 자격 종료 ->새전체뷰에서해당엔티티제거.
- 개인종료후다른플레이어이동/resync ->종료자에게새지도/위치/음향정보없음.
- 다른 술래가 설치한 관찰 가능한 sensor → 정확한 wall/side 포함, owner의 전체 장비 목록은 제외; 관찰 불가능하면 sensor 자체를 제외한다. C가 부착 면을 추측하지 않아야 한다.
- A→B 교환 요청 → A self.exchange.direction=outgoing, B=incoming; C/D의 incomingExchangeId는 B만 갖고 A의 수락 시도는 core에서 거절한다.
- practice revision1 → none2 전환: 빈 full view와 self:null 송신으로 기존 지도·엔티티가 제거된다. 이후 game3 진입에서 늦은 practice view/event가 들어와도 C가 scope 및 phase/stateVersion 장벽으로 폐기한다. 같은 game의 미디어 재연결에는 지도 초기화가 없다.
- GAME_LOADING→COUNTDOWN→PLAYING에서 gameScope·좌표·지식이 같아도 각 phase 전환 stateVersion 이상의 전체 private-view를 한 번 보낸다. C는 공개 phase 장벽을 통과한 현재 뷰를 적용하고 resync timeout까지 빈 화면으로 기다리지 않는다. 같은 phase의 일반 stateVersion 증가만으로는 재전송하지 않는다.

**추가·보완할 시험 파일**

- `server/test/protocol/private-view.test.ts`
- `server/test/room/product-payload.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/protocol/private-view.test.ts
pnpm exec vitest run server/test/room/product-payload.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

전체 maze/players 공개를 제거하고 공용 상태와 개인 self/knownTerrain/knownActiveExits/visibleEntities를 분리한다. 가시 캐릭터·감지기·덫의 공개 계약을 제공하며 실제 객체는 술래 장비 작업과 연결한다. 감지기 wall 필수와 교환 incoming/outgoing을 검사한다. 시야 이탈·개인 종료·뷰 재전송의 누출을 직렬화로 검사한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 수신자별 지식과 가시 상태 투영
```

**MR 본문에 채울 변경 사항**

- 전체개발맵전송제거와allowlist뷰
- 종료자/시야이탈/폐쇄의전체교체

**MR 리뷰 포인트**

- 서버전용객체참조/적role가직렬화에섞이지않는지
- 벽face side와현재FOV마스크분리

**완료 인계**

- C KN-09/KN-10/VI-03/EQ-11과 D IN-09에 정확한 self/entity JSON fixture 인계
- F QA-08에Schema+개인메시지캡처결과와금지키목록전달
- A의 실제 sensor/교환 결과를 B가 직렬화하고 C/D가 소비하는 연결 시험을 각 소유자와 수행한다. 문서 JSON 자체의 타입 검사만으로 렌더/수락 통합 완료를 주장하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/KN-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-15

**FL-03 · [BE] 팀별 연습 인스턴스와 종료**  
일정: D2 2026-09-09 · **오늘 2번**  
기획 근거: v0.0.8 **05장**  
선행 완료 결과: [B-12](b-game-server.md#b-12) (FL-01, D1), [B-11](b-game-server.md#b-11) (SV-07, D1), [A-01](a-game-core.md#a-01) (MP-01, D1), [A-09](a-game-core.md#a-09) (RL-01, D1), [E-16](e-media-operations.md#e-16) (MC-08, D2). 실제 연습의 전체 인수는 A-10·16–27의 사용 기능 연결도 필요하다.

**수정·생성 파일**

- `server/src/rooms/PracticeCoordinator.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/game/MatchDriver.ts`

**구현 순서**

1. 한 Colyseus Room 안에 팀별 gameInstanceId로 구분한 practice state 두 개를 만든다. B가 서버 전용 practice-v1.json을 읽어 파싱한 raw와 실제 역할별 players를 A `preparePracticeLayout(raw,players,role)`에 전달한다. PracticeLayoutResult.ready의 현재 ID로 바인딩된 layout만 CreatePracticeInput에 넣어 A createPractice를 호출한다. invalid이면 준비로 복귀하며 정적 슬롯을 그대로 참가자로 쓰지 않는다. 각 논리 공간에는 최대 3명만 넣고 본 경기 맵 선발기/거리 조건을 연습에 적용하거나 A에 mediaInstanceId를 넘기지 않는다.
2. 인증플레이어가속한연습instance로명령/개인뷰/음향frame을라우팅하고다른팀과상호작용대상이나트랙권한을교차시키지않는다. A practice모드에서는포획/승패만끄고이동/지도교환/술래 장비는실제함수를재사용한다.
3. PRACTICE_READY전체확인시조기종료하고최대60초에서는장치준비자만다음단계후보로보낸다. 장치미준비자가있으면DEVICE_CHECK로복귀하며시간경과로준비상태를위조하지않는다.
4. 종료 때 각 참가자의 scope revision을 증가시켜 none으로 바꾸고 빈 PrivateView를 먼저 발행해 연습 지도·엔티티를 지운다. 연습 state/술래 설치물/지식/좌표를 폐기하고 미처리 연습 명령은 canceled로 종결한다. E MC-08의 구 mediaInstanceId/세대 회수→신세대 준비는 별도 대응표로 관리하며 회수 불명 상태에서 본 경기 토큰을 발급하지 않는다.

**연결 계약과 경계**

- A의 preparePracticeLayout/createPractice와 연습 JSON은 A 소유다. B는 MP-01/RL-01 public export로만 연결하고 A의 파일을 수정하지 않는다. 실제 회전·지식·교환·장비 연습의 인수는 해당 A 후속 규칙이 연결된 뒤 확인하며 createPractice 존재만으로 모두 구현되었다고 계산하지 않는다.
- gameInstanceId는 A/B/C가 구분하는 논리 공간이며 mediaInstanceId는 B/E/D가 회수하는 미디어 공간이다. B가 대응을 소유하고 LiveKit roomName/identity에 역할 이름을 넣지 않는다.
- PRACTICE_READY는 B가 적용한 신고 결과를 applied/rejected outcome으로 끝낸다. 연습 종료로 아직 미처리인 연습 명령은 canceled이며 새 game instance로 이월하지 않는다.

**시험 입력 → 기대 결과**

- 3runner+3tagger ->각instance3명,교차지도요청/음성수신없음.
- 연습에서캐릭터접촉/180초판정함수호출 ->포획/승패없음.
- 전원연습준비45초 ->조기종료;60초장치미준비 ->준비복귀,본경기강제시작없음.
- 팀별 practice는 서로 다른 gameInstanceId를 갖고 각 참가자는 none0→practice1→none2의 scope를 받는다. 연습 퇴장 즉시 빈 뷰로 지도를 지우며 늦은 revision1 사건은 다음 단계에 재전송하지 않는다.
- A의 실제 practice JSON과 preparePracticeLayout을 연결하면 정적 슬롯 대신 현재 참가자 ID만 core에 들어간다. 역할 혼합/4명/잘못된 자료는 준비로 복귀하고 서로 다른 두 공간이 같은 상태 객체를 공유하지 않는다.

**추가·보완할 시험 파일**

- `server/test/room/practice.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/practice.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

한 게임 Room 안에 팀당 최대 3명의 별도 논리 연습 공간을 둔다. 고정 소형 맵·포획/승패 없음·최대 60초/전원 준비 조기 종료를 검사한다. 장치 미준비를 시간만으로 강제 통과시키지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 팀별 연습 인스턴스와 전환 제어
```

**MR 본문에 채울 변경 사항**

- 팀별논리맵·명령격리
- 60초/전원준비와자원초기화

**MR 리뷰 포인트**

- 연습을별도공개게임Room으로늘려slot상한을우회하지않는지
- 모의연습도구로실제기능연습을대체하지않는지

**완료 인계**

- C FL-04와E MC-08에practiceinstance수명/팀격리frame전달
- A에createPractice/고정소형맵실제export가도착했는지확인후인계완료기록

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/FL-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-16

**FL-05 · [BE] 맵 확정과 로딩 준비 장벽**  
일정: D2 2026-09-09 · **오늘 3번**  
기획 근거: v0.0.8 **05, 10, 24장**  
선행 완료 결과: [B-15](b-game-server.md#b-15) (FL-03, D2), [A-05](a-game-core.md#a-05) (MP-05, D1), [B-14](b-game-server.md#b-14) (KN-04, D2), [E-16](e-media-operations.md#e-16) (MC-08, D2), [A-23](a-game-core.md#a-23) (EQ-01, D2)

**수정·생성 파일**

- `server/src/rooms/LoadingCoordinator.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/game/LayoutLoader.ts`
- `server/src/bootstrap.ts`

**구현 순서**

1. B loader가 서버 전용 master 파일의 원본 바이트 SHA-256을 계산하고 `{templateId,templateVersion,templateHash,variantId:'r0'}`와 파싱 본문을 A validateTemplate에 전달한다. MapTemplateResult.valid.template을 createTemplateVariants에 넣고 MapVariantsResult.valid.variants만 사용한다. invalid 또는 빈 variants는 준비로 복귀한다. 검증된 변형을 기본 문자열 variantId순으로 정렬하고 seed(uint32)%변형 수로 이번 LayoutTemplate 한 개를 선택한다. 같은 MapSource 4필드의 FallbackLayout을 짝지어 A certifyFallback(input)으로 인증한 뒤 selectWithFallback(input)을 실행한다. input은 template/players/seed/maxAttempts/fallback만 사용하며 A에 선배정 territories나 평면 후보를 보내지 않는다. 각 next 전후 monotonic budget 검사·최대 8개 후보·yield 뒤 setImmediate를 적용하고 시간 초과 시 return(certifiedResult)로 닫는다. 인증/선발 모두 실패하면 준비 단계에 안전 실패를 반환한다.
2. 성공한 MatchLayout의 topology/players/exits/territories와 술래 개인 장비로 새 본 경기 gameInstanceId를 생성하고 CreateMatchInput에 주입한다. 로비 라운드의 matchId와 연속 serverTick/stateVersion은 유지하며 참가자 scope는 none에서 새 game/revision으로 전환한다. 본 경기 loadId·미디어 세대는 별도로 갱신한다. 개인 초기 full view만 KN-04로 보내고 전체 맵·source hash·seed·fallback 원문을 공개하지 않는다.
3. E retireGeneration 확인 뒤 practice→game 새 세대를 prepare한다. 참가자마다 현재 LOAD_READY의 loadId/mediaInstanceId/receiverGeneration 신고와 E가 검증한 같은 scope의 media-bindings self 항목 faceTrackSid를 함께 검사한다. 수신자별 bindingRevision 최신값을 유지하고 구 scope의 self 게시를 현재 준비로 계산하지 않는다. 이는 서버가 현재 얼굴 트랙 게시를 확인하는 것이며 실제 처리된 얼굴 영상인지 독립 증명하는 것이 아니다. 클라이언트 신고만으로 원격 권한 적용을 확정하지 않는다.
4. 30초monotonic로딩기한이넘거나원격얼굴준비가실패하면진행loadId를무효화하고준비복귀/회수의도를만든다. 늦은ready/옛generation응답은새로딩장벽을열지못한다.
5. LOAD_READY는 현재 loadId·mediaInstanceId·수신자 receiverGeneration과 연결된 초기 뷰/자산 준비 계약을 검사하고 B가 applied/rejected outcome으로 종결한다. 신고 수용이 전체 로딩 장벽 통과나 Cloud 권한 확인을 의미하지 않는다. 로딩 취소/매치 종료의 미처리 명령은 canceled로 끝내고 새 장벽에 재사용하지 않는다.

**연결 계약과 경계**

- LayoutLoader는B의파일IO,선발알고리즘/콘텐츠는A,컨테이너포함경로는F.
- HTTPgrant/report라우트는B가Efactory에위임하고response직전세션/phase/loadId를다시확인.
- Generator의 SelectionProgress/LayoutSelectionResult와 fallback 인증 결과는 [공통 타입](contracts/types.ts)을 사용한다. B만 monotonic clock/setImmediate를 호출하고 A 순수 후보 검사에는 실제 시계 callback을 넣지 않는다.
- LayoutSelectionInput.template은 선택 완료된 단일 LayoutTemplate이며 fallback은 같은 templateId/templateVersion/templateHash/variantId를 가진 FallbackLayout이다. A가 영역 배정과 전체 제약을 재검사하고 B는 파일 IO·hash 계산·단일 변형 선택·시간 예산을 소유한다. 맵 source/fallback hash는 클라이언트 입력에서 받지 않는다.
- 정적 fallback의 runner-1..3/tagger-1..3는 A가 역할별 기본 문자열 정렬로 현재 input.players에 바인딩한다. B는 원본 JSON과 실제 플레이어 목록을 입력하고 A가 모든 ID 참조를 치환·재검증한 selected.layout만 createMatch에 전달한다. B가 정적 파일을 실제 세션 ID로 수정하거나 슬롯 ID를 그대로 core에 넣지 않는다.
- 파일 부재·읽기 실패·JSON 파싱/기본 shape 오류는 loader 실패로 준비에 복귀한다. LayoutSelectionInput.fallback은 필수이므로 더미 fallback을 만들어 진행하지 않는다. 정상 FallbackLayout 구조를 갖췄지만 출처/지형/규칙 인증에 실패한 경우에만 온라인 성공 결과로 진행할 수 있다. source/path 상세는 서버 진단에만 남기고 클라이언트에 원본을 전송하지 않는다.

**시험 입력 → 기대 결과**

- 모든배치조건과6명현재미디어준비 ->GAME_LOADING완료후카운트다운가능.
- fallback 인증 실패와 온라인 선발 실패가 모두 발생하거나 30초 로딩을 초과하면 준비 단계로 복귀하고 개인 뷰에 전체 맵을 넣지 않는다. fallback만 실패해도 정상 온라인 선발이 성공하면 그 selected.layout으로 진행한다.
- 이전 loadId/구 mediaInstanceId·receiverGeneration의늦은LOAD_READY ->무시/거절,다음판시작안됨.
- 실패 후보 17개를 yield하는 실제 A selector + B fake monotonic budget → next당 8개 이하, yield 사이 heartbeat 처리 가능, 예산 초과 뒤 return 1회와 인증 fallback. 타이머가 긴 동기 while을 중단하는 가짜 시험으로 대신하지 않는다.
- LOAD_READY accepted 뒤 loadId가 폐기됨 → EXPIRED/INVALID_PHASE rejected outcome, 새 로딩 상태 불변; 모든 현재 준비 충족 전에는 카운트다운 없음.
- 참가자 P2만 receiverGeneration 갱신 → P1/P3의 수신 세대는 그대로이며 bindingRevision 증가와 P2 publisherGeneration 변경이 전달된다. LOAD_READY는 자기 mediaInstanceId/receiverGeneration만 검증하고 원격 세대는 각 binding을 따른다.
- 현재 LOAD_READY는 있지만 matching 서버 binding의 self faceTrackSid가 없음 → 로딩 장벽 유지. matching self 게시와 전원 현재 신고를 확인한 경우에만 준비 완료이며 오래된 generation의 얼굴 SID로 대체하지 않는다.
- A MP-02 변형 배열 순서를 바꿔도 variantId 정렬과 같은 seed로 같은 변형을 선택한다. 다른 variantId/hash의 fallback 또는 지형 불일치 → 인증 거절; 모든 source·영역·경로 제약을 통과한 pair만 사용한다.
- fallback에 저장된 슬롯과 실제 playerId 6명이 전부 다름 → 실제 A 인증 결과의 players/exit owner/territory owner가 모두 현재 참가자와 일치한 뒤 core를 생성한다. 정적 슬롯 또는 이전 매치 ID가 남아 있으면 생성하지 않는다.
- 같은 matchId의 practice1→none2→game3에서 새 gameInstanceId의 full view를 전송한다. 로딩 실패로 준비 복귀하면 none4의 빈 뷰를 보내고 늦은 game3 view/event를 현재 단계로 다시 포장하지 않는다.

**추가·보완할 시험 파일**

- `server/test/room/loading-barrier.test.ts`
- `server/test/room/layout-loader.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/loading-barrier.test.ts
pnpm exec vitest run server/test/room/layout-loader.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

영역 정보가 보존된 단일 변형과 출처가 일치하는 fallback으로 맵·시작점·개인 출구·술래 보유 장비를 확정하고 새 논리 game scope의 개인 초기 뷰·별도 미디어 세대를 확인한다. 전체 맵 미전송, 30초 로딩 초과/원격 얼굴 미준비는 준비 복귀, 구 연습 세대 정리 불명은 새 토큰·카운트다운 보류를 검사한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 맵 확정과 게임 로딩 준비 장벽
```

**MR 본문에 채울 변경 사항**

- 완전한초기자원배치와개인뷰
- 회수/세대/30초로딩장벽

**MR 리뷰 포인트**

- 승인된 맵/시작점/출구/술래 장비 초기값이 모두 전달되는지
- 미디어clientready를Cloud회수/권한확인으로오해하지않는지

**완료 인계**

- C FL-07에loadId/실패사유/준비복귀fixture인계
- E에prepare/retire호출순서,B/F에콘텐츠경로와부팅오류인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/FL-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-17

**FL-06 · [BE] 카운트다운과 공통 시작 시각**  
일정: D2 2026-09-09 · **오늘 4번**  
기획 근거: v0.0.8 **05, 07장**  
선행 완료 결과: [B-16](b-game-server.md#b-16) (FL-05, D2), [B-04](b-game-server.md#b-04) (SV-04, D1), [E-07](e-media-operations.md#e-07) (MC-04, D2)

**수정·생성 파일**

- `server/src/rooms/CountdownCoordinator.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/game/MatchDriver.ts`

**구현 순서**

1. 로딩장벽을통과한6명에게공통startAt=서버monotonic now+3000ms를선정해COUNTDOWN으로보낸다. 동일loadId의중복ready가startAt을뒤로밀거나새타이머를만들지않게한다.
2. startAt전에는게임이동/탐색지식갱신/음성허용을막고E에카운트다운차단정책을유지한다. 개인초기뷰전달은가능하지만C는가림막을유지하며새지형을탐색하지않는다.
3. 기한 Tick에 도달하면 같은 B 직렬 경계에서 ControlIntent `{type:'START_PLAYING',startTick}`을 현재 A core에 한 번 전달해 PLAYING과 deadlineTick=startTick+3600을 고정한다. B 공개 phase만 바꾸고 core를 초기 GAME_LOADING에 남기지 않는다. 구 실행 타이머나 늦은 클라이언트 시각으로 3분을 다시 시작하지 않는다.
4. 카운트다운중이탈/미디어실패는시작장벽을닫고상태정책에따라준비복귀또는무효/회수를요청한다. A승패·과부하가정한deadline을인프라지연을이유로늘리지않는다.

**연결 계약과 경계**

- startAt는monotonicms,Action/tick는매치상대정수. C는 clock-probe/reply 오프셋으로 표시만 하고 시작 권위는 B다.
- MC-04정상권한확인과FL-05loadId가같은세대여야만시작허용.
- B가 준비·로딩·카운트다운의 공개 phase를 소유하고 A는 GAME_LOADING에서 START_PLAYING을 받아 본 경기 규칙을 연다. B의 COUNTDOWN 전이를 위해 정의되지 않은 core control/직접 state 변경을 추가하지 않는다. 시작 Tick의 입력 처리는 START_PLAYING 적용 후 같은 권위 경계에서 수행한다.

**시험 입력 → 기대 결과**

- COUNTDOWN 중 MOVE/EXCHANGE → 접수 단계 또는 처리 단계에서 명시적 거절·지식 불변·음성 허용 없음. 이미 accepted였다면 rejected outcome으로 종결한다.
- startAt도달 ->PLAYING1회/180초deadline고정.
- 실제 A core와 B 카운트다운을 연결 → 공용 phase와 core frame 모두 PLAYING, 같은 startTick/deadline이며 늦은 중복 타이머의 START_PLAYING 재전달로 시간이 바뀌지 않는다.
- 중복LOAD_READY/과거timercallback ->startAt변경없음;미디어불명확인 ->시작보류.

**추가·보완할 시험 파일**

- `server/test/room/countdown.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/countdown.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

전원 로딩·미디어 확인 뒤 서버 startAt까지 3초를 부여한다. 그 전에는 입력·탐색·음성을 차단하고 도달 Tick부터 180초 판정을 시작한다. 지연·중복 준비로 두 번 시작하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 공통 카운트다운과 라운드 시작
```

**MR 본문에 채울 변경 사항**

- 서버startAt과단일전이
- 시작전입력/탐색/음성차단

**MR 리뷰 포인트**

- 클라이언트타이머가게임시작을결정하지않는지
- 대기시간을180초게임시간에서미리차감하지않는지

**완료 인계**

- C FL-07/DsetContext에단계별입력/가림막시각fixture전달
- A/F에deadline경계와카운트다운반복ready회귀자료제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/FL-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### B-18

**FL-08 · [BE] 재경기 초기화와 준비 재확인**  
일정: D2 2026-09-09 · **오늘 5번**  
기획 근거: v0.0.8 **04, 05, 24장**  
선행 완료 결과: [A-15](a-game-core.md#a-15) (RL-08, D1), [B-17](b-game-server.md#b-17) (FL-06, D2), [E-16](e-media-operations.md#e-16) (MC-08, D2)

**수정·생성 파일**

- `server/src/rooms/RematchCoordinator.ts`
- `server/src/rooms/KkakkungRoom.ts`
- `server/src/game/MatchContext.ts`

**구현 순서**

1. RESULT/ABORTED에서방장REMATCH same/swap/lobby의도를검사한다. same은현재역할유지,swap은runner/tagger교대,lobby는준비단계이전으로돌리되한사람의의도로다른참가자ready를대신확정하지않는다.
2. 기존 미디어 세대 terminal/회수 확인 뒤 새 matchId/seed와 다음 역할 계획을 만들고 request/event/dedupe/heartbeat 문맥을 새 라운드로 교체한다. 준비→연습→맵 확정→로딩 순서를 다시 통과하며 새 loadId와 실제 createMatch는 FL-05의 단일 생성 경로에서 만든다. REMATCH 처리와 FL-05에서 core를 두 번 생성하지 않는다.
3. 연결·카메라준비·오디오권한확인·예산·규칙버전·6인슬롯을재검사한다. 개인종료후떠난빈자리는새라운드준비에서만충원하고진행중에는새join을열지않는다.
4. 늦은구판command/control/media응답은matchId/mediaInstanceId/receiverGeneration으로 거절한다. 이전 판 지도/술래 설치물/연습 좌표를재사용하지않으며gameplayerId는남은논리세션에서유지할수있다.

**연결 계약과 경계**

- REMATCH={mode:same|swap|lobby},방장권한과전원READY는분리.
- same은 남은 참가자 role 유지, swap은 남은 참가자 role 반전 계획을 B MatchContext에 저장한다. 신규 충원자는 그 계획에서 비어 있는 역할 슬롯에 배정해 3:3을 맞춘다. lobby는 다음 준비에서 새 역할 추첨을 허용한다. FL-01은 이 계획을 소비하되 ready 갱신 때 재배정하지 않으며, 역할 계획 외 지식·장비·좌표·이벤트를 이전 판에서 복사하지 않는다.
- 진행매치복원없음;서버재시작후복구는E OP-06/08의READY장벽이지이전경기복원기능이아니다.
- REMATCH는 기존 matchId의 요청으로 기록해 B가 해당 요청의 applied/rejected outcome을 종결한 뒤 새 matchId로 전환한다. 이전 매치의 다른 미처리 accepted는 canceled로 끝내며 새 매치에 큐·원장 pending을 이월하지 않는다.
- 새 matchId에 들어가기 전에 이전 논리 공간을 none으로 종료하고 허용된 빈 뷰를 발행한다. 다음 라운드는 새로운 gameInstanceId와 참가자 scope revision 문맥으로 시작하며 이전 matchId/view/event/phase callback은 새 문맥에 적용하지 않는다. 미디어 ID 교체를 이 논리 초기화의 대체 조건으로 쓰지 않는다.

**시험 입력 → 기대 결과**

- same재경기 ->role유지,matchId/배치/지도/자원은새값.
- swap재경기 ->3:3역할교대,전원ready없으면시작안됨.
- 이전판EXIT_PROGRESS/LOAD_READY/미디어응답 ->새판state불변;종료자빈슬롯은준비단계에서만충원.
- REMATCH accepted→새 matchId 생성 → 원래 matchId/requestId의 outcome 한 개, 구판 pending은 canceled; 새 판의 stateVersion을 구판 outcome에 잘못 붙이지 않는다.
- 재경기 뒤 이전 matchId의 높은 revision/view/event 도착 → 새 matchId에서 폐기. 동일 라운드에서 미디어만 재연결한 경우에는 반대로 게임 scope와 지도 상태를 유지한다.

**추가·보완할 시험 파일**

- `server/test/room/rematch.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/room/rematch.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

같은 팀/팀 교대/로비 복귀 전환을 구현하고 새 matchId·seed·배치·개인 지도·출구·도구·이벤트를 초기화한다. 연결·장치·예산·규칙 버전을 다시 확인하며 진행 중 충원은 없고 다음 라운드에서만 충원한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 재경기 초기화와 준비 재확인
```

**MR 본문에 채울 변경 사항**

- 같은역할/교대/로비전환
- 구판이벤트격리와새자원초기화

**MR 리뷰 포인트**

- 역할만교대하고지도/장비를남기지않는지
- 원격회수불명인데새grant를발급하지않는지

**완료 인계**

- C FL-09에mode별응답과준비재진입예시전달
- E MC-08/F QA-07·09에반복재경기fixture와종료자충원시나리오인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/B/FL-08.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.
