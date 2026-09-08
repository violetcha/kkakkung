# 까꿍 스켈레톤

까꿍 MVP를 팀이 함께 개발하기 위한 단일 pnpm workspace 저장소다. 현재 단계는 로컬에서 웹과 권위 게임 서버를 연결하고, 공유 프로토콜과 순수 게임 규칙의 경계를 확인하는 **개발용 스켈레톤**이다. 전체 게임, 실제 인증, LiveKit 미디어, 운영 복구 및 G1~G6 검증은 아직 완료되지 않았다.

## 구성

기존 스켈레톤의 로컬 검증 기록은 `pnpm verify` 통과, 단위·통합 시험 66개와 브라우저 시험 2개 통과다. 자세한 범위는 [검증 결과](docs/verification.md)에 기록했다. 실행 계획·계약 검사 추가는 별도 문서 검증이며 게임 기능 구현 상태를 바꾸지 않는다.

| 경로                 | 패키지                  | 책임                                                   |
| -------------------- | ----------------------- | ------------------------------------------------------ |
| `apps/web`           | `@kkakkung/web`         | React 화면, 단일 R3F Canvas, 서버 연결과 입력          |
| `server`             | `@kkakkung/game-server` | 기존 `kkakkung` Room과 새 `sandbox`, 개발 세션, health |
| `packages/protocol`  | `@kkakkung/protocol`    | 클라이언트·서버 공용 전송 계약과 Schema                |
| `packages/game-core` | `@kkakkung/game-core`   | 서버 전용 순수 TypeScript 규칙                         |

웹은 `game-core`, 서버 content·설정·운영 상태를 참조하지 않는다. `sandbox` 공개 상태에는 숨겨진 맵이나 서버 판정 내부값이 없다. 기존 팀 개발용 `kkakkung` 상태는 현재 전체 maze를 공개하며, 수신자별 정보 은폐는 G4의 후속 과제다.

## 환경

- Node.js `24.19.0`
- pnpm `11.19.0`
- TypeScript `6.0.3`
- Colyseus `0.18`

패키지 의존성은 각 `package.json`과 루트 `pnpm-lock.yaml`이 유일한 기준이다. Python 서버가 없으므로 `requirements.txt`는 사용하지 않는다.

## 시작

루트에서 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm exec playwright install chromium
pnpm dev
```

기본 주소는 웹 `http://localhost:5173`, 서버 `http://localhost:2567`이다. 새 React 웹은 기본값인 **기존 룸 연동**에서 일회성 토큰으로 `kkakkung` Room에 입장한다. 선택기의 **이동 샘플**을 고르면 `sandbox`를 사용한다. 토큰은 URL이나 브라우저 저장소에 보관하지 않는다.

기존 룸 연동은 준비 버튼과 phase·role·남은 시간을 표시한다. `W/S`는 바라보는 셀 방향의 전진/후진, `A/D`는 키를 누르는 순간 한 번 좌/우 회전한다. 이동 샘플은 연속 20Hz `WASD` 벡터 이동을 사용한다.

`setup:env`가 만드는 로컬 설정은 개발 전용이다. `MEDIA_MODE=disabled`만 지원하며, 인증과 미디어가 구현되기 전에는 production 시작을 차단한다. 비밀값을 `.env` 예시나 Git에 넣지 않는다.

기본 웹 API 주소는 같은 출처의 `/api`이고 Vite가 `127.0.0.1:2567`로 프록시한다. 빈 `VITE_API_BASE_URL`도 이 기본값으로 처리한다. 직접 지정할 때는 `http://127.0.0.1:2567/api`처럼 `/api` 접두사까지 포함한다. Colyseus는 개발 환경에서 기본 `ws://127.0.0.1:2567`에 직접 연결하고, production 빌드에서는 같은 출처의 루트를 사용한다.

`/api/config`은 기본 `roomName: "kkakkung"`과 진단용 `diagnosticRoomName: "sandbox"`를 내려준다.

