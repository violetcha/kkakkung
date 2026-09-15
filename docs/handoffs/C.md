# C 인계 · 웹 화면·제품 런타임

원 담당 김산이 · 2026-09-15 정리 · 코드 `apps/web/src/{app,features/room,features/game}`. 후속 FE 스토리의 담당은 Jira를 따른다.

C는 화면 조립과 서버 연결 수명을 소유한다. 장치·추론·미디어 연결은 D의 `InteractionRuntime` facade를 통해서만 쓰고 직접 만들지 않는다. 웹은 서버 내부 코드와 `packages/game-core`를 import하지 않는다.

## 상태

- 제품 화면: 홈(접속 방식 안내·개인 체험·오픈소스 고지) → 로비(친구 초대 패널·방장 잠금/강퇴·개인정보 처리 안내) → 장치 점검 → 팀 연습(역할별 안내) → 로딩(내 준비 대기 항목) → 카운트다운 → 경기(HUD·지도·장비·포즈/키 도전) → 결과(팀 승패·이유와 개인 결과, 재경기 3종) → 무효 안내.
- 개인 체험(3×5 연습 공간, 방·미디어 없음), 소리 점검·음량·친구별 음소거, 시설 렌더링, 제품 측정 수집(`?metrics=1`), 고정 오류 문구·이동 흔들림 정리가 병합돼 있다.
- 실제 6인 흐름은 서버 제품 통합 시험에서 합성 장치로 확인했다. 실제 6대·Cloud의 화면 인수는 남아 있다.

## 진입점

| 경로(`apps/web/src/` 기준)                                                      | 책임                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `app/App.tsx`, `app/ProductApp.tsx`                                             | 초대 fragment 소비 후 즉시 제거, 제품 화면 조립. 개발 `/`는 진단, `/play`·초대 링크·배포 빌드는 제품, `/preview`는 합성 검수 |
| `app/product-runtime.ts`                                                        | Room 상태·명령 수명·미디어 흐름 결합. 논리 gameScope와 mediaInstanceId/receiverGeneration을 분리                             |
| `app/interaction-bridge.ts`                                                     | D `InteractionRuntime`에 입력 문맥 전달                                                                                      |
| `app/runtime-metrics.ts`                                                        | 경기별 렌더 fps·긴 프레임·추론 지연·미디어 전이. 참가자 id·원본 미디어 없음                                                  |
| `app/product-integration-fixture.ts`                                            | 서버 통합 시험 전용 합성 D facade(`createSyntheticInteractionFactory`). 제품 App은 import하지 않음                           |
| `features/room/product-session.ts`, `game-heartbeat.ts`, `command-lifecycle.ts` | 세션·heartbeat ACK·6초 단절, 명령 requestId/sequence·receipt/outcome·request-status. 자동 재접속 없음                        |
| `features/room/private-events.ts`                                               | match/scope/tick/eventId 검증, 중복·오래된 사건 폐기, 미래 사건 64개·1초 보관, resync 1초 간격                               |
| `features/game/flow/`                                                           | 로딩 장벽(loadId·assetVersion·미디어·바인딩), 카운트다운, 결과·무효·재경기, 연결 상실                                        |
| `features/game/map/`, `equipment/`, `pose/`                                     | 기억 지형·가시 아군·교환 대상, 권위 재고·설치·구속 HUD, 포즈 1.2초 유지 평가와 `EXIT_PROGRESS`·키 도전                       |
| `features/game/scene/`                                                          | 단일 R3F WorldCanvas, 시설 테마, `FaceAvatar`·`face-textures`(가시 플레이어만 VideoTexture, C 텍스처만 dispose)              |

## 미디어 세대 교체 순서 (C 쪽)

1. SDK `recovering`/`failed`는 현재 grant scope로 B에 즉시 신고한다. `Disconnected`는 정리 완료가 아니므로 `failed`로 신고한다. 짧은 `recovering → connected`는 같은 세대를 유지한다.
2. 예상 밖 종료: 해당 참가자만 `failed` 신고 → 미디어 작업 큐 → D `retireMediaGeneration('reconnect')` 완료 → 이전 scope `closed` 신고(204) → `previousReceiverGeneration`을 넣어 발급 → 같은 인스턴스의 새 세대 연결·게시.
3. 연습→경기, 개인 종료, 재경기도 같은 로컬 정리 장벽을 쓴다. 이전 scope의 종료 신고는 공유 Promise로 합친다.
4. 중복 종료 신호·의도적 정리·교체 중 재실패는 새 복구를 만들지 않고, 실패 후 자동 반복하지 않는다. 종료 뒤 늦게 온 grant는 연결·게시 없이 정리 신고하고 그 세대를 다음 발급의 이전 세대로 보존한다.
5. 늦은 구세대 SDK 상태·바인딩·정책은 현재 scope를 바꾸지 못한다. 게시 완료 뒤 바인딩 재전송을 요청한다.

## 화면 규칙

- 설치 요청만으로 재고·구속을 낙관 갱신하지 않는다. 선택 장비는 텍스트·버튼명·테두리로 구별한다.
- 교환 완료 사건을 검증하기 전에 지도 합집합을 만들지 않는다. 사건만으로 논리 scope를 열지 않는다.
- 키 도전은 `fnv1a32(challengeId)` 기반 고정 4방향, 오입력 시 처음부터, `key.repeat` 무시. C는 방향키만 소유하고 E/Esc/F는 D가 처리한다.
- 연습에서 장치가 준비되지 않으면 `PRACTICE_READY`/`LOAD_READY`를 막고, 실패 시 준비 신고를 철회한다.
- 연결 오류 문구는 사용자가 조치할 수 있는 실패(장치·마이크·보정·미디어 연결)만 상황별로 보여 주고 단계가 바뀌면 지운다. 뒷정리 실패는 콘솔에만 남긴다.
- 개인정보 안내 문장은 `privacy-notice`의 상수이며 각 문장에 근거 코드 경로가 있다. “익명” 표현을 쓰지 않고 문의처는 미확정이라 넣지 않는다.

## 요청과 남은 일

- D REQ-D-08/10/11: 얼굴 조건 안내(`onFaceGuidance`) 표시, 준비 대기 항목의 단계·원인 표시, SDK 번들 제3자 고지 화면 보완(XNNPACK BSD-3 등). 세부는 [D 인계](D.md).
- [S15P21C204-221](https://ssafy.atlassian.net/browse/S15P21C204-221) 제품 측정 수집 연결(진행 중).
- [S15P21C204-222](https://ssafy.atlassian.net/browse/S15P21C204-222) 제품 6화면 실제 흐름의 Cloud 인수(`tests/cloud/mvp-flow.cloud.test.ts`).
- [S15P21C204-223](https://ssafy.atlassian.net/browse/S15P21C204-223) 시설 렌더링 대표 장면 보완과 중간 45fps 측정.
- [S15P21C204-225](https://ssafy.atlassian.net/browse/S15P21C204-225) 렌더 자산·음원·폰트 출처 대장.
- [S15P21C204-226](https://ssafy.atlassian.net/browse/S15P21C204-226) 실기기 6대의 90도 회전 규칙 안내와 조작 확인, [S15P21C204-228](https://ssafy.atlassian.net/browse/S15P21C204-228) 초보 2그룹 관찰의 화면 결함 수정.
- 게스트 공개 홈의 실제 대상 전환 검증(W07).
