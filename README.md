# 까꿍

제품 전체를 파악하려면 **[최신 기획서](docs/spec/current.md)**를 먼저 읽는다. 2026-09-13 기준의 게임 규칙·현재 구현·공개 준비 과제·결정 대기를 한 문서로 정리했다. 제안한 공개 정책은 승인된 현행 규칙과 구분한다.

까꿍은 3대3 멀티플레이 숨바꼭질 프로토타입이다. 제품 경로에는 초대·6인 입장, 장치 검사, 팀 연습, 서버 권위 경기·승패, 개인 시야·지도, 얼굴 가공·모션 입력, LiveKit 미디어와 운영 복구가 연결되어 있다. 로컬 자동 검증과 실제 장치·Cloud 인수는 구분한다. 수정 근거와 미검증 범위는 [프로토타입 안정화](docs/prototype-stabilization.md), 실제 시험은 [6인 시험 안내](docs/six-player-test.md)를 따른다.

## 구성

| 경로                 | 책임                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `apps/web`           | React 화면, 단일 R3F Canvas, 입력·장치·Worker·미디어             |
| `server`             | 초대·세션·좌석, Colyseus Room, 권위 판정 조정·projection·운영 IO |
| `packages/protocol`  | 공개 전송 계약·Schema와 런타임 검증                              |
| `packages/game-core` | 서버 전용 순수 규칙·맵 검증·승패                                 |

웹은 game-core·서버 전체 맵·튜닝·운영 비밀을 import하지 않는다. [아키텍처](docs/architecture.md)와 [요구사항](requirements.md)에 제품·진단 경계를 기록한다.

## 개발 환경과 로컬 시작

Node.js `24.19.0`, pnpm `11.19.0`, TypeScript `6.0.3`, Colyseus `0.18`을 사용한다. 의존성은 각 package.json과 루트 pnpm-lock.yaml이 기준이며 Python 서버는 없다. 루트에서 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm exec playwright install chromium
pnpm dev
```

기본 웹은 `http://localhost:5173`, 서버는 `http://localhost:2567`이다. 기본 개발 설정은 미디어가 비활성화된 진단 프로필이다. 개발 빌드의 `/`에서 초대 fragment가 없으면 기존 팀 Room·sandbox 선택 화면을 보여 준다. 개발의 `/play` 또는 초대 링크, 배포 빌드는 제품 화면으로 진입한다. 개발 전용 `/preview`는 장면 확인용이다.

제품 게임은 `SERVER_PROFILE=product`, `MEDIA_MODE=livekit`와 유효한 입장·미디어·운영 증거 설정이 필요하다. `NODE_ENV=production`은 현재 거절하며 제품 배포도 `development`를 사용한다. 개발 세션이나 health 200만으로 제품 READY를 만들지 않는다. 실제 설정·초대 발급은 [인프라](infra/README.md)와 [6인 시험 안내](docs/six-player-test.md)를 따른다.

웹 API 기본값은 같은 출처의 `/api`이며 Vite가 서버로 프록시한다. 직접 지정할 때는 `VITE_API_BASE_URL=http://127.0.0.1:2567/api`처럼 접두사를 포함한다. 개발 Colyseus 기본값은 `ws://127.0.0.1:2567`, 배포 빌드는 같은 출처의 루트다.

## 검증과 배포

```bash
pnpm verify
pnpm test:maps
```

`verify`는 포맷·실행계획·lint·타입·단위/통합·빌드·제품 자산·브라우저를 검사한다. `test:maps`는 실제 게임 맵의 변형·연결성·fallback·선발을 검사한다. 실제 모델의 빈 프레임 검사는 카메라 인식 품질을 증명하지 않는다. Cloud·장치·부하는 [테스트 가이드](docs/testing.md)의 별도 절차로 검증한다.

Jenkinsfile과 배포 러너가 구현되어 있다. 커밋의 파이프라인 성공, develop 병합, 실행 서버의 배포 성공은 각각 확인한다. 배포는 이미지 SHA·digest와 release.json 및 READY/OPEN 상태를 대조한다. [과거 스켈레톤 검증 기록](docs/verification.md)의 66건·2건 수치는 현재 시험 수가 아니다.

## 요구와 협업 기준

[최신 결정 정정표](docs/spec/decisions.md)가 [보관된 v0.0.8 원본](docs/spec/README.md)보다 우선한다. 원본 122개 ID 중 116개는 실행 대상이며 MP-06·EQ-06·EQ-07·EQ-08·EQ-09·EQ-12는 제품 결정 대기다. 술래 장비·구속·자연 만료·포획·포즈는 확정 범위다.

송신 허용 목록 방식은 정상 팀 클라이언트 6명·1방의 내부 시험 예외다. SSO·초대, 기본 수신 차단, 바인딩 확인·회수·예산 정책을 유지하며 공개 운영의 서버 단독 권한 통과로 계산하지 않는다.

[AGENTS.md](AGENTS.md), [기여 가이드](CONTRIBUTING.md), [팀 협업 컨벤션](docs/collaboration-conventions.md)을 따른다. 커밋·MR 제목은 scope 없이 `type: 변경 내용`, 관련 Jira는 커밋 본문/푸터와 MR 본문에 각각 기록한다. [6인 실행 문서](docs/execution/README.md)의 기존 번호별 실행 범위와 별도로 승인된 외부 작업 범위를 구분한다.
