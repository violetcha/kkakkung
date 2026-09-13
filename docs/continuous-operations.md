# 수동 갱신 없는 서비스 운영

관련 Jira: S15P21C204-183. 사용자 결정 D-2026-09-12-01.
현재 대상은 https://j15c204.p.ssafy.io 이며 GitLab SSO와 프로젝트 멤버 제한을 유지한다.

2026-09-13 재검토의 코드 기준은 develop `dab788ac9e6c205bcdbb800dc8b095b626a7f737`이다.
09:48 KST에 Jenkins 제품 배포 #96 SUCCESS, release READY, 운영 READY/OPEN,
게임·웹의 동일 `dab788ac` revision과 DP-06 실제 Cloud PASS를 확인했다.
이는 정상 배포 경로의 현재 결과다. 장기 보관·다방 부하·외부 복원·공개 권한 인수는 남아 있다.
이번 요청에서는 문서만 갱신하며 제품 구현 중단을 유지한다.
[재검토 기록](mvp-plan-review-2026-09-13.md)에 코드 근거와 다음 작업 순서를 둔다.

## 운영 모드

| 구분               | continuous — 상시 서비스                  | attested — 기존 기간 한정 시험                |
| ------------------ | ----------------------------------------- | --------------------------------------------- |
| 선택               | 제품 배포 러너의 기본값                   | 명시적 환경/CLI 선택, 설정 파서의 호환 기본값 |
| 운영 설정          | service-operations.json (version 2)       | runtime-evidence.json (version 1)             |
| 서비스 종료 날짜   | 없음                                      | publicWindow                                  |
| 대시보드 확인 만료 | 사용하지 않음                             | officialBudgetMaxAgeMs                        |
| 잔량 집행          | LiveKit 공급자의 할당량                   | 최신 공식 잔량과 용도별 로컬 예약 상한        |
| 운영 API 잔량      | null, 공식 현재 잔량을 알 수 없음         | 검증된 공식 잔량에서 예약 차감                |
| 예약 해제          | 모든 해당 미디어 세대의 실제 회수 확인 후 | 회수 확인 후 새 공식 checkpoint 대조          |
| DP-06              | 배포 SHA/lock별 자동 계획                 | 승인한 기본 preflight에서 파생                |

이전의 “운영 증거”는 사용자가 Cloud 화면에서 확인한 사용량을 특정 시각에 기록한 자료였다.
시간이 지나면 현재 잔량이라고 신뢰할 수 없으므로 잠갔지만, 상시 서비스에서는 매일 수동 갱신이 필요해졌다.
continuous는 이 자료를 자동으로 갱신한 척하지 않고 서비스 설정과 비용 정책을 분리한다.

