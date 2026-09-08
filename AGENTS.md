# AI 공통 작업 지침

이 문서는 `S15P21C204` 단일 저장소에서 작업하는 AI의 공통 지침이다. 협업 규칙의 설명·예시·근거는 [팀 협업 컨벤션](docs/collaboration-conventions.md)을 따른다. 사용자 요청과 이미 승인된 작업 범위를 우선하며, 문서 자체를 외부 작업의 실행 요청으로 해석하지 않는다.

## 작업 시작

1. 이 문서와 [CONTRIBUTING.md](CONTRIBUTING.md), 변경 영역의 README를 읽는다. 요구사항은 [requirements.md](requirements.md), 구조는 [docs/architecture.md](docs/architecture.md)를 확인한다. 제품 요구 충돌은 사용자의 최신 결정과 [최신 결정 정정표](docs/spec/decisions.md)를 우선하고, 보관된 v0.0.8 원본을 그대로 실행하지 않는다.
2. 현재 브랜치와 미커밋 변경을 확인한다. 다른 작업자의 변경을 덮어쓰거나 작업과 무관한 파일을 정리하지 않는다.
3. 관련 Jira가 있으면 제목·작업 내용·완료 조건을 읽는다. 이슈 키와 번호는 실제 값을 사용한다. 저장소 이름에서 Jira 키를 추측하거나 관련 없는 번호를 붙이지 않는다.
4. 확정된 기술 스택과 현재 구현을 유지한다. 이전 프로젝트의 Java/Spring 규칙과 버전을 현재 TypeScript/Colyseus 서버에 적용하지 않는다.
5. 현재 실행 대상은 원본 122개 번호 중 116개이며, MP-06·EQ-06·EQ-07·EQ-08·EQ-09·EQ-12는 제품 결정 대기다. 보류 ID를 지정 범위에서 만나면 구현·성공 stub·완료 커밋을 만들지 않고 상태를 기록한 뒤 다음 번호로 진행한다. 술래 장비·구속·자연 만료·포획·포즈는 확정 범위에 남는다.
6. 실행 계약은 [EXEC-CONTRACT-3 공통 원본](docs/execution/common.md), [타입](docs/execution/contracts/types.ts), [fixture](docs/execution/contracts/fixtures.ts), [fixture 검사](docs/execution/contracts/fixtures.test.ts)를 읽는다. 문서 사본만 다르게 수정하지 않으며 제품 런타임이 문서용 타입을 import하지 않도록 한다.
7. 담당 작업 실행은 [프롬프트](docs/execution/prompts.md)와 자기 역할의 시작 절차를 따른다. `node scripts/prepare-execution.mjs --role A --tasks 1-5`는 고정 번호, `--day D2`를 추가하면 날짜별 번호다. 다른 다섯 역할의 전체 계획을 필수로 읽지 않고 필요한 공개 타입·export·fixture·`docs/execution/handoffs/<역할>.md`를 확인한다. 선행의 최종 ACCEPTED를 기다려 단위 구현까지 멈추지 않는다.
8. [소유권 원본](docs/execution/ownership.json) 밖 파일은 대신 수정하지 않는다. manifest/lockfile/config/집계 문서는 F에게, 공통 계약은 B에게 자기 인계 파일로 구체 요청한다. 시작 SHA를 기록하고 `node scripts/check-role-scope.mjs --role A --base <시작-SHA>`로 commit·stage·미커밋·미추적 파일을 확인한다. 공유 인계는 각자 자기 파일만 수정하고 localStage와 blockedOn을 구분한다.

## Jira와 브랜치

