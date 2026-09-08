# 팀 협업 컨벤션

작성일: 2026-09-07. 적용 저장소: `S15P21C204`.

완료된 `S15P11C206`의 실제 Jira·GitLab·Jenkins 운영 방식을 이번 프로젝트에 이어 사용하기 위한 문서다. 이번 팀이 명시적으로 정한 사항은 **커밋·MR 제목에서 scope를 사용하지 않는 것**과 **관련 Jira가 있는 커밋의 본문 또는 푸터에 실제 이슈 키를 기록하는 것**이다. 기존 프로젝트의 운영상 예외는 별도로 기록하며 권장 규칙으로 확대하지 않는다.

AI의 작업 지침은 루트 [AGENTS.md](../AGENTS.md), 설치·검증과 코드 경계는 [CONTRIBUTING.md](../CONTRIBUTING.md)를 함께 읽는다. 현재 기술 스택과 의존성은 [README.md](../README.md), 각 `package.json`, 루트 `pnpm-lock.yaml`을 기준으로 한다.

제품 범위는 [최신 결정 정정표](spec/decisions.md)가 보관된 v0.0.8과 충돌할 때 우선한다. 원본 122개 추적 번호 중 116개는 실행 대상, 6개는 제품 결정 대기다. 미정 도망자 아이템의 종류·효과·획득·소지·사용·배치를 임의로 정하지 않으며 술래 장비·구속·자연 만료·포획·포즈는 유지한다.

## 팀원과 AI의 사용 방법

AI 도구가 `AGENTS.md`를 자동으로 읽는다고 가정하지 않는다. 작업 시작 시 지침과 최신 제품 결정을 명시적으로 읽도록 전달한다. 아래 대괄호 부분은 실제 작업에 맞춰 채운다.

```text
저장소 루트의 AGENTS.md와 docs/collaboration-conventions.md를 먼저 읽고 따라줘.
docs/spec/decisions.md의 최신 결정을 적용하고 실행 계약은 docs/execution/common.md를 읽어줘.
이번 작업은 [작업 내용]이고, 관련 Jira는 [실제 이슈 키 또는 없음]이야.
기존 구현과 확정된 기술 스택을 유지해줘.
커밋·MR 제목은 scope 없이 type: 변경 내용 형식을 사용해줘.
관련 Jira가 있으면 커밋 본문 또는 푸터에 키를 넣고, 마지막 문단에 접두사 없이 키만 단독 줄로 적어줘.
MR 본문의 관련 Jira 항목에도 키를 적어줘.
이번 실행 범위는 [예: 로컬 구현·검증까지 / 검증된 로컬 커밋·MR 본문 작성까지]야.
검증된 중간 커밋은 허용하되 미통합 조건을 적고 최종 기능 완료와 구분해줘.
푸시·MR 생성·원격 병합은 내가 직접 할게. 내 Git 신원을 유지하고 AI 공동 저자는 넣지 마.
작업 후 변경 내용, 실제 검증 결과, 남은 사항을 보고해줘.
```

## Jira 작성과 관리

### 이슈 구조

- 기능·업무 영역을 에픽으로 나누고, 구현 작업은 해당 에픽의 스토리로 관리한다.
- 제목은 `[BE] 작업 내용`, `[FE] 작업 내용`, `[AI] 작업 내용`, `[DevOps] 작업 내용`처럼 영역과 작업을 표현한다. 문서는 `[docs]`, CI 작업은 `[CI]`, 양쪽 변경은 `[FE/BE]`처럼 기존에 사용한 표기도 활용할 수 있다.
- 관련 Jira 프로젝트 키와 이슈 번호는 실제 이슈에서 확인한다. `S15P21C204`라는 저장소 이름만으로 Jira 프로젝트 키를 확정하지 않는다.
- 아래 `S15P11C206-*` 예시는 이전 프로젝트의 근거다. 이번 프로젝트에서 재사용할 번호가 아니다.

### 본문 템플릿

