# D 인계 · 장치·비전·미디어 클라이언트

담당 오명헌 · 2026-09-15 정리 · 코드 `apps/web/src/features/{devices,vision,input,media}`, `apps/web/public/models`

D는 카메라·마이크 수명, 비전 Worker와 모델, 모션·키보드 입력, 얼굴 가공·게시·수신과 음향 그래프를 소유한다. C가 쓰는 공개 진입점은 `createInteractionRuntime` 하나다.

## 상태

- 제품 경로에서 실제 장치·Worker·고정 모델·LiveKit SDK로 동작하며 매 배포 DP-06(합성 영상·음성)을 통과한다. 실제 대표 장치 인수는 남아 있다.
- 2026-09-14 모션 입력 수정(S15P21C204-177): 앞뒤 기울임을 어깨 폭·뺨 폭의 로그 비율로 교체, 고개 yaw 부호 수정, 보정에서 팔 요구 제거, 추적 디버그 오버레이·거울 미리보기.
- 2026-09-15: 얼굴 조건별 안내와 탭 이탈 즉시 안전 전환(244), 준비 대기 단계 계측 `ReadinessTrace`(240), 모델 목표 주기 tuningVersion(243), 제품 트랙·음성 증거 `MediaEvidence`(246), 손동작 2모델·SDK 번들 권리 조사(241).

## 공개 진입점

```ts
import {
  createInteractionRuntime,
  type InteractionDeps,
} from '@/features/input/InteractionRuntime';
```

재노출 타입: `DeviceStatus`, `SensorSnapshot`, `Sample`, `FaceSensor`, `PoseSensor`, `GestureSensor`, `InteractionContext`, `InteractionState`, `MediaGrant`, `MediaStatus`, `MediaBindings`, `AudioPolicy`, `FaceTrackEvent` 등. 두 번째 인수(`options`)는 시험 주입 전용이며 제품은 생략한다(실제 DOM·Worker·Canvas·`livekit-client`를 쓴다).

### C의 호출 순서

1. runtime은 App에서 한 번만 만든다. `deps.sendCommand`는 requestId를 돌려준다. D는 matchId·sequence를 만들지 않는다.
2. 사용자 제스처에서 `startDevices({ microphone })` → `calibrate()`. 카메라가 ready면 Worker와 가공 Canvas가 함께 기동한다.
3. 권위 상태가 바뀔 때마다 `setContext(fullContext)`로 전체 교체한다. 한 번도 부르지 않으면 어떤 명령도 나가지 않는다. 사라진 ID·역할/모드 변경·`pageActive=false`·비활성 단계에서 D가 유지 입력을 스스로 비운다.
4. `onLocalPreview(element)`는 장치 점검 화면에만 붙인다. C는 host 연결만 끊고 정리는 D가 한다.
5. `connectMedia(grant)`는 TEAM_PRACTICE·MAP_FINALIZING·GAME_LOADING·COUNTDOWN·PLAYING에서만 성공하고 그 외 단계는 `PHASE_NOT_ALLOWED`.
6. `reportMediaStatus`는 D가 부르지 않는다. `closed`는 `await retireMediaGeneration()` 완료 뒤에 C가 보낸다.

### 종료 메서드

| 메서드                           | 닫는 것                                     | 유지하는 것                            |
| -------------------------------- | ------------------------------------------- | -------------------------------------- |
| `retireMediaGeneration(reason?)` | 게시·수신·오디오 그래프·SDK 연결            | playerId·게임 Room·원본 장치·센서·입력 |
| `endParticipation()`             | 위 전부 + 입력 타이머·Worker·모델·원본 장치 | 게임 Room(수명은 C가 결정)             |
| `dispose()`                      | 위 전부, 객체 재사용 금지                   | 없음                                   |

- 세대는 정리 전에 terminal이 되고, 이후 도착한 Reconnected·게시·바인딩·정책은 현재 세대를 다시 열지 못한다. 새 세대는 `beginMediaGeneration()`으로만 연다.
- 로컬 `closed`는 서버 회수 성공이 아니다. 동시 종료는 공유 Promise로 한 번만 정리한다.
- 카메라 장애는 참가 종료가 아니다. 키보드 입력과 기본 얼굴로 전환한다.
- `bindingRevision`·`policyRevision`은 수신자 세대마다 1부터 다시 센다. 바닥 값은 같은 세대의 적용본에만 적용하고 구세대 정책은 `WRONG_SCOPE`로 버린다.

## 계약 세부

