# 방 생성 전 분리 미디어 회수 검증

관련 Jira는 [S15P21C204-215](https://ssafy.atlassian.net/browse/S15P21C204-215)다.
MC-PUBLIC-03은 [서버 제어 조립](split-media-policy.md)의 후속 Cloud 인수 중,
미입장 원본과 아직 생성되지 않은 전달 대상을 먼저 확인한다. 현재는 시험 구현 단계이며
아래 조건을 실제로 실행하기 전에는 성공으로 기록하지 않는다.

제품 MediaGenerationRegistry와 ownedMediaTargets/ownedMediaRooms가 생성한 하나의 분리
세대·두 명 명단·세 개 방·네 개 대상에 최소 CAMERA/MIC 토큰을 진단용으로 서명한다.
전달 대상 방의 토큰 두 개는 방별 회수 범위를 확인하는 공격자 대조군이며 제품은 이런
토큰을 브라우저에 발급하지 않는다. 제품 GrantIssuer/MediaCoordinator에 시험용 SUPPORTED
capability를 넣지 않는다. 이 시험은 해당 두 제품 조립부의 실제 Cloud 통과가 아니다.

## 실제 확인 조건

1. 대상 방이 하나도 없는 상태에서 네 신원에 명시적인 cutoff로 remove를 호출한다.
   원격 성공 응답과 참가자 부재를 모두 요구하며 remove의404를 성공으로 바꾸지 않는다.
   제품이 사용하는 listParticipants도 조회해 빈 목록/404를 따로 기록한다. 기존 제품이
   그대로 소비할 수 있는지는 currentProductListAbsenceCompatible로 별도 보고한다.
2. 발급 후 한 번도 입장하지 않은 기존 토큰 네 개가 실제 SDK에서401/403으로 거절돼야 한다.
   연결 시간 초과나 일반 오류는 거절 증거가 아니다.
3. 별도의 새 CAMERA/MIC 신원은 같은 프로젝트·방·권한으로 연결돼야 한다.
   네트워크 문제나 사용할 수 없는 최소 권한을 거절 성공으로 계산하지 않는다.
4. 세 방을 명시적으로 생성하고 기존 토큰을 다시 검사한다. 이어서 세 방의 삭제와 부재를
   확인하고 같은 이름으로 재생성한 뒤에도 이전 토큰이 거절돼야 한다.
5. 각 신원의 최종 remove ACK/부재와 모든 방의 최종 부재를 확인한다. 한 대상의 실패가
   나머지 정리 시도를 중단하지 않으며 정리 불명확 상태를 성공으로 보고하지 않는다.

[LiveKit 참가자 관리 문서](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)는
명시적인 revoke_token_ts와 미존재 참가자 응답 억제를 설명한다. 방 자체의 생성 전·삭제 후
재생성 경계는 문서에서 추정하지 않고 위 시험으로 확인한다.

## 실행·보존

깨끗한 실제 소스 SHA·lockfile과 같은 preflight, 공식 잔량 관측·유계 예약을 먼저 확인한다.
세 방·최대 여덟 참가자 자원·240초와 정리90초, 정상40/정리30 API 호출 상한을 사용한다.
실제 장치·미디어 게시·사용자 얼굴/음성은 사용하지 않는다. 브라우저 한 페이지에서 순차
연결하며 자격은 기존 서버 안에서만 소비하고 토큰·원본 오류·브라우저 trace를 저장하지 않는다.

```bash
pnpm cloud:check --case MC-PUBLIC-03 --preflight <검증된-preflight.json> --evidence <.local/qa/출력>
```

원본은 unjoined-revocation-evidence.json에 단계별 SDK 결과·호출 수·정리 결과를 보존한다.
모든 관측이 통과해도 emptyRoomRevocationVerified만 인정하고 productPublicReady와
promotionAllowed는 false다. 내구 복구·늦은 전달·예약·실제 제품 HTTP/웹 연결과 전체 G1,
실제6대·10방·동일 이미지 전환은 각각 후속 인수다. 운영 팀 SSO와 공개 미디어 설정 차단을 유지한다.
