# 제3자 자산

2026-09-18 기준. 파일 출처·sha256·bytes·취득일·구성별 모델 카드와 SDK 번들 구성요소 목록의 원본은 [비전 자산 manifest](../apps/web/public/models/manifest.json), 취득 경위는 [비전 자산 README](../apps/web/public/models/README.md)다. 권리 확인이 끝나지 않은 항목은 공개 차단 요인이다.

## 비전 모델과 SDK

| 경로                                                     | 자산                        | 버전·크기                                                 | 현재 라이선스 기록                                 |
| -------------------------------------------------------- | --------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `apps/web/public/models/face/face_landmarker.task`       | FaceLandmarker float16      | release 1 · 3,758,596 bytes                               | Apache-2.0 — 구성3종의 공식 카드 확인              |
| `apps/web/public/models/pose/pose_landmarker.task`       | PoseLandmarker Lite float16 | release 1 · 5,777,746 bytes                               | Apache-2.0 — 공식 Lite 배포표의 모델 카드 확인     |
| `apps/web/public/models/gesture/gesture_recognizer.task` | GestureRecognizer float16   | release 1 · 8,373,440 bytes                               | pending — 손 추적2종 확인, 임베더/분류기2종 미확인 |
| `apps/web/public/models/mediapipe/1.0.1/wasm/`           | SDK의 WASM·로더 JS 6개      | `@mediapipe/tasks-vision` 1.0.1 · 파일별 bytes는 manifest | Apache-2.0 선언 확인, 번들 제3자 고지 검토 pending |

pending은 실제 자산 부재가 아닌 권리 검토 미완료다. SDK 선언과 모델 카드의 별도 근거를 사용했다.

- 얼굴: [공식 배포표](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models),
  [BlazeFace short range](<https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf>),
  [Face Mesh V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf),
  [Blendshape V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf): Apache-2.0 표기.
