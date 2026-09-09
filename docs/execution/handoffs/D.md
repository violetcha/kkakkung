# D 공개 인계 기록

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
- 튜닝 버전: `sensorTuningVersion = 'D-input-1'`(입력 각도·유지시간·필터),
  `safeFaceTuningVersion = 'D-safe-face-1'`(안전 프레임 유지 1200ms). 둘 다 기획서 확정
  상수가 아니라 **명시적 초깃값**이며 대표 장치 검증 후 조정한다. 포즈 탈출 임계값
  (`poseTuningVersion`)은 C가 소유한다.
- 가공 얼굴 출력은 160×160/10fps Canvas captureStream이며 branded handle로만 넘어간다.
  원본 track을 게시 경로에 주면 `RAW_TRACK_REJECTED`로 거절한다. 인코딩 bitrate는 D-14다.
- `MediaScope`는 `PrivateView.gameScope`와 **독립**이다. D는 `gameInstanceId`를
  `mediaInstanceId`로 복사하지 않고 `receiverGeneration`에서 논리 revision을 만들지 않는다.
  미디어만 재연결돼도 C의 논리 지식을 초기화하는 callback을 내지 않는다.
- `connectMedia`의 `connected`는 SDK 연결 성공일 뿐 서버 권한·바인딩 준비 완료가 아니다.
  `autoSubscribe:false`를 SFU 접근 통제 완료로 해석하지 않는다.

## 다른 소유자에게 요청할 변경

### REQ-D-01 · F · 루트 lint/format에서 모델 자산 제외 (**차단 중**)

- 대상 파일: `eslint.config.mjs`, `.prettierignore`
- 필요한 변경: 두 파일의 무시 목록에 `apps/web/public/models/**`를 추가한다.
- 이유: D-02가 `apps/web/public/models/mediapipe/1.0.1/wasm/`에 SDK 1.0.1 WASM glue
  `.js` 3개를 고정 자산으로 넣었다. 이 파일들 때문에 `pnpm lint`가 1378건,
  `pnpm format:check`가 3건으로 실패한다. **D 소유 소스의 오류는 0건이다.**
- 연결 작업: D-02 / IN-02, F QA 공통 검증.
- 완료 확인 명령: `pnpm lint`, `pnpm format:check`가 각각 통과.
- **2026-09-09 재확인**: `develop`·`ci/S15P21C204-41-jenkins-pipeline`·`feat/S15P21C204-48-master-map-template`·
  `feat/S15P21C204-145-revocation-retry` 어디에도 아직 반영되지 않았다. 이 요청이 반영되기 전에
  D의 MR을 `develop`에 병합하면 `develop`의 `pnpm verify`가 첫 단계에서 실패한다. 따라서 D의 MR은
  **Draft로 열고 REQ-D-01 반영 뒤 병합**한다.

### REQ-D-02 · F · main tsconfig에서 Worker 제외와 별도 검사

- 대상 파일: `apps/web/tsconfig.json`, F의 검증 스크립트
- 필요한 변경: `exclude`에 `src/**/*.worker.ts`를 추가하고 `tsc -p apps/web/tsconfig.worker.json --noEmit`을
  공통 검사에 넣는다. D 소유 `apps/web/tsconfig.worker.json`은 이미 통과한다.
- 이유: Worker 전용 lib(WebWorker)와 main lib(DOM)을 분리해 검사한다.
- 완료 확인 명령: `pnpm typecheck`와 `pnpm exec tsc -p apps/web/tsconfig.worker.json --noEmit`이 모두 통과.

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
  - **다만 이 값을 플레이어에게 보내는 코드가 없다.** `enqueueBindings`·`enqueueAudioPolicy`는
    `types.ts` 선언에만 있고 호출자가 0곳이다. `MediaCoordinator` 구현체도 `types.ts` 밖에
    없으며 `server/src/bootstrap.ts`는 `mediaEnabled: false`와 stage `skeleton`이다.
    즉 D-15/D-16/D-17 의 생산자는 아직 존재하지 않는다.
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
- D가 `requestMediaGrant`를 직접 부르지 않는다. 이 변환은 D 소유가 아니라 B 소유다.

## blockedOn 요약

| 항목                                 | 막는 대상           | 영향                                              |
| ------------------------------------ | ------------------- | ------------------------------------------------- |
| F의 lint/format 무시 목록 (REQ-D-01) | 공통 검증           | `pnpm verify`가 현재 실패                         |
| E-05 실제 grant (REQ-D-05)           | D-13 실제 연결      | 미디어 통합 전부                                  |
| `MediaCoordinator` 구현체 부재       | D-14–D-17           | `enqueueBindings`·`enqueueAudioPolicy` 호출자 0곳 |
| B의 `bootstrap` 미디어 조립          | D-13–D-17           | `bootstrap.ts`가 `mediaEnabled: false`            |
| B의 grant 세대 정규화 (REQ-D-07)     | D-13 첫 연결        | 첫 요청이 `STALE_GENERATION`으로 거절             |
| B-02 strict payload, A-10/A-11 규칙  | D-09–D-11 실제 연결 | 명령 접수·거절 실동작                             |
| 대표 장치·실제 브라우저              | D-01–D-13 전체      | 추론 fps, 각도 튜닝, 픽셀 검증, 권한 거부         |

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
6. **MR 운영(2026-09-09)**: `feat/S15P21C204-118-vision-media-input-runtime` → `develop` MR을
   Draft로 먼저 연다. `origin/develop`과 충돌 0건이고 `develop`이 바꾼 파일은 `server/**`와
   `handoffs/E.md`뿐이라 D 변경과 겹치지 않는다. 병합은 REQ-D-01 반영 뒤에 한다.
   push·MR 생성·병합은 담당자가 직접 한다.

## 재개 시 확인

1. 인계 구현 SHA가 현재 checkout에 실제 반영됐는지 확인한다. MR 링크만 있거나 열린 MR이면
   적용된 것으로 보지 않는다. 이 브랜치는 아직 push되지 않았다.
2. 공개 export와 소비 시험을 확인하고 필요한 연결 시험을 실행한다.
3. 성공한 단계와 아직 막힌 단계를 별도로 갱신한다. 동일 구현을 중복 커밋하지 않는다.
