# 학습 일지 — 2026-08-25 (화)

## 오늘의 목표

MySQL InnoDB가 동시 Transaction에서 읽기와 쓰기를 제어하는 원리를 학습한다.
전날 구상한 Project Intelligence를 특정 기술이나 프로젝트에 종속되지 않는
재사용 가능한 Skill 구조로 구체화한다.

---

## 공부한 내용

### 1. REPEATABLE READ에서 동시에 수정하면 발생하는 일

다음 상황을 기준으로 Transaction 동작을 살펴봤다.

```text
Transaction A
값 10 조회
10 → 15 수정
아직 Commit하지 않음

Transaction B
같은 데이터 조회 또는 수정 시도
```

Transaction A가 값을 수정했더라도 Commit 전 변경 값이 다른 Transaction의 일반 조회에
그대로 노출되는 것은 아니다. InnoDB는 MVCC와 Undo Log를 이용해 각 Transaction이
자신의 일관된 시점에 맞는 데이터를 읽게 한다. 따라서 Transaction B의 일반 조회는
상황에 따라 변경 전 값인 10을 읽을 수 있다.

반면 같은 Row를 수정하거나 Locking Read를 수행하면 이미 획득된 Lock과 충돌해
대기할 수 있다. **일반 조회에서 어떤 값이 보이는가**와 **수정 권한을 얻을 수 있는가**는
서로 다른 문제로 봐야 한다.

### 2. Buffer Pool과 Transaction에서 보이는 값은 다르다

DB Page가 Buffer Pool 메모리에 올라와 있다는 사실만으로 모든 Transaction에 같은 값이
보이는 것은 아니다. Buffer Pool은 Page를 메모리에 보관해 디스크 접근을 줄이는 영역이고,
각 Transaction에 어떤 버전을 보여줄지는 MVCC, Undo Log, Read View가 결정한다.

```text
Buffer Pool
→ Page를 메모리에 보관하는 위치

MVCC + Undo Log + Read View
→ 현재 Transaction에 보여줄 Row Version을 결정
```

저장 위치와 가시성 규칙을 구분하니, 메모리에 최신 값이 있는데도 다른 Transaction이
이전 값을 읽을 수 있는 이유를 이해할 수 있었다.

### 3. Record Lock과 X Lock의 관계

`Record Lock`과 `X Lock`은 서로 경쟁하는 개념이 아니라 분류 기준이 다르다.

- Record Lock: **어디에** Lock이 걸리는지 나타낸다.
- X Lock: **어떤 모드로** Lock을 획득하는지 나타낸다.

따라서 Index Record를 배타적으로 잠근 상태는 `Record Lock + X Lock`으로 표현할 수 있다.
Record Lock이 Index Record에 걸린다는 점도 중요하다. 조건에 맞는 Index가 없을 때
Lock 범위와 실행 계획이 달라질 수 있으므로 SQL 문장만이 아니라 실제 Index 사용 여부도
함께 확인해야 한다.

### 4. IX Lock으로 이해한 Lock 계층

Transaction이 Table 내부의 일부 Row에 X Lock을 사용하려면 Table 수준에는
`IX(Intent Exclusive) Lock`을 표시한다. 이는 Table 전체를 배타적으로 잠그는 것이 아니라,
하위 Row에 배타적 Lock을 사용하고 있다는 의도를 알리는 Lock이다.

```text
Table
└─ IX Lock
   └─ Index Record
      └─ X Lock
```

이 계층을 통해 Table Lock과 Row 수준 Lock이 충돌하는지를 효율적으로 판단할 수 있다.
Lock을 단순히 `SELECT FOR UPDATE` 사용법으로 외우기보다 대상·모드·계층으로 나눠
이해하는 편이 정확했다.

### 5. LLM의 분석 결과를 가설로 다루는 구조

Project Intelligence는 AI가 찾은 내용을 바로 결함으로 확정하지 않고 다음 순서로
검증하도록 설계했다.

```text
Project Discovery
→ Capability Profile
→ Analysis Strategy
→ Hypothesis
→ Evidence Collection
→ Verification Plan
→ Executable Verification
→ Result Judge
```

판정 상태도 성공과 실패 두 가지로 제한하지 않았다.

