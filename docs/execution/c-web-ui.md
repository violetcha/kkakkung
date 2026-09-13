# C · 웹 화면·3D·게임 UI 실행 문서

작성 기준: 2026-09-08 · 스켈레톤 `d6f8e62` · **EXEC-CONTRACT-3**  
담당 범위: 화면/장면, 개인 정보 표시, 포즈 탈출 UI와 웹 모듈 조립  
원본 작업: **19개** · 리뷰 상대: **D** · 현재 상태: **모두 구현 계획**

이 문서와 [기획서 v0.0.8](../spec/README.md)을 실행 입력으로 사용한다. AI는 기존 코드와 저장소 지침을 직접 읽는다. 팀원에게 다른 담당 문서의 내용을 찾아 오도록 요구하지 않는다. [6인 전체 일정](README.md)은 인계 시점을 확인하는 안내다.

목표는 **9월 8일(화)·9일(수) 핵심 구현, 10일(목) 통합·검증·수정, 11일(금) 오전 MVP 인수**다. 작업 개수는 소요시간이나 완료 보증이 아니다. 선행 작업·실제 Cloud·장치가 준비되지 않은 조건은 완료로 계산하지 않는다.

## 날짜별 오늘 작업표

각 날짜에서 오늘 번호를 1부터 다시 센다. 예를 들어 9월 9일에 “오늘 1번부터 5번”을 요청하면 **D2 표의 1–5번**을 수행한다. `C-01` 같은 고정 번호와 원본 ID는 날짜가 지나도 바꾸지 않는다. 일정 이후에는 날짜 또는 고정 번호를 명시한다.

### D1 · 2026-09-08 화요일

계약·환경과 병렬 구현 기반을 만들고 권위 이동·장치 점검을 연결. 새 원본 작업 4개.

