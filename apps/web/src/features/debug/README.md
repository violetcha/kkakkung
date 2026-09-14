# 추적 디버그 오버레이 (임시)

카메라 미리보기 위에 얼굴 점·상체 스켈레톤(코·어깨·팔꿈치·손목)·손 스켈레톤과
앞뒤 기울기(어깨 거리 신호)·좌우 yaw 의 실시간 수치, 진입/해제 임계 게이지를 겹쳐 그린다.
실기기에서 모션 임계를 잡기 위한 진단 도구이며 판정에는 영향을 주지 않는다.

- 켜기/끄기: 혼자 체험 화면의 "추적 디버그 표시" 체크박스 또는 **Ctrl+Shift+D**.
  상태는 `localStorage['kkakkung.debug-overlay']` 에 남는다.
- 좌표는 미리보기 video 와 같은 비미러 카메라 프레임 기준이다.

## 없애는 방법

1. 이 폴더(`features/debug`) 삭제
2. `features/game/solo/solo-session.ts` 의 `debugFeed.publish*` 두 줄과 import 삭제
3. `features/game/solo/SoloPracticeScreen.tsx` 의 `DebugOverlay` 마운트, 토글 체크박스,
   `installDebugShortcut` 효과와 import 삭제
4. `styles.css` 의 `.debug-overlay` 규칙 삭제
5. (선택) `features/input/motion-debug.ts` 와 `InteractionDeps.onMotionDebug`, 런타임의
   `describeMotionDebug` 호출 삭제. `GestureSensor.hands` 는 다른 용도가 없으면 함께 지운다.
