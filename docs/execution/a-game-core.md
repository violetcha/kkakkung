# A · 게임 규칙·맵·지식·도구·출구 실행 문서

작성 기준: 2026-09-08 · 현재 스켈레톤에서 실행 전 확인 · **EXEC-CONTRACT-3**
담당 범위: 서버 전용 순수 규칙과 맵/배치 데이터  
원본 작업: **33개** · 리뷰 상대: **B** · 현재 상태: **활성 구현 계획 28개 · 제품 결정 대기 5개**

이 문서와 [최신 결정 정정표](../spec/decisions.md), 아래의 담당 읽기 경로를 실행 입력으로 사용한다. 보관된 v0.0.8보다 최신 결정과 공통 계약을 먼저 적용한다. 팀원에게 다른 담당 실행 문서 전체를 찾아 오도록 요구하지 않는다. [6인 전체 일정](README.md)은 인계 시점을 확인하는 안내다.

목표는 **9월 8일(화)·9일(수) 핵심 구현, 10일(목) 통합·검증·수정, 11일(금) 오전 MVP 인수**다. 작업 개수는 소요시간이나 완료 보증이 아니다. 선행 작업·실제 Cloud·장치가 준비되지 않은 조건은 완료로 계산하지 않는다.

## A가 작업을 시작할 때 읽을 자료

1. 루트 [AGENTS.md](../../AGENTS.md), [CONTRIBUTING.md](../../CONTRIBUTING.md), [요구사항](../../requirements.md), [아키텍처](../architecture.md), [최신 결정](../spec/decisions.md)을 읽고 현재 브랜치·미커밋 변경을 확인한다.
2. 이 문서의 공통 블록과 요청 번호 본문, [타입 원본](contracts/types.ts), [fixture](contracts/fixtures.ts), [fixture 검사](contracts/fixtures.test.ts)를 읽는다. 공통 블록은 [common.md](common.md)의 자동 사본이므로 별도로 수정하지 않는다.
3. [game-core README](../../packages/game-core/README.md), [서버 README](../../server/README.md), `packages/game-core/src/match/index.ts`·`types.ts`와 `server/src/domain/index.ts`·`types.ts`를 읽는다. 현재 match는 개발용 `tryMove/checkCapture/checkWinCondition/generateMaze` 스텁이며 제품 엔진이 이미 있다고 가정하지 않는다. `packages/game-core/src/world.ts`와 루트 export는 sandbox 소유 흐름이므로 제품 작업을 이유로 바꾸지 않는다.
4. 기획 근거를 재확인할 때만 [HTML 원본](../spec/까꿍_3대3_MVP_기획_구현_기준서_v0.0.8.html)의 해당 장을 읽는다. A-01–05는 05·10장, A-07·32–33은 11장, A-08–15는 04·07·13.1·24장, A-16–22는 08·09장, A-23–27은 12장이다. 13.1에서는 확정된 덫의 순환 우선순위만 사용한다.
5. [A 인계 기록](handoffs/A.md)에서 기존 진행을, 필요한 생산자의 인계 기록에서 export·검증·commit을 확인한다. B/C/D/E/F 실행 문서 전체를 구현 전제로 읽을 필요는 없다. 타 담당의 소스는 공개 포트의 실제 연결을 확인할 때 읽되 수정하지 않는다.

```bash
# 고정 번호 A-01~A-05
node scripts/prepare-execution.mjs --role A --tasks 1-5
# 9월 9일 오늘 번호 1~5 = A-19~A-23
node scripts/prepare-execution.mjs --role A --day D2 --tasks 1-5
```

위 명령은 읽기 전용 범위 확인이다. 번호 요청 밖의 선행 기능을 자동 구현하지 않는다. 같은 담당의 선행 구현도 없으면 필요한 함수·입력·시험을 `blockedOn`에 기록하고 독립 구현 가능한 요청 번호를 계속 진행한다. 보류 번호는 원래 번호 그대로 기록한다.

## A의 선행 결과와 충돌 없는 인계

아래의 **착수 입력**과 **최종 연결**을 구분한다. 본문의 “선행 완료 결과”는 참조할 기능의 식별자이며 상대 작업 전체의 ACCEPTED를 기다리라는 뜻이 아니다. A-01은 확정된 공통 타입으로 시작하고 B-01의 실제 core 소비를 기다리지 않는다. A-05도 B-16의 소비를 기다리며 알고리즘 구현을 멈추지 않는다.

| 요청 범위     | 착수에 필요한 입력                                                        | 자기 영역에서 검증할 결과                                                          | 최종 연결과 인수의 추가 조건                                                 |
| ------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A-01–05       | 공통 MapPreparationPort·LayoutSelectionPort·MatchTuning, 기존 패키지 빌드 | 실제 master/practice/tuning 자료, 구조·변형·BFS·배치·fallback 인증과 public export | B LayoutLoader의 실제 바이트 hash·시간 상한/양보, F test:maps/배포 포함 반영 |
| A-07–15       | A 맵/배치 결과, 공통 CorePort·명령/control 타입                           | 순수 엔진·9/6 Tick 예약·명령별 outcome·종료/이탈 경계                              | B-04/05의 실제 Tick·과부하·원장 연결, 후속 A-33의 실제 탈출과 연결           |
| A-16–18       | A 맵·행동·출구 레지스트리                                                 | 실제 시야 마스크, 개인 지식·출구 폐쇄 selector                                     | B-14의 실제 직렬화와 C 시야 소비, G4 패킷 검사                               |
| A-19–23       | A-11·17·18의 실제 결과, 공통 교환/장비 명령·사건 타입                     | 교환 요청/취소/병합/지연 흔적과 설치·취소·무장                                     | B-11/14 전달·C/D 상호작용; 장비 발동은 A-24–27 별도                          |
| A-24–27·32–33 | 해당 A 선행 함수와 공통 명령/사건 타입                                    | 감지/구속/자연 만료·유예·도전 최소시간/포획 우선                                   | B/E의 실제 사건·미디어 회수, C/D 포즈 연결, F G3/G5 증거                     |

`createPractice`의 이동 기반은 A-09에서 만들고 회전·지식·교환·장비는 각 원본 작업에서 같은 엔진에 연결한다. A-09 단계에 존재하지 않는 후속 기능을 성공 stub으로 채우지 않는다. B-15의 연습 전체 인수에는 A-10·16–27 중 연습에서 쓰는 확정 기능이 실제 연결되어야 한다. 순수 시험용 작은 맵이나 테스트 port는 `test` 아래에서만 사용하고 제품 런타임에 등록하지 않는다.

A는 `packages/game-core/src/match/**`, `packages/game-core/test/match/**`, `server/content/**`, `server/config/tuning/**`, 두 `server/src/domain` 재노출 파일과 [A 인계 기록](handoffs/A.md)을 수정한다. package manifest·루트 명령·lockfile·Docker 포함 목록은 F, `LayoutLoader`·`MatchDriver`·protocol은 B에게 요청한다. B/E가 필요한 graph·시야 정보는 A public export 또는 공통 Topology로 인계하고 소비자가 A 내부 State를 추측해 복제하지 않게 한다.

한 요청 범위 안에서도 `engine.ts`, `types.ts`, `index.ts`는 A의 단일 조립점이다. A의 AI가 내부 작업을 병렬 분담하면 leaf 규칙 파일/시험만 나누고 해당 세 파일과 `server/src/domain` 재노출은 한 작업자가 순차 조립한다. 다른 담당 브랜치에서 이 파일을 대신 고쳐 충돌을 해결하지 않는다.

인계에는 원본 ID, 실제 export 경로·입력/출력, 정상/거절 재현 명령, 검증한 commit, 남은 소비자 연결을 적는다. 예를 들어 A-05의 실제 자료 인증은 LOCAL_VERIFIED로 남기고 B/F 결합이 도착하면 같은 ID를 재검증한다. `.local` 진행 기록만으로 다른 팀원에게 전달됐다고 보지 않는다.

## 날짜별 오늘 작업표

각 날짜에서 오늘 번호를 1부터 다시 센다. 예를 들어 9월 9일에 “오늘 1번부터 5번”을 요청하면 **D2 표의 1–5번**을 수행한다. `A-01` 같은 고정 번호와 원본 ID는 날짜가 지나도 바꾸지 않는다. 일정 이후에는 날짜 또는 고정 번호를 명시한다.

### D1 · 2026-09-08 화요일

계약·환경과 병렬 구현 기반을 만들고 권위 이동·장치 점검을 연결. 고정 원본 ID 18개 중 활성 계획 17개, 제품 결정 대기 1개.