- 자세: [공식 Lite 배포표](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker#models)의
  [BlazePose GHUM 3D](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf): Apache-2.0 표기.
- 손: [공식 배포표](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/index#models)의
  [Hand Tracking](<https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf>): Apache-2.0 표기.
  별도 [gesture 분류 카드](https://storage.googleapis.com/mediapipe-assets/gesture_recognizer/model_card_hand_gesture_classification_with_faireness_2022.pdf)에는
  임베더/분류기의 라이선스 항목이 없어 gesture 번들의 pending을 유지한다.

[Apache 원문](../apps/web/public/licenses/Apache-2.0.txt)은
[Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0.txt)에서 그대로 취득했다.
11,358bytes·SHA256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`이다.
홈의 “오픈소스 고지”는 [실제 배포 페이지](../apps/web/public/licenses/index.html)로 연결한다.
페이지·스타일·원문의 해시와 모델/SDK9개 바이트는 `pnpm check:product-assets`에서 검사한다.
NGINX의 `/licenses/`는 게임 소켓 정규식과 SPA 대체 응답을 우회하고 누락 시404를 반환한다.

`visionRightsReviewed`는 비전 자산의 기록상 검토 상태이며 전체 서비스의 권리나 공개 준비
완료 상태가 아니다. `--require-reviewed-rights`는 현재 `VISION_ASSET_RIGHTS_PENDING`으로
실패한다. W20 공개 승격 연결과 미확인 gesture/SDK 번들 고지, 다른 배포 의존성의 고지는 남는다.
모델 갱신 시 버전·바이트·카드 연결을 다시 확인하며, 라이선스 기록의 날짜만으로 만료시키지 않는다.

## 남은 권리 확인 (S15P21C204-241, 2026-09-15 조사)

- **손동작 2모델**(gesture_embedder.tflite, canned_gesture_classifier.tflite): pending 유지. 분류 모델 카드에 추출 가능한 라이선스 문구가 없고, 저장소 LICENSE·Model Maker 소스 헤더는 배포된 학습 바이너리를 범위로 명시하지 않는다. 대안 영향: 기능 축소가 가장 싸다(손동작은 출구 시작·취소와 교환만 만들고 같은 명령의 키보드 경로가 있다). 재학습은 임베더 위에 분류기만 얹으므로 한 건만 해소된다. 런타임 다운로드는 고정 해시 검사·CSP와 충돌한다.
- **SDK 번들 고지**: 배포하는 파일에서 구성요소를 뽑아 manifest sdk.bundledComponents에 적었다(JS: Google LLC·Closure Library Apache-2.0 헤더 확인. WASM: TensorFlow Lite·OpenCV·Abseil·XNNPACK·ruy·Eigen·protobuf·FlatBuffers·gemmlowp·Emscripten libc++abi). 배포 wasm 3개에는 저작권·라이선스 문자열이 없고, XNNPACK(BSD-3-Clause)은 바이너리 재배포 시 고지 재현을 요구한다. 현재 제품 고지는 Apache-2.0 원문뿐이므로 공개 전에 고지 화면을 보완해야 한다. undledNoticesReview는 pending이다.

## 배포에 포함되는 자산 (S15P21C204-225)

제품 빌드가 실제로 내보내는 파일은 `apps/web/public/` 아래가 전부다. 그 밖의 화면 요소(캐릭터·
장비 형상, 효과음·안내음)는 파일이 아니라 저장소 TypeScript 코드가 실행 시점에 만들어 내므로
제3자 권리가 붙지 않는다. 아래 두 표가 그 경계다.

| 배포 경로                      | 자산                               | 출처·권리                                   | 고지 의무        |
| ------------------------------ | ---------------------------------- | ------------------------------------------- | ---------------- |
| `models/` (모델 3·WASM 6·문서) | MediaPipe 비전 자산                | Google, Apache-2.0(손동작 2모델 pending)    | 있음 — 고지 화면 |
| `fonts/` (WOFF2 6·OFL 원문)    | 갈무리 픽셀 글꼴 4종·나눔명조 2종  | Lee Minseo(quiple)·Google Inc., SIL OFL 1.1 | 있음 — 고지 화면 |
| `licenses/` (고지 화면·원문)   | 고지 페이지·스타일·Apache-2.0 원문 | 페이지는 자체 제작, 원문은 ASF 취득         | 고지 대상 자체   |
| `brand/kkakkung-logo.png`      | 까꿍 로고                          | 프로젝트 구성원 제공 브랜드 자산            | 없음             |
| `textures/backrooms/` (PNG 1)  | 백룸 벽지 재질                     | 프로젝트 구성원 제공 렌더 자산              | 없음             |

나눔명조(S15P21C204-295)는 제목용 명조로 `@fontsource/nanum-myeongjo` 5.2.5(Google Fonts 배포본)의
한글·라틴 400 서브셋 WOFF2 두 개를 그대로 담았다. 그 패키지의 LICENSE 는 저작권자를 Google Inc. 로
적고 SIL Open Font License 1.1 을 따른다고 선언한다. 함께 배포하는 라이선스 원문은 갈무리와 같은
`fonts/OFL-1.1.txt` 이며, 두 계열의 저작권 표기는 고지 화면에 각각 적는다. 바이트는
`pnpm check:product-assets` 가 sha256 으로 고정한다.

외부에서 받은 음원 파일은 없다. 새 파일을 `public/` 에 넣으면 이 표에 줄을 추가해야 하며,
빠뜨리면 `tests/contracts/asset-ledger.test.ts`가 실패한다.

### 코드로 만드는 화면·소리

파일이 아니라 코드다. 각 항목의 버전·무결성은 저장소 커밋으로 추적하고 별도 라이선스가 없다.

| 만드는 것                                      | 원본                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 어두운 블록 테마 16×16 픽셀 타일 4종·재질(268) | [block-theme.ts](../apps/web/src/features/game/scene/block-theme.ts)                                                                                           |
| 백룸 테마 바닥·천장 재질과 형상                | [facility-theme.ts](../apps/web/src/features/game/scene/facility-theme.ts)                                                                                     |
| 캐릭터 형상·역할 색·실루엣                     | [FaceAvatar.tsx](../apps/web/src/features/game/scene/FaceAvatar.tsx), [role-colors.ts](../apps/web/src/features/game/scene/role-colors.ts)                     |
| 감지기·덫 형상과 치수                          | [EquipmentObjects.tsx](../apps/web/src/features/game/scene/EquipmentObjects.tsx), [equipment-model.ts](../apps/web/src/features/game/scene/equipment-model.ts) |
| 1인칭 손·랜턴·든 도구(268)                     | [HeldTool.tsx](../apps/web/src/features/game/scene/HeldTool.tsx)                                                                                               |
| 출구 문틀·표시등                               | [VisibleExits.tsx](../apps/web/src/features/game/scene/VisibleExits.tsx)                                                                                       |
| 데모 방 인형의 대역 얼굴                       | [demo-face.ts](../apps/web/src/features/game/scene/demo-face.ts)                                                                                               |
| 발소리·감지기·덫 효과음 3종                    | [effect-buffer.ts](../apps/web/src/features/media/effect-buffer.ts)                                                                                            |
| 상태 안내음 13종(261)                          | [cue-buffer.ts](../apps/web/src/features/media/cue-buffer.ts)                                                                                                  |

## 제품 고지 연결

고지 의무가 있는 항목은 `/licenses/index.html`에 있고 제품 화면 하단의 "오픈소스 고지" 링크로
연다. 비전 자산은 파일별 해시와 구성 모델 근거를 `/models/manifest.json`이, 글꼴은 동봉한
`/fonts/OFL-1.1.txt`가 뒷받침한다. 고지 화면과 배포 파일의 일치는
[vision-asset-notices.test.ts](../tests/contracts/vision-asset-notices.test.ts)와
[asset-ledger.test.ts](../tests/contracts/asset-ledger.test.ts)가 검사한다.

**공개 차단 요인으로 남은 것**은 위 "남은 권리 확인"의 두 건(손동작 2모델, SDK 번들 고지)이다.
둘 다 고지 화면의 "추가 확인 중인 항목"에 그대로 적혀 있으며, 이 문서는 서비스 전체의 권리 검토
완료를 뜻하지 않는다.

### 갈무리 폰트

| 항목        | 내용                                                                               |
| ----------- | ---------------------------------------------------------------------------------- |
| 이름과 버전 | Galmuri 2.40.3, Galmuri9·11·11 Bold·14                                             |
| 제작자      | Lee Minseo (quiple)                                                                |
| 출처        | [공식 사이트](https://galmuri.quiple.dev), npm `galmuri@2.40.3`                    |
| 라이선스    | SIL Open Font License 1.1, 예약 폰트 이름 `Galmuri`                                |
| 배포 방식   | WOFF2 네 파일과 OFL 원문을 `apps/web/public/fonts`에서 자체 호스팅, CDN 사용 안 함 |
| 무결성      | 정확한 패키지 버전과 integrity를 `pnpm-lock.yaml`에 고정                           |
| 갱신 책임   | 웹 UI 담당자가 버전·OFL 고지·fallback을 함께 검토                                  |

폰트 파일을 수정하거나 이름을 바꾸지 않는다. 해당 갈무리 글꼴 로드에 실패하면 Galmuri14,
Pretendard, Noto Sans KR, system-ui 순서로 대체하므로 글자가 사라지지 않는다. 패키지에 포함된
OFL 원문은 배포 의존성과 함께 보존하며, 사용자용 오픈소스 고지 화면 연결은 별도 자산 고지
정리에서 이어간다.

| 파일                   | bytes   | SHA256                                                             |
| ---------------------- | ------- | ------------------------------------------------------------------ |
| `Galmuri9.woff2`       | 429,612 | `275d995906625eaaa5d2d9baa0a80f90a5c033c381c0dc2108a8729d371041a6` |
| `Galmuri11.woff2`      | 504,736 | `f467d1b10e6b88dfa8399c9f93b38c7643e050abfe4fc15800ac0b000f5a57d6` |
| `Galmuri11-Bold.woff2` | 166,632 | `8643094f395aa2dbad6bc4385cc043314801eaec2e759d549435ec8ac4f2d078` |
| `Galmuri14.woff2`      | 564,892 | `79b34b22b86536d0fe9ebe7105dd5f20f56558d691c67a0c6432807a03ec5a82` |
| `OFL-1.1.txt`          | 4,360   | `86a3ee9495f942f0243f18c103da9faca27adb88142613edb8bb852e56c892c1` |

### 까꿍 로고

`apps/web/public/brand/kkakkung-logo.png`는 S15P21C204-279에서 프로젝트 구성원이 제공한
브랜드 자산이다. 프로젝트 화면과 브라우저 파비콘에 사용할 수 있도록 제공받았으며 권리는
프로젝트 제공 자산과 같은 조건으로 관리한다. 원본 비율을 유지한 366×388 RGBA PNG이고,
167,732bytes, SHA256
`9ab237541afc01f03da4081fe3739bf12ac273a34e8cefc5d3ccdaed0bd10258`이다.

### 백룸 벽지 재질

`apps/web/public/textures/backrooms/seamless.png`는 S15P21C204-279에서 프로젝트 구성원이
게임 미로에 적용하도록 제공한 1,254×1,254 RGB 렌더 자산이다. 원본 파일명은 `SEAMLESSTEXTURE.PNG`다. 함께 받은
`ALBEDO`·`ROUGHNESS`·`NORMAL` PNG는 타일이 이어지지 않아 쓰지 않았고 S15P21C204-397에서 지웠다. 프로젝트 제공 자산과 같은 조건으로
관리하고 백룸형 벽 재질 외 용도로 재배포하지 않는다.

| 파일           | bytes     | SHA256                                                             |
| -------------- | --------- | ------------------------------------------------------------------ |
| `seamless.png` | 2,507,573 | `e3f8176a84b135cd935cbbbbc6e6b64db7c8b5bd97bf4b4544307444cdb26df7` |

## 자산 추가 기록

자산을 추가할 때 다음을 기록한다.

| 항목          | 내용                            |
| ------------- | ------------------------------- |
| 파일/디렉터리 | 저장소 내 공개 경로             |
| 이름과 버전   | 모델·자산의 정확한 식별자       |
| 출처          | 원본 배포 페이지 또는 저장소    |
| 라이선스      | 상업 이용·수정·재배포·표시 조건 |
| 무결성        | 파일 크기와 해시                |
| 갱신 책임자   | 버전·취약점·삭제 요청 담당      |

브라우저 공개 자산만 `apps/web/public`에 둔다. 전체 맵·fallback 배치 같은 서버 전용 자료와 Secret은 공개 자산으로 두지 않는다. 임의의 `latest` CDN URL에 운영이 의존하지 않게 버전과 파일을 고정한다.
