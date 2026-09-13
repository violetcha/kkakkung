# 게스트 입장 준비

Jira [S15P21C204-212](https://ssafy.atlassian.net/browse/S15P21C204-212), W07의 서버·홈 단계다.
운영 도메인은 팀원 SSO를 유지한다. 실제 일반 공개 전환은 하지 않는다.

## 설정과 입장

- `SERVICE_AUDIENCE=team`은 gitlab-sso, `public`은 guest를 선택한다.
  둘 모두 product profile과 신뢰 프록시1단계를 요구한다.
- 기존 `SESSION_ADMISSION_MODE`를 함께 쓰면 대상과 일치해야 하며 guest 단독 지정은 거절한다.
  대상 설정이 없는 기존 invitation/SSO는 호환된다. continuous overlay는 team을 고정한다.
- 현재 두 LiveKit 제품 모드는 공개 권한을 충족하지 않으므로 public+livekit 부팅을 거절한다.
  공개 미디어 후보의 실제 성공을 이 장벽의 해제 조건으로 대신하지 않는다.
  미디어가 비활성인 실제 제품 역시 기존 readiness/admission이 LOCKED다.

게스트는 닉네임으로 새 방을 만든다. 서버가 무작위 playerId/세션 Bearer를 발급하며
동일 닉네임도 독립 신원이다. 방 생성 시도는 IP 해시의 고정 버킷을 공유하므로 새 토큰이나
닉네임·위조 SSO 헤더로 초기화할 수 없다. 게스트는 SSO 헤더를 권한으로 사용하지 않는다.

친구 참가에는 현재 방장이 만든 방별 초대가 필요하다. 방 코드만으로 참가하지 못한다.
명시적으로 제출한 링크는 새 방 생성에서도 scope·만료·회수를 검증한다.
권한 검증 전에 방 존재 여부를 반환하지 않는다. 기존 팀원의 초대 없는 방 코드 참가는 유지한다.
원래의 정원6명, IP/초대 제한, 운영 OPEN/DRAINING/LOCKED,60초 첫 연결 기한,
세션 중복 연결 거절과 예약 취소·회수 경계를 재사용한다.

홈은 서버 access 응답에 따라 가입 없는 생성과 친구 초대 안내를 표시한다.
초대 없는 게스트 친구 참가는 비활성화하며 서버도 동일 요청을 거절한다.
새 fragment는 읽은 뒤 주소에서 제거하고 실패한 초대를 조용히 새 방 생성으로 바꾸지 않는다.
세션 토큰은 공유 URL이나 영구 브라우저 저장소에 기록하지 않는다.

## 검증과 남은 작업

실제 HTTP/Colyseus 제품 Room에서 게스트6연결, 독립 신원, 초대 회전/대기 예약 회수,
중복 연결·정원·만료·운영 잠금·동일 IP 생성 제한을 검사했다.
로비 시험의 기존 developmentAdmission/core는 합성이며 Cloud나 실제 경기 완주를 뜻하지 않는다.
별도로 실제 ProductProfileLoader의 미디어 비활성 public 제품이 LOCKED임을 검사했다.
설정/SSO/친구 초대/프록시 회귀5파일70개와 QA 타입 검사 통과.
실제 React 홈의 합성 HTTP 브라우저9개 통과. 전체·CI·MR·배포는 구현 기록에 이어 기록한다.

ingress/배포 manifest가 같은 audience로 선택되는 경로와 잘못된 조합의 승격 거절,
같은 이미지의 격리 전환 리허설은 W07 후속이다. W02 두 미디어 연결·G1과6대/10방 인수도 남는다.
이 단계로 `PUBLIC_READY` 또는 MVP 전체 완료를 보고하지 않는다.
