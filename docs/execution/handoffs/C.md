# C 공개 인계 기록

수정자: C 김산이 · 2026-09-10 · [담당 계획](../c-web-ui.md) · [공통 규칙](../common.md)

## 현재 상태

사용자 지정 9/10·9/11 일정을 적용하며 원본 번호·완료 조건을 유지한다. EXEC-CONTRACT-3 및 D-2026-09-08-01 기준이다. 오늘 10개 작업은 LOCAL_VERIFIED, ACCEPTED 0건이다. C-14/18/19는 화면·상태·단위 시험 선행 구현이며 통합 완료가 아니다. 내일 신규 8개는 PLANNED, C-10은 PRODUCT_DECISION_PENDING이다. MP-06·EQ-06·EQ-07·EQ-08·EQ-09·EQ-12의 보류를 해제하지 않는다.

시작 SHA: `3388133d2d4ed9d06beeb0b547df93e9d9dd834c`. 브랜치: `feat/S15P21C204-99-web-ui`. 시작 당시 develop과 origin/develop 일치 및 미커밋 변경 없음. 기존 C 로컬 커밋·개인 기록이 없어 메시지 재작성 대상 없음. 신규 커밋은 실제 Git 신원 sanikani를 유지하며 실제 Jira footer를 넣었다. 푸시·MR 생성·원격 병합·Jira 변경 없음.

C-01 기반 SHA: `d11a8eff5f1f4ce6589c4793ff3a85ea514199f1`. 후속 조립 포함 최종 구현: `27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe`. 표는 문서 커밋이 아니라 검증한 구현 SHA를 가리킨다. 실제 Jira 19개 스토리 제목·본문·라벨·담당자 김산이를 읽기 전용으로 대조했다.

