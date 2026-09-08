# 기획·구현 기준서 v0.0.8

2026-09-07 사용자가 제공한 기획·구현 기준서 v0.0.8 원본을 내용 변경 없이 보관한다. HTML은 브라우저 열람용, DOCX는 Word 열람·편집용이다.

- [HTML 원본](까꿍_3대3_MVP_기획_구현_기준서_v0.0.8.html)
- [DOCX 원본](까꿍_3대3_MVP_기획_구현_기준서_v0.0.8.docx)

원본의 서식과 바이트를 보존하기 위해 HTML은 자동 포맷과 Git 줄바꿈 변환에서 제외한다. 기획서의 기능 목표와 현재 구현·검증 완료 여부는 구분하며, 현재 상태는 [requirements.md](../../requirements.md)와 [검증 결과](../verification.md)를 따른다.

## 스켈레톤의 설계 기준

기획서와 승인된 단일 레포 팀 가이드에서 다음 경계를 적용한다.

- 3대3, 3분, 2명 승부를 목표로 하는 전용 권위 서버 게임이다.
- Node.js·Colyseus 서버, React/R3F 웹, LiveKit Cloud, MediaPipe를 고정 스택으로 사용한다.
- workspace 경로는 `apps/web`, `server`, `packages/protocol`, `packages/game-core` 네 개다.
- game-core와 전체 맵은 서버 전용이며 웹에는 수신자별 공개 정보만 전달한다.
- 미디어 세대 종료와 논리 게임 참가 종료를 분리한다.
- G1~G6는 실행 증거가 생기기 전까지 모두 미실시다.
- 현재 구현은 기존 `kkakkung` Room과 별도 `sandbox`의 개발 스켈레톤이다.

세부 구현 계약은 [아키텍처](../architecture.md), [프로토콜](../protocol.md), [미디어 수명](../media-lifecycle.md)을 따른다.
