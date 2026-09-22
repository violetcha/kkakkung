# 테스트

2026-09-15 기준. 자동 검사가 확인하는 범위와 실제 Cloud·장치·부하 인수를 구분한다. 로컬 fixture·합성 미디어·mock 통과를 G1–G6 인수나 MVP 완료로 보고하지 않는다.

## 1. 로컬 검사

Node.js `24.19.0`, pnpm `11.19.0`, Cloud 비밀값 없이 실행한다. Jenkins Verify도 `scripts/ci-verify.mjs`를 거쳐 같은 `pnpm verify`를 한 번 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # Linux CI: --with-deps chromium
pnpm verify
```

`pnpm verify` = `format:check` → `lint`(ESLint + 의존 경계) → `typecheck` → `test`(Vitest) → `build` → `check:product-assets` → `test:e2e`(Playwright).

| 명령                   | 확인 범위                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`            | packages·apps·server 단위/통합, `tests/contracts`, `tests/load`의 짧은 단위 시험. `*.cloud.test.ts` 제외                 |
| `pnpm test:maps`       | 실제 맵 변형·연결성·fallback·선발(`certified-maps.test.ts`, master-v1·maze-v1) + 미로 구조 약속(`maze-template.test.ts`) |
| `pnpm maps:check`      | 커밋된 `maze-v1.json`·fallback이 생성기(seed 267)의 산출과 바이트 단위로 같은지 확인. 재생성은 `pnpm maps:generate`      |
| `pnpm test:e2e`        | 웹·서버 진단/제품 입장, 개인 체험, 시설 렌더링. 자체 개발 서버를 띄우므로 `pnpm dev`를 끄고 실행                         |
| `check:product-assets` | 빌드된 Worker·고정 모델·WASM 해시와 빈 프레임 추론. 실제 얼굴·포즈 인식 품질은 아니다                                    |

깨끗한 checkout에는 `dist`가 없으므로 루트 명령이 protocol·game-core를 먼저 빌드한다. 개별 시험이 `PHASES is not iterable` 같은 오류를 내면 `pnpm build:packages`를 먼저 실행한다.

### 공유 계약 fixture

`tests/contracts/shared/`의 `types.ts`·`fixtures.ts`는 웹·서버 시험이 같은 계약 사례(오디오 도착 순서, 바인딩, 제스처, split grant 등)를 쓰기 위한 시험 전용 사본이다(EXEC-CONTRACT-3). 제품 코드는 이 파일을 import하지 않고 각 모듈에서 타입을 구현한다. `fixtures.test.ts`는 Vitest로, `type-tests.ts`는 QA 타입 검사로 실행된다. 공개 wire 계약의 원본은 `packages/protocol`이다.

## 2. 제품 통합 시험