| 작업 | 원본 ID | 관련 Jira                                                           | 구현 최종 SHA                            | localStage               | blockedOn                                                                                  |
| ---- | ------- | ------------------------------------------------------------------- | ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| C-01 | VI-01   | [S15P21C204-99](https://ssafy.atlassian.net/browse/S15P21C204-99)   | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 6대 반복 장면 자원 측정.                                                              |
| C-02 | AC-06   | [S15P21C204-100](https://ssafy.atlassian.net/browse/S15P21C204-100) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 초대 URL부터 장치 준비까지 전체 브라우저 흐름. 실제 B/D 로비 transport 구간만 검증됨. |
| C-03 | VI-02   | [S15P21C204-101](https://ssafy.atlassian.net/browse/S15P21C204-101) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 A/B 이동·지연·코너 브라우저 인수.                                                     |
| C-04 | FL-02   | [S15P21C204-102](https://ssafy.atlassian.net/browse/S15P21C204-102) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | D 실제 카메라/마이크 권한·보정·가공 프레임 및 오디오 준비 인수.                            |
| C-05 | VI-05   | [S15P21C204-103](https://ssafy.atlassian.net/browse/S15P21C204-103) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | D-14 실제 송출 품질 전환과 F 대표 저사양 장치 측정.                                        |
| C-06 | KN-09   | [S15P21C204-104](https://ssafy.atlassian.net/browse/S15P21C204-104) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 B projection/교환 후 지도와 개인 종료 통합.                                           |
| C-07 | VI-03   | [S15P21C204-105](https://ssafy.atlassian.net/browse/S15P21C204-105) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | C-15 발견→도전→폐쇄 실제 흐름.                                                             |
| C-08 | EQ-10   | [S15P21C204-106](https://ssafy.atlassian.net/browse/S15P21C204-106) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-09 | EQ-11   | [S15P21C204-107](https://ssafy.atlassian.net/browse/S15P21C204-107) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-10 | EQ-12   | [S15P21C204-108](https://ssafy.atlassian.net/browse/S15P21C204-108) | —                                        | PRODUCT_DECISION_PENDING | PRODUCT_DECISION_PENDING                                                                   |
| C-11 | KN-10   | [S15P21C204-109](https://ssafy.atlassian.net/browse/S15P21C204-109) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-12 | KN-11   | [S15P21C204-110](https://ssafy.atlassian.net/browse/S15P21C204-110) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-13 | VI-04   | [S15P21C204-111](https://ssafy.atlassian.net/browse/S15P21C204-111) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-14 | FL-10   | [S15P21C204-112](https://ssafy.atlassian.net/browse/S15P21C204-112) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | D-17 실제 Cloud/장치 자원 회수와 B 개인 종료·복구 전체 인수.                               |
| C-15 | EX-04   | [S15P21C204-113](https://ssafy.atlassian.net/browse/S15P21C204-113) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-16 | EX-05   | [S15P21C204-114](https://ssafy.atlassian.net/browse/S15P21C204-114) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-17 | FL-04   | [S15P21C204-115](https://ssafy.atlassian.net/browse/S15P21C204-115) | —                                        | PLANNED                  | 9/11 지정 작업 순서.                                                                       |
| C-18 | FL-07   | [S15P21C204-116](https://ssafy.atlassian.net/browse/S15P21C204-116) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | B/F assetVersion 합의 및 B-15~18·D 실제 media grant/binding 로딩 통합.                     |
| C-19 | FL-09   | [S15P21C204-117](https://ssafy.atlassian.net/browse/S15P21C204-117) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | B-15~18·D-17 실제 종료/재경기와 F 6대 반복 완주.                                           |

## 공개 진입점

- `apps/web/src/app/App.tsx`: 제품 진입점. 개발에서 /play 또는 초대 fragment로 입장, /preview는 개발 합성 화면이다. 기존 개발 조립은 DevelopmentApp으로 보존한다.
- `features/room/product-session.ts`: consumeInvitation/requestSession/joinProductRoom/productRoomPort. 초대 fragment 즉시 제거·메모리 토큰·B validator·0.2.0 계약. 자동 재접속 비활성화, 닫힌 SDK 연결 leave 즉시 종결.
- `features/room/command-lifecycle.ts`: 단일 commandId/seq, receipt·outcome·view 확인 및 제한된 status 조회. 미확인 resync, 자동 명령 재전송 없음.
- `features/room/game-heartbeat.ts`, `clock-sync.ts`, `product-view.ts`: heartbeat ACK·6초 단절, offset/Tick 앵커, epoch/match/scope/revision 경계·완전 교체 snapshot.
- `app/product-runtime.ts`의 bindProductRoom: 실제 B port/D facade 조립. 로스터·개인 뷰·media-bindings·audio-policy 검증. LOBBY/DEVICE_CHECK에서는 grant 미요청. 늦은 grant/이전 참여 callback 폐기.
- `app/interaction-bridge.ts`: D createInteractionRuntime의 공개 callback/setContext/장치·보정·preview host·품질·미디어 수명 소비. 센서는 ref에 유지한다. C-13 얼굴 registry와 C-15 포즈 controller는 9/11 연결 예정이며 성공 처리하지 않는다.
- `features/game/scene/`: Cell/벽면/카메라 보간, 공유 primitive, visible 지형·관찰 출구·공개 로스터 소유자 닉네임. 외부 자산 없음. SCENE_ASSET_VERSION=`c-primitives-1`.
- `features/game/map/MiniMap.tsx`: 공개 기억 지형·자기 위치·허용 출구 번호/소유자 범례. 다른 생존자 실시간 좌표나 서버 전체 맵을 사용하지 않는다.
- `features/game/flow/`: D readiness 기반 준비 UI, 품질, loadId/assetVersion/media/bindings 장벽, 서버 COUNTDOWN, 결과·ABORTED 사유·재경기·연결 상실. 개인 종료는 Room 유지, 실제 퇴장은 Room leave.

위 features/app 경로는 모두 apps/web/src 아래다. 다른 담당 소유 파일과 F manifest/config를 수정하지 않았다.

## 검증

- `pnpm verify`: exit 0, 168개 파일/1,729개 시험 및 기존 E2E 2개 통과. 최종 코드 로그: `.local-verify-C-final3.log`.
- `pnpm exec vitest run --config .local/execution/C-evidence/vitest.config.ts`: exit 0, 실제 B bootstrap/Colyseus + 실제 D facade 로비 시험 1개 통과. A 대신 B 테스트 harness의 FakeCore 사용; 실제 게임/Cloud 인수 아님.
- 해당 시험: 6.5초 이상 heartbeat 유지, sessionId와 playerId 구별, 2인 입장·방장 이양·3번째 반복 입장·원격 socket 종료·정리. 이미 닫힌 SDK 연결에서 leave가 무한 대기하던 C adapter 수정.
- 브라우저: 개발 합성 /preview 로비·장치·미로·로딩·결과·연결 상실, scene 해제/재생성·품질 변경. 모바일 390×844 가로 overflow 없음. /play 초대 없음 거절. 실제 권한/Cloud 승인 성공을 확인한 것은 아님.
- `git diff --check`, C 소유권 검사 통과. Node 24.18.0은 저장소 요구 >=24.19.0 <25보다 낮음; 지원 런타임 재검증 필요. pnpm 11.19.0. 빌드 chunk 크기·THREE.Clock 폐기 예정 경고 있음.
- 최초 전체 검사는 설치되지 않은 Chromium 때문에 실패; pinned Playwright Chromium 설치 후 재검증 통과. 별도 연결 시험의 웹→server import는 lint 경계에 걸려 공용 runner를 대신 수정하지 않고 .local 증거로 이동.

브라우저 증거는 `.local/execution/C-evidence/{desktop-result,mobile-lobby,desktop-world-final}.png`. 리뷰 ship은 합성 desktop result/mobile lobby 두 화면에 한정한다. 디자인 detector 경고 2개는 기존 글꼴 Inter와 오류 border이며 기능 실패로 해석하지 않는다. 시각 규칙은 같은 폴더 design-notes.md에 기록했다.

.local 로그·시험 소스·진행 JSON·MR 초안은 ignored이며 다른 checkout에 있다고 가정하지 않는다. 담당자가 MR에 증거를 첨부해야 한다. 실제 얼굴·음성·토큰 원문은 증거로 저장하지 않는다.

## 다른 소유자에게 요청할 변경

| 요청 ID  | 대상 역할 / 파일                               | 필요한 결과·이유                                                                                                                                | 연결 작업     | 확인                                                         |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| C-REQ-01 | B/F: server/src/bootstrap.ts 및 소유 로딩 설정 | B 기본 assets-unversioned / 시험 assets-test-1과 C c-primitives-1의 일치 버전·전달 위치 확정. 불일치를 loaded 성공으로 우회하지 않음            | C-18, B-15~18 | 6인 loaded→COUNTDOWN→PLAYING, stale loadId/assetVersion 거절 |
| C-REQ-02 | F: tests 및 공용 runner                        | .local/execution/C-evidence/product-connection.test.ts를 공용 B/C/D integration suite로 등록. 웹→server import 금지 유지. 추가 의존성 요청 없음 | C-02/14/19    | 6.5초 heartbeat·host 이양·재입장·remote close·정리           |
| C-REQ-03 | D/E/B: 공개 facade·grant/binding               | 실제 승인 grant/트랙·권한·보정·오디오 및 D-17 종료/새 세대 완료 증거. 공개 코드는 소비 중이나 실제 Cloud/장치 미검증                            | C-04/14/18/19 | 거절·늦은 callback·개인 종료·재경기·track/AudioContext 회수  |
| C-REQ-04 | F: 실제 6대 QA·대표 장치                       | 기본/저사양 DPR·D 품질 전환·반복 입장·자원 회수 측정과 화면 결함 재현 단계                                                                      | C-01/05/14/19 | 지원 Node 및 실제 6대 완주·성능 보고                         |

요청 기록만 작성했으며 외부 메시지·Jira 변경은 하지 않았다. 대상 담당자는 자기 인계에 구현 SHA와 실제 검사 결과를 기록한다.

## 9/11 재개 순서

1. 새 B/D/F 공개 인계 SHA가 checkout에 반영됐는지 확인한다. 오늘 구현을 중복하지 않는다.
2. C-08/09/11/12/13의 HUD·교환·과거 사건·얼굴과 C-15/16/17의 포즈·키/버튼 대체·연습 화면을 구현한다. C-10은 보류한다.
3. D-17과 B-15~18 실제 연결로 C-14/18/19를 재검증하고 없는 선행만 blockedOn에 남긴다.
4. 전체 흐름·원격 퇴장·반복 입장·결과·재경기·C 자원 해제를 검증하고 F 실제 6대 화면 결함을 수정한다. 실제 생산자·소비자·Cloud/장치 증거 전에는 INTEGRATED/ACCEPTED로 올리지 않는다.

개인 기록: `.local/execution/C.json`. 작업별 MR: `.local/mr/C/<원본 ID>.md`. 합본: `.local/mr/C/2026-09-10-combined.md`. 미구현/보류 초안은 완료 MR로 사용하지 않는다.
