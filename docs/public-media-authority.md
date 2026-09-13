# 공개 미디어 권한 진단

Jira [S15P21C204-192](https://ssafy.atlassian.net/browse/S15P21C204-192), MVP W01/W02. 현재 운영은 계속 GitLab 프로젝트 팀원 전용이다.

## 확인할 문제

현재 팀 테스트의 `publisher-permissions`는 송신자가 서버가 전달한 허용 목록을 적용한다. 기존 MC-01의 정상 송신자·직접 구독 차단 결과가 송신자 자신의 허용 목록 변조까지 방어한다는 뜻은 아니다.

최소 토큰 `canSubscribe=false`의 관리자 구독을 지원하도록 하는 [업스트림 PR #4701](https://github.com/livekit/livekit/pull/4701)은 2026-09-13 조회 시 아직 열려 있다. [관련 문제 #4651](https://github.com/livekit/livekit/issues/4651)은 관리자 API 호출로도 수신하지 못하는 사례를 다룬다. 이것만으로 현재 Cloud 구현을 단정하지 않고 실제 새 미디어 표식으로 다시 측정한다.

대안으로 기존 서버 SDK 2.18.0의 `forwardParticipant`를 조사한다. 이 API는 원본 참가자의 트랙을 다른 방으로 전달하고, 원본 연결 종료 또는 목적지 참가자 제거 시 전달을 끝낸다. [공식 SDK API](https://docs.livekit.io/reference/server-sdk-js/classes/RoomServiceClient.html)를 참고한다. 지원 요금제·복제 참가자의 할당량/사용량·지연은 실제 확인이 필요하며, SDK 메서드 존재만으로 제품 방식이나 비용을 확정하지 않는다.

## 실행 경계

새 사례 `MC-PUBLIC-01`은 [Cloud 진단](../server/test/media/public-authority.cloud.test.ts)과 기존 합성 브라우저를 사용한다. 반드시 공통 `run-cloud-check`를 거친다.

- 소스 SHA/lockfile 일치, 깨끗한 Git 작업 트리, 유효한 preflight를 요구한다.
- 전용 namespace는 `qa-public-`로 시작한다. 운영 namespace를 쓰지 않는다.
- 사전 예약은 3방·최대 8참가자다. 실제로 발급하는 identity는 최대 5개이며 전달 복제와 정리 여유를 따로 확보한다.
- 실행 60–300초, 정리 30–120초 안에서만 동작하며 API는 정상 40회·정리 30회 총량과 이동 60초 상한을 갖는다. Cloud 요청은 유한 timeout, 자동 지역 failover 없이 실행한다.
- 실제 카메라·마이크를 취득하지 않는다. 합성 색상과 주파수 표식으로 영상과 음성의 새 수신을 확인한다.
- 토큰은 브라우저/시험 프로세스 메모리에만 전달하며 증거·로그에 넣지 않는다. 오류는 허용한 범주의 코드로 축약한다.
- 모든 발급 identity와 전달을 시도한 목적지를 정리 대상에 먼저 넣는다. 실패 중에도 해당 시험의 회수·부재 확인·방 삭제를 시도한다.

## 대조와 판정

1. 같은 방에서 최소 토큰으로 관리자 허용, 불허 수신자의 직접 구독, 허용 취소 후 재구독을 측정한다.
2. 정상 송신자의 허용 목록에서 허용/금지를 대조하고, 송신자가 금지 수신자까지 목록을 넓혔을 때 실제 색·음성이 도착하는지 확인한다.
3. 각 수신자에게 별도 방 토큰을 발급한다. 변조 송신자가 모두를 허용해도 서버가 전달하지 않은 방에는 도착하지 않아야 한다.
4. 허용 목적지의 새 표식, 전달 제거 뒤 차단, 처음 금지됐던 수신자에게 서버가 전달을 연 뒤 새 표식이 도착하는 양성 대조를 확인한다.
5. 회수와 정리가 미확인이라면 후보 방식 검증도 미확인으로 유지한다.

결과는 `public-authority-evidence.json`에 작성한다. API 성공 응답, 차단 화면, JSON fixture는 실제 미디어 수신의 대체 증거가 아니다. 후보가 검증되지 않으면 시험은 실패하고 사유를 남긴다.

`productPublicReady=false`, `promotionAllowed=false`는 항상 유지한다. 이 진단은 서버/웹 정책 연결·SID 교체·세대 경합·원격 회수·6기기·10방 인수를 완료하지 않으며 운영 capability 파일에 자동 복사하지 않는다.

## 실제 실행 상태

진단 초기 구현 소스는 `9b388e61bcefb91eff1a78aa9c6c34564d051afc`다. 사전검사/증거 판정35개와
전체 `pnpm verify`(235파일·2,319개·E2E9개), Jenkins MR #93/GitLab #191252를 통과했고
MR !121에 병합됐다. 당시 별도 로컬 시험으로 운영 자격을 추출하는 실행은 자동 승인 심사에서
거절됐다. 이 이력과 이후 사용자의 전체 접근 승인·중단·재개는 [기록](mvp-resume-2026-09-13.md)에 보존한다.

**2026-09-13 15:54–15:55 KST 실제 Cloud 진단을 실행했다.** 기존 자격 파일은 같은 운영
호스트의 격리 시험 자식 프로세스에서만 읽고, 로컬 장치/명령 인자/로그/증거로 추출하지 않았다.
Jenkins 작업이 끝난 뒤 독립된 깨끗한 checkout에서 기존 공통 실행기를 사용했다.

| 항목            | 실제 관측                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------- |
| 소스            | `92fe505c553a2e07208b603e6d78de14c826b98e`                                                |
| lockfile SHA256 | `469b418cc3a6d656d9f5ea61292d3e7801b5b7bcfc89af3bec29580342944fdf`                        |
| namespace       | `qa-public-20260913-c13e88c6`                                                             |
| 시간/종결       | 시험38,758ms, exit0, 정상 API8회·정리17회, cleanupConfirmed=true                          |
| 최소 토큰       | 관리자 허용 새 수신 미확인, 직접 차단 확인, 제거 후 차단 미확인                           |
| publisher 목록  | 정상 허용/직접 차단 확인, 송신자 변조로 금지 수신 우회 재현                               |
| 격리 방 전달    | API 수락, 허용 새 수신·직접 차단·제거 후 차단·금지 수신자의 허용 전환 양성 대조 모두 확인 |

15:50 KST 로그인한 Billing 화면에서 Build 포함량5,000분/50GB, 사용275분/약1GB를
확인했다. 보수 잔량4,000분/40GB 중50분/400MB·3방/8참가자, 실행240초+정리90초만
예약했다. 요금제 업그레이드나 운영 quota/capability/입장 설정을 바꾸지 않았다.
참가자·방과 시험 전달 정리를 확인했지만 별도 청구액, 대규모 복제 참가자 quota와 지연은
측정하지 않았다. 이 API 수락을10방 운영 용량이나 비용 확정으로 확대하지 않는다.

증거는 호스트의 격리 checkout
`/var/lib/jenkins/.local/kkakkung-diagnostics/public-authority-20260913-92fe505c` 아래
`.local/qa/public-authority-1789282484320`에 보존한다. 토큰/자격 원문은 포함하지 않는다.

| 파일                           | SHA256                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| public-authority-evidence.json | `d51acd4df50f58a61b3137e3d4cfc1ab80f5e7a01d7ea0ed3ce57574b63cdf9c` |
| run-summary.json               | `95ae2ca13ec9bd1559b72f3486d7486ee9063e89163a92c599728be1329bd43f` |
| preflight.json                 | `2eba0884177714111f70718999239deaa3af0ffd8e545978fa419a0e2fa4ebcc` |
| devices.json                   | `daa358924bebcd78db6fcf14c6dd318b4a5a7f5db7bf572d76c96540018c1e99` |

판정은 `serverControlledVerified=false`, `publisherControlBypassObserved=true`,
`forwardedIsolationVerified=true`, `candidateAvailable=true`다.
`productPublicReady=false`, `promotionAllowed=false`를 유지한다.

## W02의 다음 구현

수신자를 서버가 지정한 격리 방에 배치하고 필요한 송신자만 전달하는 후보를 제품으로 연결한다.
원본/복제 SID와 세대·정책 revision의 바인딩, 늦은 허용 결과와 재연결 뒤 회수, 수신 차단 기한,
방/참가자/사용량 예약과 durable 복구, 웹의 송수신 연결 수명을 함께 구현해야 한다.
공개 readiness는 실제 새 미디어 수신/차단 관문이 충족된 경우에만 허용한다.
송신자가 협조하는 기존 팀 모드의 성공을 공개 보안 통과로 재사용하지 않는다.

6인 한 경기의 source/receiver 방과 전달 복제 수는 새 설계에서 산정하고 실제 현재 요금제의
동시 자원·호출·사용량과 대조한다. 제품 통합 → 소규모 Cloud 회귀 → 6화면/6대 → 단계 부하
순으로 진행한다. 이 진단은 W01 후보 검증이며 W02/G1/공개 전환 전체 인수가 아니다.
