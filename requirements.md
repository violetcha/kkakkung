# 까꿍 스켈레톤 요구사항

기준 문서는 [최신 결정 정정표](docs/spec/decisions.md), [기획·구현 기준서 v0.0.8 원본](docs/spec/README.md), 승인된 단일 레포 팀 가이드다. 충돌 부분은 최신 사용자 결정과 정정표가 우선한다. 이 문서는 현재 확정 요구, 제품 결정 대기, 스켈레톤의 실제 구현 범위를 구분한다.

원본 122개 추적 ID 중 116개는 현재 실행 대상이며 MP-06·EQ-06·EQ-07·EQ-08·EQ-09·EQ-12의 6개는 제품 결정 대기다. 도망자 아이템의 종류·효과·수량·배치·획득·소지·사용을 구현하거나 검수 조건으로 강제하지 않는다. 술래 장비·구속·자연 만료·유예·포획·포즈 등 확정 요구는 유지한다.

## 환경과 고정 스택

| ID     | 요구사항                                                                                                         | 인수 기준                                                                                                                  | 상태                 |
| ------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| ENV-01 | Node.js `24.19.0`, pnpm `11.19.0`을 개발·CI 기준으로 사용한다.                                                   | 버전 파일과 루트 `packageManager`를 기준으로 사용하며 향후 Jenkins 환경도 같은 버전을 사용한다.                            | 로컬 적용, CI 미구축 |
| ENV-02 | TypeScript `6.0.3`, Colyseus `0.18` 호환 조합을 잠근다.                                                          | manifest와 단일 lockfile에 정확한 버전이 기록된다.                                                                         | 스켈레톤             |
| ENV-03 | `server`, `apps/web`, `packages/protocol`, `packages/game-core`의 4개 workspace와 루트 lockfile 하나를 사용한다. | 하위 npm lockfile이 없고 내부 의존성이 `workspace:*`다.                                                                    | 로컬 통합 검증 통과  |
| ENV-04 | Python 서버를 두지 않는다.                                                                                       | Python 런타임과 `requirements.txt` 없이 Node 서버로 실행된다.                                                              | 확정                 |
| ENV-05 | 로컬 기본 포트는 web 5173, server 2567이다.                                                                      | API `/api`는 Vite proxy, 개발 Colyseus는 `ws://127.0.0.1:2567` 직접 연결을 사용한다.                                       | 스켈레톤             |
| ENV-06 | E2E 전에 Playwright Chromium을 설치한다.                                                                         | 로컬은 `pnpm exec playwright install chromium`, Linux CI는 `pnpm exec playwright install --with-deps chromium`을 실행한다. | 실행 전제            |

패키지의 정확한 전체 목록은 `package.json`과 `pnpm-lock.yaml`이 기준이다. 문서에 적지 않은 라이브러리를 추가할 때는 소유자와 의존 방향을 먼저 검토한다.

## 기능 요구사항