[LiveKit의 할당량 문서](https://docs.livekit.io/deploy/admin/quotas-and-limits/)에 따르면
현재 무료 Build 요금제는 할당량이 소진되면 새 요청을 거절하며 매월 1일 초기화한다.
앱은 이 공급자 제한과 현재 Cloud 오류를 따른다.
[RoomService API](https://docs.livekit.io/reference/other/roomservice-api/)에는 월간 청구 잔량 조회가 없으며
방이 비었다는 결과를 월간 잔량으로 환산하지 않는다.
이 구현에는 자동 청구 잔량 조회나 유료 요금제의 금액 상한이 없다.
요금제 변경 시 해당 공급자 비용 정책을 다시 결정해야 한다.

## 한 번 준비할 설정

운영 디렉터리의 service-operations.json은 다음 필드를 갖는다.
실제 값은 비공개 운영 파일로만 보관한다.

- version: 2, operatingMode: continuous, budgetPolicy: provider-quota.
- projectAlias, namespace, cloudHttpOrigin: 실제 전용 프로젝트/namespace와 정확한 HTTPS origin.
- attestationId, checkedBy, checkedAtEpochMs: 이 운영 설정을 확정한 식별자·담당자·시각.
  checkedAt은 월간 사용량 조회 시각이 아니며 시간이 지나도 갱신하지 않는다.
- evidenceRefs.namespaceOwnership: 해당 프로젝트/namespace 사용 근거.
- evidenceRefs.firstInstallation / firstAudit: 최초 설치 또는 감사 초기화가 실제 승인된 경우만 포함.

expiresAtEpochMs와 officialBudget는 이 형식에서 거절한다.
capability-report.json은 실제 SDK 버전·프로젝트·namespace·권한 모드 검사 결과를 유지한다.
SDK/권한 모드를 바꾸면 새 Cloud 검증이 필요하지만 날짜만 바뀌었다고 재작성하지 않는다.

infra/compose.continuous.yaml은 위 두 파일만 읽기 전용으로 마운트한다.
기존 runtime-evidence.json/official-usage-input.json은 롤백용으로 보존한다.
operations 볼륨의 usage-checkpoint·journal·회수·감사 파일과
runtime-firstInstallation-consumed.json / runtime-firstAudit-consumed.json은 그대로 보존한다.
최초 사용 marker가 존재하면 설정 파일의 id를 바꾸거나 재배포해도 초기화 권한을 재사용할 수 없다.
이전 공식 checkpoint와 예약은 삭제·초기화하지 않고 읽어 복구한다.
회수가 끝나지 않은 예약은 계속 잠금과 복구의 대상이다.

파일 변경·누락 감시는 자동으로 실행한다. 이 검사는 매초 파일의 변조 여부를 확인하는 내부 검사이며
사람이 매초 또는 매일 재승인하는 절차가 아니다. 운영 설정 변경은 정상 재배포로 적용한다.

## 배포

제품 배포 러너는 다음 순서로 실행한다.

1. 실제 자격·프로젝트/namespace/origin·capability와 설정 파일을 읽기 전용 검사한다.
2. 검증된 SHA와 현재 pnpm-lock.yaml 해시로 DP-06 계획을 새로 만든다.
   1방·6클라이언트, 최대 600초 시험 + 60초 정리, 합성 미디어 전용이다.
   실행 계획의 유효기간은 30분이며 다음 배포에서는 자동으로 다시 생성한다.
   사람의 과거 확인 시각이나 공식 잔량을 복제하지 않는다.
3. SSO 차단 확인 → 기존 게임 drain → 검증된 이미지 교체 → 복구 → resume →
   실제 Cloud DP-06 → READY/OPEN·미해결 회수 0·운영 모드 일치를 확인한다.
4. 모두 통과한 실제 SHA/digest/운영 모드만 last-good에 기록한다.

사전 검사 예:

```bash
node --import tsx scripts/product-release.mjs \
  --check-only --operating-mode continuous \
  --env-file /opt/kkakkung/production.env \
  --evidence-dir /opt/kkakkung/runtime-evidence \
  --sha "$RELEASE_SHA"
```

PREPARED는 입력 검증이다. 실제 배포 성공은 해당 Jenkins 실행, release.json=READY,
DP-06 report=PASS와 실행 중 이미지 SHA가 일치해야 한다.
서버의 초대 발급·개별 링크 TTL, 1방 6인 제한, 참가 인증, 회수·저널 무결성은 유지한다.
새 도메인으로 옮길 때는 TLS/SSO redirect·허용 Origin·webhook 주소를 해당 도메인에 맞춰 별도로 설정한다.

## 실패와 롤백

재시작 복구는 기록에 남은 방도 최초 참가자 조회·회수·삭제·최종 조회를 수행한다.
전체 방 목록이 비어 있거나 과거 상태가 REVOKED라는 이유로 방별 확인을 생략하지 않는다.
방 조회와 삭제는 한 단계에 최대 4개씩 처리하고 모든 호출에 공유 API 예산을 적용한다.
회수 단계는 순차 처리하며, 진행 중 작업이 모두 끝나야 다음 단계와 checkpoint로 넘어간다.
취소하면 새 작업을 보내지 않고 이미 시작한 작업의 종료를 기다린다.

2026-09-13 배포 #91은 과거 방 78개의 순차 조회 지연으로 복구 대기 180초를 넘겼고,
rollback도 같은 경로에서 제한 시간을 넘었다. 복귀 이미지의 복구 checkpoint는
제한 직후 완료됐다. 동시 처리 상한을 적용한 배포 #92에서는 운영의 분당 total 180회와
복구 바인딩의 1초 queue deadline이 충돌했다. 필요한 236회 중 56회가 대기 중 만료되어
REMOTE_RETIREMENT_UNCONFIRMED로 잠겼고 rollback drain도 실패했다.

과거 방 목록·참가자 조회·방 삭제는 다음 60초 rolling window를 기다릴 수 있도록
queue deadline을 65초로 제한한다. 이 시간은 전송 전 공유 예산 대기에만 적용한다.
참가자 권한 회수와 그 직후 부재 확인의 queue deadline은 1초이며 기존 재시도 기한을 유지한다.
실제 HTTP timeout·취소·전송 시 소유권 확인·API total 제한·READY·회수·무결성 조건은 유지한다.
운영과 같은 normal 120 / total 180 설정을 실제 복구 바인딩에 적용한 로컬 회귀에서
78개 과거 방의 236회 필수 호출이 rolling window를 건너 완료되는지 확인한다.
실제 배포는 release.json, Jenkins 결과, 실행 revision과 준비 시간으로 별도 확인한다.
과거 journal·usage·retry의 안전한 축약은 W14의 별도 작업이며 이 변경으로 보관량이 줄지는 않는다.

후속 수정과 정상 배포 결과도 사건별로 구분한다. S15P21C204-195의 후속 MR !125에는
위 예산 대기와 제한된 최초 기동 복구가 반영됐고, 최신 #96의 정상 배포 성공을 확인했다.
재검토 시 Jira 195는 여전히 진행 중이다. 배포 성공을 Jira 상태 전환으로 간주하지 않는다.
#95는 DP-06의 서버 정리 단계에서 `DP06_SERVER_CLEANUP_FAILED`를 기록한 뒤
정상 rollback했다. 이 코드는 시험 finally의 서버 drain/resume 블록에서 발생하며,
더 세부적인 원인과 재발 조건은 아직 확정하지 않았다. #96 PASS로 #95 실패 기록을 지우거나
일시적 실패였다고 단정하지 않는다.

Cloud 자격 오류·할당량 소진·회수 미확인·기록 손상·이미지 SHA 불일치·시험 실패는 계속 차단한다.
“만료됐으니 숫자만 바꾸기”, 성공 결과 파일 생성, 빈 사용량 원장 재생성으로 해결하지 않는다.
이전 이미지의 매니페스트에 기록한 프로필·운영 모드·공식 잔량 유효기간 정책으로 롤백한다.
이전 attested 배포가 이미 만료되어 정상 복구 조건을 만족하지 못하면 ROLLBACK_BLOCKED다.
코드 검증·MR 병합·배포·실기기 검수 결과를 따로 기록한다.

이전 drain은 성공했고 새 서버는 입장을 열지 못한 최초 기동 실패라면,
[입장 개방 전 최초 기동 실패 복구](failed-startup-recovery.md)의 제한된 명시적 경로를 쓴다.
실행 이미지·기동 시각·신규 발급 없음·확인된 기존 기록·정상 종료·writer 해제·백업을 모두
확인하고 수정 이미지의 전체 복구와 배포 장벽을 다시 통과한다. 일반 drain 차단은 유지한다.

이 자동 시험은 실제 Cloud와 합성 영상/음성을 연결한다. 얼굴·어깨·손 보정과 실제 PC 6대 플레이,
공개 운영의 서버 단독 구독 통제, G5/G6 및 미정 아이템 승인을 대신하지 않는다.

## 다음 운영 보강과 완료 조건

다음은 재검토에서 확인한 후속 작업이다. 현재 구현됐다는 선언이나 운영 설정 변경 명령이 아니다.

| 항목             | 확인 결과와 다음 조건                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 방 체류 설정     | 현재 실행 컨테이너의 `ROOM_IDLE_TTL_MS=1800000`은 로비 30분이다. 승인한 로비 10분 목표와 다른 설정을 정상 변경 절차와 만료·회수 검증으로 맞춰야 한다. DEVICE_CHECK·RESULT·ABORTED의 5분 코드와 구분한다.   |
| API 경보         | 실제 normal 120 / total 180을 유지한다. 현재 AlertPolicy의 near-limit 810은 이 설정에서 발생할 수 없으므로 설정된 상한과 연결해야 한다. 외부 알림은 로그 경보와 별도 미완료다.                             |
| HTTP·감사 보관   | 파싱 전 제한은 세션/매치메이킹 위주다. 운영 인증 실패마다 감사 파일 전체를 쓰는 경로와 미디어 HTTP를 유계화하고 정상 게임과 혼합 부하를 검증한다.                                                          |
| 내구 기록·재시작 | RELEASED 예약·공유 retry·저널·감사 기록의 축약은 제품 경로에 연결되지 않았다. 과거 방 수에 비례하는 복구 호출량과 보관 기간 내 최대 기록량을 함께 설계·검증한다. [보관 기준](media-retention.md)을 따른다. |
| 조회 복구 재시도 | 기존 `retry-retirement`는 특정 UNRESOLVED retirementId를 요구한다. 모든 identity가 REVOKED인 조회 실패는 대응 ID가 없으므로, 같은 writer·기록·소유권을 유지한 조회 재실행 경로와 기한을 별도로 보강한다.   |
| 프로세스 자원    | 현재 게임·웹의 Docker Memory=0, NanoCpus=0, PidsLimit=null을 확인했다. 이는 명시적 메모리·CPU·PID 상한이 없다는 뜻이다. 실제 게임·미디어와 CI 조건에서 상한·과부하·회복을 검증한다.                        |
| 백업·복원        | 최초 기동 복구의 같은 호스트 사본은 외부 백업이 아니다. 저널·checkpoint·설정·최초 사용 marker의 일관된 복원과 단일 writer를 외부 복원 훈련에서 검증한다.                                                   |
| 비용·공개 준비   | 승인된 비용·경보 수신·지원 정책을 기록하고, 실제 권한·장치·부하 인수 전에는 운영 정원을 늘리거나 일반 공개하지 않는다.                                                                                     |

현재 배포 성공, 장기 운영 상한, 실제 부하, 공개 준비를 분리해 보고한다.
최종 종합 판정기는 continuous 운영에 attested의 과거 공식 잔량·공개창 필드를 억지로 채우지 않고,
팀 제한 유지와 공개 준비를 구분하도록 W20에서 보강한다.

## 팀원 접속

현재 도메인의 GitLab 제한은 로그인한 프로젝트 Reporter 이상 멤버에게만 적용된다.
continuous 제품 overlay는 명시적 gitlab-sso 입장 모드를 설정한다.
팀원은 메인 주소에서 닉네임으로 방을 만들고 6자리 방 코드로 참가한다.
운영 초대 링크를 매번 발급할 필요가 없다. 방·좌석·호출 제한과 운영 잠금은 그대로 적용한다.
기본 invitation 및 내부 DP-06은 기존 운영 초대 인증을 사용한다.

SSO 전용 모드 적용 전 호스트 auth_request와 X-SSO-User 덮어쓰기,
web-proxy loopback 바인딩·게임 포트 비공개, 내부 smoke의 X-SSO-User 제거를 확인한다.
SSO 제한을 해제하는 공개 전환은 별도 제품 결정과 입장 정책 검토가 필요하다.
