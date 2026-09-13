# F · 공통 설정·Jenkins·배포·통합 검증 실행 문서

작성 기준: 2026-09-08 · 스켈레톤 `d6f8e62` · **EXEC-CONTRACT-3**  
담당 범위: 의존성/공통 설정, 실행 환경, 인프라와 G1–G6 실측 증거  
원본 작업: **19개** · 리뷰 상대: **E** · 현재 상태: **모두 구현 계획**

이 문서와 [최신 결정](../spec/decisions.md), 아래 공통 계약을 실행 입력으로 사용한다. AI는 `AGENTS.md`·`CONTRIBUTING.md`·`server/README.md` 및 현재 존재하는 infra 안내와 수정할 실제 코드를 읽는다. [기획서 v0.0.8](../spec/README.md)은 근거 확인용이며 정정 전 아이템 요구를 실행하지 않는다. 다른 담당의 전체 실행 문서를 읽지 않아도 아래 선행 산출물과 [F 인계 기록](handoffs/F.md)으로 작업할 수 있어야 한다.

목표는 **9월 8일(화)·9일(수) 핵심 구현, 10일(목) 통합·검증·수정, 11일(금) 오전 MVP 인수**다. 작업 개수는 소요시간이나 완료 보증이 아니다. 선행 작업·실제 Cloud·장치가 준비되지 않은 조건은 완료로 계산하지 않는다.

## 날짜별 오늘 작업표

각 날짜에서 오늘 번호를 1부터 다시 센다. 예를 들어 9월 9일에 “오늘 1번부터 5번”을 요청하면 **D2 표의 1–5번**을 수행한다. `F-01` 같은 고정 번호와 원본 ID는 날짜가 지나도 바꾸지 않는다. 일정 이후에는 날짜 또는 고정 번호를 명시한다.

### D1 · 2026-09-08 화요일

계약·환경과 병렬 구현 기반을 만들고 권위 이동·장치 점검을 연결. 새 원본 작업 6개.

