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

| 대상      | license      | 근거                                                                |
| --------- | ------------ | ------------------------------------------------------------------- |
| SDK 1.0.1 | `Apache-2.0` | 설치된 패키지 `package.json`의 license 필드에서 확인했다.           |
| 모델 3개  | **pending**  | 공식 모델 카드에서 확인하지 못했다. SDK 라이선스를 전용하지 않는다. |

모델 라이선스는 각 공식 모델 표(manifest.json의 `licenseSource`)에서 확인한 뒤 채운다.
확인 전에는 `pending`으로 남기며 SDK의 Apache-2.0을 모델에 자동 적용하지 않는다.

## F에게 요청한 작업

`docs/third-party-assets.md`는 F 소유다. 위 표와 manifest.json의 실제 sha256·bytes·출처를
그 문서의 기록 항목으로 옮기고, 정적 `.task`/`.wasm` MIME과 Worker CSP를 배포에 반영한다.
상세 요청은 [D 인계 기록](../../../../docs/execution/handoffs/D.md)에 있다.
