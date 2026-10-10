# 까꿍

웹캠의 얼굴·상체 동작으로 좁은 시야의 미로를 움직이며 도망자 3명과 술래 3명이 3분 동안 탈출과 포획을 겨루는 웹 멀티플레이 숨바꼭질 게임이다. 가공된 실제 얼굴과 근거리 음성으로 상대의 존재를 느낀다.

- 서비스: https://j15c204.p.ssafy.io (lab.ssafy.com 계정으로 로그인. 데모·시연 방은 등록 이메일만)
- 제품 전체와 남은 과제: **[기획서](docs/product-spec.md)** · 요구사항: **[요구사항 명세서](docs/requirements.md)** · 계약: **[API 설계서](docs/api-design.md)**

> SSAFY 15기 특화 프로젝트 · **광주캠퍼스 우수상** · 6인 팀 · 2026.08 ~ 2026.10

## 내 역할 (손주연)

- 서버 규칙 엔진([`packages/game-core`](docs/impl/game-core.md)) 설계·구현. 규칙 엔진 소스의 약 94%를 작성했다.
- 9월 중순부터 웹 3D 화면 개발을 겸임했고, 발표용 시연 방 `/showcase`를 기획·구현했다.
- 경기 구간 코드를 점검해 결함 10건을 확정하고, 그중 5건을 직접 수정했다.

## 주요 트러블슈팅

| 문제                                    | 원인                                                                    | 해결                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 시연 방에 들어가면 입장 화면으로 돌아감 | 서버가 입장 잠금 상태였는데, 시연 경로만 상태 확인 없이 입장을 허용했다 | 두 경로의 상태 확인 절차를 통일하고 실패 원인을 화면에 표시했다       |
| 모두 나간 방이 사라지지 않음            | 미디어 회수의 첫 응답이 '불명'이면 이후 성공이 방에 전달되지 않았다     | 미확정 회수를 추적해 확정 시 다시 알리고, 수명주기 회귀 시험을 추가했다 |
| CI에서만 키 입력이 무시됨               | CPU가 바쁠 때 키를 뗀 입력이 이동 판정보다 먼저 처리됐다                | 키를 떼는 순간 누른 시간으로 판정하도록 이동·회전 코드를 함께 고쳤다  |

## 주요 기능

- **몸으로 조작**: 몸을 앞뒤로 기울여 한 칸씩 걷고, 고개를 돌려 90도 회전한다. 술래는 주먹으로 잡고 V 손동작으로 장비를 설치하며, 도망자는 손바닥으로 지도를 교환하고 출구 앞에서 팔 자세를 1.2초 유지해 탈출한다. 카메라가 끊기면 키보드로 대신한다.
- **실제 얼굴과 근거리 음성**: 브라우저 안에서 얼굴 윤곽만 잘라 흑백으로 가공한 얼굴이 아바타 머리에 붙는다. 목소리는 벽을 돌아가는 실제 경로 5칸 안에서만 들린다.
- **정보 비대칭**: 모두 정면 3.5칸만 본다. 도망자는 자기 출구를 찾아야 하고, 술래는 출구를 모른 채 감지기·덫과 교환 흔적으로 추적한다.
- **서버 권위**: 이동·포획·시야·승패를 서버가 50ms 틱으로 판정하고, 각자에게 보이는 것만 보낸다.
- **방 종류**: 일반 방(3:3), 발표용 시연 방(2:2, 자리 고정), 서버 인형 5명과 혼자 확인하는 데모 방, 서버 없이 체험하는 튜토리얼.

## 기술 스택

| 영역   | 사용                                                                            |
| ------ | ------------------------------------------------------------------------------- |
| 웹     | React 19, three.js(React Three Fiber), MediaPipe Tasks Vision(Web Worker), Vite |
| 서버   | Node.js 24, Colyseus(실시간 Room), Express(HTTP)                                |
| 미디어 | LiveKit Cloud(WebRTC SFU), 서버가 발급하는 세대별 권한                          |
| 계약   | TypeScript 공유 패키지, zod 런타임 검증, Colyseus Schema                        |
| 인프라 | Docker compose, nginx(GitLab SSO), Jenkins, AWS EC2 호스트 1대                  |

## 문서

모든 문서는 기준 커밋의 코드에서 확인한 현재 사실만 적는다. 각 문서 첫 줄에 기준 커밋이 있다.

| 문서                                             | 내용                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| [기획서](docs/product-spec.md)                   | 게임 규칙, 화면 흐름, 조작, 운영 한도, 검증 현황, 남은 결함, 결정 질문 |
| [요구사항 명세서](docs/requirements.md)          | 기능·비기능 요구사항 ID, 우선순위, 구현 상태와 근거, 제외 범위         |
| [API 설계서](docs/api-design.md)                 | HTTP 경로·인증·요청·응답·오류, 실시간 메시지·명령·종료 코드            |
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
pnpm verify      # 포맷 → lint·의존 경계 → 타입 → 단위/통합 → 빌드 → 공개 번들 → 제품 자산 → E2E
pnpm test:maps   # 실제 맵 변형·연결성·fallback·선발
```

Jenkins는 `pnpm verify`를 그대로 돌리지 않고 MR·배포 모드별 검사 계획을 실행한다. `develop` 병합은 제품 배포와 실제 Cloud 합성 6인 시험(DP-06)으로 이어진다. 검사 계획과 Cloud·부하 시험 조건은 [인프라 명세](docs/impl/infra.md#13-검증-실행)에 있다.

## 기여

[AGENTS.md](AGENTS.md)(AI 작업 지침), [CONTRIBUTING.md](CONTRIBUTING.md)(코드 경계·검사), [협업 컨벤션](docs/collaboration-conventions.md)을 따른다. 커밋·MR 제목은 scope 없이 `type: 변경 내용`, 관련 Jira 키는 커밋 마지막 문단과 MR 본문에 각각 적는다.
