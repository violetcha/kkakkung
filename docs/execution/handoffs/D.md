# D 공개 인계 기록

전달 기준: [S15P21C204-171](https://ssafy.atlassian.net/browse/S15P21C204-171) · 브랜치 `feat/S15P21C204-171-product-integration` · 병합 대상 `develop`. 로컬 통합 검증 후 사용자 요청으로 스토리 생성·커밋·푸시 및 MR 본문 작성을 진행한다. 아래의 임시 브랜치·미커밋·Jira 미생성 표기는 검증 당시 기록이다. 실제 Cloud·배포 인수와 MR 병합은 별도다.

## 2026-09-10 통합 작업 · 게시 완료와 로컬 종료 장벽

최초 기준 develop `d5816f6`, 이후 F-16 `baffe7a`와 F QA `4c84d20` 병합을 반영한 로컬 통합 브랜치 `codex/integration-20260910`이다. 아래 실행 시간과 시험 수는 당시 기록이며 최신 최종 결과는 [공통 검증 기록](../../verification.md)을 확인한다. 변경은 로컬 검증이며 실제 Cloud/장치 인수와 구분한다.

- `track-publisher.ts`는 SDK 게시/교체 작업을 직렬화하고 `unpublishAll()` 호출 시 즉시 terminal로 잠근다. 진행 중 게시가 늦게 성공하면 해당 트랙을 보상 unpublish하며, 이 정리까지 기다린 뒤 종료한다. 정리 실패를 성공으로 삼지 않는다. 원본 장치를 SDK가 stop하지 않도록 기존 소유권을 유지한다.
- `media-session.ts`는 연결 중 Room도 추적하여 종료하고, 진행 중 SDK connect가 정리될 때까지 retire Promise를 완료하지 않는다. 늦은 연결 성공이 새 scope 상태를 덮어쓰지 않으며 connect 성공은 실제 scoped connected 상태로 전달한다.
- `media-lifecycle.ts`는 정리 중 `beginGeneration()`을 거절하고 게시/SDK 정리가 실패하면 `closed`를 표시하지 않는다. 참가 종료는 실패하더라도 원본 장치 정리를 시도한다.
- 바인딩 store의 새 `beginScope(scope)`는 승인 grant를 받은 `InteractionRuntime.connectMedia`만 사용한다. 바인딩 메시지 자체가 수신자 세대를 바꾸지 못한다. D runtime은 현재 grant와 다른 바인딩/음향 정책을 거절한다.
- C가 await retire 완료 뒤 B에 exact old-scope `closed`를 보낸다. 로컬 closed와 E의 Cloud 회수 확인은 별도 장벽이다. 공개 HTTP/미디어 타입 변경은 없다.
- C의 전체 복구 호출자가 추가되어 SDK 영구 종료에서는 `retireMediaGeneration('reconnect')`의 완료 뒤 새 grant로 연결한다. 같은 SDK의 짧은 reconnect는 현재 세대를 유지한다. 게임 Room·원본 장치·논리 게임 지식은 보존하며 의도적 정리 callback은 다시 복구를 시작하지 않는다. 최종 C 복구 회귀 29시험과 직전 웹 전체 57파일 436시험을 통과했다. 실제 SDK/Cloud 재연결 성공으로 계산하지 않는다.
- 최종 C 검토에서 발급 대기 중 논리 phase 변경의 이전 세대 기록 손실과, 같은 경기 phase 전환의 일시적 개인 뷰 공백에 의한 복구 취소를 고쳤다. 늦은 미연결 grant도 정확한 scope로 정리·신고하며 새 경기 요청이 그 마지막 발급 세대를 이어받는다. SDK 게시 직렬화·보상 정리·종료 장벽·바인딩 변경 diff도 읽기 검토했고 추가 미해결 D 결함은 확인하지 않았다. 실제 장치/Cloud 검증을 대체하지 않는다.

검증: 웹 전체 **57파일 422시험**, 미디어/D runtime/C 연결 대상 **14파일 204시험**, 웹 타입 검사 통과. 새 시험은 진행 중 얼굴/마이크 게시의 보상 회수, 보상 실패 시 closed 금지, 실제 D runtime의 늦은 SDK 게시와 종료 경쟁, connect 완료 대기, 구세대 바인딩 거절을 포함한다. SDK·장치 port는 합성 입력이며 Cloud 검증으로 집계하지 않는다.

루트 `server/test/media/product-integration.test.ts`의 실제 제품 profile·A/B/C/E와 HTTP/Colyseus 6클라이언트 통합 **1시험(64.087초)**이 통과했다. 연습 → 로컬 서명 webhook → 경기 로딩/카운트다운/PLAYING → 한 명의 전체 세대 복구·다른 다섯 명 유지 → 3600 Tick 후 RESULT → 13개 closed 신고 204·transport 참가자 부재 → 재경기 DEVICE_CHECK를 확인했다. 이 시험에서 D는 `product-integration-fixture.ts` 합성 facade이며 실제 D SDK/장치 경로가 아니다. Cloud API·운영 증거도 fixture이므로 실제 Cloud/장치 ACCEPTED 조건은 유지한다.

수정자: **D만** · [담당 계획](../d-vision-media.md) · [공통 규칙](../common.md)

이 파일은 팀원 AI가 D의 전체 계획을 다시 읽지 않고 공개 산출물과 요청을 확인하는 장소다.
갱신일 **2026-09-09** · 계약 기준 **EXEC-CONTRACT-3** · 적용 제품 결정 **D-2026-09-08-01**
Jira: 담당 D 범위는 `D-01~D-17 = S15P21C204-118~S15P21C204-134` (담당자 오명헌)
시작 SHA `b12cb9c` · 브랜치 `feat/S15P21C204-118-vision-media-input-runtime` (**원격 push 완료, `develop` MR 대기**)

**아래 인계는 모두 합성 port 단위 검증(LOCAL_VERIFIED)이다. 실제 브라우저·대표 장치·
Cloud 검증은 0건이며 어떤 항목도 ACCEPTED가 아니다.** 파일이 존재한다는 이유로 상태를
완료로 바꾸지 않는다.

## 공개 진입점

C가 소비할 진입점은 하나다. devices/vision/media 구현을 직접 생성하지 않는다.

```ts
import {
  createInteractionRuntime,
  type InteractionDeps,
  type InteractionRuntime,
} from '@/features/input/InteractionRuntime'; // apps/web/src/features/input/InteractionRuntime.ts
```

runtime·센서·문맥의 공개 타입은 이 진입점에서 재노출한다: `DeviceStatus`, `SensorSnapshot`,
`Sample`, `FaceSensor`, `PoseSensor`, `GestureSensor`, `NormalizedLandmark`,
`InteractionContext`, `InteractionState`, `Role`, `Phase`, `PlayerStatus`, `EquipmentKind`,
`PoseKind`, `MediaGrant`, `MediaStatus`, `MediaBindings`, `AudioPolicy`, `FaceTrackEvent`.

`createInteractionRuntime(deps, options?)`의 두 번째 인수는 **시험·주입 전용**이다. 제품
경로는 생략하고 실제 DOM/navigator/Worker/Canvas/SDK를 쓴다. **2026-09-09부터 미디어
네 port에도 제품 구현이 있다.** C는 SDK를 주입하지 않는다.

| 생략한 option      | 제품 경로가 대신 쓰는 것                              |
| ------------------ | ----------------------------------------------------- |
| `createMediaRoom`  | `loadLiveKit()`으로 적재한 실제 `livekit-client` Room |
| `getPublisher`     | 현재 세대 Room의 `localParticipant`                   |
| `unsubscribeTrack` | 해당 `RemoteTrackPublication.setSubscribed(false)`    |
| `getAudioTrack`    | 구독 중인 오디오 트랙의 `mediaStreamTrack`            |

## 구현 상태

| 고정 번호 | 원본 ID | Jira                                                                | localStage     | 최종 commit | 실제로 되는 것                                                 |
| --------- | ------- | ------------------------------------------------------------------- | -------------- | ----------- | -------------------------------------------------------------- |
| D-01      | IN-01   | [S15P21C204-118](https://ssafy.atlassian.net/browse/S15P21C204-118) | LOCAL_VERIFIED | `92c8707`   | 카메라·마이크 분리 취득, 늦은 결과 정리, local preview 수명    |
| D-02      | IN-02   | [S15P21C204-119](https://ssafy.atlassian.net/browse/S15P21C204-119) | LOCAL_VERIFIED | `ee3ef64`   | Worker 전송 계약, inFlight 1개, 고정 모델·WASM 자산과 manifest |
| D-03      | IN-03   | [S15P21C204-120](https://ssafy.atlassian.net/browse/S15P21C204-120) | LOCAL_VERIFIED | `e8da50e`   | 얼굴 landmarks·yaw·validity 정규화와 미러 helper               |
| D-04      | IN-04   | [S15P21C204-121](https://ssafy.atlassian.net/browse/S15P21C204-121) | LOCAL_VERIFIED | `5373c2b`   | 상체 landmarks·visibility·몸통 기울임과 품질 판정              |
| D-05      | IN-05   | [S15P21C204-122](https://ssafy.atlassian.net/browse/S15P21C204-122) | LOCAL_VERIFIED | `2eeb553`   | 손바닥·브이 판정, 양손 충돌 none, 최고 score 1개               |
| D-06      | IN-06   | [S15P21C204-123](https://ssafy.atlassian.net/browse/S15P21C204-123) | LOCAL_VERIFIED | `743782d`   | 중립 보정, One Euro Filter, 임계값, 비전 파이프라인 기동       |
| D-07      | ME-01   | [S15P21C204-124](https://ssafy.atlassian.net/browse/S15P21C204-124) | LOCAL_VERIFIED | `abdb25b`   | 흑백 얼굴 마스크·가공 Canvas 트랙, 원본 게시 차단 handle       |
| D-08      | ME-02   | [S15P21C204-125](https://ssafy.atlassian.net/browse/S15P21C204-125) | LOCAL_VERIFIED | `36df3e6`   | 추적 실패의 안전 프레임 유지와 기본 얼굴 전환                  |
| D-09      | IN-07   | [S15P21C204-126](https://ssafy.atlassian.net/browse/S15P21C204-126) | LOCAL_VERIFIED | `3bfd4fd`   | 전후진 모션·키 의도 통합과 100ms 갱신                          |
| D-10      | IN-08   | [S15P21C204-127](https://ssafy.atlassian.net/browse/S15P21C204-127) | LOCAL_VERIFIED | `5d4e9a5`   | 회전 latch·중립 해제와 키 1회 발동                             |
| D-11      | IN-09   | [S15P21C204-128](https://ssafy.atlassian.net/browse/S15P21C204-128) | LOCAL_VERIFIED | `4899508`   | InteractionContext 보관·무효화, 손동작/단축키 중재             |
| D-12      | IN-10   | [S15P21C204-129](https://ssafy.atlassian.net/browse/S15P21C204-129) | LOCAL_VERIFIED | `07ab8a1`   | 장치·추론 장애 감지와 keyboard 폴백                            |
| D-13      | ME-03   | [S15P21C204-130](https://ssafy.atlassian.net/browse/S15P21C204-130) | LOCAL_VERIFIED | `34421fc`   | 승인 grant의 단일 SDK 연결 수명 (주입 port 검증)               |
| D-14      | ME-04   | [S15P21C204-131](https://ssafy.atlassian.net/browse/S15P21C204-131) | LOCAL_VERIFIED | `f238608`   | 가공 얼굴 1개·선택 마이크 1개 게시, 원본/화면공유 거절         |
| D-15      | ME-05   | [S15P21C204-132](https://ssafy.atlassian.net/browse/S15P21C204-132) | LOCAL_VERIFIED | `93e12e4`   | 검증 바인딩과 트랙 일치 시에만 얼굴 수신, 세대/SID 교체        |
| D-16      | ME-06   | [S15P21C204-133](https://ssafy.atlassian.net/browse/S15P21C204-133) | LOCAL_VERIFIED | `8770e1a`   | SID당 단일 WebAudio 그래프, 서버 eventId 효과음                |
| D-17      | ME-07   | [S15P21C204-134](https://ssafy.atlassian.net/browse/S15P21C204-134) | LOCAL_VERIFIED | `e8a7c36`   | terminal 세대 차단과 멱등 정리, 참가 종료 분리                 |

**17개 전부 LOCAL_VERIFIED이며 ACCEPTED는 0건이다.** 실제 브라우저·대표 장치·Cloud 검증은
하나도 실행하지 않았다.

보조 커밋: `944f52c`(chore, Prettier 정리 — 동작 변경 없음) ·
`84c87e6`·`33ee8e8`·`45bcbac`·`408b482`(docs, 이 인계 기록).

후속 수정 커밋 2개는 위 표의 SHA 이후 같은 작업 범위를 고친 것이다.
`7ae87e8`(fix, D-15/D-16/D-17 — 검증 오디오 조기 해제, 연습 인스턴스 원격 얼굴 상한 미적용,
보류 sweep 제품 호출자 부재) · `906e8ee`(feat, D-02/D-16 — 고정 모델 sha256 대조와 불일치 시
`MODEL_HASH_MISMATCH`·모델 close·Worker terminate, 그리고 `AudioContext` 기반 실제 WebAudio
기본 구현). 두 커밋 뒤 `pnpm test`는 38파일 380건 통과다.

**2026-09-08 Jira 키 연결로 커밋 메시지를 다시 썼다.** 메시지를 고친 시점에 이 브랜치는
원격에 없고 upstream도 없어 push 전이 확실했으므로 메시지만 수정했다. 코드 트리는 백업 브랜치
`backup/mvp-d-d1-preJira`와 동일하며 author/committer는 오명헌 그대로다. 위 표의 SHA는
메시지 수정 후 값이다.

## C가 연결할 위치와 호출 순서

1. App에서 `createInteractionRuntime(deps)`를 **한 번만** 만든다. render마다 만들지 않는다.
   `deps`의 `sendCommand`는 requestId(string)를 돌려줘야 한다. D는 matchId/sequence/
   requestId를 만들지 않는다.
2. 사용자 제스처에서 `startDevices({microphone})` → 완료 후 `calibrate()` 순서로 부른다.
   `startDevices`는 카메라가 ready면 비전 Worker와 가공 Canvas를 함께 기동한다.
3. `setContext(fullContext)`를 권위 상태가 바뀔 때마다 전체 교체로 부른다. D는 사라진
   교환/출구/설치/challenge ID, role/mode 변경, `pageActive=false`, 비참가, 비활성 phase에서
   이동 timer·회전 latch·gesture hold를 스스로 비운다. **setContext를 한 번도 부르지 않으면
   어떤 이동·회전·상호작용 명령도 나가지 않는다.**
4. `onLocalPreview(element)`는 DEVICE_CHECK 화면에만 붙인다. C는 host 연결만 끊고
   `srcObject`·track·element 정리는 D가 한다. 원본 track을 stop하지 않는다.
5. `onInteractionState({selectedEquipment, mode})`는 1/2 선택과 모드 동기화용이다. 서버
   권위 상태 변경 callback이 아니며 같은 값 echo는 발생하지 않는다.
6. `connectMedia(grant)`는 TEAM_PRACTICE/MAP_FINALIZING/GAME_LOADING/COUNTDOWN/PLAYING에서만
   성공한다. LOBBY/DEVICE_CHECK에서는 SDK를 부르지 않고 `PHASE_NOT_ALLOWED`로 거절한다.
7. `reportMediaStatus`는 **D가 부르지 않는다.** deps 선언만 있고 호출자는 C/B다. E 인계
   (2026-09-09 `origin/develop`)가 순서를 못박았다: `status: 'closed'`는 D의
   `await retireMediaGeneration()`이 **완료된 뒤에** 보낸다. 서버는 이 신고로 이전 세대의
   대기를 풀기 때문에, 정리를 호출했다는 사실이나 `ready` 신고로 대신하면 안 된다.
   `recovering`/`failed`를 반복해도 서버의 10초 창은 늘어나지 않는다.

## D-17 즉시 인계 — E-16과 B 경기 전환을 막지 않기 위한 요약

**세 종료 메서드는 서로 다른 일을 한다. 하나로 합치지 말 것.**

| 메서드                           | 닫는 것                                                 | 유지하는 것                                  |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `retireMediaGeneration(reason?)` | 출력·listener·게시·수신·오디오 그래프·SDK 연결          | **playerId·게임 Room·원본 카메라·센서·입력** |
| `endParticipation()`             | 위 전부 + 입력 timer/listener + Worker/모델 + 원본 장치 | 게임 Room 수명(=C가 결정)                    |
| `dispose()`                      | 위 전부 + 객체 재사용 금지                              | 없음                                         |

- `retireMediaGeneration`은 **게임 지식 삭제 신호가 아니다.** 미디어만 재연결해도
  `gameInstanceId`/revision은 바뀌지 않는다. 논리 `gameScope` 전환은 B/C가 한다.
- 세대는 정리 **전에** terminal로 바뀐다. 그 뒤 도착한 Reconnected·publish·
  media-bindings·audio-policy는 현재 세대를 다시 열지 못한다.
- 새 세대는 **`beginMediaGeneration()`으로만** 열린다. B/E 회수 확인 뒤에 부른다.
  `getGenerationState()`가 `live|terminal|closed`를 돌려준다.
- 로컬 `closed`는 **서버 회수 성공이 아니다.** 원격 회수 확인은 E MC-07/08이 한다.
- `MEDIA_POLICY_UNCERTAIN`(reason `policy-unknown`)·개인 종료·shutdown은 10초 복구
  창을 기다리지 않는다. 게임 생존 중 순간 복구만 서버 10초 창을 따른다.
- 동시 socket close·개인 종료·unmount는 공유 Promise로 한 번만 정리한다. 반복 호출은
  같은 Promise를 돌려준다.
- **카메라 장애는 참가 종료가 아니다.** 세대와 게임을 유지하고 IN-10 보조 입력과
  ME-02 안전 얼굴로 전환한다.

## 세대 교체와 policyRevision — 2026-09-09 결함 수정

계약 실대조에서 D 쪽 결함을 하나 찾아 고쳤다. 서버 `AudioProjection`은 policyRevision을
`(matchId, mediaInstanceId, playerId, receiverGeneration)`마다 **1부터 다시 센다.** D의
`audio-policy`는 세대와 무관하게 마지막 적용본의 policyRevision을 바닥으로 썼다.

따라서 회수 없이 서버가 새 수신자 세대의 바인딩·정책을 밀어 넣으면, 구 세대에서 revision이
7까지 올라가 있던 경우 새 세대의 revision 1~7 정책이 전부 `STALE_POLICY`로 버려지고
**근거리 음성이 조용히 사라진다.** `media-bindings`는 세대가 바뀌면 스스로 비우는데
`audio-policy`만 그러지 않아 생긴 비대칭이다.

이제 policyRevision 바닥은 **같은 세대의 적용본에만** 적용한다. 늦게 도착한 구 세대 정책은
바닥이 되지도 않고 현재 세대의 적용본을 지우지도 않으며 `WRONG_SCOPE`로 끝난다.
되돌리면 실패하는 회귀 시험 3개를 넣었다.

이 경로는 `retireMediaGeneration` 없이 세대가 바뀔 때만 나타난다. D 자신은 항상
`beginMediaGeneration()`으로 세대를 열지만, `applyMediaBindings`가 다른 `receiverGeneration`을
받는 것은 D-15가 지원하는 경로라 양쪽을 같게 맞췄다.

## SDK 어댑터 — 2026-09-09 추가

`apps/web/src/features/media/livekit-adapter.ts`가 `livekit-client` 2.22.2를 감싼다.
D-13~D-16의 네 port를 **하나의 Room 위에서** 만든다. C가 SDK를 조립하지 않는다.

- SDK 모듈은 정적 import하지 않고 `loadLiveKit()`의 **동적 import**로 받는다. 연결을 한 번도
  하지 않는 세션은 SDK를 내려받지 않고, Node 시험도 브라우저 전용 SDK를 적재하지 않는다.
  `connectMedia`가 `media.connect` 전에 적재를 기다린다. 세대마다 다시 적재하지 않는다.
- **stop 인수는 전부 D 소유 쪽이다.** `room.disconnect(false)`, `unpublishTrack(track, false)`,
  `replaceTrack(next, true)`. 세대 회수가 원본 카메라·마이크를 끄면 안 되기 때문이다.
  이 세 값은 각각 되돌리면 실패하는 회귀 시험이 있다.
- 버려진 Room의 늦은 `TrackSubscribed`는 현재 세대를 건드리지 않는다. `removeAllListeners`가
  media-session의 수명 listener와 어댑터의 구독 listener를 함께 떼고 트랙 지도를 비운다.
- 어댑터는 **검증을 하지 않는다.** 구독 사건을 D의 `RemoteTrack` 모양으로 옮길 뿐이고
  얼굴 검증·상한·보류는 그대로 remote-faces가 판단한다.
- 시험은 실제 SDK 대신 같은 모양의 가짜 모듈을 주입한다(`options.loadLiveKit`). 대신
  `livekit-adapter.test.ts`가 **타입 전용 import**로 실제 `Room`·`LocalParticipant`·
  `RemoteTrackPublication`·`Track.Source`가 어댑터의 구조 타입에 할당 가능한지 컴파일 시점에
  검사한다. 이 검사가 실제로 SDK 서명 불일치 2건을 잡았다.

**여전히 Cloud 검증 0건이다.** 실제 grant·실제 SFU 연결·실제 회수는 하나도 실행하지 않았다.
어댑터가 있다고 D-13~D-17이 ACCEPTED가 되지 않는다.

## 소비자가 알아야 할 계약 세부

- `DeviceStatus.vision`은 **모델 로드만으로 ready가 되지 않는다.** 모델 로드 + 신선한 유효
  얼굴 + 첫 안전 가공 프레임 + 살아있는 가공 트랙 네 조건이 모두 참일 때만 ready이며 가공
  트랙이 끊기면 다시 loading이다.
- `SensorSnapshot.emittedAtMs`는 발행 시각이고 새 관측 시각이 아니다. 실행하지 않은 센서의
  Sample은 그대로 유지되며 세대 시작부터 실행하지 않았으면 null이다.
- face/pose age>300ms, gesture age>400ms면 사용 불가다. 다른 센서 갱신이 유효 시간을
  연장하지 않는다. `quality==='uncertain'`은 유효 얼굴·자세로 인정하지 않는다.
- 튜닝 버전. 전부 기획서 확정 상수가 아니라 **명시적 초깃값**이며 대표 장치 검증 후 조정한다.
  값을 바꾸면 버전을 함께 올린다. 포즈 탈출 임계값(`poseTuningVersion`)은 C가 소유한다.

  | 상수                                 | 버전                            | 덮는 것                         |
  | ------------------------------------ | ------------------------------- | ------------------------------- |
  | `input-tuning.SENSOR_TUNING_VERSION` | `D-input-4-shoulder-span`       | 입력 각도·유지시간·필터         |
  | `safe-face.SAFE_FACE_TUNING_VERSION` | `D-safe-face-1`                 | 안전 프레임 유지 1200ms         |
  | `face-condition.FACE_CONDITION_*`    | `D-face-condition-1`            | 얼굴 조건 판정 임계와 표시 지연 |
  | `frame-pump.MODEL_TARGET_TUNING_*`   | `D-model-interval-1-unmeasured` | 모델별 목표 주기                |

- **모델 목표 주기는 문서 세 곳이 서로 다르다** (2026-09-15 확인, S15P21C204-243).
  `frame-pump.ts`와 `docs/spec/current.md`는 face 15 · pose 15 · gesture 10fps인데,
  `d-vision-media.md` D-04·D-05와 `mvp-work-plan.md` IN-04·IN-05는 pose 10 · gesture 8fps다.
  `docs/spec/current.md`는 이 차이를 알려진 이탈로 이미 표에 적어 두었다.
  - 이 상수에는 원래 tuningVersion이 없어 **어떤 검사도 값 변경을 잡지 못했다.** 계획과 코드가
    어긋난 채 남은 것도 그래서다. 이제 버전을 붙이고 시험으로 묶었다.
  - 어느 값이 맞는지는 대표 장치에서 세 모델을 동시에 돌려 봐야 정해진다. **실측 전에는
    계획값으로 되돌리는 것도 근거가 없으므로** 현재 코드 값을 유지한다.
  - 버전 접미사 `-unmeasured`가 그 상태를 이고 있다. 측정으로 확정하면 접미사를 떼고
    측정 근거를 함께 남긴다. 세 문서를 같은 값으로 맞추는 것도 그때다.
    `mvp-work-plan.md`와 `docs/spec/current.md`는 F 소유라 D가 직접 고치지 않는다.
- 가공 얼굴 출력은 160×160/10fps Canvas captureStream이며 branded handle로만 넘어간다.
  원본 track을 게시 경로에 주면 `RAW_TRACK_REJECTED`로 거절한다. 인코딩 bitrate는 D-14다.
- `MediaScope`는 `PrivateView.gameScope`와 **독립**이다. D는 `gameInstanceId`를
  `mediaInstanceId`로 복사하지 않고 `receiverGeneration`에서 논리 revision을 만들지 않는다.
  미디어만 재연결돼도 C의 논리 지식을 초기화하는 callback을 내지 않는다.
- `connectMedia`의 `connected`는 SDK 연결 성공일 뿐 서버 권한·바인딩 준비 완료가 아니다.
  `autoSubscribe:false`를 SFU 접근 통제 완료로 해석하지 않는다.

## 다른 소유자에게 요청할 변경

### REQ-D-01 · F · 루트 lint/format에서 모델 자산 제외 (**2026-09-09 반영 완료**)

**F가 `eeeba9b`(2026-09-09 16:55)로 반영했다.** `.prettierignore`에 `apps/web/public/models/`,
`eslint.config.mjs`의 `ignores`에 `apps/web/public/models/**`가 들어갔다. 이 요청은 닫힌다.
아래 원문은 기록으로 남긴다.

- 대상 파일: `eslint.config.mjs`, `.prettierignore`
- 필요한 변경: 두 파일의 무시 목록에 `apps/web/public/models/**`를 추가한다.
- 이유: D-02가 `apps/web/public/models/mediapipe/1.0.1/wasm/`에 SDK 1.0.1 WASM glue
  `.js` 3개를 고정 자산으로 넣었다. 이 파일들 때문에 `pnpm lint`가 1378건,
  `pnpm format:check`가 3건으로 실패한다. **D 소유 소스의 오류는 0건이다.**
- 연결 작업: D-02 / IN-02, F QA 공통 검증.
- 완료 확인 명령: `pnpm lint`, `pnpm format:check`가 각각 통과.
- F가 같은 날 `90831cf`로 Jenkins를 `develop`에 병합해 MR 사건마다 `scripts/ci-verify.mjs` →
  `pnpm verify`가 돌고 GitLab에 커밋 상태가 게시된다. REQ-D-01 반영 전에는 첫 단계
  `format:check`에서 실패했다.
- **반영 후 실측: `origin/develop` `7ea0151`을 병합한 D 브랜치에서 `pnpm verify` 전체가
  exit 0으로 통과했다.** format:check 위반 0건, eslint 오류 0건, 134파일 1539시험 통과,
  build·e2e 통과. 이제 Draft를 ready로 바꿔 병합할 수 있다.

### REQ-D-02 · F · main tsconfig에서 Worker 제외와 별도 검사

- 대상 파일: `apps/web/tsconfig.json`, F의 검증 스크립트
- 필요한 변경: `exclude`에 `src/**/*.worker.ts`를 추가하고 `tsc -p apps/web/tsconfig.worker.json --noEmit`을
  공통 검사에 넣는다. D 소유 `apps/web/tsconfig.worker.json`은 이미 통과한다.
- 이유: Worker 전용 lib(WebWorker)와 main lib(DOM)을 분리해 검사한다.
- 완료 확인 명령: `pnpm typecheck`와 `pnpm exec tsc -p apps/web/tsconfig.worker.json --noEmit`이 모두 통과.
- **2026-09-09 `457ed45` 기준 절반 반영.** F가 `apps/web/tsconfig.json`의 `exclude`에
  `src/**/*.worker.ts`를 넣었다. 그러나 `tsconfig.worker.json`을 실행하는 곳은 `develop`
  어디에도 없다(`pnpm verify`·`scripts/ci-verify.mjs`·`apps/web` typecheck 모두 없음).
- **그래서 D의 MR이 병합되는 순간 `vision.worker.ts`는 어떤 검사도 받지 않게 된다.** 지금은
  `develop`에 해당 파일이 없어 빈틈이 드러나지 않을 뿐이다. D 브랜치에서는 아직 main tsconfig가
  worker를 검사하고 있어 통과한다.
- F 문서(`docs/verification.md`, `f-infra-qa.md`)는 "D의 `tsconfig.worker.json` 도착 후
  typecheck 추가"로 적어 두었고 `handoffs/F.md`의 blockedOn에도 같은 항목이 있다. 즉 이
  나머지 절반은 **D의 MR 병합이 선행**이다. 반대로 REQ-D-01은 D의 MR과 무관하게 지금
  반영할 수 있다. 두 요청의 순서를 섞지 않는다.

### REQ-D-03 · F · 모델·WASM의 정적 MIME과 Worker CSP

- 필요한 내용: `.task`는 `application/octet-stream`, `.wasm`은 `application/wasm`으로 제공하고
  `worker-src`/`script-src`가 같은 origin의 module Worker와 WASM 컴파일을 허용해야 한다.
- 이유: 런타임은 외부 CDN을 읽지 않고 `/models/...` 고정 로컬 자산만 읽는다.
- 완료 확인: 실제 브라우저에서 Worker 기동과 세 모델 로드 성공.

### REQ-D-04 · F · `docs/third-party-assets.md` 기록

- 필요한 내용: `apps/web/public/models/manifest.json`의 실제 `sha256`/`bytes`/`sourceUrl`/
  `variant`/`release`/`acquiredAt`을 그 문서의 기록 항목으로 옮긴다.
- 확인된 값: SDK `@mediapipe/tasks-vision` 1.0.1의 license는 설치 패키지 `package.json`에서
  확인한 `Apache-2.0`이다. **모델 3개의 license는 확인하지 못해 `pending`이다.**
  SDK 라이선스를 모델에 자동 전용하지 않는다.
- 갱신 책임자 지정도 F가 함께 정한다.

### REQ-D-05 · E/B · 실제 미디어 grant 발급 경로 (Jira [S15P21C204-139](https://ssafy.atlassian.net/browse/S15P21C204-139))

- 필요한 것: E-05 / MC-02 = `S15P21C204-139`(이주헌)의 실제 `prepareGeneration` 결과와 B가 C에 전달하는 `MediaGrant`.
- 현재 상태: **2026-09-09 확인 — `server/src/media`는 2026-09-08 `48f7efa`로 `develop`에 병합됐다.**
  `GrantIssuer.ts`가 내는 `MediaGrant`(url/token/roomName/mediaIdentity/expiresAt=epoch 초)는
  D의 `apps/web/src/features/media/media-types.ts` 사본과 필드·단위가 일치한다.
  다만 `handoffs/E.md`에는 아직 E-02·E-11만 있고 D 대상 인계 항목이 없으며, B의
  `bootstrap`·`rooms` 조립(E11-B-01)이 없어 실제 발급 경로는 여전히 도달할 수 없다.
  D-13은 주입 port 단위 검증뿐이며 실제 Cloud 연결·재연결·회수는 하나도 실행하지 않았다.
- **클라이언트 쪽 준비는 2026-09-09에 끝났다.** SDK 어댑터가 붙어 실제 grant만 도착하면
  `connectMedia`가 실제 Room에 연결한다. 남은 것은 D가 아니라 E 인계와 B 조립이다.
- **2026-09-09 계약 실대조 결과** (`origin/develop` `48f7efa` 기준, 근거는 실제 파일 확인):
  - 타입은 일치한다. `server/src/media/types.ts`의 `MediaScope`·`MediaBinding`·`MediaBindings`·
    `AudioPolicy`·`MediaGrant`·`RetireGenerationRequest`·`RetirementResult`·`MediaFailureCode`는
    `docs/execution/contracts/types.ts`와 같은 모양이며 D 사본과도 어긋나지 않는다.
  - 값 생성 경로도 맞는다. `AudioProjection.project`는 voice의 `trackSid`를 그 playerId 바인딩의
    `audioTrackSid`로 채우고 `audioTrackSid`가 없는 voice는 아예 빼며, `receiverGeneration`을
    바인딩에서 가져온다. D `resolveVoices`의 조인 조건과 정확히 같다.
  - **생산자 도착 — 2026-09-09 15:03 `457ed45`(E-150)에서 정정.** 오전 `48f7efa` 시점에는
    `enqueueBindings`·`enqueueAudioPolicy` 호출자가 0곳이었으나, 지금은
    `server/src/media/MediaCoordinator.ts`와 `MediaPolicyBindings.ts`가 실제로 호출한다.
  - **발행 순서와 세대 처리도 D와 맞는다** (`MediaPolicyBindings.ts` 확인):
    바인딩이 바뀐 경우 `enqueueBindings`를 **먼저** 보내고 같은 `bindings` 객체로 정책을
    투영해 `enqueueAudioPolicy`를 보낸다. `receiverGeneration`은 수신자 자신의 세대다.
    `bindingRevision`은 `bindingVersions`가 generation을 키로 잡아 **세대마다 1부터** 다시
    센다. policyRevision과 같은 성질이며, D의 `media-bindings`(원래 대응)와
    `audio-policy`(`c066382`에서 대응)가 둘 다 이 리셋을 견딘다.
  - **남은 것은 B의 조립이다.** `server/src/bootstrap.ts`는 여전히 `mediaEnabled: false`와
    stage `skeleton`이라 Coordinator가 기동되지 않는다.
  - **E 인계 도착 — `7ea0151`.** `handoffs/E.md`에 "세대 전환과 D의 로컬 정리 조건" 절이
    생겼다. 핵심은 `closed` 신고 순서다(위 "C가 연결할 위치와 호출 순서" 7번). D가
    바꿔야 할 공개 계약은 없다. `MediaStatusReport`는 그대로이고 `playerId`는 B가 인증
    세션에서 채운다. `reconnect`/`round-ended`/`phase-change` reason 구분도 D의
    `RetireReason`과 같다.
- 완료 확인: 실제 grant로 `connectMedia`가 connected를 보고하고 회수 후 새 세대가 격리됨.

### REQ-D-06 · C · 조립점 연결

- 필요한 것: `apps/web/src/app/`에서 위 "C가 연결할 위치와 호출 순서"대로 factory를 한 번만
  만들고 `setContext`를 권위 상태마다 전체 교체로 호출한다. 기존
  `createTeamController`/개발 input과 D runtime을 **동시에 연결하지 않는다**
  (`team-controller.ts`에 legacy 표식을 달아 두었다).
- D는 App·SessionRuntime·room store·WorldCanvas·styles.css·웹 진입점을 수정하지 않았다.

### REQ-D-07 · B · grant 요청의 세대 필드를 null로 정규화

- 대상: B가 `MediaGrantRequest`(브라우저)를 `PrepareGenerationRequest`(서버)로 옮기는 지점.
- 필요한 변경: `previousReceiverGeneration`이 없을 때 `expectedPreviousGeneration`에
  `undefined`가 아니라 **`null`**을 넣는다.
- 이유: 두 타입의 표현이 다르다. 계약의 `MediaGrantRequest.previousReceiverGeneration`은
  `number` **선택 필드**이고, `PrepareGenerationRequest.expectedPreviousGeneration`은
  `number | null` **필수 필드**다. `server/src/media/GrantIssuer.ts`는
  `(old?.generation ?? null) !== input.expectedPreviousGeneration`으로 **엄격 비교**하므로,
  이전 세대가 없는 첫 요청에서 `null !== undefined`가 참이 되어 `STALE_GENERATION`으로
  거절된다. 즉 **첫 연결이 항상 실패한다.**
- 연결 작업: D-13 = `S15P21C204-130`, E-05 = `S15P21C204-139`.
- 완료 확인: 이전 세대가 없는 첫 `connectMedia`가 `STALE_GENERATION` 없이 grant를 받는다.
- **2026-09-09 `457ed45`에서 근거가 늘었다.** `GenerationTransition.ts`가 입력을 직접 검증한다.
  `expectedPreviousGeneration !== null`이면 `Number.isSafeInteger`와 `>= 1`을 요구하므로
  `undefined`는 그 자리에서 거절된다(90~92행). 같은 파일 207행과 `MediaGenerationRegistry` 89행,
  `GrantIssuer` 123행도 모두 엄격 비교다. `server/src/game/ports.ts` 284행이 B가 채우는
  자리이며 타입은 `number | null`이다.
- D가 `requestMediaGrant`를 직접 부르지 않는다. 이 변환은 D 소유가 아니라 B 소유다.

### REQ-D-08 · C · 얼굴 조건 안내 표시 (Jira [S15P21C204-244](https://ssafy.atlassian.net/browse/S15P21C204-244))

- 대상: C의 준비·경기 화면. D는 화면을 그리지 않는다.
- 필요한 변경: `InteractionDeps`에 새로 생긴 **선택** callback `onFaceGuidance`를 붙이고
  받은 문구를 그대로 보여 준다. 문구는 D가 만든다. C가 다시 쓰지 않는다.

  ```ts
  onFaceGuidance: (notice) => setFaceNotice(notice); // notice: { condition, message, isNew } | null
  ```

- 표시·해제·중복 억제 판단은 **D가 이미 끝냈다.** `null`이 오면 지우고, 값이 오면 띄운다.
  C가 자체 debounce를 더 걸면 두 번 걸린다. `isNew`는 소리·강조 같은 1회성 연출에만 쓴다.
- 생략해도 안전하다. callback을 붙이지 않으면 조건 판정과 휘도 표본 자체를 돌리지 않으며
  안전 프레임 전환은 그대로 동작한다. 즉 이 요청은 성능 부담 없이 미뤄 둘 수 있다.
- 조건은 다섯 가지이고 문구가 있는 것은 네 가지다: `turned-away`·`glare`·`backlit`·
  `occluded`. `ok`/`unknown`은 `null`로 온다.
- **가공 얼굴을 "익명화"라고 설명하는 문구를 옆에 붙이지 않는다.** 흑백 마스크 가공이지
  익명화가 아니다. 이 규칙은 `face-condition.test.ts`가 D 쪽 문구에 대해 고정한다.
- 완료 확인: 네 조건에서 서로 다른 문구가 화면에 뜨고, 조건이 풀리면 사라진다.

### REQ-D-09 · F · `.prettierignore`에 `.claude/` 추가

- 대상 파일: `.prettierignore`
- 필요한 변경: 무시 목록에 `.claude/`를 추가한다.
- 이유: `.claude/settings.local.json`은 사용자 전역 gitignore(`~/.config/git/ignore`)로만
  무시되고 저장소 `.prettierignore`에는 없다. 그래서 이 저장소에서 Claude Code를 쓴 사람은
  **develop에서도** `pnpm format:check`가 실패하고, `verify`가 첫 단계에서 멈춘다.
  D 소유 소스의 format 위반은 0건이다.
- 2026-09-15 실측: `pnpm format:check`의 유일한 위반이 `.claude/settings.local.json`이었다.
  나머지 `verify` 단계(check:execution·lint·typecheck·269파일 2827시험·build·
  check:product-assets·e2e 22건)는 모두 통과했다.
- 완료 확인 명령: 해당 파일이 있는 작업 트리에서 `pnpm format:check`가 통과.

### REQ-D-10 · C · 준비 대기 항목에 클라이언트 단계·원인 반영 (Jira [S15P21C204-240](https://ssafy.atlassian.net/browse/S15P21C204-240))

- 대상: `apps/web/src/features/game/flow/loading-controller.ts`의 `pending()`과 준비 화면.
- 현재 상태: `pending()`은 `'경기장 자산'`·`'초기 화면'`·`'카메라 연결'`·`'내 얼굴 게시 확인'`
  네 문자열만 돌려준다. 어느 단계에서 얼마나 걸렸는지, 원인이 클라이언트인지 서버인지
  화면에서 알 수 없다. S15P21C204-217이 붙인 서버 로그만으로는 장치·브라우저 쪽 원인을
  가릴 수 없었다는 것이 이 작업의 출발점이다.
- 필요한 변경: D가 내는 `ReadinessTrace`를 대기 항목 옆에 붙인다.

  ```ts
  const trace = runtime.getReadinessTrace?.(); // 또는 deps.onReadinessTrace 로 받는다
  // trace.blockedStage: 'permission' | 'device-open' | 'model-load' | 'first-publish' | null
  // trace.cause: 'permission-denied' | 'device-in-use' | 'device-missing'
  //            | 'model-load' | 'publish-failed' | 'client-slow' | null
  // trace.stages[].durationMs: 진행 중이면 지금까지 걸린 시간
  ```

- 대응 관계는 이렇다. `'카메라 연결'`은 `permission`·`device-open` 두 단계가 받치고,
  `'내 얼굴 게시 확인'`은 `first-publish`가 받친다. `model-load`는 지금 어느 대기 항목에도
  붙어 있지 않지만 30초 초과의 실제 원인인 경우가 있어 함께 보여야 한다.
- **`cause`가 `null`인 것을 "문제 없음"으로 읽지 않는다.** 아직 원인을 말할 수 없다는 뜻이다.
  예산(30초) 안에서 느린 것은 D가 일부러 원인을 붙이지 않는다.
- **네 단계 합이 짧은데 대기 항목이 안 풀리면 서버 쪽이다.** D는 서버 응답 대기 구간을
  어느 단계에도 넣지 않았다. 이 대비가 클라이언트/서버 원인 구분의 근거다.
- `getReadinessTrace`는 선택 메서드다. C 소유 `product-integration-fixture.ts`가 facade를
  부분 구현하고 있어 필수로 만들면 D 범위 밖 파일을 고쳐야 했다. `?.()`로 읽는다.
- 완료 확인: 30초를 넘긴 준비 실패에서 막힌 단계와 원인이 화면에 남고, 같은 값이 증거에도
  들어간다. 증거 쪽 연결은 S15P21C204-246 범위다.

## 손동작 2모델·SDK 번들 권리 — 2026-09-15 조사 (S15P21C204-241)

S15P21C204-214가 7개 구성요소를 Apache-2.0으로 확정하고 두 건을 남겼다. 이번에 그 두 건을
조사했고, **둘 다 확정하지 못했다.** 확정하지 못한 이유와 대체안을 아래에 남긴다.

### 1. gesture_embedder.tflite · canned_gesture_classifier.tflite — 여전히 pending

찾아본 1차 출처와 결과다. 어느 것도 이 두 바이너리의 재배포 조건을 말하지 않는다.

| 출처                                      | 결과                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 제스처 분류 모델 카드 PDF (2022)          | **이미지 전용 PDF**라 추출 가능한 텍스트가 없다. 라이선스 항목 없음                                                            |
| Gesture recognition task guide            | "code samples are licensed under the Apache 2.0 License" 뿐이다. 페이지 본문은 CC-BY-4.0이며 **모델 바이너리는 다루지 않는다** |
| `google-ai-edge/mediapipe` 저장소 LICENSE | Apache-2.0이지만 **학습된 모델 바이너리를 범위로 명시하지 않는다**                                                             |
| `model_maker/.../constants.py` 헤더       | 그 **Python 파일**의 라이선스이며, 내려받는 `.tflite`의 라이선스가 아니다                                                      |

대조 근거: 같은 계열인 BlazeFace 모델 카드에는 라이선스 문구가 있다고 보고되지만, 두 PDF
모두 CID 폰트라 이 환경에서 직접 대조하지 못했다. **따라서 "다른 카드에는 있는데 이 카드에만
없다"를 확정 근거로 쓰지 않는다.** 남은 질문은 Google에 직접 문의해야 풀린다.

### 2. 대체안과 영향 (근거 확보 실패 시)

| 대체안              | 실제 영향                                                                                                                                                                                                                                           | 비용      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **기능 축소**       | 손동작은 `gesture-intent.ts`에서 `EXIT_START`·`EXIT_CANCEL`과 교환 동작만 만든다. **같은 명령의 단축키 경로(E·F·1·2·Esc)가 이미 있고** D-11이 둘을 중재한다. 제스처 모델 2개를 빼도 조작은 성립한다                                                 | 가장 낮음 |
| **모델 교체**       | Model Maker 재학습은 **`gesture_embedder.tflite` 위에 분류기만 새로 얹는다.** 즉 재학습해도 embedder 의존은 남고 두 건 중 한 건만 해소된다. 다른 계열 손 모델로 갈아타면 D-05 판정 전체를 다시 튜닝해야 한다                                        | 높음      |
| **런타임 다운로드** | 재배포를 피하지만 D-02 설계와 정면으로 어긋난다. `manifest.note`가 "Runtime reads only these pinned local assets. Never a latest CDN URL."이고, 고정 sha256 대조와 `MODEL_HASH_MISMATCH` 차단이 여기 걸려 있다. REQ-D-03의 CSP도 같은 origin 전제다 | 중간~높음 |

권장은 **기능 축소를 예비안으로 잡고 문의 결과를 기다리는 것**이다. 조작 경로가 이미 이중이라
손동작 제거가 기능 공백을 만들지 않는다.

### 3. SDK 번들 구성요소 — 목록은 확보, 고지는 미비

**상위 프로젝트 문서가 아니라 우리가 싣는 파일 자체에서 뽑았다.** 결과는
`manifest.json`의 `sdk.bundledComponents`에 기록했다.

- JS 번들(`vision_bundle.mjs.map` sourcesContent의 라이선스 헤더): **Google LLC**와
  **Closure Library** 둘 다 `SPDX-License-Identifier: Apache-2.0`. 직접 확인했다.
- WASM(배포하는 `.wasm` 안의 `third_party/` 경로 문자열): TensorFlow Lite · OpenCV ·
  Abseil · **XNNPACK** · ruy · **Eigen** · Protocol Buffers · FlatBuffers · gemmlowp ·
  Emscripten libc++abi. libjpeg는 OpenCV 빌드 정보 문자열에만 나타나 정적 링크 여부가
  불분명하다.

**핵심 발견: 배포하는 `.wasm` 세 개에 Copyright/License 문자열이 0건이다.**
그중 **XNNPACK은 BSD-3-Clause**(1차 출처 확인: `google/XNNPACK` LICENSE, "Copyright (c)
Facebook, Inc. and its affiliates" · "Copyright 2019 Google LLC")로 **바이너리 재배포 시
저작권 고지 재현을 요구한다.** Eigen은 주로 **MPL-2.0**이다(1차 출처: Eigen COPYING.README).
현재 제품 고지는 `Apache-2.0.txt` 하나만 싣는다. 즉 **지금 상태로 공개하면 최소 한 건의
고지 의무가 충족되지 않는다.** W13 공개 차단 요인으로 남긴다.

나머지 구성요소의 라이선스는 아직 1차 출처로 확인하지 않았고 `licenseVerified: false`로
적었다. 추정으로 채우지 않는다.

`sdk.bundledNoticesReview`는 `pending` 그대로 둔다. 목록이 생겼다는 것과 고지가 실렸다는
것은 다르며, 고지 화면은 C 소유다.

### REQ-D-11 · C · 고지 화면에 SDK 번들 구성요소 싣기

- 대상: `apps/web/public/licenses/index.html` (C 소유. `apps/web/public/`가 C이고
  `apps/web/public/models/`만 D다).
- 현재 상태: "SDK에 포함된 제3자 구성 요소의 고지도 추가 확인 중입니다"로 정직하게 비워 둔
  상태다. 이제 채울 목록이 생겼다.
- 필요한 변경: `manifest.json`의 `sdk.bundledComponents`를 근거로 구성요소를 싣고,
  **최소한 XNNPACK의 BSD-3-Clause 저작권 고지 원문을 재현한다.** Apache-2.0 원문 하나로
  BSD-3-Clause 의무를 대신할 수 없다.
- `licenseVerified: false`인 항목은 확인 중으로 표시하고 Apache-2.0으로 뭉뚱그리지 않는다.
- 완료 확인: 고지 화면의 구성요소가 `sdk.bundledComponents`와 일치하고, BSD-3-Clause 고지가
  실린다. 그 뒤라야 D가 `sdk.bundledNoticesReview`를 `verified`로 올릴 수 있다.

### REQ-D-12 · F · 자산 대장과 검사에 번들 구성요소 반영

- 대상: `docs/third-party-assets.md`, `scripts/lib/vision-asset-notices.mjs` (둘 다 F 소유).
- 필요한 변경 두 가지다.
  1. 자산 대장에 `sdk.bundledComponents` 내용을 옮긴다. REQ-D-04의 후속이다.
  2. 검사가 `bundledNoticesReview: 'verified'`를 받아들이는 조건에 **고지 파일 쪽 확인을
     추가한다.** 지금은 manifest의 문자열 하나만 보므로, 고지 화면을 고치지 않고 플래그만
     바꿔도 통과한다.
- 완료 확인: 고지 없이 `verified`로 바꾸면 검사가 실패한다.

## blockedOn 요약

| 항목                                | 막는 대상            | 영향                                      |
| ----------------------------------- | -------------------- | ----------------------------------------- |
| E-05 실제 grant (REQ-D-05)          | D-13 실제 연결       | E 구현·인계 도착(`7ea0151`), B 조립 대기  |
| B의 `bootstrap` 미디어 조립         | D-13–D-17            | `bootstrap.ts`가 `mediaEnabled: false`    |
| B의 grant 세대 정규화 (REQ-D-07)    | D-13 첫 연결         | 첫 요청이 `STALE_GENERATION`으로 거절     |
| B-02 strict payload, A-10/A-11 규칙 | D-09–D-11 실제 연결  | 명령 접수·거절 실동작                     |
| 대표 장치·실제 브라우저             | D-01–D-13 전체       | 추론 fps, 각도 튜닝, 픽셀 검증, 권한 거부 |
| C의 안내 표시 (REQ-D-08)            | S15P21C204-244 완료  | 문구는 나가지만 화면에 뜨지 않는다        |
| F의 `.prettierignore` (REQ-D-09)    | 모든 D 티켓의 verify | `format:check`가 첫 단계에서 실패         |
| C의 대기 항목 표시 (REQ-D-10)       | S15P21C204-240 완료  | 단계·원인은 나오지만 화면에 뜨지 않는다   |
| C의 번들 고지 (REQ-D-11)            | W13 공개             | XNNPACK BSD-3-Clause 고지가 실리지 않았다 |
| F의 대장·검사 (REQ-D-12)            | S15P21C204-241 완료  | 고지 없이 verified 로 바꿔도 검사가 통과  |
| 손동작 2모델 권리 회신              | S15P21C204-241 완료  | Google 문의 전에는 확정 불가              |

## 다음 단계

1. F가 REQ-D-01을 반영하면 `pnpm verify` 전체를 다시 실행하고 결과를 이 문서에 갱신한다.
2. C가 REQ-D-06으로 조립하면 장치 점검·입력·연결 상실·반복 입장/종료를 실제 연결로 시험한다.
3. D-14–D-17은 게시 → 수신 → 오디오 → 세대/참가 종료 순서로 모두 단위 검증을 마쳤다.
   E-05/E-09/E-10 인계가 도착하면 실제 연결 회귀만 수행한다.
4. 대표 장치가 준비되면 튜닝 두 버전(`D-input-1`, `D-safe-face-1`)의 수치를 실측으로 조정하고
   변경한 버전을 여기에 기록한다.
5. **SDK 어댑터(2026-09-09 완료)**: `livekit-adapter.ts`로 미디어 네 port의 제품 구현을
   채웠다. Vite lib 시험 빌드에서 `livekit-client`가 별도 청크(636.74 kB, gzip 147.20 kB)로
   떨어지고 `vision.worker` 청크(158.88 kB)도 함께 방출되는 것을 확인했다. 다만 C의 조립
   (REQ-D-06)이 없어 제품 번들에는 아직 D runtime 자체가 들어가지 않는다.
6. **MR 운영(2026-09-09 저녁)**: F가 `eeeba9b`로 REQ-D-01을 반영했고, D 브랜치에
   `origin/develop` `7ea0151`을 병합한 뒤 `pnpm verify` 전체가 exit 0으로 통과했다
   (format·check:execution·lint·typecheck·134파일 1539시험·build·e2e). D 소유 경로에는
   develop 변경이 0건이고 충돌도 없었다. Draft를 ready로 바꿔 병합할 수 있는 상태다.
   push·MR 생성·병합은 담당자가 직접 한다.

## 재개 시 확인

1. 인계 구현 SHA가 현재 checkout에 실제 반영됐는지 확인한다. MR 링크만 있거나 열린 MR이면
   적용된 것으로 보지 않는다. 이 브랜치는 아직 push되지 않았다.
2. 공개 export와 소비 시험을 확인하고 필요한 연결 시험을 실행한다.
3. 성공한 단계와 아직 막힌 단계를 별도로 갱신한다. 동일 구현을 중복 커밋하지 않는다.