```markdown
## 배경

현재 문제 또는 작업이 필요한 상황

## 목적

작업 후 달성할 결과

## 작업 내용

- 구현하거나 수정할 내용

## 완료 조건

- 완료 여부를 확인할 수 있는 동작과 검증 조건

## 관련 MR

- 실제 MR 번호, 링크, 현재 상태
```

한 스토리에 여러 MR을 연결할 수 있다. 예를 들어 이전 프로젝트의 [튜토리얼 스토리 -220](https://ssafy.atlassian.net/browse/S15P11C206-220)은 MR 7개를 함께 관리했다.

### 상태·스프린트·추정

기본 흐름은 할 일(To Do) → 진행 중(In Progress) → 완료(Done)다. 작업 상태와 MR 병합 상태를 각각 확인하고, 완료 조건을 충족했는지 기록한다. MR이 열렸다는 이유로 Jira를 완료 처리하지 않는다. `In Review` 단계나 병합 시 Jira 자동 완료 규칙은 기존 프로젝트에서 확인하지 못했으므로 확정 규칙으로 추가하지 않는다.

이전 프로젝트는 주 단위 스프린트를 주로 사용했고 이름은 `C206 1 스프린트`, `C206 1 스프린트 2/3/4`였다. 이번 팀에서는 실제 보드에 등록된 스프린트를 사용한다. Story point estimate에 1을 넣은 사례가 많았지만 미입력도 있었으므로 모든 작업을 1점으로 강제하지 않는다. 라벨과 컴포넌트에도 일관된 필수 입력 규칙은 확인되지 않았다.

근거: [이전 Jira 보드](https://ssafy.atlassian.net/jira/software/c/projects/S15P11C206/boards/14376). 조회 당시 210개 이슈는 에픽 16개, 스토리 193개, 버그 1개였다. 이는 기존 프로젝트의 기록이며 이번 프로젝트의 개수나 유형별 할당량이 아니다.

## 브랜치

기본 통합 브랜치는 `develop`이다. 일반적인 작업 브랜치는 다음 형식을 따른다.

```text
<type>/<실제-Jira-키>-<영문-kebab-case-설명>
```

이전 프로젝트에서 사용한 실제 예시:

```text
fix/S15P11C206-216-similarity-threshold
docs/S15P11C206-217-docs-cleanup
feat/S15P11C206-220-tutorial-contribution-effects
```

영문 설명은 작업을 식별할 수 있게 작성한다. 현재 브랜치와 다른 작업자의 변경을 먼저 확인하며, 기존 브랜치를 이름 정리 목적으로 임의 변경하지 않는다. 관련 Jira가 없을 때는 번호를 만들어 넣지 말고 MR에 해당 사실과 이유를 적는다.

### 6인 MVP 실행계획의 로컬 작업

사용자가 [담당 실행 문서](execution/README.md)의 번호를 지정해 구현을 요청하면, AI는 구현·검증·검증된 중간 산출물 및 완료 작업의 로컬 커밋·MR 본문 작성까지 수행한다. 실제 Jira가 아직 없으면 이 범위에서 `feat/mvp-a-d1` 같은 담당/일차 브랜치를 사용할 수 있다(F는 `ci/mvp-f-d1`). 기존 담당 브랜치가 있으면 재사용하고 가짜 Jira 키를 넣지 않는다.

각 작업의 MR 본문과 해당 일차 합본은 ignore된 `.local/mr/<담당>/`에 작성하고 파일 링크와 전체 본문을 담당자에게 제공한다. 본문은 아래 다섯 항목을 유지하며 실제 검사·commit SHA·선행 통합 상태를 기록한다. 푸시·MR 생성·원격 병합은 담당자가 직접 수행한다. Git author/committer는 실제 담당자의 설정을 유지하고 AI 공동 저자를 추가하지 않는다.

계약·fixture·단위 구현을 먼저 검증했다면 전체 작업 완료 전에 중간 커밋과 MR 본문 초안을 만들 수 있다. 작업 ID·이번 단계·검사 결과·미통합 조건을 적으며 깨진 빌드나 성공 stub은 인계하지 않는다. 실제 생산자/소비자 연결과 필요한 Cloud/장치 관문까지 충족해야 ACCEPTED다. 중간 커밋·MR 병합을 기능 완료나 Jira 완료로 계산하지 않는다.

보류 ID인 MP-06·EQ-06·EQ-07·EQ-08·EQ-09·EQ-12가 요청 번호 범위에 있으면 제품 결정 대기로 기록하고 다음 번호를 진행한다. 아이템 전용 G3-C/G5 조건도 PRODUCT_DECISION_PENDING으로 분리한다. 현재 확정 범위의 인수 결과는 “D-2026-09-08-01 적용 확정 범위 완료”이며 원본 v0.0.8 전체 완료나 아이템의 영구 제외가 아니다.

공개 계약의 원본은 [EXEC-CONTRACT-3](execution/common.md), [타입](execution/contracts/types.ts), [fixture](execution/contracts/fixtures.ts), [fixture 검사](execution/contracts/fixtures.test.ts)다. 공통 사본은 원본과 함께 갱신하고 `pnpm check:execution`으로 정합성을 검사한다. 고정 리뷰 쌍 외에도 해당 소비자를 추가한다. B의 private-view/응답 변경은 C/D, E의 바인딩/세대 변경은 B/D, D의 센서/callback 변경은 C, F의 Worker/CSP 변경은 D와 확인한다.

## 커밋과 MR 제목

커밋과 MR 제목은 모두 아래 형식을 사용한다. **scope는 사용하지 않는다.** 타입 뒤에 바로 콜론과 공백을 쓰고 변경 내용을 적는다.

```text
<type>: 변경 내용
```

| 타입       | 사용 목적                           |
| ---------- | ----------------------------------- |
| `feat`     | 기능 추가                           |
| `fix`      | 오류 수정                           |
| `refactor` | 동작 목적을 유지하는 내부 구조 정리 |
| `docs`     | 문서 작성·수정                      |
| `chore`    | 의존성·도구 등 유지보수             |
| `ci`       | CI·리뷰·배포 파이프라인 구성        |
| `test`     | 테스트 추가·수정                    |
| `design`   | 화면 스타일·디자인 수정             |

제목 예시:

```text
feat: 준비 상태 변경 기능 추가
fix: 재접속 시 플레이어 상태 복구 오류 수정
fix: 리뷰 JSON 파싱 오류 수정
docs: 팀 협업 컨벤션 문서화
```

Jira 키를 커밋·MR 제목에 항상 넣는 규칙은 없다. 위 타입 표는 작성 시 선택 기준이며 commitlint 같은 자동 검사 도입을 의미하지 않는다.

### 커밋 본문·푸터의 Jira 키

관련 Jira가 있는 커밋에는 **본문 또는 푸터에 실제 Jira 키를 반드시 넣는다.** 팀의 기본 표기는 마지막 문단에 접두사 없이 `<실제-Jira-키>`만 단독 줄로 쓰는 것이다. 본문 설명이 필요 없으면 제목, 빈 줄, 키만 작성해도 된다. 이미 본문에 정확한 키를 적었다면 같은 키를 푸터에 중복 기재할 필요는 없다.

```text
fix: 준비 상태 변경 시 중복 요청 처리 오류 수정

이미 반영한 요청을 다시 받아도 준비 상태가 뒤집히지 않도록 수정한다.

<실제-Jira-키>
```

각괄호 부분은 실제 이슈 키로 교체한다. 여러 스토리와 직접 관련된 커밋은 마지막 문단에 해당 키들을 한 줄에 하나씩 기록한다. 관련 이슈가 없으면 가짜 키나 예전 프로젝트 키를 넣지 않는다.

GitLab for Jira Cloud app은 키가 등장하는 위치에 따라 연결하는 개발 정보가 다르다.

| 키를 적는 위치    | Jira 개발 패널에 연결되는 주요 정보 |
| ----------------- | ----------------------------------- |
| 커밋 메시지       | 해당 커밋                           |
| 브랜치 이름       | 해당 브랜치                         |
| MR 제목 또는 설명 | 해당 MR                             |

따라서 브랜치의 키만으로 개별 커밋 연결까지 보장한다고 가정하지 않는다. 커밋은 본문·푸터에, MR은 본문의 관련 Jira 항목에 각각 기록한다. 연결의 기준은 메시지 안의 실제 Jira 키이며 별도 접두사를 붙이지 않는다.

연결된 그룹·프로젝트에 커밋을 Push한 뒤 해당 Jira의 개발 패널에서 연결을 확인한다. 로컬 커밋만으로 동기화되지는 않는다. 키 참조는 개발 정보 연결이며 Jira 상태를 완료로 전환하는 Smart Commit과는 별개다. 요청 없이 상태 전환 명령을 추가하지 않는다.

근거: [GitLab 공식 문서 — Jira 개발 패널의 연결 위치](https://docs.gitlab.com/integration/jira/development_panel/#information-displayed-in-the-development-panel). 이번 프로젝트의 앱 연결 상태는 별도 확인 대상이다.

## MR 본문

이전 저장소의 다섯 항목을 유지한다. 설명은 실제 변경 범위에 맞게 작성하며, 항목을 채우기 위해 하지 않은 작업을 적지 않는다.

```markdown
## 관련 Jira

실제 Jira 이슈 키
관련 Jira가 없으면 해당 사실과 이유

## 변경 사항

- 구현하거나 수정한 내용

## 변경 이유

- 해결하려는 문제와 변경이 필요한 이유

## 리뷰 포인트

- 검토가 필요한 동작, 경계 조건, 설계 판단

## see also

- 관련 문서·MR
- 실행한 검증과 결과
- 미검증 항목과 이유
```

검증 결과는 실행 명령과 결과를 함께 적는다. 필요한 경우 변경 사항·리뷰 포인트 안에 표나 하위 항목을 추가할 수 있다. 템플릿의 예시 문구는 실제 내용으로 교체한다.

근거: [기존 MR 템플릿](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/blob/develop/.gitlab/merge_request_templates/default.md), [실제 MR !201](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/merge_requests/201).

## 코드 규약과 검증

이번 저장소의 구조와 소유권은 [아키텍처](architecture.md), [서버 README](../server/README.md), [기여 가이드](../CONTRIBUTING.md)를 따른다. 이전 Spring 프로젝트의 `api/service/repository/domain` 패키지 구조, Java DTO, 예외 타입을 현재 서버에 이식하지 않는다.

포맷은 공백 2칸, 작은따옴표, 세미콜론, LF, 줄 너비 100을 사용한다. 실제 도구 설정은 루트 `prettier.config.mjs`, `eslint.config.mjs`, `.editorconfig`다. 단일 pnpm workspace와 단일 lockfile을 유지한다.

코드 변경의 전체 검증 명령은 루트 `pnpm verify`이며 포맷·실행 계획 정합성·린트·타입·테스트·빌드·브라우저 시험을 포함한다. format:check 바로 뒤 `pnpm check:execution`이 공통 원본·사본·타입·fixture를 검사한다. 변경한 영역과 통신 계약의 생산자·소비자를 함께 확인한다. 문서만 변경한 경우에는 해당 문서의 포맷·링크·내용 일관성과 관련 계약 검사를 수행한다. 미실행 검사는 명확히 기록하고 문서 fixture 통과를 제품 구현·Cloud·실장치·부하 통과로 표시하지 않는다.

## 연동과 병합 운영

### 이어 사용할 기존 운영 기준

| 항목             | 기존 프로젝트에서 확인한 방식                                            |
| ---------------- | ------------------------------------------------------------------------ |
| Jira 개발 정보   | `GitLab for Jira Cloud app`, 그룹 설정 상속                              |
| 기본·통합 브랜치 | `develop`                                                                |
| 병합 방식        | Merge commit                                                             |
| Squash           | Allow, 기본 선택 해제                                                    |
| 소스 브랜치 삭제 | 병합 시 기본 선택                                                        |
| 배포             | GitLab Push 이벤트 → Jenkins → 테스트·빌드·배포                          |
| AI 리뷰          | GitLab MR 이벤트 → 별도 Jenkins 잡 → Claude Code → MR 요약·인라인 코멘트 |

이전 프로젝트에는 Backend·AI Service·Frontend 배포용 Push 웹훅 3개와 AI 리뷰용 MR 웹훅 1개가 있었다. 확인한 Backend Push 웹훅은 `develop`을 필터링했다. AI 리뷰 봇은 백엔드 규약 문서를 읽었고, 리뷰 실패가 병합을 막지는 않았다. 이전 서비스별 잡 개수·이름·URL은 이번 저장소에 그대로 복사할 값이 아니다.

### 기존 설정 기록

| 항목                     | 확인한 값                                |
| ------------------------ | ---------------------------------------- |
| 보호 브랜치              | `main`만 보호, `develop`은 보호되지 않음 |
| `main` Push·Merge 권한   | Maintainer                               |
| `main` 강제 Push         | 비허용                                   |
| 파이프라인 성공 필수     | 해제                                     |
| 모든 리뷰 대화 해결 필수 | 해제                                     |
| Jira 자동 완료 전환      | 확인되지 않음                            |

이 표는 기존 운영 사실이다. 보호 브랜치 확대·필수 승인·검사 강화를 기존에 존재하던 규칙으로 설명하지 않는다. GitLab의 기본 브랜치 관련 이슈 자동 닫기 옵션만으로 Jira 상태 자동 전환까지 설정되었다고 판단하지 않는다.

근거: [Jira 연동 설정](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/settings/integrations/jira_cloud_app/edit), [MR 설정](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/settings/merge_requests), [브랜치 설정](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/settings/repository), [웹훅](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/hooks), [AI 리뷰 운영 문서](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/blob/develop/docs/operations/ai-code-review.md).

### 이번 저장소의 현재 상태

이번 프로젝트는 Jenkins 사용을 검토 중이며 GitLab CI 전용 스켈레톤은 정리했다. 공통 검증 진입점은 `pnpm verify`이고 Jenkinsfile과 Jenkins 배포·리뷰 연동은 아직 없다. 이번 프로젝트의 Jira 앱 연결, 원격 브랜치 보호·병합 설정, 실제 Jenkins 실행 상태도 이 문서 작성으로 확인되거나 변경된 것이 아니다.

따라서 위 표는 이어 사용할 운영 기준과 기존 설정 기록이며 현재 프로젝트의 연동 완료 증거가 아니다. Jenkins 구축이나 외부 설정 적용은 해당 작업을 요청받았을 때 현재 구성을 확인하고 수행한다. CI 환경에서도 사용할 설치·검증 절차는 [테스트 가이드](testing.md)를 참고한다. GitLab MR 템플릿은 [.gitlab/merge_request_templates/default.md](../.gitlab/merge_request_templates/default.md)에 있다.

## 기존 운영에서 관찰한 예외

- Jira 키 없는 브랜치·MR과 작업 이후 Jira를 정리한 사례가 있었다. 이를 모든 작업에서 Jira를 생략하라는 규칙으로 해석하지 않는다.
- `To Do → Done` 직접 전환 사례가 있었다. 자동 상태 전환이나 검토 완료의 증거로 간주하지 않는다.
- 일부 브랜치의 Jira 번호가 현재 이슈 내용과 달랐다. 북마크 표지 수정에 사용된 `-219`는 현재 AI 리뷰 파싱 개선 이슈다. 번호 문자열만 확인하지 말고 실제 이슈 내용도 대조한다.
- 로컬의 기존 `docs/output/gitlab-jira-conventions.md`는 Git에 등록되지 않은 초안이어서 확정 컨벤션의 근거로 사용하지 않았다.

근거: [MR !59](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/merge_requests/59), [Jira -219](https://ssafy.atlassian.net/browse/S15P11C206-219), [MR !189](https://lab.ssafy.com/s15-webmobile2-sub1/S15P11C206/-/merge_requests/189).
