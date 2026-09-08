# 스켈레톤 검증 결과

검증일: 2026-09-07. 대상: `S15P21C204`의 스켈레톤 통합, 불필요 파일 정리 및 기획서 추가. 관련 스토리는 [S15P21C204-40](https://ssafy.atlassian.net/browse/S15P21C204-40), 작업 브랜치는 `chore/S15P21C204-40-monorepo-skeleton-conventions`다. 이 보고서는 해당 작업의 로컬 커밋에 포함하며 Push·MR·배포 완료를 의미하지 않는다.

Windows에서 Node.js 24.19.0, pnpm 11.19.0, TypeScript 6.0.3, Chromium 153으로 검증했다. 초기 통합은 `develop`의 `90f90e9`를 기준으로 루트 의존성을 설치해 검증했다. 파일 정리 후에는 모든 앱·공유 패키지의 `dist`와 TypeScript 빌드 캐시를 지우고 전체 `pnpm verify`를 다시 실행해 종료 코드 0으로 통과했다.

초기 검증에서는 개발 서버의 포트 점유와 Windows 샌드박스의 시험 서버 종료 지연을 정리해야 했다. 이번 정리 후 검증은 별도 수동 종료 없이 끝났으며 남은 프로젝트 Node 프로세스와 5173·2567 리스너가 없음을 확인했다.

| 검사                                             | 결과                            |
| ------------------------------------------------ | ------------------------------- |
| Prettier, ESLint, workspace 의존 경계            | 통과                            |
| 공용 패키지, 서버, 웹 타입 검사                  | 통과                            |
| Vitest 단위·계약·실제 Room 통합 시험             | 12개 파일, 66개 통과            |
| 웹·서버 빌드                                     | 통과                            |
| Playwright 실제 Chromium                         | 2개 시나리오 통과               |
| 기존 `pnpm --filter @kkakkung/game-server smoke` | 초기 통합에서 통과              |
| `/health`, `/monitor`, `/playground`             | 초기 통합에서 HTTP 200          |
| Docker Compose 구성 검사                         | 초기 통합에서 통과; 실행 미실시 |

브라우저 시험은 기본 `kkakkung` 룸에 두 브라우저가 입장해 준비·시작·셀 이동·퇴장하는 흐름과, 별도 `sandbox`의 서버 권위 벡터 이동·독립 퇴장을 확인했다. 화면 캡처로 참가자와 지도 격자 표시도 확인했다. 카메라와 실제 얼굴·음성을 사용하지 않았다.

기존 서버 시험에서는 도망자의 출구를 수신하고 술래 payload에는 `exits` 필드가 없는 것을 확인했다. 잘못된 명령과 재사용 토큰, 계약 불일치, 만료, Room 상한, 활성 경기의 재준비로 시간 초기화 방지 등을 검사했다. 전체 미로·참가자 좌표 공개와 미완성 도메인 규칙은 기존 개발 단계의 범위로 남아 있다.

웹 3D 번들의 약 1.24 MB 청크 크기 경고와 R3F 내부의 Three.Clock 사용 중단 예정 경고가 남는다. 실행 실패는 아니며 정식 MVP의 로딩 최적화 단계에서 다룬다. Docker 이미지 빌드·컨테이너 동작은 미검증이다. GitLab CI 전용 설정은 제거했고 Jenkins 구축·실행도 아직 수행하지 않았다.

정리에서는 중간·중복 문서 11개, 미래 폴더의 안내 파일 6개, 미사용 계약 6개와 Worker 설정 1개, GitLab CI 설정과 중복 ignore 파일을 제거했다. 총 26개이며 필요한 설계 규칙은 기존 아키텍처·테스트 문서에 합쳤다. MR 템플릿 경로의 앞 공백과 이전 프로젝트 예시 키도 수정했다. Markdown 19개의 로컬 링크 42개와 앵커 대상에 누락이 없으며, 커밋·MR 제목은 scope 없이 쓰고 Jira 키는 접두사 없는 단독 줄을 사용한다.

`docs/spec`에 추가한 v0.0.8 HTML·DOCX는 제공된 원본과 각각 SHA-256이 일치한다. HTML의 자동 포맷·줄바꿈 변환을 제외해 원본 내용을 보존한다. 생성된 로그·빌드·시험 산출물은 정리하며 실행에 필요한 의존성과 로컬 환경 파일은 유지한다.

이 결과는 개발 스켈레톤에 대한 것이다. 실제 LiveKit 권한·회수·예산, MediaPipe 모델·장치 처리, 전체 게임 규칙 및 G1~G6는 [requirements.md](../requirements.md)의 후속 작업 상태를 따른다.

## F-01 / DP-01 실행 환경 확인 (2026-09-08)

담당 F 정호성, Jira [S15P21C204-151](https://ssafy.atlassian.net/browse/S15P21C204-151), 브랜치 `ci/S15P21C204-41-jenkins-pipeline`. 아래는 로컬·서버 사실 확인이며 Cloud·장치·부하 증거가 아니다. 비밀값은 기록하지 않는다.

| 항목                          | 확인 결과                                                                                                                                                                     | 상태      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 도구 버전                     | Node 24.19.0, pnpm 11.19.0, TypeScript 6.0.3, Playwright 1.63.0 Chromium. Windows 작업 PC 는 Node 24.19.0 zip(SHA-256 대조)로 맞춤                                            | CONFIRMED |
| AWS                           | t3.xlarge(4 vCPU·15 GiB·309 GB), ap-northeast-2a, Ubuntu 24.04.4, 커널 6.17.0-1019-aws, 공인 IP 3.35.18.207 = `dig j15c204.p.ssafy.io` = 서버 egress. IMDS 로 2026-09-08 확인 | CONFIRMED |
| 포함 전송량                   | 서버 안에서 확인 불가. SSAFY 안내 필요                                                                                                                                        | BLOCKED   |
| 도메인·TLS                    | `j15c204.p.ssafy.io`, Let's Encrypt, 만료 2026-12-06, certbot 타이머 자동갱신                                                                                                 | CONFIRMED |
| Jenkins                       | `https://j15c204.p.ssafy.io/jenkins/`, 127.0.0.1:18080 바인딩, GitLab 플러그인·Project Access Token 크리덴셜. 잡·웹훅 미생성                                                  | 부분      |
| LiveKit Cloud                 | 계정·프로젝트 alias·잔량·한도 미확인                                                                                                                                          | BLOCKED   |
| 시험 namespace·자격 주입 경로 | `SERVICE_NAMESPACE` 운영 `kkakkung-ec2`, QA 용 별도 값 미정. 주입은 Jenkins 크리덴셜 → env 파일(compose.production.yaml 은 이름만)                                            | 부분      |
| 대표 장치 6대·부하 발생기     | 미확인                                                                                                                                                                        | BLOCKED   |

로컬에서 실행한 검사와 결과:

| 명령                                                                                                               | 결과                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` → 루트 devDependency `livekit-client 2.22.2`, `vite 8.2.2` 추가 후 `pnpm install` | lockfile importers 6줄 갱신, 다른 버전 변경 없음                                          |
| `pnpm exec vitest run tests/contracts/environment.test.ts`                                                         | 32개 통과 (탐색 설정·CloudPreflight 수락/거절·runner BLOCKED·환경 검사기 값 비노출)       |
| `pnpm exec vitest run server/tests/config.test.ts`                                                                 | 20개 통과 (LiveKit·OPS·admission 그룹 전부/없음, 빈 값 = 미설정, MAX_SLOTS = MAX_ROOMS×6) |
| `node scripts/run-cloud-check.mjs --case QA-01 …` / `--case MC-01 …`                                               | 각각 BLOCKED nonzero(비 Cloud case / 파일 미인계·preflight 없음). 원격 호출 0회           |
| `node scripts/check-execution-environment.mjs --output .local/qa/environment.json`                                 | 도구 CONFIRMED, docker 로컬 MISSING, Cloud·장치 항목 BLOCKED 표시                         |
| `pnpm probe:build`                                                                                                 | `.local/qa/probe-dist` 에 MC-01 합성 probe 번들 519 kB. 실제 Cloud 연결은 미실시          |
| `pnpm verify` (format:check → check:execution → lint → typecheck(+tsconfig.qa.json) → test → build → test:e2e)     | exit 0. Vitest 13 파일 111개, Playwright 2개 통과. Cloud 파일 실행 0회                    |

설정 변경: Vitest 기본 include 에 `tests/contracts/**`·`tests/load/**` 추가, `**/*.cloud.test.ts` 기본 제외, `vitest.cloud.config.ts`(worker 1, 120s/30s) 신설, `tsconfig.qa.json` 을 루트 typecheck 에 연결, `apps/web/tsconfig.json` 에서 `*.worker.ts` 제외(D 의 `tsconfig.worker.json` 도착 후 typecheck 추가), `server/src/config/env.ts` 에 LiveKit·OPS·admission 선택 그룹 추가(production 거절·MEDIA_MODE disabled 유지), ESLint 가 `.local/` 을 무시.

Cloud case allowlist 는 `tests/cloud/CloudPreflight.ts` 의 `CLOUD_CASES` 하나가 원본이다. 아직 어떤 case 파일도 인계되지 않았으므로 runner 는 모든 case 를 BLOCKED 로 끝낸다.
