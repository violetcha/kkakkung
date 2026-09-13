# 방 생성 전 분리 미디어 회수 검증

관련 Jira는 [S15P21C204-215](https://ssafy.atlassian.net/browse/S15P21C204-215)다.
MC-PUBLIC-03은 [서버 제어 조립](split-media-policy.md)의 후속 Cloud 인수 중,
미입장 원본과 아직 생성되지 않은 전달 대상을 먼저 확인한다. 첫 실제 실행의 부분 통과와
미확인 결과는 아래에 보존한다. 전체 조건이 충족되기 전에는 성공으로 기록하지 않는다.

제품 MediaGenerationRegistry와 ownedMediaTargets/ownedMediaRooms가 생성한 하나의 분리
세대·두 명 명단·세 개 방·네 개 대상에 최소 CAMERA/MIC 토큰을 진단용으로 서명한다.
전달 대상 방의 토큰 두 개는 방별 회수 범위를 확인하는 공격자 대조군이며 제품은 이런
토큰을 브라우저에 발급하지 않는다. 제품 GrantIssuer/MediaCoordinator에 시험용 SUPPORTED
capability를 넣지 않는다. 이 시험은 해당 두 제품 조립부의 실제 Cloud 통과가 아니다.

## 실제 확인 조건

1. 대상 방이 하나도 없는 상태에서 네 신원에 명시적인 cutoff로 remove를 호출한다.
   원격 성공 응답과 참가자 부재를 모두 요구하며 remove의404를 성공으로 바꾸지 않는다.
   제품이 사용하는 listParticipants도 조회해 빈 목록/404를 따로 기록한다.
   실제 제품의 areRevokedMediaTargetsAbsent로 ACK 뒤 부재를 확인한다.
   currentProductListAbsenceCompatible는 이 제품 함수의 결과이며 rawInventoriesAreEmpty와
   구분한다. 제거 자체의404·통신 오류·미확인 응답은 회수 성공으로 인정하지 않는다.
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

## 실제 관측과 제품 수정

2026-09-13 22:08 KST 첫 실행 소스는 `911de4ee9ce2945b97c9167bb3ab55bf522b7368`다.
26,942ms, 정상24/정리16 API 호출로 미입장 네 토큰 거절, 새 신원 정상 접속,
최초 방 생성 후 기존 토큰 거절, 최종 정리는 확인했다. 삭제 후 재생성의 즉시 목록 조회가
세 방과 일치하지 않아 `UNJOINED_PROBE_RECREATION_UNCONFIRMED`, exit1로 종료했다.
이 결과는 토큰 재사용 성공을 의미하지 않으며 해당 재생성 경계는 미확인이다.

생성 전 세 방의 listParticipants는 모두 명시적인404/not_found였다. 기존 실행 중 회수
경로는 이 응답을 예외로 처리하여 ACK 뒤에도 UNRESOLVED로 남길 수 있었다. 제품 함수를
분리해 ACK 뒤의 명시적404만 부재로 처리하고 나머지 소유 방도 계속 확인하도록 수정했다.
구 구현에서 회귀3개 실패를 확인했다. 수정 후 관련5파일131개, QA 타입·lint PASS다.
회수 ACK 누락, 다른 오류, 남아 있는 전달본, 내구 저장/예약 보존을 함께 검사했다.
실제 제품 발급기/조립부 전체를 통과했다는 뜻은 아니다.

첫 원본은 같은 서버의 다음 경로에 보존하며 비밀과 사용자 미디어를 문서로 옮기지 않는다.

```text
/var/lib/jenkins/.local/kkakkung-diagnostics/unjoined-215e-20260913-911de4ee/.local/qa/unjoined-revocation-1789304854461
unjoined-revocation-evidence.json SHA-256:
52d44d9328d8f2bc9fabcca78388ee138d9822521e4d8ea8deb6ee88c2bbebb2
```

22:26 KST 수정 소스 `d3cb136b796e55fe4597ab1c77e9d97ad8ef5ca5`로 한 번 더 확인했다.
30,287ms, 정상27/정리16 호출이며 세 방 모두404인 상태에서 실제 제품 함수의
productAbsenceConfirmed와 currentProductListAbsenceCompatible가 true였다.
미입장 토큰 거절·새 신원 정상 접속·최초 생성 뒤 거절·최종 정리도 확인했다.
재생성의 즉시 목록 불일치는 그대로 남아 전체 시험은 exit1이고 승격 값은 모두 false다.
사용자의 중단 요청에 따라 재생성 추가 조사와 제품 발급/조립부 인수는 다음 재개로 넘긴다.

```text
/var/lib/jenkins/.local/kkakkung-diagnostics/unjoined-215e2-20260913-d3cb136b/.local/qa/unjoined-revocation-1789305974649
unjoined-revocation-evidence.json SHA-256:
c47f17b98f81861e7f10f86a07944bc76e41716e6057203b59e809005ea6d9fa
```

## 실행·보존

### 재생성 관측 보강

사용자 재개 요청 뒤 기존 실패의 관측 방법을 점검했다.
[LiveKit의 동일 이름 재생성 안내](https://kb.livekit.io/articles/2412895831-avoiding-room-id-reuse-when-re-creating-rooms-with-the-same-name)는
삭제 직후 생성 시 기존 SID를 재사용할 수 있으며 동일 이름이 필요하면1–2분 간격을
두도록 설명한다. 이 설명만으로 이전 실패의 원인을 확정하거나 회수 성공으로 바꾸지 않는다.

후속 시험은 삭제 ACK 뒤120초를 기다리고 부재를 다시 확인한다. 생성 응답과 목록의
방 이름·SID를 대조하고 재생성된 모든 방은 이전 SID와 달라야 한다. 제한된 횟수의
읽기 재확인만 허용하고 생성 API를 반복하지 않는다. 이전 토큰의 만료 전401/403을
검사하고 그 뒤에도 새 SID가 유지되는지 확인한다. 전체240초·정리90초와 호출 상한은
유지한다. 증거에는 SID나 토큰 원문을 저장하지 않고 단계·대조 결과·경과 시간만 남긴다.

### 실행 조건

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
