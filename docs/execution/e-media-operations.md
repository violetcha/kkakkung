# E · 서버 미디어·운영 복구 실행 문서

작성 기준: 2026-09-08 · 스켈레톤 `d6f8e62` · **EXEC-CONTRACT-3**  
담당 범위: LiveKit 권한/세대 회수, 저널·예산·재시작 대조와 READY  
원본 작업: **16개** · 리뷰 상대: **F** · 현재 상태: **모두 구현 계획**

이 문서와 [최신 결정](../spec/decisions.md), 아래 공통 계약을 실행 입력으로 사용한다. AI는 `AGENTS.md`·`CONTRIBUTING.md`·`server/README.md`와 수정할 실제 코드를 읽는다. [기획서 v0.0.8](../spec/README.md)은 근거 확인용이며 정정 전 아이템 요구를 실행하지 않는다. 다른 담당의 전체 실행 문서를 읽지 않아도 아래 선행 산출물과 [E 인계 기록](handoffs/E.md)으로 작업할 수 있어야 한다.

목표는 **9월 8일(화)·9일(수) 핵심 구현, 10일(목) 통합·검증·수정, 11일(금) 오전 MVP 인수**다. 작업 개수는 소요시간이나 완료 보증이 아니다. 선행 작업·실제 Cloud·장치가 준비되지 않은 조건은 완료로 계산하지 않는다.

## 날짜별 오늘 작업표

각 날짜에서 오늘 번호를 1부터 다시 센다. 예를 들어 9월 9일에 “오늘 1번부터 5번”을 요청하면 **D2 표의 1–5번**을 수행한다. `E-01` 같은 고정 번호와 원본 ID는 날짜가 지나도 바꾸지 않는다. 일정 이후에는 날짜 또는 고정 번호를 명시한다.

### D1 · 2026-09-08 화요일

계약·환경과 병렬 구현 기반을 만들고 권위 이동·장치 점검을 연결. 새 원본 작업 5개.