| 오늘 번호 | 고정 번호                   | 원본 ID | 완료할 결과                                    |
| --------- | --------------------------- | ------- | ---------------------------------------------- |
| 1         | [A-01](a-game-core.md#a-01) | MP-01   | 마스터 맵 한 개와 후보 데이터                  |
| 2         | [A-02](a-game-core.md#a-02) | MP-02   | 맵 회전·반전과 중복 제거                       |
| 3         | [A-03](a-game-core.md#a-03) | MP-03   | 맵 연결성과 경로 검증                          |
| 4         | [A-04](a-game-core.md#a-04) | MP-04   | 시작점·개인 출구 조합 선발                     |
| 5         | [A-05](a-game-core.md#a-05) | MP-05   | 검증된 fallback과 온라인 선발 상한             |
| 6         | [A-06](a-game-core.md#a-06) | MP-06   | PRODUCT_DECISION_PENDING · 사용자 결정 전 보류 |
| 7         | [A-07](a-game-core.md#a-07) | EX-01   | 개인 출구·고정 포즈 레지스트리                 |
| 8         | [A-08](a-game-core.md#a-08) | RL-05   | Tick별 공통 순환 우선순위                      |
| 9         | [A-09](a-game-core.md#a-09) | RL-01   | 예약 셀 이동과 벽 충돌                         |
| 10        | [A-10](a-game-core.md#a-10) | RL-02   | 예약 90도 회전                                 |
| 11        | [A-11](a-game-core.md#a-11) | RL-03   | 다음 행동 한 칸 버퍼와 입력 TTL                |
| 12        | [A-12](a-game-core.md#a-12) | RL-04   | 동시 이동과 접촉·교차 포획                     |
| 13        | [A-13](a-game-core.md#a-13) | RL-06   | 팀 승패와 마감 Tick                            |
| 14        | [A-14](a-game-core.md#a-14) | RL-07   | 개인 종료·출구 폐쇄의 단일 확정                |
| 15        | [A-15](a-game-core.md#a-15) | RL-08   | 활동자와 개인 종료자의 이탈 구분               |
| 16        | [A-16](a-game-core.md#a-16) | KN-01   | 서버 시야·벽면 관찰 판정                       |
| 17        | [A-17](a-game-core.md#a-17) | KN-02   | 개인 지형 지식 초기화·누적                     |
| 18        | [A-18](a-game-core.md#a-18) | KN-03   | 출구 발견·소유자 공개 범위                     |

### D2 · 2026-09-09 수요일

MVP 핵심 기능을 구현하고 생산자·소비자를 통합. 고정 원본 ID 15개 중 활성 계획 11개, 제품 결정 대기 4개.

| 오늘 번호 | 고정 번호                   | 원본 ID | 완료할 결과                                    |
| --------- | --------------------------- | ------- | ---------------------------------------------- |
| 1         | [A-19](a-game-core.md#a-19) | KN-05   | 지도 교환 요청·수락                            |
| 2         | [A-20](a-game-core.md#a-20) | KN-06   | 교환 취소·동시 요청 처리                       |
| 3         | [A-21](a-game-core.md#a-21) | KN-07   | 지도 병합과 폐쇄 출구 필터                     |
| 4         | [A-22](a-game-core.md#a-22) | KN-08   | 교환 성공의 과거 위치 사건                     |
| 5         | [A-23](a-game-core.md#a-23) | EQ-01   | 장비 보유·설치·취소·무장                       |
| 6         | [A-24](a-game-core.md#a-24) | EQ-02   | 감지기 새 진입·단발 사건                       |
| 7         | [A-25](a-game-core.md#a-25) | EQ-03   | 덫 새 진입·유예 후보 필터                      |
| 8         | [A-26](a-game-core.md#a-26) | EQ-04   | 덫 동시 대상 선정·단발 소모                    |
| 9         | [A-27](a-game-core.md#a-27) | EQ-05   | 구속 시간·행동 제한·해제 유예                  |
| 10        | [A-28](a-game-core.md#a-28) | EQ-06   | PRODUCT_DECISION_PENDING · 사용자 결정 전 보류 |
| 11        | [A-29](a-game-core.md#a-29) | EQ-07   | PRODUCT_DECISION_PENDING · 사용자 결정 전 보류 |
| 12        | [A-30](a-game-core.md#a-30) | EQ-08   | PRODUCT_DECISION_PENDING · 사용자 결정 전 보류 |
| 13        | [A-31](a-game-core.md#a-31) | EQ-09   | PRODUCT_DECISION_PENDING · 사용자 결정 전 보류 |
| 14        | [A-32](a-game-core.md#a-32) | EX-02   | 출구 도전 시작·취소·기한                       |
| 15        | [A-33](a-game-core.md#a-33) | EX-03   | 탈출 성공·중복·포획 우선 검증                  |

### D3 · 2026-09-10 목요일

최종 흐름·실기기·Cloud·부하 검증과 결함 수정. 새 원본 작업 없이 기존 작업의 통합과 결함을 마무리한다.

| 오늘 번호 | 고정 번호        | 원본 ID      | 완료할 결과                                                                                           |
| --------- | ---------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| 1         | 기존 A 작업 후속 | 신규 ID 없음 | QA-07의 동시 Tick 실패 fixture를 재현하고 자기 규칙 모듈에서 수정한다.                                |
| 2         | 기존 A 작업 후속 | 신규 ID 없음 | C/B가 보고한 시야·지도 교환·설치·출구 불일치를 같은 seed/Tick으로 재현하고 권위 판정 회귀를 추가한다. |
| 3         | 기존 A 작업 후속 | 신규 ID 없음 | QA-08에서 발견한 금지 데이터의 원인이 core 공개 결과인지 확인하고 최소 projection 입력으로 제한한다.  |
| 4         | 기존 A 작업 후속 | 신규 ID 없음 | 실제 6대 5판에서 나온 게임 규칙 결함을 수정하고 영향받은 맵/배치·결정성 시험을 다시 실행한다.         |
| 5         | 기존 A 작업 후속 | 신규 ID 없음 | 최종 인계 commit의 맵 인증·G3 결과를 F에 남기고 미완료 원본 ID를 정리한다.                            |

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
- D가 video/track·장치를, C가 VideoTexture를 소유한다. onFaceTrack의 null은 기존 텍스처 해제 신호다. onLocalPreview는 DEVICE_CHECK용 원본 미리보기이며 게시 트랙이 아니다.

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

B는 중앙 `INVITATION_ROUTES`의 issue/revoke를 자기 session 모듈에서 구현한다. E의 `CreateOperatorAuth`로 생성한 인증 함수를 B가 `/api/operations` 전체와 초대 경로보다 앞에 적용한다. `OPS_TOKEN`은 인증 factory에만 주입하고 브라우저/protocol로 전달하지 않는다. F 운영 스크립트도 이 경로를 소비하며 별도 비인증 발급 CLI나 초대 endpoint를 만들지 않는다.

F는 `MediaConfiguration`의 projectAlias·publicWindow·officialBudgetMaxAgeMs·operationTimeoutMs를 실제 운영 입력에서 검증하고 B가 factory에 전달한다. publicWindow=null은 공개 창 미정으로 잠금이며 예시 창·예시 잔량을 실제 허용으로 쓰지 않는다. productSecurityReady는 환경의 임의 true가 아니라 B가 제품 인증·입장 보호 초기화를 확인해 주입하는 서버 내부 값이다. E는 이 값과 회수·저널·예산·창 조건을 함께 검사한다. operationTimeoutMs 이후에도 미완료 회수는 성공으로 바꾸지 않고 unknown/LOCKED와 작업 상태 조회에 남긴다. 정확한 env 매핑은 F의 시작 절차를 따르며 다른 담당은 F의 config export를 읽는다.

관측은 F가 소유하는 `MetricSample` 수집 callback을 B가 조립하여 B Tick/queue와 `MediaCoordinatorDeps.emitMetric`에 주입한다. F의 `MetricRegistry`가 name/unit allowlist를 정의하고 B/E는 같은 목록을 소비한다. atMs는 서버 monotonic ms이고 matchRef는 비식별 상관값이다. 토큰·nickname·원본 mediaIdentity·좌표·전체 객체를 label로 넣지 않는다. callback은 유계 큐에 수치/enum을 적재하며 게임 Tick이나 E 정책 실행에서 IO 대기·throw를 하지 않는다. 실제 관측 구현이 없으면 관측 인수를 완료로 기록하지 않는다.

B가 경로를 등록하고 E가 핸들러를, F가 secret 주입·배포 보호를 맡는다. 세션용 Bearer와 운영용 OPS_TOKEN을 혼용하지 않는다. 운영 명령은 실제 운영 작업을 승인받은 실행에서만 호출하며 문서 작성만으로 원격 실행하지 않는다.

B는 coordinator.getOperations()의 OperationsPort를 위임받아 submit/getSnapshot/getStatus를 각 경로에 연결한다. submit은 accepted+snapshot 또는 conflict를 즉시 반환하고 긴 작업은 E 내부 큐에서 처리한다. drain 접수 시 admission을 먼저 DRAINING으로 바꾼다. B는 입장 승인 직전에 getStatus().admission을 검사하며 await 뒤에도 재검사한다. E는 주입된 getGameActivity()의 진행 경기·연습·입장 수가 모두 0이고 회수가 확인되어야 drain을 succeeded로 바꾼다. 시간 초과는 failed로 종결하고 신규 입장 차단을 유지한다. E가 B의 Room registry를 직접 수정하거나 정의되지 않은 callback을 추가하지 않는다.

- POST /api/sessions: SessionRequest → SessionResponse. 신원은 서버가 발급하고 no-store·메모리 보관, fragment 초대는 읽은 뒤 주소에서 지운다. SessionResponse.expiresAt은 epoch ms이며 MediaGrant.expiresAt은 epoch 초다.
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
export type SessionRequest = Readonly<{ nickname: string; inviteToken: string }> &
  ({ createRoom: true; roomCode?: never } | { createRoom: false; roomCode: string });
export type SessionResponse = Readonly<{
  sessionToken: string;
  playerId: string;
  roomCode: string;
  expiresAt: number;
  protocolVersion: '0.2.0';
}>;
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
}>;
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
  httpUrl: string;
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
  namespace: string;
  opsDataDir: string;
  projectAlias: string;
  publicWindow: Readonly<{ opensAtEpochMs: number; closesAtEpochMs: number }> | null;
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

### A-01

**MP-01 · [BE] 마스터 맵 한 개와 후보 데이터**  
일정: D1 2026-09-08 · **오늘 1번**  
기획 근거: v0.0.8 **05, 10장**
선행 완료 결과: [B-01](b-game-server.md#b-01) (SV-01, D1)

**수정·생성 파일**

- `packages/game-core/src/match/map/types.ts`
- `packages/game-core/src/match/map/validate-template.ts`
- `packages/game-core/src/match/map/prepare-practice-layout.ts`
- `packages/game-core/src/match/types.ts`
- `packages/game-core/src/match/index.ts`
- `server/src/domain/index.ts`
- `server/src/domain/types.ts`
- `server/content/maps/master-v1.json`
- `server/config/tuning/mvp-v1.json`
- `server/content/maps/practice-v1.json`

**구현 순서**

1. 먼저 기존 match/types.ts의 개발용 타입과 제품 MatchState/Cell/Dir/MatchTuning/LayoutTemplate 타입을 분리하고 EXEC-CONTRACT-3 Role·상태·좌표를 적용한다. 기존 turn/tryMove/generateMaze 호출 경로는 소비자가 전환될 때까지 명시적 개발 export로 유지한다. 소문자 개발 Phase/PlayerStatus와 대문자 제품 이름이 barrel에서 충돌하면 개발 타입을 LegacyPhase/LegacyPlayerStatus처럼 명시적으로 구분하고 기존 GameSnapshot의 동작은 그대로 유지한다. 동일 이름의 export star 두 개로 우연히 하나가 선택되게 두지 않는다.
2. 32행×32열 WALL/PASSAGE 마스터와 templateId/templateVersion을 서버 JSON에 기록한다. 정규화 결과는 LayoutTemplate이며 topology, taggerRegions 3개 tuple, runnerSpawnRegions 3개 tuple, exitCandidates:WallFace[]를 가진다. 각 SpawnRegion은 regionId/cells/spawnCandidates를 유지한다. 술래의 비중첩 구역과 도망자의 분리된 외곽 후보 영역을 평면 후보 목록으로 합치지 않는다. 약 56셀 구역은 연결성을 희생하는 강제 상수가 아니다.
3. MapPreparationPort.validateTemplate(raw:unknown,source:MapSource)는 B가 원본 바이트의 SHA-256으로 계산한 templateHash와 templateId/templateVersion/variantId, 파싱 본문을 받아 MapTemplateResult를 반환한다. 성공은 `{status:'valid',template}`, 실패는 `{status:'invalid',code,path}`이며 임의 throw/null/boolean으로 소비 계약을 나누지 않는다. 행 길이·허용 셀·외곽 벽·regionId 중복·각 역할 내부 구역 중첩·비어 있는 영역/후보·후보의 해당 영역 소속·실제 통로 여부·벽면/접근 통로 인접성을 검사한다. 파일 IO·hash 계산은 B가 소유하며 클라이언트가 source를 지정하지 못하게 한다.
4. 50ms/9·6 Tick/180초 등 첫 구현값을 tuningVersion과 함께 서버 전용 JSON에 기록하고 core는 주입된 읽기 전용 설정만 사용한다. 실제 연결성·배치 인증은 MP-03–05에서 완료하므로 이 단계의 구조 검사 통과를 인증이라고 쓰지 않는다.
5. 연습용 practice-v1.json도 A가 PracticeLayoutTemplate `{practiceVersion,layouts:{runner,tagger}}` 형태로 만든다. 각 값은 같은 역할의 안정 슬롯 runner-1..3 또는 tagger-1..3이 들어 있는 정적 MatchLayout이며 exits는 빈 배열이다. 본 경기와 다른 고정 소형 통로·서로 다른 팀당 3개 시작점·술래 지형 영역을 기록하되 전체 Room/Cloud 자원을 만들지 않는다. 이동·교환·설치를 연습할 통로·내부 벽면은 있어야 하며 역할별 시작 슬롯이 서로 다른 논리 공간에 있음을 유지한다.
6. 초기 마스터 작성법도 고정한다: 외곽 x/y=0 또는31은 벽, 나머지는 통로로 시작한다. 내부 x=6/12/18/24의 y=3..28을 벽으로 바꾸되 y=7/15/23에는 통로 틈을 남겨 외곽 우회와 여러 가로 연결을 만든다. 이를 런타임 랜덤 생성기가 아닌 정적 master-v1.json으로 저장한다. 이 패턴의 배치 유효성은 아직 실측된 것이 아니므로 MP-03/04/05를 통과해야 채택한다.
7. 후보 영역 초안은 술래 {(x7..13,y12..19),(x14..20,y8..15),(x21..27,y12..19)}의 각 약56셀, 도망자 {(x1..4,y1..6),(x27..30,y1..6),(x13..19,y26..30)}로 둔다. 시작 후보는 각 영역의 실제 통로 중 유효 이웃≥2인 셀만 사용하고, 출구 후보는 내부 벽의 실제 통로에 접한 면을 열거한다. 수치 제약을 만족하는 배치를 못 찾으면 MP-05를 실패로 남기고 원문 조건을 완화하지 않는다.
8. public `preparePracticeLayout(raw,players,role)`은 공통 PracticeLayoutPort를 구현한다. 작은 맵의 양의 크기(각 축 32 이하), walkable 길이·외곽/연결성·통로인 시작점·초기 방향·역할별 3개 유일 슬롯을 검증한다. 입력 players는 지정 role의 서로 다른 1~~3명이어야 한다. 기본 문자열 순서로 현재 ID를 슬롯에 바인딩하고 미사용 슬롯/구역을 제거한 새 MatchLayout을 `{status:'ready',layout}`으로 반환한다. 오류는 `{status:'invalid',code:'INVALID_PRACTICE_LAYOUT',path}`다. 본 경기 6인·3출구·거리18/10/18~~45·구역3개 제약을 연습에 적용하지 않는다. B가 실제 ID를 채운 JSON을 새로 저장하게 하지 않는다.

**연결 계약과 경계**

- Cell 정수 x/y=0..31, side/dir=0북·1동·2남·3서. game-core는 protocol/Colyseus/SDK/시간·파일 IO를 import하지 않는다.
- 제품 facade에 필요한 공통 타입을 index.ts와 기존 server/domain re-export로 내보내며 B와 이름을 고정한다. package manifest/배포 포함 목록은 F에게 요청한다.
- LayoutTemplate/SpawnRegion/MapSource는 [공통 타입](contracts/types.ts)과 같아야 한다. 선택 전 데이터에는 playerId가 붙은 territories를 만들지 않는다. 술래 구역과 도망자 영역별 후보를 A MP-04까지 보존한 뒤 최종 MatchLayout.territories에 배정한다.
- master JSON의 내부 형식은 `{templateId,templateVersion,rows,taggerRegions,runnerSpawnRegions,exitCandidates}`로 고정한다. rows는 32×32의 WALL/PASSAGE 문자열 배열이며 정규화 시 row-major `Topology.walkable`로 바꾼다. 영역·벽면 구조는 공통 타입과 같다. JSON 자체에 자기 바이트의 hash를 넣지 않고 B의 source와 본문 ID/version 일치를 검사한다. 원본 variantId는 `r0`, topologyVersion은 원본 ID/version/variantId 조합으로 고정한다. 파일 접근이 필요한 인증 시험은 테스트에서 바이트/hash를 만들며 core 런타임에 파일 IO를 추가하지 않는다.

**시험 입력 → 기대 결과**

- 31열 행 또는 x=32 후보 -> 구조 오류와 실패 위치만 반환하며 자동 보정하지 않는다.
- 외곽 통로 또는 접근 셀이 벽인 출구 후보 -> 템플릿 로드 거절.
- 유효 32×32 후보 JSON -> 같은 정규화 결과, 입력 JSON 객체를 바꾸지 않고 seed/지형을 공개 계약에 포함하지 않는다.
- 구역 밖 spawnCandidate, 벽인 시작 후보, 중복 regionId, 3개가 아닌 영역 tuple, 서로 겹친 술래 구역 → 템플릿 거절. 정상 자료 → 영역별 cells/candidates와 MapSource 4필드가 손실 없이 남는다.
- practice의 1명/3명 같은 역할 입력 → 현재 ID만 들어 있는 독립 layout, 입력 JSON 불변. 4명·역할 혼합·중복 ID·잘못된 슬롯·벽 시작점 → invalid. 작은 연습 맵이 본 경기 거리/출구 제약 때문에 거절되지 않으며 두 역할 호출 결과의 지식/설치 상태를 공유하지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/template.test.ts`
- `packages/game-core/test/match/practice-layout.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/template.test.ts
pnpm exec vitest run packages/game-core/test/match/practice-layout.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

32×32 외곽 벽·통로·벽면·담당 구역·시작/출구 후보를 서버 전용 데이터로 만든다. 좌표·방향 참조 오류를 검출하며 임시 고정 미로와 구분한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 서버 전용 마스터 맵과 규칙 설정 정의
```

**MR 본문에 채울 변경 사항**

- 개발 미로와 제품 템플릿·설정 타입의 경계를 분리
- 외곽/좌표/벽면 참조 검증과 실패 fixture 추가

**MR 리뷰 포인트**

- 마스터가 단순 구조 유효인지 MP-05 인증까지 끝났는지 구분
- domain re-export 호환 및 서버 전용 자료 번들 경계

**완료 인계**

- B SV-01/FL-05에 LayoutTemplate/SpawnRegion/MapSource/Tuning 타입·원본 파일 메타데이터·parse 결과를 인계하고 B의 SHA-256 계산 입력이 원본 바이트임을 확인
- F에 server/content와 server/config/tuning 배포 포함, 설정 import/복사 경로 요청

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/MP-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-02

**MP-02 · [BE] 맵 회전·반전과 중복 제거**  
일정: D1 2026-09-08 · **오늘 2번**  
기획 근거: v0.0.8 **10장**  
선행 완료 결과: [A-01](a-game-core.md#a-01) (MP-01, D1)

**수정·생성 파일**

- `packages/game-core/src/match/map/transform.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. 90도 회전은 (x,y)->(31-y,x), 방향은 (dir+1)%4로 변환하고 반전은 (x,y)->(31-x,y), 동서 방향을 맞바꾼다. LayoutTemplate.topology, taggerRegions/runnerSpawnRegions 각각의 cells·spawnCandidates, exitCandidates의 벽면 side와 대응 접근 셀을 같은 transform으로 이동한다. regionId는 유지하고 변형마다 variantId를 부여한다.
2. 원본, 90/180/270도 및 각 반전의 8개 후보를 만든 뒤 정규화된 지형+구역/후보 구조의 canonical signature로 대칭 중복을 제거한다. 배열 순서에 따라 다른 signature가 생기지 않게 좌표·식별자를 정렬한다.
3. 변형 결과를 동일 구조 검증에 다시 넣고 templateId/templateVersion/templateHash는 동일 원본의 값을 유지하며 variantId와 topologyVersion의 변형 부분만 갱신한다. public createTemplateVariants(template:LayoutTemplate)는 MapVariantsResult를 반환한다. 성공은 `{status:'valid',variants}`이며 variants는 variantId순의 비어 있지 않은 배열이다. 불법 벽면 또는 외곽 훼손은 `{status:'invalid',code,path}`로 끝내며 일부만 삭제해 성공시키지 않는다.

**연결 계약과 경계**

- 좌표·방향 함수는 LayoutTemplate에만 적용하며 웹 좌표 x/z 변환을 여기서 하지 않는다.
- 여기서는 최대 8개의 검증된 LayoutTemplate 변형을 반환한다. B loader가 variantId순 정렬 후 seed(uint32)%변형 수로 한 개를 선택한다. A MP-04는 선택된 단일 변형 내부의 인원·출구만 선발하고 다시 변형하지 않는다.
- variantId는 회전 전 반전 여부와 시계방향 회전 횟수로 `r0/r1/r2/r3/mr0/mr1/mr2/mr3`을 사용한다. 중복 그룹에서는 기본 문자열 오름차순의 첫 ID를 대표로 남긴다. `validateTemplate/createTemplateVariants`는 A의 match index와 기존 server/domain 경계에서 내보내며 B가 transform 내부 경로를 import하지 않는다.

**시험 입력 → 기대 결과**

- (2,5),dir=0을 90도 회전 -> (26,2),dir=1이며 접근 셀도 같은 변환.
- 90도 회전 4회 및 반전 2회 -> 정규화 원본과 같다.
- 완전 대칭 마스터 -> 8개 미만으로 중복 제거되며 비대칭 벽면 참조는 손실되지 않는다.
- 회전·반전 후 모든 영역의 spawnCandidates가 같은 regionId의 변환된 cells 안에 있으며 실제 통로다. 원본 출처 3필드는 유지되고 variantId와 벽면 방향만 해당 변형에 맞게 바뀐다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/map-transform.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/map-transform.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

지형·벽면 방향·구역·후보를 함께 변환해 대칭 중복을 제거한다. 최대 8개 변형의 좌표·방향 일관성을 검사한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 맵 회전과 반전 변형 생성
```

**MR 본문에 채울 변경 사항**

- 벽면·시작 방향까지 포함한 D4 변환
- canonical signature 중복 제거와 역변환 시험

**MR 리뷰 포인트**

- 지형만 돌고 출구 방향이 남는 결함 여부
- 후보 배열 정렬로 의미가 바뀌지 않는지

**완료 인계**

- MP-04에 variantId별 정규화 후보 배열 제공
- B에는 내부 variantId만 기록하고 원본 seed/후보는 전송하지 않도록 인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/MP-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-03

**MP-03 · [BE] 맵 연결성과 경로 검증**  
일정: D1 2026-09-08 · **오늘 3번**  
기획 근거: v0.0.8 **10장**  
선행 완료 결과: [A-01](a-game-core.md#a-01) (MP-01, D1)

**수정·생성 파일**

- `packages/game-core/src/match/map/graph.ts`
- `packages/game-core/src/match/map/validate-connectivity.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. PASSAGE 셀을 index=y*32+x 노드로 만들고 벽 없는 상하좌우 이웃만 연결한다. BFS로 하나의 연결 성분인지 확인하고 후보 시작/출구 접근 셀 간 최단 경로 행렬을 계산한다.
2. DFS low-link/Tarjan 방식으로 articulation과 biconnected component를 구하고 시작점·출구 접근 칸이 함께 속할 수 있는 핵심 이중 연결 성분을 표시한다. 단순히 모든 칸이 연결됐다는 결과로 핵심 우회를 통과시키지 않는다.
3. 시작 후보의 통로 이웃 2개 이상, 초기 정면 통로 여부를 별도 predicate로 분리한다. 실패 이유는 서버 내부 report로 반환하고 클라이언트 설치/이동 오류에 전체 맵 정보를 넣지 않는다.

**연결 계약과 경계**

- Graph는 서버 전용 immutable topology; distance(a,b)는 경로 셀 이동 횟수, unreachable은 명시적 값으로 반환.
- MC-03 담당 E에게 distance/경로 corner-count용 topology를 제공하며 브라우저에는 graph를 주지 않는다.

**시험 입력 → 기대 결과**

- 분리된 통로 섬 1개 -> 연결 검사 실패.
- 전체 연결됐지만 출구 접근 셀이 articulation 뒤 막다른 가지 -> 핵심 성분 조건 실패.
- 시작 후보 이웃 2개지만 정면 벽 -> 초기 방향 검사 실패; 다른 유효 방향은 통과.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/map-graph.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/map-graph.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

통로 연결 요소·최단 경로·핵심 이중 연결 성분을 검사한다. 시작/출구 접근점의 핵심 성분, 시작점 유효 이웃 2개·정면 통로의 실패 사례를 검출한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 맵 연결성과 시작 경로 검증
```

**MR 본문에 채울 변경 사항**

- BFS 거리와 핵심 이중 연결 성분 계산
- 시작 후보의 이웃·정면 실패 사례 검사

**MR 리뷰 포인트**

- 거리 18이 셀 수와 간선 수 중 어떤 기준인지
- 코너/외곽에서 가짜 대각 간선이 없는지

**완료 인계**

- MP-04에 PairDistance/핵심 성분 predicate 인계
- E MC-03에 서버 전용 graph 조회 계약과 벽 우회 fixture 제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/MP-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-04

**MP-04 · [BE] 시작점·개인 출구 조합 선발**  
일정: D1 2026-09-08 · **오늘 4번**  
기획 근거: v0.0.8 **10장**  
선행 완료 결과: [A-02](a-game-core.md#a-02) (MP-02, D1), [A-03](a-game-core.md#a-03) (MP-03, D1)

**수정·생성 파일**

- `packages/game-core/src/match/map/select-layout.ts`
- `packages/game-core/src/match/random.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. LayoutSelectionInput.template의 선택된 단일 LayoutTemplate과 players, seed:uint32를 받는다. 부작용 없는 nextRandom(state)와 seeded shuffle을 한 모듈에 고정하고 후보·playerId 순서를 정렬해 같은 입력에서 같은 조합을 얻는다. 변형 목록 선택은 B가 완료했으므로 여기서 재변형하거나 template.variantId를 바꾸지 않는다.
2. 선택된 template.taggerRegions의 비중첩 3개 구역을 정확히 3명의 술래에게 seeded 무작위 배정하고 각 구역의 spawnCandidates에서 한 시작점을 선택한다. 도망자도 template.runnerSpawnRegions의 분리된 외곽 3개 영역에서 각각 하나씩 시작점을 고른다. template.exitCandidates의 벽면·접근 통로와 소유자 조합을 함께 탐색한다. 영역 소속을 검사할 수 없는 평면 spawnCandidates나 선배정 territories 입력으로 대체하지 않는다.
3. 도망자 상호 및 각 도망자-최근접 술래 거리≥18, 출구 간≥10, 개인 출구 거리18..45와 max/min≤1.3, 핵심 성분·시작 이웃·정면 조건을 모두 검사한다. 술래 상호 18셀 조건을 추가하지 않는다.
4. 유효 후보의 점수/동률 처리를 내부 설정에 고정하고 seeded 선택한다. 결과는 공통 MatchLayout의 layoutId/topology/players/exits/territories로 반환하며 territories에는 이 단계에서 배정한 술래 playerId와 해당 구역 cells를 담는다. 최종 선택된 출구별 poseKind도 seed와 안정된 소유자 순서로 한 번 배정해 완전한 MatchLayout을 반환한다. EX-01은 이 포즈를 재추첨하지 않고 보존한다. B가 입력한 원본/변형 외 지형은 반환하지 않는다. 시간/시도 중단은 MP-05가 감싼다.
5. 조합 탐색을 시작할 재현 fixture는 도망자 (2,2)/(29,2)/(16,30), 술래 (8,16)/(16,12)/(25,16), 소유자 순서별 출구 접근 (11,22)/(25,22)/(7,10), 벽면 (12,22,서)/(24,22,동)/(6,10,동)로 둔다. 이는 MP-01 초안 패턴의 계획용 거리 계산 사례다. 실제 구현의 BFS·이중연결·변형·초기정면를 모두 다시 통과해야 fallback으로 채택한다. 첫 정면은 모든 시작에서 북(0)으로 둔다.

**연결 계약과 경계**

- generateMaze/pickSpawn 개발 함수 대신 제품 선택기를 추가하고 B createMatch에 확정 Layout만 주입.
- seed와 후보 스코어는 protocol/메타데이터/일반 오류에 노출하지 않는다.
- 입력은 LayoutSelectionInput의 template/players/seed/maxAttempts/fallback만 사용한다. 출력 MatchLayout을 제외한 후보 영역·seed·MapSource/fallback 원문은 서버 내부 자료다.

**시험 입력 → 기대 결과**

- 동일 seed·정렬된 후보 집합 -> 같은 variant/6인 시작/3개 출구 배정.
- 개인 거리 18,18,24 -> 비율 1.333..으로 탈락; 20,22,26 -> 비율1.3 경계 통과.
- 술래끼리 10셀이어도 도망자 거리·나머지 조건 충족 -> 통과; 도망자-술래17셀 -> 탈락.
- 동일 LayoutTemplate·seed에서 입력 player 배열만 재정렬 → 같은 역할별 영역 배정과 시작점. 술래 3명은 서로 다른 taggerRegion, 도망자 3명은 서로 다른 runnerSpawnRegion에 배정된다. 평면 후보만으로 입력하면 구조 검증에서 실패한다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/layout-selection.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/layout-selection.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

비중첩 술래 구역 3개·6명 시작점·출구를 함께 선발한다. 술래는 자기 구역, 도망자는 외곽의 떨어진 3개 후보 영역에서 시작한다. 도망자 상호 및 각 도망자와 최근접 술래의 경로 거리≥18셀, 출구 간≥10셀, 개인 거리18–45·최대/최소≤1.3을 검증한다. seed는 서버 전용이다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 시작점과 개인 출구 조합 선발
```

**MR 본문에 채울 변경 사항**

- 시작·담당 구역·출구를 함께 검증하는 선택기
- seed 결정성과 거리/우회 경계 시험

**MR 리뷰 포인트**

- 배치 불가를 수치 완화로 숨기지 않는지
- 랜덤 호출 순서가 후보 순회 순서에 종속되지 않는지

**완료 인계**

- B FL-05에 확정 Layout·실패 report 구조 인계
- MP-05에 유효 조합 후보와 인증에 사용할 seed/변형 fixture 전달
- B가 선택한 variantId를 그대로 소비하는 단일 변형 fixture와 영역별 배정 결과를 제공한다. A selector에서 변형을 다시 선택하지 않았음을 실제 A/B 연결 시험으로 확인한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/MP-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-05

**MP-05 · [BE] 검증된 fallback과 온라인 선발 상한**  
일정: D1 2026-09-08 · **오늘 5번**  
기획 근거: v0.0.8 **10장**  
선행 완료 결과: [A-04](a-game-core.md#a-04) (MP-04, D1)

**수정·생성 파일**

- `packages/game-core/src/match/map/select-with-fallback.ts`
- `packages/game-core/src/match/map/validate-layout.ts`
- `packages/game-core/src/match/index.ts`
- `server/content/placements/master-v1-fallback.json`
- `server/config/tuning/mvp-v1.json`

**구현 순서**

1. MP-04의 실제 모든 조건을 통과한 변형별 조합을 FallbackLayout={templateId,templateVersion,templateHash,variantId,layout}으로 fallback JSON에 저장한다. 정적 layout의 players.playerId·exits.ownerId·territories.playerId는 실제 세션 ID 대신 역할별 안정 슬롯 tagger-1..3, runner-1..3을 사용한다. certifyFallback(input)은 input.template과 fallback의 출처 4필드 및 지형 일치를 먼저 확인한다. 내부 bindFallbackPlayers helper는 input.players의 역할별 playerId를 기본 문자열 오름차순으로 정렬해 슬롯 번호와 일대일 대응한다. localeCompare를 쓰지 않고 세 종류의 ID 참조를 모두 새 객체에서 치환한다. 역할별 3명·유일 ID·유효 슬롯/소유자 참조와 기존 영역·시작/출구·경로·거리 전체 제약을 재검사해 실제 플레이어 MatchLayout 또는 null을 반환한다. 공개 certifyFallback은 이 결과를 기존 LayoutSelectionResult의 selected/layout 또는 unavailable로 포장한다. 입력 JSON/players를 변경하거나 이 유한 인증 단계에 온라인 조합 탐색을 섞지 않는다.
2. selectWithFallback(input)을 EXEC-CONTRACT-3의 Generator<SelectionProgress, LayoutSelectionResult, void>로 제공한다. 각 next()는 최대 8개 후보만 검사하고 성공하면 done:true 결과, 미완료면 시도 수를 담은 SelectionProgress를 yield한다. 전체 후보 시도 상한도 적용하며 Date.now/performance.now/타이머를 호출하지 않는다.
3. B는 탐색 전 인증한 fallback 결과를 보관한다. 정상 탐색 소진이면 같은 인증 결과를 반환하고, 외부 시간 초과이면 B가 iterator.return(certifiedResult)로 닫은 결과를 사용한다. 인증 실패와 온라인 선발 실패가 겹치면 LAYOUT_UNAVAILABLE이며 부분 배치로 경기를 만들지 않는다.
4. next() 호출당 후보 수, 유한 인증 검사, return 후 탐색 중단을 순수 시험으로 검증한다. F에게 실제 인증 시험 파일을 test:maps 대상으로 인계하고, B에는 next 전후 monotonic 검사와 setImmediate 양보를 결합할 자료를 전달한다.

**연결 계약과 경계**

- [공통 타입](contracts/types.ts)의 SelectionProgress/LayoutSelectionResult와 selectWithFallback·certifyFallback 시그니처를 그대로 사용한다. A는 후보/제약 검사, B는 실제 시간 예산·파일 IO·이벤트 루프 양보를 소유한다.
- fallback 인증은 온라인 시간 상한 이전의 유한 검증 단계이며 그 비용도 B가 계측한다. 긴 동기 탐색을 setTimeout으로 중단할 수 있다고 가정하지 않는다.
- fallback은 server/content/placements에만 보관하며 package.json/루트 명령은 F 소유다.
- B는 A MP-02의 변형 중 seed로 선택한 template와 정확히 같은 MapSource의 fallback을 묶어서 전달한다. A는 원본 파일을 읽거나 hash를 다시 계산하지 않고 B가 계산한 source와 저장된 fallback source를 비교한다. 다른 variant의 fallback, 출처 누락, 지형 변경은 성공으로 인증하지 않는다.
- 정적 안정 슬롯을 현재 논리 플레이어로 바인딩하는 책임은 A다. B는 slots가 저장된 FallbackLayout과 인증된 input.players를 전달하고 selected.layout만 core에 주입한다. 정적 JSON을 매 경기 실세션 ID로 덮어쓰거나 슬롯 문자열을 플레이어 신원으로 사용하지 않는다.

**시험 입력 → 기대 결과**

- 시도 상한=0 + 유효 fallback → 인증된 조합을 반환하고 온라인 후보를 검사하지 않는다.
- 부적합 후보 17개 → next 호출별 검사 수가 8 이하이고 yield 사이에 상태를 이어 간다. 같은 입력/seed/호출 순서는 같은 결과다.
- 중간 yield 후 return(certifiedResult) → done:true와 해당 결과, 이후 next로 후보를 더 검사하지 않는다.
- 템플릿 벽 변경으로 fallback 경로 단절 + 온라인 소진 → LAYOUT_UNAVAILABLE, 과거 인증이나 부분 배치를 성공으로 재사용하지 않는다.
- templateId/templateVersion/templateHash/variantId 중 하나만 불일치 → fallback 인증 실패. 4필드는 같아도 topology가 다르거나 시작점이 배정 구역 밖이면 실패한다. 모든 변형별 유효 pair는 같은 전체 제약으로 재인증된다.
- 정적 runner-1..3/tagger-1..3와 전혀 다른 실제 6명 ID → 역할별 기본 문자열 정렬에 따라 players.playerId/exits.ownerId/territories.playerId가 모두 동일 대응으로 치환된다. input.players 배열 순서만 바꾸어도 결과는 같고 원본 fallback/players는 불변이다.
- 중복 실제 ID, 역할별 인원 오류, 없는 슬롯을 참조한 출구 또는 구역 → helper null과 공개 unavailable 결과다. 부분 치환·정적 슬롯 잔존을 성공 layout으로 넘기지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/fallback.test.ts`
- `packages/game-core/test/match/certified-maps.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/fallback.test.ts
pnpm exec vitest run packages/game-core/test/match/certified-maps.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

영역 정보를 보존한 단일 변형 입력, 출처 4필드·지형·전체 제약을 재인증한 fallback, 호출당 최대 8개 후보의 순수 Generator를 제공한다. B의 실제 시간 제한·양보 경로와 연결해 온라인 상한 도달 시 인증 fallback으로 종료하고, 유효 배치가 하나도 없으면 시작을 막는다. 실제 맵 인증을 test:maps에 연결한 결과를 별도로 기록한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 계약 fixture 통과와 실제 생산자·소비자 연결 시험 통과를 구분해 진행 기록과 MR 본문에 남긴다.

**작업 완료 커밋 제목**

```text
feat: 맵 배치 fallback과 시작 차단 적용
```

**MR 본문에 채울 변경 사항**

- 검증된 fallback 자료와 온라인 선발 상한 경로
- 템플릿 변경 후 재검증·시작 거절 시험

**MR 리뷰 포인트**

- hash/버전만 보고 전체 제약 검사를 생략하지 않는지
- next 1회에 후보 8개를 넘지 않고 core에 실제 시계·IO가 없는지
- return 후 탐색 재개 없이 인증 결과로 종료되는지

**완료 인계**

- B FL-05에 Generator·certifyFallback 타입, 17개 실패 후보/시간 중단 fixture와 반환값을 전달한다.
- F에 인증 시험 파일·실패 exit 기대값과 B–A 결합 결과를 인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/MP-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-06

**MP-06 · [BE] 필드 아이템 배치 — PRODUCT_DECISION_PENDING**  
기존 일정 식별: D1 2026-09-08 · **오늘 6번** (실행 보류)  
실행 상태: **PRODUCT_DECISION_PENDING**

**보류 사유**

도망자 아이템의 종류·효과·획득·소지·사용 방식은 아직 사용자 결정 전이다. v0.0.8의 이전 후보나 이 문서의 이전 실행 지시는 승인된 구현 요구로 사용하지 않는다. 고정 번호와 원본 ID는 추적을 위해 유지하며 현재 구현 일정·선행 조건·MVP 완료 증거로 계산하지 않는다.

**재개에 필요한 사용자 결정**

- 도망자 아이템을 이번 MVP에 포함할지와 확정 종류·효과.
- 배치 또는 지급 방식, 획득 조건, 수량과 소지 규칙.
- 사용 입력·성공/실패 조건·효과 시간·다른 게임 규칙과의 상호작용.

사용자 결정이 기록되면 이 ID의 범위·연결 계약·검수 조건을 다시 합의한 뒤 실행 계획을 작성한다. 승인 전에는 제품 타입·메시지·저장 상태·UI·시험 조건을 만들지 않는다.

### A-07

**EX-01 · [BE] 개인 출구·고정 포즈 레지스트리**  
일정: D1 2026-09-08 · **오늘 7번**  
기획 근거: v0.0.8 **11장**  
선행 완료 결과: [A-04](a-game-core.md#a-04) (MP-04, D1)

**수정·생성 파일**

- `packages/game-core/src/match/exits/registry.ts`
- `packages/game-core/src/match/types.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. Layout의 서로 다른 내부 벽면/접근 셀을 도망자3명에 1:1로 묶어 ExitRecord를 만든다. ownerId·wall{x,y,side}·approach·active와 서버 내부 poseKind를 분리해 저장한다.
2. 각 출구의 poseKind는 MP-04의 최종 선택 또는 인증 fallback의 MatchLayout에 이미 배정된 left/right/y 중 하나다. EX-01은 enum을 검증해 그대로 저장하고 matchId 동안 유지한다. 레지스트리 생성·challenge 재시도에서 두 번째 포즈 추첨을 호출하지 않는다.
3. closeExit(ownerId)는 기존 항목을 삭제해 배치를 재사용하지 않고 active=false로 원자 전환한다. 재호출은 no-op이고 KN-03이 모든 개인 지식의 활성 출구 집합을 필터링할 수 있게 변경 ID를 반환한다.

**연결 계약과 경계**

- 출구 소유권과 poseKind는 내부 registry; 술래에게 전체 registry/비활성 출구 식별자를 주지 않는다.
- 진행 도전은 EX-02, 공개 discovered exit는 KN-03/B KN-04 담당.

**시험 입력 → 기대 결과**

- 3도망자 + 3유효접근셀 -> 각각출구1개, 서로다른 접근셀.
- 동일 접근셀 출구2개 또는 외곽 벽면 -> 초기화 거절.
- 한 소유자 출구 폐쇄 두 번 및 재시도 -> 폐쇄1회, 포즈 불변, 새소유자 재배정 없음.
- MP-04의 selected.layout 또는 MP-05의 fallback layout으로 레지스트리 생성 → 출구별 poseKind가 입력과 정확히 같으며 별도 RNG 소비가 없다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exit-registry.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exit-registry.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

도망자별 내부 벽면 출구 1개와 접근 셀·방향·소유자, 3종 중 포즈를 배정한다. 포획/탈출 후 폐쇄할 수 있고 재배정·재시도로 포즈 다시 뽑기가 없다. 역할별 공개는 KN-03에서 담당한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 출구와 고정 포즈 배정
```

**MR 본문에 채울 변경 사항**

- 소유자별 내부 출구 레지스트리
- 재시도 포즈 불변과 멱등 폐쇄

**MR 리뷰 포인트**

- 벽면 방향/접근 셀 정합
- 폐쇄 시 전체 맵 topology 대신 공개 벽면 표식만 바뀌는지

**완료 인계**

- KN-03에 discoverable active registry 조회 제공
- B/C에 도전 응답 poseKind enum과 출구 공개 필드 경계 전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EX-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-08

**RL-05 · [BE] Tick별 공통 순환 우선순위**  
일정: D1 2026-09-08 · **오늘 8번**  
기획 근거: v0.0.8 **13.1장**  
선행 완료 결과: [B-01](b-game-server.md#b-01) (SV-01, D1)

**수정·생성 파일**

- `packages/game-core/src/match/priority.ts`
- `packages/game-core/src/match/random.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. 매치 생성 때 세 도망자 ID를 정렬한 뒤 MP-04와 같은 seeded shuffle 유틸로 baseOrder를 한 번 만든다. 참가자 배열 순서나 transport 수신 순서를 우선순위로 사용하지 않는다.
2. priorityForTick은 rotateLeft(baseOrder,(tick-startTick)%3)로 계산하고 candidate Set에 있는 첫 ID만 선택한다. 빈 집합은 undefined, 중복 후보는 한 번만 취급한다.
3. 덫의 동시 진입 후보를 같은 priorityForTick으로 선정하며 ACTIVE/구속/유예 필터는 호출자가 먼저 적용하도록 함수 경계를 둔다. 공통 순환 선정 함수는 유지하되 미정 콘텐츠에 대한 호출 경로나 조건을 추가하지 않는다. 추첨 결과를 공개 위치 신호로 보내지 않는다.

**연결 계약과 경계**

- baseOrder는 도망자 정확히3명의 서버 ID를 사용; Tick 상대값/범위를 검증.
- RNG 소비를 매번 반복하지 않고 매치별 baseOrder와 Tick 회전만으로 동시 후보 해결.

**시험 입력 → 기대 결과**

- baseOrder=[A,B,C],tick=startTick -> A,B후보중A; 다음Tick -> B.
- 후보 입력[B,A,B]와[A,B] -> 같은 선택.
- 덫 후보 C만 → C 선정; 다음 덫 후보 A/B → 같은 Tick 순환 우선자 선정; 빈 후보 → 장비 소모 없음.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/priority.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/priority.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

seeded shuffle한 도망자 baseOrder를 Tick마다 회전해 유효 후보 1명을 고른다. seed/Tick/후보가 같으면 입력·순회 순서가 달라도 동일하다. 덫이 이 공통 함수를 사용하며 후보 필터 이후 선정 순서를 보장한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 동시 후보의 순환 우선순위 구현
```

**MR 본문에 채울 변경 사항**

- seeded baseOrder와 Tick별회전
- 덫에서 사용하는 공통 후보 선택기

**MR 리뷰 포인트**

- 항상 session입장순서첫사람이승리하지않는지
- 후보필터가선택후실행되지않는지

**완료 인계**

- EQ-04에 selector 함수와 seed 고정 fixture 전달
- F QA-07에 순회순서교체 회귀입력 제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-09

**RL-01 · [BE] 예약 셀 이동과 벽 충돌**  
일정: D1 2026-09-08 · **오늘 9번**  
기획 근거: v0.0.8 **07장**  
선행 완료 결과: [B-01](b-game-server.md#b-01) (SV-01, D1), [A-01](a-game-core.md#a-01) (MP-01, D1)

**수정·생성 파일**

- `packages/game-core/src/match/movement.ts`
- `packages/game-core/src/match/engine.ts`
- `packages/game-core/src/match/types.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. createMatch는 CreateMatchInput의 gameInstanceId와 Layout/players/tuning으로 immutable MatchState를 만들고 stepMatch는 이전 상태를 변경하지 않는 nextState를 반환한다. 같은 matchId 아래 연습과 본 경기의 gameInstanceId를 별개로 보관한다. 큰 grid는 읽기 전용으로 공유하고 변경 플레이어/Map만 복사한다.
2. PLAYING·ACTIVE·행동잠금 없는 플레이어의 MOVE_INTENT를 방향벡터에 투영해 목적셀을 계산하고 경계/통로를 검사한다. 유효하면 kind=move,from/to의셀·dir,startTick=T,endTick=T+9를 기록하고 현재셀은 유지한다.
3. 완료 Tick에 도달한 행동을 이전상태에서 모아 완료후셀 후보를 계산한다. 한 action은 한 번만 완료하고 같은 팀 점유는 이동거절 사유로 쓰지 않는다. 멈춤 의도는 다음행동만 없애고 진행행동은 끝낸다.
4. stepMatch에 단계별 함수연결을 준비하되 아직 포획/술래 장비가 없으면 해당단계가 미구현임을 명확히 한다. 전체 MVP 검증전 상태를 제품완료로 표기하지 않는다.
5. createPractice(input)은 CreatePracticeInput의 gameInstanceId/role을 사용해 같은 순수 엔진의 practice 모드를 만든다. 팀당 최대 3명을 허용하고 이동·회전·교환·술래 장비는 재사용하되 포획·팀 승패·본 경기 deadline은 비활성화한다. mediaInstanceId/receiverGeneration은 입력받지 않는다. core 파일은 A만 수정하고 B FL-03에는 이 facade와 practice-v1 자료를 인계한다.
   - createMatch의 초기 core phase는 GAME_LOADING이고 `START_PLAYING` control로 startTick과 deadline을 한 번 확정한다. 이미 시작한 core에 같은 control을 재적용해 시간을 바꾸지 않는다. createPractice의 초기 phase는 TEAM_PRACTICE이며 본 경기용 정확히 6명·도망자 3명의 우선순위 초기화·3출구 검증을 재사용하지 않는다. practice의 역할/인원/배치 검사는 MP-01의 별도 검증 결과를 따른다. B의 LOBBY/DEVICE_CHECK/COUNTDOWN은 Room 단계이므로 core 내부에서 임의 전환 타이머를 만들지 않는다.
6. [공통 타입](contracts/types.ts)의 CorePort<State>/CoreCommand/ControlIntent/DomainEvent/MediaIntent/StepResult를 실제 export에 연결한다. StepResult.outcomes의 readonly CoreOutcome[]에는 이 step이 처리한 모든 명령의 actorId/matchId/requestId/sequence/tick/result/code를 정확히 하나씩 넣는다. applied는 권위 의도 반영·행동 예약의 수용이며 도착 보증이 아니다. 규칙 거절은 rejected와 안전한 code를 내고 그 명령으로 인한 게임 상태 변경을 남기지 않는다. 내부 control에는 사용자 요청 outcome을 만들지 않는다.
7. getPlayerSelf/getVisibleSurfaces/getFrame을 CorePort의 실제 읽기 전용 selector로 export해 B가 내부 State 구조를 추측하지 않게 한다. getPlayerSelf의 loading은 core에서 null이며 B가 자기 로딩 장벽의 LoadingView를 허용 목록으로 결합한다. B가 보관한 기존 serverTick을 stepMatch 입력으로 주입해 practice→game 전환 뒤에도 Action 시각이 이어지게 한다.
8. 실제 move 완료가 확정된 Tick에 DomainEvent {type:SPATIAL_SOUND,sound:{eventId,tick,kind:footstep,cell:완료 셀,sourcePlayerId:이동자 ID}}를 한 번 생성한다. eventId는 matchId/gameInstanceId/Tick과 결정적 일련번호로 다른 논리 공간의 사건과 충돌하지 않게 만들고 완료 재평가·중복 명령으로 재발행하지 않는다. 예약 시작·벽 거절·제자리 회전은 발소리 사건을 만들지 않는다.

**연결 계약과 경계**

- Action={kind,from:{x,y,dir},to:{x,y,dir},startTick,endTick}; cell.x/y정수,Three z변환은C담당.
- B CommandAdapter가 인증 세션에서 actorId를 CoreCommand에 주입한다. CoreCommand는 원본 matchId/requestId/sequence를 유지하며 core는 wire·실제 시계·SDK를 읽지 않는다.
- 순수 예약 이동은 SV-01의 확정 좌표/시간 계약과 MP-01 자료로 구현한다. SV-04의 실제 서버 Tick 연결을 기다리는 역의존은 두지 않는다. B의 Tick 어댑터 결합은 B-04/FL-05와 G3에서 확인한다.
- A의 CoreOutcome에는 인증 actorId를 포함하고 stateVersion을 넣지 않는다. B가 실제 수신자의 적용 가능한 개인 뷰 버전을 붙여 command-outcome으로 전달한다. 액션 후속 완료·기한 만료 사건은 이미 종결된 원래 명령에 두 번째 outcome을 만들지 않는다.
- SPATIAL_SOUND의 cell/sourcePlayerId는 서버 전용이다. B가 sound만 TrustedMediaFrame.events에 담아 E로 넘기며, E가 수신자별 audio-policy로 변환한다. 지도 표식 사건이나 클라이언트 원좌표 메시지로 재사용하지 않는다.
- getFrame의 CoreReadFrame.gameInstanceId는 상태 생성 때 주입한 논리 게임 ID를 그대로 반환한다. A는 미디어 ID·브라우저 revision을 만들지 않는다. B가 이 ID를 현재 수신자의 GameViewScope와 대조하고 PrivateView/PrivateEvent에 scope를 붙인다.

**시험 입력 → 기대 결과**

- T=10에서(3,3)북향전진,목적통로 -> T18까지(3,3),T19에(3,2).
- 정면벽 또는 x=0에서서향이동 -> action미생성,위치불변.
- 같은팀이목적셀점유+유효이동 -> 이동허용;중간null의도 -> 현행이동완료후정지.
- practice mode의 같은 팀 3명 이동·술래 장비 사용 -> 실제 규칙 함수로 진행하되 접촉 포획·180초 팀 승패는 만들지 않고 game mode와 상태를 공유하지 않는다.
- 이동 예약 수용 → 같은 requestId의 applied 1개와 action; 벽 이동 규칙 거절 → rejected 1개와 명령 적용 전후 게임 상태 동일. 다른 명령과 Tick의 자연 경과는 별도로 비교한다.
- getFrame/getPlayerSelf/getVisibleSurfaces 호출 → 이전 State 변경 없음; LoadingView는 core가 미디어 세대를 추측해 만들지 않는다. 라운드 Tick 500에서 game state의 첫 step → frame.tick=500, 이후 예약 start/end도 같은 시간축이다.
- T10 예약/T19 완료 → T10~18 음향 사건 없음, T19 footstep 한 개와 완료 셀; 같은 완료 재평가·벽 거절·TURN → 추가 발소리 없음.
- 같은 matchId/Tick의 팀별 practice 두 개와 본 경기 state → 각각 주입한 gameInstanceId가 frame에 보존되고 좌표·지식·사건이 섞이지 않는다. 미디어 재연결 자체는 core gameInstanceId나 상태 초기화를 유발하지 않는다.
- 새 createMatch에 START_PLAYING(startTick=500) → 최초 PLAYING과 deadline=4100. 동일 control 재전달 → 두 값 유지. tagger-only/runner-only의 createPractice(1~3명) → 해당 역할 연습 생성, 6인/3출구 불변식의 잘못된 적용 없음.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/movement.test.ts`
- `packages/game-core/test/match/practice-mode.test.ts`
- `packages/game-core/test/match/command-outcomes.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/movement.test.ts
pnpm exec vitest run packages/game-core/test/match/command-outcomes.test.ts
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/game-core/test/match/practice-mode.test.ts
```

**완료 조건**

전후진 한 칸을 9 Tick 행동으로 예약하고 완료 때 셀을 바꾼다. 벽·경계 이동을 거절하되 같은 팀 셀 공유는 허용한다. 입력 중단은 시작한 한 칸을 마친 뒤 적용한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 서버 예약 셀 이동 구현
```

**MR 본문에 채울 변경 사항**

- 9Tick행동과벽충돌
- 입력state불변과동료셀공유
- 이동 완료의 단발 SPATIAL_SOUND와 예약/회전 무음 회귀

**MR 리뷰 포인트**

- 기존즉시tryMove호환경로와제품stepMatch분리
- 완료전셀변경/스텁성공주장없음

**완료 인계**

- B SV-04에createMatch/stepMatchfacade와CoreCommandfixture전달
- C VI-02에from/to와start/endTick샘플state인계
- B/C에 실제 core가 만든 정상 예약·벽 거절 CoreOutcome을 전달하고, 문서 fixture만 검증한 단계와 실제 B–C pending 종결 연결 결과를 구분한다.
- B SV-04/E MC-03에 실제 이동 완료가 만든 SpatialSoundEvent fixture를 전달해 core→Room→audio-policy 경계를 함께 검사한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-10

**RL-02 · [BE] 예약 90도 회전**  
일정: D1 2026-09-08 · **오늘 10번**  
기획 근거: v0.0.8 **06, 07장**  
선행 완료 결과: [A-09](a-game-core.md#a-09) (RL-01, D1)

**수정·생성 파일**

- `packages/game-core/src/match/rotation.ts`
- `packages/game-core/src/match/engine.ts`
- `packages/game-core/src/match/types.ts`

**구현 순서**

1. TURN left/right를현재dir의-1/+1 mod4로변환하고같은셀의from/to방향만다른6Tick행동을예약한다. 회전은이동action과동시에실행하지않는다.
2. 이동중새회전의도는RL-03단일대기슬롯에들어갈수있지만현재이동의논리dir를바꾸지않는다. 회전완료T에만dir를커밋한다.
3. 회전완료시점의가상카메라보간은from/to의최단90도경로를지원하도록방향을제공한다. 3->0회전을270도역회전으로해석할수있는값을추가로발명하지않는다.

**연결 계약과 경계**

- move/turn은동일Action유형;turn from/to cell은같고dir만다르다.
- 회전시간6Tick/300ms. 키반복·중립복귀는D담당,서버는연속명령으로무제한큐를허용하지않는다.
- 수용된 명령마다 stepMatch의 CoreOutcome을 정확히 하나 반환한다. 현재/다음 행동 슬롯 또는 유지 의도에 유효하게 반영되면 applied, 규칙 거절이면 rejected다. 이후 슬롯 교체·TTL 만료가 이미 종결된 요청의 추가 outcome을 만들지 않는다.

**시험 입력 → 기대 결과**

- dir3우회전T10예약 -> T15 dir3,T16 dir0.
- dir0좌회전 -> dir3,전후좌표불변.
- 이동중TURN수신 -> 현재from/to·dir불변,대기행동만RL-03정책으로처리.
- 서로 다른 requestId의 유효 입력과 금지 입력 → 각 요청에 applied/rejected 한 개씩; 같은 명령을 다시 실행해 상태를 바꾸지 않으며 내부 EXPIRE_MOVE에는 사용자 outcome을 생성하지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/rotation.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/rotation.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

회전을 6 Tick으로 처리하고 이동 도중 논리 방향을 바꾸지 않는다. 시작/완료 Tick과 방향이 서버 상태에 기록되어 같은 입력이 같은 결과를 낸다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 예약 회전과 방향 상태 동기화
```

**MR 본문에 채울 변경 사항**

- 6Tick회전완료단일반영
- 이동중방향고정과0/3경계

**MR 리뷰 포인트**

- 라디안/dir단위혼용
- 변경한방향이현재이동목적지를바꾸지않는지

**완료 인계**

- D IN-08에turn의도와버퍼제약전달
- C VI-02에북/서경계회전fixture제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-11

**RL-03 · [BE] 다음 행동 한 칸 버퍼와 입력 TTL**  
일정: D1 2026-09-08 · **오늘 11번**  
기획 근거: v0.0.8 **06, 07.1, 07.2장**  
선행 완료 결과: [B-03](b-game-server.md#b-03) (SV-03, D1), [A-10](a-game-core.md#a-10) (RL-02, D1)

**수정·생성 파일**

- `packages/game-core/src/match/input-buffer.ts`
- `packages/game-core/src/match/engine.ts`
- `packages/game-core/src/match/types.ts`

**구현 순서**

1. 플레이어마다진행action외nextAction1개와heldMove의도를분리한다. 새회전/이동의도는명시한단일슬롯교체정책을따르고누적배열을만들지않는다. 같은sequence는B에서걸러진전제로core도중복적용안전성을검사한다.
2. B가실제monotonic수신시각으로10Hz유지갱신과500ms만료를검사해EXPIRE_MOVE control을주입하면heldMove/다음이동의도만제거한다. 시작한action은절대되돌리지않는다.
3. 행동완료후다음슬롯을한번소비하고heldMove가유효하면다음이동을새로예약한다. TTL검사는Tick이아닌B실제시각에서매Tick직전수행하며catch-up으로과거의도를부활시키지않는다.
4. 명령/만료가같은Tick에들어오면B의확정수신순서와최신유효의도를기준으로처리하고단순배열정렬로만료뒤구명령을복원하지않도록control에대상sequence를포함한다.

**연결 계약과 경계**

- Core ControlIntent EXPIRE_MOVE는playerId와만료대상sequence를가진다;B와구조고정후적용.
- 보류행동교체정책:새유효단발의도가다음슬롯을대체하며heldMove와충돌하면단발을먼저1회소비;이정책을B/D와동일계약으로인계.
- 수용된 명령마다 stepMatch의 CoreOutcome을 정확히 하나 반환한다. 현재/다음 행동 슬롯 또는 유지 의도에 유효하게 반영되면 applied, 규칙 거절이면 rejected다. 이후 슬롯 교체·TTL 만료가 이미 종결된 요청의 추가 outcome을 만들지 않는다.

**시험 입력 → 기대 결과**

- 연속TURN20개수신중action실행 -> 대기슬롯최대1,20회후행큐없음.
- 이동중EXPIRE_MOVE -> 현재9Tick완료,그다음전진없음.
- 구sequence만료control뒤신sequence유효갱신 -> 신의도유지;2초정지후만료intent -> 재생없음.
- 서로 다른 requestId의 유효 입력과 금지 입력 → 각 요청에 applied/rejected 한 개씩; 같은 명령을 다시 실행해 상태를 바꾸지 않으며 내부 EXPIRE_MOVE에는 사용자 outcome을 생성하지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/input-buffer.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/input-buffer.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

다음 행동은 최대 1개만 보관한다. 유지 의도 10Hz·수신 후 500ms TTL을 검사하며 끊긴 입력·키 연타·catch-up에서 무한 이동이나 만료 의도 재실행이 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 단일 행동 버퍼와 이동 의도 만료 처리
```

**MR 본문에 채울 변경 사항**

- held intent와단발대기행동분리
- B단조시계만료control적용

**MR 리뷰 포인트**

- core가시간을직접읽지않는지
- 새갱신을오래된EXPIRE_MOVE가취소하지않는지

**완료 인계**

- B SV-03/05에EXPIRE_MOVE필드·순서fixture인계
- D IN-07/08에10Hz갱신/null정지·단발다음슬롯정책전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-12

**RL-04 · [BE] 동시 이동과 접촉·교차 포획**  
일정: D1 2026-09-08 · **오늘 12번**  
기획 근거: v0.0.8 **07장**  
선행 완료 결과: [A-11](a-game-core.md#a-11) (RL-03, D1)

**수정·생성 파일**

- `packages/game-core/src/match/capture.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. Tick시작플레이어셀과같은Tick에완료할모든move를따로보관하고전체완료후셀을한번계산한다. 플레이어순회중다른사람좌표를읽으며순차충돌을계산하지않는다.
2. 완료후동일셀의활동술래-도망자쌍과양측이같은Tick서로의이전셀을맞바꾼쌍을포획후보로모은다. 한도망자가여러술래와접촉해도runnerId집합으로1회처리한다.
3. 포획을 술래 장비 발동/포즈 성공보다 먼저 커밋하고 종료 후보를 후속 단계에서 제외한다. 포획 계산의 좌표/술래 ID는 core 내부에만 보관하며 B에는 허용된 self/가시 상태/counts selector와 RETIRE_PLAYER 의도를 제공한다. 전체 포획 정보를 broadcast하는 별도 사건을 만들지 않는다.

**연결 계약과 경계**

- 같은셀/셀교차외인접·대각·벽너머포획없음. 같은팀은접촉해도포획없음.
- 기존checkCapture이름은제품기준검증facade로연결하되개발snapshot형식과섞지않는다.

**시험 입력 → 기대 결과**

- 술래와도망자가같은TickA<->B셀교환 -> 도망자포획1회.
- 둘이대각선/직교인접으로완료 -> 미포획.
- 두술래가같은도망자셀로완료 -> CAPTURED1회,counts1증가,순회순서역전결과동일.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/capture.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/capture.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

이전 상태에서 이동 완료를 일괄 계산한 뒤 같은 셀 점유·서로 셀 교환만 포획한다. 인접·대각·벽 너머는 포획하지 않으며 입력 배열 순서가 결과를 바꾸지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 동시 이동의 접촉과 교차 포획 판정
```

**MR 본문에 채울 변경 사항**

- 완료셀일괄계산과교차검사
- 다중접촉중복포획방지

**MR 리뷰 포인트**

- 발동/획득/탈출보다포획이먼저인지
- 이전/완료상태를혼합하지않는지

**완료 인계**

- B SV-04와F QA-07에동시완료fixture인계
- C에는허용된개인결과사건만B를통해전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-13

**RL-06 · [BE] 팀 승패와 마감 Tick**  
일정: D1 2026-09-08 · **오늘 13번**  
기획 근거: v0.0.8 **04, 07장**  
선행 완료 결과: [A-12](a-game-core.md#a-12) (RL-04, D1)

**수정·생성 파일**

- `packages/game-core/src/match/result.ts`
- `packages/game-core/src/match/engine.ts`
- `packages/game-core/src/match/types.ts`

**구현 순서**

1. 도망자3명상태로ACTIVE/ESCAPED/CAPTUREDcounts를산출하고탈출≥2또는포획≥2면승자를고정한다. 2+2같은불가능누계는무승부로정상화하지말고내부불변식위반으로시험실패시킨다.
2. PLAYING startTick부터deadlineTick=startTick+3600을사용한다. T=deadline인예약완료·포획·술래장비·포즈단계를먼저처리하고그후탈출2명미만이면술래시간승으로확정한다.
3. RESULT/ABORTED면stepMatch의새입력/발동/점수사건을차단하고기존result를유지한다. 과부하/미디어실패ABORTED는술래승리counts로변환하지않는다.

**연결 계약과 경계**

- result는team winner와종료reason,개인결과를분리;B공개Schema변환은B책임.
- 동일deadlineTick에서정상승패확정뒤연결상실은소급무효화하지않는다.
- terminal 판정 뒤 이 step에서 아직 처리되지 않은 수용 명령은 원래 요청 식별자를 유지한 canceled/ROUND_ENDED CoreOutcome으로 끝낸다. 이미 applied/rejected인 요청을 다시 취소하지 않는다. B 큐에 아직 남은 요청의 취소는 B가 같은 기준으로 수행한다.

**시험 입력 → 기대 결과**

- ESCAPED2/CAPTURED0 -> 도망자즉시승.
- ESCAPED1/CAPTURED1/ACTIVE1,T<deadline -> 진행;T=deadline마지막미탈출 -> 술래승.
- deadlineTick도전성공과접촉동시 -> 포획우선,이후시간승패;이미RESULT추가입력 -> 상태/사건불변.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/result.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/result.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

탈출 2명/포획 2명/3,600 Tick 종료를 판정한다. deadline과 같은 완료 행동까지 포획 우선 처리하고 종료 뒤 사건을 추가하지 않는다. 탈출 구현 전에는 합성 종료 상태로 규칙을 검사한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 팀 승패와 라운드 마감 판정
```

**MR 본문에 채울 변경 사항**

- 2명승리와180초마감
- terminal후효과차단과무효분리

**MR 리뷰 포인트**

- deadline동일Tick유효행동누락없음
- 불가능counts를정상결과로숨기지않는지

**완료 인계**

- B FL-06/08에start/deadline및result계약인계
- F QA-07에마감Tick동시사건fixture전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-14

**RL-07 · [BE] 개인 종료·출구 폐쇄의 단일 확정**  
일정: D1 2026-09-08 · **오늘 14번**  
기획 근거: v0.0.8 **04, 11, 24장**  
선행 완료 결과: [A-13](a-game-core.md#a-13) (RL-06, D1), [A-07](a-game-core.md#a-07) (EX-01, D1)

**수정·생성 파일**

- `packages/game-core/src/match/participation.ts`
- `packages/game-core/src/match/exits/registry.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. terminateRunner(state,id,outcome)는ACTIVE에만적용해개인status와counts를한번확정한다. 해당플레이어action/heldMove/nextAction/교환/도전을지우고worldactiveentity집합에서제외하되매치기록은보존한다.
2. 소유자출구를비활성화하고모든도망자의knownActiveExits를활성registry로다시걸러mapVersion을변경한다. 술래에게폐쇄전출구존재를알리는별도사건을보내지않는다.
3. MediaIntent {type:RETIRE_PLAYER,playerId,reason:personal-ended}와 selector의 EndedSelf를 반환한다. B가 개인 결과를 self와 counts로 전달하도록 하고 공통 EventPayloads에 없는 개인 결과 사건을 임의 추가하지 않는다. 진행 중 challenge가 종료되면 정의된 EXIT_CHALLENGE_ENDED 사건을 사용한다. 원격 회수 성공 flag를 core에서 세우거나 Cloud 작업을 await하지 않는다.

**연결 계약과 경계**

- ESCAPED와CAPTURED배타적;terminal기록은client/session객체수명과분리.
- 퇴장/회수뒤에도counts와출구폐쇄가유지되어야하며개인뷰는최소self+공개counts로축소.
- 개인 종료된 actor 본인의 미처리 수용 명령만 canceled/NOT_ACTIVE CoreOutcome으로 끝낸다. 다른 활동자의 명령은 계속 처리하며 이미 applied/rejected인 요청을 재취소하지 않는다. 팀 매치까지 종료되면 RL-06의 ROUND_ENDED 정책을 적용하고, B 큐에 남은 요청은 B가 동일한 대상 범위로 정리한다.

**시험 입력 → 기대 결과**

- ACTIVE->CAPTURED후ESCAPED호출 -> 최초결과유지,counts추가없음.
- 출구를알던도망자3명중소유자종료 -> 세개지식에서표식제거,지형기억은유지.
- 같은종료의도반복 -> media retire키동일/멱등,트랙회수성공이라고보고하지않음.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/participation.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/participation.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

ACTIVE에서 결과를 한 번만 확정하고 캐릭터·입력을 제거하며 출구를 일반 벽으로 닫는다. 누계·출구 레지스트리를 유지하고 미디어 종료 의도를 발생시킨다. 실제 회수 성공은 MC-07/OP-04에서 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 종료와 출구 폐쇄 원자 처리
```

**MR 본문에 채울 변경 사항**

- terminal결과/누계/출구/행동일괄전환
- 미디어회수의도와원격결과분리

**MR 리뷰 포인트**

- 세션삭제에매치기록이따라삭제되지않는지
- 공개이벤트에출구·생존좌표가섞이지않는지

**완료 인계**

- B KN-04/RLadapter에terminalprojection조건인계
- E MC-07에retire의도키와중복호출fixture전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-15

**RL-08 · [BE] 활동자와 개인 종료자의 이탈 구분**  
일정: D1 2026-09-08 · **오늘 15번**  
기획 근거: v0.0.8 **04, 07.1, 24, G3-A장**  
선행 완료 결과: [A-14](a-game-core.md#a-14) (RL-07, D1), [B-10](b-game-server.md#b-10) (SV-06, D1)

**수정·생성 파일**

- `packages/game-core/src/match/disconnection.ts`
- `packages/game-core/src/match/engine.ts`
- `packages/game-core/src/match/types.ts`

**구현 순서**

1. B가 전달한 ControlIntent {type:CONNECTION_LOST,playerId}를 즉시 승패 함수 앞에서 적용하지 말고 해당 Tick의 예약 행동·개인 종료·정상 승패 뒤에 평가한다. {type:ABORT_MATCH,reason:SERVER_TICK_OVERLOAD}는 별도 과부하 보호 단계로 구분한다.
2. 마지막상태가ESCAPED/CAPTURED인도망자는접속표시만해제하고counts/출구/결과를남긴다. ACTIVE도망자또는활동술래이면GAME_CONNECTION_LOST로ABORTED와전체회수의도를생성한다.
3. 진행매치중새세션을기존playerId로복원하거나슬롯을새사람에게배정하는도메인경로를거절한다. nextRound충원은B FL-08의새matchId에서만허용한다.

**연결 계약과 경계**

- ControlIntent는신뢰된server발생만허용하며클라이언트command에이탈대상ID를받지않는다.
- RESULT가같은Tick먼저확정되면이후연결상실은result를바꾸지않는다.
- terminal 판정 뒤 이 step에서 아직 처리되지 않은 수용 명령은 원래 요청 식별자를 유지한 canceled/ROUND_ENDED CoreOutcome으로 끝낸다. 이미 applied/rejected인 요청을 다시 취소하지 않는다. B 큐에 아직 남은 요청의 취소는 B가 같은 기준으로 수행한다.

**시험 입력 → 기대 결과**

- 첫ESCAPED도망자연결종료 -> 나머지경기계속,탈출count1유지.
- ACTIVE도망자연결종료 -> ABORTED/GAME_CONNECTION_LOST,술래승리로기록안함.
- 같은Tick도망자포획+연결종료 -> CAPTURED먼저확정,해당이탈로무효없음;정상승리뒤close도결과유지.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/disconnection.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/disconnection.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

종료자 이탈은 누계·출구를 유지하고 남은 경기를 계속한다. 활동자 이탈은 ABORTED이며 같은 Tick 개인 종료·정상 승패 확정을 먼저 반영한다. 진행 중 재접속·충원은 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 종료자와 활동자 이탈 정책 적용
```

**MR 본문에 채울 변경 사항**

- 연결수명과매치결과분리
- 동일Tick종료/이탈우선순위

**MR 리뷰 포인트**

- 과부하즉시중단과일반이탈후순위가섞이지않는지
- 진행중충원/재접속차단

**완료 인계**

- B onLeave는playerMap삭제대신control주입하도록인계
- F QA-07에종료+close동시fixture제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/RL-08.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-16

**KN-01 · [BE] 서버 시야·벽면 관찰 판정**  
일정: D1 2026-09-08 · **오늘 16번**  
기획 근거: v0.0.8 **08장**  
선행 완료 결과: [A-01](a-game-core.md#a-01) (MP-01, D1), [A-10](a-game-core.md#a-10) (RL-02, D1)

**수정·생성 파일**

- `packages/game-core/src/match/vision/visibility.ts`
- `packages/game-core/src/match/vision/raycast.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. 현재Tick진행action의from/to를보간해서버가상카메라위치/방향을구한다. 완료셀만사용하거나클라이언트자유FOV를받지않고셀크기1·수평80도·전방3셀을적용한다.
2. 통로는중심과안쪽모서리,벽면은면중심과가장자리표본을만든다. 각표본에범위·각도검사후gridDDA를실행해최초막는벽면까지만허용하고격자꼭짓점동률에서는벽틈새누출이없게양축차폐를검사한다.
3. visibleCells와visibleWallFaces를분리해반환하고,엔티티현재위치도같은가시성판정으로필터한다. 벽한면을봤다고네면이나뒤통로를공개하지않는다.
4. 회전0/3경계·부분코너·이동보간경계fixture를고정해B/C에공통기대마스크를전달한다. 시야수치튜닝은한판안에서변경하지않는다.

**연결 계약과 경계**

- wallface={x,y,side};knownTerrain의wall항목도side필수. private-view에현재visibleCells/visibleWallFaces추가하기로공통계약확정.
- public시야마스크와영구knownTerrain는서로다른집합;서버내부전체grid는노출금지.
- 가시 엔티티는 EXEC-CONTRACT-3의 player/sensor/trap discriminated union을 사용한다. 관찰 가능한 sensor에는 접근 cell과 실제 wall:{x,y,side}가 필수이며 dir로 부착 면을 추측하지 않는다. trap에는 wall을 넣지 않는다.

**시험 입력 → 기대 결과**

- 벽앞에서북쪽벽남면관찰 -> 해당wallface만보이고북면/뒤통로없음.
- 전방3셀안이지만40도수평경계밖표본 -> 미가시.
- 코너회전중부분노출 -> 통과표본이있는셀/면만공개;입력순서동일시같은마스크.
- 다른 술래가 설치한 감지기를 유효 시야로 관찰 → 실제 wall x/y/side를 포함한 sensor 반환; 시야 밖 또는 가림 뒤 → 엔티티 없음. 다른 술래의 전체 장비 목록을 복사하지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/visibility.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/visibility.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

행동 보간 위치/방향으로 전방 3셀·수평 80도와 표본별 DDA를 검사한다. 처음 만나는 벽면만 공개하고 벽 뒤 통로·뒷면을 함께 공개하지 않는다. 코너·이동·회전 사례를 고정한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 서버 시야와 벽면 차폐 판정
```

**MR 본문에 채울 변경 사항**

- 표본별FOV와gridDDA
- 현재셀/벽면마스크분리

**MR 리뷰 포인트**

- 벽뒷면과코너대각구멍으로정보가새지않는지
- 보간시점과C카메라가같은Tick자료를쓰는지

**완료 인계**

- B KN-04에visibleCells/visibleWallFaces와엔티티필터함수인계
- C VI-03에코너/왕복/0-3회전fixture와카메라기준제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/KN-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-17

**KN-02 · [BE] 개인 지형 지식 초기화·누적**  
일정: D1 2026-09-08 · **오늘 17번**  
기획 근거: v0.0.8 **08, 09장**  
선행 완료 결과: [A-16](a-game-core.md#a-16) (KN-01, D1), [A-04](a-game-core.md#a-04) (MP-04, D1)

**수정·생성 파일**

- `packages/game-core/src/match/knowledge/terrain.ts`
- `packages/game-core/src/match/types.ts`
- `packages/game-core/src/match/index.ts`

**구현 순서**

1. PlayerKnowledge를floor셀Set과wallfaceSet으로나누고도망자는자기셀+첫실제시야,술래는자기담당구역의지형+첫시야로초기화한다. 구역전달자료는플레이어/출구/설치물정보를포함하지않는다.
2. 매Tick KN-01결과의실제관찰셀/벽면만union하고동일관찰에서는mapVersion을올리지않는다. 탐색이사라져도지형기억은남기되현재가시성마스크와혼합하지않는다.
3. getPlayerKnowledge(state,playerId)는복사/읽기전용projection재료만반환하고서버전체map참조를외부에노출하지않는다. 다른플레이어현재셀·경로·발자국은지식자료에추가하지않는다.

**연결 계약과 경계**

- knownTerrain 전체메시지는replace지만core지식은누적;wall 항목 side 포함.
- mapVersion은지형지식또는활성출구집합변경때증가하고stateVersion과별도관리.

**시험 입력 → 기대 결과**

- 첫도망자초기화 -> 담당구역전체가아닌자기셀+첫시야만존재.
- 술래자기구역전체공개 -> 지형만존재,그안도망자좌표는없음.
- 동일시야반복 -> mapVersion불변;새벽면1개관찰 -> 기존지식보존+version1증가.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/terrain-knowledge.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/terrain-knowledge.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

도망자는 자기 셀+첫 시야, 술래는 담당 구역 지형+첫 시야로 시작한다. 직접 관찰한 통로·벽면만 누적하며 구역 지식으로 타인 위치가 드러나지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 지형 지식 초기화와 누적
```

**MR 본문에 채울 변경 사항**

- 역할별시작지식과관찰union
- 벽면단위mapVersion관리

**MR 리뷰 포인트**

- 현재가시성과과거지식을혼동하지않는지
- 지식객체에위치이력이나다른사람상태가들어가지않는지

**완료 인계**

- B KN-04에PlayerKnowledge와정렬된wire변환기준인계
- C KN-09에는고정방향지도자료와mapVersion증분사례전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/KN-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-18

**KN-03 · [BE] 출구 발견·소유자 공개 범위**  
일정: D1 2026-09-08 · **오늘 18번**  
기획 근거: v0.0.8 **09, 11장**  
선행 완료 결과: [A-16](a-game-core.md#a-16) (KN-01, D1), [A-07](a-game-core.md#a-07) (EX-01, D1), [A-14](a-game-core.md#a-14) (RL-07, D1)

**수정·생성 파일**

- `packages/game-core/src/match/knowledge/exits.ts`
- `packages/game-core/src/match/exits/registry.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. 현재visibleWallFaces와활성ExitRecord의wallface를정확히매칭해ACTIVE도망자에게exitId를기록한다. 접근셀이나옆면을봤다는이유로발견시키지않는다.
2. getPlayerKnowledge의knownActiveExits는발견ID와현재active레지스트리의교집합만반환한다. 도망자는다른소유자출구도발견/공유할수있지만술래에는필드자체를비워역할·위치추론을막는다.
3. RL-07폐쇄시기존발견ID를유지하더라도공개활성집합에서즉시삭제하고mapVersion을올린다. 발견/폐쇄오류응답에숨은출구존재를암시하는서로다른코드를넣지않는다.

**연결 계약과 경계**

- 공개출구={exitId,ownerId,wall:{x,y,side},approach:{x,y}};poseKind는도전시해당소유자에게만별도전달.
- 관찰지형과출구발견은별개;술래지도에는일반벽으로만남는다.

**시험 입력 → 기대 결과**

- 출구wall남면만보이고출구는동면 -> 미발견.
- 도망자B가A소유활성출구직접관찰 -> exitId/ownerA공개,사용권은없음.
- 소유자종료후과거지도교환 -> 폐쇄출구표식재등장없음;술래초기/갱신뷰엔출구없음.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exit-knowledge.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exit-knowledge.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

직접 보인 벽면의 활성 출구만 도망자에게 발견·소유자를 공개한다. 술래에는 존재·위치를 보내지 않고 폐쇄 시 모든 도망자의 표식에서 제거한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 개인 출구 발견과 공개 범위 적용
```

**MR 본문에 채울 변경 사항**

- 벽면관찰기반출구발견
- 폐쇄레지스트리재필터와역할별미전송

**MR 리뷰 포인트**

- 출구의보이지않는면에서발견되지않는지
- 폐쇄정보가술래에게새단서로가지않는지

**완료 인계**

- B KN-04에역할별출구필드허용목록전달
- KN-07에폐쇄출구교집합함수공유

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/KN-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-19

**KN-05 · [BE] 지도 교환 요청·수락**  
일정: D2 2026-09-09 · **오늘 1번**  
기획 근거: v0.0.8 **09장**  
선행 완료 결과: [A-17](a-game-core.md#a-17) (KN-02, D1), [A-18](a-game-core.md#a-18) (KN-03, D1), [B-02](b-game-server.md#b-02) (SV-02, D1)

**수정·생성 파일**

- `packages/game-core/src/match/exchange/session.ts`
- `packages/game-core/src/match/types.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. EXCHANGE_REQUEST는 연결에서 결정한 actor와 target 모두 ACTIVE 도망자인지 확인하고 동일 셀 또는 벽 없는 직교 인접 셀인지 검사한다. knownTerrain와 활성 출구의 합집합에 적어도 한쪽의 새 정보가 있는지도 확인한다.
2. 요청을 승인하면 exchangeId, fromPlayerId=actorId, toPlayerId=targetPlayerId, requestedTick, expiresAtTick=T+40을 저장한다. 요청 대상에게만 수락 안내 사건을 내고 지도 병합이나 술래 흔적 사건은 만들지 않는다.
3. EXCHANGE_ACCEPT는 해당 exchangeId의 toPlayerId만 보낼 수 있으며 현재 상태·거리·기한을 다시 검사한다. 성공하면 KN-07 병합 단계에 검증된 쌍을 넘기고 해당 요청 ID는 다시 사용할 수 없게 한다.
4. 요청 생성 성공은 EXCHANGE_REQUEST의 applied outcome, 자격 실패는 rejected outcome을 반환한다. 수락은 KN-07의 실제 병합 성공/거절을 확인한 뒤 해당 EXCHANGE_ACCEPT 요청을 한 번 종결한다. 양쪽 self.exchange에는 {exchangeId,fromPlayerId,toPlayerId,direction,expiresAtTick}를 만들 자료를 제공하며 요청자는 outgoing, 대상자는 incoming이다.

**연결 계약과 경계**

- 2초는 게임 Tick 40개. 최초 요청 승인 순서는 B의 서버 수신 큐 순서이며 클라이언트 시각을 쓰지 않는다.
- 단일 세션 제한/취소는 KN-06, 실제 지식 변경은 KN-07에 연결한다.
- D의 수락 문맥은 incomingExchangeId만 사용한다. B가 from/to를 인증 수신자와 비교해 direction을 계산한다. 요청자의 화면에 exchangeId가 있어도 수락 권한을 부여하지 않는다.

**시험 입력 → 기대 결과**

- 같은 셀 도망자 A/B에 새 정보 존재 → A 요청 applied, A outgoing/B incoming이며 수락 전 지식은 불변이다.
- 대각선 또는 벽 사이의 요청 → accepted 뒤 core rejected 1개, 세션/지도/술래 사건 불변이다.
- A가 자신이 보낸 요청을 수락하거나 제3자 C가 수락 → rejected; B가 기한 내 수락 → 실제 병합 뒤 applied 1개다.
- expiresAtTick 이상 수락 → EXPIRED rejected, 합집합 미적용, UI가 command-outcome만으로 요청 pending을 끝낼 수 있다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exchange-request.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exchange-request.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

활동 도망자·동일/벽 없는 직교 인접 셀·새 정보 존재를 검사한다. 요청만으로 정보가 이동하지 않고 서버 요청에 2초 내 수락해야 한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 지도 교환 요청과 수락 검증
```

**MR 본문에 채울 변경 사항**

- 거리·역할·새 지식 조건의 요청
- 2초 수락 기한과 대상 검증

**MR 리뷰 포인트**

- 요청 단계에 지식이나 술래 흔적을 만들지 않는지
- 수락 때 현재 거리/개인 종료 상태를 다시 확인하는지

**완료 인계**

- B SV-02에 EXCHANGE payload와 안전한 거절 결과 인계
- C KN-10/D IN-09에 fromPlayerId/toPlayerId·incoming/outgoing·기한과 incomingExchangeId 수락 예시 전달

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/KN-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-20

**KN-06 · [BE] 교환 취소·동시 요청 처리**  
일정: D2 2026-09-09 · **오늘 2번**  
기획 근거: v0.0.8 **09장**  
선행 완료 결과: [A-19](a-game-core.md#a-19) (KN-05, D2)

**수정·생성 파일**

- `packages/game-core/src/match/exchange/session.ts`
- `packages/game-core/src/match/exchange/cancel.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. activeExchangeByPlayer 인덱스를 두고 양쪽이 비어 있을 때만 두 플레이어 슬롯을 함께 예약한다. 먼저 승인한 쌍을 고정하고 세 번째 요청은 NOT_ALLOWED로 끝내 자동 대기열을 만들지 않는다.
2. Tick마다 거리 이탈·개인 종료·구속/도전 잠금·기한 초과를 확인하고 EXCHANGE_CANCEL을 양 참가자 중 한 명에게만 허용한다. 종료 시 세션과 양쪽 인덱스를 한 번에 제거한다.
3. 완료/취소된 exchangeId에 대한 재수락·재취소·재전송은 상태를 다시 바꾸지 않는다. 취소는 당사자 UI 해제 외 지도 변경·모든 술래 알림·위치 사건을 만들지 않는다.
4. 명시적 EXCHANGE_CANCEL은 유효한 당사자 요청이면 applied, 만료/다른 세션이면 rejected outcome을 만든다. 자동 세션 만료·거리 이탈은 당사자 상태/사건을 정리하지만 이미 applied인 EXCHANGE_REQUEST를 다시 종결하지 않는다. 같은 requestId 재전송은 B 캐시의 원래 결과로 처리한다.

**연결 계약과 경계**

- 서버가 승인한 순서가 경합의 기준; 게임 포획은 교환보다 먼저 처리한다.
- C는 취소된 세션 UI를 닫되 상대의 현재 위치를 추가 요청하지 않는다.

**시험 입력 → 기대 결과**

- A-B 승인 직후 C-A 요청 -> A-B 유지, C 요청 거절.
- 요청 뒤 B 이동으로 거리 초과 -> 양 슬롯 해제, 지도 불변.
- 포획과 수락이 같은 Tick -> 포획 먼저, 교환 취소, 중복 취소에도 사건 추가 없음.
- EXCHANGE_CANCEL accepted 후 이미 만료된 세션 처리 → EXPIRED rejected 1개로 종결, 지도/흔적 변화 없음; 자동 만료는 원래 요청 outcome을 재발행하지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exchange-cancel.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exchange-cancel.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

각 참가자의 활성 교환을 하나로 제한한다. 거리 이탈·포획·탈출·취소·기한 초과는 당사자 상태를 정리하고 술래 위치 사건 없이 종료하며, 명령 처리 결과는 요청자에게 반드시 알린다. 세 명 동시 요청·중복 재전송에서 중복 교환이 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 지도 교환 취소와 동시 요청 처리
```

**MR 본문에 채울 변경 사항**

- 플레이어별 활성 교환 하나
- 거리·개인 종료·기한 해제의 멱등 처리

**MR 리뷰 포인트**

- 한쪽 인덱스만 지워 유령 세션이 남지 않는지
- 취소 이유에 숨은 상대 위치를 넣지 않는지

**완료 인계**

- C KN-10에 조용한 종료/기한 이벤트 전달
- F QA-07에 세 명 동시 요청과 포획 경합 fixture 제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/KN-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-21

**KN-07 · [BE] 지도 병합과 폐쇄 출구 필터**  
일정: D2 2026-09-09 · **오늘 3번**  
기획 근거: v0.0.8 **09장**  
선행 완료 결과: [A-20](a-game-core.md#a-20) (KN-06, D2)

**수정·생성 파일**

- `packages/game-core/src/match/exchange/merge.ts`
- `packages/game-core/src/match/knowledge/terrain.ts`
- `packages/game-core/src/match/knowledge/exits.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. 수락 승인된 두 지식의 floor와 wallface 집합을 합치고 발견 출구 ID 합집합은 현재 active registry로 다시 필터한다. 상대 좌표·이동 이력·술래 관찰 기록은 병합 대상에 넣지 않는다.
2. 변경된 양 참가자에게 독립 복사한 지식 집합과 증가한 mapVersion을 적용한다. 같은 Set 참조를 공유해 이후 탐색이 자동 동기화되지 않도록 한다.
3. 새 정보가 실제로 생겼을 때만 교환 완료 DomainEvent와 KN-08용 과거 두 셀을 반환한다. 수락 전 사이에 지식이 같아졌다면 세션만 종료하고 흔적을 만들지 않는다.

**연결 계약과 경계**

- knownTerrain는 누적이지만 private-view는 전체 replace. 지도 버전은 실제 공개 지식 변경 때만 증가.
- 위치 중점용 두 셀은 당시 snapshot 내부 사건 재료이며 교환 상대에게 경로로 보내지 않는다.
- EXCHANGE_ACCEPT의 applied는 지식 병합이 성공한 경우다. 처리 시 새 정보가 사라진 경우 지식과 흔적은 불변이고 NOT_ALLOWED rejected를 반환한다. 세션 기한/종료의 독립 정리는 실패한 요청이 게임 정보를 변경한 것으로 취급하지 않는다.

**시험 입력 → 기대 결과**

- A가 floor1, B가 wallface2 보유 -> 둘 다 union을 갖고 이후 A의 새 floor3은 B에 자동 반영되지 않음.
- 과거 출구 ID가 한쪽에 있으나 이미 폐쇄 -> 양쪽 결과에 출구 없음.
- A→B 성공 뒤 B→C 성공 -> C에 허용 지식 릴레이, 타인 현재 위치는 없음.
- 요청 후 다른 합법적 경로로 양쪽 지식이 같아진 뒤 수락 → accepted 후 NOT_ALLOWED rejected, mapVersion·지식·술래 흔적 불변; 매치/요청 식별자는 유지한다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exchange-merge.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exchange-merge.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

승인된 쌍의 지식만 합치고 활성 출구 레지스트리를 다시 거른다. 폐쇄 출구 복원·위치/경로 공유·이후 자동 동기화가 없고 A→B→C 릴레이는 가능하다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 지도 지식 병합과 활성 출구 필터
```

**MR 본문에 채울 변경 사항**

- 독립 지식 합집합과 mapVersion
- 폐쇄 출구 복원 방지

**MR 리뷰 포인트**

- 공유 객체 참조 때문에 이후 탐색이 동기화되지 않는지
- 수락 시 새 정보가 사라진 경우 흔적을 만들지 않는지

**완료 인계**

- B KN-04/C KN-10에 before/after 전체 뷰 예시 제공
- KN-08에 성공 Tick과 당시 두 셀만 인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/KN-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-22

**KN-08 · [BE] 교환 성공의 과거 위치 사건**  
일정: D2 2026-09-09 · **오늘 4번**  
기획 근거: v0.0.8 **09장**  
선행 완료 결과: [A-21](a-game-core.md#a-21) (KN-07, D2), [B-11](b-game-server.md#b-11) (SV-07, D1)

**수정·생성 파일**

- `packages/game-core/src/match/exchange/trace.ts`
- `packages/game-core/src/match/engine.ts`
- `packages/game-core/src/match/types.ts`

**구현 순서**

1. 성공 Tick T의 두 셀 중심으로 사건 위치 중점을 계산해 publishTick=T+20, expiresTick=T+60을 저장한다. 같은 셀이면 그 중심이며 인접 셀이면 좌표가 0.5 단위가 될 수 있다.
2. publishTick 도달 시 활동 술래 audience에 교환 종류·과거 지점·만료 Tick만 내보낸다. actor/targetId, 진행 방향, 현재 위치, 주변 지형을 payload에 넣지 않는다.
3. 완료 ID로 중복 예약/발송을 막고 RESULT/ABORTED 확정 뒤 새 발동 사건은 만들지 않는다. 이미 공개된 점은 원래 expiresTick 또는 매치 종료에 따라 클라이언트에서 제거한다.

**연결 계약과 경계**

- 과거 TracePoint는 정수 Cell과 별개 {x:number,y:number}; 반셀 중점을 Cell 검증으로 거절하면 안 된다.
- A는 DomainEvent의 eventId/tick/audience와 HUNTER_MARKER payload를 만든다. B SV-07은 matchId와 수신자 stateVersion을 붙이고 화면 TTL은 C KN-11이 소비한다.
- HUNTER_MARKER payload는 {markerId,kind,point,occurredTick,showAtTick,expiresTick}이며 내부 publishTick을 showAtTick으로 매핑한다. audience는 인증된 내부 playerId[]로만 고정하고 source actor/target를 공개 payload에 넣지 않는다.

**시험 입력 → 기대 결과**

- (4,4)/(5,4)에서 T100 성공 -> T119 무알림, T120 (4.5,4) 공개, T160 만료.
- 취소 또는 새 정보 없음 -> 예약 사건0개.
- 동일 완료 event 재전달 -> 술래 점1개; 지형/신원 필드 검사 -> 없음.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exchange-trace.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exchange-trace.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

성공 1초 뒤 교환 셀 중점을 모든 술래에게 보내 2초만 유효하게 한다. 신원·주변 지형은 보내지 않으며 취소·무변화·중복에는 사건이 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 지도 교환의 지연 위치 흔적 생성
```

**MR 본문에 채울 변경 사항**

- 1초 지연·2초 표시 사건
- 반셀 중점과 audience 제한

**MR 리뷰 포인트**

- 정수 셀과 사건 중점을 혼동하지 않는지
- 사건 위치가 이후 플레이어 이동에 따라 바뀌지 않는지

**완료 인계**

- B/C에 TracePoint·publish/expires Tick 계약 전달
- F QA-08에 사건 payload 허용 필드 fixture 제공

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/KN-08.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-23

**EQ-01 · [BE] 장비 보유·설치·취소·무장**  
일정: D2 2026-09-09 · **오늘 5번**  
기획 근거: v0.0.8 **12장**  
선행 완료 결과: [A-11](a-game-core.md#a-11) (RL-03, D1), [B-02](b-game-server.md#b-02) (SV-02, D1)

**수정·생성 파일**

- `packages/game-core/src/match/equipment/install.ts`
- `packages/game-core/src/match/equipment/types.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. 매치 시작 때 술래별 sensor=1/trap=1 재고를 만든다. INSTALL은 정지·활동 술래만 받고 감지기는 정면의 인접 내부 벽면+현재 접근 셀, 덫은 현재 통로 셀에 예약한다.
2. 시작 셀·외곽·장비 중복 등 공개 조건을 동일하게 검사하고 숨은 출구의 존재는 거절 판단에 넣지 않는다. 예약 시 installationId/startTick/endTick=T+10을 부여하되 재고는 아직 소비하지 않는다.
3. INSTALL_CANCEL은 본인 pending installationId에 대해 완료 전만 허용한다. 설치 완료에 재고를 한 번 차감하고 장비를 UNARMED로 생성해 armedAtTick=endTick+20을 적용한다. 취소나 실패는 차감하지 않는다.
4. 설치 후 회수·양도·보충 API는 만들지 않는다. 설치 완료한 자기 장비의 ID·종류·접근/바닥 cell·센서 wall·UNARMED/ARMED/SPENT·armedTick을 B의 self.ownedEquipment에 투영할 수 있게 상태에 유지한다. 대상 도망자 신원은 넣지 않는다. 실제 시야에 보이는 장비는 KN-04용 엔티티로 별도 제공한다.
5. INSTALL의 예약 성공은 applied, 위치·행동·재고 조건 실패는 rejected CoreOutcome을 반환한다. 설치 완료는 후속 상태/사건이며 원래 요청에 두 번째 outcome을 만들지 않는다. INSTALL_CANCEL은 완료 전 취소 적용 시 applied, 완료 경계 이후에는 rejected로 한 번 종결한다. 가시 sensor와 자기 ownedEquipment의 sensor 모두 wall을 필수로 제공하고, trap은 바닥 cell만 제공한다.

**연결 계약과 경계**

- 공통 추가 명령 INSTALL_CANCEL {installationId}; self.installation에 해당 ID와 완료 Tick을 B가 공개한다.
- sensor/trap enum, 한 셀 장비 중복 금지. 숨은 출구 유무가 거절 코드/시간의 차이가 되지 않게 동일 경로 사용.

**시험 입력 → 기대 결과**

- T10 설치시작/T19 취소 -> 재고1 유지, 장비없음.
- T10 시작 -> T20 재고0/UNARMED, T40부터 ARMED.
- 같은 공개조건의 출구벽/일반벽에 감지기 설치 -> 둘 다 동일 허용; 이미 장비 있는 셀 -> 동일 거절.
- INSTALL accepted 뒤 진행 중 이동 조건으로 실패 → NOT_ALLOWED rejected, 재고·설치 상태 불변. T20 완료 후 INSTALL_CANCEL → rejected이며 이미 소모된 재고/장비 상태를 되돌리지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/equipment-install.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/equipment-install.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

술래별 감지기/덫 각 1개를 부여한다. 정지 설치 10 Tick·무장 20 Tick·완료 전 취소 미차감과 설치 위치/중복을 검사한다. 숨겨진 출구를 이유로 설치를 거부하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 술래 장비 설치와 취소 및 무장 처리
```

**MR 본문에 채울 변경 사항**

- 개인 재고와 10+20 Tick 설치 수명
- 취소 미차감·공개조건 설치 검증

**MR 리뷰 포인트**

- 완료 경계 취소가 이미 차감한 장비를 복원하지 않는지
- 출구 탐지용 거절 통로가 생기지 않는지

**완료 인계**

- B SV-02/C EQ-10/D IN-09에 INSTALL_CANCEL과 self.installation 계약 인계
- KN-04에 가시 장비와 설치자 개인 기억 위치의 서로 다른 audience 전달
- B KN-04/C VI-03에 비소유자가 관찰하는 sensor의 wall 필수 fixture와 설치/취소 command-outcome 예시를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EQ-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-24

**EQ-02 · [BE] 감지기 새 진입·단발 사건**  
일정: D2 2026-09-09 · **오늘 6번**  
기획 근거: v0.0.8 **12.1장**  
선행 완료 결과: [A-23](a-game-core.md#a-23) (EQ-01, D2), [A-12](a-game-core.md#a-12) (RL-04, D1), [B-11](b-game-server.md#b-11) (SV-07, D1)

**수정·생성 파일**

- `packages/game-core/src/match/equipment/sensor.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. 완료 전/후 셀이 다른 이동에서 새 진입한 도망자만 수집하고 포획 단계 후 ACTIVE 상태를 다시 검사한다. 무장 때 이미 서 있던 사람은 그 사실만으로 후보가 아니다.
2. ARMED 감지기의 접근 셀에 유효 후보가 하나 이상이면 ARMED→SPENT를 한 번 전환한다. 구속 유예는 감지 면제 조건으로 사용하지 않으며 후보가 없으면 유지한다.
3. 모든 술래에게 kind=sensor·과거 셀 지점·expiresTick=T+40만 발송할 DomainEvent를 만들고 (matchId,equipmentId,T)로 중복을 막는다. 대표 후보 ID는 내부 필요에만 사용한다.
4. ARMED→SPENT가 실제 확정된 Tick에 별도의 DomainEvent {type:SPATIAL_SOUND,sound:{eventId,tick,kind:sensor,cell:장비 접근 또는 바닥 셀}}를 한 번 반환한다. 지도용 HUNTER_MARKER와 음향 사건의 ID를 분리하며, 발동 키로 두 사건 각각의 중복을 막는다. 후보가 없거나 이미 SPENT이면 둘 다 새로 생성하지 않는다.

**연결 계약과 경계**

- 장비 발동은 포획 뒤, 포즈·교환 판정 앞이다. 감지기 범위는 wallface 주변 임의 반경이 아니라 접근 셀 새 진입.
- 이미 설치/무장 당시 점유했어도 나갔다 다시 들어오면 새 진입 검사에 포함.
- sensor 사건은 DomainEvent HUNTER_MARKER로 {markerId,kind:sensor,point,occurredTick:T,showAtTick:T,expiresTick:T+40}를 제공한다. audience는 현재 활동 술래 playerId[]이며 B는 이 명단에만 private-event를 발송한다.
- HUNTER_MARKER는 허용된 술래에게 보내는 과거 지도 정보다. SPATIAL_SOUND는 B→E 서버 전용 음향 입력이며 공개 audio-policy에는 수신자 gain/방향/필터값만 남긴다. 장비 원좌표·대상 신원·전체 지도 표식을 음향 수신자에게 복사하지 않는다.

**시험 입력 → 기대 결과**

- 무장 완료 때 도망자 정지 점유 -> 무발동; 다음 나갔다 재진입 -> 1회 발동.
- 유예 중 ACTIVE 도망자 새 진입 -> 감지기 발동.
- 동시 두 후보 또는 같은 사건 재평가 -> SPENT1회/술래 사건1개, 신원없음.
- 한 번 유효 발동 → HUNTER_MARKER 한 개와 kind=sensor SPATIAL_SOUND 한 개; 같은 Tick 재평가/다음 Tick SPENT 검사 → 추가 0개. 두 사건은 같은 id를 공유하지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/sensor.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/sensor.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

무장 후 새 진입하고 포획 뒤에도 ACTIVE인 후보가 있으면 한 번 소모해 술래에 과거 위치만 보낸다. 무장 때 점유만으로 발동하지 않되 나갔다가 재진입하면 검사한다. 후보가 없으면 남겨 두며 유예자는 감지 면제가 아니다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 통과 감지기의 단발 발동 구현
```

**MR 본문에 채울 변경 사항**

- 새 진입 ACTIVE 필터
- 단발 소모와 익명 과거 사건

**MR 리뷰 포인트**

- 덫 유예 조건을 감지기에 재사용하지 않는지
- 정지 점유를 새 진입으로 처리하지 않는지

**완료 인계**

- B SV-07/C KN-11에 sensor trace의40Tick TTL 전달
- F에 무장 기존 점유/유예 감지 fixture 전달
- B SV-04/E MC-03에 sensor 음향 사건과 지도 사건이 분리된 실제 core 결과를 전달하고 공개 payload에서 원좌표가 사라지는 연결 시험을 확인한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EQ-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-25

**EQ-03 · [BE] 덫 새 진입·유예 후보 필터**  
일정: D2 2026-09-09 · **오늘 7번**  
기획 근거: v0.0.8 **12.1장**  
선행 완료 결과: [A-23](a-game-core.md#a-23) (EQ-01, D2), [A-12](a-game-core.md#a-12) (RL-04, D1)

**수정·생성 파일**

- `packages/game-core/src/match/equipment/trap-candidates.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. 해당 Tick 이동 완료로 덫 셀에 새 진입한 후보 중 포획 뒤 ACTIVE인 도망자만 남긴다. ARMED가 아니거나 이전/현재 셀이 같으면 후보를 만들지 않는다.
2. 현재 구속 중인 후보와 T<restraintImmuneUntilTick 후보를 제외한다. 만료 갱신은 Tick 첫 단계에서 수행하므로 T==immuneUntil은 새 구속 후보가 될 수 있다.
3. 설치 당시 점유 이력을 영구 제외목록으로 만들지 않는다. 떠났다가 다시 진입했을 때 현재 상태로 재검사하고 덫 위에서 가만히 유예가 끝나면 새 진입이 아니므로 발동하지 않는다.

**연결 계약과 경계**

- 이 작업은 후보 목록만 반환; 대상 결정/장비 소모는 EQ-04가 수행.
- 종료/무장/유예 경계 endTick<=T 갱신은 SV-04 순서와 일치해야 한다.

**시험 입력 → 기대 결과**

- 유예자만 T49 진입,immuneUntil50 -> 후보0/덫보존.
- 같은 후보 T50 새 진입 -> 후보1; T49부터 셀에서 정지하다T50 -> 후보0.
- 무장 당시 점유후 떠났다 재진입 -> 후보 포함, 이미구속자는 제외.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/trap-candidates.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/trap-candidates.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

설치/무장 당시 점유만으로 발동하지 않고 나갔다가 새로 진입하면 후보를 재검사한다. 이미 구속 중인 사람·유예자는 제외하며 유예 종료 Tick 새 진입은 대상이다. 덫 위 정지 중 유예 종료는 재발동이 아니다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 구속 덫의 진입 후보와 유예 필터
```

**MR 본문에 채울 변경 사항**

- 무장·새 진입·ACTIVE·유예 필터
- 기존 점유와 면제 종료 경계

**MR 리뷰 포인트**

- 후보 없음에도 덫이 소비되지 않는지
- endTick 등호 경계를 일관되게 적용하는지

**완료 인계**

- EQ-04에 정렬에 의존하지 않는 후보 Set 전달
- F QA-07에 유예자/일반자 혼합 fixture 인계

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EQ-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-26

**EQ-04 · [BE] 덫 동시 대상 선정·단발 소모**  
일정: D2 2026-09-09 · **오늘 8번**  
기획 근거: v0.0.8 **12.1, 13.1장**  
선행 완료 결과: [A-25](a-game-core.md#a-25) (EQ-03, D2), [A-08](a-game-core.md#a-08) (RL-05, D1), [B-11](b-game-server.md#b-11) (SV-07, D1)

**수정·생성 파일**

- `packages/game-core/src/match/equipment/trap-activate.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. EQ-03 후보에 RL-05 공통 Tick 우선순위를 적용해 첫 후보 한 명만 선정한다. 후보를 고른 뒤 유예자를 걸러 다음 후보를 놓치는 순서를 사용하지 않는다.
2. 같은 nextState에서 장비 SPENT와 대상 restrainedUntilTick=T+30을 함께 반영한다. 구속 효과는 플레이어 상태에 저장하며 소모된 장비가 지속해서 사람을 고르는 구조를 만들지 않는다.
3. 술래 전체에는 kind=trap/과거 지점/40Tick 만료만, 당사자에게는 자신의 구속 잔여시간만 내보낸다. 활성화 키를 저장해 같은 Tick 해제/퇴장/포획 또는 재시도에도 장비가 돌아오지 않게 한다.
4. ARMED→SPENT가 실제 확정된 Tick에 별도의 DomainEvent {type:SPATIAL_SOUND,sound:{eventId,tick,kind:trap,cell:장비 접근 또는 바닥 셀}}를 한 번 반환한다. 지도용 HUNTER_MARKER와 음향 사건의 ID를 분리하며, 발동 키로 두 사건 각각의 중복을 막는다. 후보가 없거나 이미 SPENT이면 둘 다 새로 생성하지 않는다.

**연결 계약과 경계**

- 장비 발동키=(matchId,equipmentId,activationTick), 선정 playerId는 술래 사건 payload 금지.
- 구속 시간 30Tick, 자연 만료/유예는 EQ-05 담당.
- trap 사건도 HUNTER_MARKER의 markerId/point/occurredTick/showAtTick/expiresTick과 활동 술래 audience를 사용한다. 당사자 구속은 self selector로 제공하며 정의되지 않은 별도 공개 사건 이름을 만들지 않는다.
- HUNTER_MARKER는 허용된 술래에게 보내는 과거 지도 정보다. SPATIAL_SOUND는 B→E 서버 전용 음향 입력이며 공개 audio-policy에는 수신자 gain/방향/필터값만 남긴다. 장비 원좌표·대상 신원·전체 지도 표식을 음향 수신자에게 복사하지 않는다.

**시험 입력 → 기대 결과**

- A/B 동시 진입,해당Tick B우선 -> B만30Tick 구속,덫SPENT.
- 유예A+일반B 동시 진입 -> B선정,유예자 때문에 소모만 하고 끝내지 않음.
- 발동 후 자연 만료 또는 개인 종료 -> 덫은SPENT유지,다음사람미구속.
- 한 번 유효 발동 → HUNTER_MARKER 한 개와 kind=trap SPATIAL_SOUND 한 개; 같은 Tick 재평가/다음 Tick SPENT 검사 → 추가 0개. 두 사건은 같은 id를 공유하지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/trap-activation.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/trap-activation.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

유효 후보 중 공통 순환 우선순위 한 명만 고른다. SPENT와 대상 구속을 같은 Tick에 한 번 커밋하며 후보 없으면 덫을 보존한다. 술래 사건에 대상 신원을 넣지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 구속 덫 대상 선정과 원자 소모
```

**MR 본문에 채울 변경 사항**

- 한 후보 구속과 장비 소모의 동시 반영
- audience별 단발 사건

**MR 리뷰 포인트**

- 장비 상태와 구속 상태 분리
- 순회 순서가 선정 결과를 바꾸지 않는지

**완료 인계**

- B/C에 당사자 구속 상태와 익명 술래 사건 분리 인계
- EQ-05에 restrainedUntilTick 초기값 전달
- B SV-04/E MC-03에 trap 음향 사건과 지도 사건이 분리된 실제 core 결과를 전달하고 공개 payload에서 원좌표가 사라지는 연결 시험을 확인한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EQ-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-27

**EQ-05 · [BE] 구속 시간·행동 제한·해제 유예**  
일정: D2 2026-09-09 · **오늘 9번**  
기획 근거: v0.0.8 **12장**  
선행 완료 결과: [A-26](a-game-core.md#a-26) (EQ-04, D2)

**수정·생성 파일**

- `packages/game-core/src/match/equipment/restraint.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. Tick 첫 단계에서 restrainedUntilTick<=T면 구속을 끝내고 면제 종료를 실제 해제 Tick+40으로 설정한다. 이미 자연 만료를 처리한 상태를 다음 Tick이 다시 연장하지 않게 한다.
2. 구속 중 새 move 시작을 거절하지만 이미 커밋된 셀을 되돌리지 않고 turn을 허용한다. 진행/요청된 교환과 출구 도전을 취소하고 구속 중 새 도전도 허용하지 않는다.
3. 포획은 구속과 무관하게 계속 검사하며 유예는 새 trap 구속만 막는다. 감지기/일반 포획 면역으로 사용하지 않는다. 잔여시간은 max(0,endTick-T)로 제공한다.

**연결 계약과 경계**

- restraintImmuneUntilTick은 자연 만료 Tick부터 40Tick이며 순수 만료 함수가 구속 종료와 유예 시작을 한 번 적용한다.
- B self에 자신의 상태만 공개하고 적의 구속 상태는 가시 엔티티 허용 계약에 한정.

**시험 입력 → 기대 결과**

- T10 구속,T40 자연만료 -> T40이동가능,면제until80;T80새진입은면제없음.
- 구속중TURN -> 허용;MOVE/EXIT_START/EXCHANGE -> 거절 또는 기존수행취소.
- 구속중술래동일셀도착 -> CAPTURED,유예가포획을막지않음.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/restraint.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/restraint.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

1.5초 구속 중 새 이동을 막고 회전은 허용하며 포즈/교환은 종료한다. 자연 만료 후 2초 유예와 포획 가능성을 검사하고 소모된 덫을 복원하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 구속 시간과 행동 제한 및 재구속 유예
```

**MR 본문에 채울 변경 사항**

- 30Tick구속과40Tick면제
- 행동별허용/금지

**MR 리뷰 포인트**

- 같은만료를여러번처리해유예가늘지않는지
- 도전/교환의새요청까지차단되는지

**완료 인계**

- B/C/D에self restraint와행동잠금표인계
- C EQ-11 구속 HUD와 EQ-04에 자연 만료/재진입 유예 경계 fixture를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EQ-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-28

**EQ-06 · [BE] 아이템 획득·소지 — PRODUCT_DECISION_PENDING**  
기존 일정 식별: D2 2026-09-09 · **오늘 10번** (실행 보류)  
실행 상태: **PRODUCT_DECISION_PENDING**

**보류 사유**

도망자 아이템의 종류·효과·획득·소지·사용 방식은 아직 사용자 결정 전이다. v0.0.8의 이전 후보나 이 문서의 이전 실행 지시는 승인된 구현 요구로 사용하지 않는다. 고정 번호와 원본 ID는 추적을 위해 유지하며 현재 구현 일정·선행 조건·MVP 완료 증거로 계산하지 않는다.

**재개에 필요한 사용자 결정**

- 도망자 아이템을 이번 MVP에 포함할지와 확정 종류·효과.
- 배치 또는 지급 방식, 획득 조건, 수량과 소지 규칙.
- 사용 입력·성공/실패 조건·효과 시간·다른 게임 규칙과의 상호작용.

사용자 결정이 기록되면 이 ID의 범위·연결 계약·검수 조건을 다시 합의한 뒤 실행 계획을 작성한다. 승인 전에는 제품 타입·메시지·저장 상태·UI·시험 조건을 만들지 않는다.

### A-29

**EQ-07 · [BE] 아이템 사용 — PRODUCT_DECISION_PENDING**  
기존 일정 식별: D2 2026-09-09 · **오늘 11번** (실행 보류)  
실행 상태: **PRODUCT_DECISION_PENDING**

**보류 사유**

도망자 아이템의 종류·효과·획득·소지·사용 방식은 아직 사용자 결정 전이다. v0.0.8의 이전 후보나 이 문서의 이전 실행 지시는 승인된 구현 요구로 사용하지 않는다. 고정 번호와 원본 ID는 추적을 위해 유지하며 현재 구현 일정·선행 조건·MVP 완료 증거로 계산하지 않는다.

**재개에 필요한 사용자 결정**

- 도망자 아이템을 이번 MVP에 포함할지와 확정 종류·효과.
- 배치 또는 지급 방식, 획득 조건, 수량과 소지 규칙.
- 사용 입력·성공/실패 조건·효과 시간·다른 게임 규칙과의 상호작용.

사용자 결정이 기록되면 이 ID의 범위·연결 계약·검수 조건을 다시 합의한 뒤 실행 계획을 작성한다. 승인 전에는 제품 타입·메시지·저장 상태·UI·시험 조건을 만들지 않는다.

### A-30

**EQ-08 · [BE] 아이템 효과 기획 보류 — PRODUCT_DECISION_PENDING**  
기존 일정 식별: D2 2026-09-09 · **오늘 12번** (실행 보류)  
실행 상태: **PRODUCT_DECISION_PENDING**

**보류 사유**

도망자 아이템의 종류·효과·획득·소지·사용 방식은 아직 사용자 결정 전이다. v0.0.8의 이전 후보나 이 문서의 이전 실행 지시는 승인된 구현 요구로 사용하지 않는다. 고정 번호와 원본 ID는 추적을 위해 유지하며 현재 구현 일정·선행 조건·MVP 완료 증거로 계산하지 않는다.

**재개에 필요한 사용자 결정**

- 도망자 아이템을 이번 MVP에 포함할지와 확정 종류·효과.
- 배치 또는 지급 방식, 획득 조건, 수량과 소지 규칙.
- 사용 입력·성공/실패 조건·효과 시간·다른 게임 규칙과의 상호작용.

사용자 결정이 기록되면 이 ID의 범위·연결 계약·검수 조건을 다시 합의한 뒤 실행 계획을 작성한다. 승인 전에는 제품 타입·메시지·저장 상태·UI·시험 조건을 만들지 않는다.

### A-31

**EQ-09 · [BE] 아이템 효과 기획 보류 — PRODUCT_DECISION_PENDING**  
기존 일정 식별: D2 2026-09-09 · **오늘 13번** (실행 보류)  
실행 상태: **PRODUCT_DECISION_PENDING**

**보류 사유**

도망자 아이템의 종류·효과·획득·소지·사용 방식은 아직 사용자 결정 전이다. v0.0.8의 이전 후보나 이 문서의 이전 실행 지시는 승인된 구현 요구로 사용하지 않는다. 고정 번호와 원본 ID는 추적을 위해 유지하며 현재 구현 일정·선행 조건·MVP 완료 증거로 계산하지 않는다.

**재개에 필요한 사용자 결정**

- 도망자 아이템을 이번 MVP에 포함할지와 확정 종류·효과.
- 배치 또는 지급 방식, 획득 조건, 수량과 소지 규칙.
- 사용 입력·성공/실패 조건·효과 시간·다른 게임 규칙과의 상호작용.

사용자 결정이 기록되면 이 ID의 범위·연결 계약·검수 조건을 다시 합의한 뒤 실행 계획을 작성한다. 승인 전에는 제품 타입·메시지·저장 상태·UI·시험 조건을 만들지 않는다.

### A-32

**EX-02 · [BE] 출구 도전 시작·취소·기한**  
일정: D2 2026-09-09 · **오늘 14번**  
기획 근거: v0.0.8 **11장**  
선행 완료 결과: [A-07](a-game-core.md#a-07) (EX-01, D1), [A-11](a-game-core.md#a-11) (RL-03, D1), [B-02](b-game-server.md#b-02) (SV-02, D1)

**수정·생성 파일**

- `packages/game-core/src/match/exits/challenge.ts`
- `packages/game-core/src/match/engine.ts`

**구현 순서**

1. EXIT_START에서 owner/접근 셀/현재 dir/active 출구/ACTIVE·비구속·행동 완료와 T>=nextAttemptTick을 검사한다. 접근만으로자동시작하지않고유효명령때challengeId와poseKind를발급한다.
2. challenge시작Tick과expiry=T+160,minimum=T+40을기록하고이동·회전·교환을 잠근다. EXIT_CANCEL은해당본인challengeId에만허용하고취소후nextAttemptTick=T+10으로설정한다.
3. 매Tick기한·개인종료·구속발동·접근조건을재검사해도전을종료한다. 실패/취소후에도registry.poseKind는그대로두고진행도만초기화한다.
4. EXIT_START의 challenge 생성과 EXIT_CANCEL의 취소 적용은 각각 applied CoreOutcome을 반환한다. 재시도 대기·위치·행동 상태 실패는 challenge를 만들거나 바꾸지 않고 rejected로 종결한다. 기한 만료 등 자동 종료는 challenge 상태/개인 사건으로 알리며 이미 끝난 원래 요청 outcome을 다시 만들지 않는다.

**연결 계약과 경계**

- EXIT_START {exitId}, EXIT_CANCEL {challengeId};포즈실제판별은C/D.
- 8초160Tick/최소2초40Tick/재시도0.5초10Tick,구속중도전시작불가.

**시험 입력 → 기대 결과**

- 접근셀에들어오기만함 -> 도전없음/이동자유.
- 유효 시작 후 MOVE/TURN -> 거절,취소만허용;구속되면도전종료.
- 기한Tick도달 -> 취소/재시도10Tick대기;다시시작해도poseKind동일.
- nextAttemptTick=110에서 T109 EXIT_START accepted → NOT_ALLOWED rejected 1개, challenge·게임 상태 불변; C pending 해제 후 새 requestId로 T110에 재요청하면 적용 가능하다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exit-challenge.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exit-challenge.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

소유자·접근 셀·방향·활성 출구가 맞을 때 명시적으로 challengeId를 발급한다. 이동/회전/교환 잠금, 취소, 8초 기한, 0.5초 재시도 제한을 검사하며 접근만으로 잠그지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 출구 도전 시작과 잠금 및 취소 처리
```

**MR 본문에 채울 변경 사항**

- challengeID와160Tick기한
- 행동잠금/취소/재시도경계

**MR 리뷰 포인트**

- 접근셀자동잠금과신규구속도전이없는지
- 소유자·방향정보를클라이언트값으로신뢰하지않는지

**완료 인계**

- B/C EX-04/05에challenge시작/취소/기한개인사건전달
- D에setContext challengeId·행동잠금표인계
- B/C EX-05에 accepted → 재시도 제한 rejected → pending 해제 → 새 요청 성공의 실제 생산자·소비자 연결 시험을 인계한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EX-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### A-33

**EX-03 · [BE] 탈출 성공·중복·포획 우선 검증**  
일정: D2 2026-09-09 · **오늘 15번**  
기획 근거: v0.0.8 **07, 11장**  
선행 완료 결과: [A-32](a-game-core.md#a-32) (EX-02, D2), [A-12](a-game-core.md#a-12) (RL-04, D1), [A-14](a-game-core.md#a-14) (RL-07, D1)

**수정·생성 파일**

- `packages/game-core/src/match/exits/complete.ts`
- `packages/game-core/src/match/engine.ts`
- `packages/game-core/src/match/participation.ts`

**구현 순서**

1. EXIT_PROGRESS는현재본인challengeId·method pose/keys·completed boolean을검사하고T>=minimum,T<expiry,소유자/접근셀/방향/ACTIVE조건을재확인한다. client완료보고가서버최소시간을우회하지못하게한다.
2. 포획·장비/구속단계후에도유효할때만RL-07terminateRunner ESCAPED를호출한다. 한번성공한challengeId는재사용할수없고result 확정 후 도착한 새 요청은 B에서 거절하고, 이미 accepted인 미처리 요청은 canceled로 종결한다.
3. completed=false 또는클라진행초기화는탈출로해석하지않는다. 서버는실제1.2초상체일치/카메라장애진위를증명하지않고C가보고한성공에대한시간/위치/중복조건만보장한다고MR에명시한다.
4. 최소 시간·기한·challenge 불일치는 명령 상태 변경 없이 rejected CoreOutcome을 반환한다. completed=false는 유효 challenge의 완료 아님을 확인한 applied이며 탈출 상태를 만들지 않는다. 유효 completed=true 성공은 ESCAPED와 applied를 한 번 반환한다. 같은 requestId 재전송은 재평가하지 않고 B의 원래 outcome을 돌려준다.

**연결 계약과 경계**

- EXIT_PROGRESS에누적점수/클라이언트시각으로서버판정을대체할필드는없음.
- pose와keys에동일40Tick최소/포획가능성/잠금규칙적용.

**시험 입력 → 기대 결과**

- 시작T100,완료T139 -> 거절;T140유효완료 -> ESCAPED.
- T140완료와술래접촉 -> CAPTURED,ESCAPED증가없음.
- T260기한완료·다른challengeId·중복완료 -> 거절/기존결과불변.
- T139 조기 성공 보고 accepted → rejected 1개, challenge와 탈출 수 불변; T140의 새 요청은 applied 1개. 최초 성공 requestId 재전송은 같은 outcome을 재전달하며 두 번째 ESCAPED를 만들지 않는다.

**추가·보완할 시험 파일**

- `packages/game-core/test/match/exit-complete.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/exit-complete.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

challengeId/소유자/위치/기한/최소 2초를 검사해 성공을 한 번 확정한다. 같은 Tick 포획이 우선하며 포즈·키 폴백에 같은 서버 제약을 적용한다. 실제 신체 자세를 서버가 증명한다고 쓰지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 탈출 성공과 포획 우선 검증
```

**MR 본문에 채울 변경 사항**

- 최소시간·기한·소유권검증
- 단일탈출확정과포획경합

**MR 리뷰 포인트**

- 로컬포즈성공을서버신체검증이라고보고하지않는지
- 같은deadlineTick와도전expiry경계를구분하는지

**완료 인계**

- B/C에 성공 CoreOutcome과 EndedSelf·counts 및 해당 challenge 종료 사건 예시를 인계한다. 수신자 stateVersion 포장은 B가 수행한다.
- F QA-07에마감Tick/포획/도전완료동시fixture제공
- B/C에 조기 거절·정상 성공·매치 종료 취소 outcome의 requestId/sequence/매치 상관관계와 UI pending 해제 증거를 전달한다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/A/EX-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.