| 오늘 번호 | 고정 번호                  | 원본 ID | 완료할 결과                          |
| --------- | -------------------------- | ------- | ------------------------------------ |
| 1         | [F-01](f-infra-qa.md#f-01) | DP-01   | 실제 배포·Cloud·검증 환경 확인       |
| 2         | [F-02](f-infra-qa.md#f-02) | QA-01   | 합성 미디어·실효 지연·장애 계측 도구 |
| 3         | [F-03](f-infra-qa.md#f-03) | QA-02   | 비전·얼굴·3D 동시 성능 조기 측정     |
| 4         | [F-04](f-infra-qa.md#f-04) | DP-04   | Jenkins 검증과 GitLab 결과 연결      |
| 5         | [F-05](f-infra-qa.md#f-05) | DP-02   | 단일 서버 운영 이미지·Compose        |
| 6         | [F-06](f-infra-qa.md#f-06) | DP-03   | 도메인·TLS·WSS·접근 제한             |

### D2 · 2026-09-09 수요일

MVP 핵심 기능을 구현하고 생산자·소비자를 통합. 새 원본 작업 8개.

| 오늘 번호 | 고정 번호                  | 원본 ID | 완료할 결과                        |
| --------- | -------------------------- | ------- | ---------------------------------- |
| 1         | [F-07](f-infra-qa.md#f-07) | DP-05   | 게임·미디어·복구 지표와 경보       |
| 2         | [F-08](f-infra-qa.md#f-08) | QA-03   | G1-A 지연·결과 불명 회귀           |
| 3         | [F-09](f-infra-qa.md#f-09) | QA-04   | G1-D 탈락 중 회수·늦은 허용 회귀   |
| 4         | [F-10](f-infra-qa.md#f-10) | QA-06   | G1-C 재게시·전체 재연결 회귀       |
| 5         | [F-11](f-infra-qa.md#f-11) | QA-05   | G1-B 강제 종료·재시작·옛 토큰 회귀 |
| 6         | [F-12](f-infra-qa.md#f-12) | QA-07   | G3 실제 Room 동시 판정 회귀        |
| 7         | [F-13](f-infra-qa.md#f-13) | QA-08   | G4 수신자별 정보 은폐 회귀         |
| 8         | [F-14](f-infra-qa.md#f-14) | QA-10   | 60 게임 클라이언트 30분 진단       |

### D3 · 2026-09-10 목요일

최종 흐름·실기기·Cloud·부하 검증과 결함 수정. 새 원본 작업 5개.

| 오늘 번호 | 고정 번호                  | 원본 ID | 완료할 결과                   |
| --------- | -------------------------- | ------- | ----------------------------- |
| 1         | [F-15](f-infra-qa.md#f-15) | QA-09   | G5 대표 6대 장치 5판 완주     |
| 2         | [F-16](f-infra-qa.md#f-16) | DP-06   | Jenkins 배포·배수·실패 복귀   |
| 3         | [F-17](f-infra-qa.md#f-17) | QA-11   | 실제 미디어 1·3·5방 단계 검증 |
| 4         | [F-18](f-infra-qa.md#f-18) | QA-12   | G2·G6 10방 60세션 15분 통합   |
| 5         | [F-19](f-infra-qa.md#f-19) | QA-13   | MVP 관문 보고와 운영 인계     |

D3 결함 수정은 기존 작업의 후속 처리다. 별도 스토리 수를 늘리지 않는다. 수정한 파일 소유자가 검증 후 `fix:` 커밋과 MR 본문을 남긴다. 도망자 아이템의 종류·효과·획득·사용과 관련 G3-C·G5 행동은 결정 대기다. 해당 항목을 구현하거나 필수 통과로 강제하지 않으며 확정된 술래 장비·자연 구속·포즈·6대 5판 검증은 유지한다.

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
- W02 분리 전송 준비(215): `MediaGrant.subscriptionMode=server-forwarding`에서 기본 grant는 개인 MIC 게시/수신 방이며 `facePublication`은 같은 URL·같은 만료 시점의 별도 CAMERA 게시 방/신원/토큰이다. 이 필드는 해당 모드에서만 필수이며 단일 모드에 섞으면 거절한다. 두 연결 모두 준비돼야 사용하며 하나의 receiverGeneration으로 교체·실패·정리한다. 개인 방은 서버가 전달한 트랙을 자동 구독하고 얼굴 게시 방은 구독하지 않는다. `MediaBinding.facePublisher`가 있으면 얼굴은 그 별도 participantSid로, 음성은 기존 participantSid로 대조한다. 이 계약·웹 소비자 추가는 공개 권한/회수/사용량의 서버 생산자 완료나 PUBLIC_READY를 뜻하지 않으며 기존 팀 모드를 유지한다.
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

친구 초대는 별도 `ROOM_INVITATION_ROUTE`에서 현재 접속 중인 방장의 게임 세션 Bearer만 받는다.
서버가 세션에서 방/행위자를 정하고 LOBBY/DEVICE_CHECK를 확인한다. 빈 POST는 새 링크201,
빈 DELETE는 회수204이며 요청에서 방 코드·대상 신원·TTL·운영 권한을 받지 않는다.
최대10분(운영 초대 최대 기한이 더 짧으면 그 기한)의 현 방 참가 전용 링크 하나만 유지한다.
재발급/회수는 이전 링크와 해당 링크의 미접속 RESERVED 세션을 함께 무효화하고 이미 JOINED/
RETIRING인 참가자는 보존한다. 초대 만료는 최초 입장 예약의 상한이며, 최초 접속 뒤 세션 기한은
기존 정책을 따른다. SSO 상태라도 명시한 초대가 거절되면 SSO 코드 참가로 자동 우회하지 않는다.
초대를 명시하지 않은 팀원 코드 참가는 유지하므로 이를 막으려면 방 입장을 잠근다.
웹은 session Bearer를 URL에 넣지 않고 초대/방 코드만 fragment로 공유한다.
네트워크 결과 미확인·재발급 중에는 이전 링크를 숨기고, 만료 시 복사를 중단한다.

F는 `MediaConfiguration`의 projectAlias·publicWindow·officialBudgetMaxAgeMs·operationTimeoutMs를 선택 운영 모드와 함께 검증하고 B가 factory에 전달한다. publicWindow=null은 운영 범위 미정으로 잠금이며, continuous의 명시적 `{mode:'continuous'}`와 구분한다. 예시 창·예시 잔량을 실제 허용으로 쓰지 않는다. productSecurityReady는 환경의 임의 true가 아니라 B가 제품 인증·입장 보호 초기화를 확인해 주입하는 서버 내부 값이다. E는 이 값과 회수·저널·해당 모드의 예산·운영 범위 조건을 검사한다. 일반 운영 명령은 operationTimeoutMs 이후 미완료 회수를 성공으로 바꾸지 않고 unknown/LOCKED와 작업 상태 조회에 남긴다. 입장이 DRAINING이고 경기·연습·입장 대기가 없으며 검증된 과거 기록 전체가 REVOKED인 조회 실패 복구 checkpoint에만 서버가 접수부터 최대180초를 적용한다. 같은 writer·소유권·기록·세대·API 예산을 전송 전후에 재검사하고 중복 sweep·지연 성공을 거절한다. 손상 이력은 복원하지 않으며 성공 후에도 별도 resume가 필요하다. Cloud 개별 응답/실시간 권한 회수 기한은 유지한다. 정확한 env 매핑과 조회 복구 절차는 현재 F config export 및 상시 운영 문서를 대조한다.

관측은 F가 소유하는 `MetricSample` 수집 callback을 B가 조립하여 B Tick/queue와 `MediaCoordinatorDeps.emitMetric`에 주입한다. F의 `MetricRegistry`가 name/unit allowlist를 정의하고 B/E는 같은 목록을 소비한다. atMs는 서버 monotonic ms이고 matchRef는 비식별 상관값이다. 토큰·nickname·원본 mediaIdentity·좌표·전체 객체를 label로 넣지 않는다. callback은 유계 큐에 수치/enum을 적재하며 게임 Tick이나 E 정책 실행에서 IO 대기·throw를 하지 않는다. 실제 관측 구현이 없으면 관측 인수를 완료로 기록하지 않는다.

B가 경로를 등록하고 E가 핸들러를, F가 secret 주입·배포 보호를 맡는다. 세션용 Bearer와 운영용 OPS_TOKEN을 혼용하지 않는다. 운영 명령은 실제 운영 작업을 승인받은 실행에서만 호출하며 문서 작성만으로 원격 실행하지 않는다.

B는 coordinator.getOperations()의 OperationsPort를 위임받아 submit/getSnapshot/getStatus를 각 경로에 연결한다. submit은 accepted+snapshot 또는 conflict를 즉시 반환하고 긴 작업은 E 내부 큐에서 처리한다. drain 접수 시 admission을 먼저 DRAINING으로 바꾼다. B는 입장 승인 직전에 getStatus().admission을 검사하며 await 뒤에도 재검사한다. E는 주입된 getGameActivity()의 진행 경기·연습·입장 수가 모두 0이고 회수가 확인되어야 drain을 succeeded로 바꾼다. 시간 초과는 failed로 종결하고 신규 입장 차단을 유지한다. E가 B의 Room registry를 직접 수정하거나 정의되지 않은 callback을 추가하지 않는다.

- GET /api/sessions/access: 해당 요청의 입장 방식만 SessionAccessResponse로 반환한다(no-store). GitLab 신원·토큰은 반환하지 않으며 이 응답은 후속 POST의 인증이 아니다.
- 명시적 SERVICE_AUDIENCE=team은 gitlab-sso, public은 guest 입장을 선택하며 기존 SESSION_ADMISSION_MODE를 함께 지정하면 일치해야 한다. guest만 단독 지정하거나 공개 대상 없이 활성화하지 않는다. public의 새 방 생성은 서버 독립 신원을 발급하고 생성 IP의 제한 버킷을 공유한다. 친구 참가는 유효한 방별 초대가 필요하고 명시한 링크는 생성 요청에서도 반드시 검증한다. guest는 X-SSO-User를 인정하지 않는다. 현재 public+livekit은 제품 권한 통합 미완료로 부팅을 거절하며 기본/운영 팀 제한·OPEN/DRAINING/LOCKED 장벽은 유지한다.
- POST /api/sessions: SessionRequest → SessionResponse. 기본 invitation 모드는 유효한 inviteToken이 필수다. 명시적 SESSION_ADMISSION_MODE=gitlab-sso와 신뢰 프록시 설정을 함께 적용한 제품 서버만 호스트 SSO 검증 후 덮어쓴 X-SSO-User를 인정하여 inviteToken 없는 생성·방 코드 참가를 허용한다. 신원이 없으면 기존 초대 검사를 수행한다. 회원별 해시를 기존 inviteId 제한 버킷에 사용하며 IP·좌석·운영 잠금·예약 반환은 동일하다. 게임 신원은 서버가 발급하고 no-store·메모리 보관, fragment 초대는 읽은 뒤 주소에서 지운다. SessionResponse.expiresAt은 epoch ms이며 MediaGrant.expiresAt은 epoch 초다.
- DELETE /api/sessions/current: 자기 세션 Bearer만으로 미가입 RESERVED를 반환한다. 본문은 없거나 빈 객체이며 신원 지정은 400, Bearer 누락은 401, 활성 연결·JOINED·RETIRING은 409로 거절한다. 이미 취소·만료된 토큰은 204로 끝난다. 첫 연결 기한은 발급 후 60초이며 가입 후 활동 기반 lease와 구분한다. 상세 HTTP 계약은 docs/protocol.md를 따른다.
- POST /api/media/grants: Bearer 세션 + MediaGrantRequest → MediaGrant. 이전 회수/예산/phase 불충족은 409, 인증 오류 401/403, 공급자 불명 503으로 안전 code만 반환한다.
- POST /api/media/report: Bearer 세션 + MediaStatusReport → 204. 수신자 신원과 scope를 검사한다. 신고만으로 원격 회수·권한 성공을 확정하지 않는다.
- POST /api/livekit/webhook: raw body + 공급자 Authorization을 E가 검증하며 JSON 재직렬화·인증 생략을 하지 않는다.
- POST /api/operations/commands: OPS_TOKEN + OperationsCommand → 202 OperationSnapshot(pending). 같은 requestId/같은 본문은 같은 operationId, 다른 본문 재사용은 409다. retry-retirement에만 retirementId를 요구한다. 명령 대기·미완료 backend·감사 쓰기의 접수 상한은 64이며 drain용 여유 한 개를 둔다. 초과는 429 OPERATIONS_BUSY와 Retry-After: 1로 거절하며 접수되지 않은 같은 requestId를 다시 시도할 수 있다. 중복 결과 조회는 이 상한 때문에 새 명령으로 바꾸지 않는다.
- GET /api/operations/commands/:requestId: OPS_TOKEN → 200 OperationSnapshot 또는 404. 완료 상태는 succeeded/failed이며 HTTP 202를 작업 성공으로 해석하지 않는다.
- GET /api/operations/status: OPS_TOKEN → OperationsStatus. remaining 값이 null이면 미확인이고 0으로 바꾸지 않는다.
- /health/live는 프로세스 생존, /health/ready는 회수·저널·예산·인증 준비의 conjunction이다. RECOVERING을 재시작 루프로 우회하지 않는다.
- admission과 readiness는 독립이다. 정상 drain은 admission만 DRAINING으로 바꾸고 건강한 readiness는 READY를 유지한다. 새 입장/grant는 readiness=READY이고 admission=OPEN일 때만 허용한다. resume은 READY를 확인한 뒤 OPEN으로 전환한다. 실제 저널·보안·예산 장애는 readiness를 LOCKED로 만든다.
- 반복 오류 감사는 고정 kind/resultCode마다 60초 첫 표본을 공유하고 최근24시간/최대4,096개를 보관한다. 미완료 쓰기를 추가로 쌓지 않으며 실패를 성공으로 숨기지 않는다. 명령 entries의 requestId fingerprint·최종 결과와 파일 형식은 보존한다. 과부하 거절 자체는 영구 잠금 사유가 아니며 실제 감사 쓰기 실패는 기존처럼 잠근다. 수치 관측과 정확한 계수 범위는 [감사·명령 상한](../operations-audit-limits.md)을 따른다.
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
export type SessionAccessResponse = Readonly<{ method: 'invitation' | 'gitlab-sso' | 'guest' }>;
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
// Current connected host, LOBBY/DEVICE_CHECK only. POST returns 201, DELETE returns 204.
export const ROOM_INVITATION_ROUTE = '/api/sessions/current/invitation' as const;
export type RoomInvitationResponse = Readonly<{
  inviteToken: string;
  roomCode: string;
  expiresAt: number;
}>;
export type RoomInvitationErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_SESSION'
  | 'INVITATION_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'ADMISSION_CLOSED';
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
  verify(input: InvitationCheck): Readonly<{ inviteId: string; expiresAt?: number }> | null;
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
  /** Present when the face has a distinct, server-verified publisher in this receiver room. */
  facePublisher?: Readonly<{ mediaIdentity: string; participantSid: string }>;
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
    subscriptionMode?: 'publisher-permissions' | 'server-forwarding';
    /** Only server-forwarding: CAMERA-only source, distinct from the MIC/receive room. */
    facePublication?: Readonly<{
      url: string;
      token: string;
      roomName: string;
      mediaIdentity: string;
    }>;
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

### F 실행 시작과 기존 CI 작업 반영

2026-09-08 감사에서 `origin/ci/S15P21C204-41-jenkins-pipeline`의 `0dd76be19cc1102997abb97632a2e89157a85ee7`을 읽기 전용으로 확인했다. `develop`에 없는 `Jenkinsfile`, `infra/README.md`, `infra/compose.prod.yaml`, `infra/deploy.sh`, `infra/jenkins/SETUP.md`, `infra/nginx/host.conf`와 기존 서버 Dockerfile 수정이 있다. 이 기록은 원격 Jenkins/EC2 적용 증거가 아니다. 실제 실행에서는 최신 ref와 diff를 다시 확인하고 기존 F 브랜치를 우선한다. 새 브랜치에서 같은 파일을 처음부터 작성하거나 CI 파일을 두 벌로 운영하지 않는다. 원격 병합은 담당자가 수행한다.

F-04/05/06/16 구현에 앞서 해당 선행 변경을 작업 기준에 반영하고 현재 계약과 어긋나는 부분을 아래 작업에서 고친다. 다른 A–E 작업은 CI 브랜치 병합을 기다릴 필요가 없으며 F-01의 manifest/테스트 탐색 설정은 작은 인계 단위로 먼저 제공한다.

| 확인된 차이                                                                                   | 보완할 기존 작업                             | 인수에 필요한 확인                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI Verify가 format/lint/typecheck/test만 실행하여 check:execution·build·E2E를 빠뜨림          | F-04 / DP-04                                 | Linux Chromium 준비 후 현재 루트 `pnpm verify`를 한 번 실행하고 실제 source SHA와 결과 대상 일치 확인                                                                                                                                     |
| 서버 Dockerfile의 `pnpm deploy --legacy` 링크 문제를 고친 선행안이 있음                       | F-05 / DP-02                                 | 기존 수정안을 보존·검토하고 최종 runtime 이미지 안에서 두 workspace 패키지 import와 서버 기동 확인. 선행 코드 주석의 실측 주장은 이번 검증 증거와 구분                                                                                    |
| 선행 `infra/compose.prod.yaml`은 독립 Compose, 아래 계획 `compose.production.yaml`은 override | F-05 / DP-02                                 | 최종 운영 파일을 `compose.production.yaml` override로 통일한다. 선행 설정을 옮기고 F-04/06/16의 모든 참조·문서를 같이 갱신한다. 이전 prod 파일은 담당 검토 뒤 제거하거나 명시적으로 비활성화한다. 중간에 두 활성 배포 경로를 두지 않는다. |
| 개발 모드·미디어 disabled, 기본 nginx가 진단 경로를 전달함                                    | F-05/06 + B 인증·Origin/라우트 + E readiness | 격리된 개발 검증과 제품 배포를 구분한다. production 문자열만 바꿔 운영 완료로 처리하지 않으며 각 소유자가 자기 코드를 수정한다.                                                                                                           |
| web-proxy가 game-server의 ready 기반 healthy를 기다림                                         | F-05 / DP-02                                 | 복구 중 ready 503이어도 proxy를 통해 live/인증된 OPS를 관찰할 수 있게 시작 의존성은 live에 둔다. 배포 승인은 별도로 READY·drain/resume·회수 증거를 검사한다.                                                                              |
| Jenkins와 수동 deploy.sh가 drain·격리 없이 `compose up`, ready만 보고 성공·즉시 롤백          | F-16 / DP-06                                 | 자동·수동 양쪽을 같은 배포 runner로 연결하고 회수 미확인 때 교체·롤백 모두 차단                                                                                                                                                           |
| 수동 배포가 인수 TAG 이미지가 없으면 현재 checkout을 그 TAG로 빌드함                          | F-16 / DP-06                                 | 요청 SHA와 실제 checkout/digest 불일치를 거절한다. 다른 소스에 이전 SHA 태그를 붙이지 않고 웹·서버 이미지 쌍을 함께 검증                                                                                                                  |

### F 소유권과 1~5번 병렬 진행

F만 manifest·lockfile·공통 설정·`server/src/config/env.ts`·infra/Jenkins/scripts/루트 tests·observability를 수정한다. B의 `bootstrap.ts`/`main.ts`/라우트 등록, E의 media/operations/health, D의 worker/모델, A의 맵/튜닝, C의 웹 조립을 대신 수정하지 않는다. 의존성·설정 요청은 [F 인계 기록](handoffs/F.md)에 요청자·정확한 버전/필드·수정 파일·소비자 시험·인계 commit으로 모으고 한 명이 순서대로 반영한다. 소유자에게 돌려줄 결함은 재현 입력과 기대 결과를 기록한다.

| 작업         | 외부 전제 없이 진행할 결과                                                    | 인수에 필요한 전제                                                                         |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| F-01 / DP-01 | 테스트 탐색·Cloud 제외·preflight validator·최소 probe·환경 검사기의 로컬 시험 | Cloud 자격/잔량, AWS/TLS/Jenkins 접근, 대표 장치의 실제 확인은 각각 별도 `blockedOn`       |
| F-02 / QA-01 | 합성 표식·통계·시계오차 계산·fault adapter·민감값 저장 거절 시험              | E Gateway export/commit과 실제 Cloud 결과. MC-01 Cloud 대기로 로컬 계측 구현을 멈추지 않음 |
| F-03 / QA-02 | 시나리오와 성능 집계기·잘못된 표본 거절 시험                                  | C/D 실제 facade·모델·대표 GPU 장치·Cloud 수신. 막히면 다음 F-04/05를 진행                  |
| F-04 / DP-04 | 기존 CI 검토·명령/exit/SHA 계약 시험·Jenkinsfile 보완                         | 실제 Jenkins job/plugin/credential 및 GitLab 결과 연결 시험                                |
| F-05 / DP-02 | 기존 Docker 수정 반영·Compose 정적 검사·packaging 확인 코드                   | Docker daemon의 실제 이미지/볼륨 시험, 이후 B/E 실제 제품 인증·복구와 통합                 |

각 전제는 필요한 사례만 막는다. MC-01용 3인 합성 probe에 6대 장치·AWS·Jenkins 전체 완료를 요구하지 않는다. 로컬 구현이 검증되면 `localStage`와 `blockedOn`을 함께 인계하고, 원격 권한이 없다는 이유로 요청된 모든 번호를 중단하거나 Cloud 시험을 skip 성공으로 바꾸지 않는다. 외부 접근·실장치 확인이 필요한 단계는 정확히 미실시로 남긴다.

고정번호 실행 준비는 `node scripts/prepare-execution.mjs --role F --tasks 1-5`, 날짜별 번호는 `node scripts/prepare-execution.mjs --role F --day D2 --tasks 1-5`로 확인한다. 출력은 계획 선택이며 실제 환경 검사·구현·배포를 실행하지 않는다.

### F-01의 설정·Cloud preflight 인계 계약

F가 `env.ts`에서 검증하고 B가 `MediaConfiguration`에 매핑한다. E는 `process.env`를 직접 다시 읽지 않는다. 아래 설정은 기존 작업의 필수 입력이며 실제 시간 창·정책 수치는 운영자가 제공한다.

| 입력                                                                                                                           | 정규화 결과                                                                                                                 | 실패 조건                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                                                  | `httpUrl`, `wsUrl`, `apiKey`, `apiSecret`                                                                                   | 제품 모드 누락/잘못된 URL. 비밀 값은 보고서·VITE 변수·이미지 인수에 넣지 않음                                                              |
| `LIVEKIT_PROJECT_ALIAS`, `SERVICE_NAMESPACE`, `OPS_DATA_DIR`                                                                   | `projectAlias`, `namespace`, `opsDataDir`                                                                                   | 운영 확인 alias/namespace와 불일치, 비지속 경로·쓰기 불가                                                                                  |
| `OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS`, `OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS`                                                  | `publicWindow:{opensAtEpochMs,closesAtEpochMs}` 또는 null                                                                   | 둘 다 없음은 null/공개 잠금, 한쪽만 존재·순서 오류는 구성 거절                                                                             |
| `OPS_OFFICIAL_BUDGET_MAX_AGE_MS`, `OPS_OPERATION_TIMEOUT_MS`                                                                   | `officialBudgetMaxAgeMs`, `operationTimeoutMs`                                                                              | 양의 유한 정수 필수, 임의 무제한/성공 기본값 금지                                                                                          |
| `MAX_SLOTS`, `MEDIA_MAX_NORMAL_API_CALLS_PER_60S`, `MEDIA_MAX_TOTAL_API_CALLS_PER_60S`                                         | `maxConcurrentParticipants`, `maxNormalApiCallsPer60s`, `maxTotalApiCallsPer60s`                                            | 실제 검증된 방 수·슬롯과 불일치, 정상 >600·전체 >900·정상 >전체                                                                            |
| `OPS_DATA_DIR/official-usage-input.json`                                                                                       | `OfficialBudgetCheckpoint` 확인 뒤 `initialBudget`, 미확인은 null                                                           | 프로젝트·확인 시각·비음수 분/bytes를 E가 다시 검사하고 저널 예약과 대조                                                                    |
| B 제품 인증·HTTP/WS 보호 초기화                                                                                                | `productSecurityReady`                                                                                                      | 환경변수로 true를 받지 않음. B가 실제 초기화 결과를 계산하고 거절 회귀를 인계해야 함                                                       |
| `OPS_TOKEN`                                                                                                                    | B가 E `createOperatorAuth(token)`에 주입                                                                                    | 빈 값 구성 거절, HTTP 경로는 반환 인증 함수로 검사. 세션용 Bearer와 분리                                                                   |
| `INVITE_MAX_TTL_MS`, `SESSION_ATTEMPT_WINDOW_MS`, `SESSION_ATTEMPTS_PER_INVITE`, `SESSION_ATTEMPTS_PER_IP`, `ROOM_IDLE_TTL_MS` | AppConfig의 `inviteMaxTtlMs`, `sessionAttemptWindowMs`, `sessionAttemptsPerInvite`, `sessionAttemptsPerIp`, `roomIdleTtlMs` | 양의 safe integer 필수. 앞 두 값/마지막은 ms, attempts는 개수. 임의 기본값 없이 B 초대·입장 정책에 주입하고 미설정 제품 admission은 LOCKED |
| `OPS_DATA_DIR/capability-report.json`                                                                                          | E의 `CapabilityReport` parser 입력                                                                                          | E가 인계한 실제 MC-01 증거 및 project alias/namespace/SDK 불일치면 제품 잠금. F가 임의 SUPPORTED 파일을 만들지 않음                        |

`tests/cloud/CloudPreflight.ts`는 F 소유의 단일 strict schema/parser이며 runner와 E의 MC-01 Cloud test가 함께 사용한다. 비밀 값 대신 아래 값과 환경변수 이름만 저장하고 unknown 필드·유효하지 않은 경로·0개 시험을 거절한다. 이 QA 자료는 제품 wire 계약이 아니며 제품 코드가 tests나 문서 타입을 import하지 않는다.

| CloudPreflight 필드                                         | 타입·검증                                                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `projectAlias`, `namespace`, `sourceCommit`, `lockfileHash` | 비어 있지 않은 문자열. 현재 대상 및 실제 checkout/lock hash와 일치                                                          |
| `checkedAtEpochMs`, `expiresAtEpochMs`                      | epoch ms 유한 정수, 확인 ≤현재 <만료. 만료 이후 새 시험·단계 시작 금지, 기존 회수는 계속                                    |
| `remainingMinutes`, `remainingBytes`                        | 비음수 유한 수/정수. 공급자 확인 근거 필요, 자동 무료 총량 초기화 금지                                                      |
| `allowedCases`                                              | 아래 allowlist ID 배열. 현재 case가 포함되어야 함                                                                           |
| `budgetReservation`                                         | `{reservationId:string,participantMinutes:number,bytes:number}`. 양수 예약, 기존 활성 예약·여유를 뺀 잔량과 대조            |
| `credentialEnvNames`                                        | `readonly string[]`. case별 필요한 환경변수 이름을 allowlist로 고정하고 실제 값은 process 환경에서만 읽음                   |
| `deviceManifest`                                            | `{path:string,mode:'synthetic'\|'representative'}`. 파일 존재 확인. MC-01은 3개 합성 참가자, QA-02/09는 실제 대표 장치 필요 |
| `evidenceDir`                                               | 이번 case 결과를 저장할 `.local/qa` 아래 경로. CLI `--evidence`와 일치, 다른 case 증거 덮어쓰기 금지                        |
| `maxRooms`, `maxParticipants`                               | 양의 정수. 요청 stage/실제 연결 수를 포함하고 확인된 사용량 예약 범위 안에 있어야 함                                        |
| `maxDurationSeconds`, `cleanupAllowanceSeconds`             | 양의 유한 정수. 준비/본시험 시간과 별도 회수 시간, 둘의 합산 비용이 예약 범위 내                                            |
| `stageDurationSeconds`                                      | QA-11에서만 `{ '1':number, '3':number, '5':number }` 양수 필수. 그 외 case에서는 생략                                       |

runner는 위 schema 검증 후 자식 프로세스에 `RUN_CLOUD_TESTS=1`, `CLOUD_TEST_CASE`, `CLOUD_PREFLIGHT_PATH`, `CLOUD_EVIDENCE_DIR`만 추가 전달한다. `CloudPreflight.ts`의 `requireCloudPreflight(expectedCase)`는 test beforeAll에서 동일 파일·case·시각·경로·자격 존재를 재검사한다. 준비되지 않은 장치/Cloud 항목은 그 case의 `blockedOn`이며 로컬 fixture 검사를 멈추지 않는다. 회수 실패/timeout은 오류 종료하고 namespace·예약을 유지한 채 E에게 인계한다.

### F-01

**DP-01 · [DevOps] 실제 배포·Cloud·검증 환경 확인**  
일정: D1 2026-09-08 · **오늘 1번**  
기획 근거: v0.0.8 **02, 21, 23, 27장**  
선행 완료 결과: 문서 내부 선행 없음; 외부 실행 전제는 F-01에서 확인

**수정·생성 파일**

- `package.json`
- `pnpm-lock.yaml`
- `apps/web/package.json`
- `server/package.json`
- `packages/protocol/package.json`
- `packages/game-core/package.json`
- `vitest.config.ts`
- `vitest.cloud.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/vite.config.ts`
- `tsconfig.base.json`
- `tsconfig.packages.json`
- `tsconfig.qa.json`
- `server/src/config/env.ts`
- `scripts/check-execution-environment.mjs`
- `scripts/check-execution-plan.mjs`
- `scripts/run-cloud-check.mjs`
- `tests/contracts/environment.test.ts`
- `tests/cloud/probe.html`
- `tests/cloud/probe.ts`
- `tests/cloud/vite.config.ts`
- `tests/cloud/CloudPreflight.ts`
- `docs/verification.md`

**구현 순서**

1. D0에 실제 도구 버전 node/pnpm/docker/브라우저와 manifests/lockfile을 읽고 Node24.19.0·pnpm11.19.0·SDK정확버전을 기록한다. 설치는 frozen-lockfile 기준이며 모든manifest/lock/rootconfig 수정은 F가 단독 담당한다. 다른 담당자의 요청은 목록으로 모아 동일 버전 의존성만 추가하고 업데이트를 섞지 않는다.
2. 현재 Vitest include는 packages/apps/server뿐이다. `tests/contracts/**/*.test.ts`와 `tests/load/**/*.test.ts`를 기본 include에 추가하고 `**/*.cloud.test.ts`는 기본 exclude한다. vitest.cloud.config.ts는 `server/test/media/**/*.cloud.test.ts`와 `tests/cloud/**/*.cloud.test.ts`만 포함하고 workers 1·긴 시험 timeout을 둔다. 기본 pnpm verify가 실제 Cloud/장시간 부하를 자동 시작하지 않게 유지한다.
   루트 QA 코드는 기존 server/web tsconfig에 포함되지 않는다. `tsconfig.qa.json`을 `tsconfig.base.json` 기반 noEmit으로 만들고 `tests/**/*.ts`, `server/test/media/**/*.cloud.test.ts`의 import/타입을 검사한다. 합성 probe의 브라우저 API에는 이 QA 전용 설정에서 DOM/DOM.Iterable과 node 타입을 제공하고 D의 WebWorker를 끌어오지 않는다. 루트 typecheck에 `tsc -p tsconfig.qa.json --noEmit`을 연결한다. 이 타입 검사는 Cloud 연결이나 테스트 본문을 실행하지 않는다.
3. D가 만드는 features/vision/vision.worker.ts를 apps/web/tsconfig.json의 **/*.worker.ts exclude로 DOM컴파일에서 제외한다. D의 apps/web/tsconfig.worker.json(WebWorker lib) 파일이 실제 인계된 뒤 web typecheck에 tsc -p tsconfig.worker.json --noEmit을 추가한다. 준비중에 없는파일을 skip하여 완료표시하지 않는다.
4. check-execution-environment는 위 설정 입력 표의 정확한 변수 이름을 사용하고 값 자체를 출력하지 않는다. Cloud·OPS·AWS/도메인·Jenkins·장치의 존재와 확인 상태를 각각 보고한다. 제품 설정 schema는 먼저 작성·검증해 인계할 수 있으나 실제 production 활성화는 E/B의 readiness·인증 통합 후에만 허용하고 기존 disabled production 차단은 유지한다.
5. 운영자에게 필요한 입력을 정확히 기록한다: 실제 AWS 상품/세대·리전·OS·공인주소·포함전송량·DNS/TLS관리경로, Cloud프로젝트별칭·잔여분/GB/API공유상황·확인시각·시험namespace, 자격주입위치, 실제6대장치 OS/브라우저/CPU/GPU/카메라와 부하발생기 목록. 접근/자료가 없으면 해당 전제 BLOCKED로 두며 사양/잔량을 추정하지 않는다.
6. MC-01용 최소 합성 probe를 F소유 tests/cloud에 만든다. Vite로 현재고정 livekit-client를 bundle하고 연결/합성track게시/직접setSubscribed/메모리상 토큰재연결만 제공한다. 자동촬영/녹화기능은 넣지 않는다. QA-01 고급계측 없이도 E가 초기Cloud지원여부를 확인할 수 있게 한다.
7. run-cloud-check는 case allowlist→preflight문서 확인→대상namespace/시각/예산/장치체크→별도 Vitest 실행 순서다. 전제 누락은 nonzero와 BLOCKED, 실패/정리미확인도 nonzero로 종료한다. schema에는 secrets 대신 주입환경변수명만 둔다.
8. 모델 다운로드·manifest는 D가 담당한다. F는 /models/mediapipe/1.0.1/wasm과각task파일이manifest hash와맞고HTTPS/MIME/CSP/Worker기동이정상인지준비지원한다. 실제모델/장치/Cloud부재를 dummy파일·mock결과로 채우지 않는다.
9. 이미 존재하는 `scripts/check-execution-plan.mjs`와 루트 `check:execution`을 확인한다. 현재 `pnpm verify`의 format:check 바로 뒤 연결을 유지하고 기존 CI 브랜치를 반영해도 누락·중복 실행하지 않는다. 공통 계약 원본·A–F 사본·fixture·버전·문서 링크 불일치는 nonzero로 전파한다. 이 검사는 실행 계획의 일관성만 확인하며 제품 구현·Cloud 관문 통과를 뜻하지 않는다.

**연결 계약과 경계**

- D0준비/D1화요일착수/D2수요일구현/D3목요일통합/금요일오전확인 일정은 목표다. 준비불가 전제는 담당 실행계획의BLOCKED로공유한다.
- CloudPreflight는 위 필드 표와 `tests/cloud/CloudPreflight.ts`의 단일 parser를 따른다. 시간·상한·단계 duration을 뒤 작업에서 서로 다른 임의 shape로 추가하지 않는다. 변경은 E 및 해당 QA 소비자와 인계한다.
- 새 runner/config/probe는 향후이작업에서생성할대상이다. 현재존재한다고가정하지말고파일과명령실행을확인한뒤인계한다.
- 루트 직접 실행하는 QA harness에 추가 의존성이 필요하면 현재 lock에있는 @colyseus/sdk0.18.2/livekit-client2.22.2 등 정확버전만 F가root devDependency로 선언한다. E/D소유소스파일은변경하지않는다.
- 각 Cloud test의 beforeAll도 RUN_CLOUD_TESTS=1과 현재 case에 맞는 유효한 preflight를 검사한다. runner만 검증 뒤 child 환경에 이 플래그를 주입한다. 직접 Vitest 호출로 preflight를 우회하면 test.skip이 아니라 실패/BLOCKED로 종료한다. 별도 cloud config는 기본 cloud exclude를 그대로 상속하지 않고 대상 include를 명시한다.
- Cloud case allowlist를 정확히 고정한다: MC-01 → server/test/media/capability.cloud.test.ts; QA-02 → tests/cloud/performance.cloud.test.ts; QA-03 → tests/cloud/g1-a.cloud.test.ts; QA-04 → tests/cloud/g1-d.cloud.test.ts; QA-05 → tests/cloud/g1-b.cloud.test.ts; QA-06 → tests/cloud/g1-c.cloud.test.ts; QA-08 → tests/cloud/g4-metadata.cloud.test.ts; QA-09 → tests/cloud/mvp-flow.cloud.test.ts; QA-11 → tests/cloud/staged-load.cloud.test.ts; QA-12 → tests/cloud/ten-room-integrated.cloud.test.ts; DP-06 → tests/cloud/deployment-smoke.cloud.test.ts. case는 정확히 한 파일만 선택한다. 등록되지 않은 ID, 아직 인계되지 않은 파일, 발견된 테스트 0개는 nonzero/BLOCKED다. QA-01·QA-07·QA-10·QA-13은 Cloud allowlist가 아니다. DP-06 case는 F-16에서 구현될 때까지 파일 미인계로 실행을 막는다.
- scripts/run-cloud-check.mjs는 인자를 배열로 전달하여 pnpm exec vitest run --config vitest.cloud.config.ts <allowlist의 정확한 파일>을 실행한다. SDK/브라우저를 여는 동작은 검증된 beforeAll 또는 명시적 run() 안에만 둔다. tests/load/**/*.test.ts는 짧은 fixture·통계·스케줄러 단위시험이며 모듈 import 시 서버 기동, 실시간 대기, 네트워크, 실제 부하 실행을 하지 않는다.
- 별도 Cloud config는 Node 환경·동시 worker 1개·기본 testTimeout 120000ms·hookTimeout 30000ms로 시작한다. 긴 사례는 preflight에서 검증한 maxDurationSeconds와 cleanupAllowanceSeconds의 합으로 해당 test/hook 제한을 늘린다. QA-12의 실제 900초 구간과 준비·회수 시간을 기본 120초 안에서 강제 종료하지 않으며, 실행 상한과 예산을 명시하지 않은 무제한 timeout은 허용하지 않는다.

**시험 입력 → 기대 결과**

- tests/contracts/environment.test.ts를추가한후선택실행→test1개이상발견;No test files found를성공으로취급금지.
- Cloud환경변수/잔량누락→runner nonzero/BLOCKED·원격호출0회.
- vision.worker.ts에Worker전용API사용→mainDOM컴파일에서제외·별도Worker타입검사대상.
- pnpm verify실행→기존단위/E2E와새로컬계약은실행,cloud파일/30분부하는실행0회.
- 공통 블록 한 사본/계약 fixture의 버전 불일치 → format:check 뒤 check-execution-plan 단계 실패, 뒤 제품 검사로 성공을 덮지 않음.
- 버전불일치·대표장치미확보→각항목미확정표시,DP-01 전체완료커밋주장금지.

**추가·보완할 시험 파일**

- `tests/contracts/environment.test.ts`

**실행할 검사**

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm setup:env
pnpm exec playwright install chromium
pnpm build:packages
pnpm exec vitest run tests/contracts/environment.test.ts
node scripts/check-execution-environment.mjs --output .local/qa/environment.json
pnpm verify
```

**완료 조건**

AWS 상품/세대·리전·OS·주소·포함 전송량·도메인과 Cloud 계정의 현재 잔량/한도·SDK 버전을 확인해 기록한다. 테스트 namespace·자격 증명 주입 경로·6대 대표 장치·부하 발생 환경을 확보한다. pnpm verify의 format:check 뒤 문서·계약 동기 검사와 새 로컬 계약 시험을 실행하고 Cloud·장시간 부하는 명시적 runner로만 실행한다. 제품 모듈과 fixture의 로컬 통과를 실제 Cloud/장치 증거로 합산하지 않으며 비밀값을 문서에 넣지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
chore: MVP 실행 환경과 검증 설정 준비
```

**MR 본문에 채울 변경 사항**

- 환경사실확인표·비용시험preflight·로컬/Cloud시험분리를추가한다.
- 담당 공통 버전/Worker 타입 검사/QA 탐색 경로와 실행 계획 동기 검사를 고정한다.

**MR 리뷰 포인트**

- Cloud자격·잔량·실제장치미확보를형식적체크로완료하지않는지확인한다.
- F소유manifest/lock변경만묶이며Worker파일은D인계내용인지확인한다.

**완료 인계**

- A–E에고정버전·테스트include·환경변수명·BLOCKED항목을D0–D1early전달한다.
- D에게Worker경로와모델정적배포지원을, E에게MC-01 probe/CloudPreflight/namespace를먼저전달한다.
- B에게제품모드env확장은인증/OP-08통합후라는조건을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/DP-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-02

**QA-01 · [QA] 합성 미디어·실효 지연·장애 계측 도구**  
일정: D1 2026-09-08 · **오늘 2번**  
기획 근거: v0.0.8 **19, 26장**  
선행 완료 결과: [E-01](e-media-operations.md#e-01) (MC-01, D1)

**수정·생성 파일**

- `tests/contracts/fault-adapter.test.ts`
- `tests/contracts/evidence-format.test.ts`
- `tests/cloud/SyntheticMedia.ts`
- `tests/cloud/MediaObserver.ts`
- `tests/cloud/GatewayFaultAdapter.ts`
- `tests/cloud/ProbeHarness.ts`
- `tests/cloud/probe.ts`
- `scripts/run-cloud-check.mjs`

**구현 순서**

1. MC-01 gateway 포트를 감싸는 FaultAdapter를만들고 normal/delay-before-send/drop-response/remote-success-then-local-timeout 모드를requestId별로선택한다. fake원격상태와실제gatewaywrapper를구분하고생산서버코드에테스트backdoor를넣지않는다.
2. 합성 얼굴Canvas에frameSerial/색상패턴, 합성오디오Oscillator/AudioWorklet에시간/sequence표식을넣는다. 카메라/사용자음성취득없이publish하고사용후track/context를닫는다.
3. 수신 MediaObserver는 mediaInstanceId/receiverGeneration/발신자 publisherGeneration/trackSid별 getRTCStatsReport()와 표식 검출을 수집하고 bindingRevision을 증거에 연결한다. byte 증가만으로 새 미디어 허용 증거를 삼지 않는다. 새 SID·새 세대에는 기준 통계를 초기화하고, 같은 SID replaceTrack에는 누적 counter를 유지한 채 교체 전후 표식을 구분한다.
4. 서버policyAt/enqueueAt/sentAt/respondedAt와브라우저effectAt을수집한다. 서로다른clock은왕복ping으로offset/오차범위를추정하고raw delta를직접빼지않는다. 측정오차가기준판정을불가능하게하면표본을미확인으로기록한다.
5. 정책허용은첫신규표식도착, 차단은cutoff이후생성된표식의지속미수신및트랙통계로정의한다. 이미도착한buffer재생과새로전송된표식을분리한다. evidence writer는민감필드allowlist와결과최소표본을검사한다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- SDK2.22.2 설치타입: RemoteTrack.getRTCStatsReport():Promise<RTCStatsReport|undefined>, RemoteTrackPublication.setSubscribed(boolean), LocalTrack.replaceTrack(MediaStreamTrack). [클라이언트 SDK](https://docs.livekit.io/reference/client-sdk-js/classes/RemoteTrackPublication.html).
- FaultAdapter는원격취소보장이아니며drop-response모드는실제원격성공후호출자의응답만유실시키는경우를포함한다.

**시험 입력 → 기대 결과**

- 원격성공후응답유실→원격상태변화있음·caller UNKNOWN·양쪽timeline보존.
- SID변경→기존bytesReceived와새counter합산0,새표식검출로재개판정.
- 이미버퍼된음성+정책차단후새표식없음→buffer잔향과신규전달을구분.
- evidence에token/rawSDP키주입→저장거절·원문로그출력0.

**추가·보완할 시험 파일**

- `tests/contracts/fault-adapter.test.ts`
- `tests/contracts/evidence-format.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/fault-adapter.test.ts
pnpm exec vitest run tests/contracts/evidence-format.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

합성 얼굴/음성 표식, trackSid별 수신 통계 초기화, 정책 결정/발송/응답/실효 수신 시각을 기록한다. 지연·응답 유실·원격 성공 후 timeout을 주입할 어댑터를 준비하고 실제 미디어 원본/토큰을 저장하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 합성 미디어와 장애 계측 도구 추가
```

**MR 본문에 채울 변경 사항**

- 실효미디어표식·시각대조·지연/응답유실주입과비밀없는증거형식을추가한다.

**MR 리뷰 포인트**

- API응답을실효수신으로대체하거나다른시계원점을직접빼지않는지확인한다.

**완료 인계**

- E MC-04/05에콜백metric필드와FaultAdapter시나리오를전달한다.
- QA-03–06/11–12에공통ProbeHarness와증거writer를인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-03

**QA-02 · [QA] 비전·얼굴·3D 동시 성능 조기 측정**  
일정: D1 2026-09-08 · **오늘 3번**  
기획 근거: v0.0.8 **15, 20, 26, 27장**  
선행 완료 결과: [C-01](c-web-ui.md#c-01) (VI-01, D1), [D-03](d-vision-media.md#d-03) (IN-03, D1), [D-04](d-vision-media.md#d-04) (IN-04, D1), [D-05](d-vision-media.md#d-05) (IN-05, D1), [D-07](d-vision-media.md#d-07) (ME-01, D1), [E-01](e-media-operations.md#e-01) (MC-01, D1), [F-02](f-infra-qa.md#f-02) (QA-01, D1)

**수정·생성 파일**

- `tests/cloud/performance.cloud.test.ts`
- `tests/cloud/PerformanceScenario.ts`
- `tests/contracts/performance-summary.test.ts`
- `docs/verification.md`

**구현 순서**

1. VI-01·IN-03/04/05·ME-01의실제D/C공개facade가통합브랜치에도착했는지확인한다. 계약mock만있으면fixture측정으로표시하고실제대표장치결과와분리한다.
2. 실제6대중중간/저사양장치를선택해실제GPU기본브라우저로실행한다. SwiftShader강제·가상카메라자동성공을성능실측으로사용하지않는다.
3. 3개모델의15/10/8fps분산주기·단일진행frame·R3F렌더·160x16010fps가공얼굴송출·원격얼굴5개수신을동시에켜워밍업후일정시간표본을모은다.
4. requestAnimationFrame FPS, inferencequeue/drop·모델별지연,WebRTC인코딩/디코딩프레임·bitrate·CPU/GPU지원정보를기록한다. 모델하나씩/미디어off/3Doff비교구간으로병목을분리한다.
5. 128x1288fps/렌더30fps하위preset을별도시험하고D/C에게바꿀설정과영향을제안한다. 허용되지않은얼굴정지사진이나필수모델제거로수치를맞추지않는다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- 이작업은격리PoC의조기성능진단이다. G1/G5완주합격을대신하지않는다.
- 실제대표장치없음·모델미다운로드·카메라거부면해당실측BLOCKED;결함수정은D/C소유로반환한다.

**시험 입력 → 기대 결과**

- 얼굴/자세/손모두요구fps→한프레임중첩추론없음·queue무한증가없음.
- 미디어수신5개추가→FPS/decoder증가비용을독립표본으로기록.
- 저사양장치평균30fps미만→성능미달기록·preset조정인계.
- headless소프트웨어렌더결과만있음→대표장치성능통과표시금지.

**추가·보완할 시험 파일**

- `tests/cloud/performance.cloud.test.ts`
- `tests/contracts/performance-summary.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/performance-summary.test.ts
node scripts/run-cloud-check.mjs --case QA-02 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-02
pnpm typecheck
pnpm lint
```

**완료 조건**

대표 장치에서 세 모델의 분산 주기·R3F·가공 송출·5명 얼굴 수신을 함께 실행해 FPS/추론/인코딩/디코딩을 측정한다. 격리된 PoC Cloud 환경을 사용하며 제품 권한/완주 통과로 기록하지 않는다. VI-05 조정에 사용할 병목과 기준값을 남긴다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 얼굴 비전 3D 동시 성능 측정 추가
```

**MR 본문에 채울 변경 사항**

- 대표장치의복합부하와병목비교시나리오를추가한다.

**MR 리뷰 포인트**

- 원격얼굴5수신과실제장치GPU가측정에포함되는지확인한다.

**완료 인계**

- D VI-05/C VI-05에장치별병목·preset별지연/FPS를D1end전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-04

**DP-04 · [DevOps] Jenkins 검증과 GitLab 결과 연결**  
일정: D1 2026-09-08 · **오늘 4번**  
기획 근거: v0.0.8 **16, 23; 사용자 Jenkins 방향장**  
선행 완료 결과: [F-01](f-infra-qa.md#f-01) (DP-01, D1)

**수정·생성 파일**

- `Jenkinsfile`
- `scripts/ci-verify.mjs`
- `tests/contracts/ci-contract.test.ts`
- `infra/jenkins/SETUP.md`
- `infra/README.md`
- `docs/verification.md`

**구현 순서**

1. 위 기존 CI 브랜치의 Jenkinsfile·SETUP을 먼저 반영하고 현재 diff에서 유지/수정할 구간을 기록한다. 실제 Jenkins의 Pipeline/Git/GitLab 플러그인·버전·credentialId·webhook 권한을 DP-01에서 확인한다. 권한이 없으면 로컬 파이프라인 보완과 원격 연동 `blockedOn`을 구분한다. 이미지 빌드 성공만으로 누락된 E2E·계획 검사 통과를 추정하지 않는다.
2. GitLab의검증대상source commitSHA를파라미터/SCM환경에서받고체크아웃뒤git rev-parse HEAD와동일함을검사한다. 임의의develop최신값으로바꾸거나untrusted MR내용을쉘문자열로연결하지않는다.
3. 검증 단계는 Node24.19.0/pnpm11.19.0 확인→frozen install→Linux Chromium --with-deps 설치→pnpm verify 순서다. verify 내부의 format:check 직후 check-execution-plan이 공통 계약·fixture·문서 동기를 검사하도록 DP-01과 같은 진입점을 사용한다. 단계 실패는 즉시 실패로 남기고 기본 job에 Cloud/유료 시험 secret을 주입하지 않는다.
4. 빌드결과·커밋SHA·실패단계·테스트산출물URL을GitLab결과에연결한다. 실제설치된GitLab플러그인의gitlabCommitStatus/updateGitlabCommitStatus기능을공식문서와Jenkins스니펫생성기로확인한뒤사용하고지원플러그인을가정하지않는다.
5. post always에서서버/브라우저자식프로세스를회수하고비밀없는시험산출물만보관한다. 실패를테스트실패0으로치환하지않고정상build와같은commit이미지만후속배포에전달한다.

**연결 계약과 경계**

- [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/), [GitLab plugin](https://plugins.jenkins.io/gitlab-plugin/)을실제설치환경과대조한다. Jenkins job/webhook/credential외부설정은실행요청범위가확보된환경에서만적용한다.
- Cloud시험/실제장치측정은별도명시실행job이다. 검증job은모든MR에서무료Cloud예산을소비하지않는다.
- scripts/ci-verify.mjs가 내부에서 pnpm verify를 정확히 한 번 실행하고 exit code를 전달한다. commands 목록에서 같은 전체 검증을 다시 반복하지 않는다.

**시험 입력 → 기대 결과**

- SHA불일치→install이전실패·다른commit성공보고없음.
- lint실패→build/deploy중지·GitLab에실패단계연결.
- Cloudcredential없음→로컬verify수행가능·Cloudcase실행0.
- check:execution 또는 E2E 실패 → CI 실패·배포 0. 현재 CI 브랜치의 개별 검사 목록으로 되돌아가는 회귀를 거절.
- GitLab플러그인미설치→연동BLOCKED·가짜성공상태게시없음.

**추가·보완할 시험 파일**

- `tests/contracts/ci-contract.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/ci-contract.test.ts
node scripts/ci-verify.mjs
pnpm typecheck
pnpm lint
```

**완료 조건**

GitLab 변경의 정확한 commit으로 Node/pnpm 고정·frozen install·Chromium 준비·pnpm verify를 수행한다. 실패 단계·결과/산출물을 MR에서 추적하고 비밀값을 마스킹한다. Cloud 비용 시험은 기본 검증에 자동 포함하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
ci: Jenkins 검증과 GitLab 결과 연결 추가
```

**MR 본문에 채울 변경 사항**

- 정확한커밋검증·고정도구체인·실패보고와산출물연결을추가한다.

**MR 리뷰 포인트**

- MR체크아웃SHA와GitLab결과대상이일치하는지확인한다.
- 비밀이로그/산출물에포함되지않는지확인한다.

**완료 인계**

- 팀원A–E에게검증잡URL·sourceSHA·필수체크목록을전달한다.
- DP-06에검증된commitSHA와이미지생성조건을인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/DP-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-05

**DP-02 · [DevOps] 단일 서버 운영 이미지·Compose**  
일정: D1 2026-09-08 · **오늘 5번**  
기획 근거: v0.0.8 **16, 23장**  
선행 완료 결과: [E-02](e-media-operations.md#e-02) (OP-01, D1)

**수정·생성 파일**

- `infra/compose.yaml`
- `infra/compose.production.yaml`
- `infra/docker/Dockerfile.game-server`
- `infra/docker/Dockerfile.web`
- `infra/nginx/default.conf`
- `infra/.env.example`
- `infra/compose.prod.yaml` (선행 독립 파일을 운영 override로 이관하는 범위)
- `infra/README.md`
- `server/package.json`
- `server/src/config/env.ts`
- `tests/contracts/container-layout.test.ts`
- `scripts/container-smoke.mjs`

**구현 순서**

1. 기존개발Compose는local명시를유지하고운영override를분리한다. web-proxy/game-server만기본서비스로두고Node진입점은server/src/index→dist/index흐름과맞춘다. 한process/복제본1개를고정한다.
2. 같은 검증 commit으로 이미지 2개를 빌드하고 label/tag에 전체 SHA를 기록한다. 기존 CI 브랜치의 workspace 보존 packaging 수정안을 읽고 최종 이미지 안에서 `@kkakkung/protocol`, `@kkakkung/game-core` import와 `dist/index.js` 기동을 직접 확인한다. 예전 `pnpm deploy --legacy` 경로를 검증 없이 복원하지 않는다. 배포 방식과 무관하게 A의 실제 content/config를 서버 이미지에 넣고 server/package.json files 목록도 일치시킨다. D 모델은 웹 정적 출력에 같은 hash로 포함한다.
3. runtime는비root유저·내부Node포트·OPS_DATA_DIR지속볼륨·write권한·단일writerlock으로구성한다. secret은환경파일/secretmount로주입하고이미지COPY/ARG/VITE변수에넣지않는다.
4. 로그 회전용 max-size/max-file, health live/ready 용도, 종료 grace를 설정한다. 컨테이너 시작 healthcheck와 web-proxy depends_on은 live 기준으로 연결하여 복구 중에도 인증된 OPS와 ready 503을 프록시로 관찰할 수 있게 한다. 배포 승인은 별도 ready·운영 장벽을 검사하며 live 200으로 대체하지 않는다. E initialize가 로컬 기록·잠금 초기화 후 initialized를 반환하면 B가 HTTP health/운영 경로를 열고 후속 Cloud 복구를 계속한다. fatal 초기화이면 listen 없이 close하며 RECOVERING을 재시작 루프로 우회하지 않는다. READY 이후에도 resume 전 admission=DRAINING을 유지한다.
5. D1에는 실제 Docker daemon의 이미지 빌드·컨테이너 실행 기반·지속 볼륨·쓰기 권한·단일 쓰기자 구성을 먼저 E에 인계한다. 이것이 OP-08 구현의 선행 결과다. 제품 production 활성화와 READY/재시작 최종 시험은 B 초대 인증과 E Cloud/OP-08 코드 통합 뒤 D2에 F/E가 함께 완료한다. 이 마지막 시험을 OP-08의 선행으로 다시 요구하지 않으며 D1 기반 인계와 DP-02 전체 완료를 별도로 기록한다.
6. 운영프록시에서/dev-sessions/playground/monitor진단라우트를노출하지않도록B와등록/보호를확인한다. nginx차단만으로서버인증없음을덮지않는다.

**연결 계약과 경계**

- 게임상태는인메모리며volume은사용량/회수저널만보존한다. DB/Redis/게임스냅샷복원추가금지.
- 이미지태그sha동일·secret없는layers·모델hash·contentpackaging확인이완료조건. daemon없으면실행BLOCKED.
- container-smoke.mjs는 --compose 기본 파일과 --override 운영 파일을 함께 받아 동일 docker compose -f 순서로 config/build/up/status를 검사한다. override 파일 하나만 완성 Compose인 것처럼 실행하지 않는다.

**시험 입력 → 기대 결과**

- 컨테이너재생성→운영저널/예약남음·진행Match는복원하지않음.
- 두번째serverinstance기동→writerlock거절·새발급불가.
- 외부진단라우트/Node2567접근→차단,정상HTTPSproxy만허용.
- model/content누락이미지→smoke실패·배포준비완료금지.
- runtime 이미지 내부 workspace import 실패/깨진 symlink → 컨테이너 인수 실패. 빌드 단계의 import 성공만으로 대체하지 않음.
- game-server live 200/ready 503 복구 중 → web-proxy 기동·인증된 OPS/ready 관찰 가능, 제품 새 입장·배포 승인 0.

**추가·보완할 시험 파일**

- `tests/contracts/container-layout.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/container-layout.test.ts
docker compose -f infra/compose.yaml -f infra/compose.production.yaml config --quiet
docker compose -f infra/compose.yaml -f infra/compose.production.yaml build
node scripts/container-smoke.mjs --compose infra/compose.yaml --override infra/compose.production.yaml
pnpm typecheck
pnpm lint
```

**완료 조건**

같은 commit의 웹/모델 정적 파일과 게임 서버 이미지를 만든다. web-proxy+game-server, Node 1프로세스/복제본 1개, 비밀값 주입·지속 저널 볼륨·로그 회전을 실제 컨테이너로 검증한다. 개발 전용 API/모드가 외부 운영에 노출되지 않게 한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
ci: 단일 서버 운영 컨테이너 구성 추가
```

**MR 본문에 채울 변경 사항**

- commit일치이미지·운영볼륨·secret주입·비공개서버포트를구성한다.

**MR 리뷰 포인트**

- volume이container writable layer로바뀌지않는지확인한다.
- production검사제거로부팅성공을만들지않는지확인한다.

**완료 인계**

- E OP-01/08에실제volume권한·lock·health조건을인계한다.
- B에운영진단라우트차단·gracefulclose등록을요청한다.
- A/D에content/model이미지포함hash증거를전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/DP-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-06

**DP-03 · [DevOps] 도메인·TLS·WSS·접근 제한**  
일정: D1 2026-09-08 · **오늘 6번**  
기획 근거: v0.0.8 **20, 23장**  
선행 완료 결과: [F-01](f-infra-qa.md#f-01) (DP-01, D1), [F-05](f-infra-qa.md#f-05) (DP-02, D1)

**수정·생성 파일**

- `infra/nginx/default.conf`
- `infra/nginx/host.conf`
- `infra/compose.production.yaml`
- `scripts/deployment-smoke.mjs`
- `tests/contracts/proxy-contract.test.ts`
- `docs/verification.md`

**구현 순서**

1. DP-01확인실제도메인과관리주체를기준으로DNS→공인주소→TLS인증서체인/만료를확인한다. 미확인상품명·IP·credential을문서에예시값으로채워운영하지않는다.
2. nginx정적파일/모델응답과/api/ColyseusWebSocket Upgrade를설정한다. HTTPS리다이렉트·SNI·인증서갱신방법·idle timeout을명시하고모델wasmMIME과Worker/CSP실행을실제브라우저로확인한다.
3. 공용 인바운드는 80/443, Node 2567은 Docker 내부, SSH는 확인된 운영자 대역으로 제한한다. 배포 검증 중에는 F가 프록시·네트워크 계층에서 일반 이용자의 새 HTTP 세션·매칭·WSS 접속을 차단하고 지정 운영자·시험 클라이언트만 새로 접근할 수 있는 격리 방법과 해제·복구 방법을 준비한다. 진행 게임의 기존 연결과 인증된 운영 경로는 유지하여 정상 종료·drain·회수를 방해하지 않는다. 실제 접근 보존 경로를 확인하며 방화벽 일괄 삭제로 대체하지 않는다. 허용된 시험 경로의 접근 성공과 허용하지 않은 외부 새 접속의 차단을 둘 다 검증하고 증거가 없으면 BLOCKED로 남긴다.
4. 배포smoke는health live/ready 구분·초대거절/허용·WSS연결2초heartbeat유지·모델로드·카메라securecontext·마이크거부독립성을검사한다. 원격서버의productionready미완이면미완원인을기록한다.
5. 인증서갱신dryrun/서비스reload가현재검증대상연결에미치는영향을확인하고운영일정·담당자·실패알람경로를기록한다.

**연결 계약과 경계**

- Jenkins이전첫검증배포는이환경에서시행하며DP-06완료를선행조건으로두어순환시키지않는다.
- 실제6인/fullMVP완주는QA-09,이작업은접속/TLS/모델/장치권한배포경계검증이다.
- B가 구현한 OPS_TOKEN 보호 `POST /api/operations/invitations`와 `POST /api/operations/invitations/:inviteId/revoke`의 허용·거절 및 실제 초대 세션 교환을 검증한다. F는 초대 서비스나 E OperationsCommand에 새 action을 구현하지 않는다. 발급 요청의 만료는 B가 운영 공개창·최대 TTL과 대조하며 원문 초대 토큰을 증거에 저장하지 않는다.
- 외부 접근 격리는 F가 소유하며 E의 admission=DRAINING, 초대 인증, Origin 검사와 구분한다. Origin 검사는 네트워크 접근 인증 수단이 아니다. 정상 인증과 READY/OPEN 조건으로 시험할 수 있는 허용 경로를 준비하고 DP-06에 차단·허용·해제 확인 절차를 인계한다. 격리 확인 없이 resume하거나 공개하지 않는다.

**시험 입력 → 기대 결과**

- HTTP주소접근→HTTPS안내/리다이렉트·카메라오류를무시하지않음.
- 올바른OriginWSS→upgrade/heartbeat유지;잘못된Origin→거절.
- 외부2567/monitor/playground→차단,정적wasm/task→올바른MIME/내용hash.
- 마이크거부·카메라허용→장치체크가마이크거부만으로실패하지않음.
- 외부 격리 활성 → 지정한 시험·운영 경로는 정상 인증 가능, 허용하지 않은 외부 HTTP/WSS 경로는 차단; 한쪽 증거 누락 → BLOCKED·공개 재개 0.

**추가·보완할 시험 파일**

- `tests/contracts/proxy-contract.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/proxy-contract.test.ts
node scripts/deployment-smoke.mjs --base-url $env:QA_BASE_URL --evidence .local/qa/DP-03
pnpm typecheck
pnpm lint
```

**완료 조건**

DNS·인증서 자동 갱신·HTTPS/WSS Upgrade·idle timeout을 배포 환경에서 확인한다. 80/443만 공용, Node 포트는 내부, SSH는 운영자 허용 주소로 제한하고 정적 모델 로딩·웹캠 권한 경로를 점검한다. 배포 시험용 외부 격리의 허용·차단 양쪽 증거와 해제·복구 절차를 준비하여 DP-06에 전달한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
ci: HTTPS WSS와 운영 접근 제한 추가
```

**MR 본문에 채울 변경 사항**

- TLS·proxy·정적모델·운영네트워크접근경계와배포smoke를추가한다.

**MR 리뷰 포인트**

- Node포트를외부에다시publish하지않는지확인한다.
- TLS갱신/Worker/MIME가문서설명만아닌실제환경확인인지확인한다.

**완료 인계**

- C/D에실제HTTPS주소·CSP·모델public경로·장치권한결과를인계한다.
- QA-09/DP-06에초기검증환경과smoke명령을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/DP-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-07

**DP-05 · [DevOps] 게임·미디어·복구 지표와 경보**  
일정: D2 2026-09-09 · **오늘 1번**  
기획 근거: v0.0.8 **23, 25, 26장**  
선행 완료 결과: [B-05](b-game-server.md#b-05) (SV-05, D1), [E-08](e-media-operations.md#e-08) (MC-05, D2), [E-11](e-media-operations.md#e-11) (OP-04, D2)

**수정·생성 파일**

- `server/src/observability/MetricRegistry.ts`
- `server/src/observability/StructuredEvents.ts`
- `server/src/observability/AlertPolicy.ts`
- `scripts/collect-observability.mjs`
- `tests/contracts/observability.test.ts`
- `infra/compose.production.yaml`

**구현 순서**

1. B/E가 내보내는 `MetricSample`을 한곳에서 수집한다. `MetricRegistry.ts`에서 이름·단위 allowlist와 유계 수집 큐를 export하고 B가 `emitMetric` callback을 E에 주입한다. 수집은 동기 void이며 IO를 기다리거나 호출자에게 throw하지 않는다. 큐 상한과 누락 수를 측정해 관측 누락을 정상 0회로 숨기지 않는다.
2. Node perf_hooks의 monitorEventLoopDelay는 ns를 ms로 변환하고 process.memoryUsage는 bytes를 보존한다. 여러 Room의 같은 Tick 회차 시간을 합산한 분포와 개별 Room 분포를 따로 보고한다. 서버 atMs는 monotonic ms로 통일하고 브라우저 실효 시각은 QA-01의 시계 오차 보정 후 지연으로 변환한다.
3. F 소유 Pino formatter와 정적 allowlist에서 비밀 키·과도한 중첩 payload를 거절한다. B bootstrap에는 logger/callback factory 연결만 요청하고 B 소유 코드를 직접 편집하지 않는다.
4. 예산 900 접근·429·1초 권한 불명·10초 미회수·디스크 쓰기 실패·ready 잠금을 경보 상태로 만든다. 외부 통지 채널이 없으면 로컬 경보와 운영 기록을 남기고 외부 알림을 전송했다고 하지 않는다.
5. 격리 시험에서 slow tick·디스크 오류·응답 timeout을 주입해 경보 발생→운영 잠금→해소 조건을 확인한다. 로그 max-size/max-file과 metric 보관량을 제한하고 게임 화면에 운영 세부 정보를 노출하지 않는다.

**연결 계약과 경계**

- 중앙 `MetricSample`은 `{name:string,value:number,unit:'count'|'ms'|'bytes'|'ratio',atMs:number,matchRef?:string,generation?:number,requestId?:string}`다. value/atMs는 유한 수여야 하며 원본 Identity·닉네임·좌표·맵·token을 label로 쓰지 않는다. B/E가 계산하는 정책은 해당 소유자가 수정하고 F는 callback 수집·관측만 맡는다.
- F가 `MetricRegistry.ts`에 등록하는 최소 이름/단위는 `tick.duration/ms`, `tick.due/count`, `tick.catchup/count`, `tick.overload/count`, `input.queueDepth/count`, `input.rejected/count`, `process.memory/bytes`, `process.cpu/ratio`, `eventLoop.lag/ms`, `media.api.total60s/count`, `media.api.normal60s/count`, `media.api.429/count`, `media.policy.queueWait/ms`, `media.policy.responseLatency/ms`, `media.policy.effectLatency/ms`, `media.retirement.unresolved/count`, `media.reservation.participantMs/ms`, `media.reservation.bytes/bytes`, `operations.journal.writable/count`, `observability.dropped/count`다. CPU ratio는 0–1, writable은 0/1이다. 참가자분은 측정 시 참가자 ms로 변환한다. effectLatency는 QA 실효 수신 표본이 있을 때만 생성하며 API 응답으로 대신 만들지 않는다. 새 등록명·단위는 F 인계 기록과 B/E 소비자를 함께 갱신한다.
- 관측 TypeScript 구현의 최종 경로는 server/src/observability/MetricRegistry.ts, StructuredEvents.ts, AlertPolicy.ts이며 F가 소유한다. server/tsconfig.json의 src include와 서버 build에 포함한다. B는 bootstrap에서 이 factory/callback을 조립하고 E는 metric emit 계약만 연결한다. 루트 observability/*.ts에 런타임 코드를 두지 않는다.

**시험 입력 → 기대 결과**

- eventLoopDelay 20000000ns → 20ms, 단위 변환 오류 없음.
- 10개 Room Tick이 각각 2ms → 같은 회차 합산 20ms 표본, 개별 분포 평균으로 대체 금지.
- token/rawSDP/map 필드 또는 미등록 metric/잘못된 단위 주입 → 저장 거절, 호출자에게 비밀·예외 전파 없음.
- 유계 수집 큐 포화 → dropped 증가·관측 불완전 표시, Tick/권한 처리를 IO 대기로 멈추지 않음.
- UNRESOLVED 발생 → 경보 활성, 해소 확인 없이 시간만 지나 자동 정상 처리 금지.

**추가·보완할 시험 파일**

- `tests/contracts/observability.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/observability.test.ts
node scripts/collect-observability.mjs --input .local/qa/events.ndjson --output .local/qa/metrics.json
pnpm typecheck
pnpm lint
```

**완료 조건**

Tick/due/catch-up·lag·메모리·큐·전체 API/429·정책 응답/실효 지연·세대/잔존/예산·디스크를 계측한다. Pino 로그 회전·상한·경보를 실제 장애로 확인하고 토큰·SDP·프레임·음성·전체 출구 맵을 남기지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 게임 미디어 운영 지표와 경보 추가
```

**MR 본문에 채울 변경 사항**

- 공통단위의계측·민감정보제외·경보조건과로그용량제한을추가한다.

**MR 리뷰 포인트**

- API응답/실효지연분리·합산Tick분포·민감label제외를확인한다.

**완료 인계**

- A–E에 동일 metric schema와 등록명/단위를 전달하고 내부 파일 변경은 각 소유자가 수행한다.
- QA-10/12/DP-06에 수집 명령·임계값·누락 표본 판정 방법을 전달한다.
- B에게 server/src/observability/StructuredEvents.ts 및 MetricRegistry.ts의 factory import 경로를 전달하고 bootstrap 연결은 B가 수정하도록 한다. E의 관측 callback도 같은 이벤트 타입을 참조한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/DP-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-08

**QA-03 · [QA] G1-A 지연·결과 불명 회귀**  
일정: D2 2026-09-09 · **오늘 2번**  
기획 근거: v0.0.8 **26.1 G1-A장**  
선행 완료 결과: [E-08](e-media-operations.md#e-08) (MC-05, D2), [E-10](e-media-operations.md#e-10) (MC-07, D2), [F-02](f-infra-qa.md#f-02) (QA-01, D1)

**수정·생성 파일**

- `tests/contracts/g1-a.test.ts`
- `tests/cloud/g1-a.cloud.test.ts`
- `tests/cloud/scenarios/g1-a.ts`
- `docs/verification.md`

**구현 순서**

1. E MC-05/07의실제gateway와B권위control을ProbeHarness에연결한다. allowed v10을만든뒤requestId를멈추고v11이탈/차단목표를생성한다.
2. 확정응답지연999ms·응답유실·원격apply후localtimeout을각각독립case로실행한다. target별inFlight가1인지와v11차단전새허용이동시발송되지않는지기록한다.
3. timeout이후terminal/retire·MEDIA_POLICY_UNCERTAIN control을확인하고,보류한v10성공응답을늦게풀어구Identity/새세대가열리지않는지검사한다.
4. 실제Cloudcase에서는합성허용/불허표식과SDK직접subscribe시도로권한효과를확인한다. adapter만통과시로컬회귀통과·Cloud미실시로나눠보고한다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- 파괴적실패주입구간은G2정상지연백분위와구분하되정상구간의실패를자의적으로삭제하지않는다.

**시험 입력 → 기대 결과**

- v10정상지연중v11→응답후차단수렴·inFlight최대1.
- v10원격성공후응답유실→UNKNOWN/retire·신규grant차단.
- terminal후v10성공반환→새허용/ACTIVE전환0.
- 모의어댑터만통과→G1-A실제Cloud결과미실시.

**추가·보완할 시험 파일**

- `tests/contracts/g1-a.test.ts`
- `tests/cloud/g1-a.cloud.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/g1-a.test.ts
node scripts/run-cloud-check.mjs --case QA-03 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-03
pnpm typecheck
pnpm lint
```

**완료 조건**

v10 허용 지연 중 v11 이탈을 만들고 정상 응답·응답 유실·원격 성공 후 timeout을 각각 재현한다. 어댑터와 실제 Cloud 증거로 직렬화·UNKNOWN 종료·옛 응답에 의한 재허용 방지를 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 미디어 권한 지연과 결과 불명 회귀 추가
```

**MR 본문에 채울 변경 사항**

- G1-A의응답순서·결과유실·원격성공후timeout을분리검증한다.

**MR 리뷰 포인트**

- 로컬abort가원격apply도취소한다고주장하지않는지확인한다.

**완료 인계**

- 실패requesttimeline/seed를E MC-04/05소유자에게돌려수정받는다.
- G1-A의로컬/Cloud각결과를QA-09전제에기록한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-09

**QA-04 · [QA] G1-D 탈락 중 회수·늦은 허용 회귀**  
일정: D2 2026-09-09 · **오늘 3번**  
기획 근거: v0.0.8 **26.1 G1-D장**  
선행 완료 결과: [E-10](e-media-operations.md#e-10) (MC-07, D2), [E-11](e-media-operations.md#e-11) (OP-04, D2), [F-02](f-infra-qa.md#f-02) (QA-01, D1)

**수정·생성 파일**

- `tests/contracts/g1-d.test.ts`
- `tests/cloud/g1-d.cloud.test.ts`
- `tests/cloud/scenarios/g1-d.ts`
- `docs/verification.md`

**구현 순서**

1. 허용request를inFlight로만든동일Identity에B의개인종료를입력하여MC-07retire를시작한다. RemoveParticipant발송시점과보류된UpdateSubscriptions응답시점을순열로제어한다.
2. Remove먼저/늦은허용먼저/Remove원격성공후timeout을각각주입하고terminalflag·REVOKING/REVOKED/UNRESOLVED·예약상태를검사한다.
3. 브라우저메모리에만보관한옛JWT로새연결을시도하고직접setSubscribed(true)도시도한다.회수확인과새표식미수신증거를같은Identity·세대·requestId로연결한다.
4. 정리불명은예약유지/새grant거절이어야하며,완료후late허용을해제해도새generationbinding에영향이없는지확인한다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- SDKremoveParticipant부재오류와회수cutoff프로필은MC-01실증결과를쓴다. 임의sleep후성공으로보지않고거절/표식증거를남긴다.

**시험 입력 → 기대 결과**

- Remove확정뒤늦은허용응답→terminal유지·oldtoken재접속거절.
- Remove적용불명→UNRESOLVED·reservation유지.
- 폐기Identity에grant재요청→거절,새generation으로몰래재발급없음.
- 다른새Identity동시활성→oldrequest는그binding에적용0.

**추가·보완할 시험 파일**

- `tests/contracts/g1-d.test.ts`
- `tests/cloud/g1-d.cloud.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/g1-d.test.ts
node scripts/run-cloud-check.mjs --case QA-04 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-04
pnpm typecheck
pnpm lint
```

**완료 조건**

허용 진행 중 탈락과 RemoveParticipant를 겹치고 늦은 응답·옛 토큰 재입장을 시도한다. 실제 Cloud에서 terminal 재사용 금지·토큰 거절·미확인 결과 보존을 증명한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 탈락 중 회수와 늦은 허용 경쟁 검증 추가
```

**MR 본문에 채울 변경 사항**

- G1-D의제거·늦은응답·옛토큰재입장경쟁을검증한다.

**MR 리뷰 포인트**

- Remove성공만으로token모든경계를통과했다고표시하지않는지확인한다.

**완료 인계**

- E MC-07/OP-04에미해결재현순서·회수evidence를전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-10

**QA-06 · [QA] G1-C 재게시·전체 재연결 회귀**  
일정: D2 2026-09-09 · **오늘 4번**  
기획 근거: v0.0.8 **26.1 G1-C장**  
선행 완료 결과: [E-09](e-media-operations.md#e-09) (MC-06, D2), [E-16](e-media-operations.md#e-16) (MC-08, D2), [D-17](d-vision-media.md#d-17) (ME-07, D2), [F-02](f-infra-qa.md#f-02) (QA-01, D1)

**수정·생성 파일**

- `tests/contracts/g1-c.test.ts`
- `tests/cloud/g1-c.cloud.test.ts`
- `tests/cloud/scenarios/g1-c.ts`
- `docs/verification.md`

**구현 순서**

1. 가까이정지한두참가자의음성관계를허용하고CloudgetParticipant게시목록과Bmedia-bindings를기록한다. 위치변화없이세종류트랙전환을실행한다.
2. 마이크unpublish→새trackpublish로newSID를만들고,LocalTrack.replaceTrack(newSyntheticMediaStreamTrack)로SID가유지되는교체를별도수행한다. 실제SID가예상과다르면관측된변화를기록하고case를다시구성한다.
3. 전체연결교체는MC-08의old회수확인→새Identity/generation→새binding순서로실행한다. 구SDK세션의일시reconnect와구분한다.
4. 새 SID는 기본 차단→현재 게시 목록과 바인딩 검증→현재 정책으로 허용 순서를 확인한다. 같은 SID replaceTrack은 새 Webhook/재승인을 전제하지 않고 기존 허용 관계·새 표식 수신·불허자의 계속 미수신을 확인한다. 전체 교체는 구 Identity 회수 확인→새 세대/Identity→새 바인딩을 확인한다. 새 SID/세대일 때만 counter 기준을 초기화하고 같은 SID에는 교체 시각과 새 표식을 사용한다.
5. 6명 중 한 사람만 전체 연결을 교체한다. 나머지 다섯 명 receiverGeneration은 유지하고 교체자의 publisherGeneration/Identity/SID와 bindingRevision만 갱신되는지 검사한다. 바인딩·TrackSubscribed·audio-policy의 도착 순서를 바꾸고 오래된 응답이 새 출력을 부활시키거나 닫지 않는지 확인한다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- B의 EXEC-CONTRACT-3 `media-bindings`만 앱 매핑 근거로 사용한다. mediaInstanceId/receiverGeneration/bindingRevision과 참가자별 publisherGeneration/Identity/participantSid/trackSid를 검증하고 `audio-policy`의 bindingRevision과 맞춘다.
- replaceTrack는설치livekit-client LocalTrack.d.ts에서확인된API. source속성을바꾼것만으로Cloud게시목록이바뀐다고추정하지않는다.

**시험 입력 → 기대 결과**

- 정지쌍newSID게시→policy재계산·기본차단후허용.
- SID 유지 replaceTrack→새 표식 관측·기존 mapping/허용 정합성 유지·불허자 미수신, 새 서버 Webhook이 없어도 실패로 만들지 않음.
- 한 사람만 full reconnect→그 사람 세대/Identity 교체, 다른 다섯 명 수신자 세대 유지, 구 응답/구 바인딩의 새 출력 변경 0.
- fullreconnect→oldtoken회수·새Identity·oldrequest적용0.
- 불허수신자직접subscribe→새표식미수신.

**추가·보완할 시험 파일**

- `tests/contracts/g1-c.test.ts`
- `tests/cloud/g1-c.cloud.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/g1-c.test.ts
node scripts/run-cloud-check.mjs --case QA-06 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-06
pnpm typecheck
pnpm lint
```

**완료 조건**

가까이 정지한 쌍에서 새 SID 게시·같은 SID replaceTrack·한 사람만 전체 재연결을 각각 실행한다. 새 SID는 기본 차단 후 서버 확인/허용, 같은 SID는 기존 권한 정합성·새 표식·불허 유지, 전체 교체는 구 Identity 회수와 다른 다섯 명 세대 유지로 검증한다. 실제 Cloud 증거와 로컬 순서 fixture 결과를 구분한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 재게시와 미디어 세대 변경 회귀 추가
```

**MR 본문에 채울 변경 사항**

- G1-C의SID변경·유지교체·전체연결교체를독립검증한다.

**MR 리뷰 포인트**

- 거리변화가없어도검증이실행되는지와SID통계혼합을확인한다.

**완료 인계**

- E MC-06/08·D ME-07에실제SDK이벤트순서와실패case를전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-11

**QA-05 · [QA] G1-B 강제 종료·재시작·옛 토큰 회귀**  
일정: D2 2026-09-09 · **오늘 5번**  
기획 근거: v0.0.8 **26.1 G1-B장**  
선행 완료 결과: [E-15](e-media-operations.md#e-15) (OP-08, D2), [C-14](c-web-ui.md#c-14) (FL-10, D2), [F-02](f-infra-qa.md#f-02) (QA-01, D1)

**수정·생성 파일**

- `tests/contracts/recovery-fixtures.test.ts`
- `tests/cloud/g1-b.cloud.test.ts`
- `tests/cloud/scenarios/g1-b.ts`
- `scripts/isolated-server-process.mjs`
- `docs/verification.md`

**구현 순서**

1. 시험전용namespace/지속저널/운영volume을만들고참가상태3종을준비한다:PREPARED미입장,Cloud갱신token을받은연결,이미퇴장한Identity. 공유개발/운영서버가아닌runner가생성한PID/컨테이너ID만기록한다.
2. 갱신token은고정2.22.2의Room.engine.on('tokenRefreshed', handler) 타입을실행시재확인해시험harness메모리에만받는다. private token필드읽기·로그/HAR기록금지. 갱신이실제발생하지않으면그case는BLOCKED/미실시로남기고초기token시험으로대체하지않는다.
3. 브라우저를유지한채시험Linux컨테이너에SIGKILL을보낸다. 정상클라이언트가socketclose즉시또는마지막유효heartbeat6초후입력/미디어/자동재연결을멈추는지확인한다.
4. 같은지속volume으로서버를재시작하고RECOVERING에서새입장/grant거절→구Identity회수→잔존조회→예약/공식잔량정합→READY순서를기록한다. 타서비스fixture방에는변경호출이없어야한다.
5. 보관한3종token으로Cloud재연결을시도하고거절을확인한다. 저널부분레코드/유실/회수timeout을추가주입해READY가끝까지false인지확인한다. 종료후시험namespace정리상태와소비예산을남긴다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- 설치타입근거 apps/web/node_modules/livekit-client/dist/src/room/{Room,RTCEngine,events}.d.ts: Room.engine, tokenRefreshed callback. 이저수준관측은고정버전시험harness한정,제품의미공개토큰추출API로노출하지않는다.
- 전체호스트상실중변조단말즉시원격회수는별도감시자가없는MVP보장범위밖이다. 복구후회수와정상단말heartbeat를각각판정한다.

**시험 입력 → 기대 결과**

- SIGKILL·브라우저유지→6초내정상단말수명종료,자동재입장0.
- PREPARED미입장옛token→재시작회수후Cloud거절.
- Cloud갱신token/기존퇴장token→각각재입장거절증거.
- 저널손상·회수불명→live200가능/ready503·발급0.
- 타서비스Cloud방→변경요청0.

**추가·보완할 시험 파일**

- `tests/contracts/recovery-fixtures.test.ts`
- `tests/cloud/g1-b.cloud.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/recovery-fixtures.test.ts
node scripts/run-cloud-check.mjs --case QA-05 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-05
pnpm typecheck
pnpm lint
```

**완료 조건**

브라우저 유지 상태에서 서버 SIGKILL을 주입한다. 정상 단말 heartbeat 종료, 미입장·Cloud 갱신·이미 퇴장 토큰의 재입장 거절, 이전 세대 회수 전 READY 불가를 실제 Cloud로 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 강제 종료와 이전 미디어 토큰 회귀 추가
```

**MR 본문에 채울 변경 사항**

- G1-B서버상실·지속기록복구·미입장/갱신/퇴장token회수경계를검증한다.

**MR 리뷰 포인트**

- 살아있는프로세스를임의PID로종료하지않고시험소유대상인지확인한다.
- 갱신token을실제로얻지못한시험을갱신검증통과로쓰지않는지확인한다.

**완료 인계**

- E OP-05–08·B FL-10·D수명cleanup에실패증거를전달한다.
- QA-09전제에3종토큰별실제결과와BLOCKED를분리한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-12

**QA-07 · [QA] G3 실제 Room 동시 판정 회귀**  
일정: D2 2026-09-09 · **오늘 6번**  
기획 근거: v0.0.8 **07, 26.1 G3-A/B/D장**, 최신 아이템 결정 대기 정정, EXEC-CONTRACT-3 경계 계약  
선행 완료 결과: [A-15](a-game-core.md#a-15) (RL-08, D1), [A-33](a-game-core.md#a-33) (EX-03, D2), [A-21](a-game-core.md#a-21) (KN-07, D2), [B-05](b-game-server.md#b-05) (SV-05, D1), [B-18](b-game-server.md#b-18) (FL-08, D2). 경계별 시험은 해당 실제 A/B/C/D/E 모듈을 인계받은 뒤 추가하며 미인계 항목을 mock으로 완료 처리하지 않는다.

**수정·생성 파일**

- `tests/contracts/g3-room.test.ts`
- `tests/contracts/g3-overload.test.ts`
- `tests/contracts/producer-consumer.test.ts`
- `tests/fixtures/g3-scenarios.ts`
- `tests/fixtures/execution-boundaries.ts`
- `scripts/isolated-server-process.mjs`
- `docs/verification.md`

**구현 순서**

1. A의seeded맵/순수Corefixture와B의실제KkakkungRoomfactory를조합하고prototype/stub판정으로바꾸지않는다. authenticated6명·protocol0.2.0명령·권위tick을하네스에서구동한다.
2. G3-A는포획/탈출commit과socketclose를동일Tick/서로다른순서로넣고누계/폐쇄출구/활동자경기계속을검사한다. ACTIVE도망자/술래close는ABORTED와구분한다.
3. G3-B는 덫 2명 동시 진입·유예자만·유예+일반·유예 끝 Tick·무장 시 기존 점유를 순열로 검사한다. 자연 구속 시간 만료와 포획·탈출 우선순위는 계속 검증한다. 도망자 아이템의 종류·효과·획득·사용 및 기존 G3-C는 PRODUCT_DECISION_PENDING으로 별도 기록하고 성공/실패 판정이나 기능 완료의 필수 조건으로 넣지 않는다.
4. G3-D는주입clock으로100/200ms지연을재현하고격리서버eventloop에실제2초정지를넣는별도case를둔다. 최대4catchup·250ms초과ABORTED·TTL500ms만료·deadline불연장을확인한다.
5. 실패는seed/초기상태/입력/최종state/event를비민감fixture로축약해A/B에게전달한다. F가규칙모듈을고쳐시험만통과시키지않는다.
6. `docs/execution/contracts/{types.ts,fixtures.ts,fixtures.test.ts}`의 기준 계약·순서 사례를 참고하여 실제 A stepMatch→B command 응답/serializer→C reducer/D runtime, E 바인딩→B 송신→D 소비자를 `producer-consumer.test.ts`에 조합한다. 서로 다른 생산자/소비자 구현을 실제로 import하고 시간·transport·SDK의 외부 경계만 통제한다. fixture 자체의 validator 통과를 모듈 통합 통과로 표시하지 않는다.
7. accepted 접수 뒤 core 규칙 거절→terminal 실행 결과→UI pending 해제, command 결과 중복/역순/조회 복구, 바인딩·트랙·audio-policy 도착 순열, 6명 중 한 명 재연결을 검증한다. 바인딩 삭제·옛 publisherGeneration/receiverGeneration/revision은 새 출력에 적용되지 않아야 한다.
8. 얼굴만 갱신되는 동안 오래된 자세의 유효 시간이 연장되지 않는지, 교환 요청자/수락자 UI와 D 입력이 다른지, READY true가 로컬 장치 점검 완료 신고이고 취소/카메라 장애가 READY false로 이어지는지 검사한다. 서버가 웹캠 영상을 독립 검증했다고 주장하거나 별도 DEVICE_REPORT 명령을 만들지 않는다. 다른 사람의 가시 감지기 wall과 출구 포털 발견→폐쇄 표현도 실제 serializer/소비자에 연결한다.
9. B의 연습→none→본경기 gameScope fullview를 C에 실제 연결하여 이전 지도·출구·이벤트 격리와 공개 phase version 하한을 검증한다. D의 미디어 재연결만으로 gameScope가 바뀌지 않아야 한다. E initialize의 initialized/RECOVERING·LOCKED와 fatal을 B 부팅에 연결하여 후속 Cloud 복구 중 HTTP 상태 관찰, fatal 시 listen 0, READY 이후 DRAINING 유지도 검증한다.

**연결 계약과 경계**

- 기본Vitest tests/contracts include로실행되며Cloudcredential없어야한다. 실제Room조합/순수Core검증은별도식별한다.
- 실제eventloop정지는runner가소유한child process에서만실행하고15초기본timeout을case수준으로필요분만늘린다.
- 원본 계약 fixture의 정적 검사와 실제 제품 모듈의 로컬 통합 증거는 구분한다. 둘 다 G1 실제 Cloud·G5 장치·G6 부하 완료 증거를 대신하지 않는다. C/D 모듈은 DOM/미디어 포트를 주입해 네트워크 없이 실행하고 비전 모델/실제 Cloud를 기본 verify에서 기동하지 않는다.

**시험 입력 → 기대 결과**

- ESCAPEDcommit+close→탈출누계/출구폐쇄유지·남은경기계속.
- 덫유예자2명만진입→발동/소모0;일반후보함께→1명만선정.
- 아이템 미정 + G3-A/B/D 통과 → 확정 범위 통과와 G3-C PRODUCT_DECISION_PENDING을 별도 기록, 미정 아이템 자동 통과/필수 실패 처리 없음.
- 2초정지→catchup대량실행0·SERVER_TICK_OVERLOAD·deadline연장0.
- accepted 이후 A가 현재 규칙으로 거절 → B terminal rejected가 C에 도달해 pending 해제, 같은 결과 재전송은 UI 중복 갱신 0.
- 트랙→바인딩→정책 / 정책→바인딩→트랙 → 같은 최종 얼굴/음성 출력, 검증 전 출력 0·종료 후 보류 0.
- P2만 재연결 + P2 구 binding/control 후도착 → 나머지 5명 receiverGeneration 유지, P2 최신 publisherGeneration만 사용.
- face sampledAt만 증가·pose는 오래된 frame → C 포즈 유지시간 증가 0; 새 유효 pose frame만 누적.
- 같은 exchange의 요청자와 대상자 → 대상자만 수락 명령 가능, 요청자 입력으로 수락 전환 0.
- 장치 점검 통과→READY true, 점검 취소/카메라 장애→READY false → B roster의 ready 해제·준비 장벽 잠금, 영상 독립 검증 성공 표시 없음.
- PreparationResult ready만 수신·self faceTrackSid 없음 → B LOAD_READY 장벽 닫힘; E가 검증한 self entry와 현재 scope 신고 일치 → 장벽 준비 조건 충족, D의 원격 self 출력 0.
- 가시 감지기 wall/출구 폐쇄를 B가 serialize → C가 같은 벽면 렌더/폐쇄 복원, 숨은 벽면 추가 노출 0.
- 같은 match의 practice revision 1→none 2→game 3 fullview → C의 연습 지도·출구·이벤트 제거; 늦은 revision 1 view/event는 적용 0, 같은 revision의 다른 ID는 거절/resync.
- 공개 phase 전환보다 먼저 온 private-view는 최신 1개/1초, 미래 scope 이벤트는 최대 64개/1초만 보류; 적합한 fullview 없이 이벤트로 scope 전환 0, 만료 후 view 재동기화.
- 동일 gameScope에서 receiverGeneration만 증가 → D 연결만 교체하고 C 지도·지식 유지; E initialized/RECOVERING → B health/운영 경로 관찰 가능·ready 503, fatal → listen 0·close.
- Cloud 정리·공식 잔량 정합 완료 → READY이지만 DRAINING·신규 입장/grant 0; resume terminal succeeded와 OPEN 확인 후에만 6인 시험 입장 가능.

**추가·보완할 시험 파일**

- `tests/contracts/g3-room.test.ts`
- `tests/contracts/g3-overload.test.ts`
- `tests/contracts/producer-consumer.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/g3-room.test.ts
pnpm exec vitest run tests/contracts/g3-overload.test.ts
pnpm exec vitest run tests/contracts/producer-consumer.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

G3-A 개인 종료와 이탈, G3-B 덫 동시 후보/유예/기존 점유와 자연 구속, G3-D 지연/2초 정지/마감/TTL을 실제 Room 조합으로 검증한다. 명령 최종 결과·바인딩 도착 순서·한 명 세대 교체·센서 신선도·교환 방향·준비 신고·가시 벽면/포털을 실제 생산자·소비자 모듈로 연결한다. 순수 시험/제품 모듈 로컬 통합/실제 Cloud 증거를 구분하고 미정 아이템 G3-C는 PRODUCT_DECISION_PENDING으로 남긴다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 실제 Room의 게임 규칙 회귀 추가
```

**MR 본문에 채울 변경 사항**

- 확정 범위 G3-A/B/D와 실제 생산자·소비자 경계를 권위 순서·실패 주입으로 검증하고 아이템 결정 대기를 별도 보고한다.

**MR 리뷰 포인트**

- 개인종료누계를연결삭제와함께지우지않는지확인한다.
- Fixture/순회순서를바꿔도동일결과인지확인한다.

**완료 인계**

- A/B의관련작업ID로축약재현을전달하고수정commit도착후해당case를다시검증한다.
- C/D/E에는 실제 소비자 실패 fixture와 바인딩·센서·UI 재현 순서를 전달한다. 인터페이스 변경은 고정 리뷰 상대 외에 해당 생산자/소비자도 검토한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-13

**QA-08 · [QA] G4 수신자별 정보 은폐 회귀**  
일정: D2 2026-09-09 · **오늘 7번**  
기획 근거: v0.0.8 **08, 09, 17, 26장**  
선행 완료 결과: [B-14](b-game-server.md#b-14) (KN-04, D2), [A-22](a-game-core.md#a-22) (KN-08, D2), [C-08](c-web-ui.md#c-08) (EQ-10, D2), [E-09](e-media-operations.md#e-09) (MC-06, D2), [C-07](c-web-ui.md#c-07) (VI-03, D2), [A-14](a-game-core.md#a-14) (RL-07, D1), [F-07](f-infra-qa.md#f-07) (DP-05, D2)

**수정·생성 파일**

- `tests/contracts/g4-packets.test.ts`
- `tests/contracts/g4-bundle.test.ts`
- `tests/cloud/g4-metadata.cloud.test.ts`
- `tests/fixtures/private-view-scenarios.ts`
- `scripts/inspect-public-bundle.mjs`
- `docs/verification.md`

**구현 순서**

1. 한서버에술래/도망자/개인종료자연결을붙이고초기Schema/patch·private-view전체교체·resync·private-event·command-result를수신자별로저장한다. hiddenfixture에식별가능한sentinel맵/seed/출구좌표를넣는다.
2. 술래에게개인출구/미탐색지형/시야밖좌표가없는지엄격schema와필드값양쪽으로검사한다. 개인종료후새map/entity/음성policy갱신이없고종료된출구표식이현재전체집합에서제거되는지검사한다.
3. 확정된 과거 지도 교환/감지 사건 위치는 고정 Tick의 과거점만 전달되는지 확인한다. 미정 아이템의 해제 사건 좌표는 구현하지 않는다. 허용 과거점을 모든 좌표 금지 정규식으로 차단하거나 현재 위치 추적으로 확장하지 않는다.
4. productionweb번들과sourcemap·정적JSON·error/log를검사해서버content/seed/전체맵sentinel이없는지확인한다. LiveKitroomName/identity/metadata/attributes도actualCloudcase에서검사하고얼굴사전수신동의범위와위치정보를구분한다.
5. 비밀원문이있는증거는공유산출물로옮기지말고테스트내불일치필드명/위반코드만요약한다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- B public state는좌표없음;private-view는큰stateVersion만수용. metadata검증을SDKmock만으로끝내면Cloud부분미실시.
- 웹public모델/일반기하자산은허용되며실제서버맵/seed를구분해서검사한다.
- g4-bundle.test.ts의 기본 verify 실행은 내장 합성 fixture에 대한 번들 탐지기 단위시험만 수행한다. 실제 apps/web/dist 탐지는 pnpm build 후 inspect-public-bundle.mjs가 수행한다. 기본 verify의 test 단계가 build보다 앞선 기존 순서를 깨끗한 checkout에서도 지원한다.

**시험 입력 → 기대 결과**

- 술래초기뷰/resync→runner출구sentinel없음.
- 개인종료뒤가까운생존자이동→새visibleEntities/음성binding정보수신없음.
- 지도교환과거사건→허용된과거점만남고현재위치갱신없음.
- 웹bundle에서server맵sentinel발견→G4실패·정상출력묻기금지.

**추가·보완할 시험 파일**

- `tests/contracts/g4-packets.test.ts`
- `tests/contracts/g4-bundle.test.ts`
- `tests/cloud/g4-metadata.cloud.test.ts`

**실행할 검사**

```bash
pnpm build
pnpm exec vitest run tests/contracts/g4-packets.test.ts
pnpm exec vitest run tests/contracts/g4-bundle.test.ts
node scripts/inspect-public-bundle.mjs --directory apps/web/dist
node scripts/run-cloud-check.mjs --case QA-08 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-08
pnpm typecheck
pnpm lint
```

**완료 조건**

역할별 Schema/patch·초기 뷰·resync·이벤트·오류·로그·metadata를 검사한다. 술래 출구, 미탐색 지형, 시야 밖 좌표와 웹 번들의 서버 맵/seed 유출이 없고 허용된 과거 사건만 전달되는지 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 수신자별 게임 정보 은폐 회귀 추가
```

**MR 본문에 채울 변경 사항**

- 패킷·resync·오류·번들·Cloudmetadata의정보경계를검증한다.

**MR 리뷰 포인트**

- 과거사건의허용정보와시야밖현재좌표를혼동하지않는지확인한다.

**완료 인계**

- B projection/C view/E metadata각소유자에게누출필드/재현상태를전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-08.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-14

**QA-10 · [QA] 60 게임 클라이언트 30분 진단**  
일정: D2 2026-09-09 · **오늘 8번**  
기획 근거: v0.0.8 **26장**  
선행 완료 결과: [F-12](f-infra-qa.md#f-12) (QA-07, D2), [F-07](f-infra-qa.md#f-07) (DP-05, D2), [B-09](b-game-server.md#b-09) (AC-04, D1)

**수정·생성 파일**

- `tests/load/GameLoadClient.ts`
- `tests/load/GameLoadScenario.ts`
- `tests/load/game-load.test.ts`
- `scripts/run-game-load.mjs`
- `scripts/summarize-load.mjs`
- `docs/verification.md`

**구현 순서**

1. Cloud SDK를연결하지않는명시적진단profile로실제게임Room을1→3→5→10방구동한다. 제품인증/계약과규칙은실제모듈을쓰고MEDIA_MODE=disabled가제품ready를보장한다고표시하지않는다.
2. 각방6개클라이언트가protocol0.2.0으로ready/이동/회전/상호작용을보낸다. 3분deadline과결과후새matchId/재경기를지키며30분동안하나의무한경기를만들지않는다.
3. 최종10방60클라이언트동시구간을30분이상유지하고B/F계측의같은Tick합산duration·lag·commandack·queue·RSS를수집한다. 연결만유지한idle부하는본진단합격으로삼지않는다.
4. runner는maxRooms/maxSlots를검증된진단대상에만주입하고단계실패시상승을중지한다.입력p95는명령수용까지이며9/6Tick행동완료시간과분리한다.
5. 결과에서p95/p99·최대queue·abort수·메모리기울기·대상commit/장치/네트워크를계산하고cleanup후자식서버/클라이언트0을확인한다. 이결과를G6미디어통합으로표시하지않는다.

**연결 계약과 경계**

- 테스트파일 game-load.test.ts는scheduler/통계짧은단위시험만기본verify로실행한다. 실제30분은run-game-load 명시명령이며기본Vitest에넣지않는다.
- 합격목표:10방합산Tick p95≤20ms/p99≤40ms,lag p95≤20ms,명령수용p95≤200ms;network조건기록필수.
- run-game-load.mjs만 실제 부하를 시작한다. GameLoadClient/GameLoadScenario import에는 연결/타이머 부작용을 두지 않으며 game-load.test.ts는 주입 fake clock과 fake socket으로 짧은 스케줄러·통계 시험만 수행한다. --final-duration-seconds 1800 실행 결과가 없으면 30분 진단은 미실시로 남긴다.

**시험 입력 → 기대 결과**

- 1방단계에서overload→3방진행중지·실패기록.
- 60개idle연결만30분→능동입력coverage실패.
- 30분중matchId변경없이3분초과→시나리오오류.
- quantilefixture에느린상위1%→p99에반영,평균만으로통과금지.

**추가·보완할 시험 파일**

- `tests/load/game-load.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/load/game-load.test.ts
node scripts/run-game-load.mjs --stages 1,3,5,10 --final-duration-seconds 1800 --evidence .local/qa/QA-10
pnpm typecheck
pnpm lint
```

**완료 조건**

Cloud 없이 1→3→5→10방의 실제 게임 입력을 실행하고 최종 60클라이언트 30분 이상을 측정한다. 10방 합산 Tick p95≤20ms/p99≤40ms, lag p95≤20ms, 명령 수용 p95≤200ms와 큐/메모리/과부하 무효를 확인한다. G6 통합 통과로 대신 기록하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 60 게임 클라이언트 부하 진단 추가
```

**MR 본문에 채울 변경 사항**

- 실제게임입력·라운드재시작·합산지표를포함한30분진단을추가한다.

**MR 리뷰 포인트**

- Cloud요청0회와진단결과/G6구분을확인한다.

**완료 인계**

- B SV-05·A규칙병목·F DP-05에부하별실측결과를인계한다.
- QA-11에통과한게임단독방수와잔여병목을전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-10.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-15

**QA-09 · [QA] G5 대표 6대 장치 5판 완주**  
일정: D3 2026-09-10 · **오늘 1번**  
기획 근거: v0.0.8 **20, 25, 26 G5장**  
선행 완료 결과: [C-17](c-web-ui.md#c-17) (FL-04, D2), [C-18](c-web-ui.md#c-18) (FL-07, D3), [C-19](c-web-ui.md#c-19) (FL-09, D3), [C-14](c-web-ui.md#c-14) (FL-10, D2), [C-16](c-web-ui.md#c-16) (EX-05, D2), [C-09](c-web-ui.md#c-09) (EQ-11, D2), [C-13](c-web-ui.md#c-13) (VI-04, D2), [C-05](c-web-ui.md#c-05) (VI-05, D2), [F-08](f-infra-qa.md#f-08) (QA-03, D2), [F-09](f-infra-qa.md#f-09) (QA-04, D2), [F-11](f-infra-qa.md#f-11) (QA-05, D2), [F-10](f-infra-qa.md#f-10) (QA-06, D2), [F-12](f-infra-qa.md#f-12) (QA-07, D2), [F-13](f-infra-qa.md#f-13) (QA-08, D2), [E-15](e-media-operations.md#e-15) (OP-08, D2), [F-06](f-infra-qa.md#f-06) (DP-03, D1), [C-02](c-web-ui.md#c-02) (AC-06, D1), [C-12](c-web-ui.md#c-12) (KN-11, D2). 아이템 전용 C-10은 결정 대기로 필수 선행에서 제외한다.

**수정·생성 파일**

- `tests/cloud/mvp-flow.cloud.test.ts`
- `tests/fixtures/manual-six-device.md`
- `scripts/collect-six-device-results.mjs`
- `tests/contracts/six-device-report.test.ts`
- `docs/verification.md`

**구현 순서**

1. 선행ID의코드와G1-A–D·G3·G4·ready·TLS실제결과를확인한다. 하나라도Cloud미실시/핵심기능미완이면5판검증진행여부와선행BLOCKED를분명히표시하고MVP완료라하지않는다.
2. DP-01의실제장치6대·사용자6명·네트워크·중간/하위preset을등록하고공식분/GB예산을확인한다. 테스트동의를받은사용자는촬영/녹음저장없이실시간기능만사용한다.
3. 초대→카메라/마이크독립권한→보정→팀연습→로딩/3초countdown→실제3분경기→결과→같은역할/교대/로비재경기를5판연속실행한다.
4. 5판에 지도 교환·감지기/덫·자연 구속/포획·3포즈/폴백·확정된 과거 교환/감지 사건·개인 종료자 퇴장·게임 연결 상실 안내를 분산 배치한다. 아이템 종류·효과·획득·사용과 전용 음향/해제 사건은 PRODUCT_DECISION_PENDING 별도 목록에 두고 5판 필수 coverage로 강제하지 않는다.
5. 장치별FPS/입력·원격얼굴·근거리음성·오디오중복/재생권한·종료후Track/Worker/Texture/Room수를기록한다. 실패단계/수정commit/재시험판을추적하고중간45fps·하위30fps목표를검사한다.
6. 보조 자동 브라우저 시나리오는 tests/cloud/mvp-flow.cloud.test.ts에서 QA-01 ProbeHarness의 Playwright 브라우저를 사용하며 QA-09 Cloud allowlist로만 실행한다. 기존 tests/e2e에 제품 Cloud 시나리오를 추가하지 않는다. 기본 pnpm verify는 기존 로컬 E2E와 six-device-report의 형식·누락 단위시험만 실행한다.

**연결 계약과 경계**

- 자동E2E는재현가능UI흐름의보조증거이며6대실제장치5판을대체하지않는다.
- 수동 결과 수집기는 장치 id별 5판 증거와 확정된 필수 행동 coverage가 빠지면 nonzero를 반환한다. 결정 대기 아이템은 현재 필수 목록에서 제외하고 미실시/미정으로만 기록한다.
- G5 실장치 완료의 기준 파일은 tests/fixtures/manual-six-device.md에 따른 수동 결과이며 .local/qa/six-device 안에 장치 ID 6개·장치 사양·실측 네트워크·판 ID 5개·행동 coverage·결과·시각·sourceCommit을 기록한다. collect-six-device-results는 실제 기록만 검증하고 빈 칸을 자동 통과로 채우지 않는다. QA-09 Cloud 브라우저 보조 결과만 있어도 G5 PASS를 만들지 않는다.

**시험 입력 → 기대 결과**

- 브라우저6context·물리장치1대→실제6대조건미충족.
- 5판 중 감지기/덫·자연 구속·포즈 필수 행동 누락 → coverage 실패; 미정 아이템 미사용은 실패 항목이 아님.
- 5판째누적Worker/Track/Texture증가→누수실패,재경기완주만으로통과금지.
- 마이크 거부 사용자→카메라 준비·수신 음성·지도 교환/탈출 가능.

**추가·보완할 시험 파일**

- `tests/cloud/mvp-flow.cloud.test.ts`
- `tests/contracts/six-device-report.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/six-device-report.test.ts
node scripts/run-cloud-check.mjs --case QA-09 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-09-browser
node scripts/collect-six-device-results.mjs --input .local/qa/six-device --output .local/qa/QA-09.json
pnpm typecheck
pnpm lint
```

**완료 조건**

초대 입장부터 실제 얼굴·음성·모션·지도 교환·감지기/덫·자연 구속/포획·포즈/폴백·확정된 과거 사건 점을 포함해 6대에서 5판 연속 결과/재경기를 수행한다. 미정 아이템 종류·효과·획득·사용은 필수 coverage에서 제외하고 결정 대기로 기록한다. 중간 평균45fps·하위30fps 목표, 반복 종료의 Room/Track/Worker/텍스처 누수와 입력 오류·사용성을 기록한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 대표 장치 6인 MVP 완주 검증 추가
```

**MR 본문에 채울 변경 사항**

- 필수기능coverage와5판재경기·장치성능·수명누수를검증한다.

**MR 리뷰 포인트**

- 실제장치/사용자수와자동브라우저context수를섞지않는지확인한다.
- 기본 tests/e2e/와 verify에 실제 Cloud 접속이 섞이지 않는지, QA-09-browser 결과와 실제 6대·5판 수동 결과를 구분하는지 확인한다.

**완료 인계**

- A–E에게작업ID별실패단계와재현영상을대신할비민감step로그를전달한다.
- DP-06/QA-11에완주commit과G5증거목록을인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-09.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-16

**DP-06 · [DevOps] Jenkins 배포·배수·실패 복귀**  
일정: D3 2026-09-10 · **오늘 2번**  
기획 근거: v0.0.8 **23, 24장**  
선행 완료 결과: [F-05](f-infra-qa.md#f-05) (DP-02, D1), [F-06](f-infra-qa.md#f-06) (DP-03, D1), [F-04](f-infra-qa.md#f-04) (DP-04, D1), [F-07](f-infra-qa.md#f-07) (DP-05, D2), [E-15](e-media-operations.md#e-15) (OP-08, D2), [F-15](f-infra-qa.md#f-15) (QA-09, D3)

**수정·생성 파일**

- `Jenkinsfile`
- `scripts/deploy-release.mjs`
- `scripts/verify-release.mjs`
- `tests/contracts/deployment-sequence.test.ts`
- `tests/cloud/deployment-smoke.cloud.test.ts`
- `infra/compose.production.yaml`
- `infra/deploy.sh`
- `infra/README.md`
- `infra/jenkins/SETUP.md`
- `docs/verification.md`

**구현 순서**

1. 검증된 전체 commit SHA·웹/서버 두 이미지 digest·이전 정상 release를 입력으로 받고 Jenkins verify 결과와 일치하는지 검사한다. 기존 `infra/deploy.sh`의 임의 TAG에 현재 checkout을 빌드하는 경로를 제거하고 Jenkins·수동 배포 모두 같은 `deploy-release.mjs`를 호출하게 한다. 대상 이미지가 없으면 해당 SHA를 검증·빌드하는 절차로 돌아가며 현재 소스를 이전 SHA 태그로 포장하지 않는다. latest나 8자리 태그만으로 검증 commit을 추정하지 않는다.
2. DP-03의 외부 접근 격리를 활성화하고 일반 이용자의 새 HTTP 세션·매칭·WSS 접속이 차단되는지, 지정한 운영자·6인 시험 경로가 정상 인증 가능한지 확인한다. 기존 게임 연결과 인증된 운영 경로는 유지하여 정상 종료·drain·회수를 방해하지 않는다. 확인 증거가 없으면 BLOCKED로 중단한다. 이 격리는 애플리케이션 admission과 독립이며 이후 resume과 smoke 중에도 유지한다.
3. OPS_TOKEN Bearer로 `POST /api/operations/commands`에 `{requestId,action:'drain'}`을 전송한다. 202 pending은 접수일 뿐이다. 같은 requestId의 `GET /api/operations/commands/:requestId`를 한정된 backoff/기한으로 조회해 succeeded를 확인하고 GET `/api/operations/status`의 DRAINING·미해결 0과 진행 경기·연습·입장 종료/회수 확인을 검사한 뒤 진행한다. pending/failed/기한 초과에는 새 배포·공개 재개를 중단하고 외부 격리와 입장 잠금을 유지한다. requestId를 바꿔 중복 drain을 만들지 않는다.
4. 같은 SHA 이미지로 교체하고 지속 운영 volume/Secret/namespace를 유지한다. 기존 진행 Match를 메모리 스냅샷으로 복원하거나 blue-green 두 권위 서버를 동시에 열지 않는다. E initialize의 initialized 결과 후 HTTP health/운영 경로가 열리며 RECOVERING·LOCKED의 ready 503은 복구 대기 상태로 관찰한다. fatal이면 listen 없이 close한 실패로 처리한다.
5. 이전 세대 Cloud 정리·공식 잔량 정합을 포함한 전체 복구가 끝나 readiness=READY가 되는지 확인한다. admission은 DRAINING을 유지해야 한다. 외부 격리 확인을 유지하고 실제 공개창·검증된 방수·잔량 조건을 검사한 뒤 별도 requestId의 `{action:'resume'}`를 전송한다. GET terminal succeeded와 status의 admission=OPEN/readiness=READY를 모두 확인한다. 미확정 조건을 시험용 값으로 우회하지 않는다.
6. 외부 격리 상태에서 정상 초대·세션·미디어 경로로 지정한 6인 배포 smoke를 수행한다. `deploy-release.mjs`가 격리·resume 성공을 확인한 다음 공통 runner의 DP-06 case로 `tests/cloud/deployment-smoke.cloud.test.ts` 한 파일을 호출한다. 이 case는 F의 기존 ProbeHarness로 실제 1방 6인의 입장·얼굴/음성 연결·게임 입력·종료를 검증하고 외부 일반 참가자는 계속 차단한다. preflight에 DP-06 허용과 1방/6명·준비/시험/회수 시간 및 비용이 있어야 한다. QA-09의 대표 6대 5판 전체 인수와 구분한다. DRAINING 상태에서 6인 입장을 시도하거나 health 연결만으로 완주/G1/G6 증거를 대체하지 않는다. 별도 smoke 운영 action이나 인증·예산 우회 경로를 추가하지 않는다.
7. smoke가 끝나면 시험 세션·방·로컬 트랙을 종료하고 E의 서버 미디어 회수·저널 반영·미해결 0을 확인한다. READY/OPEN·실제 공개창·검증된 방수·잔량을 다시 검사하며 필요하면 실제 공식 잔량 checkpoint를 갱신한다. 남은 시험 활동/회수나 확인 누락·기한 만료가 있으면 외부 격리를 유지한다. 모든 조건이 충족된 뒤에만 F가 외부 격리를 해제하여 공개하고 접근 상태를 확인한다.
8. 실패 시 외부 격리를 유지하거나 즉시 다시 적용한다. resume 이후 실패라면 새 requestId로 다시 drain하고 terminal succeeded·활동 종료·원격 회수 확인을 마친 뒤 이전 이미지 digest로 롤백한다. 초기화/health 장애로 제어·회수를 확인할 수 없으면 ROLLBACK_BLOCKED로 잠금·경보를 유지하며 강제 교체로 기록이나 미해결을 숨기지 않는다. 롤백 이미지도 같은 initialize→복구 READY→격리 중 resume→smoke→정리→공개 장벽을 다시 통과한다.
9. 이 작업 번호를 실행하라는 요청에서는 로컬 Jenkins·NGINX·배포 코드와 실패 시나리오 검증·MR 초안을 완성한다. 실제 Jenkins job 설정/원격 배포는 사용자가 그 외부 실행을 승인했고 연결 환경이 있을 때 수행한다. 계획 검토만으로 배포를 실행하지 않으며, 원격 환경 대기와 로컬 구현 완료를 별도로 기록한다.

**연결 계약과 경계**

- 배포상태={releaseSha,previousDigest,phase:'BLOCKED'|'DRAINING'|'DEPLOYING'|'RECOVERING'|'SMOKE'|'READY'|'ROLLBACK_BLOCKED',reason};원격상태실패를로컬script0종료로숨기지않는다.
- 진행게임복원·DB·다중서버확장추가금지. 최초시험환경은DP-03에서준비하며이작업과순환하지않는다.
- 운영 경로·body·OperationSnapshot/OperationsStatus는 EXEC-CONTRACT-3와 E OP-07을 사용한다. retry-retirement에만 retirementId를 보내며 checkpoint는 추가 payload 없이 구성된 공식잔량 입력의 검증/저장 작업을 요청한다. script는 secret 원문·Authorization 헤더를 출력하지 않고 모든 HTTP/terminal 실패를 nonzero로 전달한다.
- 공식 잔량은 운영자가 실제 Cloud dashboard를 확인한 후 `OPS_DATA_DIR/official-usage-input.json`으로 제공한다. JSON 필드는 `{projectAlias,remainingMinutes,remainingBytes,checkedAtEpochMs,source:'cloud-dashboard',checkedBy}`이며 숫자·계정·확인 시각·확인자를 실제 값으로 채운다. F는 schema/파일 권한/전달 위치만 준비하고 dummy 값을 만들지 않는다. POST checkpoint의 terminal succeeded 뒤 GET status에 같은 확인 시각·잔량이 반영됐는지 검사한다. 미확인/누락/기한 만료면 재개를 막는다.
- 정상 배수는 readiness=READY/admission=DRAINING일 수 있다. 건강 확인과 입장 허용을 같은 boolean으로 만들지 않으며 재개는 READY 확인 후 resume 성공과 OPEN을 별도로 확인한다.
- `OperationsStatus`에는 활동 수 필드가 없다. 배포 runner는 E의 drain terminal succeeded가 `getGameActivity()` 3개 수 0과 회수/저널 확인을 보장한다는 실제 연결 시험을 전제로 사용한다. 상세 활동 수 증거는 E/B의 비민감 관측 기록으로 연결하고 존재하지 않는 HTTP 필드를 읽거나 새 임의 운영 API를 만들지 않는다.
- `infra/deploy.sh`와 Jenkins에 남은 직접 `compose up`·즉시 롤백 우회가 없어야 한다. 두 경로 모두 manifest의 동일 웹/서버 digest 쌍·현재 검증 SHA를 확인하고 같은 외부 격리/배수/회수 장벽을 통과한다. 요청 SHA와 image label 불일치, 웹/서버 이미지 하나 누락, 미해결 회수는 두 경로 모두 배포·태그 재사용·롤백 0의 실패 시험으로 추가한다.
- 외부 격리의 구현·허용 대상·검증·해제는 F 책임이다. 배포 기록에 격리 증거와 OPS admission/readiness를 각각 남기며 Origin 검사를 외부 격리 증거로 사용하지 않는다. 배포상태의 최종 READY는 smoke 정리와 공개 조건 재검사까지 통과한 완료 상태이며 HTTP ready 200만으로 도달하지 않는다. 초기 격리 검증 실패는 BLOCKED로 기록한다.

**시험 입력 → 기대 결과**

- 새SHA와verifySHA불일치→배포0.
- 회수UNRESOLVED→공개재개0·잠금/경보유지.
- 새 이미지 ready 실패 → 외부 격리·입장 잠금 유지, 제어/활동 종료/회수 확인 뒤에만 이전 digest 복귀·복구 장벽 재실행; 확인 불가 → ROLLBACK_BLOCKED.
- 롤백이미지도ready실패→ROLLBACK_BLOCKED·입장잠금유지.
- drain POST 202 + GET pending→이미지 교체 0; GET failed/timeout→nonzero와 입장 잠금 유지.
- resume POST 202 + GET succeeded + admission LOCKED→완료 불일치로 실패, 공개 성공 표시 0.
- 같은 drain requestId 재전송→같은 operationId 추적·B 제어 큐 중복 배수 0.
- 외부 격리의 허용/차단 증거 누락 → BLOCKED·교체/resume/공개 0; READY/DRAINING → 6인 입장 0.
- 외부 격리 유지 + resume terminal succeeded + READY/OPEN → 지정한 6인 시험 가능, 일반 외부 접근은 계속 차단.
- smoke 성공이나 시험 세션/미디어가 남음 또는 UNRESOLVED 1 → 격리 해제 0; 정리 완료 후 공개창·공식 잔량 확인 기한 만료 → 공개 0.
- OPEN 이후 smoke 실패 → 격리 유지·새 drain 완료/회수 확인 후에만 롤백; drain failed/timeout → ROLLBACK_BLOCKED·강제 교체 0.

**추가·보완할 시험 파일**

- `tests/contracts/deployment-sequence.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/deployment-sequence.test.ts
node scripts/deploy-release.mjs --manifest .local/releases/candidate.json --preflight .local/qa/cloud-preflight.json --evidence .local/qa/DP-06
pnpm typecheck
pnpm lint
```

**완료 조건**

외부 접근 격리 확인→drain terminal succeeded와 활동 종료/회수 확인→같은 검증 commit 배포→initialize 결과/후속 복구 READY→격리 유지 상태에서 resume terminal succeeded·OPEN→6인 smoke→시험 세션·미디어 정리→공개창·예산 재검사→외부 격리 해제 순서를 검증한다. checkpoint는 운영자가 제공한 official-usage-input.json을 실제 확인값으로 검증하고 HTTP 202나 ready 200만으로 배포/공개 성공을 표시하지 않는다. 실패는 격리와 재배수·회수 확인 후 롤백하며 이전 이미지도 같은 장벽을 통과한다. 격리·회수 확인이 없으면 BLOCKED/ROLLBACK_BLOCKED로 남기고 진행 매치는 복원하지 않는다. 최초 검증 배포는 DP-03에서 수행한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
ci: Jenkins 배포 배수와 실패 복귀 추가
```

**MR 본문에 채울 변경 사항**

- 외부 격리·검증 commit 배포·미디어 배수·복구 장벽·격리 중 resume/smoke·시험 정리·공개 조건 재검사·실패 복귀 순서를 추가한다.

**MR 리뷰 포인트**

- 롤백이회수저널/예산을되돌리거나권위서버2개를동시에띄우지않는지확인한다.

**완료 인계**

- 운영 담당에게 실제 release/digest·외부 격리 확인/해제 절차·resume과 공개의 별도 조건·시험 정리 증거·미해결 복귀 경로를 전달한다.
- QA-13에배포/롤백실행증거와남은BLOCKED를인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/DP-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-17

**QA-11 · [QA] 실제 미디어 1·3·5방 단계 검증**  
일정: D3 2026-09-10 · **오늘 3번**  
기획 근거: v0.0.8 **02, 22, 26장**  
선행 완료 결과: [F-15](f-infra-qa.md#f-15) (QA-09, D3), [F-14](f-infra-qa.md#f-14) (QA-10, D2), [E-03](e-media-operations.md#e-03) (OP-02, D1), [F-02](f-infra-qa.md#f-02) (QA-01, D1)

**수정·생성 파일**

- `tests/cloud/staged-load.cloud.test.ts`
- `tests/load/MediaLoadScenario.ts`
- `tests/load/media-load.test.ts`
- `scripts/run-media-load.mjs`
- `docs/verification.md`

**구현 순서**

1. QA-09완주·QA-10게임단독결과·G1/ready실제통과commit을확인하고같은빌드로시작한다. 각단계연결분/GB·준비/정리오버헤드를사전예약한다.
2. 1→3→5방에 각 6명의 실제 WebRTC 합성 트랙과 게임 입력을 연결한다. 가청 최단 경로 5→6→7→6→5셀 왕복·회전·한 사람 세대 변경을 분산시키고 idle 연결 대기만 측정하지 않는다. 미허용 6 유지/5 허용/허용 6 유지/7 차단을 모두 관측한다.
3. 각단계동일구간의전체API/429·실효권한지연·합산Tick·lag·bytes/frame표식을기록한다. 실패시다음확대와운영상한상승을막고정리/공식잔량조정을우선한다.
4. 단계종료후모든Identity회수·Room/Track/Worker정리와미해결예약을점검한다. F예산비용이QA-12의900+300을잠식했다면남은한도로재계획하고추가과금으로메우지않는다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- 실제Cloud부하단계는run-media-load 명시명령이며tests/load/media-load.test.ts는스케줄러짧은단위시험이다. 기본verify는Cloud를호출하지않는다.
- scripts/run-media-load.mjs --stages 1,3,5는 QA-11 case를 선택하고 run-cloud-check의 공통 preflight·namespace·예산 검사를 재사용한 뒤 vitest.cloud.config.ts의 staged-load.cloud.test.ts만 호출한다. 실제 단계당 시간은 preflight의 stageDurationSeconds로 필수 지정하며 자동 기본값으로 비용을 소비하지 않는다. 단계 duration·예산·허용 방 수 누락은 nonzero/BLOCKED다.
- tests/load/MediaLoadScenario.ts는 buildScenario()만 export하고 import 때 실행하지 않는다. tests/load/media-load.test.ts는 주입된 가짜 clock·gateway로 유한 fixture만 검사한다. 실제 Cloud 및 경과 시간 대기는 명시적 Cloud case 내부에서만 시작한다.

**시험 입력 → 기대 결과**

- 1방권한지연초과→3방실행0.
- 3방15세션만연결→18세션단계미달표시.
- 5방정리불명1개→다음단계/새grant잠금·예약유지.
- 공식잔량부족→비용시험BLOCKED·가짜클라이언트로Cloud대체없음.

**추가·보완할 시험 파일**

- `tests/cloud/staged-load.cloud.test.ts`
- `tests/load/media-load.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/load/media-load.test.ts
node scripts/run-media-load.mjs --stages 1,3,5 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-11
pnpm typecheck
pnpm lint
```

**완료 조건**

실제 게임·Cloud 송수신·가청 경계 이동을 1→3→5방으로 늘린다. 단계별 예산·전체 API·권한 실효 지연·Tick·수신을 함께 기록하고 실패 시 다음 단계 확대를 보류한다. 아직 검증하지 않은 방 수를 운영 상한으로 열지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 실제 미디어 단계별 수용량 검증 추가
```

**MR 본문에 채울 변경 사항**

- 1·3·5방실제게임/Cloud결합과실패시확대차단을추가한다.

**MR 리뷰 포인트**

- 시험전후공식잔량·예약·회수상태가각단계보고에있는지확인한다.

**완료 인계**

- E/B에게방수별API/지연/Tick병목을전달한다.
- QA-12에검증된5방결과·남은예산·재시험여유를인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-11.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-18

**QA-12 · [QA] G2·G6 10방 60세션 15분 통합**  
일정: D3 2026-09-10 · **오늘 4번**  
기획 근거: v0.0.8 **21, 22, 26.2 G2·G6장**  
선행 완료 결과: [F-17](f-infra-qa.md#f-17) (QA-11, D3), [E-03](e-media-operations.md#e-03) (OP-02, D1), [F-02](f-infra-qa.md#f-02) (QA-01, D1), [F-07](f-infra-qa.md#f-07) (DP-05, D2)

**수정·생성 파일**

- `tests/cloud/ten-room-integrated.cloud.test.ts`
- `tests/load/TenRoomSchedule.ts`
- `tests/load/integrated-summary.test.ts`
- `scripts/run-media-load.mjs`
- `scripts/summarize-integrated-load.mjs`
- `docs/verification.md`

**구현 순서**

1. QA-11의5방통과·실제부하발생기여유·sourcecommit·분/GB를확인한다. 본시험900참가자분+준비/종료/재연결계획300을공식잔량에대조하고bytes도동시에예약한다. 예산/장치가없으면60세션통합미실시로중단한다.
2. 0–3분:10게임Room과1대1로묶은60WebRTC세션에서합성얼굴/음성모두송수신한다. 역할·관계와표식이실제Cloud에연결되는지확인하고연결/초기API집중을계측한다.
3. 3–8분: 10방 모두 실제 이동/회전으로 가청 최단 경로를 5→6→7→6→5셀로 왕복한다. 최초 미허용 상태의 6셀은 차단 유지, 5셀은 허용, 허용 후 6셀은 유지, 7셀은 차단이다. 같은 구간에 게임 입력→E 정책→실제 관리 API→트랙별 새 표식 변화를 연결해 기록한다.
4. 8–11분: 목표 60세션에서 정지쌍 재게시·같은 SID 교체·한 사람 full reconnect를 분산 주입한다. old 회수 뒤 new 발급 사이의 실제 59세션 공백은 시각/길이를 따로 기록하고 중복 연결·새 논리 참가자로 채우지 않는다. 실제 60동시 구간과 전환 구간을 분리 집계하며 기준 미달을 PASS로 완화하지 않는다. 3분 규칙은 유지하고 라운드마다 새 matchId로 재경기한다.
5. 11–15분:동시시작/재경기·탈출/포획·개인종료·전체정리를넣는다. 진행중슬롯충원은금지하고개인종료로60미만이되는구간은초기60동시구간과별도보고한다.
6. 같은정상통합구간에서전체API≤600/60초·429=0·실효허용/차단p95≤500ms/p99≤1000ms·합산Tick/lag/수신목표를동시에판정한다. 참가자별6초폴링으로호출만낮추거나실패표본을정상구간에서삭제하지않는다.
7. 시험뒤회수확인/잔여Room·Track/예약/실제공식분GB를정합하고증거집계기의조건하나라도미달이면G2/G6실패로남긴다. 6대실제대표장치는1실제방에포함가능하며나머지자동브라우저와구분한다.

**연결 계약과 경계**

- 공통 증거는 sourceCommit/lockfileHash/protocolVersion/tuningVersion/SDK·브라우저버전/계정별칭/시각/환경/단계/결과/회수상태로 저장한다. 원본JWT·Secret·rawSDP·사용자얼굴/음성은 로그·trace·HAR·스크린샷에 남기지 않는다. Cloud 자격이나 표본이 없으면 BLOCKED/미실시이며 가짜 skip 성공을 완료로 쓰지 않는다.
- G2/G6의정상구간과G1/G3파괴적SIGKILL/의도적2초정지는별도태그로구분한다. 정상실패를태그변경으로빼지않는다.
- 60동시시간은실측해야한다. 10방제어량을1방수치×10으로추정하지않으며900참가자분산술을청구확정값으로쓰지않는다.
- scripts/run-media-load.mjs --stages 10 --duration-seconds 900 --scenario integrated-v0.0.8는 QA-12 case로 대응하고 동일 preflight를 거쳐 vitest.cloud.config.ts의 ten-room-integrated.cloud.test.ts만 실행한다. 다른 stage/scenario 조합은 거절한다. preflight.maxDurationSeconds는 연결 준비와 본 900초 구간을 포함하고 cleanupAllowanceSeconds를 별도로 두어 회수를 수행한다. 종료 기한을 늘리기 전에 전체 참가자분·GB 예약에 들어오는지 검사한다.
- tests/load/TenRoomSchedule.ts는 순수 일정 데이터/계산만 export한다. integrated-summary.test.ts는 저장된 합성 fixture의 quantile·API 창·세션 coverage만 검사하므로 기본 pnpm verify가 15분을 기다리거나 Cloud 세션을 만들지 않는다.

**시험 입력 → 기대 결과**

- 정상전체API550·p99차단1500ms→G2실패.
- 실효지연통과·정상API650→G2실패,900긴급상한으로합격변경금지.
- 60연결idle·실제이동/정책변경0→G6통합미달.
- 개인종료후54세션→종료구간으로분리보고·진행중대체참가0.
- 15분종료후UNRESOLVED1→정리미완료·공개확대보류.

**추가·보완할 시험 파일**

- `tests/cloud/ten-room-integrated.cloud.test.ts`
- `tests/load/integrated-summary.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/load/integrated-summary.test.ts
node scripts/run-media-load.mjs --stages 10 --duration-seconds 900 --scenario integrated-v0.0.8 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/QA-12
node scripts/summarize-integrated-load.mjs --input .local/qa/QA-12 --output .local/qa/QA-12-summary.json
pnpm typecheck
pnpm lint
```

**완료 조건**

실제 WebRTC 60세션/10게임방을 연결해 이동·가청 경로 5→6→7→6→5셀 왕복·새 SID 게시/같은 SID 교체/한 사람 재연결·재경기/정리를 수행한다. 같은 정상 구간에서 전체 API≤600회/60초·429 없음·실효 지연 p95≤500ms/p99≤1초와 Tick/수신 목표를 동시에 확인한다. 본 시험 900참가자분+준비/정리 계획 300과 GB를 실제 잔량에 대조하며 세션 감소 구간을 구분한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
test: 10방 게임 미디어 통합 수용량 검증 추가
```

**MR 본문에 채울 변경 사항**

- 26.2단계스케줄과G2/G6동일구간복합합격판정을추가한다.

**MR 리뷰 포인트**

- API전체범위·정상구간태그·실측60동시·세션감소구간을확인한다.
- 회수/잔량조정까지시험결과에포함되는지확인한다.

**완료 인계**

- QA-13에G2/G6각합격/실패·원자료요약·실제상한·잔량·미해결을인계한다.
- E/B/D/C병목은각소유자에게재현시나리오로돌린다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-12.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### F-19

**QA-13 · [QA] MVP 관문 보고와 운영 인계**  
일정: D3 2026-09-10 · **오늘 5번**  
기획 근거: v0.0.8 **26, 27장**  
선행 완료 결과: [F-18](f-infra-qa.md#f-18) (QA-12, D3), [F-16](f-infra-qa.md#f-16) (DP-06, D3)

**수정·생성 파일**

- `docs/verification.md`
- `scripts/verify-mvp-evidence.mjs`
- `tests/contracts/mvp-evidence.test.ts`

**구현 순서**

1. 확정 범위의 실제 완료/미완료 commit·로컬 MR 초안·담당 인계와 G1-A–D/G2/G3-A·B·D/G4/G5/G6 증거를 수집한다. 아이템 관련 작업과 G3-C는 PRODUCT_DECISION_PENDING으로 별도 기록하며 원본 122개 ID 전체 완료를 인수 조건으로 강제하지 않는다. 계획 체크박스·원본 fixture 검사·자동 테스트 개수를 제품 구현 완료로 합산하지 않는다.
2. 각관문에sourceSHA/환경/날짜/명령·수동절차/표본수/결과/증거위치/잔여결함을필수로둔다. 누락파일·비어있는결과·다른commit혼합은보고서를실패/미확인으로만든다.
3. 핵심기능미완이면통합중간본,기능/G1–G5완료이나10방미검증이면기능상태와검증된상한을분리한다. 1→3→5→10중실제로통과한상한과공개창/분GB잔량을명시한다.
4. 운영 인계에는 외부 격리 확인→drain 완료/회수→배포→initialize/RECOVERING 관찰→READY→격리 중 resume/OPEN→6인 smoke→시험 세션·미디어 정리→공개창·예산 재검사→격리 해제 순서를 기록한다. 외부 격리 증거와 OPS 상태·시험 정리 증거를 구분한다. 실패 시 격리 유지·재drain/회수 확인 뒤 롤백하고 확인 불가 시 ROLLBACK_BLOCKED로 남기는 절차, UNRESOLVED 재시도·저널 손상·시계 오차·예산 미확인 대응과 담당자를 기록한다. 무DB·무매치 복원·호스트 전체 상실 회수 한계를 명시한다.
5. 보고서에비밀/실제미디어가없는지검사하고추적가능한요약만저장한다. 현재계획문서작성만으로원격배포·Jira완료·공개창오픈을수행하지않는다.

**연결 계약과 경계**

- GateResult={gate,status:'PASS'|'FAIL'|'BLOCKED'|'NOT_RUN'|'PRODUCT_DECISION_PENDING',sourceCommit,environmentRef,evidenceRefs,measuredLimits,defects}; BLOCKED/NOT_RUN/PRODUCT_DECISION_PENDING을 PASS와 합산하지 않는다. 확정 필수 범위의 실패와 아이템 결정 대기를 구분한다.
- 담당별로컬커밋은실제작성자신원·scope없는제목·실제Jira키있으면footer단독줄,AI공동저자없음을인계기록과대조한다. F가다른담당자커밋을재작성하지않는다.

**시험 입력 → 기대 결과**

- G1mock만있고Cloud없음→G1 NOT_RUN/BLOCKED·MVP완료false.
- G5완료/G6미실시→기능상태와검증된방수분리.
- 참조evidence파일없음·다른SHA→관문미확인.
- 남은UNRESOLVED/미확인공식잔량→공개재개조건불충족.
- smoke 성공 + 시험 세션/미디어 정리 증거 누락 또는 외부 격리 미검증 → 공개 완료 판정 0; resume/OPEN만 확인한 기록을 공개 성공으로 합산하지 않음.
- 확정 범위 관문 통과 + 아이템/G3-C 미정 → 확정 범위 결과와 PRODUCT_DECISION_PENDING 목록을 분리, 아이템 완료를 만들거나 122개 전체 완료를 요구하지 않음.

**추가·보완할 시험 파일**

- `tests/contracts/mvp-evidence.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run tests/contracts/mvp-evidence.test.ts
node scripts/verify-mvp-evidence.mjs --input .local/qa --report docs/verification.md
pnpm exec prettier --check docs/verification.md
pnpm typecheck
pnpm lint
```

**완료 조건**

확정 범위 G1–G6 증거·기능 완료·실측 방 수·잔량·미해결 결함·회수/재시작 절차를 한 보고서로 연결한다. 도망자 아이템 및 G3-C의 결정 대기를 별도 표시하고 완료 수·성공률에 넣지 않는다. 확정 범위의 누락/실패를 완료로 표시하지 않으며 핵심 미완성은 통합 중간본, 10방만 미검증이면 기능 상태와 검증된 상한을 분리한다. 현재 계획 작성만으로 공개를 실행하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
docs: MVP 관문 결과와 운영 인계 정리
```

**MR 본문에 채울 변경 사항**

- 관문별실행증거·실측상한·잔량·미해결·운영복구절차를통합한다.

**MR 리뷰 포인트**

- 계획/조사완료와제품/관문통과가분리되어있는지확인한다.
- 일부성능통과로핵심필수기능누락을가리지않는지확인한다.

**완료 인계**

- 팀전원에게미완료작업ID·담당·재현·다음실행조건을전달한다.
- 운영담당에게실제검증상한·잔량확인시각·미해결회수·공개재개조건을금요일오전인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/F/QA-13.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.
