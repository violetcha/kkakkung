# 까꿍

웹캠의 얼굴·상체 동작으로 좁은 시야의 미로를 움직이며 도망자 3명과 술래 3명이 3분 동안 탈출과 포획을 겨루는 웹 멀티플레이 숨바꼭질 게임이다. 가공된 실제 얼굴과 근거리 음성으로 상대의 존재를 느낀다.

- 서비스: https://j15c204.p.ssafy.io (GitLab 프로젝트 `S15P21C204` Reporter 이상 멤버만 접속)
- 제품 전체와 남은 과제: **[기획서](docs/product-spec.md)**

## 문서

모든 문서는 기준 커밋의 코드에서 확인한 현재 사실만 적는다. 각 문서 첫 줄에 기준 커밋이 있다.

| 문서                                             | 내용                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| [기획서](docs/product-spec.md)                   | 게임 규칙, 화면 흐름, 조작, 운영 한도, 검증 현황, 남은 결함, 결정 질문 |
| [웹 구현 명세](docs/impl/web.md)                 | 라우트, 입장, 화면, 입력, 장면·아바타, 브라우저 저장소, 빌드           |
| [서버 구현 명세](docs/impl/server.md)            | HTTP, 환경 변수, 세션·자리, Room, 방 생명주기, 운영·관측               |
| [게임 규칙 명세](docs/impl/game-core.md)         | 틱 처리, 이동·포획·승패, 장비, 교환·시야, 출구, 맵·배치                |
| [프로토콜 명세](docs/impl/protocol.md)           | 메시지, 명령, 거절 코드, 공개 상태·개인 뷰, HTTP 계약                  |
| [미디어 명세](docs/impl/media.md)                | 발급 조건, 세대·회수, 음성·효과음, 얼굴 합성·수신, 월 사용량           |
| [인프라 명세](docs/impl/infra.md)                | Jenkins, 배포 시퀀스·스모크, compose·nginx, 스크립트, 검증 실행        |
| [결정 정정표](docs/spec/decisions.md)            | 사용자가 승인한 제품 결정 이력                                         |
| [운영](docs/operations.md)                       | 운영 절차와 장애 대응                                                  |
| [화면 디자인](docs/design/ui-system.md)          | 화면 결·창 규칙                                                        |
| [협업 컨벤션](docs/collaboration-conventions.md) | Jira·브랜치·커밋·MR 규칙                                               |
| [제3자 자산](docs/third-party-assets.md)         | 모델·SDK 권리와 고지                                                   |
| [인프라 절차](infra/README.md)                   | 호스트 구성과 배포·롤백 절차                                           |

## 구성

| 경로                              | 책임                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `apps/web`                        | React 화면, 단일 R3F Canvas, 입력·장치·Worker·미디어             |
| `server`                          | 입장·세션·좌석, Colyseus Room, 권위 Tick·개인 뷰, 미디어·운영 IO |
| `packages/protocol`               | 공개 전송 계약·Schema와 런타임 검증                              |
| `packages/game-core`              | 서버 전용 순수 규칙·맵 검증·승패                                 |
| `infra`, `Jenkinsfile`, `scripts` | 배포·CI·시험 도구                                                |
| `tests`                           | 계약·부하·Cloud·E2E 시험과 공유 fixture                          |

웹은 game-core·서버 전체 맵·튜닝·운영 비밀을 import하지 않는다.

## 로컬 시작

Node.js `24.19.0`, pnpm `11.19.0`. 루트에서 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm exec playwright install chromium
pnpm dev
```

웹 `http://localhost:5173`, 서버 `http://localhost:2567`(`/health/live`). 기본 개발 설정은 미디어가 꺼진 진단 프로필이다.

- 개발 빌드 `/`: 초대 fragment가 없으면 기존 팀 Room·sandbox 진단 화면. `/play`·초대 링크·배포 빌드는 제품 화면. `/preview`는 렌더 검수용 합성 장면.
- 제품 게임은 `SERVER_PROFILE=product`, `MEDIA_MODE=livekit`과 LiveKit·운영 설정이 필요하다. `NODE_ENV=production`은 거절하며 제품 배포도 `development`를 쓴다. 설정은 [인프라](infra/README.md)와 [운영](docs/operations.md)을 따른다.
- 웹 API 기본값은 같은 출처 `/api`(Vite가 서버로 프록시). 직접 지정하면 `VITE_API_BASE_URL=http://127.0.0.1:2567/api`처럼 접두사를 포함한다.

## 검사

```bash
pnpm verify      # 포맷 → lint·의존 경계 → 타입 → 단위/통합 → 빌드 → 제품 자산 → E2E
pnpm test:maps   # 실제 맵 변형·연결성·fallback·선발
```

Jenkins는 `pnpm verify`를 그대로 돌리지 않고 MR·배포 모드별 검사 계획을 실행한다. `develop` 병합은 제품 배포와 실제 Cloud 합성 6인 시험(DP-06)으로 이어진다. 검사 계획과 Cloud·부하 시험 조건은 [인프라 명세](docs/impl/infra.md#13-검증-실행)에 있다.

## 기여

[AGENTS.md](AGENTS.md)(AI 작업 지침), [CONTRIBUTING.md](CONTRIBUTING.md)(코드 경계·검사), [협업 컨벤션](docs/collaboration-conventions.md)을 따른다. 커밋·MR 제목은 scope 없이 `type: 변경 내용`, 관련 Jira 키는 커밋 마지막 문단과 MR 본문에 각각 적는다.
