# 까꿍

웹캠의 얼굴·상체 동작으로 좁은 시야의 미로를 움직이며 도망자 3명과 술래 3명이 3분 동안 탈출과 포획을 겨루는 웹 멀티플레이 숨바꼭질 게임이다. 가공된 실제 얼굴과 근거리 음성으로 상대의 존재를 느낀다.

- 서비스: https://j15c204.p.ssafy.io (GitLab 프로젝트 `S15P21C204` Reporter 이상 멤버만 접속)
- 현재 단계: 팀원 전용 MVP. 로그인 게이트와 공개 대상 설정만 바꾸면 공개할 수 있는 상태를 목표로 한다. 운영은 1방·6인이며 최대 10방까지 단계적으로 올린다.
- 제품 전체와 남은 과제: **[MVP 기획서](docs/spec/current.md)**

## 문서

| 문서                                             | 내용                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [MVP 기획서](docs/spec/current.md)               | 게임 규칙, 화면 흐름, 구현 현황, 남은 과제, 완성 순서                                 |
| [결정 정정표](docs/spec/decisions.md)            | 사용자가 승인한 제품 결정 이력                                                        |
| [아키텍처](docs/architecture.md)                 | workspace 구조, 제품 실행 경로, 수명 소유                                             |
| [프로토콜](docs/protocol.md)                     | 입장 HTTP, Room 채널, 공개 상태, 거절 규칙                                            |
| [미디어](docs/media.md)                          | LiveKit 권한·세대·음성, 보류된 split 기록                                             |
| [운영](docs/operations.md)                       | 운영 모드·설정값·요청 상한·재시작 복구·장애 대응                                      |
| [테스트](docs/testing.md)                        | 로컬 검사, Cloud·부하·6인 시험, 인수 판정                                             |
| [인계 기록](docs/handoffs/)                      | 역할별(A 규칙·B 서버·C 웹·D 장치/미디어·E 미디어 권한/운영·F 인프라) 진입점과 남은 일 |
| [협업 컨벤션](docs/collaboration-conventions.md) | Jira·브랜치·커밋·MR 규칙                                                              |
| [제3자 자산](docs/third-party-assets.md)         | 모델·SDK 권리와 고지                                                                  |
| [인프라](infra/README.md)                        | Jenkins 파이프라인, 배포 장벽, 호스트 구성, 롤백                                      |

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

Jenkins도 같은 `pnpm verify`를 한 번 실행하고, `develop` 병합은 제품 배포와 실제 Cloud 합성 6인 시험(DP-06)으로 이어진다. Cloud·실제 장치·부하 인수는 [테스트](docs/testing.md)의 별도 절차다.

## 기여

[AGENTS.md](AGENTS.md)(AI 작업 지침), [CONTRIBUTING.md](CONTRIBUTING.md)(코드 경계·검사), [협업 컨벤션](docs/collaboration-conventions.md)을 따른다. 커밋·MR 제목은 scope 없이 `type: 변경 내용`, 관련 Jira 키는 커밋 마지막 문단과 MR 본문에 각각 적는다.