- `DeviceStatus.vision` ready = 모델 로드 + 신선한 유효 얼굴 + 첫 안전 가공 프레임 + 살아 있는 가공 트랙. 가공 트랙이 끊기면 다시 loading.
- 표본 유효: 얼굴·자세 300ms, 손 400ms. 다른 센서 갱신이 유효 시간을 늘리지 않는다. `quality==='uncertain'`은 유효하지 않다.
- 가공 얼굴: 160×160·10fps Canvas captureStream, branded handle로만 게시한다. 원본 트랙을 넘기면 `RAW_TRACK_REJECTED`.
- SDK 어댑터(`livekit-adapter.ts`)는 `loadLiveKit()` 동적 import. `room.disconnect(false)`, `unpublishTrack(track, false)`, `replaceTrack(next, true)` — 세대 회수가 원본 장치를 끄지 않게 한다. 어댑터는 검증하지 않고 얼굴 검증·상한은 `remote-faces`가 한다.
- `MediaScope`는 `PrivateView.gameScope`와 독립이다. `connected`는 SDK 연결 성공일 뿐 서버 권한 준비가 아니다.
- 얼굴 조건 안내(`onFaceGuidance`, 선택): `turned-away`·`glare`·`backlit`·`occluded` 네 문구. 표시 800ms 지속, 해제 2초, 같은 조건 재표시 10초 억제는 D가 이미 처리하므로 C가 debounce를 더 걸지 않는다. 가공 얼굴을 “익명화”로 설명하지 않는다. 탭이 숨으면 1.2초 유지를 기다리지 않고 기본 얼굴로 내린다.
- 준비 대기 계측(`getReadinessTrace?.()` 또는 `onReadinessTrace`): 단계 `permission`·`device-open`·`model-load`·`first-publish`, 원인 `permission-denied`·`device-in-use`·`device-missing`·`model-load`·`publish-failed`·`client-slow`. `cause=null`은 “문제 없음”이 아니라 아직 말할 수 없다는 뜻이다. 서버 응답 대기는 어느 단계에도 넣지 않았으므로 네 단계 합이 짧은데 대기가 안 풀리면 서버 쪽이다.
- 증거(`getMediaEvidence?.()`): `forbiddenButSubscribed`만 위반이고 `mutedButSubscribed`는 위반이 아니다. `effectiveGain===0`을 수신 차단으로 읽지 않는다. `published[].serverConfirmed`는 서버 바인딩 도착이다. 증거가 관문 통과를 선언하지 않는다.

### 튜닝 버전

모두 대표 장치 검증 전 초깃값이다. 값을 바꾸면 버전을 함께 올린다. 포즈 탈출 임계값은 C가 소유한다.

| 상수                                 | 버전                            | 덮는 것                                |
| ------------------------------------ | ------------------------------- | -------------------------------------- |
| `input-tuning.SENSOR_TUNING_VERSION` | `D-input-4-shoulder-span`       | 입력 임계·유지 시간·필터               |
| `safe-face.SAFE_FACE_TUNING_VERSION` | `D-safe-face-1`                 | 안전 프레임 유지 1,200ms               |
| `face-condition.FACE_CONDITION_*`    | `D-face-condition-1`            | 얼굴 조건 판정 임계와 표시 지연        |
| `frame-pump.MODEL_TARGET_TUNING_*`   | `D-model-interval-1-unmeasured` | 목표 주기 face 15 · pose 15 · 손 10fps |

## 다른 역할에 요청

| 요청     | 대상 | 내용                                                                                                                                                                                         | 상태   |
| -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| REQ-D-08 | C    | `onFaceGuidance` 문구를 준비·경기 화면에 표시(S15P21C204-244). 붙이지 않으면 판정 자체를 돌리지 않는다                                                                                       | 미연결 |
| REQ-D-10 | C    | `loading-controller`의 대기 항목 옆에 `ReadinessTrace`의 막힌 단계·원인 표시(S15P21C204-240). “카메라 연결” ↔ permission·device-open, “내 얼굴 게시 확인” ↔ first-publish, model-load도 함께 | 미연결 |
| REQ-D-11 | C    | `apps/web/public/licenses/index.html`에 `sdk.bundledComponents` 목록과 최소 XNNPACK BSD-3-Clause 고지 원문. `licenseVerified:false` 항목은 확인 중으로 표시                                  | 미연결 |
| REQ-D-12 | F    | `scripts/lib/vision-asset-notices.mjs`가 `bundledNoticesReview:'verified'`를 받을 때 고지 파일 쪽도 확인(지금은 플래그만 바꿔도 통과)                                                        | 미반영 |
| REQ-D-13 | F    | 제품 runtime의 `getMediaEvidence()`를 Cloud runner가 읽을 노출 지점(앱 진입점 C 또는 probe·harness F). 지금 `tests/cloud/probe.ts`는 합성 클라이언트를 본다                                  | 미연결 |

## 남은 일

- [S15P21C204-241](https://ssafy.atlassian.net/browse/S15P21C204-241) 손동작 2모델 권리: 1차 출처로 확정하지 못했다. Google 문의 결과를 기다리며 예비안은 손동작 기능 축소(같은 명령의 키보드 경로가 있음). 상세는 [제3자 자산](../third-party-assets.md).
- [S15P21C204-243](https://ssafy.atlassian.net/browse/S15P21C204-243) 대표 장치 3모델·키 폴백 동시 시험과 성능 preset 실측.
- [S15P21C204-245](https://ssafy.atlassian.net/browse/S15P21C204-245) 추론·자기 게시·원격 5얼굴·음성 동시 성능 측정.
- [S15P21C204-247](https://ssafy.atlassian.net/browse/S15P21C204-247) 원격 얼굴 5트랙·근거리 음성 실장치 인수, [S15P21C204-248](https://ssafy.atlassian.net/browse/S15P21C204-248) 6대 5판 모션·음성·트랙 결함 수정.
- 입력 임계값(전진 0.15/0.08, 후진 0.12/0.06, 회전 20°/12°)의 실기기 재측정.