| 시험                                                        | 내용                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/test/media/product-integration.test.ts`             | 실제 A/B/E/F 서버를 자식 프로세스로, 실제 C 런타임 6개를 붙여 장치 준비→연습→로딩→경기→결과→재경기. Cloud 전송과 장치는 합성, 250ms 과부하 판정은 실제 타이머                                                                                                                                    |
| `server/test/room/demo-room.test.ts`, `demo-runner.test.ts` | 관리자 데모 방이 혼자 PLAYING까지 가는지와 인형 조종 규칙(역할별 목록·교환 세션 대기·연결 상실 drop). 기본 검사에 포함                                                                                                                                                                           |
| `server/test/room/demo-room-web-runtime.test.ts`            | 같은 데모 방을 실제 웹 런타임(`product-runtime`+합성 D facade)으로 진입해 미디어 발급 없이 PLAYING에 닿는지. 원시 클라이언트가 LOAD_READY를 직접 보내는 위 시험이 놓치는 클라이언트 로딩 관문을 본다                                                                                             |
| `server/test/room/demo-scenarios.test.ts`                   | 목록·무효·재경기는 기본 검사. 인형이 미로를 걷는 실시간 시나리오(포획·덫·결과)는 옵트인 `KKAKKUNG_DEMO_SCENARIOS=1`. 한 판을 실제 시간으로 돌려 CPU를 다툰다. `KKAKKUNG_DEMO_MAP=master-v1`은 개방 격자, `KKAKKUNG_DEMO_MAP_SIZE=small`·`medium`은 크기별 미로에서 같은 시나리오를 돈다(267·321) |
| `server/test/media/multi-room-integration.test.ts`          | 옵트인. `KKAKKUNG_TEST_ROOMS=2–10`일 때만 N방을 동시에 진행하고 tick·event-loop 지연·API 60초 최대치를 측정                                                                                                                                                                                      |
| `tests/contracts/g3-*.test.ts`, `g4-*.test.ts`              | 실제 코어·Room의 규칙·과부하 격리, 개인 뷰 패킷·공개 번들의 정보 누출                                                                                                                                                                                                                            |
| `tests/contracts/deployment-*.test.ts`                      | 배포 순서·장벽 계약. 실제 Jenkins·Docker를 실행하지 않는다. DP-06 로컬 계약은 제품 기본값 `maze-v1`로 돈다: 경기 오디오 증거를 운에 맡기지 않고 같은 역할 둘을 걸어서 만나게 한다(`DeploymentGameRendezvous`, 308). 미로 가청이 사람에게 쓸모 있는지는 309에서 따로 본다                         |

```bash
KKAKKUNG_TEST_ROOMS=10 KKAKKUNG_TEST_REPORT=.local/integration/rooms-10.json \
  pnpm exec vitest run server/test/media/multi-room-integration.test.ts