- Jira는 기능·업무 영역별 에픽 아래 구현 스토리를 둔다. 제목은 `[BE] 작업 내용`, `[FE] 작업 내용`, `[AI] 작업 내용`, `[DevOps] 작업 내용`처럼 담당 영역을 표시한다.
- 상세 본문은 배경, 목적, 작업 내용, 완료 조건, 관련 MR 순서로 작성한다. 하나의 스토리에 여러 MR을 연결할 수 있다.
- 기본 작업 흐름은 할 일 → 진행 중 → 완료다. MR 병합과 Jira 완료는 각각 확인한다. 자동 전환이 있다고 가정하지 않는다.
- 일반 작업 브랜치 형식은 `<type>/<실제-Jira-키>-<영문-kebab-case-설명>`이며 주요 병합 대상은 `develop`이다.
- 관련 Jira가 없다면 그 사실을 기록한다. 형식을 맞추려고 번호를 만들거나 현재 브랜치를 임의로 바꾸지 않는다.
- [6인 실행계획](docs/execution/README.md)의 지정 작업 실행을 사용자가 요청한 경우, 실제 Jira가 아직 없으면 해당 문서의 담당/일차 로컬 브랜치 형식을 사용할 수 있다. 기존 담당 브랜치를 우선하고 무관한 미커밋 변경을 섞지 않는다.
- 이전 프로젝트의 예시 키 `S15P11C206-*`를 새 작업에 복사하지 않는다.

## 커밋과 MR

