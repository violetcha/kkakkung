# C 공개 인계 기록

수정자: C 김산이 · 2026-09-10 · [담당 계획](../c-web-ui.md) · [공통 규칙](../common.md)

## 현재 상태

사용자 지정 9/10·9/11 순서와 최신 남은 작업 전체 진행 승인을 적용했다. 원본 번호·완료 조건·계획 날짜는 유지한다. EXEC-CONTRACT-3 / D-2026-09-08-01 기준으로 C-10을 제외한 18개는 LOCAL_VERIFIED, ACCEPTED 0건이다. C-14/18/19는 실제 B/D 로비 연결 구간과 합성 상태 시험까지이며 전체 경기·Cloud·실장치 통합 완료가 아니다. C-10/EQ-12와 MP-06·EQ-06·EQ-07·EQ-08·EQ-09는 PRODUCT_DECISION_PENDING을 유지한다.

초기 시작 SHA: 3388133d2d4ed9d06beeb0b547df93e9d9dd834c. 실제 Git 신원 sanikani <sanikani@naver.com> 유지. 사용자가 이후 푸시·작업별 MR·원격 병합·Jira 변경을 명시 승인하여 실행했다. 공유된 커밋을 재작성하지 않았다. Jira는 실제 스토리 본문·원본 ID·담당자와 대조했으며 미통합 조건 때문에 진행 중으로 유지한다. MR 병합을 Jira 완료로 계산하지 않는다.

## 작업별 구현 연결

표의 SHA는 최종 관련 구현 커밋이다. 문서 커밋과 별도다. C-08은 초기 624981a 이후 C-17의 선택 표시 수정, C-18은 초기 27893d1 이후 C-17의 장치 로딩 장벽 수정을 포함한다. C-11 교환 완료/취소 사건 표시는 C-12의 7f0234cb75ce634a7ba3862057eea3d3a157a02b와도 연결된다. 이미 공유된 이 커밋의 메시지는 다시 쓰지 않고 MR·진행 기록에 관련 S15P21C204-109를 남긴다.