| ID    | 요구사항                                                                                                                      | 소유                                    | 인수 기준                                                                     | 현재 상태           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| FR-01 | React 웹에는 닉네임 기반의 짧은 만료시간 일회성 개발 토큰을 발급한다. 기존 Playground의 빈 입장은 development에서만 호환한다. | server/session                          | 토큰 재사용·만료·변조를 거절하고 빈 입장은 production에서 허용하지 않는다.    | 로컬 통합 검증 통과 |
| FR-02 | React 클라이언트는 기본 `kkakkung`과 선택형 `sandbox`를 protocol `0.1.0`으로 연결한다.                                        | protocol + web + server                 | 선택한 Room의 서로 다른 계약을 적용하고 알 수 없는 키·잘못된 입장을 거절한다. | 로컬 통합 검증 통과 |
| FR-03 | 서버가 playerId를 발급하고 Colyseus session과 연결한다.                                                                       | server/room                             | 클라이언트가 playerId를 지정할 수 없고 퇴장 시 제거된다.                      | 스켈레톤            |
| FR-04 | `sandbox` 이동 명령은 `seq`, `x`, `z`를 검증하고 20Hz 권위 Tick에서 처리한다.                                                 | protocol + game-core + server           | 유한한 -1..1 입력만 허용하고 대각선·경계·중복 seq·미등록 참가자를 처리한다.   | 스켈레톤            |
| FR-05 | `sandbox`에서 한 Tick에 받은 입력은 그 Tick에만 유효하다.                                                                     | game-core + server                      | 키를 놓거나 패킷이 없으면 다음 Tick 이동이 멈춘다.                            | 스켈레톤            |
| FR-06 | live/ready health와 공개 config를 제공한다.                                                                                   | server/http                             | `/health/live`, `/health/ready`, `/api/config` 응답이 정의된 계약과 일치한다. | 스켈레톤            |
| FR-07 | `src/app/App.tsx`가 `features/game/scene/WorldCanvas.tsx`의 단일 R3F Canvas와 `src/app/SessionRuntime.ts`를 조립한다.         | web/game                                | 여러 Canvas나 웹 내부 권위 판정 없이 서버 공개 상태를 렌더링한다.             | 로컬 검증 통과      |
| FR-08 | 확정된 3대3 게임 규칙, 맵, 술래 장비·구속·자연 만료·포획·포즈·승패를 서버 권위로 구현한다.                                    | game-core + server                      | 확정 범위 G3-A/B/D와 결정적 규칙·실제 Room 통합 시험을 통과한다.              | TODO                |
| FR-09 | 수신자별 시야·개인 지도·사건 projection을 제공한다.                                                                           | server/projection + protocol            | G4에서 비공개 맵·좌표·metadata가 유출되지 않는다.                             | TODO                |
| FR-10 | 웹캠 얼굴 가공, 포즈/제스처 추론, 근거리 음성을 구현한다.                                                                     | web/devices·vision·media + server/media | 실제 장치와 Cloud를 포함한 G1·G5 증거가 있다.                                 | TODO                |
| FR-11 | 실제 초대 인증, 운영 저널·예산·복구 준비 장벽을 구현한다.                                                                     | server/session·operations               | 재시작·토큰 회수·UNKNOWN 실패 주입 시험을 통과한다.                           | TODO                |
| FR-12 | 기존 `kkakkung` Room의 `move {seq,dir}`·`turn`·`ready`, 셀 `x/y`, 도메인 소유권과 스텁 범위를 보존한다.                       | server/rooms + server/domain            | 기존 playground 계약과 엄격한 런타임 입력 검증이 함께 유지된다.               | 로컬 통합 검증 통과 |
| FR-13 | `sandbox` Room은 새 React 연결 검증용 별도 계약으로 유지한다.                                                                 | web + protocol + server                 | `kkakkung` 계약을 변경하지 않고 개발 토큰·벡터 이동 흐름을 검증한다.          | 로컬 통합 검증 통과 |
| FR-14 | 도망자 아이템의 종류·효과·수량·배치·획득·소지·사용과 MVP 포함 범위는 사용자 결정 후 갱신한다.                                 | 제품 결정 후 담당 확정                  | 현재 구현·성공 stub·아이템 전용 G3-C/G5 통과를 요구하지 않는다.               | 제품 결정 대기      |

## 비기능 요구사항

| ID     | 요구사항                                                                                                                 | 소유               | 인수 기준                                                                         | 현재 상태                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------- | ------------------------------ |
| NFR-01 | sandbox world core는 결정적 순수 TypeScript이며 IO, SDK, 시간, 난수에 직접 의존하지 않는다.                              | game-core          | 같은 sandbox 상태·명령·dt가 같은 결과를 낸다.                                     | 로컬 검증 통과                 |
| NFR-02 | 웹에 `game-core`, 전체 맵, fallback 배치, Secret, 운영 기록을 포함하지 않는다.                                           | 전 팀              | import 검사와 번들/패킷 검토에서 누출이 없다.                                     | 일부 구현, G4 미실시           |
| NFR-03 | `sandbox` 이동은 단일 20Hz Tick 경로를 사용한다. 기존 `kkakkung`은 메시지 handler의 셀 이동·회전과 20Hz 시계를 유지한다. | server             | Room별 현재 실행 모델을 시험하고 전체 팀 규칙의 Tick 직렬화는 후속 구현으로 둔다. | 통합 소스 구현, 전체 규칙 TODO |
| NFR-04 | Secret과 원본 토큰·얼굴·음성을 소스와 시험 산출물에 저장하지 않는다.                                                     | 전 팀              | 저장소와 리포트 점검에서 민감 자료가 없다.                                        | 정책 적용                      |
| NFR-05 | 개발 모드와 production을 명확히 분리한다.                                                                                | server/config      | 인증·미디어가 없는 `MEDIA_MODE=disabled`로 production이 준비 상태가 되지 않는다.  | 스켈레톤                       |
| NFR-06 | 깨끗한 환경에서 설치·브라우저 준비·품질 검사·시험·빌드를 재현한다.                                                       | toolchain + CI     | 의존성 설치와 Playwright Chromium 준비 후 `pnpm verify`가 성공한다.               | Windows 로컬 검증 통과         |
| NFR-07 | 10방에서 전체 관리 API ≤600회/60초, 429 없음, 허용·차단 지연 p95 500ms/p99 1초를 목표로 한다.                            | operations + media | 같은 실제 통합 구간의 호출·수신 계측으로 G2를 통과한다.                           | TODO                           |
| NFR-08 | 최종 10방, 60 미디어 세션을 단계적으로 검증한다.                                                                         | QA + operations    | 1→3→5→10방과 실제 이동·정책·API·미디어 동시 구간으로 G6를 통과한다.               | TODO                           |
| NFR-09 | 현재 프로세스의 Room 용량은 `kkakkung`과 `sandbox`를 합쳐 하나다.                                                        | server + QA        | 개발·시험이 두 Room을 동시에 만들지 않으며 격리된 순서로 실행된다.                | 통합 제약                      |

