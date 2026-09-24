# 브라우저 비전 자산

D-02 / IN-02에서 고정한 MediaPipe 자산이다. 런타임은 외부 `latest` CDN URL을 읽지 않고
이 디렉터리의 고정 파일만 사용한다. 정확한 sha256·bytes·출처는 [manifest.json](manifest.json)에 있다.

취득일: **2026-09-08** · SDK: `@mediapipe/tasks-vision` **1.0.1** · 모델 release **1**

## 파일

| 경로                              | 내용                                      | bytes     |
| --------------------------------- | ----------------------------------------- | --------- |
| `face/face_landmarker.task`       | FaceLandmarker float16 release 1          | 3,758,596 |
| `pose/pose_landmarker.task`       | PoseLandmarker **Lite** float16 release 1 | 5,777,746 |
| `gesture/gesture_recognizer.task` | GestureRecognizer float16 release 1       | 8,373,440 |
| `mediapipe/1.0.1/wasm/*`          | SDK 1.0.1 WASM 6개                        | 약 35 MB  |

로컬 pose 파일명은 generic `pose_landmarker.task`지만 manifest의
`variant=pose_landmarker_lite`, `precision=float16`, `release=1`이 실제 자산을 식별한다.
모델 release 1과 SDK version 1.0.1은 서로 다른 버전 축이다.

## 출처

- 모델 3개: `https://storage.googleapis.com/mediapipe-models/...` 의 versioned release 1 URL.
  실제 URL은 manifest.json의 `sourceUrl`에 있다.
- WASM 6개: 설치된 `apps/web/node_modules/@mediapipe/tasks-vision/wasm`에서 복사했다.
  resolver가 기대하는 원래 basename을 유지한다.

## 라이선스 상태

2026-09-13 / S15P21C204-214에서 공식 배포표의 모델 카드와 실제 번들 구성을 대조했다.
구성 모델별 카드 URL·내부 파일 해시/크기·검토일은 manifest의 `licenseEvidence`에 있다.

| 대상 | 기록 | 근거와 남은 범위 |
| --- | --- | --- |
| SDK 1.0.1 | `Apache-2.0` | package.json 선언. 설치 패키지에 LICENSE/NOTICE가 없어 원문을 보충했다. 번들 제3자 고지 검토는 pending. |
| FaceLandmarker | `Apache-2.0` | BlazeFace short range, Face Mesh V2, Blendshape V2의 공식 카드 모두 확인. |
| PoseLandmarker Lite | `Apache-2.0` | 공식 Lite 배포표가 연결한 BlazePose GHUM 3D 카드 확인. |
| GestureRecognizer | **pending** | 손 검출/랜드마크 카드의 Apache-2.0은 확인. gesture embedder/canned classifier의 공식 카드에는 라이선스 항목이 없어 번들 권리는 미확인. |

SDK의 Apache-2.0을 모델에 자동 적용하지 않는다. 별도 모델 카드를 근거로 기록하며
모델 내부에 라이선스 원문이 들어 있다는 주장은 하지 않는다. 모델·WASM/로더 바이트는 바꾸지 않았다.
[배포 고지](../licenses/index.html)와 [Apache 원문](../licenses/Apache-2.0.txt)을 함께 공급한다.
일반 자산 검사는 모든 실제 파일·고지 SHA와 검토 목록의 일관성을 확인하며
`visionRightsReviewed=false`와 남은 항목을 반환한다. 자동 검사는 법적 권리를 새로 승인하지 않는다.
엄격한 검토 조건은 `node scripts/check-product-assets.mjs --require-reviewed-rights`로 검사한다.
현재 gesture·SDK 번들 고지가 미확인이므로 이 명령은 의도적으로 실패한다. W20 공개 승격 연결은 후속이다.

## 관련 문서

권리 확인 현황은 [제3자 자산](../../../../docs/third-party-assets.md), 런타임의 해시 대조 범위는 [웹 구현 명세](../../../../docs/impl/web.md#17-빌드-csp와-정적-자산)에 있다.