| 작업 | 원본 ID | 관련 Jira                                                           | 구현 최종 SHA                            | localStage               | blockedOn                                                                                                                                               |
| ---- | ------- | ------------------------------------------------------------------- | ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | VI-01   | [S15P21C204-99](https://ssafy.atlassian.net/browse/S15P21C204-99)   | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 6대 반복 장면 자원 측정.                                                                                                                           |
| C-02 | AC-06   | [S15P21C204-100](https://ssafy.atlassian.net/browse/S15P21C204-100) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 초대 URL부터 장치 준비까지 전체 브라우저 흐름. 실제 B/D 로비 transport 구간만 검증됨.                                                              |
| C-03 | VI-02   | [S15P21C204-101](https://ssafy.atlassian.net/browse/S15P21C204-101) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 A/B 이동·지연·코너 브라우저 인수.                                                                                                                  |
| C-04 | FL-02   | [S15P21C204-102](https://ssafy.atlassian.net/browse/S15P21C204-102) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | D 실제 카메라/마이크 권한·보정·가공 프레임 및 오디오 준비 인수.                                                                                         |
| C-05 | VI-05   | [S15P21C204-103](https://ssafy.atlassian.net/browse/S15P21C204-103) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | D-14 실제 송출 품질 전환과 F 대표 저사양 장치 측정.                                                                                                     |
| C-06 | KN-09   | [S15P21C204-104](https://ssafy.atlassian.net/browse/S15P21C204-104) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | 실제 B projection/교환 후 지도와 개인 종료 통합.                                                                                                        |
| C-07 | VI-03   | [S15P21C204-105](https://ssafy.atlassian.net/browse/S15P21C204-105) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | C-15 발견→도전→폐쇄 실제 흐름.                                                                                                                          |
| C-08 | EQ-10   | [S15P21C204-106](https://ssafy.atlassian.net/browse/S15P21C204-106) | eba736e5a2b92779b9b2fe8bd1051f7d5b34241b | LOCAL_VERIFIED           | 실제 B/D 게임 설치·거절·무장·소모와 F 장치 인수.                                                                                                        |
| C-09 | EQ-11   | [S15P21C204-107](https://ssafy.atlassian.net/browse/S15P21C204-107) | badaf1febcef1970c55eebefbfd7272b9d9cfe47 | LOCAL_VERIFIED           | 실제 B 직렬화 구속·자연 해제·개인 종료와 장치 화면 검증.                                                                                                |
| C-10 | EQ-12   | [S15P21C204-108](https://ssafy.atlassian.net/browse/S15P21C204-108) | —                                        | PRODUCT_DECISION_PENDING | PRODUCT_DECISION_PENDING                                                                                                                                |
| C-11 | KN-10   | [S15P21C204-109](https://ssafy.atlassian.net/browse/S15P21C204-109) | d2a69d4428b680620aa77f2c7636de12a3cbd33f | LOCAL_VERIFIED           | C-12 미래 사건 큐 연결, 실제 B 릴레이·새 정보 없음·기한 만료 게임 통합.                                                                                 |
| C-12 | KN-11   | [S15P21C204-110](https://ssafy.atlassian.net/browse/S15P21C204-110) | 7f0234cb75ce634a7ba3862057eea3d3a157a02b | LOCAL_VERIFIED           | 실제 B 사건 스트림의 릴레이·감지·덫 및 scope 전이 게임 통합.                                                                                            |
| C-13 | VI-04   | [S15P21C204-111](https://ssafy.atlassian.net/browse/S15P21C204-111) | a1ec74531d4b2ca1384542306ee3d225d0967d6d | LOCAL_VERIFIED           | 실제 D/Cloud 얼굴 재게시·시야 왕복 및 F 6대 texture count 측정.                                                                                         |
| C-14 | FL-10   | [S15P21C204-112](https://ssafy.atlassian.net/browse/S15P21C204-112) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | D-17 실제 Cloud/장치 자원 회수와 B 개인 종료·복구 전체 인수.                                                                                            |
| C-15 | EX-04   | [S15P21C204-113](https://ssafy.atlassian.net/browse/S15P21C204-113) | 28ec99af0d1cebea4930d8668400b89e6ad5de12 | LOCAL_VERIFIED           | 실제 D 상체 추론의 3종 자세 및 B 발견→도전→탈출/포획 폐쇄 흐름의 장치 인수.                                                                             |
| C-16 | EX-05   | [S15P21C204-114](https://ssafy.atlassian.net/browse/S15P21C204-114) | 338943c40c3004907f37c6ef1ee34d526a69ec9d | LOCAL_VERIFIED           | 실제 D 카메라 장애→키 전환과 B 게임 도전, F 방식별 실제 성공률/장치 인수.                                                                               |
| C-17 | FL-04   | [S15P21C204-115](https://ssafy.atlassian.net/browse/S15P21C204-115) | eba736e5a2b92779b9b2fe8bd1051f7d5b34241b | LOCAL_VERIFIED           | B 연습 중 READY 철회 권한·장치 실패 시 단계 전환 계약 확인, 실제 D/E 미디어 세대 회수·6인 연습 및 본 경기 전환, B/F assetVersion 일치, F 실제 6대 검증. |
| C-18 | FL-07   | [S15P21C204-116](https://ssafy.atlassian.net/browse/S15P21C204-116) | eba736e5a2b92779b9b2fe8bd1051f7d5b34241b | LOCAL_VERIFIED           | B/F assetVersion 합의 및 B-15~18·D 실제 media grant/binding 로딩 통합.                                                                                  |
| C-19 | FL-09   | [S15P21C204-117](https://ssafy.atlassian.net/browse/S15P21C204-117) | 27893d18e1a1ecd0f4bdab0ffea7c8e99699c2fe | LOCAL_VERIFIED           | B-15~18·D-17 실제 종료/재경기와 F 6대 반복 완주.                                                                                                        |

## 원격 전달

기존 C-01~07/14/18/19는 [!79](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/79), 병합 SHA 27679badabf2013c6ee1e64e56e05dbcc688c1dc. 중복 구현이나 빈 MR로 다시 분리하지 않았다. 아래 8개는 이번 작업별 MR이다. 각 CI와 실제 병합 상태를 API로 확인했다. 소스 브랜치는 보존했다.

| 작업 | MR                                                                            | 작업 커밋                                | 상태   | 병합 SHA                                 |
| ---- | ----------------------------------------------------------------------------- | ---------------------------------------- | ------ | ---------------------------------------- |
| C-08 | [!80](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/80) | 624981a90f8a6c07a99cdc79b579d9eaa27361c9 | merged | 240867424b26fa7bcd7d3cdb956915775ea2ead2 |
| C-09 | [!81](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/81) | badaf1febcef1970c55eebefbfd7272b9d9cfe47 | merged | c12c3a22c44939cfe2911e7a89a365849a145b50 |
| C-11 | [!82](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/82) | d2a69d4428b680620aa77f2c7636de12a3cbd33f | merged | ebf9ec89a57a4e454f4aa33b44a34d60b862db7b |
| C-12 | [!83](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/83) | 7f0234cb75ce634a7ba3862057eea3d3a157a02b | merged | 1031d5bf7bb9da21b2a07d944015d069c0ff11be |
| C-13 | [!84](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/84) | a1ec74531d4b2ca1384542306ee3d225d0967d6d | merged | b3004bb2af88cc62e8482a60fe9c253649a5a653 |
| C-15 | [!85](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/85) | 28ec99af0d1cebea4930d8668400b89e6ad5de12 | merged | da90e879bb0439bf73413e5e16845fbff6eaf2cd |
| C-16 | [!86](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/86) | 338943c40c3004907f37c6ef1ee34d526a69ec9d | merged | 5c5d3e89139728bde36da41f92a136dcbfa52d04 |
| C-17 | [!87](https://lab.ssafy.com/s15-ai-image-sub1/S15P21C204/-/merge_requests/87) | eba736e5a2b92779b9b2fe8bd1051f7d5b34241b | merged | 4bd1bbd84c0e08b1dfae36db3ab0844969833ddf |

## 공개 진입점과 연결 경계

- apps/web/src/app/App.tsx: 제품 진입점. 개발 /play 또는 초대 fragment로 입장, /preview는 명시된 합성 화면이다.
- features/room/product-session.ts, game-heartbeat.ts, command-lifecycle.ts: 초대 fragment 즉시 제거, B validator, heartbeat ACK·6초 단절, 단일 commandId/seq, receipt/outcome/view 및 제한된 status 조회. 자동 재접속·자동 성공 없음.
- app/product-runtime.ts / interaction-bridge.ts: 실제 B port와 D createInteractionRuntime facade. C는 장치·입력·미디어 수명을 직접 생성하지 않는다. 논리 gameScope와 mediaInstanceId/receiverGeneration은 별개다. 늦은 이전 참여 callback과 grant를 폐기한다.
- features/game/equipment/: 권위 재고·설치·무장·구속/면역 HUD. 선택 장비는 텍스트·버튼명·테두리로 구별한다. 설치 요청만으로 재고/구속을 낙관 갱신하지 않는다.
- features/game/map/: 공개 기억 지형과 가시 아군만 사용한다. 교환 대상은 거리/playerId 순서, 선택 유지, 수락만 명령 전송한다. 완료 사건 검증 전에 지도 합집합을 만들지 않는다.
- features/room/private-events.ts: match/scope/tick/eventId 검증, 중복/오래된 사건 폐기, 제한된 미래 보관과 1초 resync 간격. 사건만으로 논리 scope를 열지 않는다. 과거 술래 표식은 고정 위치·TTL이다.
- features/game/scene/face-textures.ts / FaceAvatars.tsx: D가 제공한 완전한 세대/발행 identity와 별도 미디어 scope를 확인한다. 가시 플레이어만 VideoTexture를 만들며 C texture만 dispose한다. D video/track을 중단하거나 수정하지 않는다.
- features/game/pose/: 신선한 D canonical 상체 sample로 1.2초 유지 평가. 실제 server challengeId/minSuccessTick/기한에서 C controller 하나가 EXIT_PROGRESS를 전송한다. 조기 NOT_READY만 같은 도전에서 제한 재시도한다. 포즈·키 방식별 시도/ESCAPED 통계는 runtime.challengeMetrics()로 제공하며 영상을 저장하지 않는다.
- KeyChallenge: fnv1a32(challengeId) 기반 고정 4방향 시퀀스, 오입력 초기화, key.repeat 무시, 44px 버튼. C는 방향키만 소유하고 E/Esc/F는 D에 남긴다. 실제 취소/포획/기한 후 전송을 막는다.
- PracticeScreen / practice-presenter: TEAM_PRACTICE 및 일치하는 practice 전체 뷰에서 기존 화면을 조립한다. 신선한 3종 자세 연습은 EXIT_PROGRESS를 위조하지 않는다. 실제 장치 미준비 시 PRACTICE_READY/LOAD_READY 차단, 실패 시 준비 신고 철회. 서버 scope 교체로 연습 지식·사건을 비운다.
- features/game/flow/: loadId/assetVersion/media/binding 장벽, 서버 COUNTDOWN, 결과·ABORTED·재경기·연결 상실. 개인 종료는 Room 유지, 실제 퇴장은 leave. C 화면 자원과 D 수명을 분리한다.

위 features/app 경로는 apps/web/src 아래다. primitive 자산 버전은 c-primitives-1이다. 다른 담당 파일·manifest·lockfile·공용 config 변경 없음.

## 실제 검증

- pnpm verify: exit 0, 180개 파일/1,767개 시험 및 E2E 2개 통과 (.local-verify-C17-final.log). 실제 B bootstrap/Colyseus + D facade 로비 시험 1개 재통과 (.local-C-connection-final.log); B FakeCore 사용, 실제 A 게임/Cloud 인수 아님. C 소유권 및 git diff --check 통과. Node 24.18.0/pnpm 11.19.0; 요구 Node >=24.19.0 <25 재검증 필요.
- 실제 B/D 로비 시험: 6.5초 이상 heartbeat 유지, sessionId와 playerId 구별, 방장 이양·반복 입장·원격 socket 종료·leave/dispose. A 대신 B FakeCore를 사용했다. 실제 6대나 Cloud 검증이 아니다.
- 단위 검증: 재고/설치/구속, 교환 대상/사건 경계, texture 소유권/세대, 포즈 신선도·최소 Tick·기한·중복 송신, 키 오입력/반복, 연습 장치 준비 철회·scope 교체. 전체 검사에는 기존 sandbox/team-room E2E 2개가 포함되며 kkakkung 전체 경기 E2E와 구별한다.
- 브라우저 합성 미리보기: 장비·교환·포즈·키·연습 추가. desktop 장비 선택 및 mobile 390×844 연습 화면 검토, 가로 overflow 없음, 장치 미준비 ready 비활성, 키 완료를 서버 성공으로 표시하지 않음. 선택 상태가 약하다는 필수 지적 1건 수정 후 Resolved 확인.
- 증거: .local/execution/C-evidence/desktop-equipment-fixed.png 및 mobile-practice-panel.png. 이전 로비/결과/장면 증거와 design-notes.md 유지. 새 대상 detector [] 및 UI 검토는 합성 화면 범위에 한정한다.
- 초기 C-13 typecheck 실패 2회는 generic texture factory 수정 후 재검증 통과했다. 과거 Chromium 미설치는 pinned Chromium 설치 후 해결했다. Node 버전, chunk 크기, THREE.Clock 폐기 예정 경고는 남아 있다.

.local 시험·로그·개인 JSON·작업별/합본 MR 초안은 ignored다. 다른 checkout에 존재한다고 가정하지 않는다. 검증 범위와 결과는 이 인계 및 실제 MR 본문에도 기록한다. 얼굴·음성·토큰 원문은 저장하지 않는다.

## 다른 소유자에게 필요한 결과

| 요청     | 대상                               | 필요한 결과                                                                                                                                                                                                                                                                   | 관련 작업           |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| C-REQ-01 | B/F bootstrap·로딩 설정            | assets-unversioned / assets-test-1과 C c-primitives-1의 일치 버전·전달 위치 확정. 실제 6인 loaded→COUNTDOWN→PLAYING 및 stale loadId 거절. 불일치를 성공으로 우회하지 않음.                                                                                                    | C-18                |
| C-REQ-02 | F 공용 integration runner          | .local/execution/C-evidence/product-connection.test.ts의 B/C/D 로비 증거를 공용 시험에 등록. 웹 제품의 server import 금지 유지.                                                                                                                                               | C-02/14/19          |
| C-REQ-03 | D/E/B facade·grant/binding         | 실제 승인 grant/track·권한·보정·오디오와 D-17 종료/새 세대 회수 증거. 실제 얼굴 표시·음성 및 늦은 callback, 개인 종료, 재경기 회수 검사. 공개 facade는 이미 소비 중.                                                                                                          | C-04/13/14/17/18/19 |
| C-REQ-04 | F 실제 6대 QA                      | 지원 Node, 기본/저사양 DPR·D 품질·반복 입장·GPU/track/AudioContext 회수·완주·포즈/키 성공률 및 화면 결함 재현.                                                                                                                                                                | C-01/05/15/16/19    |
| C-REQ-05 | B KkakkungRoom·PracticeCoordinator | READY는 DEVICE_CHECK만 허용하고 PRACTICE_READY는 TEAM_PRACTICE만 허용한다. 연습 중 장치 실패 시 C는 PRACTICE_READY false/LOAD_READY 차단하지만 B의 기존 deviceReady 철회 경로는 확인 필요. 60초 전환이 현재 장치 준비를 우회하지 않는 실제 연결 시험과 공개 처리 계약을 제공. | C-17/18             |

B/D/F 인계의 과거 로컬·미푸시 문구를 최신 원격 상태로 해석하지 않았다. 코드 존재와 실제 환경 검증을 구별했다. 다른 담당 파일은 대신 수정하지 않는다.

## 남은 통합 검증 순서

1. B/F의 자산 버전과 D/E 실제 grant·세대 회수 증거를 반영한다. C-10 결정과 독립적으로 진행 가능하다.
2. 실제 6인 두 연습 공간→로딩→카운트다운→본 경기→개인 종료/결과→재경기를 검사한다. 연습 장치 실패·팀 외 얼굴/음성 차단·구 세대 폐기를 포함한다.
3. F 6대 화면 결함과 반복 입장/원격 퇴장 자원 측정을 반영한다. 필수 증거 충족 후에만 INTEGRATED/ACCEPTED 및 Jira 완료로 변경한다.

개인 기록: .local/execution/C.json. 작업별 MR: .local/mr/C/<원본 ID>.md. 합본: .local/mr/C/2026-09-10-combined.md. C-10은 구현·완료 커밋·완료 집계에서 제외한다.
