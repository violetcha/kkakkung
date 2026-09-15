# 제3자 자산

2026-09-15 기준. 파일 출처·sha256·bytes·취득일·구성별 모델 카드와 SDK 번들 구성요소 목록의 원본은 [비전 자산 manifest](../apps/web/public/models/manifest.json), 취득 경위는 [비전 자산 README](../apps/web/public/models/README.md)다. 권리 확인이 끝나지 않은 항목은 공개 차단 요인이다.

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

## 코드로 만든 자산

시설 렌더링의 벽·바닥 텍스처와 공간·캐릭터·장비 형상은 저장소 TypeScript 코드로 작성했다. 원본은 [facility-theme.ts](../apps/web/src/features/game/scene/facility-theme.ts), [FaceAvatar.tsx](../apps/web/src/features/game/scene/FaceAvatar.tsx), [EquipmentObjects.tsx](../apps/web/src/features/game/scene/EquipmentObjects.tsx)다. 발소리·감지기·덫 효과음 3종도 코드로 생성한 PCM이다. 외부 모델·텍스처·폰트·음원 파일을 새로 취득하지 않았으며 버전·무결성은 저장소 커밋으로 추적한다. 렌더 자산·음원·폰트 대장 정리는 S15P21C204-225에서 이어간다.

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