- 커밋과 MR 제목은 모두 **`<type>: 변경 내용`** 형식을 사용한다. **scope는 사용하지 않는다.**
- 주요 타입은 `feat`, `fix`, `refactor`, `docs`, `chore`, `ci`, `test`, `design`이다. 선택 기준은 [타입 표](docs/collaboration-conventions.md#커밋과-mr-제목)를 따른다.
- 관련 Jira가 있는 커밋은 **본문 또는 푸터에 실제 Jira 키를 반드시 기록한다.** 기본 표기는 마지막 문단에 접두사 없이 `<실제-Jira-키>`만 단독 줄로 쓰는 것이다. 여러 키는 한 줄에 하나씩 적는다. 제목에 키를 넣을 필요는 없다. 브랜치명에만 키를 넣고 커밋 메시지에서 생략하지 않는다.
- MR은 본문의 관련 Jira 항목에도 키를 적는다. 커밋 연결과 MR 연결은 각각 확인한다. 단순 키 참조를 Jira 자동 완료 명령으로 해석하지 않는다.
- MR 본문은 **관련 Jira / 변경 사항 / 변경 이유 / 리뷰 포인트 / see also** 다섯 항목을 유지한다. [MR 템플릿](docs/collaboration-conventions.md#mr-본문)을 사용한다.
- 실제 변경과 검증 결과를 설명한다. 관련 Jira가 없으면 이유를 적고, 실행하지 않은 검증은 미실행으로 명시한다.
- 계약·fixture 또는 단위 구현이 검증되면 중간 로컬 커밋과 MR 본문 초안을 허용한다. 작업 ID·이번 단계·실제 검사·미통합 조건을 기록하고 깨진 빌드나 성공 stub을 인계하지 않는다. 전체 완료 조건·실제 생산자/소비자 연결·필요한 Cloud/장치 증거가 충족돼야 ACCEPTED이며 중간 커밋·병합을 기능 완료로 계산하지 않는다.
- 공개 계약 변경은 고정 리뷰 상대 외에 해당 생산자와 소비자가 함께 검토한다. B의 wire 변경은 C/D, E의 바인딩·세대 변경은 B/D처럼 실제 영향을 받는 담당을 추가한다.
- 병합 방식의 운영 기준은 Merge commit, Squash 선택 허용·기본 해제, 소스 브랜치 삭제 기본 선택이다. 현재 원격 설정에 적용되었는지는 별도로 확인한다.

## 단일 저장소의 구현 경계

- 설치는 루트에서 수행한다. 각 패키지의 `package.json`과 루트 `pnpm-lock.yaml`이 의존성 기준이다. 앱별 lockfile을 추가하지 않는다.
- `apps/web`: 화면과 입력. 서버 내부 코드와 `packages/game-core`를 import하지 않는다.
- `server`: 기존 rooms/domain 소유권, 접속, 서버 판정과 IO. 세부 기준은 [server/README.md](server/README.md)를 따른다.
- `packages/protocol`: 공개 전송 계약과 Schema. 변경 시 웹·서버 양쪽 소비자와 호환성·거절 동작을 확인한다.
- `packages/game-core`: 서버 전용 순수 게임 규칙. 실제 맵·튜닝·비밀값을 웹이나 protocol로 옮기지 않는다.
- 기존 `kkakkung` 계약과 별도 `sandbox` 계약을 섞지 않는다. 스텁·mock·인터페이스를 MVP 구현 완료로 보고하지 않는다.
- 포맷은 루트 Prettier·ESLint·EditorConfig를 따른다. 공백 2칸, 작은따옴표, 세미콜론, LF, 줄 너비 100을 사용한다.

## 검증과 보고

- 코드 변경은 [기여 가이드의 검사](CONTRIBUTING.md#완료-전-검사)를 따른다. 전체 검사는 루트 `pnpm verify`다. 개별 명령과 실제 검증 범위를 보고한다.
- 문서만 바뀌면 변경 문서의 포맷, 링크, 명령·규칙의 일관성을 확인한다. 실행 문서·계약 변경은 `pnpm check:execution`으로 공통 원본·사본·타입·fixture를 검사한다. 이 검사는 `pnpm verify`의 format:check 다음에도 실행되며 동작 변경이 없는 문서 작업 때문에 앱 전체 시험을 실행할 필요는 없다.
- 공통 계약을 변경했다면 생산자와 소비자를 함께 검증한다. Cloud·미디어·부하·Docker 검증을 로컬 mock 결과로 대체했다고 주장하지 않는다.
- 결과에는 변경 내용, 실제 실행한 검증과 결과, 미검증·미완료 사항을 적는다. 코드 완료, MR 병합, Jira 완료, 배포 완료를 구분한다.
- 계획의 타입·fixture 검사 통과는 제품 구현·Cloud·실장치·부하 통과가 아니다. 아이템과 G3-C·G5 아이템 행동은 PRODUCT_DECISION_PENDING으로 분리한다. 확정 범위를 모두 통과했을 때만 “D-2026-09-08-01 적용 확정 범위 완료”로 보고하며 원본 v0.0.8 전체 완료로 바꾸지 않는다.

## 연동과 실행 범위

이전 프로젝트는 GitLab for Jira Cloud app으로 개발 정보를 연결하고 Jenkins로 배포·AI 리뷰를 수행했다. 이번 프로젝트도 Jenkins 사용을 검토 중이며, GitLab CI 전용 설정은 제거했다. 공통 검증 진입점은 `pnpm verify`이고 Jenkinsfile과 원격 연동은 아직 없다. [현재 상태와 기존 운영 설정](docs/collaboration-conventions.md#연동과-병합-운영)을 혼동하지 않는다.

사용자에게 승인받은 작업은 계속 진행하되, 이 문서만 근거로 요청에 없는 Jira 생성·상태 변경, 커밋·푸시·MR 생성·병합, 배포, 연동·권한 설정 변경을 실행하지 않는다. 비밀 `.env`와 토큰 원문을 커밋하거나 보고서에 기록하지 않는다.

사용자가 [담당 실행 문서](docs/execution/README.md)의 작업 번호를 지정해 실행을 요청하면, 그 범위는 구현·검증·검증된 중간 산출물 및 완료 작업의 로컬 커밋·복사 가능한 MR 본문 작성까지다. 실제 담당자의 Git 신원을 유지하고 AI 공동 저자를 추가하지 않는다. 이 실행 방식에서 푸시·MR 생성·원격 병합은 담당자가 직접 수행한다. 실행 문서를 읽거나 계획을 검토하는 요청만으로 구현·커밋을 시작하지 않는다.