```

2026-09-15 로컬 측정(Windows 22 논리 CPU, 이동 없음, PLAYING 20초): 3방 lag 60ms, 5방 84ms, 10방 3회 연속 73–88ms·tick 최대 11.5ms·API 60초 최대 626–628회(시작·발급·로딩 포함). 실제 WebRTC·이동 부하·Cloud 인수가 아니다.

### 서버 CPU 원인 찾기

- `KKAKKUNG_TEST_CPU_PROFILE=1`로 제품 통합을 실행하면 `.local/integration/product-child-<pid>.cpuprofile`과 단계·구성요소별 호출 수·시간(`cpu-metadata.json`)이 남는다.
- `node scripts/profile-summary.mjs <cpu-metadata.json> [<cpuprofile>]`는 단계별 구성요소와 자기 시간 상위 함수, `node scripts/profile-callers.mjs <cpu-metadata.json> <cpuprofile> <label>`은 깊은 비교·복제 비용을 가장 가까운 앱 호출자로 귀속한다.
- CI 콘솔의 `productServerProbe`(10ms 표본 창의 lag·CPU·GC)는 `node scripts/probe-extract.mjs <log>`로 표로 뽑는다.
- 2026-09-14 프로파일에서 서버 CPU의 27%가 `ReservationReadiness.inspect`의 깊은 비교였고, S15P21C204-249·251에서 제거했다.

## 3. Cloud 시험

실제 LiveKit Cloud를 쓰는 `*.cloud.test.ts`는 기본 검사에서 빠지며 `scripts/run-cloud-check.mjs`로만 시작한다. 순서는 사례 allowlist → preflight(프로젝트·namespace·소스 SHA·lockfile·예산·기한) → 한 사례 실행 → 증거 기록이다.

```bash
pnpm cloud:check --case <ID> --preflight <preflight.json> --evidence .local/qa/<ID>
```

| 사례                     | 파일                                         | 상태                                                        |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| DP-06                    | `tests/cloud/deployment-smoke.cloud.test.ts` | 매 제품 배포에서 자동 실행(1방·6 합성 클라이언트)           |
| MC-01                    | `server/test/media/capability.cloud.test.ts` | 권한 모드별 capability 보고서 생성                          |
| MC-PUBLIC-01/02/03       | `server/test/media/*.cloud.test.ts`          | split 후보 진단. 실행 기록은 [미디어](media.md) 6장         |
| QA-03–06 (G1-A–D)        | `tests/cloud/g1-*.cloud.test.ts`             | 실제 관측 생산자 연결 필요                                  |
| QA-08 (G4), QA-09, QA-02 | `g4-metadata`, `mvp-flow`, `performance`     | 실제 제품 6화면·성능 관측 연결 필요                         |
| QA-11, QA-12 (G2/G6)     | `staged-load`, `ten-room-integrated`         | preflight 뒤 BLOCKED. 부하 프로브는 있고 단계 구동기가 없다 |

- 시험 전용 namespace(`qa-…`)를 쓰고 운영 namespace를 쓰지 않는다. 운영 자격은 운영 호스트의 격리 프로세스에서만 읽는다.
- 실행 전에 LiveKit 대시보드의 사용량·한도를 확인하고 사례별 방·참가자·API·시간 상한 안에서만 실행한다.
- 토큰·쿠키·grant·얼굴·음성 원문을 로그·trace·증거에 남기지 않는다. 증거에는 소스 SHA, lockfile, protocolVersion, 설정 버전, 장치·네트워크 조건을 기록한다.
- 실패·정리 미확인이면 다음 단계로 올라가지 않는다.

## 4. 부하

| 도구                                    | 용도                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `scripts/run-game-load.mjs`             | 게임 단독(QA-10). 진단 서버 + 방당 합성 6클라이언트가 실제 라운드를 반복. LiveKit에 연결하지 않음 |
| `scripts/summarize-load.mjs`            | 게임 부하 증거 요약                                                                               |
| `scripts/run-media-load.mjs`            | 미디어 포함 부하 러너(`tests/load/MediaLoadScenario.ts`)                                          |
| `scripts/summarize-integrated-load.mjs` | 10방 통합 증거 판정(`tests/load/TenRoomSchedule.ts`). 통과 0, 관문 실패 1, 입력 손상 BLOCKED 3    |
| `tests/cloud/LoadProbePool.ts`          | QA-11/12 부하 프로브. 참가자마다 브라우저 하나, 표식 트랙 게시와 수신 트랙 복호. Cloud 미검증     |

```bash
node scripts/run-game-load.mjs --stages 1,3,5,10 --final-duration-seconds 1800 \
  --stage-duration-seconds 60 --network "<측정 네트워크>" --evidence .local/qa/QA-10
```

**목표치.** Tick p95 ≤ 20ms / p99 ≤ 40ms, event-loop lag p95 ≤ 20ms, 명령 수용 p95 ≤ 200ms. G2: 정상 구간 이동 60초 API ≤ 600회, 429 없음, 정책 효과 지연 p95 ≤ 500ms / p99 ≤ 1초. G6: 같은 10방 각 6세션을 유효 900초 이상 관측.

**통합 증거 형식.** 증거 디렉터리에 `run.json`(소스 SHA·시작/끝), `windows.json`(1–60초 구간을 겹침·누락 없이, `normal|transitional|reduced|destructive` 태그, 방별 계속 연결된 세션, 실제 API 요청 시각, 429 수, 정책 효과 지연), `requirements.json`, `cleanup.json`(`unresolvedRetirements`), `official-after.json`을 둔다. 방 하나의 수치를 10배로 환산하거나 짧은 구간을 60초로 채우지 않는다.

**단계.** 게임 단독 60클라이언트 30분 → 실제 Cloud 1→3→5→10방(각 단계 실패·미확인 정리·429·예산 불확실이면 중단). 10방 15분은 약 900 참가자-분, 단계 전체는 약 1,710 참가자-분으로 추정한다.

## 5. 실제 6인 시험

별도 PC·카메라·이어폰 6대로 한다. 한 PC의 여러 탭은 6대로 계산하지 않는다.

1. 6명 모두 서비스 주소에서 GitLab 로그인. 방장이 **새 방 만들기**, 나머지 5명이 6자리 방 코드로 참가한다. 원하면 입장 전에 홈의 **혼자 장치 점검·조작 체험**을 쓴다(결과는 G5에 합산하지 않음).
2. 1–5명으로 입장·취소·퇴장을 확인한다. 6명이 모여야 장치 점검으로 진행한다. 각자 카메라·추론·보정·소리 재생을 준비한다(마이크 선택).
3. 장치 점검 → 연습 → 로딩 → 경기 → 결과. W/S 전후진, A/D 90도 회전, 모션 중립 복귀, 지도 교환, 장비 설치·발동, 구속·자연 해제·포획, 세 가지 탈출 포즈를 확인한다.
4. 허용 상대 얼굴·음성 수신, 금지 상대 미수신, 음량·전체 끄기·친구별 끄기가 금지 수신을 열지 않는지 확인한다.
5. 같은 팀 재경기, 역할 교환 재경기, 로비 복귀 후 1명 교체 완주를 각각 결과까지 진행한다.
6. 카메라를 끊으면 키보드·기본 얼굴로 전환, 복구는 장치 재점검 → 새 보정 → 모션 선택. 마이크만 끊으면 얼굴·게임 연결 유지. 미디어 장애는 같은 참가를 유지한 채 새 세대로 복구. PLAYING 중 ACTIVE 참가자 게임 소켓 종료는 `GAME_CONNECTION_LOST` 무효이며 자동 복귀를 기대하지 않는다.
7. 모두 퇴장한 뒤 원격 참가자·트랙·Worker·장치가 남지 않는지 확인한다.

기록에는 소스 SHA·이미지, 날짜·단계·익명 참가자, OS/브라우저·장치, 네트워크, 기대/실제 결과, 비밀값 없는 오류 코드를 남긴다. 미실행은 `NOT_RUN`. 원시 기록 형식은 [manual-six-device.md](../tests/fixtures/manual-six-device.md), 수집은 `scripts/collect-six-device-results.mjs`다. 준비 단계에서 막히면 [운영 6장](operations.md#6-장애-대응)의 로그 명령과 참가자 화면의 “내 준비 대기” 항목을 대조한다.

## 6. 인수 판정

| 관문     | 합격 조건                                                              | 실행 방식                  |
| -------- | ---------------------------------------------------------------------- | -------------------------- |
| G1-A–D   | 허용 수신·불허 직접 구독 차단·지연/회수·옛 토큰·복구                   | Cloud                      |
| G2       | 실제 10방 정상 API ≤ 600회/60초, 429 없음, 효과 지연 p95 ≤ 500ms       | Cloud                      |
| G3-A/B/D | 확정 게임 규칙·개인 종료·장비·구속·동시 Tick·과부하 격리               | 제품 통합                  |
| G3-C     | 아이템 전용 사례 — `PRODUCT_DECISION_PENDING`, 통과 수에 합산하지 않음 | —                          |
| G4       | 술래 출구·미탐색 지형·시야 밖 좌표·metadata 누출 없음                  | 패킷·번들 + Cloud metadata |
| G5       | 대표 장치 6대로 얼굴·음성·모션·협업 5판 완주                           | 실제 장치                  |
| G6       | 1→3→5→10방 게임·미디어·API 동시 검증                                   | Cloud                      |

`scripts/verify-mvp-evidence.mjs`가 관문 manifest를 판정한다. 각 관문 증거는 실제 JSON 파일과 SHA-256, 실행 소스 SHA·lockfile 해시·protocolVersion·환경·기록 시각을 가져야 하며, Vitest JSON 보고서의 assertion을 다시 확인한다. CLI는 실제 `git rev-parse HEAD`와 lockfile을 직접 읽는다. G1/G2/G4/G5/G6는 `local-fixture`로 인수할 수 없다.

```bash
node scripts/verify-mvp-evidence.mjs --gates .local/qa/mvp-gates.json --input .local/qa
```

결과 필드: `summary.mvpComplete`(필수 관문 실제 인수), `release.ready`(같은 빌드의 격리·회수·smoke 정리·READY/OPEN), `publication.allowed`(두 조건 + 대상 `public`). 팀 전용 운영에서 `publication.allowed=false`는 의도된 결과다. 최종 기능 인수 문구는 “D-2026-09-08-01 적용 확정 범위 완료”이며 원본 v0.0.8 전체 완료로 바꾸지 않는다.
