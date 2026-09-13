# 담당 AI에 복사할 실행 프롬프트

아래 번호 프롬프트는 원본 작업을 식별하는 양식이다. 현재 재개에는 [2026-09-13 코드·계획 재검토](../mvp-plan-review-2026-09-13.md)와 [구현 진행 기록](../mvp-implementation-progress.md)을 먼저 읽고 남은 범위만 지정한다. 구현 중단·검토 요청을 아래 예제의 구현·커밋 요청으로 바꾸지 않는다. 이번 MVP의 도망자 아이템 제외와 팀원 접속 제한 유지, 운영 모드별 조건은 [공통 원본](common.md)을 따른다.

## 고정 번호 1–5를 시작할 때

아래에서 담당 글자와 경로를 함께 바꾼다. 날짜를 쓰지 않으면 **담당 고정 번호**를 뜻한다. C는 D1에 네 개뿐이므로 C-01–C-05에는 D2의 C-05가 포함된다. 당일 작업만 원하면 `D1 오늘 1–4번`처럼 존재하는 범위를 지정한다.

```text
내 담당은 A야. docs/execution/a-game-core.md 기준 고정 번호 A-01부터 A-05까지 진행해줘.
먼저 AGENTS.md, CONTRIBUTING.md, requirements.md, docs/architecture.md,
docs/spec/decisions.md, docs/spec/current.md, docs/mvp-plan-review-2026-09-13.md,
docs/mvp-implementation-progress.md와 내 담당 문서의 시작 절차를 읽어줘.
node scripts/prepare-execution.mjs --role A --tasks 1-5 출력으로 작업 번호,
기획서의 해당 장, 수정 파일, 범위 밖 선행을 확인해줘.
공통 계약 EXEC-CONTRACT-3와 contracts/types.ts·fixtures.ts·fixtures.test.ts를 대조하고
다른 담당의 전체 계획 대신 필요한 공개 export·시험·handoffs/<역할>.md를 직접 확인해줘.
현재 브랜치·시작 SHA·미커밋 변경·Git 신원을 확인하고 내 파일 소유권을 지켜줘.
과거 미구현·차단 기록은 현재 코드와 대조하고 완료된 기능을 다시 만들지 마.
PRODUCT_DECISION_PENDING 번호는 구현하지 않고 보류를 기록한 뒤 범위의 다음 번호로 진행해줘.
선행 코드나 외부 환경이 없으면 가능한 단위 구현·시험을 먼저 끝내고 localStage와 blockedOn을 나눠 기록해줘.
범위 밖 작업과 소유권 원본에서 내 담당이 아닌 파일은 대신 고치지 말고
내 docs/execution/handoffs/A.md에 필요한 export/파일/패키지 버전/검증 요청을 구체적으로 적어줘.
내 담당이 F일 때는 지정 작업에 필요한 manifest·lockfile·공통 설정을 내가 수정·검증하고,
다른 담당일 때는 F에게 변경을 요청해줘.
필요한 정상·거절·경계·수명 시험과 타입·lint 검사를 실행하고
node scripts/check-role-scope.mjs --role A --base <기록한 시작 SHA>로 변경 경계를 확인해줘.
검증된 중간 산출물과 완료 작업은 내 Git 신원으로 로컬 커밋하고
공유 인계, .local/execution/A.json, 작업별 MR 본문과 이번 실행분 합본을 작성해줘.
보고에는 완료/단위검증/통합대기/외부차단/제품결정대기를 구분하고 실제 명령·결과·commit을 적어줘.
푸시·MR 생성·원격 병합·Jira 변경은 하지 마.
```

| 담당 | 담당 문서                                      | 명령                                                      |
| ---- | ---------------------------------------------- | --------------------------------------------------------- |
| A    | [a-game-core.md](a-game-core.md)               | `node scripts/prepare-execution.mjs --role A --tasks 1-5` |
| B    | [b-game-server.md](b-game-server.md)           | `node scripts/prepare-execution.mjs --role B --tasks 1-5` |
| C    | [c-web-ui.md](c-web-ui.md)                     | `node scripts/prepare-execution.mjs --role C --tasks 1-5` |
| D    | [d-vision-media.md](d-vision-media.md)         | `node scripts/prepare-execution.mjs --role D --tasks 1-5` |
| E    | [e-media-operations.md](e-media-operations.md) | `node scripts/prepare-execution.mjs --role E --tasks 1-5` |
| F    | [f-infra-qa.md](f-infra-qa.md)                 | `node scripts/prepare-execution.mjs --role F --tasks 1-5` |

각 역할로 바꿀 때 첫 줄, prepare 명령, scope 명령, 공유 인계 경로, 개인 진행 JSON의 담당 글자를 모두 바꾼다. 실제 Jira가 없으면 번호를 만들지 않는다. 실행 전 최신 원격 develop과 필요한 선행 MR의 병합 여부를 확인한다. 현재 checkout의 미커밋 작업을 덮어쓰지 않고 담당 브랜치로 분리한다.

## 다음 배치를 실행할 때

```text
내 담당은 A야. docs/execution/a-game-core.md의 D2 오늘 번호 1–5를 진행해줘.
node scripts/prepare-execution.mjs --role A --day D2 --tasks 1-5로 고정 번호를 먼저 확인해줘.
이전 handoffs/A.md·.local/execution/A.json·Git 로그와 실제 코드를 읽고 중복 작업을 피하고,
첫 실행과 같은 소유권·검증·로컬 커밋·MR 본문 규칙을 적용해줘.
```

D3 후속 행은 새 원본 ID가 없다. `D3 후속 1–5, 기존 작업 결함 수정`처럼 지정하고 담당 D3 표와 실제 결함 증거로 진행한다. 새 작업 번호나 가짜 완료를 만들지 않는다.

## 선행 구현이 반영된 뒤 재개할 때

```text
내 담당은 A야. 공유 인계와 진행 기록의 blockedOn을 다시 확인해줘.
현재 checkout에 반영된 선행 commit/export를 실제로 검증하고
이미 단위 검증한 구현은 다시 만들지 말고 필요한 연결·회귀 시험을 진행해줘.
실제 인수 조건을 만족한 번호만 ACCEPTED로 바꾸고 남은 차단과 필요한 요청을 인계에 갱신해줘.
```

이 프롬프트는 계정·장치·다른 담당의 미도착 코드를 대신 만들어 주지 않는다. 지정 범위에서 구현과 단위 검증을 끝내는 것, 모든 생산자/소비자가 통합된 상태에서 최종 인수까지 끝내는 것을 구분한다.
