# 기여 가이드

팀원과 AI는 먼저 [AGENTS.md](AGENTS.md)와 [팀 협업 컨벤션](docs/collaboration-conventions.md)을 읽는다. 커밋·MR 제목은 scope 없이 `type: 변경 내용` 형식으로 작성한다. 관련 Jira가 있는 커밋은 본문 또는 푸터에 키를 기록하며 기본 표기는 마지막 문단에 접두사 없이 실제 Jira 키만 단독 줄로 쓰는 것이다. MR 본문의 관련 Jira 항목에도 키를 적는다.

[최신 결정 정정표](docs/spec/decisions.md)는 보관된 v0.0.8과 충돌할 때 우선한다. 원본 122개 ID 중 116개는 현재 실행 대상, 6개는 제품 결정 대기다. 미정 아이템을 임의로 설계하거나 구현하지 않으며 술래 장비·구속·자연 만료·포획·포즈 등 확정 범위는 유지한다.

[담당자별 실행 문서](docs/execution/README.md)의 작업 실행을 요청받으면 검증된 계약·fixture·단위 구현을 중간 로컬 커밋할 수 있고, 완료 작업도 필요한 검증 후 커밋한다. 작업별·이번 실행분 합본 MR 본문에 이번 단계와 미통합 조건을 기록한다. 중간 커밋은 전체 인수가 아니며 실제 생산자/소비자 연결과 필요한 Cloud/장치 검증까지 충족해야 ACCEPTED다. 푸시·MR 생성·원격 병합은 담당자가 직접 수행하고 실제 Git 신원을 유지하며 AI 공동 저자를 추가하지 않는다. 날짜별 번호와 고정 번호를 구분하고 파일 소유권을 지킨다.

## 시작 전

Node.js `24.19.0`과 pnpm `11.19.0`을 사용하고 루트에서 `pnpm install --frozen-lockfile`, `pnpm setup:env`를 실행한다. 앱 폴더에서 따로 설치하거나 lockfile을 만들지 않는다.

## 변경 경계

- `apps/web`은 브라우저 표현과 입력을 소유하며 서버 내부 패키지를 import하지 않는다.
- `server`는 기존 팀의 rooms/domain 소유권을 유지하면서 접속, 권위 조정, 서버 IO를 소유한다.
- `packages/protocol` 변경은 웹과 서버 소비자를 함께 확인한다.
- `packages/game-core`는 서버 전용 순수 규칙이다.
- 실제 맵·fallback·튜닝·Secret·운영 기록을 웹이나 protocol로 옮기지 않는다.

프로토콜 변경에는 버전 호환성, 생산자·소비자, 거절 동작을 함께 기록한다. 패키지를 추가하면 해당 workspace manifest와 루트 lockfile을 같은 변경에 포함한다.

공개 계약은 [공통 원본](docs/execution/common.md)과 [검사 가능한 타입](docs/execution/contracts/types.ts), [fixture](docs/execution/contracts/fixtures.ts), [fixture 검사](docs/execution/contracts/fixtures.test.ts)에 맞춘다. 고정 리뷰 상대 외에 해당 생산자·소비자의 검토를 받으며 한 문서 사본에만 다른 필드를 추가하지 않는다. 문서용 타입을 제품 런타임 의존성으로 import하지 않고 각 소유 모듈에서 구현한다.

기존 `kkakkung` wire 계약과 새 `sandbox` 계약을 섞지 않는다. `server/src/domain`의 규칙 계산 소유권과 스텁 범위, `server/src/rooms`의 Room·Schema·StateView 소유권은 `server/README.md`를 따른다. 공통 검증 진입점은 루트 `pnpm verify`이며 CI 실행 환경의 준비 절차는 [테스트 가이드](docs/testing.md)를 따른다. 검토 중인 Jenkins 운영 방식과 현재 미구축 상태는 [팀 협업 컨벤션](docs/collaboration-conventions.md#연동과-병합-운영)에서 구분한다.

## 완료 전 검사

```bash
pnpm format:check
pnpm check:execution
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

전체 검사는 `pnpm verify`로 실행하며 format:check 뒤 check:execution이 공통 원본·사본·타입·fixture 정합성을 검사한다. 변경 설명에는 바뀐 동작, 계약, 실행한 시험, 영향을 받는 G1~G6 관문을 적는다. 문서 fixture 검사·로컬 mock·인터페이스·빈 폴더를 제품 구현이나 실제 Cloud 완료 증거로 표현하지 않는다.

문서만 변경한 경우에는 변경 문서의 포맷·링크·내용 일관성과 관련 check:execution 결과를 검사한다. 실행 동작에 영향이 없는 문서 변경에 앱 전체 시험은 요구하지 않는다. 아이템·G3-C·G5 아이템 행동의 PRODUCT_DECISION_PENDING을 통과 수에 합산하지 않으며 확정 범위 인수를 원본 v0.0.8 전체 완료라고 보고하지 않는다.

비밀 `.env`, 토큰 원문, 실제 얼굴·음성, 개인 자료, 라이선스를 확인하지 않은 자산은 커밋하지 않는다. 제3자 자산을 추가할 때는 `docs/third-party-assets.md`의 기록 항목을 먼저 채운다.