## 수명 요구사항

| ID      | 요구사항                                                                                      | 인수 기준                                                                                  | 상태           |
| ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| LIFE-01 | `retireMediaGeneration`은 게시·수신 트랙, 음성 그래프, SDK 연결 등 해당 미디어 세대만 닫는다. | 논리 playerId, 경기 참가 자격, 게임 Room 연결은 유지된다.                                  | 문서 정의/TODO |
| LIFE-02 | 구 세대 회수를 확인한 뒤에만 해당 참가자의 새 receiverGeneration과 새 Identity를 발급한다.    | 폐기 Identity를 재사용하지 않고 불명 상태에서 발급하지 않으며 다른 참가자 세대는 유지한다. | TODO           |
| LIFE-03 | `endParticipation`은 개인 종료·실제 퇴장·매치 종료 규칙에 따라 입력과 참가 자격을 끝낸다.     | 결과·누계·출구 기록은 필요한 동안 보존하고 실제 퇴장에서 게임 연결을 정리한다.             | 문서 정의/TODO |
| LIFE-04 | 카메라·추론 장애는 참가 종료가 아니다.                                                        | 보조 입력과 안전 얼굴로 전환하며 `endParticipation`을 호출하지 않는다.                     | TODO           |

## 검증 관문

| 관문           | 합격 조건                                                                           | 현재 결과 |
| -------------- | ----------------------------------------------------------------------------------- | --------- |
| G1 미디어 권한 | 허용 수신, 불허 직접 구독 차단, 지연/timeout·세대 교체·탈락·재시작 후 옛 토큰 회수  | 미실시    |
| G2 10방 제어량 | 정상 통합 구간 전체 API ≤600회/60초, 429 없음, 실효 권한 지연 목표 통과             | 미실시    |
| G3 게임 규칙   | 확정 규칙, 개인 종료자 이탈, 덫 후보/구속/자연 만료/유예, Tick 과부하 시험          | 미실시    |
| G4 정보 은폐   | 출구·미탐색 지형·시야 밖 좌표가 payload, 오류, metadata에 없음                      | 미실시    |
| G5 6인 완주    | 대표 장치 6대에서 실제 얼굴·음성·모션·지도 교환·술래 장비·구속·포즈로 5판 연속 완주 | 미실시    |
| G6 수용량      | 1→3→5→10방, 최종 10방에서 게임·관리 API·미디어 동시 실행                            | 미실시    |

스켈레톤의 단위·통합·E2E 통과는 G1~G6 통과와 다르다. 실행 증거가 생기기 전에는 결과를 “미실시”로 유지한다.

아이템 전용 G3-C와 G5 행동은 PRODUCT_DECISION_PENDING으로 별도 기록하고 현재 확정 범위의 성공·실패 수에 합산하지 않는다. 확정 범위 전체를 검증하면 “D-2026-09-08-01 적용 확정 범위 완료”로 보고할 수 있으며 원본 v0.0.8 전체 완료로 표시하지 않는다.

기존 `kkakkung` 상태의 전체 maze·players 공개는 마이그레이션 중 보존한 0단계 동작이다. 엄격한 메시지 검증이나 `exits` 필드 골격만으로 G4 정보 은폐를 통과했다고 판단하지 않는다. 셀 규칙과 match 도메인도 현재 스텁 범위를 포함하므로 전체 G3 구현으로 집계하지 않는다.

React UI의 기본 `roomName`은 `kkakkung`이며 준비 버튼, phase·role·time, `W/S` 셀 이동과 `A/D` 단발 회전을 제공한다. 선택형 `diagnosticRoomName=sandbox`는 연속 20Hz WASD 이동 샘플이다. `kkakkung` 명령은 메시지 도착 시 적용되며 전체 팀 명령을 20Hz Tick으로 일괄 판정한다고 주장하지 않는다.

## 명령 인수 기준

루트는 `install --frozen-lockfile`, `setup:env`, `dev`, `build`, `typecheck`, `lint`, `format:check`, `check:execution`, `test`, `test:e2e`, `verify`, `test:maps`를 제공한다. `test:e2e`와 이를 포함한 `verify` 전에는 Playwright Chromium을 설치한다. `test:maps`는 현재 sandbox world의 경계·이동 시험 하나이며 전체 맵 검증으로 집계하지 않는다. 각 명령은 실제 검사 없이 성공 종료해서는 안 된다. Cloud와 통합 부하 명령은 구현·비용·환경이 준비될 때 별도 추가한다.

`check:execution`은 [EXEC-CONTRACT-2 공통 원본](docs/execution/common.md), 담당 문서 사본, [타입](docs/execution/contracts/types.ts), [fixture](docs/execution/contracts/fixtures.ts), [fixture 검사](docs/execution/contracts/fixtures.test.ts)를 대조하며 `verify`의 format:check 다음에 실행한다. 이는 실행 계획의 정합성 검사다. 실제 제품 모듈의 생산자/소비자 연결과 Cloud·장치·부하 검증은 별도다.
