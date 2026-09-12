# 제3자 자산

2026-09-13 · 코드 기준 `99f90baa`. 저장소에는 고정한 MediaPipe 모델 3개와 SDK WASM 관련 파일 6개가 포함되어 있다. 정확한 파일별 출처·sha256·bytes·취득일의 원본은 [비전 자산 manifest](../apps/web/public/models/manifest.json), 취득 경위와 라이선스 확인 상태는 [비전 자산 README](../apps/web/public/models/README.md)를 따른다. 제품 범위와 공개 전 확인 사항은 [현행 기획서](spec/current.md)에 연결한다.

| 경로                                                     | 자산                        | 버전·크기                                                 | 현재 라이선스 기록                                          |
| -------------------------------------------------------- | --------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/web/public/models/face/face_landmarker.task`       | FaceLandmarker float16      | release 1 · 3,758,596 bytes                               | pending — 공식 모델 카드 확인 필요                          |
| `apps/web/public/models/pose/pose_landmarker.task`       | PoseLandmarker Lite float16 | release 1 · 5,777,746 bytes                               | pending — 공식 모델 카드 확인 필요                          |
| `apps/web/public/models/gesture/gesture_recognizer.task` | GestureRecognizer float16   | release 1 · 8,373,440 bytes                               | pending — 공식 모델 카드 확인 필요                          |
| `apps/web/public/models/mediapipe/1.0.1/wasm/`           | SDK의 WASM·로더 JS 6개      | `@mediapipe/tasks-vision` 1.0.1 · 파일별 bytes는 manifest | Apache-2.0 — 취득 당시 SDK package.json의 license 필드 기록 |

모델 라이선스의 pending은 실제 자산이 없다는 뜻이 아니라 재배포 조건의 확인이 끝나지 않았다는 뜻이다. SDK의 Apache-2.0을 모델에 그대로 적용하지 않는다. 이번 문서 갱신에서는 공식 모델 카드의 라이선스를 새로 검증하거나 승인하지 않았다. 기존 취득 담당은 D이며, 모델 갱신과 공개 전 라이선스 확인의 인계는 해당 README를 따른다.

시설 렌더링의 벽·바닥 텍스처와 공간·캐릭터·장비 형상은 저장소 TypeScript 코드로 작성했다. 원본은 [facility-theme.ts](../apps/web/src/features/game/scene/facility-theme.ts), [FaceAvatar.tsx](../apps/web/src/features/game/scene/FaceAvatar.tsx), [EquipmentObjects.tsx](../apps/web/src/features/game/scene/EquipmentObjects.tsx)다. 외부 모델·텍스처·폰트·음원 파일을 새로 취득하지 않았으며 버전·무결성은 저장소 커밋으로 추적한다. 위 비전 모델의 기존 pending 확인은 별도 작업에 남는다.

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