| 상태 | 의미 |
| --- | --- |
| `CONFIRMED` | 실행 결과와 코드 근거로 실제 문제임을 확인 |
| `HIGHLY_LIKELY` | 정적 근거는 강하지만 실행 환경이 없어 확정하지 못함 |
| `HYPOTHESIS` | 추가 확인이 필요한 초기 의심 |
| `REJECTED` | 검증 결과 문제가 아닌 것으로 확인 |
| `INCONCLUSIVE` | 현재 근거와 환경으로 판단할 수 없음 |

특히 `REJECTED`를 남기면 정상 코드를 불필요하게 수정하는 일을 줄이고 같은 오탐을
반복하지 않을 수 있다.

### 6. Project Discovery와 Capability Profile

처음 보는 저장소에서는 특정 파일 하나부터 분석하지 않고 저장소의 형태, 구성요소,
기술, 통신 방식, 테스트와 운영 도구를 먼저 발견하도록 했다.

Discovery 결과는 기술 이름의 목록이 아니라 다음과 같은 Capability로 구조화한다.

```text
http_api
relational_database
orm
cache
message_broker
authentication
container
ci_cd
performance_test
observability
```

Core가 Spring, React, PostgreSQL 같은 구체 기술명을 모두 알게 만들면 새로운 기술이
추가될 때마다 Core를 수정해야 한다. 공통 동작은 Capability로 표현하고 특정 기술의
추가 확인 항목은 Adapter에 두는 방식이 재사용성에 유리했다.

### 7. Core, Adapter, Mode, Project State의 책임 분리

| 구성요소 | 책임 |
| --- | --- |
| Discovery | 저장소에 무엇이 있고 어떤 명령을 실행할 수 있는지 발견 |
| Capability Profile | 발견 결과를 기술 중립적인 형태로 저장 |
| Core | 가설·근거·검증·판정 정책 유지 |
| Adapter | 특정 기술에서 추가로 볼 위험과 증거 위치 제공 |
| Mode | 분석 목적에 따른 조사 순서와 결과 형식 정의 |

재사용 가능한 Skill 본체와 프로젝트별 결과도 분리했다.

```text
전역 Skill
project-intelligence/
├── SKILL.md
├── core/
├── modes/
├── adapters/
└── templates/

프로젝트별 상태
.project-intelligence/
├── profile.yaml
├── runs/
├── findings/
├── evidence/
└── experiments/
```

전역 Skill에는 분석 방법만 두고 프로젝트에서 발견한 사실과 실행 결과는 해당
프로젝트의 상태로 저장해야 특수 사례가 범용 규칙에 섞이지 않는다.

### 8. Progressive Disclosure와 V1 범위 제한

대형 저장소에서 모든 Adapter와 참고 문서를 처음부터 읽으면 Context가 낭비된다.
Discovery 결과를 바탕으로 실제로 발견된 Capability의 자료만 읽는 Progressive
Disclosure가 필요하다.

초기 설계를 검토하면서 모든 Adapter 구현, 대규모 점수표, 별도 테스트 실행기,
자동 수정과 CI 연동은 V1에서 제외했다. 기존 shell, Git, 프로젝트 테스트가 할 수 있는
기능을 다시 만들기보다 **무엇을 어떤 근거로 확인할지 안내하는 역할**에 집중했다.

---

## 오늘 한 일

- REPEATABLE READ의 동시 조회·수정 상황을 기준으로 MVCC 동작 정리
- Buffer Pool과 Transaction별 데이터 가시성의 차이 학습
- Record Lock, X Lock, IX Lock을 대상·모드·계층으로 구분
- Project Intelligence의 가설→근거→검증→판정 흐름 설계
- Discovery와 Capability Profile의 역할 정의
- Core, Adapter, Mode, Project State의 책임 분리
- `performance`, `bug-hunt`, `consistency`, `learn` 네 분석 Mode 구조화
- Progressive Disclosure를 적용하고 V1 범위를 축소

## 남은 질문

1. Gap Lock과 Next-Key Lock은 범위 조회와 삽입을 어떻게 제어하는가?
2. Deadlock이 발생했을 때 InnoDB는 어떤 Transaction을 희생자로 선택하는가?
3. Adapter가 없는 기술도 Capability 규칙만으로 어느 수준까지 분석할 수 있는가?
4. 정적 근거만 있는 가설과 실행으로 확인한 결과를 보고서에서 어떻게 명확히 구분할 것인가?
5. 새로운 저장소에서 Discovery 비용이 너무 커지지 않도록 탐색 범위를 어떻게 제한할 것인가?