| 오늘 번호 | 고정 번호                          | 원본 ID | 완료할 결과                        |
| --------- | ---------------------------------- | ------- | ---------------------------------- |
| 1         | [E-01](e-media-operations.md#e-01) | MC-01   | 실제 Cloud 권한 제어 가능성 확인   |
| 2         | [E-02](e-media-operations.md#e-02) | OP-01   | 지속 저널과 원자적 체크포인트      |
| 3         | [E-03](e-media-operations.md#e-03) | OP-02   | 참가자분·GB 예약과 시작 차단       |
| 4         | [E-04](e-media-operations.md#e-04) | OP-03   | 전체 관리 API 예산과 우선순위      |
| 5         | [E-05](e-media-operations.md#e-05) | MC-02   | 세대별 Identity와 미디어 토큰 발급 |

### D2 · 2026-09-09 수요일

MVP 핵심 기능을 구현하고 생산자·소비자를 통합. 새 원본 작업 11개.

| 오늘 번호 | 고정 번호                          | 원본 ID | 완료할 결과                       |
| --------- | ---------------------------------- | ------- | --------------------------------- |
| 1         | [E-06](e-media-operations.md#e-06) | MC-03   | 경로 기반 가청 정책과 효과음 필터 |
| 2         | [E-07](e-media-operations.md#e-07) | MC-04   | 수신자·세대별 구독 정책 직렬화    |
| 3         | [E-08](e-media-operations.md#e-08) | MC-05   | 권한 결과 불명과 늦은 응답 처리   |
| 4         | [E-09](e-media-operations.md#e-09) | MC-06   | 트랙 변경 감지와 현재 게시물 대조 |
| 5         | [E-10](e-media-operations.md#e-10) | MC-07   | 원격 미디어 종료 장벽             |
| 6         | [E-11](e-media-operations.md#e-11) | OP-04   | 회수 재시도와 예약·기록 해제      |
| 7         | [E-12](e-media-operations.md#e-12) | OP-05   | 부팅 복구 상태와 기록 검사        |
| 8         | [E-13](e-media-operations.md#e-13) | OP-06   | 이전 세대·잔존 방 대조와 회수     |
| 9         | [E-14](e-media-operations.md#e-14) | OP-07   | 제한 공개창과 운영 제어           |
| 10        | [E-15](e-media-operations.md#e-15) | OP-08   | live·ready 분리와 재개 조건       |
| 11        | [E-16](e-media-operations.md#e-16) | MC-08   | 연습·경기·재연결의 세대 교체      |

### D3 · 2026-09-10 목요일

최종 흐름·실기기·Cloud·부하 검증과 결함 수정. 새 원본 작업 없이 기존 작업의 통합과 결함을 마무리한다.

| 오늘 번호 | 고정 번호        | 원본 ID      | 완료할 결과                                                                                              |
| --------- | ---------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| 1         | 기존 E 작업 후속 | 신규 ID 없음 | 실제 G1 회귀에서 불허 수신·옛 토큰·재게시·timeout 실패를 재현하고 권한/회수 장벽을 수정한다.             |
| 2         | 기존 E 작업 후속 | 신규 ID 없음 | DP-06 배포/재시작 절차로 저널 대조와 admission 차단·READY 복귀를 확인한다.                               |
| 3         | 기존 E 작업 후속 | 신규 ID 없음 | 6대 5판 중 연습→본경기→개인 종료→재경기의 세대 회수·구독 동기화 결함을 수정한다.                         |
| 4         | 기존 E 작업 후속 | 신규 ID 없음 | QA-11·QA-12에서 같은 정상 구간의 전체 API 호출량·429·실효 지연을 확인하고 예산/스케줄러 결함을 수정한다. |
| 5         | 기존 E 작업 후속 | 신규 ID 없음 | Cloud 정리 확인·잔량·재시작 회수 절차를 최종 commit 기준으로 F에 인계한다.                               |

D3 결함 수정은 기존 작업의 후속 처리다. 별도 스토리 수를 늘리지 않는다. 수정한 파일 소유자가 검증 후 `fix:` 커밋과 MR 본문을 남긴다. 도망자 아이템의 종류·효과·획득·사용은 결정 대기로 분리하며 관련 음향과 시험을 구현 완료 조건에 넣지 않는다. 발소리와 확정된 술래 장비·자연 구속·포즈 기능은 유지한다.

<!-- BEGIN EXEC-CONTRACT-3 COMMON -->

# 공통 실행 계약 원본

버전: **EXEC-CONTRACT-3** · 원본 적용 결정: **D-2026-09-08-01** · 실행 기준 갱신: 2026-09-13

이 파일은 여섯 담당 문서에 자동 삽입하는 유일한 공통 원본이다. EXEC-CONTRACT-3은 이전 계약의 맵 영역 입력·게임 논리 인스턴스·미디어 초기화·격리 배포 순서를 보완한다. 원본 작업 번호와 추적 범위는 유지하며, 기획서 원본을 새 승인 내용으로 소급 수정하지 않는다. [최신 결정 정정표](../spec/decisions.md)가 v0.0.8과 충돌하는 부분에 우선한다. 계약 타입·fixture·문서를 바꾼 것만으로 Origin 보안이나 제품 기능의 런타임 수정이 완료된 것은 아니다.

현재 재개 기준은 [2026-09-13 코드·계획 재검토](../mvp-plan-review-2026-09-13.md), [최신 기획서](../spec/current.md), [구현 진행 기록](../mvp-implementation-progress.md)이다. 역할별 본문의 스켈레톤·미구현·지난 일정과 인계의 검증 수·차단 사유는 해당 작성 시점의 기록이다. 현재 코드·병합 SHA·실제 검증과 대조하여 남은 결함과 연결만 수행하며, 이미 구현된 모듈을 다시 만들지 않는다. 과거 본문과 현행 실행 기준이 충돌하면 최신 사용자 결정과 이 갱신 내용을 우선한다. 문서의 번호와 소유권은 유지하며, 재개 승인·원격 작업 범위는 현재 사용자 요청을 따른다.

## 이 문서로 실행하는 방법

담당자가 작업 번호의 실행을 요청하면 구현·검증·작업별 로컬 커밋·MR 본문 작성까지 수행한다. 푸시·GitLab MR 생성·원격 병합은 담당자가 직접 한다. 문서를 검토하거나 읽는 요청만으로 제품 구현을 시작하지 않는다.

```text
내 담당 실행 문서와 docs/spec/current.md, docs/spec/decisions.md,
docs/mvp-plan-review-2026-09-13.md의 최신 재개 기준으로
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
- 이번 MVP에서는 사용자 결정에 따라 도망자 아이템과 아이템 전용 G3-C·G5 행동을 구현·인수 범위에서 제외한다. 원본 6개 ID의 `PRODUCT_DECISION_PENDING` 이력은 유지하되 이번 MVP 완료를 기다리게 하는 선행 조건으로 사용하지 않는다. 원본 아이템을 구현·통과한 것으로 바꾸거나 제품 계약에 종류·인벤토리·사용 명령·엔티티를 추가하지 않는다. 술래 장비·구속·자연 만료·포획·포즈는 계속 인수한다.
- 9/8–9 핵심 구현, 9/10 통합·검증·수정, 9/11 오전 인수는 원본 목표 일정이다. 현재 실행 순서와 미완료 범위는 최신 재검토 문서를 따르며, 확정 범위의 실제 증거와 이번 MVP 제외 항목을 구분한다. 기존 v0.0.8 전체 요구가 완료됐다고 선언하지 않는다.
- 이번 완료 목표는 GitLab 프로젝트 팀원 접속 제한을 유지한 상태에서 남은 MVP 구현과 실제 검증을 끝내는 것이다. 제한 없는 공개 전환은 별도 사용자 요청으로 수행한다. 팀 제한 유지가 공개 전 필요한 미디어 권한·회수·부하 검증을 면제하거나 내부 송신 허용 목록 시험을 공개 운영 통과로 바꾸지는 않는다.

## 설치와 공통 검사

### 담당 문서만으로 시작하는 읽기 경로

공통 필수 자료는 `AGENTS.md`, `CONTRIBUTING.md`, `requirements.md`, `docs/architecture.md`, `docs/spec/decisions.md`와 위의 최신 재개 기준이다. 이후 자기 담당 문서의 시작 절차와 지정 작업을 읽고, 원본 HTML은 현재 기획서에서 보존한 규칙의 근거를 확인할 때 사용한다. 이 공통 블록과 타입은 자기 담당 문서에도 들어 있으므로 다른 다섯 역할의 전체 문서를 읽을 필요는 없다. 다른 역할의 **공개 타입·실제 export·시험 fixture·인계 기록**은 연결 근거로 직접 확인한다. SDK 사실은 설치된 버전의 타입·구현을 확인한다.

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
2. **accepted인 모든 명령은 반드시 한 개의 논리적 command-outcome으로 종결한다.** A의 순수 명령은 StepResult.outcomes, B의 READY/ROOM_LOCK/ROOM_KICK/PRACTICE_READY/LOAD_READY/REMATCH는 B 단계 처리 결과에서 만든다. 실패로 상태가 전혀 변하지 않아도 requestId/sequence에 연결해 보낸다.
3. applied는 의도 반영·행동 예약·교환/도전 생성 등이 처리됐다는 뜻이다. 이동 도착·설치 완료·탈출 성공은 이후 권위 상태/사건으로 확인한다. 적용 후 다른 판정으로 취소되어도 같은 명령의 terminal 결과를 다시 바꾸지 않는다.
4. 동일 requestId/동일 내용은 최초 접수/종결 결과를 재전송하고 core를 다시 호출하지 않는다. 다른 내용 재사용은 STALE_REQUEST로 거절한다. pending 요청은 캐시에서 퇴출하지 않는다. 연결별 pending 최대 64, completed 최대 512개/2분으로 제한하고 큐를 넣기 전에 한도를 검사한다. 매치 종료 때 미처리 수용 요청은 ROUND_ENDED의 canceled로 정리한다.
5. C는 접수 결과가 rejected이면 즉시 pending을 끝내고 안전 code와 재요청 UI를 표시한다. 이 경우 outcome·조회 타이머를 기다리지 않는다. accepted만으로 spinner를 끝내거나 성공을 표시하지 않는다. outcome을 받으면 요청 pending은 끝내고 필요한 private-view/event를 별도로 기다린다. EXIT_START가 rejected/canceled이면 재요청 UI를 복구하며 challenge를 만들어내지 않는다.
6. accepted 후 2초 동안 종결이 없으면 request-status를 요청한다. 2초 간격 최대 3회, done이면 결과 적용, pending이면 대기한다. unknown/연속 무응답은 개인 뷰 resync와 UNCONFIRMED 안내로 spinner를 끝내며 성공/실패로 추정하거나 자동 재실행하지 않는다.
7. command-outcome.stateVersion은 수신자가 필요한 개인 뷰 버전이다. 개인 내용 변경이 없으면 마지막 개인 뷰 버전을 사용한다. 아직 개인 뷰가 없는 로비의 READY 결과는 해당 공개 라운드 버전이며 C는 존재하지 않는 개인 뷰를 기다리지 않는다.

필수 연결 시험은 **accepted → core 거절(상태 불변) → requestId에 맞는 outcome → UI pending 종료 → 새 요청 가능**이다. 동일 요청 재전송·매치 종료·결과 지연·상태 조회도 실제 A/B/C 코드로 검사한다.

## 개인 상태·출구·교환·준비

대기방의 ROOM_LOCK과 ROOM_KICK은 LOBBY/DEVICE_CHECK에서 현재 연결된 방장만 요청하며 실행 tick에서도 권한과 단계를 재검사한다. 내보내기는 자신·이미 나간 참가자·다른 방 참가자를 거절하고 입장을 먼저 잠근 뒤 해당 세션을 무효화한다. 예약 좌석은 잠글 때 무효화하되 미확인 미디어 회수 좌석을 해제하지 않는다. 강제 퇴장 close code는 4002이며 클라이언트는 장치·미디어를 정리하고 입장 화면으로 돌아갈 수 있어야 한다. 영구 차단은 아니며 방장이 다시 잠금을 풀면 새 세션으로 참가할 수 있다.

입장 상태는 기존 room-roster를 바꾸지 않는 추가 room-access 채널의 {matchId, revision, locked}로 전달한다. revision은 방 내 입장 상태가 변경될 때 증가하고 동일 방의 단계 전환·재경기에서도 잠금을 유지한다. 두 메시지는 공개 상태 patch 뒤에 전송해 새 matchId보다 목록이 먼저 도착하지 않도록 한다. 클라이언트는 현재 matchId와 각 채널의 버전을 확인하고 구 경기 메시지는 버린다. 잠금 상태를 받기 전 관리 버튼을 활성화하거나 목록을 게임 위치·역할 정보로 사용하지 않는다.

개인 뷰는 초기/허용 내용 변경/scope 전환/공개 phase 변경/명시적 resync 때 전체 교체한다. 일반적인 stateVersion 증가만으로 같은 지형을 계속 전송하지 않는다. phase 전환은 새 하한을 확인할 전체 뷰를 한 번 보내고 resync는 현재 버전으로 재직렬화한다. 사건 stateVersion은 참조 개인 뷰 버전이고 발생 시각은 tick이다. 미래 사건은 최대 64개/1초 대기 후 resync, 구 match·구 gameScope·중복·만료 사건은 폐기한다.

- visibleEntities는 종류별 필수 필드가 다르다. **가시 sensor는 wall이 필수**이며 자기 기억인 ownedEquipment와 분리한다. sensor.cell은 접근 셀, wall은 실제 부착 면이다. 다른 장비 위치를 전원에게 전송하지 않는다.
- self.exchange의 incoming/outgoing은 수신자 기준이다. C는 incoming만 D의 incomingExchangeId로 보내고 요청자는 outgoing 대기를 표시한다. 서버는 toPlayerId만 수락할 수 있게 검사한다.
- C는 현재 가시 아군만 교환 후보로 삼는다. 기존 후보가 계속 보이면 유지하고, 없으면 셀 제곱 거리·동률 playerId 순으로 고른다. 후보 선택은 서버의 거리·활동·지식 차이 검사를 대신하지 않는다.
- **READY true는 DEVICE_CHECK에서 로컬 장치 점검을 완료했다는 클라이언트 신고**다. 카메라·vision·calibration이 ready일 때만 보내고 장치 장애·취소는 false로 갱신한다. 마이크는 선택이다. 서버는 신고·인원·단계를 검증하며 원격 웹캠 정상 여부를 독립 증명한다고 쓰지 않는다.
- vision ready는 모델 로드만 뜻하지 않는다. 현재 유효 얼굴·첫 안전 가공 프레임·살아있는 가공 트랙까지 확보해야 한다. 실패 원인은 DeviceStatus.errorCode로 보고한다.
- 마이크 단독 변경은 InteractionRuntime.setMicrophone을 사용해 카메라 권한을 새로 요청하지 않는다. 보정 실패의 구체 사유는 이후 FACE_INVALID가 덮지 않으며 새 보정·카메라/Worker 오류는 정상 갱신한다. 새 경기 런타임은 사용자가 선택한 품질을 다시 적용한다.
- 미니맵은 기억한 허용 출구를 표시할 수 있지만, **3D 포털·소유자 식별은 현재 관찰 중인 출구 벽면에만** 그린다. 폐쇄 시 같은 벽면의 일반 벽을 복원한다. 술래에게 출구를 보내지 않는다.
- 포즈 탈출 완료는 C가 단독 전송한다. 새롭고 유효한 동일 pose 관측으로 1.2초 유지하고 minSuccessTick도 충족해야 한다. 키 폴백은 challengeId 해시로 고정한 4방향 순환 순서를 사용한다. 최소 시간 조기 거절은 동일 도전·기한·유효 조건을 재확인한 경우에만 새 requestId로 제한 재시도한다.

## 서버 미디어와 브라우저 결합

mediaInstanceId는 팀별 연습/본 경기의 논리 미디어 인스턴스다. receiverGeneration은 이 메시지를 받는 플레이어 자신의 연결 세대, participants의 publisherGeneration은 원격 송신자 세대다. bindingRevision은 수신자·인스턴스·연결 세대 안에서 증가하며, 한 사람만 재연결했다고 다른 다섯 명의 receiverGeneration을 바꾸지 않는다. 새 Identity는 회수 완료 후에만 발급한다.

### 초기화 완료와 서비스 준비 — B/E/F

1. E의 동기 factory는 즉시 RECOVERING/readiness와 DRAINING/admission을 제공하고 발급·입장을 잠근다. B는 `await coordinator.initialize()`를 호출하며 중복 호출은 같은 진행 Promise/최초 결과를 공유한다.
2. initialized 결과는 writer lock과 저널/체크포인트의 복원 판단, 관찰 가능한 RECOVERING 또는 LOCKED 상태를 준비했다는 뜻이다. 안전하게 잠긴 손상/미확인 상태도 reasonCodes와 함께 initialized/LOCKED로 관찰 가능하다. Cloud 회수·예산 확인 완료를 의미하지 않는다.
3. 중복 writer 등 안전한 인스턴스를 유지할 수 없는 오류는 fatal(WRITER_CONFLICT 또는 INITIALIZATION_FAILED)이다. B는 HTTP listen을 시작하지 않고 close로 자원을 정리한다. 예상하지 못한 Promise 거절도 같은 부팅 실패로 처리한다. 초기화 중에는 listen이 0회여야 한다.
4. initialized 이후 B가 HTTP를 열어 `/health/live`, 503인 `/health/ready`, 인증된 운영 경로와 서명 검증 Webhook으로 상태를 관찰·복구할 수 있게 한다. E는 이후 Cloud 잔존 정리·선택 운영 모드의 예산 정책·저널 쓰기 상태를 확인한다. attested는 공식 잔량과 확인 기한을 검사하고 continuous는 공급자 할당량 정책과 로컬 예약·회수 기록을 검사한다. 완료 전 새 입장·grant·자동 시작은 0이며 복구 실패는 LOCKED로 남겨 관찰한다.
5. 조건이 충족되면 readiness만 READY로 바뀐다. admission은 DRAINING을 유지하고 운영 resume의 terminal 성공 후에만 OPEN이 된다. 첫 설치·재시작 모두 자동 OPEN하지 않는다. initialize를 다시 호출하여 복구 실패나 잠금을 초기화하지 않는다.

- E는 내부 Gateway·Journal·예산 큐를 소유한다. B가 주입하는 deps/config와 요청·trusted frame·비동기 결과는 아래 정확한 타입을 따른다. E 콜백은 B의 큐로만 들어가며 Tick 상태를 직접 변경하지 않는다.
- prepareGeneration은 expectedPreviousGeneration을 검사하고 E가 새 세대를 할당한다. 동일 requestId는 같은 논리 결과를 반환한다. Promise 결과는 HTTP 응답용이고 enqueueControl 결과는 게임 큐용이며 B는 requestId+scope로 중복 적용을 막는다. rejected/unknown이면 grant는 null이고, 세대 할당 전 rejected의 receiverGeneration은 null이다. ready는 grant 발급 완료이며 게시 확인 완료가 아니다. 요청 없이 생긴 MEDIA_FAILED는 eventId+scope로 중복 제거한다.
- media-bindings에는 자기 게시를 서버가 확인한 self 항목도 포함할 수 있다. 이때 publisherGeneration=receiverGeneration이다. B는 현재 scope의 self faceTrackSid 확인과 클라이언트 LOAD_READY를 모두 받아 로딩 장벽을 통과시킨다. D는 self 항목을 원격 얼굴/음성 attach 대상으로 사용하지 않는다. A의 self.loading은 null이며 B가 로딩 조정 상태를 덧붙인다.
- observeFrame은 게임의 권위 좌표·지형·현재 참가 상태만 받는다. E가 자신의 확인된 Identity/SID 레지스트리와 결합한다. 동기 호출 구간에 네트워크 대기·파일 쓰기·긴 계산을 넣지 않는다.
- 내부 6인 시험 예외(2026-09-11 승인): `MediaGrant.subscriptionMode=publisher-permissions`인 경우 `AudioPolicy.publisherPermissions`에 송신자의 전체 수신 대상 Identity·허용 트랙 SID를 전달한다. D는 현재 scope·bindingRevision을 검증하고 자기 게시 SID만 허용한다. 게시 전 차단, 새 정책 revision으로 1.5초 lease 갱신, 종료·연결 상실·lease 만료 시 빈 목록 적용이 필수다. E는 동일 내용이어도 새 권위 프레임에서 정책을 갱신한다. 정상 송신 앱을 전제로 하며 공개 운영의 서버 단독 권한 통과와 구분한다. 자세한 승인 경계는 [최신 결정](../spec/decisions.md)을 따른다.
- 서버는 `media-bindings`, `audio-policy` 채널로 전체 허용 목록을 전송한다. AudioPolicy의 scope·bindingRevision이 현재 바인딩과 맞아야 적용한다. 같거나 낮은 policyRevision은 중복/과거로 폐기한다. 비어 있는 최신 voices는 기존 음성을 즉시 닫는다.
- 개인 소리 제어는 D가 소유한 기존 AudioContext를 사용한다. C는 로컬 `AudioPreferences`의 음량(0–1)·전체 수신 음소거·현재 친구별 수신 음소거를 적용하며 서버 정책이나 출력 잠금을 열지 않는다. 방 안의 재경기·세대 교체에는 설정을 유지하고 방 이탈 시 초기화한다. 확인음은 활성 장치 점검/팀 연습에서만 짧게 재생하며 경기 시작·비활성·종료에서 멈춘다. 마이크 입력 크기는 선택한 트랙의 순간 값(0–1, 미사용은 null)만 제공하고 스피커 연결·추가 취득·녹음·저장·업로드를 하지 않는다. 이 로컬 제어는 금지 수신의 Cloud 차단 증거가 아니다.
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

이 모드 구분은 A–F 본문과 과거 인계의 공식 잔량·공개 시간 창·checkpoint 지시에도 적용한다. attested 시험의 기한과 증거를 continuous의 정기 수동 갱신 의무로 가져오지 않는다. 반대로 continuous라는 이유로 capability·인증·저널·회수·API/참가자 상한이나 실제 Cloud 시험의 범위·비용 확인을 생략하지 않는다. 아래 설명의 checkpoint-budget는 운영 도구 이름이며 HTTP `OperationsCommand.action`은 기존 `checkpoint`를 유지한다.

B는 중앙 `INVITATION_ROUTES`의 issue/revoke를 자기 session 모듈에서 구현한다. E의 `CreateOperatorAuth`로 생성한 인증 함수를 B가 `/api/operations` 전체와 초대 경로보다 앞에 적용한다. `OPS_TOKEN`은 인증 factory에만 주입하고 브라우저/protocol로 전달하지 않는다. F 운영 스크립트도 이 경로를 소비하며 별도 비인증 발급 CLI나 초대 endpoint를 만들지 않는다.

F는 `MediaConfiguration`의 projectAlias·publicWindow·officialBudgetMaxAgeMs·operationTimeoutMs를 선택 운영 모드와 함께 검증하고 B가 factory에 전달한다. publicWindow=null은 운영 범위 미정으로 잠금이며, continuous의 명시적 `{mode:'continuous'}`와 구분한다. 예시 창·예시 잔량을 실제 허용으로 쓰지 않는다. productSecurityReady는 환경의 임의 true가 아니라 B가 제품 인증·입장 보호 초기화를 확인해 주입하는 서버 내부 값이다. E는 이 값과 회수·저널·해당 모드의 예산·운영 범위 조건을 검사한다. operationTimeoutMs 이후에도 미완료 회수는 성공으로 바꾸지 않고 unknown/LOCKED와 작업 상태 조회에 남긴다. 정확한 env 매핑은 현재 F config export와 상시 운영 문서를 대조한다.

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
- attested의 checkpoint-budget는 `OPS_DATA_DIR/official-usage-input.json`의 OfficialBudgetCheckpoint를 읽어 검증한다. F가 실제 Cloud 사용량 보고서의 조회 시각·잔량·근거를 넣고 E가 신선도·비음수·같은 프로젝트 여부를 검사한다. continuous에서는 같은 명령이 로컬 기록 flush와 쓰기 가능 여부를 확인하며 공식 사용량 파일 갱신을 요구하지 않는다. 어느 모드도 예시 잔량이나 클라이언트 신고를 공식 증거로 쓰지 않는다.

## 격리 상태의 배포 검증 — B/E/F

외부 공개 여부는 F의 네트워크/프록시 접근 경계이고 admission은 E의 게임 입장 상태다. 서로 다른 두 조건을 하나의 boolean으로 합치지 않는다. 외부 접근 차단은 진행 중 게임의 정상 종료·회수를 방해하지 않도록 기존 연결과 인증된 운영/검증 경로를 유지하면서 일반 이용자의 새 접속을 차단한다.

현재 배포의 최종 접근 상태는 **GitLab 프로젝트 팀원 제한 유지**다. 아래의 배포·복구·검증 절차와 나중의 제한 없는 공개 전환을 구분한다. 과거 배포 fixture의 마지막 `publish`는 별도 공개 전환 사례이며, 이번 팀 테스트 배포마다 프로젝트 멤버 제한을 해제하라는 지시가 아니다.

1. F가 외부 일반 참가자는 새 HTTP 세션·매칭·WS 접속을 못 하고 승인된 팀 검증 참가자와 운영자만 접근 가능한 경계를 확인한다. 6인 검증에는 실제 6명의 접근과 환경이 필요하다. 모든 앱 진입 경로에 적용하고 이름뿐인 smoke 플래그나 클라이언트 claim으로 우회하지 않는다. 접근 제한·검증 환경·선택 운영 모드의 필수 설정이 준비되지 않으면 해당 검증은 BLOCKED다. 공식 잔량·유효 시간 창은 attested에만 필수이며 continuous의 배포 종료 시각을 새로 만들지 않는다.
2. OPS drain의 terminal succeeded와 진행 경기/연습/입장 대기 0, 회수·저널 반영 및 미해결 0을 확인한 뒤 같은 검증 SHA/digest로 교체한다. 격리는 재시작·롤백 동안 유지한다.
3. B/E의 initialize→HTTP 관찰→RECOVERING 정리→READY를 확인한다. 이때 admission은 여전히 DRAINING이다. READY만 보고 공개하거나 자동 입장시키지 않는다.
4. 접근 제한과 선택 운영 모드의 조건을 다시 확인한 후 resume을 요청하고 terminal succeeded 및 READY/OPEN을 확인한다. 일반 이용자는 계속 차단된 상태에서 검증 참가자만 입장하여 6인 smoke를 수행한다. attested는 승인된 시간 창·공식 잔량을, continuous는 고정 운영 설정·로컬 예약·회수 상태와 현재 적용 상한을 검사한다. DRAINING에서 입장하는 시험용 예외 API는 만들지 않는다.
5. 시험 성공 후 검증 참가자 퇴장, 진행 활동 0, 시험 미디어 회수·저널 반영·미해결 0과 READY/OPEN을 확인한다. 해당 모드의 운영 조건을 다시 검사하고 GitLab 프로젝트 팀원 제한의 허용·거절 경로를 확인한 상태로 팀 테스트 배포를 마친다. 제한 없는 공개는 별도 사용자 요청과 공개 준비 증거 검토 뒤 수행하며, 그때만 F가 지정한 접근 제한을 해제하고 실제 공개 상태를 검사한다.
6. smoke 실패나 resume 이후 실패에는 접근 제한을 유지한 채 별도 requestId로 다시 drain하고 회수·활동 0을 확인한 뒤 이전 digest로 복귀한다. 회수가 불명확하면 이미지를 교체하여 미해결 상태를 숨기지 않고 ROLLBACK_BLOCKED로 남긴다. 롤백 후에도 같은 초기화·복구·접근 제한·검증 순서를 통과해야 팀 테스트를 재개할 수 있다.

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

필수 계약 연결 사례: accepted 후 core 거절, 요청 중 매치 종료/중복/조회, 영역별 맵 입력과 다른 출처 fallback 거절, 같은 match의 연습→none→본경기와 구 scope 지연 데이터 폐기, initialize 완료/READY/OPEN 분리와 fatal 기동 차단, 접근 제한 유지 resume→6인 시험→회수→팀 테스트 재개 및 실패 rollback, 한 명만 미디어 세대 교체, 트랙/바인딩 양쪽 순서와 오디오 세 입력 순열, 같은 SID/새 SID 구분, 얼굴만 새 결과와 오래된 pose, 양손 충돌, 요청자/수락자 다른 UI, READY false 취소, 비소유자 가시 sensor.wall, 관찰 출구 표시/폐쇄, 5→6→7 음성 차단, 매칭 Origin 거절 뒤 예약 0. 나중의 공개 전환은 별도 사례로 검증한다. F가 실제 모듈을 연결하되 생산자와 소비자가 자기 계약 시험을 먼저 제공한다.

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
  ROOM_LOCK: { locked: boolean };
  ROOM_KICK: { targetPlayerId: string };
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
export type PreparationIssue =
  | 'SERVICE_NOT_READY'
  | 'LAYOUT_UNAVAILABLE'
  | 'DEVICE_LOADING_TIMEOUT'
  | 'MEDIA_NOT_READY'
  | 'PREPARATION_UNAVAILABLE';
export type RematchState = 'available' | 'settling' | 'requested';
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
  /** Allowlisted preparation feedback; never send raw diagnostics or layout paths. */
  preparationIssue?: PreparationIssue;
  rematchState?: RematchState;
}>;
export const ROOM_EXPIRED_CLOSE_CODE = 4001;
export const ROOM_REMOVED_CLOSE_CODE = 4002;
export type RoomAccess = Readonly<{ matchId: string; revision: number; locked: boolean }>;
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
  'READY' | 'ROOM_LOCK' | 'ROOM_KICK' | 'PRACTICE_READY' | 'LOAD_READY' | 'REMATCH'
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
export type AudioPreferences = Readonly<{
  volume: number;
  muted: boolean;
  mutedPlayerIds: readonly string[];
}>;
export type LocalAudioStatus = Readonly<{
  preferences: AudioPreferences;
  microphoneLevel: number | null;
  testTonePlaying: boolean;
}>;
export type TestToneResult = 'played' | 'unavailable' | 'muted';
export interface InteractionRuntime {
  startDevices(input: { microphone: boolean }): Promise<DeviceStatus>;
  /** Changes only microphone permission/source/publication; never acquires a camera. */
  setMicrophone(enabled: boolean): Promise<DeviceStatus>;
  calibrate(): Promise<DeviceStatus>;
  setContext(context: InteractionContext): void;
  connectMedia(grant: MediaGrant): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): void;
  setAudioPreferences(preferences: AudioPreferences): void;
  getLocalAudioStatus(): LocalAudioStatus;
  playTestTone(): Promise<TestToneResult>;
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
  'room-access': RoomAccess;
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

### E 실행 시작과 조립 경계

2026-09-08 감사 기준 `develop`에는 `server/src/media`, `server/src/operations`, `server/src/health`의 제품 구현이 없다. 기존 서버의 `MEDIA_MODE=disabled`·production 차단과 단순 health를 E 완료로 해석하지 않는다. 실행 시 현재 소스와 인계 commit을 다시 확인한다.

| 연결 지점                                                                       | 단독 수정자 | E가 제공하거나 확인할 결과                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/src/bootstrap.ts`, `main.ts`, `index.ts`, HTTP/WS 라우트                | B           | E는 `MediaCoordinator.ts`의 `createMediaCoordinator`와 인증기·health handler의 export, 인수/반환, 시험 명령을 [E 인계 기록](handoffs/E.md)에 적는다. B가 factory·initialize·listen·close·제어 큐를 연결한다. |
| `server/src/config/env.ts`, 모든 manifest/lockfile, `.env.example`, Docker/볼륨 | F           | 필요한 환경변수·타입·실패 조건을 E가 요청하고 F가 파서·주입을 수정한다. E는 `process.env`를 직접 읽는 두 번째 설정기를 만들지 않는다.                                                                        |
| `packages/protocol`·공통 타입                                                   | B           | E는 내부 결과를 고정 계약으로 반환한다. 필드 추가는 B 및 실제 소비자 D와 합의하고 공통 원본을 변경한다.                                                                                                      |
| `tests/cloud` probe·runner·계측                                                 | F           | E는 `server/test/media/capability.cloud.test.ts`만 작성하고 F probe를 import한다. 같은 브라우저 harness를 E 폴더에 복제하지 않는다.                                                                          |
| `server/src/observability`                                                      | F           | E 내부의 API·예약·회수 측정값은 비민감 수치/enum과 단위를 인계한다. F가 exporter를 만들며 E나 F가 B 조립 파일을 대신 수정하지 않는다.                                                                        |

파일이나 export가 아직 없으면 소유자·필요한 commit·정확한 연결 시험을 `blockedOn`에 남긴다. 자기 소유의 순수 구현과 유한 실패 fixture는 계속 진행하고 요청 범위의 다음 번호로 넘어간다. B/F 파일을 직접 바꾸거나 빈 성공 모듈로 import를 해결하지 않는다. 역할 간 인계는 각 소유자가 자기 `docs/execution/handoffs/<담당>.md`에 기록하며 다른 역할 파일은 수정하지 않는다.

### E-01~E-05를 한 번에 요청받았을 때

| 작업         | 지금 독립적으로 만들 수 있는 결과                       | 통합·인수 전 실제 필요한 결과                                                                                                                     |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-01 / MC-01 | SDK 어댑터, failover 차단, 호출 기록의 비밀 제거 시험   | F-01의 runner/probe commit과 유효한 Cloud preflight, 실제 권한·회수 증거. AWS/Jenkins/6대 전체 목록은 이 3인 합성 probe의 선행이 아니다.          |
| E-02 / OP-01 | 임시 디렉터리·주입 IO로 저널 순번/내구성/복구 실패 시험 | B 제어 큐 연결, F 지속 볼륨/OS에서 fsync·rename·writer lock 확인. B-01 전체 인수 전에도 저널 단위 구현을 진행한다.                                |
| E-03 / OP-02 | E-02와 연동한 예약/중복/복구/분·bytes 부족 시험         | 운영자가 확인한 공식 잔량과 실제 project alias. 합성 수치를 제품 초기 잔량으로 쓰지 않는다.                                                       |
| E-04 / OP-03 | 가짜 시계로 60초 창·600/900 상한·큐 deadline 시험       | 모든 실제 Gateway 메서드가 같은 scheduler를 거치는 연결 및 계정 공유 headroom. Cloud 부재가 큐 구현을 막지 않는다.                                |
| E-05 / MC-02 | E-02/03과 주입된 승인·거절 조건을 연결한 발급 단위 시험 | E-01의 SUPPORTED 증거, B 인증/phase/제어 큐, E-12~15의 실제 초기화·복구·공개창·READY/OPEN. D1의 단위 구현을 완성된 운영 발급으로 표시하지 않는다. |

Cloud가 막혀도 E-01의 `localStage`와 Cloud `blockedOn`을 따로 남기고 E-02–E-04를 수행한다. E-05의 정상 발급 fixture에서만 통제된 준비 조건을 주입하며 제품 factory의 초기 기본값은 RECOVERING/DRAINING이다. 이후 번호의 미구현 메서드를 성공 stub으로 채워 `MediaCoordinator` 전체가 완성됐다고 보고하지 않는다. 구현한 내부 모듈을 먼저 인계하고 전체 facade를 조립하는 E-12–E-16에서 B와 실제 연결을 검증한다.

고정번호 실행 준비는 `node scripts/prepare-execution.mjs --role E --tasks 1-5`, 날짜별 번호는 `node scripts/prepare-execution.mjs --role E --day D2 --tasks 1-5`로 확인한다. 이 명령은 작업 선택과 선행 조건을 보여 주며 제품 구현이나 Cloud 실행을 대신하지 않는다.

### F 설정 입력과 B 인증 조립에서 받는 값

F가 `env.ts`에서 검증하고 B가 `MediaConfiguration`으로 전달한다. E의 factory는 아래 중앙 타입 값만 읽으며 비밀값을 진행 문서에 복사하지 않는다.

| 입력                                                                                   | `MediaConfiguration` 또는 조립 대상                                              | 누락·불일치 처리                                                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`          | `httpUrl`, `wsUrl`, `apiKey`, `apiSecret`                                        | 제품 모드 구성 오류. 키 원문 로그 금지                                                                               |
| `LIVEKIT_PROJECT_ALIAS`, `SERVICE_NAMESPACE`, `OPS_DATA_DIR`                           | `projectAlias`, `namespace`, `opsDataDir`                                        | alias/namespace가 확인된 Cloud preflight 및 capability 증거와 다르면 발급·회수 대상 추정 금지                        |
| `OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS`, `OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS`          | `publicWindow` 또는 `null`                                                       | 둘 다 없으면 null로 신규 입장·resume 차단, 한쪽만 존재하거나 순서 오류는 구성 오류                                   |
| `OPS_OFFICIAL_BUDGET_MAX_AGE_MS`, `OPS_OPERATION_TIMEOUT_MS`                           | `officialBudgetMaxAgeMs`, `operationTimeoutMs`                                   | 양의 유한 정수 필수. 운영자가 정한 값 없이 임의 무제한/성공 기본값 사용 금지                                         |
| `MAX_SLOTS`, `MEDIA_MAX_NORMAL_API_CALLS_PER_60S`, `MEDIA_MAX_TOTAL_API_CALLS_PER_60S` | `maxConcurrentParticipants`, `maxNormalApiCallsPer60s`, `maxTotalApiCallsPer60s` | 검증된 운영 상한과 일치, 정상 ≤600·전체 ≤900 및 정상 ≤전체. 계획상 60세션을 검증 전 자동 개방하지 않음               |
| `OPS_DATA_DIR/official-usage-input.json`                                               | 공식 확인 뒤 `initialBudget`, 미확인이면 null                                    | E가 `OfficialBudgetCheckpoint`로 프로젝트·신선도·수치를 재검사하고 저장된 예약과 대조                                |
| B의 제품 인증·HTTP/WS 보호 초기화 결과                                                 | `productSecurityReady`                                                           | 환경변수로 true 지정하지 않음. B 초기화가 false면 E READY/grant 차단, B의 실제 거절 회귀 통과 증거를 함께 인계       |
| `OPS_TOKEN`                                                                            | E `createOperatorAuth(token)`에 B가 주입                                         | 빈 토큰은 구성 거절. 반환 인증 함수는 `(authorization: string\|undefined) => boolean`, 인증 누락/게임 Bearer는 false |

운영 명령 timeout은 `operationTimeoutMs`, 공식 입력 신선도는 `officialBudgetMaxAgeMs`로 비교한다. 두 단위는 ms이고 JWT/cutoff는 epoch 초다. 공개창·공식 입력·제품 인증 중 하나라도 미확인이면 success 기본값으로 메우지 않는다. `productSecurityReady`는 B 초기화의 증거일 뿐 원격 Cloud 권한·저널·잔량 조건을 대신하지 않는다.

### E-01

**MC-01 · [BE] 실제 Cloud 권한 제어 가능성 확인**  
일정: D1 2026-09-08 · **오늘 1번**  
기획 근거: v0.0.8 **18, 19, 26장**  
선행 완료 결과: [F-01](f-infra-qa.md#f-01) (DP-01, D1)

**수정·생성 파일**

- `server/src/media/LiveKitGateway.ts`
- `server/src/media/CloudCapabilityProbe.ts`
- `server/test/media/livekit-gateway.test.ts`
- `server/test/media/capability.cloud.test.ts`

**구현 순서**

1. DP-01의 계정 잔량 확인시각·시험 namespace·자격 주입·브라우저 probe를 확인한다. 실제 값이 없으면 Cloud 실행은 BLOCKED로 남기고 타입/순수 어댑터 작업만 한다. QA-01을 기다려 MC-01을 못 시작하는 순환 의존을 만들지 않는다.
2. LiveKitGateway 포트를 정의하고 RoomServiceClient(url,key,secret,{requestTimeout:1,failover:false})로 감싼다. 설치 소스의 기본 failover가 암묵 재전송한다는 사실을 테스트로 확인하고 끈다. API 호출마다 requestId·method·target·발송시각·결과를 비밀정보 없이 callback으로 내보낸다.
3. 격리 namespace의 방과 난수 Identity 3개를 만들고 AccessToken.addGrant로 roomJoin/room, canPublishData:false, canSubscribe:false, canPublishSources:[TrackSource.CAMERA,TrackSource.MICROPHONE]를 명시한다. roomAdmin/roomRecord/roomCreate/roomList는 참가자에게 부여하지 않는다. 브라우저는 autoSubscribe:false로 합성 얼굴/음성만 게시한다.
4. 송신 SID를 getParticipant().tracks로 확인한 뒤 updateSubscriptions(room,receiver,[sid],true/false)를 각각 실행한다. 허용자의 표식 수신과 불허자의 RemoteTrackPublication.setSubscribed(true) 직접 시도 후 신규 표식 미수신을 동시에 확인한다. 허용 성공만 확인하거나 클라이언트 gain=0을 강제로 취급하지 않는다.
5. removeParticipant의 SDK 기본 cutoff와 명시적 cutoff를 비교한다. 현재 epoch 초만 쓰는 경우, 현재 초+2초 여유를 주는 경우, SDK 기본값의 실제 처리를 분리 시험한다. cutoff 이전 nbf가 대상이므로 같은 초 발급 토큰과 SDK 갱신 토큰까지 거절되는지 확인한다. 60초 허용 시각 범위·관측 시계 오차를 지키며 통과한 모드와 bufferSeconds를 CapabilityReport.revocationProfile에 고정한다. 통과 프로필이 없으면 제품 회수를 지원한다고 표시하지 않는다. 미입장 토큰도 재접속으로 확인하고 참가자 부재만으로 회수 성공을 추정하지 않는다.
6. 환경 digest·사용한 권한 조합·요청 순서·표식/통계·거절 코드만 CapabilityReport로 기록하고 모든 probe Identity 회수/방 제거를 확인한다. 강제 구독 조합이 안 되면 MC-02 제품 경로를 막고 지원 조사와 G1 합격을 분리한다.

**연결 계약과 경계**

- SDK 근거: server/node_modules/livekit-server-sdk/dist/{RoomServiceClient,AccessToken,grants,ClientOptions,WebhookReceiver}.d.ts 및 src/TwirpRPC.ts, 2.18.0. 공식 [RoomService](https://docs.livekit.io/reference/other/roomservice-api/), [토큰](https://docs.livekit.io/frontends/reference/tokens-grants/).
- 계획 포트 LiveKitGateway={createRoom,listRooms,listParticipants,getParticipant,updateSubscriptions,updateParticipant,removeParticipant,deleteRoom}; 각 메서드는 SDK의 실제 인수/반환을 얇게 감싸고 모든 호출이 이후 OP-03 scheduler를 통과한다.
- E는 `CloudCapabilityProbe.ts`에서 `CapabilityReport`와 strict parser를 함께 export한다. 필드는 `status:'SUPPORTED'|'BLOCKED'`, `sdkVersion:string`, `cloudProjectAlias:string`, `namespace:string`, `testedAtEpochMs:number`, `grantProfile`, `revocationProfile`, `allowReceived:boolean`, `forbiddenRejected:boolean`, `revocationVerified:boolean`, `evidenceRefs:readonly string[]`다. `grantProfile`은 최소 권한을 명시한 실제 채택 grant이며 BLOCKED에서는 null을 허용한다. `revocationProfile`은 `{mode:'sdk-default'|'explicit-cutoff',bufferSeconds:number,maxObservedClockOffsetMs:number}` 또는 BLOCKED의 null이다. SUPPORTED는 두 프로필·세 boolean 참·실제 증거 참조가 모두 있어야 하며 사용자 데이터나 JWT를 담지 않는다.
- 검증 보고서는 비밀 없는 증거와 함께 인계하고 E 초기화는 `OPS_DATA_DIR/capability-report.json`을 읽어 위 parser로 검증한다. F가 검증한 보고서를 지속 볼륨에 배치하고 현재 `config.projectAlias`·namespace·SDK 버전과 대조한다. 보고서 부재/불일치/검증 프로필 변경은 LOCKED이며 빈 파일·수동 SUPPORTED 플래그로 통과시키지 않는다. 보고서 parser 단위 통과와 실제 MC-01 증거를 구분한다.
- 실증에서 canSubscribe=false+관리 선택 구독이 지원되지 않으면 canSubscribe=true만 열어 둔 제품을 출시하지 않는다. 다른 조합은 새 실제 증거 후에만 프로필로 채택한다.
- capability.cloud.test.ts도 F runner의 RUN_CLOUD_TESTS=1과 case별 preflight를 검사한다. 환경 미확보는 test.skip 통과가 아니라 BLOCKED/비정상 종료다.

**시험 입력 → 기대 결과**

- DP-01 자격 또는 확인된 잔량 없음 → Cloud 요청 0회, BLOCKED와 필요한 입력만 보고.
- 로컬 SDK 테스트에 네트워크 오류/5xx 주입 → 자동 failover 재전송 0회, 명시적 호출 1회로 집계.
- 허용 수신자와 불허 직접 구독 수신자 → 허용 표식은 도착하고 불허 새 표식은 없어야 SUPPORTED.
- 미입장·이미 퇴장한 Identity의 옛 JWT 재연결 → 실제 Cloud 거절을 확인해야 회수 검증 참; room 부재 조회만으로 참 금지.

**추가·보완할 시험 파일**

- `server/test/media/livekit-gateway.test.ts`
- `server/test/media/capability.cloud.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/livekit-gateway.test.ts
node scripts/run-cloud-check.mjs --case MC-01 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/MC-01
pnpm typecheck
pnpm lint
```

**완료 조건**

격리된 테스트 방에서 최소 grant·autoSubscribe=false 조건의 허용 수신과 불허 직접 subscribe 차단, 토큰 회수 수단을 실제 SDK/Cloud로 확인한다. 버전·설정·합성 표식 증거를 남긴다. 불가능하면 조사 완료와 G1 실패를 구분하고 제품 연동을 차단한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: LiveKit 권한 검증 어댑터 추가
```

**MR 본문에 채울 변경 사항**

- 고정 SDK 메서드만 쓰는 gateway와 격리 Cloud capability probe를 추가한다.
- 실제 실행 시 지원 프로필·차단 결과·회수 결과와 미실행 항목을 구분해 MR에 적는다.

**MR 리뷰 포인트**

- SDK failover가 숨은 재시도를 만들지 않는지 확인한다.
- 직접 subscribe 차단과 미입장 토큰 회수가 실제 Cloud 증거인지 확인한다.

**완료 인계**

- D에게 채택된 grant/source 조합과 probe 접속 방법을 D1 early로 전달한다.
- B에게 CapabilityReport가 SUPPORTED이기 전 제품 grant를 반환하지 말라는 조건을 전달한다.
- F QA-01에 gateway 포트·requestId·SDK 버전과 probe evidence 형식을 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-02

**OP-01 · [BE] 지속 저널과 원자적 체크포인트**  
일정: D1 2026-09-08 · **오늘 2번**  
기획 근거: v0.0.8 **22.1, 23장**  
선행 완료 결과: [B-01](b-game-server.md#b-01) (SV-01, D1)

**수정·생성 파일**

- `server/src/operations/OperationJournal.ts`
- `server/src/operations/CheckpointStore.ts`
- `server/test/operations/journal.test.ts`

**구현 순서**

1. 필드 allowlist를 가진 버전 있는 레코드를 JSONL로 정의한다. seq는 단조 증가, state는 PREPARED/REVOKING/REVOKED/UNRESOLVED, 원격 식별자·세대·발급/만료시각만 허용한다. 키가 추가된 입력은 버리거나 직렬화하지 말고 스키마 오류로 거절한다.
2. 파일 접근을 하나의 비동기 쓰기 큐에 모으고 append→FileHandle.sync 완료 후 Promise를 resolve한다. 완료 callback은 B.enqueueControl로 되돌리고 GameCore Tick 안에서 appendFileSync/fsyncSync를 호출하지 않는다.
3. 체크포인트는 같은 지속 볼륨의 임시 파일에 전체 상태와 lastSeq를 쓰고 sync→원자적 rename→지원 OS의 디렉터리 sync 순서로 교체한다. 이전 정상 파일은 새 교체 확인 전 삭제하지 않는다.
4. 재생 시 줄 종결·버전·seq 연속성·checksum을 검사하고 중간/꼬리 부분 레코드와 손상을 구분한다. 불명 발급 가능성이 있으면 자동 truncate 후 READY로 넘어가지 않고 restore 결과에 unresolved를 남긴다.
5. 저널 파일과 checkpoint 경로는 외부 주입 OPS_DATA_DIR 아래로 제한하고 단일 프로세스 배타 lock을 취득한다. lock 충돌·디스크 부족·쓰기 실패는 writable=false와 발급 잠금으로 전파한다.

**연결 계약과 경계**

- Journal.append(record):Promise<{seq,durable:true}>; restore():Promise<{records,lastSeq,integrity:'ok'|'missing'|'corrupt'|'partial',writable:boolean}>; close()는 큐를 기다린다.
- 저널은 게임 스냅샷/DB가 아니다. match 참조 외 닉네임·좌표·맵·JWT·Secret·raw/가공 미디어를 넣지 않는다.
- OP-05에 복원 결과와 손상 구간을 전달하며 원본 손상파일을 덮어쓰지 않는다.

**시험 입력 → 기대 결과**

- PREPARED sync 직전 process 종료를 모사 → 발급 반환되지 않으며 복원 결과가 불명 발급을 표시.
- seq 1,2,4 또는 잘린 마지막 JSON → 무결성 오류와 발급 잠금, 0으로 초기화하지 않음.
- 체크포인트 rename 전/후 중단 → 이전 또는 새 정상 checkpoint를 읽고 lastSeq 이후만 한 번 재생.
- ENOSPC·동시 두 번째 writer → 오류와 writable=false, Tick 계산은 블로킹되지 않음.

**추가·보완할 시험 파일**

- `server/test/operations/journal.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/operations/journal.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

지속 볼륨에 단일 쓰기자·순번·부분 레코드 감지·원자적 교체·필수 디스크 반영을 구현한다. 저장 실패 시 발급을 잠그고 Tick 내부 동기 IO를 금지한다. 허용 운영 식별자/상태만 저장하며 JWT·닉네임·위치·미디어를 기록하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 미디어 운영 저널과 체크포인트 추가
```

**MR 본문에 채울 변경 사항**

- 디스크 반영을 보장하는 운영 기록과 복원 결과 계약을 추가한다.
- 부분 기록·쓰기 실패·중복 writer 검사 결과를 제시한다.

**MR 리뷰 포인트**

- 발급 Promise가 fsync 완료 전에 resolve되지 않는지 확인한다.
- 손상된 기록을 삭제하고 복구 성공이라고 처리하지 않는지 확인한다.

**완료 인계**

- B에게 journal 완료 callback은 enqueueControl로만 반영하도록 전달한다.
- F DP-02에 OPS_DATA_DIR 지속 볼륨·권한·단일 인스턴스 lock 요구를 전달한다.
- E OP-02/05에 seq·integrity·writable 계약을 고정한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-03

**OP-02 · [BE] 참가자분·GB 예약과 시작 차단**  
일정: D1 2026-09-08 · **오늘 3번**  
기획 근거: v0.0.8 **21, 22장**  
선행 완료 결과: [E-02](e-media-operations.md#e-02) (OP-01, D1), [F-01](f-infra-qa.md#f-01) (DP-01, D1)

**수정·생성 파일**

- `server/src/operations/UsageBudget.ts`
- `server/src/operations/UsageCheckpoint.ts`
- `server/test/operations/usage-budget.test.ts`

**구현 순서**

1. 운영자가 실제 Cloud 계정을 확인해 제공한 `OPS_DATA_DIR/official-usage-input.json`의 OfficialBudgetCheckpoint={projectAlias,remainingMinutes,remainingBytes,checkedAtEpochMs,source:'cloud-dashboard',checkedBy}를 strict 검증해 체크포인트로 저장한다. 예시/dummy·빈 파일·계정 불일치·기한 지난 확인은 실패다. 확인값과 내부 개발/부하/공개/예비 bucket을 연결하고 5000분/50GB를 새 잔량으로 자동 가정하지 않는다.
2. reserve({reservationId,matchId,purpose,slots:6,expectedMinutes,expectedBytes,margin})를 단일 쓰기 큐에서 처리한다. 공식 잔량에서 기존 활성 예약과 안전 여유를 뺀 뒤 분과 bytes를 모두 검사하고 기록 반영 후 승인한다.
3. 동일 reservationId는 같은 입력에 한 번만 예약하고 다른 입력 재사용은 거절한다. 팀 연습/경기/재연결 오버헤드를 계산에 포함하되 일시 중복 미디어 연결을 허용하는 근거로 사용하지 않는다.
4. 저널 손상·잔량 미확인·기한 지난 공개창·미회수 세대 중 하나라도 있으면 신규 발급 가능=false를 반환한다. OP-04가 회수 확인 및 공식 사용량 조정을 전달하기 전 예약을 풀지 않는다.
5. 재시작 restore에서 활성 예약과 미해결 점유를 복구한다. 공식 사용량 갱신은 period/version으로 중복 반영을 막고 현지 추정량은 공급자 청구량과 별도로 보고한다.

**연결 계약과 경계**

- UsageBudget.reserve()/markRetiring()/reconcileOfficial()/releaseConfirmed()/snapshot(); 결과 code B에게 안전한 예산 부족/미확인으로 변환 요청.
- 분과 GB 중 먼저 부족한 차원을 기준으로 거절한다. GB는 내부 bytes로 고정하고 산술 단위와 반올림 여유를 문서화한다.
- 900 참가자분 본시험+300 오버헤드는 QA-12 계획 예산이며 계정 잔량이 이를 보장하지 않는다.

**시험 입력 → 기대 결과**

- 잔량100분,활성80분,신규30분 → reserve 거절, 파일과 메모리 예약 불변.
- 분 충분·bytes 부족 → 같은 방식으로 거절.
- 동일reservationId 재전송 → 차감1회, 다른payload로 재사용하면 충돌.
- 서버 재시작·미회수 reservation 존재 → 예약 유지, 잔량0초기화/자동 해제 없음.

**추가·보완할 시험 파일**

- `server/test/operations/usage-budget.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/operations/usage-budget.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

운영자 확인 공식 잔량에서 진행 예약과 신규 6인 예상 비용·여유를 차감한다. 분/GB 중 먼저 부족한 항목, 미확인 잔량·체크포인트 유실·미회수 세대는 새 토큰을 막는다. 재시작에 0으로 초기화하지 않고 개발/부하/공개/예비 예산을 분리한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 미디어 사용량 예약과 발급 차단 추가
```

**MR 본문에 채울 변경 사항**

- 공식 잔량·추정치·예약을 구분하고 분/전송량 양쪽 입장 제한을 추가한다.

**MR 리뷰 포인트**

- 미디어 종료 응답만으로 예약을 해제하는 경로가 없는지 확인한다.
- 공식 잔량을 고정 무료 총량으로 초기화하지 않는지 확인한다.

**완료 인계**

- B AC-04와 MC-02에 reserve 결과·idempotency key·발급잠금 사유를 전달한다.
- F QA-11/12에 사전 예산 파일 schema와 확인시각/periodId를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-04

**OP-03 · [BE] 전체 관리 API 예산과 우선순위**  
일정: D1 2026-09-08 · **오늘 4번**  
기획 근거: v0.0.8 **19, 21, 25, 26장**  
선행 완료 결과: [F-01](f-infra-qa.md#f-01) (DP-01, D1)

**수정·생성 파일**

- `server/src/operations/ApiBudget.ts`
- `server/src/media/LiveKitGateway.ts`
- `server/test/operations/api-budget.test.ts`

**구현 순서**

1. 프로젝트 단위 monotonic 60초 sliding window의 발송 timestamp deque를 만든다. 요청 완료가 아니라 실제 발송 직전에 카운터를 늘리고 실패/429/조회도 1회로 센다.
2. kind='grant'|'revoke'|'query'|'room'와 priority='normal'|'cleanup'을 받는 dispatch 큐를 둔다. 정상 600회 한도에서 새 허용을 멈추고 긴급 정리에 900회 안전 상한까지 남은 슬롯을 사용한다. 같은 창의 전체 호출 합계는 별도로 노출한다.
3. LiveKitGateway 전 메서드를 이 scheduler를 통해서만 호출하고 failover:false를 강제한다. 직접 SDK 생성 위치를 정적 검색으로 제한하며 OP-04 재시도도 새 dispatch로 집계한다.
4. 차단 deadline을 넘길 큐 대기는 승인하지 말고 MC-05의 UNKNOWN/retire 통제로 전달한다. 예산이 없다는 이유로 6초 고정 폴링이나 수신 권한을 열어 두는 대안을 넣지 않는다.
5. abort/close 때 대기 허용은 취소하지만 이미 발송된 요청은 취소됐다고 기록하지 않는다. shutdown 정리 큐와 새 요청 잠금의 상태를 측정 callback에 보낸다.

**연결 계약과 경계**

- dispatch<T>({requestId,method,target,priority,deadlineMs,run:()=>Promise<T>}):Promise<T>; monotonic clock와 timer는 주입한다.
- SDK 근거: ClientOptions.d.ts requestTimeout 초·failover boolean, src/TwirpRPC.ts 기본 자동 재전송. {requestTimeout:1,failover:false} 사용.
- 단일 프로젝트에서 다른 앱도 API를 사용하면 DP-01 잔여 headroom 확인 후 내부 상한을 낮춘다. 900은 G2 합격 상한이 아니다.

**시험 입력 → 기대 결과**

- 정상 600번째 후601번째 허용 → 대기/거절, 발송 없음; 긴급 회수는 남은900한도까지 진행.
- 899회에서 회수2개 → 900번째만 발송,901번째 금지.
- 5xx 후 OP-04 명시 재시도 → 원호출과 재시도 각각 집계, SDK 숨은 발송0.
- 큐 차단대기1초 초과 → 허용 재개 대신 불명 제어통지.

**추가·보완할 시험 파일**

- `server/test/operations/api-budget.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/operations/api-budget.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

생성·조회·참가자·구독·회수·삭제·재시도 전체를 서비스 합산 60초 창으로 센다. 정상 목표 600회·긴급 포함 내부 상한 900회에 맞춰 정리를 우선한다. 무제한 재시도·참가자당 6초 폴링으로 차단 지연을 포기하는 방식을 금지한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 전체 미디어 API 예산 제어 추가
```

**MR 본문에 채울 변경 사항**

- 모든 관리 호출을 하나의 이동 시간 창과 정리 우선 큐에 모은다.

**MR 리뷰 포인트**

- SDK 내부 failover와 조회·재시도가 예산 밖에서 실행되는지 확인한다.
- 정상 G2 수치와 긴급 상한을 섞지 않는지 확인한다.

**완료 인계**

- MC-04/07·OP-04/06 전 호출을 dispatch에 연결한다.
- F DP-05에 total60s/normal60s/queueWait/429 metric 이름과 정의를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-05

**MC-02 · [BE] 세대별 Identity와 미디어 토큰 발급**  
일정: D1 2026-09-08 · **오늘 5번**  
기획 근거: v0.0.8 **18, 19, 22장**  
선행 완료 결과: [E-01](e-media-operations.md#e-01) (MC-01, D1), [B-08](b-game-server.md#b-08) (AC-03, D1), [E-02](e-media-operations.md#e-02) (OP-01, D1), [E-03](e-media-operations.md#e-03) (OP-02, D1)

**수정·생성 파일**

- `server/src/media/MediaCoordinator.ts`
- `server/src/media/MediaGenerationRegistry.ts`
- `server/src/media/GrantIssuer.ts`
- `server/test/media/grant-issuer.test.ts`

**구현 순서**

1. createMediaCoordinator(deps)의 `prepareGeneration(input:PrepareGenerationRequest):Promise<PreparationResult>`를 구현한다. B가 검증한 requestId/matchId/playerId/mediaInstanceId/purpose/expectedPreviousGeneration을 받고 registry의 현재 상태와 OP-08 readiness/OP-02 budget을 다시 확인한다. factory 생성이나 initialize 완료만으로 발급하지 않으며 readiness=READY와 admission=OPEN을 모두 만족하기 전에는 NOT_READY로 거절한다. E가 새 receiverGeneration을 할당해 결과/grant로 반환하며 클라이언트가 새 세대를 지정하지 않는다. 입력·결과 타입은 `docs/execution/contracts/types.ts`를 기준으로 한다.
2. 논리 playerId와 무관한 crypto.randomUUID 기반 roomName/identity를 생성한다. namespace/epoch 접두사와 난수만 쓰고 role/닉네임/좌표를 넣지 않는다. 같은 목적 instance 참가자는 같은 mediaRoom에 모이고 연습 팀은 별도 instance이다.
3. 예약 승인 후 PREPARED를 await journal.append하여 내구성 확보한다. AccessToken(key,secret,{identity,ttl:300})와 MC-01에서 검증한 최소 grant/source 프로필로 await toJwt()한다. 디스크 기록이 안 되면 서명/반환을 진행하지 않는다.
4. JWT 반환 직전에 session/phase/generation/terminal/ready를 다시 확인한다. 생성 중 종료되면 토큰을 반환하지 않고 해당Identity를 회수 큐에 남긴다. 키는 환경 주입만 받는다.
5. 동일 server-authenticated requestId의 재전송은 같은 미만료 PreparationResult/grant를 메모리에서 반환하며 저널/예약/Identity를 중복 생성하지 않는다. 같은 requestId의 다른 입력은 거절한다. 전체 세대 교체는 MC-08 장벽을 통해 새 requestId와 expectedPreviousGeneration을 요청해야 한다.

**연결 계약과 경계**

- SDK 근거: server/node_modules/livekit-server-sdk/dist/{RoomServiceClient,AccessToken,grants,ClientOptions,WebhookReceiver}.d.ts 및 src/TwirpRPC.ts, 2.18.0. 공식 [RoomService](https://docs.livekit.io/reference/other/roomservice-api/), [토큰](https://docs.livekit.io/frontends/reference/tokens-grants/).
- PreparationResult는 공통 요청 식별키와 `status:'ready'`+grant, `status:'rejected'`+code, `status:'unknown'`+code의 구분 결과다. ready/unknown은 E가 할당한 receiverGeneration:number를 갖고, 세대 할당 전 rejected는 receiverGeneration:null을 허용한다. 거절을 숫자 0의 유효 세대처럼 사용하지 않는다. token은 HTTP Cache-Control:no-store 응답 본문에만 쓰고 로그/URL/영구저장에는 넣지 않는다.
- PreparationResult.status='ready'는 JWT 발급 준비 성공이며 미디어 접속·가공얼굴 게시·수신 준비 확인이 아니다. B는 이후 서버가 확인한 self binding의 faceTrackSid와 LOAD_READY 신고를 함께 검사해야 하며 source=CAMERA만으로 가공 얼굴 진위를 증명하지 않는다.
- B POST /api/media/grants가 requestId를 논리 세션+match+mediaInstanceId+목적+수신자 세대에 안정적으로 연결해 trusted 입력으로 전달한다. 클라이언트가 보낸 세대와 instance는 서버 현재값에 대조한다. 비동기 통지는 `deps.enqueueControl(control:MediaControl)`만 사용하고 B가 동일 식별키를 재확인한 뒤 권위 큐에서 반영한다.
- 권한 canPublishSources는 CAMERA/MICROPHONE만; source=CAMERA라는 신고가 가공 얼굴의 진위를 증명한다는 주장은 금지.

**시험 입력 → 기대 결과**

- 동시 같은 requestId/같은 입력 2요청 → 동일 Identity/예약 1개, PREPARED 1회; 이전 세대 불일치 → STALE_GENERATION 거절.
- journal.sync 실패 → token 반환0·gateway grant0, ready잠금.
- 서명 도중 개인종료/구세대terminal → 반환거절, PREPARED 회수대상 유지.
- phase LOBBY 또는 다른팀practiceInstance 주장 → Cloud 연결/토큰 없이 거절.
- initialize 결과가 initialized/RECOVERING 또는 initialized/LOCKED → 새 세대·예약·JWT 0; 복구 후 READY여도 DRAINING이면 NOT_READY, resume 성공 후 OPEN일 때만 준비 진행.

**추가·보완할 시험 파일**

- `server/test/media/grant-issuer.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/grant-issuer.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

playerId와 별도 난수 mediaIdentity/roomName을 발급하고 해당 사람의 mediaInstanceId/receiverGeneration에 연결한다. 세션·상태·예산 검사→PREPARED 디스크 반영→최소 권한·5분 TTL JWT 생성→현재 상태 재검사→PreparationResult 반환 순서를 검증한다. 기록 실패·반환 전 종료·terminal 재발급을 거절하고 미입장 발급도 추적한다. 전체 전환은 MC-08에서 검증한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 세대별 미디어 토큰 발급 추가
```

**MR 본문에 채울 변경 사항**

- 내구 기록과 사전 예산 검사를 통과한 세대에만 최소 grant를 반환한다.

**MR 리뷰 포인트**

- 반환 전 TOCTOU 재검사와 요청 멱등성이 실제 동시시험에 포함되는지 확인한다.
- media room/Identity에 공개되면 안 되는 정보가 들어가지 않는지 확인한다.

**완료 인계**

- B에 PrepareGenerationRequest/PreparationResult·MediaControl의 실제 구현과 정상/거절/불명 fixture를 D1 종료 전에 인계한다. 원본 fixture 검사 통과와 제품 모듈 연결 통과는 따로 보고한다.
- D에 MediaGrant와 미디어 보고는 권한승인이 아니라는 조건을 전달한다.
- F env의 `LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`과 위 설정 입력 표를 F 소유로 추가 요청한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-06

**MC-03 · [BE] 경로 기반 가청 정책과 효과음 필터**  
일정: D2 2026-09-09 · **오늘 1번**  
기획 근거: v0.0.8 **08, 14장**  
선행 완료 결과: [A-03](a-game-core.md#a-03) (MP-03, D1), [A-09](a-game-core.md#a-09) (RL-01, D1), [B-11](b-game-server.md#b-11) (SV-07, D1)

**수정·생성 파일**

- `server/src/media/AudibilityPolicy.ts`
- `server/src/media/AudioProjection.ts`
- `server/test/media/audibility-policy.test.ts`

**구현 순서**

1. TrustedMediaFrame의 matchId/mediaInstanceId/instancePurpose/frameRevision/tick/phase/topology/participants/events를 읽는다. participants는 B가 확정한 GameSubject이며 E가 자기 registry의 세대·Identity·게시 목록과 결합한다. topology에서 수신자 기준 깊이 6까지 BFS하여 최단경로와 코너 수를 구하고 클라이언트 좌표 신고를 사용하지 않는다. 과거 frameRevision은 폐기한다.
2. 미허용 pair는 distance<=5에서 켜고 허용 pair는 distance>6/경로없음/종료에서 끈다. 5<distance<=6은 직전 관계를 유지한다. 연습은 동일 팀 instance, 경기는 양팀 공통 규칙이다.
3. 거리별 gain과 코너별 추가 감쇠/lowpass를 튜닝 입력으로 계산하고 clamp한다. spec에 없는 계수를 검증된 수치라고 만들지 말고 초기 함수를 코드와 테스트에 명시한다. 상대 방위는 수신자 dir 기준으로 계산한다.
4. B가 A의 확정 사건에서 만든 SpatialSoundEvent의 footstep/sensor/trap만 처리한다. footstep은 move 완료 때만 경로 4셀 이내에 전달하고 turn은 무음이다. 술래 장비 사건도 수신자의 경로·mediaInstanceId·활동상태를 검사한다. 도망자 아이템의 효과음·획득음·사용음은 결정 대기이며 임의로 생성하지 않는다.
5. B protocol AudioPolicy로 필요한 음향값만 projection한다. `audio-policy` 채널에 mediaInstanceId·receiverGeneration·policyRevision·bindingRevision과 voices/effects를 보낸다. 목표 관계·음향값·확인된 바인딩이 바뀔 때 전체 상태를 교체하고, 원본 cell/전체 path/graph는 DTO에 넣지 않는다.

**연결 계약과 경계**

- `observeFrame(frame:TrustedMediaFrame):void`는 동기 목표 계산·큐 갱신만 하고 Cloud await는 하지 않는다. 시간 소비가 크면 A의 정적 경로 인덱스를 전달받아 사용한다. 필드와 판별자는 EXEC-CONTRACT-3의 중앙 타입과 일치시킨다.
- AudioPolicy는 EXEC-CONTRACT-3의 B 소유 스키마를 사용한다. 최상위 receiverGeneration은 메시지를 받는 사람의 연결 세대이며 voice의 trackSid는 해당 bindingRevision의 발신자 바인딩과 대조한다. policyRevision은 같은 matchId/mediaInstanceId/receiverGeneration 안에서 증가하고 전체 교체 의미다.
- B는 `audio-policy`를 C에 전송하고 C는 D.applyAudioPolicy에 그대로 전달한다. D는 필요한 bindingRevision이 아직 없으면 제한된 보류 상태에 두고 바인딩·정책·트랙 어느 쪽의 도착에도 재대조한다. 오래된 revision은 폐기하고 퇴장·인스턴스 변경에는 모두 닫는다.
- E는 `deps.enqueueAudioPolicy(playerId,message)`로 B의 송신 큐에 맡긴다. MediaCoordinatorDeps의 공개 config·clock·callback은 중앙 타입을 따르고 SDK gateway/저널/registry는 E의 private helper로 조립한다. 타입이 없는 deps 필드를 추가해 다른 담당자에게 구현을 떠넘기지 않는다.
- 가청 방향·gain으로 대략 위치를 추측 가능한 것은 명세 허용정보다. 원본 좌표 은폐와 무정보 보장을 혼동하지 않는다.

**시험 입력 → 기대 결과**

- 미허용 거리5 → 허용;6 → 이전 상태유지;7 → 차단.
- 직선거리1이지만 벽우회경로7 → 차단, Euclidean거리로 허용하지 않음.
- 이동완료 거리4와5 수신자 →4만발소리;회전→둘다무음.
- 탈출자·다른연습instance → 관계/효과목록없음, payload에cell없음.

**추가·보완할 시험 파일**

- `server/test/media/audibility-policy.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/audibility-policy.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

음성은 최단 경로 5셀 이하 진입/6셀 초과 이탈과 벽·코너 감쇠를 적용한다. 발소리는 이동 완료 때 4셀 이내, 제자리 회전은 무음이다. 확정된 장비 음향만 같은 수신자 정책을 사용하고 필요한 음향값만 `audio-policy` 전체 교체 메시지로 보낸다. 도망자 아이템 음향은 결정 대기로 남긴다. 바인딩보다 정책이 먼저 와도 현재 수신자 세대와 확인된 발신자 트랙에만 적용한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 경로 기반 가청 정책과 음향 뷰 추가
```

**MR 본문에 채울 변경 사항**

- 가청 완충과 수신자별 음향 파생값을 계산하고 위치 원본을 제외한다.

**MR 리뷰 포인트**

- 5/6 경계와 벽 우회·코너 계산이 전원에게 동일한지 확인한다.
- 음향 payload가 source cell을 우회 노출하는지 확인한다.

**완료 인계**

- B SV-07에 EXEC-CONTRACT-3의 observeFrame 입력과 `audio-policy` 전체 교체 출력 fixture를 D2 중간에 전달한다.
- C/D에게 수신자·발신자 세대 구분, revision과 gain/방위/필터 단위, 정책·바인딩·트랙 순서 독립 처리 fixture를 전달한다.
- F QA-07/QA-12에 이전 허용 상태를 포함한 경로 5→6→7→6→5 fixture를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-07

**MC-04 · [BE] 수신자·세대별 구독 정책 직렬화**  
일정: D2 2026-09-09 · **오늘 2번**  
기획 근거: v0.0.8 **19, 25장**  
선행 완료 결과: [E-05](e-media-operations.md#e-05) (MC-02, D1), [E-06](e-media-operations.md#e-06) (MC-03, D2), [E-04](e-media-operations.md#e-04) (OP-03, D1)

**수정·생성 파일**

- `server/src/media/SubscriptionController.ts`
- `server/src/media/MediaCoordinator.ts`
- `server/test/media/subscription-controller.test.ts`

**구현 순서**

1. key=(mediaInstanceId,mediaRoomName,receiverIdentity,receiverGeneration)마다 desiredTracks Set, acknowledgedTracks Set, policyVersion, requestSerial, inFlight를 보관한다. 대상 트랙은 확인된 publisherGeneration/participantSid/trackSid와 함께 관리한다. 목표변경은 pending 최신값 하나로 덮어쓴다.
2. drain 직전 현재 registry의 active/세대/SID 소유를 다시 확인한다. acknowledged-desired의 차단 batch를 먼저 OP-03 dispatch하고 확정응답 후 최신 목표와 비교한다. 그 다음 desired-acknowledged 허용 batch를 발송한다.
3. 한 SDK 요청은 subscribe boolean이 하나이므로 추가와 제거를 한 요청으로 합치지 않는다. 같은 대상 정상요청은 하나만 inFlight이며 다른 수신자는 전역 예산 아래 병렬화한다.
4. 응답의 requestId/세대가 현재와 맞을 때만 acknowledged를 바꾸고 다시 drain한다. responseReceived는 실제 청취 차단 증거와 구분하여 기록한다. E의 내부 Gateway·scheduler 측정값은 `deps.emitMetric(sample)`에 보내며 F가 정의한 이름·단위를 사용한다.
5. target이 terminal이면 pending 허용을 버리고 MC-07로 위임한다. 이미 발송된 요청은 원격 취소로 간주하지 않고 MC-05 경쟁 규칙을 유지한다.

**연결 계약과 경계**

- SubscriptionController.setDesired({key,policyVersion,trackSids,generatedAtMs}):void; dispose/retire는 새 허용을 닫는 멱등 조작이다.
- SDK updateSubscriptions(room,identity,trackSids,subscribe):Promise<void> 사용; 앱 policyVersion을 Cloud가 비교한다고 가정하지 않는다.
- OP-03 Gateway 밖의 직접 SDK 호출은 금지한다. `MediaCoordinatorDeps.emitMetric`은 중앙 `MetricSample`을 받는 동기 `void` callback이다. `atMs`는 서버 monotonic ms이며 이름·단위 allowlist는 F의 `server/src/observability/MetricRegistry.ts`가 유일한 원본이다. F는 `media.api.total60s`, `media.api.normal60s`, `media.api.429`, `media.policy.queueWait`, `media.policy.responseLatency`, `media.retirement.unresolved` 등 등록명·단위와 factory commit을 인계한다. callback에서 IO 완료를 기다리거나 throw하여 권한 처리/Tick을 실패시키지 않으며 유계 큐의 누락 수는 F가 별도 계측한다. raw Identity·토큰·좌표를 sample에 넣지 않는다.

**시험 입력 → 기대 결과**

- v10 허용 진행 중 v11 차단 → 동시 요청 1개, 응답 후 차단을 먼저 발송.
- 동시에 addA/removeB → removeB 성공 후 addA, 같은 요청의 혼합 flag 없음.
- 발송 직전 SID 세대 변경 → pending의 구 SID 삭제, 새 SID는 재검증 전 허용 0.
- API 응답 성공·브라우저 수신 효과 미확인 → ack만 갱신, 실효 통과 상태는 미확인.

**추가·보완할 시험 파일**

- `server/test/media/subscription-controller.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/subscription-controller.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

desired/acknowledged/inFlight와 policyVersion을 분리하고 대상별 일반 요청 1개만 보낸다. 차단 우선·최신 목표 병합·발송 직전 세대/트랙/terminal 재확인·API 예산을 검사한다. API 응답 시각과 실제 수신 적용 시각을 별도 계측한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 수신자별 구독 정책 직렬화 추가
```

**MR 본문에 채울 변경 사항**

- 목표병합·차단우선·대상별1요청 제어기를 추가한다.

**MR 리뷰 포인트**

- 실행직전registry재검사와응답후최신목표수렴을확인한다.
- acknowledged를실제수신증거로이름바꾸거나보고하지않는지확인한다.

**완료 인계**

- MC-05에 deadline/requestSerial/inFlight 제어점을 넘긴다.
- F QA-01에 dispatch/response 콜백을 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-08

**MC-05 · [BE] 권한 결과 불명과 늦은 응답 처리**  
일정: D2 2026-09-09 · **오늘 3번**  
기획 근거: v0.0.8 **19, 24장**  
선행 완료 결과: [E-07](e-media-operations.md#e-07) (MC-04, D2), [B-01](b-game-server.md#b-01) (SV-01, D1)

**수정·생성 파일**

- `server/src/media/PolicyUncertainty.ts`
- `server/src/media/SubscriptionController.ts`
- `server/test/media/policy-uncertainty.test.ts`

**구현 순서**

1. 각 request 발송에 monotonic deadline=sentAt+1000을 설정하고 보안차단은 desiredAt+1000 deadline도 따로 추적한다. 더 이른 기한이 지나면 한번만 UNKNOWN 처리한다.
2. UNKNOWN 전환 시 해당 수신자 세대를 RETIRING terminal로 고정하고 pending 허용을 취소한다. `MediaControl`의 MEDIA_FAILED에 eventId/matchId/playerId/mediaInstanceId/receiverGeneration과 code='POLICY_UNKNOWN'을 넣어 deps.enqueueControl로 전달한다. B는 eventId+scope로 중복/구 세대를 차단하고 현재 게임의 MEDIA_POLICY_UNCERTAIN 처리를 권위 큐에서 수행한다. 준비·회수의 비동기 결과는 각각 requestId로 추적한다.
3. 실행중 Promise는 then/catch를 소비하여unhandledrejection을막되늦은성공/실패는requestId·세대태그진단으로만남긴다. AbortController 취소를원격취소로표현하지않는다.
4. MC-07 retirement는불명일반요청의완료를무한대기하지않고예외정리경로로진행한다. 구Identity를영구폐기하여늦은허용이새Identity에연결될수없게한다.
5. Cloud복구10초창과보안불명1초를분리하고,OP-07에새경기·새grant잠금사유를공유한다.

**연결 계약과 경계**

- 불확실성은 중앙 MediaControl의 실패 변형으로 통지한다. 별도 UncertaintyEvent wire 계약을 만들지 않으며 B만 MatchState를 변경한다. 자발 장애는 eventId+scope, 준비·회수 결과는 requestId+scope로 검증하고 늦은 구 세대 결과는 진단 기록만 남긴다.
- 보안 기한 검사는 주입 clock/timer의 1초 제한을 유지한다. SDK HTTP 응답 대기는 운영 timeout을 사용하며 별개다. 늦은 응답이나 중복 실패에도 terminal 전환은 1회다.

**시험 입력 → 기대 결과**

- 응답999ms→일반수렴;1001ms→UNKNOWN/RETIRING·무효control1회.
- API발송대기중차단목표1001ms초과→발송안됐어도보안기한위반처리.
- timeout후늦은성공→ACTIVE복귀0·새세대ack변경0.
- 10초연결복구창이남음+권한UNKNOWN→즉시무효,10초대기없음.

**추가·보완할 시험 파일**

- `server/test/media/policy-uncertainty.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/policy-uncertainty.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

응답 1초 초과·보안 차단 지연/실패는 UNKNOWN→RETIRING으로 전환하고 즉시 MEDIA_POLICY_UNCERTAIN 무효·회수 의도를 만든다. 10초 일반 연결 복구를 기다리지 않으며 늦은 성공 응답으로 현재 권한을 다시 열지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 미디어 권한 결과 불명 처리 추가
```

**MR 본문에 채울 변경 사항**

- timeout·지연차단·늦은응답의terminal규칙과권위control인계를추가한다.

**MR 리뷰 포인트**

- timeout 뒤성공응답으로UI/서버권한을다시여는경로가없는지확인한다.
- B소유Room상태를비동기콜백에서직접고치지않는지확인한다.

**완료 인계**

- B에MEDIA_POLICY_UNCERTAIN control조건과멱등키를전달한다.
- F QA-03에clock/transport지연주입점을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-09

**MC-06 · [BE] 트랙 변경 감지와 현재 게시물 대조**  
일정: D2 2026-09-09 · **오늘 4번**  
기획 근거: v0.0.8 **18, 19, 20장**  
선행 완료 결과: [E-05](e-media-operations.md#e-05) (MC-02, D1), [E-07](e-media-operations.md#e-07) (MC-04, D2)

**수정·생성 파일**

- `server/src/media/TrackRegistry.ts`
- `server/src/media/LiveKitWebhook.ts`
- `server/test/media/track-registry.test.ts`
- `server/test/media/webhook.test.ts`

**구현 순서**

1. WebhookReceiver.receive(rawBody,authorization,false)로서명과bodyhash를검증한다. B에게 express.raw({type:'application/webhook+json'})를JSONmiddleware보다먼저등록하고Buffer를UTF8문자열로전달하도록요청한다.
2. 검증event.id로제한크기중복캐시를두고room/identity/epoch/세대를서비스registry와대조한다. event.createdAt만으로최신상태라단정하지않고역순·불명상태는OP-03예산을거친getParticipant/listParticipants조회로수렴한다.
3. 서버 Webhook의 실제 event 값 `track_published`, `track_unpublished`, `participant_joined`, `participant_left`, `participant_connection_aborted`, `room_finished`로 분기한다. D의 RoomEvent.TrackSubscribed/TrackPublished/ParticipantConnected/Reconnected와 B의 클라이언트 report는 별도 입력이다. current tracks의 SID/source/type와 확인된 세대를 대조하여 삭제 SID 대기작업을 폐기하고 새 SID는 검증 전 기본 차단한다.
4. Webhook 누락·늦은 도착에 대비해 grant/전환 중인 참가자, 이벤트 역순, client report, 마지막 서버 확인 뒤 30초가 지난 active registry를 dirty로 표시한다. dirty 참가자만 중복 병합하고 참가자별 최소 5초 간격의 낮은 우선순위 재대조를 OP-03 전체 API 예산 안에서 수행한다. 이 간격은 중복 억제 기준이며 전원 5초 폴링이 아니다. 새 허용은 현재 게시 목록 확인 후에만 진행하고 미확인은 보류한다. background 대기는 안전한 기존 허용/차단을 유지하며 필요한 차단 기한을 지킬 수 없으면 MC-05 UNKNOWN 경로를 따른다. client report는 조회 계기일 뿐 승인 증거가 아니다.
5. 같은 publication/SID를 유지한 LocalTrack.replaceTrack은 새 게시 Webhook을 보장하지 않는다. 기존 확인 바인딩과 현재 허용 정책을 유지하며 불허 수신자의 차단과 새 표식 수신으로 정합성을 검증한다. 서버 조회에서 실제 source/type/세대가 달라진 것이 확인되었을 때만 그 차이에 따라 재검증한다. 관찰할 수 없는 원본 MediaStreamTrack 교체를 서버가 독립 검출했다고 주장하지 않는다.
6. 허용 source는 가공얼굴 CAMERA 1개·선택 MICROPHONE 1개다. 추가 게시/미인가 source는 새 구독을 허용하지 않고 검증된 gateway 권한/retirement 경로로 정리한다. source 표시로 가공 진위를 증명하지 않는다.

**연결 계약과 경계**

- B만 POST /api/livekit/webhook 라우팅/rawBody를 수정한다. E의 공개 타입은 `handleWebhook(rawBody:string,authorization:string):Promise<{status:'accepted'|'ignored'}>`다. 헤더 누락은 B에서 안전한 인증 오류로 거절하고 E도 서명 실패를 승인으로 바꾸지 않는다.
- SDK/source근거: WebhookReceiver.d.ts와[공식웹훅](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/). raw body 재직렬화/skipAuth:true금지.
- 서버 내부 TrackBinding은 mediaInstanceId/mediaRoomName/playerId/mediaIdentity/publisherGeneration/participantSid/source/trackSid/verifiedAt을 가진다. B는 이 확인 결과를 EXEC-CONTRACT-3의 `media-bindings`로 투영하고 허용 수신자에게만 전체 교체 메시지를 보낸다.
- `media-bindings` 최상위에는 mediaInstanceId/receiverGeneration/bindingRevision을, 참가자 항목에는 publisherGeneration과 현재 Identity/participantSid/trackSid를 둔다. 한 사람의 세대 증가를 방 전체의 세대로 해석하지 않는다. D.applyMediaBindings는 바인딩과 먼저 수신한 트랙을 다시 대조하며 닉네임·클라이언트 self report로 매핑하지 않는다.
- bindingRevision은 같은 수신자·인스턴스·receiverGeneration 내에서 증가한다. 같은 revision은 멱등하고 이전 revision은 폐기한다. 바인딩 삭제/교체는 기존 출력부터 닫고 최신 트랙·정책과 재대조한다. 실제 필드명·타입은 EXEC-CONTRACT-3를 따른다.
- 배열명은 `participants:MediaBinding[]`이고 별도 entries 필드를 만들지 않는다. E는 `deps.enqueueBindings(playerId,message)`로 B에 전달한다. 원본 계약 fixture와 실제 E→B→D 모듈 연결 시험은 별도 증거로 남긴다.
- participants에는 서버가 확인한 수신자 본인의 self entry도 포함한다. self entry의 publisherGeneration은 receiverGeneration과 같으며 B는 self faceTrackSid를 LOAD_READY의 현재 scope와 대조한다. D는 self entry를 원격 얼굴/음성으로 재생하지 않는다. 게시·source 확인은 가공 영상 진위 증명이 아니다.

**시험 입력 → 기대 결과**

- 서명누락/변조body→401계열안전오류·registry무변경.
- event중복2회→정책갱신1회;역순unpublish→현재조회후수렴.
- 거리변경없음+microphoneSID교체→새SID기본차단후현재가청조건재승인.
- 같은 SID replaceTrack + 같은 source/type → 기존 허용은 유지되고 새 표식이 도착하며, 불허 수신자는 계속 미수신. 새 Webhook/재승인을 요구하지 않는다.
- 서버가 관찰한 source 변경 또는 미인가 screen_share → 현재 목록을 재검증하고 잘못된 승인 0.
- track_published Webhook 누락 + dirty 참가자 → OP-03 예산 내 현재 목록 조회 전 새 SID 허용 0, 조회 후 최신 목록으로 수렴.
- TrackSubscribed 먼저/바인딩 먼저/AudioPolicy 먼저 → 실제 E→B 바인딩과 D 소비자가 같은 최종 출력으로 수렴하고 구 revision은 부활하지 않는다.
- JWT ready 결과만 있고 self faceTrackSid 없음 → B 로딩 장벽 닫힘; 현재 self binding+LOAD_READY 일치 → 미디어 준비 조건 충족. D가 self를 원격 타일/오디오에 연결하는 횟수는 0.

**추가·보완할 시험 파일**

- `server/test/media/track-registry.test.ts`
- `server/test/media/webhook.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/track-registry.test.ts
pnpm exec vitest run server/test/media/webhook.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

서명·중복·역순을 검증한 실제 서버 Webhook과 예산 내 dirty 재대조로 Identity/발신자 세대/source/현재 게시 목록을 확인한다. 새 SID는 기본 차단 후 현재 정책으로 승인한다. 같은 SID replaceTrack은 새 게시 이벤트를 전제하지 않고 기존 허용 정합성·새 표식·불허 수신 유지로 검증한다. 수신자 세대와 bindingRevision을 포함한 전체 교체 바인딩을 전달하고 늦은 바인딩 도착도 재대조한다. 얼굴/마이크 각 1개·최소 metadata를 강제하고 구 SID 작업을 새 트랙에 적용하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 미디어 트랙 대조와 웹훅 검증 추가
```

**MR 본문에 채울 변경 사항**

- 검증된Cloud이벤트와현재게시목록으로세대별트랙registry를갱신한다.

**MR 리뷰 포인트**

- rawBody확보가express.json뒤에놓이지않는지인계검토한다.
- 정지상태재게시·SID유지교체·중복/역순사례가있는지확인한다.

**완료 인계**

- B에게rawBody라우트등록순서·안전error·비동기enqueueControl계약을전달한다.
- D에게playerId↔SID는B가확인한mapping만소비하도록전달한다.
- F QA-06에소스교체/게시주입행동을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-10

**MC-07 · [BE] 원격 미디어 종료 장벽**  
일정: D2 2026-09-09 · **오늘 5번**  
기획 근거: v0.0.8 **19, 24장**  
선행 완료 결과: [E-08](e-media-operations.md#e-08) (MC-05, D2), [E-02](e-media-operations.md#e-02) (OP-01, D1), [E-04](e-media-operations.md#e-04) (OP-03, D1)

**수정·생성 파일**

- `server/src/media/RetirementBarrier.ts`
- `server/src/media/MediaCoordinator.ts`
- `server/test/media/retirement-barrier.test.ts`

**구현 순서**

1. retireGeneration의첫호출에서세대terminal을CAS형태로확정하고재호출은같은retirementPromise를반환한다. 개인논리참가자종료와세대교체를구분하여게임연결은B의정책을따른다.
2. REVOKING내구기록완료후모든pending허용·grant를닫고OP-03cleanup큐로removeParticipant를발송한다. 권한UNKNOWN의inFlight일반호출종결을무한대기하지않는다.
3. 회수는 MC-01의 CapabilityReport.revocationProfile을 재사용한다. SDK 기본 모드라면 검증한 기본값 호출을 유지하고, 명시 모드라면 매 호출의 현재 epoch 초에 검증된 bufferSeconds를 더해 bigint cutoff를 만든다. 단순 현재 초 고정으로 같은 초 발급 nbf를 놓치지 않으며, 과거 발급 시각 재사용과 검증 범위 밖 시계 오차를 거절한다. 같은 초 발급·미입장·SDK 갱신 토큰을 포함한 실제 Cloud 프로필이 없으면 성공 확정을 막는다.
4. 참가자부재확인과회수API결과를별도기록한다. 없는참가자오류·삭제된방·JWTexp만으로미입장/갱신토큰회수를추론하지않는다. 불명은OP-04retryintent로남긴다.
5. 방 전체 종료는 기록된 모든 Identity의 확인 후 deleteRoom→잔존 조회로 마무리한다. 내부 REVOKED 내구 기록이 끝나야 외부 RetirementResult의 status='confirmed'를 반환하며 예약 해제는 OP-04/02로 넘긴다. 미확인은 status='unknown'과 안전한 code로 반환한다.

**연결 계약과 경계**

- SDK 근거: server/node_modules/livekit-server-sdk/dist/{RoomServiceClient,AccessToken,grants,ClientOptions,WebhookReceiver}.d.ts 및 src/TwirpRPC.ts, 2.18.0. 공식 [RoomService](https://docs.livekit.io/reference/other/roomservice-api/), [토큰](https://docs.livekit.io/frontends/reference/tokens-grants/).
- `retireGeneration(input:RetireGenerationRequest):Promise<RetirementResult>`를 구현한다. 공통 결과는 requestId/matchId/playerId/mediaInstanceId/receiverGeneration과 status:'confirmed'|'unknown', code:null|string이다. 내부 저널 REVOKED/UNRESOLVED를 wire status로 섞지 않고 JWT/원격 원문 오류를 노출하지 않는다.
- Cloud공식문서의부재참가자회수와cutoff기본버퍼는참고;우리미입장/갱신/늦은응답경계는G1실증이필수.

**시험 입력 → 기대 결과**

- retire2회동시→REVOKING1전이·같은Promise·중복허용없음.
- 발급후미입장Identity→저널기반회수시도,participant부재만으로confirmed금지.
- 같은 초 발급 직후 회수와 SDK 갱신 토큰 재접속 → 검증된 cutoff 프로필로 옛 자격이 실제 거절되어야 회수 확인.
- remove timeout/429→UNRESOLVED·예약유지·새세대발급0.
- 방Identity한개미확인→deleteRoom완료만으로방정리확정금지.

**추가·보완할 시험 파일**

- `server/test/media/retirement-barrier.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/retirement-barrier.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

세대 terminal과 REVOKING을 기록한 뒤 게시·구독·발급을 닫고 RemoveParticipant·구 Identity 토큰 회수를 확인한다. 방 종료는 미입장 포함 기록된 모든 Identity 회수 후 DeleteRoom한다. timeout/429·부재 조회만으로 성공 처리하지 않고 재시도용 미해결 의도를 남긴다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 원격 미디어 종료 장벽 추가
```

**MR 본문에 채울 변경 사항**

- terminal세대의회수확인과내구기록을기준으로종료결과를제공한다.

**MR 리뷰 포인트**

- RemoveParticipant부재오류를무조건삼키거나exp를회수증거로쓰지않는지확인한다.
- 세대회수가논리게임참가종료를강요하지않는지확인한다.

**완료 인계**

- B FL-08/10과D ME-07에화면종료와회수confirmed분리를전달한다.
- OP-04에재시도intent·deadline·예약id를넘긴다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-11

**OP-04 · [BE] 회수 재시도와 예약·기록 해제**  
일정: D2 2026-09-09 · **오늘 6번**  
기획 근거: v0.0.8 **22.1, 24.1장**  
선행 완료 결과: [E-10](e-media-operations.md#e-10) (MC-07, D2), [E-03](e-media-operations.md#e-03) (OP-02, D1), [E-04](e-media-operations.md#e-04) (OP-03, D1)

**수정·생성 파일**

- `server/src/operations/RevocationRetries.ts`
- `server/src/operations/RetentionPolicy.ts`
- `server/test/operations/revocation-retries.test.ts`

**구현 순서**

1. retirementId별attempt·lastAttemptMs·firstRetireMs·state를내구저널과연결한다. 실패후현재monotonic기준1/2/4초간격으로최대계획재시도하며각호출은OP-03cleanup예산을얻는다.
2. 재시도마다 MC-01의 검증된 revocationProfile로 새 cutoff를 계산하거나 SDK 기본 모드를 적용하고 terminal 세대만 처리한다. 이전 호출 cutoff를 재사용하지 않는다. 공급자 429 Retry-After와 예산을 함께 지키며 10초 목표 초과를 숨기지 않는다.
3. firstRetire+10000이내확인이없으면UNRESOLVED와경보를1회남기고새발급잠금·예약점유를유지한다. 자동무제한재시도대신운영자재시도명령도같은예산큐를쓴다.
4. 원격회수확인과journal.REVOKED디스크반영후미디어점유종료를표시한다. 공식사용량체크포인트가조정되기전에는사용량예약을0으로풀지않는다.
5. 종료·회수·공식조정확인시각의최대값으로부터24시간지난기록만checkpoint에반영후압축한다. UNRESOLVED/PREPARED는기간과무관하게유지한다.

**연결 계약과 경계**

- RetryIntent={retirementId,reservationId,identity,generation,firstRetireMs,attempt,status};복원시벽시계/monotonic오프셋은OP-05가재설정하며이미기한초과한항목은경보상태로시작한다.
- reconcileOfficial과releaseConfirmed의순서를OP-02와공유;원격성공과비용확정은다른조건.

**시험 입력 → 기대 결과**

- timeout세번→1/2/4초간격예산호출·10초초과UNRESOLVED.
- 429와600정상한도소진→정리여유내재시도,900초과발송0.
- 회수성공·공식잔량미조정→점유정리는확인하되사용량예약유지.
- 24시간지난REVOKED와UNRESOLVED혼합→확인/조정끝난REVOKED만압축.

**추가·보완할 시험 파일**

- `server/test/operations/revocation-retries.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/operations/revocation-retries.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

최신 시각 기준 최대 1/2/4초 간격 재시도와 첫 정리 목표 10초를 적용한다. 초과 시 UNRESOLVED 경보, 확인 전 미디어 점유·예약 유지, 회수·공식 사용량 조정 확인 후에만 해제한다. 종료 확인 기록은 24시간 후 압축/삭제하며 미해결은 자동 삭제하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 회수 재시도와 운영 기록 정리 추가
```

**MR 본문에 채울 변경 사항**

- 한정재시도·미확인경보·예약해제·확인기록보관정책을연결한다.

**MR 리뷰 포인트**

- 재시도마다새cutoff와API카운터가적용되는지확인한다.
- 미해결항목이시간만지나자동삭제되지않는지확인한다.

**완료 인계**

- F DP-05에UNRESOLVED알람·미해결수·retrycount콜백을전달한다.
- OP-06에부팅재시도재사용API를넘긴다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-12

**OP-05 · [BE] 부팅 복구 상태와 기록 검사**  
일정: D2 2026-09-09 · **오늘 7번**  
기획 근거: v0.0.8 **23.1, 24.2장**  
선행 완료 결과: [E-02](e-media-operations.md#e-02) (OP-01, D1), [E-03](e-media-operations.md#e-03) (OP-02, D1)

**수정·생성 파일**

- `server/src/operations/RecoveryState.ts`
- `server/src/operations/RecoveryBootstrap.ts`
- `server/test/operations/recovery-bootstrap.test.ts`

**구현 순서**

1. `createMediaCoordinator(deps)`는 동기 factory로 생성하며 초기 readiness=RECOVERING/admission=DRAINING과 닫힌 입장·발급 장벽을 먼저 만든다. `initialize():Promise<MediaInitializationResult>`에서 OP-01 writer lock을 획득하고 checkpoint/저널의 integrity·lastSeq·pendingIdentity·reservation을 복원한다. 동시·반복 initialize 호출은 같은 진행 중 Promise 또는 확정 결과를 재사용하여 lock·복원·복구 작업을 중복 시작하지 않는다.
2. 새serverEpoch는crypto난수로만들지만구epoch기록을폐기하지않는다. persisted시간은epoch로읽고현재process의monotonicdeadline을새로계산한다. 재시작전monotonic값을직접비교하지않는다.
3. 정상 빈 첫 설치·기록 유실·손상·부분 레코드를 구분한다. 안전한 잠금과 상태 관찰을 초기화할 수 있으면 미확인·손상 원인을 가진 LOCKED 또는 복구 진행 중 RECOVERING으로 유지한다. writer lock 충돌은 fatal/WRITER_CONFLICT, 안전한 초기 상태 자체를 만들 수 없는 실패는 fatal/INITIALIZATION_FAILED로 종결한다. 파일 부재를 잔량 0/잔존 0으로 해석하거나 손상 기록을 삭제해 초기화를 성공시키지 않는다.
4. 저널 복원 결과와 잠금 상태를 노출할 준비가 되면 status='initialized', readiness.state='RECOVERING' 또는 'LOCKED', admission='DRAINING'인 중앙 결과 타입을 반환한다. 이 결과를 Cloud 정리 완료나 READY와 동일시하지 않는다. B는 이 결과를 await한 뒤 HTTP health/운영 경로를 시작하여 RECOVERING·LOCKED의 ready 503과 인증된 운영 상태를 관찰할 수 있게 한다. fatal 결과이면 B는 listen하지 않고 close한다.
5. initialized 이후 OP-06 Cloud 잔존 확인·회수와 OP-02 공식 잔량 정합을 계속 수행하고 OP-08의 전체 준비 조건이 충족될 때만 READY로 바꾼다. initialize Promise가 전체 Cloud 복구를 기다리게 만들지 않는다. 실패·미확인은 LOCKED와 비민감 reasonCodes/운영 조치 필요 상태로 남기며 복구 완료 후에도 admission=DRAINING을 유지하고 OP-07 resume을 요구한다.

**연결 계약과 경계**

- RecoverySnapshot={phase:'RECOVERING'|'READY'|'LOCKED',integrity,pendingCount,budgetConfirmed,writable,singleWriter,reasonCodes};구체remoteIdentity는공개health에노출하지않음.
- 중앙 `MediaInitializationResult`는 `{status:'initialized',readiness:Readiness & {state:'RECOVERING'|'LOCKED'},admission:'DRAINING'}` 또는 `{status:'fatal',code:'WRITER_CONFLICT'|'INITIALIZATION_FAILED'}`다. E는 initialize/close와 기존 포트를 제공하고 B가 factory 생성→await initialize→결과별 listen/close를 조립한다. initial closed, initialized, READY, OPEN을 서로 다른 장벽으로 다룬다.
- initialized의 readiness는 초기화 시점 snapshot이다. 이후 Cloud 복구 상태는 기존 readiness/operations 포트에서 읽는다. health/운영 경로를 열기 위해 READY나 OPEN을 기다리지 않으며 fatal 실패를 initialized/LOCKED로 숨기지 않는다.
- 예상하지 못한 initialize Promise 거절도 B가 부팅 실패로 처리하여 listen 없이 close한다. 재호출로 복구 실패나 잠금을 초기화하지 않는다. initialized 이후 서명 검증 Webhook을 포함한 B 복구 경로는 관찰 가능하게 열되 새 입장·grant·자동 시작은 준비·admission 장벽을 유지한다.

**시험 입력 → 기대 결과**

- 정상checkpoint+PREPARED구epoch→RECOVERING·발급차단·정리목록생성.
- 기록파일유실+서비스Cloud방존재→자동READY불가.
- 새epoch생성→기존reservation과미해결Identity유지.
- writer lock 충돌 → fatal/WRITER_CONFLICT·listen 0·close; 안전한 잠금 초기화 불가 → fatal/INITIALIZATION_FAILED·listen 0.
- 관찰 가능한 부분 레코드/기록 유실 → initialized/LOCKED·ready 503·입장 거절, 기록 삭제나 자동 READY 없음.
- Cloud 정리 응답 지연 → initialize는 로컬 복원·잠금 완료 후 initialized/RECOVERING 반환, B health/운영 상태 관찰 가능·grant 0.
- initialize 동시 2회와 완료 후 재호출 → 복원·writer lock·후속 복구 시작 각 1회, 동일 진행 중 Promise/확정 결과 재사용.
- 이후 Cloud 정리·공식 잔량 정합 완료 → readiness READY/admission DRAINING, 별도 resume 없이는 새 입장·grant 0.

**추가·보완할 시험 파일**

- `server/test/operations/recovery-bootstrap.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/operations/recovery-bootstrap.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

동기 factory에서 입장·발급을 닫고 initialize로 저널·체크포인트와 잠금을 초기화한다. initialized/RECOVERING·LOCKED는 HTTP 상태 관찰을 허용하는 장벽이며 전체 Cloud 복구/READY 완료가 아니다. fatal은 listen 없이 종료하고, 후속 복구가 READY에 도달해도 resume 전에는 DRAINING을 유지한다. 손상·부분 레코드·유실·공식 잔량 미확인을 구분하며 새로운 serverEpoch가 이전 사용량·미디어를 없앴다고 간주하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 운영 기록 복구와 준비 잠금 추가
```

**MR 본문에 채울 변경 사항**

- 새프로세스의복원상태와제품입장잠금을분리해제공한다.

**MR 리뷰 포인트**

- 새epoch/빈파일로기존미디어·비용을초기화하지않는지확인한다.
- wallclock와monotonic복원계산을확인한다.

**완료 인계**

- B와 F에 factory→await initialize→initialized이면 health/운영 listen(ready 503 가능), fatal이면 listen 없이 close, 후속 복구 READY→별도 resume 순서와 초기화 결과 fixture를 전달한다.
- OP-06에구세대전체목록과integrity가확인될때만진행하는조건을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-13

**OP-06 · [BE] 이전 세대·잔존 방 대조와 회수**  
일정: D2 2026-09-09 · **오늘 8번**  
기획 근거: v0.0.8 **24.2장**  
선행 완료 결과: [E-12](e-media-operations.md#e-12) (OP-05, D2), [E-10](e-media-operations.md#e-10) (MC-07, D2), [E-11](e-media-operations.md#e-11) (OP-04, D2)

**수정·생성 파일**

- `server/src/operations/PreviousGenerationCleanup.ts`
- `server/test/operations/previous-generation-cleanup.test.ts`

**구현 순서**

1. OP-05snapshot을받고OP-03으로listRooms를요청한다. 서비스namespace의엄격한구분자prefix와등록된epoch형식에맞는방만대상으로선별하며부분문자열match를쓰지않는다.
2. 대상방listParticipants와저널Identity집합을합집합으로대조한다. Cloud목록에없어도PREPARED/REVOKING/UNRESOLVEDIdentity를MC-07에보내며미입장발급을빼먹지않는다.
3. 저널밖서비스소유방은참가자조회로알려진대상을회수한다. 다만발급이력유실이면현재참가자정리만끝내고READY승인을보류한다.
4. 모든확인가능Identity회수→방delete→listRooms/listParticipants재확인후정리결과를체크포인트한다. 조회timeout/소유권불명/회수실패는OP-04경보와잠금으로반환한다.
5. 첫설치도동일흐름을태우고같은서비스의중복서버lock을확인한다. 타서비스방에대한삭제요청이없다는호출기록시험을작성한다.

**연결 계약과 경계**

- CleanupReport={recordedIdentities,observedParticipants,revoked,unresolved,ownedRoomsRemaining,historyComplete};READY는unresolved=0뿐아니라historyComplete=true도필요.
- CloudRoom목록은자동필터삭제허가가아니다. namespace의실제소유가DP-01과일치해야한다.

**시험 입력 → 기대 결과**

- 목록0·저널PREPARED1→해당Identity회수시도1,빈목록으로완료금지.
- 저널0·소유방1·현재참가자2→2명회수/방정리하지만발급이력불명은잠금유지.
- 타서비스방1포함→조회전역목록외해당방변경호출0.
- Remove성공후listRooms실패→unresolved유지·READY불가.

**추가·보완할 시험 파일**

- `server/test/operations/previous-generation-cleanup.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/operations/previous-generation-cleanup.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

첫 설치와 재시작 모두 서비스 소유 Cloud 목록과 저널을 대조한다. PREPARED·미입장·목록 밖 기록 Identity·저널 밖 소유 방을 정리하고 이전 방 삭제/잔존 확인을 한다. 타 서비스 방은 건드리지 않으며 발급 이력 복원 불가 시 재개를 막는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 이전 미디어 세대 대조와 부팅 정리 추가
```

**MR 본문에 채울 변경 사항**

- 저널과Cloud잔존상태를합쳐서비스소유세대를정리한다.

**MR 리뷰 포인트**

- 저널밖과목록밖대상을둘다다루는지확인한다.
- 알수없는발급이력을현재참가자제거만으로복구완료처리하지않는지확인한다.

**완료 인계**

- OP-08에historyComplete/remaining/unresolved결과를전달한다.
- F QA-05에초기잔존fixture와타서비스보존assertion을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-14

**OP-07 · [BE] 제한 공개창과 운영 제어**  
일정: D2 2026-09-09 · **오늘 9번**  
기획 근거: v0.0.8 **18, 22, 24.3장**  
선행 완료 결과: [B-09](b-game-server.md#b-09) (AC-04, D1), [E-10](e-media-operations.md#e-10) (MC-07, D2), [E-03](e-media-operations.md#e-03) (OP-02, D1)

**수정·생성 파일**

- `server/src/operations/OperationsController.ts`
- `server/src/operations/OperatorAuth.ts`
- `server/test/operations/operations-controller.test.ts`

**구현 순서**

1. `OperatorAuth.ts`에서 중앙 `CreateOperatorAuth` 계약의 `createOperatorAuth(token)`을 export한다. F가 검증한 비어 있지 않은 `OPS_TOKEN`을 B가 주입하고 반환 함수가 Authorization: Bearer를 검증한다. 길이 차이·누락·잘못된 형식은 false로 처리하며 동일 길이 token 비교는 constant-time으로 한다. B HTTP 어댑터가 E의 인증기를 단일 경로로 조립한다. POST/GET 모두 인증을 요구하고 unknown 필드·action·잘못된 requestId를 strict schema로 거절한다.
2. `POST /api/operations/commands`의 action은 drain/resume/retry-retirement/checkpoint만 허용한다. body는 `{requestId,action,retirementId?}`이며 retirementId는 retry-retirement에서만 필수다. drain은 즉시 신규 초대/방/grant를 닫고 기존 경기 종료·회수 완료를 기다린다. resume은 공개창·READY·예산·미해결 0 조건을 모두 검사한다. retry-retirement는 지정 미해결 회수만 OP-04로 보낸다. checkpoint는 `OPS_DATA_DIR/official-usage-input.json`의 OfficialBudgetCheckpoint를 검증·저널 반영하며 클라이언트 본문으로 잔량 숫자를 새로 받지 않는다.
3. coordinator.getOperations()의 OperationsPort.submit(command)는 `OperationSubmission`의 accepted+snapshot 또는 conflict+REQUEST_ID_CONFLICT를 즉시 반환한다. B는 이를 각각 202/409로 변환하고 실제 작업은 E 내부 큐에서 진행한다. 같은 requestId+같은 body는 기존 operationId를 반환한다. getSnapshot(requestId)는 현재 OperationSnapshot 또는 null을 반환해 B가 GET에 연결한다. 접수 시점부터 `config.operationTimeoutMs`가 지나거나 실패하면 failed+code로 닫고 admission 잠금을 유지한다. HTTP 202나 pending 조회를 성공으로 기록하지 않는다.
4. drain은 submit 시 admission=DRAINING을 먼저 적용한다. B는 입장 승인과 grant/입장 관련 await 전후에 getOperations().getStatus().admission을 재검사한다. E는 deps.getGameActivity()의 activeMatches/activePractices/pendingAdmissions가 모두 0이고 회수·저널 반영이 확인된 뒤에만 drain을 succeeded로 바꾼다. E가 B의 Room registry를 직접 변경하거나 정의되지 않은 callback을 추가하지 않는다. getStatus()는 중앙 OperationsStatus만 반환한다.
5. 각 성공/거절/잠금 사건은 actor의 비밀 없는 별칭·requestId·operationId·action·resultCode·시각만 audit 기록한다. OPS_TOKEN/JWT·숨은 좌표·맵·전체 Identity 목록을 응답/로그에 넣지 않는다. 모든 운영 응답은 Cache-Control:no-store다.
6. Cloud 제어 불가·호스트 상실 후 복구 중에는 공개 중지/경보를 유지한다. 이 모듈을 독립 호스트 감시자로 표현하거나 즉시 원격 강제 종료를 보장하지 않는다. 재시작 중 남은 pending 작업은 저널과 재대조하고 근거 없이 succeeded로 복원하지 않는다.

**연결 계약과 경계**

- 운영 경로는 POST `/api/operations/commands`, GET `/api/operations/commands/:requestId`, GET `/api/operations/status`다. B router는 coordinator.getOperations():OperationsPort의 submit/getSnapshot/getStatus를 각각 사용한다. F 배포 script도 같은 OperationsCommand/OperationSnapshot과 strict action 분기를 사용하며 별도 경로를 만들지 않는다.
- OperationSnapshot={requestId,operationId,action,status:'pending'|'succeeded'|'failed',code:null|string,updatedAtEpochMs}. GET status={admission:'OPEN'|'DRAINING'|'LOCKED',readiness:'READY'|'RECOVERING'|'LOCKED',unresolvedCount,remainingMinutes,remainingBytes,checkedAtEpochMs}. nullable 잔량·시간과 오류 코드는 중앙 타입을 그대로 따른다.
- OPS_TOKEN은 F 환경 주입이며 예시 파일에는 값이 없다. 원본 공식 잔량 입력이 없거나 오래되면 checkpoint 실패/미확인으로 남기고 공급자 잔량을 추정하지 않는다.
- admission과 readiness는 별도 상태다. 정상 drain은 admission=DRAINING으로 새 입장만 닫고 건강한 readiness=READY를 유지할 수 있다. 실제 권한/저널/예산 장애는 readiness=LOCKED다. resume이 자기 자신이 만든 drain 잠금 때문에 영구 거절되지 않도록 하고 grant에는 READY와 OPEN을 함께 요구한다.
- resume은 애플리케이션 admission을 OPEN으로 전환하는 명령이다. 공개 네트워크 접근 허용은 F의 별도 책임이며 배포 검증 중에는 외부 격리를 유지한 채 정상 인증·공개창·READY·예산 조건으로 resume한 뒤 지정한 6인 smoke를 수행한다. 별도 smoke action이나 인증·예산 우회 경로를 추가하지 않는다. smoke 종료·회수 확인 뒤 실제 공개 여부는 F가 판단한다.

**시험 입력 → 기대 결과**

- 게임세션Bearer로운영호출→403·상태무변경.
- 공개창외새grant/초대→거절;기존게임을자동패배로바꾸지않음.
- 같은 requestId/checkpoint 2회 → 같은 operationId·내구 반영 1회; 같은 requestId의 다른 action → 409.
- POST drain 202 pending + 회수 미확인 → GET은 pending, 배포/재개 0; 기한 초과 → failed와 입장 잠금 유지.
- drain 접수 중 pendingAdmissions=1 또는 activePractices=1 → 회수 완료만으로 succeeded 금지; 활동 수 모두 0+회수/저널 확인 → succeeded. 입장 await 중 DRAINING 전환 → B 재검사에서 승인 거절.
- retirementId 없는 retry-retirement 또는 drain에 retirementId 추가 → strict validation 거절·작업 생성 0.
- 인증된 checkpoint + 공식잔량 입력 미확인 → failed, 새 잔량 추정/입장 해제 0.
- Cloud회수불가에서공개재개→거절·UNRESOLVED경보유지,숨은맵응답없음.

**추가·보완할 시험 파일**

- `server/test/operations/operations-controller.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/operations/operations-controller.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

OPS_TOKEN으로 보호한 고정 세 경로와 drain/resume/retry-retirement/checkpoint의 strict 계약을 구현한다. 202 pending과 실제 succeeded/failed를 구분하고 같은 requestId 재시도는 멱등하다. 공개창·신규 초대/방/토큰 잠금·회수·공식잔량 체크포인트를 연결하며 숨겨진 위치·맵·Secret을 내보내지 않는다. 원격 회수 불가·작업 실패에는 공개 중단·경보·미해결 상태를 유지한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 제한 공개와 운영 제어 경계 추가
```

**MR 본문에 채울 변경 사항**

- 고정 운영 경로·strict action·비동기 작업 상태·공식잔량 checkpoint·입장 잠금을 제공한다.

**MR 리뷰 포인트**

- 사용자세션과운영secret분리·응답정보최소화를확인한다.
- E가BRoom상태를비동기로직접변경하는지확인한다.

**완료 인계**

- B에 고정 운영 라우트와 OperationsCommand/OperationSnapshot의 실제 정상·거절·pending→terminal fixture를 D2 종료 전에 전달한다.
- F DP-06/QA-07에 동일 requestId 재시도·GET terminal 확인·OPS_TOKEN 주입과 실패 시 잠금 유지 절차를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-15

**OP-08 · [BE] live·ready 분리와 재개 조건**  
일정: D2 2026-09-09 · **오늘 10번**  
기획 근거: v0.0.8 **23.1, 24장**  
선행 완료 결과: [E-13](e-media-operations.md#e-13) (OP-06, D2), [E-14](e-media-operations.md#e-14) (OP-07, D2), [F-05](f-infra-qa.md#f-05)의 컨테이너·지속 볼륨·단일 쓰기자 기반 인계 (DP-02, D1). OP-08을 기다리는 제품 production/READY 최종 시험은 선행 조건에 포함하지 않는다.

**수정·생성 파일**

- `server/src/health/Readiness.ts`
- `server/src/health/HealthHandlers.ts`
- `server/test/health/readiness.test.ts`

**구현 순서**

1. live는process생존만200을반환하고ready는RECOVERING/LOCKED를503으로반환한다. 공개본문은상태와안전reasonCodes만포함한다.
2. ready조건을conjunction으로정의한다:저널무결/쓰기정상·singlewriter·이전세대회수/historyComplete·공식잔량확인/예약정합·운영모드/초대인증/검증된Cloud프로필. 하나라도unknown이면false이다.
3. 준비 snapshot이 바뀔 때 B 입장/자동 시작과 prepareGeneration이 같은 준비 조건을 참조하도록 factory에서 노출한다. grant/신규 입장은 readiness=READY와 admission=OPEN을 함께 요구한다. health가 실패인데 grant가 열리는 불일치를 없앤다.
4. 런타임 디스크 실패·미해결 보안 권한·예산 불명은 readiness=LOCKED/발급 잠금으로 전파한다. 정상 운영 drain은 admission=DRAINING만 설정하여 건강한 READY와 분리하고 기존 판 종료/회수를 진행한다. OP-05 initialized는 RECOVERING 또는 LOCKED 상태를 관찰할 수 있는 시점이며 후속 복구 완료를 의미하지 않는다. 후속 복구가 READY가 되어도 자동 OPEN하지 않고 READY 확인→resume→OPEN 순서를 유지한다.
5. Fenvproduction지원은이조건의통합이확인된뒤활성화한다. disabled/mock mode의기존production차단을지워성공시키지않는다.

**연결 계약과 경계**

- Readiness={state:'RECOVERING'|'READY'|'LOCKED',reasonCodes,historyComplete,unresolvedCount}는 EXEC-CONTRACT-3를 따른다. admission=DRAINING을 Readiness state에 추가하지 않는다. /health/live와 /health/ready HTTP 등록은 B가 담당하며 운영 GET status는 admission과 readiness를 각각 제공한다.
- DP-02컨테이너healthcheck는live/ready용도를분리하고unready컨테이너를무한재시작해저널검사를우회하지않는다.
- OP-05 initialized 이후 B가 health/운영 경로를 열어 RECOVERING·LOCKED를 관찰하게 한다. Cloud 복구를 initialize 반환이나 HTTP listen의 완료 조건으로 묶지 않으며 fatal 초기화에는 health를 열지 않는다.

**시험 입력 → 기대 결과**

- live프로세스·미회수Identity1→live200/ready503·grant거절.
- 모든조건true→ready200;공식잔량미확인만false→503.
- 정상 drain + 모든 복구 조건 충족 → readiness READY/admission DRAINING·새 grant 거절; 검증된 resume terminal 성공 → admission OPEN·새 grant 가능.
- initialized/RECOVERING에서 Cloud 복구 대기 → live 200/ready 503·운영 상태 관찰 가능; 복구 완료로 READY 전환 후에도 admission DRAINING 유지.
- READY후diskwrite실패→즉시잠금·새grant0.
- MEDIA_MODE=disabled+production요청→기존차단유지·MVP준비true금지.

**추가·보완할 시험 파일**

- `server/test/health/readiness.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/health/readiness.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

live는 생존, ready는 이전 세대 정리·예산 정합·정상 쓰기·단일 서버·운영 모드 충족을 표시한다. 어느 하나 불명확하면 ready 실패와 발급 잠금을 유지한다. 실제 인증/Cloud 미구현 모드의 production 시작 차단을 충족 확인 없이 해제하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 운영 준비 상태와 발급 장벽 연결
```

**MR 본문에 채울 변경 사항**

- 생존/준비를분리하고제품발급과같은준비조건을사용한다.

**MR 리뷰 포인트**

- UNKNOWN을기본true로취급하거나health와grantpredicate가분리되어있지않은지확인한다.

**완료 인계**

- B/F에healthhandler·같은readiness참조·재시작잠금준비조건을인계한다.
- F QA-05/DP-06에ready실패원인별검증조건을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/OP-08.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### E-16

**MC-08 · [BE] 연습·경기·재연결의 세대 교체**  
일정: D2 2026-09-09 · **오늘 11번**  
기획 근거: v0.0.8 **05, 18, 24장**  
선행 완료 결과: [E-05](e-media-operations.md#e-05) (MC-02, D1), [E-10](e-media-operations.md#e-10) (MC-07, D2), [D-17](d-vision-media.md#d-17) (ME-07, D2)

**수정·생성 파일**

- `server/src/media/GenerationTransition.ts`
- `server/src/media/MediaCoordinator.ts`
- `server/test/media/generation-transition.test.ts`

**구현 순서**

1. 전환요청을 논리 playerId+matchId별로 직렬화하고 그 사람의 oldGeneration을 RETIRING으로 설정한다. 연습→경기는 RetireGenerationRequest.reason='phase-change', 전체 재연결은 'reconnect', 라운드 종료/재경기는 'round-ended'로 보내고 대상 mediaInstanceId를 서버가 결정한다. 같은 방의 다른 다섯 명 세대를 함께 증가시키지 않는다.
2. await retireGeneration(old)의 status='confirmed'와 OP-02 예산 조건을 확인한다. status='unknown'이면 새 Identity/토큰을 발급하지 않고 loading/countdown 진행을 B에 잠금 통지한다. 결과의 requestId/matchId/playerId/mediaInstanceId/receiverGeneration이 현재 전환 요청과 모두 맞아야 한다.
3. 확인후generation을증가하고새난수Identity/roompurpose로prepareGeneration한다. playerId/유효게임세션은유지한다. 동일SDK연결내짧은reconnect는fullreplacement와구분하여현재게시목록만재검증한다.
4. 게임연결이살아있는일반미디어장애만monotonic10초복구deadline을부여한다. deadline초과는MEDIA_UNAVAILABLE을B큐로전달하고세대회수한다. UNKNOWN은MC-05즉시처리우선이다.
5. 구grant응답·구clientready보고·구webhook은세대가맞지않으면새상태를바꾸지않는다. close/endParticipation도전환큐와멱등하게경합시켜유령새연결을막는다.

**연결 계약과 경계**

- B /api/media/report의status는회수확인/권한검증을대신하지않음. D ME-07의retire완료와E의remoteconfirmed를별도조건으로받는다.
- 연습팀별3명instance를경기6명instance로넘길때이전연습관계/트랙/저널을그대로재사용하지않는다.
- 본인이 재연결하면 해당 수신자 메시지의 receiverGeneration이 바뀐다. 다른 사람이 재연결하면 자신의 receiverGeneration은 유지하고 참가자 항목의 publisherGeneration/Identity/SID와 bindingRevision만 갱신한다. 구 수신자 세대·구 publisherGeneration·구 revision의 응답은 현재 준비 상태를 바꾸지 않는다.
- 미디어만 재연결할 때 B의 논리 gameInstanceId/gameScope.revision은 유지한다. E는 MediaScope와 준비/회수 결과만 갱신하고 논리 게임 인스턴스 ID나 revision을 만들지 않는다. 연습→본경기 논리 전환은 B/C의 권위 phase·전체 개인 뷰 경로로 처리한다.

**시험 입력 → 기대 결과**

- old회수timeout→newtoken0·countdown잠금.
- 연습→경기정상→playerId유지·identity변경·generation증가.
- new세대진입후oldready/응답도착→새세대상태무변경.
- 6명 중 P2만 전체 재연결 → P2만 세대/Identity 교체, 다른 5명의 receiverGeneration 유지, P2 발신자 바인딩과 각 수신자 bindingRevision만 갱신. P2의 오래된 응답은 새 얼굴·음성 출력을 닫거나 열지 않는다.
- 게임연결종료또는복구10001ms→새연결중지·MEDIA_UNAVAILABLE/게임상실경로,UNKNOWN은즉시중단.

**추가·보완할 시험 파일**

- `server/test/media/generation-transition.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run server/test/media/generation-transition.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

구 세대 회수 확인 뒤에만 새 Identity/토큰을 발급한다. 연습→경기·전체 재연결·재경기에서 playerId·살아 있는 게임 연결을 유지하고 구 응답을 격리한다. 일반 미디어 복구 창은 서버가 관리해 10초 초과 시 MEDIA_UNAVAILABLE 무효·회수한다. UNKNOWN 즉시 중단은 MC-05를 따른다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 미디어 세대 전환과 복구 창 추가
```

**MR 본문에 채울 변경 사항**

- 구세대회수확인후에만새연결을발급하고논리게임수명을보존한다.

**MR 리뷰 포인트**

- SDK내재연결과전체Identity교체를섞지않는지확인한다.
- 늦은ready/grant가새라운드를시작시키지않는지확인한다.

**완료 인계**

- B FL과D ME-07에전환의ready/remoteconfirmed/timeout계약을D2end로넘긴다.
- F QA-06/QA-07에 새 SID·같은 SID replaceTrack·한 사람만 전체 세대 교체를 구분한 실제 생산자/소비자 fixture를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/E/MC-08.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.