## 공통 명령

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:execution
pnpm test
pnpm test:e2e
pnpm verify
```

`pnpm test:maps`는 현재 `packages/game-core/test/world.test.ts`의 sandbox 경계·이동 검사만 실행한다. 전체 맵·배치·fallback 검증은 아직 아니다. Cloud 미디어 시험과 부하 시험 스크립트도 제공하지 않으며, 로컬 mock 결과로 실제 Cloud 관문 통과를 주장하지 않는다.

`pnpm check:execution`은 [공통 계약 원본](docs/execution/common.md)·담당 문서 사본·[타입](docs/execution/contracts/types.ts)·[fixture](docs/execution/contracts/fixtures.ts)·[fixture 검사](docs/execution/contracts/fixtures.test.ts)의 정합성을 확인한다. `pnpm verify`의 format:check 다음에도 실행한다. 이 결과는 실제 제품 모듈 연결이나 Cloud·6대 장치·10방 부하 시험을 대신하지 않는다.

## 현재 범위

현재 스켈레톤은 두 Room의 엄격한 입력 검증, 개발 세션, 연결·해제, 공개 상태와 health/config API를 대상으로 한다. `sandbox`는 20Hz 권위 이동, 대각선 정규화와 경계 제한을 제공한다. `kkakkung`은 메시지를 받을 때 셀 이동·회전을 적용하고 20Hz 시계를 진행하는 기존 0단계 구조다. 팀 명령을 20Hz로 모아 판정하는 전체 규칙은 아직 없다. 카메라·비전·미디어 수명 경계는 후속 구현을 위한 문서로 정의하며 실제 모델과 자산은 내려받지 않는다.

기존 `server/`와 `kkakkung` Room은 삭제하거나 새 계약으로 덮어쓰지 않았다. `kkakkung`은 `move {seq, dir}`, `turn`, `ready`와 셀 `x/y` 상태를 유지하고, 새 `sandbox`는 React 연결 검증용 별도 Room이다. 현재 서버는 두 Room을 합쳐 한 Room만 허용하므로 개발·시험에서 동시에 사용하지 않는다. 기존 전체 맵 공개와 도메인 스텁은 보존된 0단계 상태이며 G3·G4 통과를 뜻하지 않는다.

Docker 개발 템플릿은 루트에서 `docker compose -f infra/compose.yaml up --build`로 실행하도록 구성했다. 현재 작성 환경에서는 Docker daemon이 실행 중이지 않아 이미지 빌드와 런타임은 검증하지 않았다.

기획·구현 기준서 **v0.0.8 원본 HTML·DOCX**는 [docs/spec](docs/spec/README.md)에 보존한다. 먼저 [최신 결정 정정표](docs/spec/decisions.md)를 적용하며 충돌 부분은 최신 사용자 결정이 우선한다. 도망자 아이템의 종류·효과·수량·배치·획득·소지·사용은 아직 미정이고, 술래 장비·구속·자연 만료·포획·포즈는 확정 범위다. 현재 요구사항과 구현 상태는 [requirements.md](requirements.md), 처음 참여하는 방법은 [docs/onboarding.md](docs/onboarding.md), 설계 경계는 [docs/architecture.md](docs/architecture.md)를 따른다.

전체 MVP의 에픽·작업 후보, 선행관계와 완료 조건은 [MVP 구현 작업 계획](docs/mvp-work-plan.md)에 정리했다. Jira 등록 전 팀 검토용 초안이다.

6명이 실행할 작업은 [담당자별 실행 문서](docs/execution/README.md)에 있다. 추적 번호 122개 중 **116개는 현재 실행 대상, 6개는 제품 결정 대기**다. 각 실행 대상에 구현 순서·수정 파일·계약·시험·커밋·MR 작성 지시를 포함한다. 목표는 9월 8–10일 구현·통합과 9월 11일 금요일 오전 확정 범위 인수다. 확정 범위 통과를 원본 v0.0.8 전체 완료나 아이템의 영구 제외로 해석하지 않는다.

작업 실행을 요청하면 AI는 검증된 중간 산출물과 완료 작업의 로컬 커밋·MR 본문까지 준비한다. 중간 커밋에는 작업 ID·검증 결과·미통합 조건을 기록하고 최종 인수와 구분한다. 공개 계약 변경은 해당 소비자도 함께 검토한다. 푸시·MR 생성·원격 병합은 담당자가 직접 수행하며 실제 Git 신원을 유지하고 AI 공동 저자를 추가하지 않는다.

공통 검증은 `pnpm verify`로 실행한다. Jenkins 사용을 검토 중이며 현재 CI/CD 파이프라인과 원격 연동은 구성하지 않았다.

팀원과 각자의 AI가 따를 협업 규칙은 [AGENTS.md](AGENTS.md)와 [팀 협업 컨벤션](docs/collaboration-conventions.md)에 있다. 커밋·MR 제목은 scope 없이 `type: 변경 내용` 형식을 사용하고, 관련 Jira가 있는 커밋의 본문 또는 푸터에는 실제 키를 기록한다.