| 오늘 번호 | 고정 번호                | 원본 ID | 완료할 결과                     |
| --------- | ------------------------ | ------- | ------------------------------- |
| 1         | [C-01](c-web-ui.md#c-01) | VI-01   | 흑백 미로·캐릭터 최소 표현 자산 |
| 2         | [C-02](c-web-ui.md#c-02) | AC-06   | 초대 입장과 로비 화면           |
| 3         | [C-03](c-web-ui.md#c-03) | VI-02   | 1인칭 카메라와 행동 시간 보간   |
| 4         | [C-04](c-web-ui.md#c-04) | FL-02   | 장치 점검과 준비 화면           |

### D2 · 2026-09-09 수요일

MVP 핵심 기능을 구현하고 생산자·소비자를 통합. 새 원본 작업 13개.

| 오늘 번호 | 고정 번호                | 원본 ID | 완료할 결과                         |
| --------- | ------------------------ | ------- | ----------------------------------- |
| 1         | [C-05](c-web-ui.md#c-05) | VI-05   | 저사양 렌더·얼굴 송출 프리셋        |
| 2         | [C-06](c-web-ui.md#c-06) | KN-09   | 개인 탐색 미니맵                    |
| 3         | [C-07](c-web-ui.md#c-07) | VI-03   | 공개 지형·벽면과 시야 마스크 렌더링 |
| 4         | [C-08](c-web-ui.md#c-08) | EQ-10   | 장비 선택·설치·가시 표현            |
| 5         | [C-09](c-web-ui.md#c-09) | EQ-11   | 구속 상태 HUD                       |
| 6         | [C-10](c-web-ui.md#c-10) | EQ-12   | 도망자 아이템 표현 — 제품 결정 대기 |
| 7         | [C-11](c-web-ui.md#c-11) | KN-10   | 교환 요청·수락·완료 화면            |
| 8         | [C-12](c-web-ui.md#c-12) | KN-11   | 술래 과거 사건 점 표시              |
| 9         | [C-13](c-web-ui.md#c-13) | VI-04   | 가시 캐릭터의 얼굴·아군 표식        |
| 10        | [C-14](c-web-ui.md#c-14) | FL-10   | 게임 연결 상실과 탭 상태 처리       |
| 11        | [C-15](c-web-ui.md#c-15) | EX-04   | 상체 포즈 판별과 도전 화면          |
| 12        | [C-16](c-web-ui.md#c-16) | EX-05   | 카메라 장애의 키·버튼 도전          |
| 13        | [C-17](c-web-ui.md#c-17) | FL-04   | 역할별 연습 화면 연결               |

### D3 · 2026-09-10 목요일

최종 흐름·실기기·Cloud·부하 검증과 결함 수정. 새 원본 작업 2개.

| 오늘 번호 | 고정 번호                | 원본 ID | 완료할 결과                     |
| --------- | ------------------------ | ------- | ------------------------------- |
| 1         | [C-18](c-web-ui.md#c-18) | FL-07   | 로딩 가림막·카운트다운·경기 HUD |
| 2         | [C-19](c-web-ui.md#c-19) | FL-09   | 개인 종료·팀 결과·재경기 화면   |

D3 결함 수정은 원본 122개 작업의 후속 처리다. 별도 스토리 수를 늘리지 않는다. 수정한 파일 소유자가 검증 후 `fix:` 커밋과 MR 본문을 남긴다. C/F의 신규 D3 항목이 있더라도 같은 날 발견한 자기 소유 결함은 함께 마무리한다.

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

### C의 읽기 범위와 실제 시작점

공통 저장소 지침·요구사항·아키텍처와 이 문서, 정정표, 지정 작업의 기획 근거 장,
[공개 타입](contracts/types.ts)·[fixture](contracts/fixtures.ts)를 읽는다. 다른 담당 실행 문서는
필수 입력이 아니다. 선행 표의 담당 번호는 그 담당에게 요청할 산출물 식별자이며, AI는 공개
export와 아래 수신 조건을 직접 대조한다. 현재 `apps/web/README.md`는 없으므로 없는 파일을
완료 전제로 삼지 않고 [아키텍처](../architecture.md)와 [테스트 가이드](../testing.md)를 사용한다.

| 읽을 실제 소스                                                         | 현재 상태와 이번 작업의 출발점                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/App.tsx`                                             | 개발 Room·legacy input·Canvas를 직접 조립한다. C만 제품 진입과 D facade 연결로 확장한다.                |
| `apps/web/src/app/SessionRuntime.ts` 및 시험                           | 늦은 join 무효화·leave 수명은 구현돼 있다. 제품 인증·명령·미디어 수명 연결은 새 작업이다.               |
| `apps/web/src/features/room/{store,team-snapshot,colyseus-session}.ts` | 공개 전체 상태를 쓰는 개발 adapter다. 제품 private-view의 개인 지식 저장소로 그대로 사용하지 않는다.    |
| `apps/web/src/features/game/scene/WorldCanvas.tsx`                     | 단일 R3F Canvas의 출발점이다. 서버 마스터 맵이나 game-core를 연결하지 않는다.                           |
| `apps/web/src/features/input/InteractionRuntime.ts`                    | D가 만들 공개 facade의 예정 경로다. 없으면 D 내부를 C 폴더에 복제하지 않고 계약 소비 시험부터 진행한다. |

### C/D 조립과 파일 소유권

| 산출물                                                         | 작성자 | 소비·통합 담당과 규칙                                                                                                                |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| App·SessionRuntime·room store·웹 진입점·styles.css             | C      | D/E/B는 직접 수정하지 않는다. C가 제품 Room 및 D runtime을 각각 한 번 조립한다.                                                      |
| `apps/web/src/app/interaction-bridge.ts` 및 `.test.ts`         | C      | C-04에서 생성한다. D의 공개 factory·공개 타입만 import하고 callback→화면과 권위 문맥→setContext를 연결한다.                          |
| `features/input/InteractionRuntime.ts` 및 공개 타입            | D      | C가 새 facade·sensor-types를 중복 생성하거나 D controller를 직접 수정하지 않는다.                                                    |
| 원본/원격 video element·srcObject·track·Worker·AudioContext    | D      | C는 `onLocalPreview`의 element를 DEVICE_CHECK 전용 host에 부착/분리하고 `onFaceTrack`의 video를 texture 입력으로만 읽는다.           |
| preview host·React 화면·VideoTexture·mesh·geometry             | C      | host unmount는 DOM 부착만 제거한다. video pause/stop/srcObject 변경은 D가 담당한다. D의 null callback에서 C texture를 먼저 해제한다. |
| 일반 키·모션·E/F/1/2/Esc listener                              | D      | 제품에서 legacy team/sandbox controller와 동시 기동하지 않는다. C 버튼은 같은 명령 sender를 재사용한다.                              |
| 포즈 도전의 방향키 시퀀스 listener·진행 완료                   | C      | challenge가 있을 때만 등록한다. D는 같은 문맥에서 일반 방향키를 중지하고 Esc 취소만 담당한다.                                        |
| 공통 manifest·lockfile·Vite/TS/ESLint/Playwright 설정·공용 E2E | F      | C는 필요한 의존성·경로·실행 사례를 인계하고 설정을 대신 수정하지 않는다.                                                             |

`interaction-bridge.ts`는 C-04의 산출물이다. C-08/11/13/14/15/17/18/19에서 같은 조립점을
확장하며 기능마다 runtime이나 전송기를 새로 만들지 않는다. 객체 참조는 React 렌더와
분리하고 StrictMode의 기동→정리→재기동에서도 폐기된 runtime을 재사용하지 않는다.

1. C-02는 제품 입장 응답의 playerId와 Room 연결 수명을 고정하고, 메시지 validator·명령
   sender·heartbeat ACK를 연결한다. 토큰은 C의 비영속 메모리에만 둔다.
2. C-04는 D의 모든 callback을 생성 시 등록한다. `onDeviceStatus`와 `onInteractionState`는
   화면 상태로, `onSensors`는 최신 표본 ref와 C 포즈 컨트롤러로, `onLocalPreview`는 preview
   host로, `onFaceTrack`은 C-13 registry로, `onMediaStatus`는 미디어 상태 화면으로 전달한다.
   센서 callback마다 React 전체 화면을 다시 렌더링하거나 원본 프레임을 store에 넣지 않는다.
3. C가 검증한 권위 self·phase·교환·출구와 로컬 mode/pageActive를 한 객체로 만들어
   `setContext`를 갱신한다. 사라진 optional ID는 새 객체에서 제거하고 예전 객체에 덧씌우지
   않는다. `onInteractionState`의 같은 값 echo는 no-op이다.
4. `media-bindings`와 `audio-policy`를 해당 D 메서드로 전달한다. 효과음도
   `AudioPolicy.effects`를 통해 전달하며 별도 사운드 wire나 D 내부 호출을 추가하지 않는다.
   LOBBY/DEVICE_CHECK에서는 grant를 요청하지 않는다. 실제 승인 grant만 `connectMedia`에 준다.
5. C-14/19는 terminal과 입력 잠금을 먼저 설정하고 C의 시간/요청/사건/texture를 정리한 뒤
   D의 종료 Promise와 게임 Room 수명을 조정한다. 개인 결과 대기는 Room 유지, 실제 퇴장은
   Room leave다. 미디어만 교체되면 개인 지도 scope를 지우지 않는다.

### 지정 범위의 선행·완료 판정

| 지정 작업                 | 외부에서 받아야 할 실제 산출물                                                                       | 선행 미완료일 때 검증할 C 범위                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| C-01–03                   | B 세션 생성/참가 validator·Room roster·heartbeat/clock serializer; 이동은 B private-view/self.action | 합성 공개 fixture의 장면·명령 lifecycle·시계 보간. 실제 방 입장/이동 인수는 대기한다.             |
| C-04                      | D 장치·보정·가공 프레임까지 연결한 facade와 B 준비 roster                                            | readiness 순수 함수·bridge 호출/정리 시험. 모델만 로드한 fake를 실제 장치 준비로 표시하지 않는다. |
| C-05                      | F 대표 장치 측정과 D 품질 전환 구현                                                                  | 선택/preset 전달 시험. D-14 실제 송출 전환과 실측 전에는 저사양 성능 인수 대기다.                 |
| C-06–09, C-11–12, C-15–16 | B 실제 개인 뷰/사건/명령 종결 serializer와 D 입력·센서                                               | presenter/controller 경계 시험. A 내부 타입·서버 좌표를 직접 가져와 B 연결을 대신하지 않는다.     |
| C-13–14, C-17–19          | D 미디어 수명·E/B 승인 grant/binding·실제 게임 연결                                                  | 가시성/정리/화면 전이 시험. 실제 Cloud·장치·완주 전까지 관련 인수는 대기한다.                     |
| C-10                      | 사용자 제품 결정                                                                                     | PRODUCT_DECISION_PENDING을 기록하고 요청 범위 다음 번호로 진행한다.                               |

날짜별 순서는 신규 작업의 배치이며 미래 통합까지 같은 날 완료됐다는 뜻이 아니다. 특히
C-03의 실제 이동은 B-14 개인 뷰, C-07의 발견→도전→폐쇄 전체 인수는 C-15,
C-05의 송출 품질 인수는 D-14가 준비된 후 보완한다. 해당 선행을 이번 요청 범위 밖에서
임의 구현하지 않고 [C 인계 기록](handoffs/C.md)에 작업별 localStage·blockedOn·검사·다음
연결 담당을 남긴다. 고정 번호 1–5와 D2 오늘 번호 1–5는 다른 범위다.

현재 Vitest는 Node 환경이며 `.test.ts`를 수집한다. 순수 변환과 주입된 port의 경계는
Vitest로 검증하고 실제 DOM/Canvas/권한/Worker/트랙 시험은 브라우저에서 수행한다. 브라우저
자동화 공용 runner가 없으면 F에게 재현 경로·입력·기대 결과를 인계하며 DOM mock 통과를
브라우저 통과로 세지 않는다. C-04 bridge 시험에는 중복 mount, callback 후 host 재부착,
phase 이탈, 늦은 callback, dispose 후 콜백 0회, 입력 sender 1개를 포함한다.

### C-01

**VI-01 · [FE] 흑백 미로·캐릭터 최소 표현 자산**  
일정: D1 2026-09-08 · **오늘 1번**  
기획 근거: v0.0.8 **03, 15장**  
선행 완료 결과: 문서 내부 선행 없음; 외부 실행 전제는 F-01에서 확인

**수정·생성 파일**

- `apps/web/src/features/game/scene/WorldCanvas.tsx`
- `apps/web/src/features/game/scene/primitives.tsx`
- `apps/web/src/features/game/scene/scene-model.ts`
- `apps/web/src/features/game/scene/scene-model.test.ts`

**구현 순서**

1. 기존 단일 WorldCanvas를 보존하고 고정 grid/박스만 보이던 진단 장면과 제품 장면의 입력 props를 분리한다. 제품 장면에는 작은 합성 fixture만 넣고 서버 마스터 맵을 가져오지 않는다.
2. 벽면은 Cell+side에서 평면 위치/법선을 계산하는 순수 scene-model로 만들고 바닥·흑백 재질·큰 머리/작은 몸 캐릭터를 공유 geometry로 구성한다. runner/tagger는 동일 크기를 쓴다.
3. 세계 셀 크기는 1, scene x=cell.x,z=cell.y, Three y는 높이로 고정한다. 음영/얼굴부착면의 기준만 두고 임의 히트박스·권위 물리 엔진을 추가하지 않는다.
4. geometry/material 소유자가 해제하는 경로를 작성하고 반복 mount/unmount를 실제 브라우저에서 확인한다. 외부 자산을 쓰면 C 소유 features/game/scene/assets/README.md에 출처·라이선스·버전을 기록하고 등록된 파일만 커밋한다.

**연결 계약과 경계**

- EXEC-CONTRACT-3 Cell/Dir와 단일 R3F Canvas 경계를 따른다. game-core/server/content import 금지.
- Scene primitive는 렌더 입력만 소비하고 role은 크기나 충돌 판정을 바꾸지 않는다.

**시험 입력 → 기대 결과**

- 같은 Cell과 dir의 runner/tagger 입력 → 머리·몸 크기와 배치가 동일하다.
- 북/동/남/서 wall side 입력 → 각각 맞는 면의 중심·법선만 생성한다.
- 빈 visible fixture 및 unmount → 전체 미로가 보이지 않고 보유 geometry/material의 해제가 중복 실행되지 않는다.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/scene/scene-model.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/scene/scene-model.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

큰 머리·작은 몸과 양 팀 동일 크기, 흑백 통로·벽의 최소 표현을 단일 R3F Canvas에 구성한다. 외부 자산이면 출처·라이선스·버전을 기록하며 가상의 전체 MVP 맵을 번들에 넣지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 흑백 미로와 캐릭터 기본 장면 구성
```

**MR 본문에 채울 변경 사항**

- 단일 Canvas 안에 셀·벽면·캐릭터 최소 표현을 구성
- scene 좌표와 공용 geometry 수명 기준 추가

**MR 리뷰 포인트**

- 게임 권위·전체 맵을 브라우저에 넣지 않았는지
- 양 팀 크기 일치와 반복 해제 확인 증거

**완료 인계**

- C VI-02/03에 Cell→scene helper와 geometry 소유 기준 전달.
- F QA-02에 합성 장면 진입 방법·primitive 수를 전달하고 브라우저 실측은 별도로 기록.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/VI-01.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/VI-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-02

**AC-06 · [FE] 초대 입장과 로비 화면**  
일정: D1 2026-09-08 · **오늘 2번**  
기획 근거: v0.0.8 **05, 18, 20, 22장**  
선행 완료 결과: [B-07](b-game-server.md#b-07) (AC-02, D1), [B-08](b-game-server.md#b-08) (AC-03, D1), [B-09](b-game-server.md#b-09) (AC-04, D1), [B-10](b-game-server.md#b-10) (SV-06 heartbeat/ACK, D1), [B-13](b-game-server.md#b-13) (AC-05, D1)

**수정·생성 파일**

- `apps/web/src/app/App.tsx`
- `apps/web/src/app/SessionRuntime.ts`
- `apps/web/src/features/room/colyseus-session.ts`
- `apps/web/src/features/room/product-session.ts`
- `apps/web/src/features/room/product-session.test.ts`
- `apps/web/src/features/room/command-lifecycle.ts`
- `apps/web/src/features/room/command-lifecycle.test.ts`
- `apps/web/src/features/room/game-heartbeat.ts`
- `apps/web/src/features/room/game-heartbeat.test.ts`
- `apps/web/src/features/room/store.ts`
- `apps/web/src/features/room/LobbyScreen.tsx`

**구현 순서**

1. URL fragment의 초대를 읽은 즉시 history.replaceState로 제거하고 메모리 상태로만 보관한다. localStorage/sessionStorage·console·에러에 초대/세션 Bearer 원문을 넣지 않는다.
2. POST /api/sessions 요청은 중앙 SessionRequest의 생성/참가 분기를 그대로 사용한다. 방 생성은 {nickname,inviteToken,createRoom:true}로 보내며 roomCode 필드를 넣지 않는다. 기존 방 참가는 {nickname,inviteToken,createRoom:false,roomCode}로 보내고 roomCode가 없으면 요청하지 않는다. 응답은 B의 SessionResponse validator로 검사한다. 제품 kkakkung은 PRODUCT_PROTOCOL_VERSION 0.2.0, 기존 sandbox/개발 adapter는 0.1.0으로 분리한다.
3. 기존 SessionRuntime의 늦은 join 응답 무효화 로직을 제품 연결에도 적용한다. 입장 응답의 playerId와 Colyseus room.sessionId를 혼동하지 않고, 중복 클릭과 입장 중 취소 시 늦게 열린 Room을 닫는다.
4. LobbyScreen은 B의 room-roster에서 6슬롯·방장·입장 실패 code를 렌더링한다. LOBBY에는 LiveKit grant/연결을 요청하지 않고 얼굴 사전 수신 범위와 녹화 미제공 안내를 표시한다.
5. 모든 일회성 명령의 공통 sender에 command-result와 command-outcome을 연결한다. command-result.status=rejected는 큐에 들어가지 않은 최종 접수 거절이므로 해당 requestId pending을 즉시 끝내고 안전 code와 재요청 UI를 표시한다. outcome이나 accepted 이후 조회 타이머를 기다리지 않는다. accepted는 접수이고 이후 outcome의 applied/rejected/canceled가 요청을 종결한다. applied라도 대응 stateVersion의 권위 뷰·사건 전에는 성공 UI를 확정하지 않는다.
6. accepted 후 2초간 outcome이 없으면 request-status {matchId,requestId}를 2초 간격으로 최대 3회 보낸다. request-status-result의 done은 outcome을 적용하고 pending은 재조회한다. unknown/조회 미응답에는 view-resync와 UNCONFIRMED 표시로 spinner를 종료하며 성공·실패 추정이나 자동 재실행을 하지 않는다. 매치 종료·세션 폐기에 타이머와 요청 레지스트리를 비운다.
7. B의 game-heartbeat 수신 validator와 현재 연결의 serverEpoch/matchId/증가 heartbeatSeq 대조를 이 단계에서 연결하고 같은 값을 game-heartbeat-ack로 응답한다. B는 유효 ACK 6초 누락을 종료 사유로 처리하므로 C-14까지 ACK 구현을 미루지 않는다. C-14는 이 모듈에 클라이언트 6초 만료와 D 전체 정리를 확장한다.

**연결 계약과 경계**

- HTTP /api/sessions는 중앙 SessionRequest/SessionResponse를 사용한다. createRoom:true의 roomCode는 금지이고 false의 roomCode는 필수다. 공통 선택 필드 객체 하나로 직렬화하지 않으며 응답의 roomCode로 이후 제품 Room에 입장한다.
- C App/SessionRuntime만 Room을 조립한다. 모든 제품 명령은 연결별 sequence와 UUID requestId를 중앙에서 부여한다. command-outcome, request-status, request-status-result의 타입·fixture는 [중앙 계약](contracts/types.ts)과 [공유 fixture](contracts/fixtures.ts)를 소비하고 독자 응답 형식을 만들지 않는다.
- 제품 입장은 Client.joinOrCreate("kkakkung",{token:sessionToken,roomCode,protocolVersion:PRODUCT_PROTOCOL_VERSION}); B의 roomCode filter와 세션 범위 검사가 실제 방을 정한다.
- 로비는 room-roster {matchId,stateVersion,phase,hostId,players:[{playerId,nickname,ready,connected}]}를 소비한다. ready는 현재 단계 값이고 roster에는 role/좌표/출구가 없다.

**시험 입력 → 기대 결과**

- 유효 fragment와 초대 입장 → 주소에서 초대가 제거되고 6슬롯 로비가 실제 서버 응답으로 열린다.
- 방 생성 선택 → createRoom:true이며 roomCode 키가 없는 요청; B 응답의 새 roomCode로 제품 Room에 입장.
- 기존 방 참가 선택 → createRoom:false와 필수 roomCode를 전송; 누락은 전송 전에 안내하고, 생성 요청에 roomCode를 섞은 잘못된 payload는 B strict schema가 거절.
- 폐기/변조 초대 또는 이미 찬 방 → 안전 code 안내와 미접속 상태, Cloud 호출 0회.
- 입장 요청 뒤 취소 후 늦은 Room 반환 → 해당 Room leave 1회, 현재 로비/세션을 덮어쓰지 않는다.
- accepted 뒤 GameCore rejected/canceled → 해당 requestId pending 해제, 성공 상태 변경 없이 새 사용자 요청 가능.
- 접수 단계 command-result rejected(INVALID_PHASE/QUEUE_FULL 등) → pending 즉시 해제와 안전 code 표시, 새 사용자 요청 가능; outcome 대기·request-status 타이머 없음.
- outcome이 뷰보다 먼저 도착 → 요청 spinner 종결, 대응 stateVersion까지 성공 화면 대기; 늦은 중복 outcome은 재적용하지 않음.
- accepted 뒤 2초 경과 → 상태 조회; done/pending/unknown/미응답을 각각 처리하며 최대 3회 뒤 영구 spinner·자동 재실행 없음.
- 실제 B와 로비를 6초보다 길게 유지 → 2초 heartbeat마다 올바른 ACK가 전송되어 정상 연결 유지; 구 match/구 epoch/중복 seq는 새 생존으로 인정하지 않음.

**추가·보완할 시험 파일**

- `apps/web/src/features/room/product-session.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/room/product-session.test.ts apps/web/src/features/room/command-lifecycle.test.ts apps/web/src/features/room/game-heartbeat.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

fragment 초대를 처리하되 로그·브라우저 영구 저장에 남기지 않는다. 입장 거절 이유·6슬롯·방장 변경을 실제 서버로 확인하고, 얼굴 사전 수신·녹화 미제공 안내를 제공한다. 로비는 Cloud 미연결이다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 초대 기반 입장과 로비 화면 연결
```

**MR 본문에 채울 변경 사항**

- 제품 세션 API·Colyseus 연결·메모리 토큰 수명 연결
- 6인 로비와 초대 오류 안내 구성

**MR 리뷰 포인트**

- fragment/로그/영구 저장의 토큰 잔류 여부
- 실제 B API 통합 결과와 sandbox 0.1.0 보존

**완료 인계**

- B AC-02–05의 SessionRequest 생성/참가 union과 SessionResponse validator, 로비 roster/host fixture를 실제 요청 직렬화 시험에 사용한다. 생성의 roomCode 생략과 참가의 필수 roomCode를 각각 검증한다.
- B의 실제 serializer로 만든 command-outcome/request-status-result를 C lifecycle에 넣어 종결·미확인 fixture를 검증하고 설치·교환·출구 UI가 같은 sender를 재사용하도록 인계한다.
- D에는 승인된 session Bearer 자체를 넘기지 않고 C의 requestMediaGrant/reportMediaStatus 함수를 주입한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/AC-06.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/AC-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-03

**VI-02 · [FE] 1인칭 카메라와 행동 시간 보간**  
일정: D1 2026-09-08 · **오늘 3번**  
기획 근거: v0.0.8 **07, 15장**  
선행 완료 결과: [C-01](c-web-ui.md#c-01) (VI-01, D1), [C-02](c-web-ui.md#c-02) (AC-06 연결, D1), [A-10](a-game-core.md#a-10) (RL-02, D1), [B-10](b-game-server.md#b-10) (SV-06 clock-probe/reply, D1)

통합 인수 선행: [B-14](b-game-server.md#b-14) (KN-04 self/action, D2). D1의 장면·시계 단독 검증과 실제 이동 인수는 별도 기록한다.

**수정·생성 파일**

- `apps/web/src/features/game/scene/WorldCanvas.tsx`
- `apps/web/src/features/game/scene/FirstPersonCamera.tsx`
- `apps/web/src/features/game/scene/action-interpolation.ts`
- `apps/web/src/features/game/scene/action-interpolation.test.ts`
- `apps/web/src/features/room/clock-sync.ts`
- `apps/web/src/features/room/clock-sync.test.ts`
- `apps/web/src/features/room/team-snapshot.ts`

**구현 순서**

1. 서버 self의 cell/dir/action만 받는 sampleAction(action,renderTick)를 작성한다. alpha=clamp((renderTick-startTick)/(endTick-startTick),0,1)로 위치·방향을 계산하고 음수/끝난 행동은 경계에 고정한다.
2. dir 0북/1동/2남/3서를 R3F 시선으로 바꾸며 3↔0 경계 회전도 서버 action의 90도 방향을 따른다. 같은 프레임 React setState를 쓰지 않고 useFrame에서 카메라 ref를 갱신한다.
3. clock-probe/clock-reply 왕복 측정으로 얻은 공통 offset을 사용해 estimatedServerNowMs=performance.now()+offset을 구한다. 서버가 함께 보낸 serverTick/serverTimeMs 앵커에서 renderTick=anchor.serverTick+(estimatedServerNowMs-anchor.serverTimeMs)/50으로 표시 시간을 환산한다. heartbeat의 클라이언트 수신 시각을 오프셋으로 사용하지 않고 로컬 시각으로 권위 좌표·다음 행동을 확정하지 않는다.
4. 기존 team-snapshot의 x-15.5/z-15.5 변환은 제품 adapter에서 제거해 EXEC 좌표와 일치시킨다. legacy 진단 adapter의 화면 이동은 제품 자료와 분리한다.

**연결 계약과 경계**

- Action from/to/startTick/endTick와 Cell→scene x/z 규칙; move 9Tick/turn 6Tick.
- 클라이언트 보간은 권위 셀을 수정하지 않으며 실제 수평 FOV 제한은 VI-03에서 결합한다.
- serverTick은 라운드 생성부터 20Hz로 증가하며 연습 action도 같은 시계를 사용한다. 본 경기 startTick부터 deadlineTick=startTick+3600이고 startAt은 서버 monotonic ms다. C는 중앙 clock-probe/clock-reply 왕복 시각으로 오프셋을 구해 화면만 보간한다. game-heartbeat는 연결 생존 확인에 사용하며 편도 도착 시각을 정밀 시계 오프셋으로 간주하지 않는다.

**시험 입력 → 기대 결과**

- move startTick=10/endTick=19, renderTick=14.5 → 정확히 중간 위치이며 서버 cell은 불변.
- dir=3에서 오른쪽 turn 종료 → dir=0 방향으로 90도 회전하고 270도 장회전이 없다.
- 늦은 패치·renderTick>endTick → to에 고정, 다음 칸으로 추가 외삽하지 않는다.
- 동일 서버 앵커가 편도 지연으로 늦게 도착 → 검증된 왕복 offset으로 같은 서버 시각을 환산하며 수신 시각을 새 원점으로 삼아 이동을 늦추지 않음.
- serverEpoch 변경 또는 유효 probe 표본 없음 → 구 offset 폐기·재측정; 구 서버 시계로 보간하지 않음.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/scene/action-interpolation.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/scene/action-interpolation.test.ts apps/web/src/features/room/clock-sync.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

서버의 from/to/startTick/endTick으로 이동·90도 회전을 보간한다. 웹에서 위치를 확정하거나 지연을 추가 이동으로 보정하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 서버 행동에 맞춘 1인칭 카메라 보간
```

**MR 본문에 채울 변경 사항**

- 이동·회전 action 기반 카메라 샘플러 추가
- 제품 좌표 원점과 진단 adapter 분리

**MR 리뷰 포인트**

- dir 경계 회전과 중간 상태의 권위 불변
- 프레임마다 React 갱신·자유 좌표 전송이 없는지

**완료 인계**

- B RL-02 adapter가 self/visible player action을 제공하는 실제 private-view fixture 인계 필요.
- C VI-03/FL-07과 F에 clock-probe/reply offset·서버 Tick/monotonic 앵커, 코너·왕복·편도 지연·serverEpoch 변경 fixture를 전달한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/VI-02.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/VI-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-04

**FL-02 · [FE] 장치 점검과 준비 화면**  
일정: D1 2026-09-08 · **오늘 4번**  
기획 근거: v0.0.8 **05, 06, 20장**  
선행 완료 결과: [C-02](c-web-ui.md#c-02) (AC-06 세션/명령, D1), [B-12](b-game-server.md#b-12) (FL-01, D1), [D-01](d-vision-media.md#d-01) (IN-01 장치 facade/preview, D1), [D-06](d-vision-media.md#d-06) (IN-06, D1), [D-07](d-vision-media.md#d-07) (ME-01, D1)

**수정·생성 파일**

- `apps/web/src/app/App.tsx`
- `apps/web/src/app/SessionRuntime.ts`
- `apps/web/src/features/game/flow/DeviceCheckScreen.tsx`
- `apps/web/src/features/game/flow/device-readiness.ts`
- `apps/web/src/features/game/flow/device-readiness.test.ts`
- `apps/web/src/app/interaction-bridge.ts`
- `apps/web/src/app/interaction-bridge.test.ts`
- `apps/web/src/features/room/store.ts`

**구현 순서**

1. App에서 D createInteractionRuntime를 한 번 만들고 sendCommand/requestMediaGrant/reportMediaStatus/requestBindingsRefresh와 중앙 callbacks를 연결한다. setContext.role은 서버 self.role을 쓰고 역할 배정 전에는 null로 둔다. requestBindingsRefresh는 media-bindings-refresh로 보내고 D에게 세션 Bearer를 넘기지 않는다. 객체를 render마다 생성하지 않는다.
2. 사용자 버튼에서 startDevices({microphone})의 Promise<DeviceStatus> 완료 후 calibrate를 실행한다. [DeviceStatus](contracts/types.ts)의 camera/vision/calibration/audioPlayback을 화면에 분리해 표시한다. vision ready는 모델 로드·신선한 얼굴 검출·첫 안전 가공 프레임과 살아있는 가공 트랙이 모두 유효한 상태다. microphone off/denied는 준비 실패로 합치지 않는다.
3. DEVICE_CHECK에서 필수 로컬 점검이 유효할 때 READY {ready:true}로 점검 완료를 신고한다. 서버가 원본 웹캠이나 실제 자세의 진위를 독립 증명한다는 의미가 아니다. command-outcome으로 요청 종결을 처리하고 ready 표시는 대응 서버 roster로 갱신한다.
4. DEVICE_CHECK의 장치 장애·준비 취소에는 READY false와 현재 문맥 갱신을 연결한다. 로컬 카메라 미리보기는 화면 안에만 두며 LOBBY/DEVICE_CHECK에서 media grant를 요청하지 않는다.
5. App에 onLocalPreview(element:HTMLVideoElement|null)를 연결하고 D가 소유한 원본 로컬 video를 DEVICE_CHECK 화면에만 부착한다. 다른 phase·unmount·null callback에서는 화면에서 분리하되 C가 원본 track을 stop하거나 video 수명을 대신 관리하지 않는다.

**연결 계약과 경계**

- D facade의 startDevices/calibrate/setContext와 onDeviceStatus/onSensors를 사용; C가 devices 내부를 import해 직접 생성하지 않는다.
- READY strict payload와 B의 6인 준비 상태; 마이크는 선택, 웹캠/가공/보정은 필수.
- D onInteractionState({selectedEquipment,mode})로 선택을 반영한다. C setContext와 동일 값 echo는 no-op 처리해 callback 루프를 막는다.
- onLocalPreview는 로컬 장치 점검 전용이며 onFaceTrack 원격 경로와 분리한다. 가짜 remote trackSid/playerId를 붙이거나 Scene·LiveKit 게시 경로로 넘기지 않는다.

**시험 입력 → 기대 결과**

- camera/vision/calibration/audioPlayback ready·microphone denied → READY true 신고 가능, Cloud 연결은 아직 0.
- 모델만 로드 또는 기본 안전 얼굴만 있음 → vision ready로 오인하지 않고 준비 불가.
- 보정 전 또는 안전 기본 얼굴만 존재 → 준비 버튼 비활성 및 errorCode에 근거한 원인 안내.
- DEVICE_CHECK의 READY true 이후 카메라 ended 또는 취소 → READY false 신고와 서버 roster 확인; 현재 PLAYING의 단순 카메라 장애에는 다른 단계 READY 명령을 보내지 않고 입력 폴백을 유지.
- DEVICE_CHECK의 local preview callback → 점검 영역에서만 표시; phase 전환/null callback → 화면 부착 제거, 원본의 원격 게시 0회.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/flow/device-readiness.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/flow/device-readiness.test.ts apps/web/src/app/interaction-bridge.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

웹캠·얼굴 추적·중립 보정이 충족되어야 준비를 보낸다. 마이크는 선택이며 오디오 재생 권한을 별도 확인한다. 준비 해제·이탈·장치 장애를 서버 상태와 맞춘다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 장치 점검과 서버 준비 화면 연결
```

**MR 본문에 채울 변경 사항**

- D 장치 facade와 C 조립점 연결
- 카메라·보정·오디오·선택 마이크 준비 상태 분리

**MR 리뷰 포인트**

- 준비 우회와 Cloud 조기 연결 여부
- D callback 이름/타입과 실제 브라우저 권한 거부 결과

**완료 인계**

- D IN-01/06/ME-01의 DeviceStatus와 onLocalPreview(element|null)를 그대로 연결한다. 원본 element·track은 D 소유이고 C는 장치 점검 화면의 부착·분리만 담당한다.
- F에 권한 분리/마이크 거부/준비 해제 E2E 시나리오를 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/FL-02.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/FL-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-05

**VI-05 · [FE] 저사양 렌더·얼굴 송출 프리셋**  
일정: D2 2026-09-09 · **오늘 1번**  
기획 근거: v0.0.8 **20, 25, 26장**  
선행 완료 결과: [F-03](f-infra-qa.md#f-03) (QA-02, D1)

**수정·생성 파일**

- `apps/web/src/features/game/scene/quality-presets.ts`
- `apps/web/src/features/game/scene/quality-presets.test.ts`
- `apps/web/src/features/game/scene/WorldCanvas.tsx`
- `apps/web/src/features/game/flow/QualityControl.tsx`
- `apps/web/src/app/App.tsx`

**구현 순서**

1. F QA-02의 장치별 FPS/추론/인코딩/디코딩 기록을 읽고 medium/low 프리셋 표와 변경 이유를 고정한다. 측정 없이 저사양에서 목표를 달성했다고 쓰지 않는다.
2. Canvas DPR·후처리·프레임 빈도만 C에서 조정한다. low 선택은 App이 D setQualityPreset("low")에 전달하고 D가 얼굴 128×128/8fps와 모델 주기를 전환하게 한다.
3. 같은 프리셋 반복 적용은 no-op으로 처리하고 전환 중 Scene 전체 재생성·Room 재입장·원본 영상 게시를 하지 않는다. 얼굴 source 교체가 필요하면 D의 새 source/트랙 대조 경로를 사용한다.
4. 대표 장치에서 medium→low→medium 전환 후 FPS/처리지연/표정 가독성을 비교 기록하고 최종 평균45/30fps 판정은 F QA-09의 조건으로 넘긴다.

**연결 계약과 경계**

- C setQualityPreset 호출, D 내부 구현 소유; renderer/face/model 설정의 version을 함께 기록.
- 원본640×480을 LiveKit으로 대체 송출하지 않는다. 렌더 품질은 서버 시야/이동 속도를 변경하지 않는다.

**시험 입력 → 기대 결과**

- medium→low → Canvas 설정과 D low 요청이 한 번씩 적용된다.
- low 중 동일 선택 반복 → 카메라/Worker/미디어 세대 생성 횟수 증가 없음.
- low→medium, 얼굴 전환 실패 → 안전 얼굴 유지와 오류 보고, raw 게시/시야 확대 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/scene/quality-presets.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/scene/quality-presets.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

초기 계측에 따라 해상도·후처리·추론 주기·얼굴 128×128/8fps 전환을 구성한다. 실제 원본 얼굴 전송 없이 전환하며 fps·처리 지연·품질 변화를 기록한다. 최종 성능은 QA-09에서 판정한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 계측 기반 저사양 렌더 프리셋 적용
```

**MR 본문에 채울 변경 사항**

- 렌더와 D 얼굴·추론 프리셋의 단일 선택 연결
- 대표 장치의 변경 전후 측정 기준 기록

**MR 리뷰 포인트**

- QA-02 실측 근거와 최종 성능 미검증 구분
- 프리셋 변경이 게임 판정·구독 권한을 바꾸지 않는지

**완료 인계**

- D setQualityPreset은 void이며 별도 완료 callback은 없다. UI는 선택한 요청값을 표시하고 호출 반환만으로 실제 송출 전환 성공을 표시하지 않는다. 실제 트랙 설정·수신 표식·장치 측정으로 적용을 검증하고 실패는 기존 DeviceStatus/MediaStatus 경로로 표시한다.
- F QA-09에 프리셋 버전·장치별 측정표와 재현 절차 인계.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/VI-05.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/VI-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-06

**KN-09 · [FE] 개인 탐색 미니맵**  
일정: D2 2026-09-09 · **오늘 2번**  
기획 근거: v0.0.8 **09장**  
선행 완료 결과: [B-14](b-game-server.md#b-14) (KN-04, D2)

**수정·생성 파일**

- `apps/web/src/features/room/product-view.ts`
- `apps/web/src/features/room/product-view.test.ts`
- `apps/web/src/features/room/store.ts`
- `apps/web/src/features/game/map/MiniMap.tsx`
- `apps/web/src/features/game/map/map-draw-model.ts`
- `apps/web/src/features/game/map/map-draw-model.test.ts`

**구현 순서**

1. private-view를 B validator로 검사하고 `(matchId,gameScope.revision,gameScope.gameInstanceId)`를 지식의 범위로 사용한다. 낮은 revision은 폐기하고 같은 revision의 다른 ID/kind는 거절한 뒤 view-resync한다. 더 높은 revision은 현재 권위 phase에 맞는 전체 뷰로만 수용하고 이전 지도·출구·가시 엔티티·사건을 먼저 비운다. 같은 scope에서는 더 큰 stateVersion만 적용하며 knownTerrain/knownActiveExits/visibleEntities를 전체 교체한다.
2. map-draw-model은 floor 셀과 wall의 side별 관찰만 Canvas 명령으로 바꾼다. 고정 월드 방향과 자기 cell/dir 화살표를 쓰며 다른 사람의 현재 위치는 draw 입력에서 제거한다.
3. 도망자에게 허용된 활성 출구만 소유자를 구분해 표시한다. 술래/개인 종료 snapshot에는 출구·생존자 지식을 추측하거나 기존 상세 지도를 계속 노출하지 않는다.
4. Canvas 크기/DPR 변경만 재투영하고 숫자 좌표·격자선·최단 경로·이동 이력은 만들지 않는다. 새 matchId 또는 gameScope 전환에는 지식·출구 캐시를 비운다. 공개 phase 변경을 관측하면 개인 화면을 즉시 비우고 그 stateVersion을 하한으로 두어 오래된 개인 뷰를 적용하지 않는다. B는 같은 scope/내용이어도 phase 전환 때 하한 이상인 전체 뷰를 한 번 발행한다. 전환 뒤 적합한 전체 뷰가 없으면 최대 1초의 독립 타이머 후 view-resync하며 미래 보류 뷰가 없어도 동작하게 한다. 아직 공개 상태가 따라오지 않은 미래 뷰는 최신 한 개만 최대 1초 보류하고, 맞는 phase/버전이 오지 않으면 폐기·resync한다. `kind:none` 뷰의 지도·가시 배열은 모두 비어 있어야 하며 이 전환도 화면 초기화로 반영한다.

**연결 계약과 경계**

- private-view는 replace이며 `gameScope:GameViewScope`가 논리 연습/본 경기 지식을 구분한다. mapVersion은 같은 scope의 지식·활성 출구 변경, stateVersion은 같은 match에서 연속되는 권위 버전이다. 벽은 side 단위다. 새로운 scope의 mapVersion을 이전 scope의 지식에 합치지 않는다.
- 서버 whole map·seed를 받지 않고 자기 위치는 self의 권위 값을 쓴다.
- ActiveGameScope는 `{gameInstanceId,kind:practice|game,revision}`이고 none은 `{gameInstanceId:null,kind:none,revision}`이다. kind와 권위 phase의 대응은 공통 계약을 그대로 사용한다. MediaScope의 mediaInstanceId/receiverGeneration은 이 키를 대신하지 않으며 미디어만 재연결되면 지식은 유지한다.
- phase 전환 타이머는 적합한 현재 전체 뷰 수신 시 해제하고 다음 phase/match 전환에는 이전 타이머를 취소한다. B의 resync는 현재 권위 stateVersion으로 다시 직렬화하므로 전환 하한보다 오래된 cached version을 그대로 수용하지 않는다. 여러 resync 사유는 연결별 rate limit에 맞춰 합친다.

**시험 입력 → 기대 결과**

- 닫힌 출구가 빠진 새 전체 뷰 → 이전 출구 표식 즉시 제거.
- 북면만 알려진 wall → 북면만 그리며 나머지 세 면을 추론하지 않는다.
- 구match/낮은stateVersion 뷰 또는 visible player 좌표 → 현재 지도 불변/타인 아이콘 없음.
- 같은 match의 연습 revision 1 → 빈 none revision 2 → 본 경기 revision 3 → 각 전환에 이전 지도/출구/사건을 폐기하고, 뒤늦은 revision 1 뷰는 본 경기 지식에 합쳐지지 않는다.
- 같은 revision의 다른 gameInstanceId 또는 kind → 적용 0·resync; 미래 scope 뷰만 도착 → 최신 1개/1초 이내 보류, 권위 phase가 맞기 전 전환 0.
- phase 전환 하한보다 오래된 초기 뷰 → 폐기·resync로 현재 전체 뷰를 다시 확보; 미디어 receiverGeneration만 변경 → gameScope와 지식 유지.
- 같은 gameScope의 GAME_LOADING→COUNTDOWN + 개인 내용 불변 → B의 전환 full view로 화면 복구; 전환 뷰와 미래 보류 뷰가 모두 없으면 1초 이내 resync 요청, 현재 stateVersion의 재직렬화 뷰로 복구.

**추가·보완할 시험 파일**

- `apps/web/src/features/room/product-view.test.ts`
- `apps/web/src/features/game/map/map-draw-model.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/room/product-view.test.ts apps/web/src/features/game/map/map-draw-model.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

고정 방향 Canvas 지도에 허용 지형·자기 위치·활성 출구만 표시한다. 타인 현재 위치·숫자 격자·이동 이력·최단 경로는 표시하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 지식 기반 미니맵 구성
```

**MR 본문에 채울 변경 사항**

- 개인 뷰의 버전·전체 교체 저장 경로 추가
- 벽면 관찰과 활성 출구만 반영하는 고정 지도 구현

**MR 리뷰 포인트**

- 출구 폐쇄 필터와 구판 메시지 적용 방지
- 타인 위치·숫자 격자·전체 맵 누출 여부

**완료 인계**

- B KN-04에서 visibleCells/visibleWallFaces와 knownTerrain.wall.side를 포함한 확정 fixture를 받아 적용한다.
- F G4에 role별 실제 초기/변경/resync payload와 지도 결과 비교 사례 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/KN-09.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/KN-09.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-07

**VI-03 · [FE] 공개 지형·벽면과 시야 마스크 렌더링**  
일정: D2 2026-09-09 · **오늘 3번**  
기획 근거: v0.0.8 **08장**  
선행 완료 결과: [C-03](c-web-ui.md#c-03) (VI-02, D1), [B-14](b-game-server.md#b-14) (KN-04, D2)

**수정·생성 파일**

- `apps/web/src/features/game/scene/VisibleTerrain.tsx`
- `apps/web/src/features/game/scene/VisibleExits.tsx`
- `apps/web/src/features/game/scene/visible-exit-model.ts`
- `apps/web/src/features/game/scene/visible-exit-model.test.ts`
- `apps/web/src/features/game/scene/visibility-mask.ts`
- `apps/web/src/features/game/scene/visibility-mask.test.ts`
- `apps/web/src/features/game/scene/FirstPersonCamera.tsx`
- `apps/web/src/features/game/scene/WorldCanvas.tsx`

**구현 순서**

1. 현재 visibleCells/visibleWallFaces를 knownTerrain와 분리해 사용한다. 지식에 남았다는 이유만으로 현재 시야 밖 미로 면을 그리지 않는다.
2. 각 공개 벽면의 단면만 생성하고 불투명 면/안개로 미공개 영역을 막는다. 코너 보간 프레임에 다음 패치의 미공개 셀이 필요해도 전체 맵을 요청하거나 캐시에서 보완하지 않는다.
3. viewport aspect에 따라 verticalFov=2*atan(tan(80도/2)/aspect)를 계산해 수평 80도를 고정하고 3셀 제한을 공개 마스크와 함께 적용한다. 단일 카메라의 projection matrix를 크기 변경 시 갱신한다.
4. knownActiveExits와 현재 visibleWallFaces를 벽 좌표·side로 교차해 관찰 가능한 출구만 VisibleExits에 렌더링한다. 포털과 ownerId의 허용 소유자 식별을 표시하고 술래·시야 밖 기억 출구는 월드에 표시하지 않는다. 출구 폐쇄 시 포털·소유자 표시를 제거하고 동일 벽면을 일반 벽으로 복원한다.
5. 순수 mask/출구 helper와 실제 브라우저에서 화면비·코너 왕복·이동/회전 중 지연을 확인한다. B의 실제 projection으로 발견→월드 포털→C EX-04 도전→폐쇄의 연결을 검사한다.

**연결 계약과 경계**

- 서버가 계산한 현재 FOV 마스크+Action을 소비하며 클라이언트 자유 FOV/좌표를 서버에 제출하지 않는다.
- knownTerrain 누적과 visibleCells/visibleWallFaces 현재 집합을 혼합하지 않는다.

**시험 입력 → 기대 결과**

- known floor지만 visibleCells에 없음 → 현재 3D 렌더 없음, 미니맵 기억만 유지.
- 화면비16:9→32:9 → 수평 FOV80도 유지, 추가 서버 비공개 셀 노출 없음.
- 회전 중 다음 면이 아직 미공개 → 안개 유지, 뒤쪽 wall face 자동 생성 없음.
- 기억한 출구의 벽면이 시야 밖 → 미니맵 기억만 유지, 포털·소유자 월드 표시 없음.
- 관찰 중 자기/다른 도망자 출구 → 해당 벽면 포털·소유자 표시; owner 포획/탈출 뒤 새 뷰 → 일반 벽 복원.
- 술래 projection의 출구 집합 없음 → 위치 추정이나 포털 생성 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/scene/visibility-mask.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/scene/visibility-mask.test.ts apps/web/src/features/game/scene/visible-exit-model.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

개인 projection의 현재 가시 지형·벽면과 활성 출구 포털·소유자 식별을 그린다. 기억 출구의 벽 너머 렌더링을 막고 폐쇄 시 일반 벽을 복원한다. 실제 B 뷰로 발견→월드 표시→C EX-04 도전→폐쇄와 화면비·코너·보간의 시각 정합을 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 시야 마스크로 미로 노출 제한
```

**MR 본문에 채울 변경 사항**

- 관찰 지식과 현재 가시 렌더 집합 분리
- 수평 FOV 고정과 보간 중 미공개 영역 가림
- 현재 관찰 출구의 포털·소유자 표시와 폐쇄 시 일반 벽 복원

**MR 리뷰 포인트**

- 코너/넓은 화면/지연 브라우저 재현 결과
- 공개 벽면 뒤의 geometry 생성 여부

**완료 인계**

- B KN-04에 필요한 현재 가시 마스크 fixture를 재확인하고 누락 필드를 C가 추정하지 않는다.
- F QA-08에 코너·화면비와 출구 발견→포털→도전→폐쇄의 실제 브라우저·패킷 검사 입력을 제공한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/VI-03.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/VI-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-08

**EQ-10 · [FE] 장비 선택·설치·가시 표현**  
일정: D2 2026-09-09 · **오늘 4번**  
기획 근거: v0.0.8 **12장**  
선행 완료 결과: [A-23](a-game-core.md#a-23) (EQ-01, D2), [A-24](a-game-core.md#a-24) (EQ-02, D2), [A-26](a-game-core.md#a-26) (EQ-04, D2), [C-07](c-web-ui.md#c-07) (VI-03, D2), [D-11](d-vision-media.md#d-11) (IN-09, D1)

**수정·생성 파일**

- `apps/web/src/features/game/equipment/EquipmentHud.tsx`
- `apps/web/src/features/game/equipment/equipment-presenter.ts`
- `apps/web/src/features/game/equipment/equipment-presenter.test.ts`
- `apps/web/src/features/game/scene/EquipmentObjects.tsx`
- `apps/web/src/app/App.tsx`

**구현 순서**

1. self의 sensor/trap 잔량과 현재 installationId/progress를 읽고 슬롯1/2·설치·취소 버튼을 만든다. 선택은 D setContext.selectedEquipment에 보내고 실제 명령은 공통 sendCommand 경로를 사용한다.
2. INSTALL {kind}와 INSTALL_CANCEL {installationId}를 보내며 accepted만으로 수량을 차감하지 않는다. command-outcome으로 각 요청 pending을 종결하고 실제 잔량·설치10Tick/무장20Tick은 대응 self로 표시한다. outcome 누락에는 공통 request-status/UNCONFIRMED 경로를 사용한다.
3. visibleEntities의 sensor/trap만 Scene에 그린다. visible sensor는 필수 wall{x,y,side}로 부착 면을 정하고 cell은 접근 셀로 사용한다. 다른 사람이 설치한 sensor도 현재 허용된 wall만 읽으며 자기 ownedEquipment를 대신 조회하거나 dir를 임의로 벽면으로 해석하지 않는다. 설치자 기억은 self.ownedEquipment에만 별도 표시하고 SPENT를 구분한다.
4. 장비가 출구와 가까울 때 클릭/키 상호작용 우선순위를 출구 안내와 충돌하지 않게 배치한다. 설치 거절 이유는 B의 공개 code만 보여 출구 유무를 추정하는 문구를 만들지 않는다.

**연결 계약과 경계**

- INSTALL/INSTALL_CANCEL strict payload, selectedEquipment와 installationId는 D context 필드.
- 장비 위치·잔량·진행은 B private-view/self·event 확인 뒤 표시한다. 설치자 기억은 공통 self.ownedEquipment를 사용하며 다른 payload를 새로 협의하지 않는다.
- [중앙 계약](contracts/types.ts)의 ActiveSelf/EndedSelf/PrivateView를 소비한다. equipment/ownedEquipment·구속·설치·교환 방향·challenge·loading은 해당 판별 타입대로 읽고 별도 alias나 보류 아이템 필드를 추가하지 않는다.

**시험 입력 → 기대 결과**

- 설치 accepted 후 완료 전 취소 → 로컬 임의 차감 없이 서버 잔량 유지와 설치 UI 제거.
- 타 술래의 시야 밖 장비 → Scene/미니맵 자동 표식 없음.
- 자기 소유가 아닌 가시 sensor의 서로 다른 wall.side → 각 정확한 부착 면에 표시; wall 누락 payload는 validator 거절.
- 설치 accepted 뒤 규칙 거절 outcome → pending 해제, 잔량·월드 객체 변경 없음.
- 출구 접근 셀에 가시 장비 → 출구 버튼/안내 접근 가능, 장비가 상호작용을 가리지 않는다.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/equipment/equipment-presenter.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/equipment/equipment-presenter.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

슬롯·잔량·설치/취소·무장을 서버 응답으로 표시한다. 실제 가시 장비는 양 팀이 볼 수 있고 설치자 개인 표식만 제공하며 전체 팀 설치 위치·도망자 지도 자동 표시는 없다. 출구 상호작용을 가리지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 술래 장비 선택과 설치 화면 연결
```

**MR 본문에 채울 변경 사항**

- 장비 잔량·설치/취소·무장 상태의 서버 연동
- 가시 장비와 설치자 개인 기억 표시 분리

**MR 리뷰 포인트**

- accepted와 설치 완료 구분·취소 시 잔량
- 출구 은폐와 상호작용 겹침 처리

**완료 인계**

- B가 KN-04에서 제공하는 self.installation·self.ownedEquipment와 실제 표시를 연결한 결과를 인계한다.
- D IN-09에 선택1/2·취소 intent와 설치 ID 변경 fixture를 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/EQ-10.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/EQ-10.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-09

**EQ-11 · [FE] 구속 상태 HUD**  
일정: D2 2026-09-09 · **오늘 5번**  
기획 근거: v0.0.8 **07, 12장**과 아이템 세부 기획 미정이라는 최신 결정  
선행 완료 결과: [A-27](a-game-core.md#a-27) (EQ-05, D2), [B-14](b-game-server.md#b-14) (KN-04, D2)

**수정·생성 파일**

- `apps/web/src/features/game/equipment/RestraintHud.tsx`
- `apps/web/src/features/game/equipment/restraint-presenter.ts`
- `apps/web/src/features/game/equipment/restraint-presenter.test.ts`
- `apps/web/src/app/App.tsx`

**구현 순서**

1. B private-view의 self.restraintUntilTick와 restraintImmuneUntilTick를 읽어 구속·해제 후 면역의 남은 시간을 표시한다. 서버 Tick을 표시용으로 환산하고 로컬 0초만으로 권위 상태를 변경하지 않는다.
2. 구속 중 새 이동 불가와 회전 가능을 안내한다. 자연 만료·포획·개인 종료·새 매치의 실제 self 갱신으로 문구와 시간을 바꾼다. 이미 완료한 이동을 되돌리거나 포획을 취소하지 않는다.
3. 서버가 구속 해제와 면역 종료를 반영하면 해당 표시를 제거하고, 이미 소모된 덫을 복구하지 않는다. 아이템 슬롯·사용 버튼·도구 효과를 이 작업에 추가하지 않는다.
4. B가 실제 직렬화한 구속·자연 해제·면역·개인 종료 뷰를 presenter에 넣어 표시와 정리를 검사한다.

**연결 계약과 경계**

- EXEC-CONTRACT-3의 self.restraintUntilTick/restraintImmuneUntilTick와 serverTick를 사용한다. 새 클라이언트 명령이나 별도 구속 판정을 만들지 않는다.
- 활성 범위는 구속 HUD뿐이다. 아이템의 제품 결정 대기는 C-10에서 추적하며 자연 해제·술래 장비 검수는 유지한다.

**시험 입력 → 기대 결과**

- 구속 중 이동 입력/회전 입력 → HUD는 새 이동 불가·회전 가능을 안내하며 위치나 포획을 낙관적으로 바꾸지 않는다.
- 표시 잔여시간 0이나 권위 갱신 미도착 → 표시용 대기 상태 유지, 로컬 구속 해제·새 명령 생성 없음.
- 서버 자연 해제와 면역 Tick 갱신 → 구속 표시 해제, 면역 표시 후 종료; SPENT 덫 복원 없음.
- 구속 중 개인 종료 또는 새 matchId → 이전 구속·면역 표시와 timer 제거.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/equipment/restraint-presenter.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/equipment/restraint-presenter.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

실제 B 뷰를 통해 구속·자연 해제·면역·개인 종료 표시를 검증한다. 아이템 미정 범위의 완료로 확대하지 않는다. 검사 실패나 미통합 선행은 그대로 기록한다.

**작업 완료 커밋 제목**

```text
feat: 서버 구속과 자연 해제 상태 HUD 연결
```

**MR 본문에 채울 변경 사항**

- 서버 구속·자연 해제·면역 시간 표시
- 개인 종료·매치 전환의 상태 정리

**MR 리뷰 포인트**

- 표시 시간이 권위 구속·포획을 변경하지 않는지
- 회전 허용·자연 해제·면역·소모 덫 상태가 일치하는지

**완료 인계**

- A EQ-05와 B KN-04의 실제 구속·자연 해제 fixture를 소비해 F의 장비 검수에 인계한다.
- 실행 후 실제 검사 결과·commit SHA·미통합 선행을 `.local/mr/C/EQ-11.md`의 다섯 항목에 기록한다. 현재 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/EQ-11.md`에 작성하고 해당 날짜의 합본에도 반영한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-10

**EQ-12 · [FE] 도망자 아이템 월드 표현 — 제품 결정 대기**  
일정: D2 2026-09-09 · **오늘 6번**  
실행 상태: **PRODUCT_DECISION_PENDING**  
기획 근거: 도망자 아이템 세부 기획은 미정이라는 최신 사용자 결정이 v0.0.8 13장의 기존 기본안보다 우선한다.  
선행 완료 결과: 없음. 승인된 아이템 결정이 생기기 전 실행할 제품 작업이 아니다.

**현재 실행 범위**

제품 코드를 생성하거나 시험용 콘텐츠를 제품 경로에 넣지 않는다. 원본 ID EQ-12와 고정 번호 C-10은 추적용으로 유지한다. 이 항목을 구현 완료·통합 통과·MVP 인수 완료로 계산하지 않는다.

**재개에 필요한 결정**

1. 아이템 종류·효과·획득·소지·사용 방식과 월드 표현을 사용자가 확정한다.
2. A·B가 승인된 기획의 상태·명령·가시성·사건 계약을 EXEC-CONTRACT에 반영하고 C·D·F가 함께 검토한다.
3. 결정된 범위로 수정 파일·작은 구현 단계·실제 연결 시험·인수 조건과 선행 작업을 다시 작성한 뒤 재개한다.

**인계와 완료 판정**

결정 대기 상태와 승인된 결정의 링크만 진행 기록에 남긴다. 이 상태에는 제품 실행 명령, 기능 완료 커밋 제목, 성공한 MR 본문을 만들지 않는다. 술래 장비·구속의 자연 해제·지도 교환·출구·미디어 작업은 각 기존 항목에서 계속 진행한다.

### C-11

**KN-10 · [FE] 교환 요청·수락·완료 화면**  
일정: D2 2026-09-09 · **오늘 7번**  
기획 근거: v0.0.8 **06, 09장**  
선행 완료 결과: [A-21](a-game-core.md#a-21) (KN-07, D2), [C-06](c-web-ui.md#c-06) (KN-09, D2), [D-11](d-vision-media.md#d-11) (IN-09, D1)

**수정·생성 파일**

- `apps/web/src/features/game/map/ExchangePanel.tsx`
- `apps/web/src/features/game/map/exchange-presenter.ts`
- `apps/web/src/features/game/map/exchange-presenter.test.ts`
- `apps/web/src/app/App.tsx`

**구현 순서**

1. 현재 visibleEntities의 가시 아군 중 자신을 제외해 요청 후보를 만들고 기존 선택 유지, 없으면 제곱 거리·playerId 순으로 정한다. 이는 요청 후보이며 실제 자격은 서버가 검사한다. self.exchange의 fromPlayerId/toPlayerId/direction으로 요청자는 대기·취소, 수신자는 수락·취소 UI를 구분한다. D에는 incoming일 때만 incomingExchangeId를, outgoing일 때만 outgoingExchangeId를 주고 반대 ID는 지운다.
2. EXCHANGE_REQUEST/ACCEPT/CANCEL을 공통 sender로 보낸다. command-outcome의 종결과 대응 stateVersion private-view/EXCHANGE_COMPLETED를 구분해 기다리고, 접수·적용 응답만으로 지식을 union하지 않는다. outcome이 없으면 공통 상태 조회와 UNCONFIRMED 경로를 사용한다.
3. 거리 이탈·포획·탈출·2초 기한·취소의 서버 종료를 조용히 반영한다. 새로운 교환으로 바뀌면 과거 버튼 핸들러의 exchangeId를 무효화한다.
4. 미래 stateVersion 이벤트는 공통 개인 사건 큐에서 해소 후 UI에 반영한다. 허용된 A→B→C 릴레이와 새 정보 없음 거절을 실제 B 서버로 확인한다.

**연결 계약과 경계**

- 교환 세션은 참가자당 1개. 서버 대상 ID만 사용하고 클라이언트 거리로 교환을 승인하지 않는다.
- EXCHANGE_ACCEPT {exchangeId}는 incoming일 때만 가능하다. 요청자의 outgoingExchangeId는 수락 권한을 뜻하지 않는다. D E/손바닥과 C 버튼에 동일한 방향 조건을 적용한다.
- [중앙 계약](contracts/types.ts)의 ActiveSelf/EndedSelf/PrivateView를 소비한다. equipment/ownedEquipment·구속·설치·교환 방향·challenge·loading은 해당 판별 타입대로 읽고 별도 alias나 보류 아이템 필드를 추가하지 않는다.

**시험 입력 → 기대 결과**

- 요청만 전송하고 수락 없음 → 요청자는 대기/취소만, 수신자만 수락 가능; 지도 불변, 2초 후 서버 세션 종료.
- 같은 exchange의 양쪽 self projection → 서로 다른 incoming/outgoing UI; 요청자 E가 EXCHANGE_ACCEPT를 보내지 않음.
- accepted 뒤 규칙 거절 → 해당 요청 pending 종료, 실패 요청으로 과거 지도/교환 복원 없음.
- 서로 다른 두 요청·늦은 구exchangeId 수락 → 현재 승인 쌍만 표시하고 낡은 버튼은 실행되지 않는다.
- 성공event보다 private-view 늦음 → 미래 큐에 대기 후 버전 일치 시 지도 갱신.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/map/exchange-presenter.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/map/exchange-presenter.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

실제 교환 세션에 맞춰 요청·2초 수락·취소·완료를 표시한다. 성공 응답과 지식 버전을 받은 뒤 지도에 반영하며 요청만으로 합집합을 표시하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 지도 교환 요청과 수락 화면 연결
```

**MR 본문에 채울 변경 사항**

- 교환 세션 UI와 D 문맥 연결
- 서버 성공·지식 버전 이후 지도 반영

**MR 리뷰 포인트**

- 요청만으로 정보 유출/로컬 union이 없는지
- 수락 우선순위와 취소/기한/중복 처리

**완료 인계**

- B KN-05–07에 대상후보/self교환 필드와 종료 event 타입을 확인한다.
- D IN-09에 incomingExchangeId/outgoingExchangeId 교체·삭제와 이전 palm hold 폐기 fixture를 전달한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/KN-10.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/KN-10.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-12

**KN-11 · [FE] 술래 과거 사건 점 표시**  
일정: D2 2026-09-09 · **오늘 8번**  
기획 근거: v0.0.8 **09, 12장**  
선행 완료 결과: [A-22](a-game-core.md#a-22) (KN-08, D2), [C-06](c-web-ui.md#c-06) (KN-09, D2), [A-24](a-game-core.md#a-24) (EQ-02, D2), [A-26](a-game-core.md#a-26) (EQ-04, D2)

**수정·생성 파일**

- `apps/web/src/features/room/private-events.ts`
- `apps/web/src/features/room/private-events.test.ts`
- `apps/web/src/features/game/map/past-event-markers.ts`
- `apps/web/src/features/game/map/past-event-markers.test.ts`
- `apps/web/src/features/game/map/MiniMap.tsx`

**구현 순서**

1. private-event의 matchId/gameScope/eventId/tick/stateVersion을 검사한다. 현재 ActiveGameScope와 일치하는 사건만 현재 지식에 적용하고 과거 revision은 즉시 폐기한다. 같은 revision의 다른 ID/kind는 거절·resync한다. 아직 도착하지 않은 미래 scope/뷰의 사건은 합계 최대 64개/1초만 보관하며 초과·불일치 시 폐기·view-resync한다. 사건만으로 scope를 전환하지 않는다. 중복 캐시와 보류 큐는 scope별로 분리한다.
2. HUNTER_MARKER의 showAtTick부터 expiresTick까지만 점을 그린다. 교환은 성공 1초 뒤부터 2초 동안, 감지기/덫도 서버가 지정한 기간만 표시한다. point는 0.5 단위 중점이 가능한 TracePoint이므로 정수 Cell로 반올림하지 않는다.
3. 안개 속 사건점 주위에 지형·경로·플레이어 신원을 생성하지 않는다. 현재 위치 추적처럼 점을 움직이지 않고 서버가 공개한 과거 지점을 고정한다.
4. 논리 scope 전환·재경기·개인 종료·실제 퇴장 시 이전 marker/event queue를 비운다. 다음 scope용으로 보류한 사건도 해당 전체 뷰가 도착하고 같은 scope/stateVersion이 확인된 뒤에만 적용한다. 이미 expiresTick이 지난 사건은 도착 시부터 2초를 다시 시작하지 않고 폐기한다.

**연결 계약과 경계**

- eventId는 공개 스키마의 불투명 식별자로 사용하고 내부 형식을 분해하지 않는다. 외부 봉투의 `gameScope:ActiveGameScope`를 함께 검증한다. 미래 scope/뷰 사건 큐는 합계 64개/1초이고 개인 view-resync는 B rate limit 계약을 따른다. none에는 개인 게임 사건을 적용하지 않는다.
- 과거점 payload는 B가 허용한 위치 사건이며 visibleEntities 현재 위치와 분리.
- HUNTER_MARKER={markerId,kind:"exchange"|"sensor"|"trap",point:TracePoint,occurredTick,showAtTick,expiresTick}; point는 두 셀 중심의 중점으로 0.5 단위가 가능하며 정수 Cell로 반올림하지 않는다.
- serverTick은 라운드 생성부터 20Hz로 증가하며 연습 action도 같은 시계를 사용한다. 본 경기 startTick부터 deadlineTick=startTick+3600이고 startAt은 서버 monotonic ms다. C는 중앙 clock-probe/clock-reply 왕복 시각으로 오프셋을 구해 화면만 보간한다. game-heartbeat는 연결 생존 확인에 사용하며 편도 도착 시각을 정밀 시계 오프셋으로 간주하지 않는다.

**시험 입력 → 기대 결과**

- 교환T성공의 표시T+20Tick 이벤트 → 그 전 점없음,표시 후40Tick에 제거.
- 같은 감지 eventId 세 번 수신 → 점/효과음/TTL 연장 각 중복 없음.
- 이벤트 TTL 경과·구match·미래큐65개 → 오래된 표시 없음,유한큐 유지 및 resync 요청.
- 두 교환 셀 (4,5),(5,5)의 marker.point=(4.5,5) → 미니맵 중간 지점 그대로 표시, 정수 칸으로 반올림하지 않는다.
- 본 경기 전체 뷰 뒤 연습의 높은 tick 사건 또는 낮은 scope revision 사건 → 표시 0; 미래 scope 사건만 도착 → 지도 전환 0, 대응 전체 뷰가 없으면 1초 뒤 폐기·resync.

**추가·보완할 시험 파일**

- `apps/web/src/features/room/private-events.test.ts`
- `apps/web/src/features/game/map/past-event-markers.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/room/private-events.test.ts apps/web/src/features/game/map/past-event-markers.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

교환·감지기·덫 사건을 지정 시각/TTL에 점으로만 표시한다. 안개 속 주변 지형·대상 신원·지속 추적이 생기지 않으며 중복 eventId를 무시한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 술래에게 과거 사건 점 표시
```

**MR 본문에 채울 변경 사항**

- 개인 이벤트 버전·중복·유한 대기 큐 구성
- 교환·감지·덫 점의 서버 시각 기반 TTL 표시

**MR 리뷰 포인트**

- 사건점이 미탐색 지형을 드러내는지
- 중복 수신·늦은 수신의 TTL 처리

**완료 인계**

- B SV-07/KN-08/EQ에서 확정된 HUNTER_MARKER payload와 showAtTick/expiresTick을 받고 상대 TTL을 새로 계산하지 않는다.
- F QA-09에 세 사건점과 안개 속 표시 검증을 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/KN-11.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/KN-11.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-13

**VI-04 · [FE] 가시 캐릭터의 얼굴·아군 표식**  
일정: D2 2026-09-09 · **오늘 9번**  
기획 근거: v0.0.8 **03, 08, 20장**  
선행 완료 결과: [C-07](c-web-ui.md#c-07) (VI-03, D2), [D-15](d-vision-media.md#d-15) (ME-05, D2)

**수정·생성 파일**

- `apps/web/src/features/game/scene/FaceAvatar.tsx`
- `apps/web/src/features/game/scene/face-textures.ts`
- `apps/web/src/features/game/scene/face-textures.test.ts`
- `apps/web/src/features/game/scene/WorldCanvas.tsx`
- `apps/web/src/app/App.tsx`

**구현 순서**

1. D onFaceTrack({matchId,playerId,mediaInstanceId,receiverGeneration,publisherGeneration,trackSid,element})를 App에서 받아 전체 식별자 키로 element 레지스트리를 갱신한다. B 검증 매핑 없이 이름/metadata로 playerId를 만들지 않는다. 뷰 또는 얼굴 callback 어느 쪽이 갱신돼도 현재 가시 플레이어와 다시 대조한다.
2. visibleEntities의 player id와 registry가 일치할 때만 Three.VideoTexture를 만들고 얼굴 plane에 붙인다. 시야 이탈 때 mesh/texture를 폐기하되 허용된 D 사전 수신 트랙을 C가 stop하지 않는다.
3. trackSid/세대 변경 또는 element:null에 기존 texture를 dispose하고 새 element를 기다린다. 없는 얼굴에는 같은 안전 기본재질을 쓰고 원본 카메라를 원격 캐릭터에 연결하지 않는다.
4. 아군 표식은 서버가 가시 엔티티에 공개한 role만으로 표시한다. 적 이름표·벽너머 outline·가청밖 발화 아이콘은 만들지 않는다. 실제 재게시/시야왕복의 texture count를 확인한다.

**연결 계약과 경계**

- B private-view visibleEntities id ↔ D 검증된 playerId callback 매핑.
- D는 track/video 소유, C는 VideoTexture/mesh 소유. 사전 수신은 게임 가시성을 의미하지 않는다.

**시험 입력 → 기대 결과**

- 얼굴5명 수신,가시플레이어1명 → Scene 얼굴 mesh/texture는 해당1명만 존재.
- 같은 player 새 publisherGeneration/trackSid → 구 texture dispose 1회, 새 texture 연결; 구 세대 null callback은 새 것을 닫지 않는다.
- 바인딩·원격 트랙·가시 뷰의 도착 순서를 바꿈 → 최종 동일 얼굴 표시, 검증 전 mesh/texture 생성 없음.
- 한 명만 전체 재연결 → 그 player의 publisherGeneration만 교체하고 나머지 player texture·자기 receiverGeneration 유지.
- 시야이탈 또는 개인종료 → 얼굴/표식 제거,적/벽너머 정보 표시는 없다.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/scene/face-textures.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/scene/face-textures.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

현재 가시 엔티티에만 수신 얼굴을 붙이고 시야 이탈 시 제거한다. 아군 표식만 허용하며 적 이름표·벽 너머 윤곽·가청 밖 발화 표시가 없다. VideoTexture 교체/폐기도 검사한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 가시 캐릭터에 실시간 얼굴 연결
```

**MR 본문에 채울 변경 사항**

- 수신 얼굴과 가시 엔티티의 검증된 ID 결합
- 시야·SID·세대 변경에 따른 texture 수명 관리

**MR 리뷰 포인트**

- metadata 추측과 시야밖 얼굴 렌더 여부
- C/D 자원 소유 중복 해제·누수 여부

**완료 인계**

- D ME-05에 null callback의 시점과 구sid 응답 무시 규칙을 맞춘다.
- F QA-09/QA-02에 texture count와 표시/사전수신 구분 지표 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/VI-04.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/VI-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-14

**FL-10 · [FE] 게임 연결 상실과 탭 상태 처리**  
일정: D2 2026-09-09 · **오늘 10번**  
기획 근거: v0.0.8 **06, 24장**  
선행 완료 결과: [B-10](b-game-server.md#b-10) (SV-06, D1), [D-09](d-vision-media.md#d-09) (IN-07, D1), [D-10](d-vision-media.md#d-10) (IN-08, D1), [D-17](d-vision-media.md#d-17) (ME-07, D2), [D-01](d-vision-media.md#d-01) (IN-01, D1), [D-02](d-vision-media.md#d-02) (IN-02, D1)

**수정·생성 파일**

- `apps/web/src/app/SessionRuntime.ts`
- `apps/web/src/app/SessionRuntime.test.ts`
- `apps/web/src/features/room/game-heartbeat.ts`
- `apps/web/src/features/room/game-heartbeat.test.ts`
- `apps/web/src/features/game/flow/ConnectionLostScreen.tsx`

**구현 순서**

1. C-02에서 만든 game-heartbeat 수신 검증/ACK 모듈에 클라이언트 만료와 종료 조립을 추가한다. serverEpoch/matchId/증가하는 heartbeatSeq를 확인하고 유효 수신 monotonic 시각을 갱신한다. ACK handler를 두 개 등록하지 않으며 LiveKit heartbeat를 게임 생존으로 사용하지 않는다.
2. socket close는 즉시, 마지막 유효 heartbeat 뒤 6초는 만료로 확정한다. SessionRuntime에서 terminal을 먼저 설정한 뒤 D endParticipation과 Room·UI 정리를 멱등 호출한다.
3. visibilitychange/blur에서 D setContext로 입력 문맥을 닫아 held/손동작/키 버퍼를 비운다. 복귀 시 이전 keydown/모션을 재생하지 않고 새로운 안정 입력만 허용한다.
4. 실제 퇴장도 같은 전체 정리를 사용한다. 개인 결과 대기는 FL-09가 게임 Room을 유지하는 별도 경로다. 오류 화면에 원인을 표시하고 진행 매치의 자동 복원·재입장 루프를 만들지 않는다.

**연결 계약과 경계**

- heartbeat2초/만료6초는 performance.now 등단말monotonic기준,서버시각은표시용추정.
- D endParticipation은 입력·Worker·장치·미디어정리; C는 Room/화면listener/texture정리.
- setContext.pageActive:boolean은 실제 phase/status를 바꾸지 않고 탭 숨김의 입력을 잠근다. false에서 held/timer를 지우고 true에서도 새 키 입력·중립 모션부터 받는다.

**시험 입력 → 기대 결과**

- 현재heartbeat후5.9초/6.0초 → 전자는생존,후자는종료1회.
- 구serverEpoch/구match/replayedSeq heartbeat → 만료타이머 갱신없음.
- 키누른채숨김→복귀 또는 socketclose+timeout동시 → 잔류이동없음,중복종료·자동미디어재연결없음.

**추가·보완할 시험 파일**

- `apps/web/src/app/SessionRuntime.test.ts`
- `apps/web/src/features/room/game-heartbeat.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/app/SessionRuntime.test.ts apps/web/src/features/room/game-heartbeat.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

socket close 즉시 또는 유효 heartbeat 후 6초에 권위 상실을 확정한다. SessionRuntime의 endParticipation 조립으로 입력·timer/listener·Worker·원본 장치·미디어·재연결을 멱등 정리한다. 실제 퇴장에도 적용하며 탭 숨김/복귀 때 과거 입력을 비운다. 자체 승패/매치 복원 없이 새 방을 안내한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 게임 연결 상실과 탭 입력 정리
```

**MR 본문에 채울 변경 사항**

- 게임 heartbeat/terminal 조립과 전체 자원 정리 연결
- 탭 복귀 입력 잔류 방지와 새 방 안내

**MR 리뷰 포인트**

- 개인 종료자 Room유지와 실제퇴장 구분
- 6초만료·socketclose·latejoin경쟁의 멱등성

**완료 인계**

- D에 endParticipation 종료상태 전파·재연결취소 증거를 받고 callback후 Ctexture를 정리한다.
- F QA-05에 서버강제종료/탭유지의 브라우저 검사 절차 제공.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/FL-10.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/FL-10.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-15

**EX-04 · [FE] 상체 포즈 판별과 도전 화면**  
일정: D2 2026-09-09 · **오늘 11번**  
기획 근거: v0.0.8 **11장**  
선행 완료 결과: [A-33](a-game-core.md#a-33) (EX-03, D2), [D-04](d-vision-media.md#d-04) (IN-04, D1), [D-11](d-vision-media.md#d-11) (IN-09, D1), [C-02](c-web-ui.md#c-02) (AC-06 공통 명령 lifecycle, D1), [C-07](c-web-ui.md#c-07) (VI-03 실제 출구 포털, D2)

**수정·생성 파일**

- `apps/web/src/features/game/pose/PoseChallenge.tsx`
- `apps/web/src/features/game/pose/pose-evaluator.ts`
- `apps/web/src/features/game/pose/pose-evaluator.test.ts`
- `apps/web/src/features/game/pose/challenge-controller.ts`
- `apps/web/src/features/game/pose/challenge-controller.test.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/features/room/product-session.ts`
- `apps/web/src/features/room/product-session.test.ts`

**구현 순서**

1. B self/exit와 C VI-03의 실제 포털을 연결해 출구 접근 안내를 만든다. C 버튼·D E는 C 공통 sender의 matchId+exitId pending을 공유한다. command-result rejected면 즉시 pending을 끝내고 안전 code·재요청 UI를 복구한다. accepted에는 잠금을 유지하고 이후 command-outcome의 applied/rejected/canceled로 요청을 종결한다. applied 뒤에는 대응 stateVersion의 self.challenge까지 별도 동기화 대기하며 시작 버튼/E 중복을 막고 도전 성공·이동 잠금을 추정하지 않는다. 대응 뷰가 2초간 없으면 view-resync와 UNCONFIRMED 표시로 대기 spinner를 끝낸다. 접수된 요청의 outcome 누락에만 공통 상태 조회를 사용하고 자동 재실행하지 않는다.
2. D SensorSnapshot.pose의 Sample을 읽는다. runtimeGeneration이 현재 세대와 같고 pose.frameId가 직전 관측보다 증가했으며 status=valid/data.quality=valid이며 sampledAtMs 기준 age≤300ms인 pose만 평가한다. 새 pose frame 간 간격이 300ms를 넘거나 missing/만료/유효 자세 이탈이면 hold를 초기화한다. 같은 pose를 담은 얼굴·손 갱신은 시간을 누적하지 않는다. 필수 관절 visibility와 좌우 정규화로 왼팔·오른팔·Y자를 평가한다.
3. challenge-controller는 새 유효 pose 표본의 sampledAtMs로만 연속 1.2초를 누적하고 serverTick>=self.challenge.minSuccessTick도 충족해야 EXIT_PROGRESS {challengeId,method:"pose",completed:true}를 보낸다. 현재 표본의 신선도·8초 기한·취소·포획을 먼저 확인한다. 조기 경계 rejected outcome이면 다음 서버 시각과 아직 신선한 새 자세를 확인해 새 requestId로 제한 재시도하고, 일반 거절은 재시도하지 않는다. inFlight는 하나이며 applied도 실제 ESCAPED 뷰 전에는 성공 확정이 아니다.
4. D context.challengeId/poseKind로 일반 행동을 차단한다. 실제 ESCAPED/CAPTURED 또는 출구 폐쇄 뷰에서 C VI-03 포털·소유자 표시를 제거하고 일반 벽을 복원한다. 취소·실패·만료 후에도 활성 출구는 그대로 유지한다.

**연결 계약과 경계**

- 포즈판별·1.2초진행소유자는 C; D는 센서·미러정규화만제공.
- EXIT_START/EXIT_CANCEL/EXIT_PROGRESS 계약. 재시도0.5초와고정poseKind는서버권위.
- [중앙 타입](contracts/types.ts)의 `Sample<T>`와 `FaceSensor`/`PoseSensor`/`GestureSensor` 및 `SensorSnapshot`은 D가 sensor-types.ts에 구현해 InteractionRuntime.ts에서 공개 재노출한다. C는 그 공개 타입을 소비하고 [공유 fixture](contracts/fixtures.ts)로 생산자·소비자를 검사한다. C가 D 소유 파일을 수정하거나 센서 타입 사본을 별도 생성하지 않는다. runtimeGeneration/emittedAtMs는 묶음, frameId/sampledAtMs/receivedAtMs/status/data는 센서별이다. valid data도 quality=uncertain이면 유효 자세/얼굴로 인정하지 않는다. 미실행은 이전 Sample 유지 또는 최초 null, 새 미검출은 missing/data=null이다. face/pose age>300ms, gesture age>400ms는 사용 불가이며 다른 센서 갱신으로 유효 시간을 연장하지 않는다. Pose visibility 누락은 0, 비유한 좌표는 missing 처리하고 SDK에 없는 presence/전체 얼굴 score는 읽지 않는다.
- [중앙 계약](contracts/types.ts)의 ActiveSelf/EndedSelf/PrivateView를 소비한다. equipment/ownedEquipment·구속·설치·교환 방향·challenge·loading은 해당 판별 타입대로 읽고 별도 alias나 보류 아이템 필드를 추가하지 않는다.
- EXIT_PROGRESS의 pose/keys 완료 생성자는 C challenge-controller 하나다. D IN-09는 시작·취소 의도와 일반 입력 문맥만 소유하고 진행 완료를 보내지 않는다. C는 E키 listener를 추가하지 않고 화면 버튼만 시작한다.

**시험 입력 → 기대 결과**

- 유효 1199ms 뒤 새 pose 프레임 불일치 → 진행 0, 완료 전송 없음.
- pose는 같은 frameId인데 face만 15fps로 갱신 → pose hold 증가 없음; pose age>300ms 또는 missing → 즉시 초기화.
- 새 pose 간 301ms 공백 또는 구 runtimeGeneration → 연속 유지 실패; 300ms 이하 유효 새 표본만 1.2초 누적.
- 왼팔landmarks를미러표현 → 화면안내와판별왼팔일치,양팔Y별도판별.
- 성공의도와포획이같은Tick → 서버CAPTURED결과표시; 과거challengeId완료/취소는재사용안됨.
- 포즈 1.2초 완료이나 serverTick<minSuccessTick → 완료 전송 0회; 유효 자세를 유지해 최소 Tick 도달 → 완료 1회.
- 화면 시작 버튼과 E가 같은 프레임 → EXIT_START 1개. accepted 뒤 rejected/canceled outcome → pending 해제. applied outcome이 먼저면 대응 challenge 뷰까지 동기화 대기, 도전 임의 생성 없음.
- EXIT_START의 command-result가 즉시 rejected → 시작 pending 해제·안전 code 표시·재요청 가능, challenge 생성·outcome 대기·조회 타이머 없음.
- outcome/상태 조회 미응답 또는 unknown → 최대 조회 뒤 UNCONFIRMED·view-resync, 영구 spinner나 자동 EXIT_START 재전송 없음.
- 실제 발견→가시 벽 포털→도전→성공/포획 폐쇄 → 포털과 소유자 표시가 일반 벽으로 복원.
- 최소 시간 경계의 조기 거절 뒤 유효 자세 유지 → 다음 서버 시각에서 새 requestId로 재시도; 이미 ESCAPED/CAPTURED·만료·취소면 추가 완료 전송 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/pose/pose-evaluator.test.ts`
- `apps/web/src/features/game/pose/challenge-controller.test.ts`
- `apps/web/src/features/room/product-session.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/pose/pose-evaluator.test.ts apps/web/src/features/game/pose/challenge-controller.test.ts apps/web/src/features/room/product-session.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

왼팔/오른팔/Y자와 좌우 반전을 일관되게 판별한다. 1.2초 연속 유효 자세·초기화·기한·취소를 표시하며 명시적 도전 중에만 판정하고 실제 서버 성공 응답을 반영한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 상체 포즈 도전과 서버 탈출 화면 연결
```

**MR 본문에 채울 변경 사항**

- 3종 포즈평가와 연속유지 진행컨트롤러 구현
- 도전ID·서버성공·취소와입력잠금 연결

**MR 리뷰 포인트**

- C/D포즈중복판별이없는지·좌우반전일치
- 최소2초와8초기한·포획우선결과

**완료 인계**

- D IN-04의landmarks형식/미러좌표/품질기준을fixture로받아순수평가시험을고정한다.
- B self.challenge의 poseKind/startedAtTick/minSuccessTick/expiresAtTick를 사용한다. 조기 완료 거절 code를 B와 명확히 연결하고 일반 NOT_ALLOWED/위치 불일치·종료 거절을 무조건 재시도하지 않는다. F에 실제 장치와 최소 시간 경계 검증을 인계한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/EX-04.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/EX-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-16

**EX-05 · [FE] 카메라 장애의 키·버튼 도전**  
일정: D2 2026-09-09 · **오늘 12번**  
기획 근거: v0.0.8 **11장**  
선행 완료 결과: [C-15](c-web-ui.md#c-15) (EX-04, D2), [D-12](d-vision-media.md#d-12) (IN-10, D1)

**수정·생성 파일**

- `apps/web/src/features/game/pose/KeyChallenge.tsx`
- `apps/web/src/features/game/pose/key-challenge.ts`
- `apps/web/src/features/game/pose/key-challenge.test.ts`
- `apps/web/src/features/game/pose/challenge-controller.ts`
- `apps/web/src/app/App.tsx`

**구현 순서**

1. IN-10이 카메라·추론 장애를 알리면 동일 challengeId의 키 폴백을 표시한다. C가 ['up','right','down','left']를 fnv1a32(challengeId)%4만큼 왼쪽 순환시켜 4단계 키 순서를 만들고 해당 도전 수명 동안 고정한다. 재렌더·오입력·방식 전환으로 순서를 다시 뽑지 않는다. 서버 payload에 키 순서 필드를 추가하지 않는다.
2. 기대 키·버튼 하나당 한 단계만 진행시키고 오입력은 진행 0으로 돌린다. key.repeat는 추가 단계로 세지 않으며 포즈 화면의 방향키 listener는 C가 소유한다. Esc/E/F listener를 중복 등록하지 않는다. 취소 화면 버튼은 C sender를 사용하고 Esc 취소는 D의 현재 challenge 문맥에서 한 번만 보낸다.
3. D 문맥의 challenge 잠금으로 방향키와 이동·회전 중복을 막는다. 시퀀스 완료 후에도 serverTick>=self.challenge.minSuccessTick을 기다리고 C controller 하나가 method:"keys"로 보낸다. 조기 경계 rejected outcome만 같은 도전·기한·완료 시퀀스를 확인해 새 requestId로 제한 재시도한다. outcome 누락은 공통 조회/UNCONFIRMED를 사용하고 자동 성공·재실행하지 않는다.
4. 취소/Esc·8초 기한·개인 종료에 시퀀스와 listener를 정리한다. 포즈와 키 방식의 시도수·성공률은 실제 영상을 저장하지 않고 구분해 F에 제공한다.

**연결 계약과 경계**

- 카메라장애진위는서버보증이아님; 동일challenge·최소2초·서버위치조건을유지.
- C방향시퀀스UI와D일반게임키문맥을분리; EX-04의challengecontroller재사용.
- EX-04와 같은 C challenge-controller의 minSuccessTick·inFlight·command-outcome·상태 조회·terminal guard를 재사용한다. D는 EXIT_PROGRESS를 생성하지 않는다.

**시험 입력 → 기대 결과**

- 시퀀스앞2개성공후오입력 → index0,새시퀀스추첨없음.
- 방향키자동반복/길게누름 → 단발진행만,게임TURN/MOVE전송0.
- 기한/포획/취소후마지막키 → EXIT_PROGRESS전송없음,서버결과유지.
- 키 시퀀스를 2초 전에 완료 → minSuccessTick까지 완료 전송 없음; 도중 포획/취소면 대기 요청 폐기.
- 키 완료의 조기 경계 거절 → 같은 도전·기한·완료 상태에서만 새 requestId로 재시도, 서버 성공은 한 번만 반영.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/pose/key-challenge.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/pose/key-challenge.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

4방향 시퀀스를 표시하고 오입력 시 초기화한다. 최소 2초·포획 가능·입력 잠금은 유지하며 카메라 폴백의 성공률을 포즈 방식과 별도로 기록한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 카메라 장애의 키 시퀀스 탈출 지원
```

**MR 본문에 채울 변경 사항**

- 동일도전의키·버튼폴백과오입력초기화
- 일반이동키중복방지와방식별측정연결

**MR 리뷰 포인트**

- 실수/재렌더에시퀀스바뀌지않는지
- 서버최소시간우회와폴백성공률과장여부

**완료 인계**

- D에challenge문맥시방향키일반행동중지와CUIlistener우선규칙을전달한다.
- B에는 C가 도전별 고정 키 순서를 사용하고 같은 EXIT_PROGRESS를 보낸다는 결과만 인계한다. 순서 소유권은 C로 확정되어 있으며 추가 계약 협의를 요청하지 않는다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/EX-05.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/EX-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-17

**FL-04 · [FE] 역할별 연습 화면 연결**  
일정: D2 2026-09-09 · **오늘 13번**  
기획 근거: v0.0.8 **05, 06, 11장**  
선행 완료 결과: [C-04](c-web-ui.md#c-04) (FL-02, D1), [B-15](b-game-server.md#b-15) (FL-03, D2), [D-09](d-vision-media.md#d-09) (IN-07, D1), [D-10](d-vision-media.md#d-10) (IN-08, D1), [C-11](c-web-ui.md#c-11) (KN-10, D2), [C-08](c-web-ui.md#c-08) (EQ-10, D2), [C-09](c-web-ui.md#c-09) (EQ-11, D2), [C-15](c-web-ui.md#c-15) (EX-04, D2), [D-14](d-vision-media.md#d-14) (ME-04, D2), [D-16](d-vision-media.md#d-16) (ME-06, D2), [C-13](c-web-ui.md#c-13) (VI-04, D2)

**수정·생성 파일**

- `apps/web/src/features/game/flow/PracticeScreen.tsx`
- `apps/web/src/features/game/flow/practice-presenter.ts`
- `apps/web/src/features/game/flow/practice-presenter.test.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/SessionRuntime.ts`

**구현 순서**

1. TEAM_PRACTICE 전이와 `PrivateView.gameScope.kind=practice`가 일치한 전체 뷰를 받고 서버가 정한 gameInstanceId/revision을 사용한다. 미디어 연결은 별도 MediaGrant의 mediaInstanceId/receiverGeneration으로 D connectMedia에 넘긴다. C가 역할·논리 ID·roomName을 임의로 만들지 않는다.
2. 이동·얼굴·아군 표식·지도 교환·술래 설치 장비·구속 HUD를 기존 컴포넌트로 연결한다. 도망자 아이템 제품 결정 대기는 다른 연습 기능을 막지 않는다. 작은 연습 맵 지식은 C-06의 논리 gameScope로 보관하며 MediaScope를 지식의 키로 사용하지 않는다. 같은 match에서 practice→none→game의 revision이 증가할 때 각 전체 뷰로 교체해 본 경기에 연습 지식을 합치지 않는다.
3. PRACTICE_READY {ready:true}를 보내고 서버의 최대 60초·전원 준비 종료를 표시한다. 카메라가 준비되지 않은 참가자를 시간 초과만으로 통과시키지 않는다.
4. 포즈 3종은 연습 안내와 신선한 Sample 기반 로컬 평가로 확인하고 실제 EXIT_PROGRESS를 위조하지 않는다. 다음 단계에서는 D retireMediaGeneration과 서버 회수 장벽을 기다리고 설치물·구속 표시·지식·입력을 비운다.

**연결 계약과 경계**

- 연습팀당최대3·팀외얼굴/음성없음·포획/승패비활성은B/A권위.
- PRACTICE_READY는 준비 신고이고 `private-view.gameScope`는 논리 지식 범위다. MediaScope의 mediaInstanceId/receiverGeneration은 송수신 수명이다. 미디어 재연결에서는 gameInstanceId/revision을 바꾸지 않으며, 논리 범위 전환은 권위 phase와 전체 뷰로만 확인한다. 연습 종료에 새 game grant를 자체 생성하지 않는다.

**시험 입력 → 기대 결과**

- 서로다른두팀연습 → 상대팀얼굴/음성/위치표시없음.
- 전원준비60초전 → 서버조기종료를표시;장치미준비만시간초과 → 준비우회없음.
- 연습에서 설치/탐색 뒤 게임 로딩 → 이전 설치물·지식·구속 표시·입력 없음, 구 세대 회수 불명 시 새 연결 없음.
- 연습 revision 1 뒤 none 2/game 3 전체 뷰와 오래된 연습 뷰/사건을 순서를 바꿔 전달 → 연습 지식 복원 0; 사건만으로 game scope를 여는 경우 0.
- 연습 중 같은 게임 연결에서 미디어만 재연결 → receiverGeneration은 갱신되지만 gameScope·탐색 지식은 유지.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/flow/practice-presenter.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/flow/practice-presenter.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

이동·얼굴·근거리 음성·아군 표식·지도 교환·술래 장비·구속 HUD를 연결한다. 팀 외 상대가 보이거나 들리지 않고 연습용 설치물·탐색을 본 경기에 이월하지 않는다. 포즈는 준비용 안내로 확인하며 보류 아이템의 완료로 계산하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 역할별 공동 연습 화면 통합
```

**MR 본문에 채울 변경 사항**

- 기존이동·얼굴·지도·도구의연습인스턴스연결
- 준비·60초종료와본경기이월방지

**MR 리뷰 포인트**

- 연습팀격리·포즈연습/실제탈출구분
- 본경기새세대장벽과이월상태제거

**완료 인계**

- B FL-03/E MC-08에practiceInstance전이와회수확인응답을받는다.
- F QA-09에6인두연습공간부터시작하는사용경로인계.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/FL-04.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/FL-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-18

**FL-07 · [FE] 로딩 가림막·카운트다운·경기 HUD**  
일정: D3 2026-09-10 · **오늘 1번**  
기획 근거: v0.0.8 **05, 07장**  
선행 완료 결과: [B-17](b-game-server.md#b-17) (FL-06, D2), [C-07](c-web-ui.md#c-07) (VI-03, D2), [D-17](d-vision-media.md#d-17) (ME-07, D2)

**수정·생성 파일**

- `apps/web/src/features/game/flow/LoadingScreen.tsx`
- `apps/web/src/features/game/flow/Countdown.tsx`
- `apps/web/src/features/game/flow/GameHud.tsx`
- `apps/web/src/features/game/flow/loading-controller.ts`
- `apps/web/src/features/game/flow/loading-controller.test.ts`
- `apps/web/src/app/SessionRuntime.ts`

**구현 순서**

1. GAME_LOADING에 맞는 `gameScope.kind=game` 전체 뷰와 self.loading.loadId/initialViewVersion/mediaInstanceId/receiverGeneration/assetVersion으로 개인 초기 뷰·자산·미디어 장벽을 추적한다. 각 비동기 완료에서 논리 scope·loadId·미디어 scope를 각각 다시 확인하고 오래된 결과를 버린다. phase 변경 하한으로 초기 뷰를 폐기했다면 C-06의 resync로 현재 전체 뷰를 확보하기 전 LOAD_READY를 보내지 않는다.
2. 모든 전제 충족 뒤 LOAD_READY {loadId,mediaInstanceId,receiverGeneration}를 한 번 보낸다. SDK connected나 grant 발급만으로 준비를 확정하지 않는다. 현재 바인딩의 자기 entry에서 publisherGeneration=receiverGeneration과 faceTrackSid를 확인하고 B의 서버 준비 장벽을 기다린다. 30초 초과·얼굴 실패는 B의 준비 복귀를 따르며 C가 COUNTDOWN/PLAYING을 직접 확정하지 않는다.
3. COUNTDOWN 3초는 서버 monotonic startAt과 clock-probe/clock-reply로 구한 estimatedServerNowMs의 차이로 표시한다. heartbeat 수신 시각을 countdown 기준으로 삼지 않는다. 전체 가림막과 D 입력·음성 잠금을 유지하며 사전 미디어 수신과 청취 허용을 구분한다.
4. 권위 PLAYING 전이 뒤 가림막을 해제한다. deadlineTick/serverTick으로 남은 시간·공개 인원을 표시하고 로컬 타이머 0만으로 승패를 정하지 않는다.

**연결 계약과 경계**

- LOAD_READY는 loadId/mediaInstanceId/receiverGeneration 필수이며 command-outcome applied도 라운드 시작 확정이 아니다.
- startAt시간단위는B계약확인;Tick50ms·deadline3600Tick와epochJWT를혼합하지않는다.
- [중앙 계약](contracts/types.ts)의 ActiveSelf/EndedSelf/PrivateView를 소비한다. equipment/ownedEquipment·구속·설치·교환 방향·challenge·loading은 해당 판별 타입대로 읽고 별도 alias나 보류 아이템 필드를 추가하지 않는다.
- serverTick은 라운드 생성부터 20Hz로 증가하며 연습 action도 같은 시계를 사용한다. 본 경기 startTick부터 deadlineTick=startTick+3600이고 startAt은 서버 monotonic ms다. C는 중앙 clock-probe/clock-reply 왕복 시각으로 오프셋을 구해 화면만 보간한다. game-heartbeat는 연결 생존 확인에 사용하며 편도 도착 시각을 정밀 시계 오프셋으로 간주하지 않는다.

**시험 입력 → 기대 결과**

- 자산준비완료이나원격얼굴미준비 → LOAD_READY없음,입력/음성차단.
- oldloadPromise가새loadId뒤완료 → 새라운드ready를대신발송하지않는다.
- COUNTDOWN중키/음성입력·서버startAt도달전 → 실제행동/탐색/청취없고권위PLAYING전이후해제.
- 같은 startAt에서 heartbeat 도착만 늦어짐 → 왕복 probe offset 기준의 같은 countdown, 편도 도착 시각으로 3초를 다시 시작하지 않음.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/flow/loading-controller.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/flow/loading-controller.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

공통 자산과 개인 뷰 로딩, 서버 시각 기준 카운트다운·남은 시간·인원 누계를 표시한다. 시작 전 시야·입력·음성을 열지 않고 로딩 실패 사유와 준비 복귀를 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 로딩 장벽과 경기 카운트다운 연결
```

**MR 본문에 채울 변경 사항**

- 개인뷰·자산·미디어준비와loadId결합
- 서버시각기반가림막·카운트다운·경기HUD

**MR 리뷰 포인트**

- 서버시각단위/offset·중복ready처리
- 준비실패에서무리한시작과음성조기출력방지

**완료 인계**

- B의 확정 loading 계약과 monotonic startAt, C VI-02의 공통 clock-probe/reply offset을 사용한다. D MediaStatus.state=connected는 SDK 연결일 뿐이며 media-bindings와 서버 준비 장벽을 별도로 확인한다.
- F E2E에30초로딩실패와카운트다운중입력시도를인계.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/FL-07.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/FL-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### C-19

**FL-09 · [FE] 개인 종료·팀 결과·재경기 화면**  
일정: D3 2026-09-10 · **오늘 2번**  
기획 근거: v0.0.8 **04, 05, 24장**  
선행 완료 결과: [A-14](a-game-core.md#a-14) (RL-07, D1), [B-18](b-game-server.md#b-18) (FL-08, D2), [D-17](d-vision-media.md#d-17) (ME-07, D2)

**수정·생성 파일**

- `apps/web/src/features/game/flow/ResultScreen.tsx`
- `apps/web/src/features/game/flow/result-presenter.ts`
- `apps/web/src/features/game/flow/result-presenter.test.ts`
- `apps/web/src/app/SessionRuntime.ts`
- `apps/web/src/features/room/store.ts`

**구현 순서**

1. self.status가 ESCAPED/CAPTURED로 바뀌면 D endParticipation으로 입력·미디어를 닫고 C의 상세 지도·Scene·texture·사건 캐시를 제거한다. 결과·공개 인원 수신용 게임 Room은 유지한다.
2. 개인 대기는 자기 결과·남은 시간·탈출/포획/활동 인원만 보여 준다. 생존자 좌표·지도·음성·관전 대상을 다시 요청하지 않는다.
3. RESULT 승패와 ABORTED의 GAME_CONNECTION_LOST/SERVER_TICK_OVERLOAD/MEDIA_POLICY_UNCERTAIN/MEDIA_UNAVAILABLE을 구분한다. 회수 미확인을 별도로 표시하고 결과 화면 진입을 회수 성공으로 간주하지 않는다.
4. 방장의 REMATCH 요청 뒤 서버의 새 matchId로 UI 캐시를 초기화한다. 새 준비에는 startDevices/calibrate·전원 ready·장치/예산 재확인을 거치고 진행 중인 판의 빈 슬롯은 채우지 않는다.

**연결 계약과 경계**

- 개인종료와실제퇴장은다름: 전자는게임Room유지,후자는FL-10의전체퇴장경로.
- REMATCH는전환의도이며전원준비/새generation승인을대체하지않는다.

**시험 입력 → 기대 결과**

- 첫도망자탈출 → 개인대기만표시,서버counts갱신은수신하되새생존정보표시없음.
- 개인종료뒤사용자실제나가기 → Roomleave,남은경기는서버정상진행;누계되돌림없음.
- ABORTED+회수UNRESOLVED 또는새match도착후구event → 패배로표시하지않고구지도/결과부활없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/game/flow/result-presenter.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/game/flow/result-presenter.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

탈출·포획 뒤 결과 대기에 필요한 게임 Room 연결은 유지하며 자기 결과·공개 누계만 표시한다. 관전·잔여 적 좌표를 제공하지 않고 팀 승패와 네 가지 무효 사유를 구분한다. 결과 표시를 회수 성공으로 오인시키지 않으며 재경기 선택을 서버와 연결한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 종료와 재경기 결과 화면 연결
```

**MR 본문에 채울 변경 사항**

- 개인결과대기와팀결과·무효사유분리
- 상세정보정리·Room유지·새라운드준비연결

**MR 리뷰 포인트**

- 종료자의관전/미디어잔류와결과역전방지
- 회수미확인상태와실제경기결과의구분

**완료 인계**

- D ME-07에게endParticipation후startDevices로새준비를재개하는재생성수명을맞춘다.
- B RL-08/FL-08와F QA-09에개인종료자퇴장·역할교대·새라운드초기화사례전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/C/FL-09.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/C/FL-09.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.
