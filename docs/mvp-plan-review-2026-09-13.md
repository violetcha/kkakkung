# MVP 실행계획 재검토 — 2026-09-13

기준 소스: 원격 develop `dab788ac9e6c205bcdbb800dc8b095b626a7f737`.
상태: 구현 중단 유지, 이번 작업은 문서·코드·기존 검사·운영 상태의 재검토다.
다음 실행의 원본은 [완성 실행계획](mvp-completion-plan.md), 과거 중단 시점은
[중단·재개 기록](mvp-resume-2026-09-13.md), 변경별 실적은 [구현 기록](mvp-implementation-progress.md)이다.

## 1. 결론과 근거의 경계

기본 게임·입력·개인 체험·음량·시설 렌더링은 이미 병합되어 운영에 반영됐다.
완성도 검토 결과는 **MVP 인수 미완료**다. 추가 코드 결함, 미완성 방장 기능,
공개 권한/입장 구현, 실제 장치·Cloud·부하·복원·권리 검증이 남았다.

- 최신 원격 develop을 fetch하고 실제 컨테이너 revision과 Jenkins 결과를 대조했다.
- 읽기 전용 코드 검토는 develop과 파일 차이가 없는 `2bd0fc07` 작업 폴더도 사용했다.
- Jira 192–196의 실제 상태를 조회했다. Jira 완료, 코드 병합, 배포, 제품 인수를 구분했다.
- 기존 FE 검사 15파일 115개, 서버/운영 검사 7파일 88개가 통과했다.
  이는 전체 `pnpm verify` 재실행이나 무결함의 증거가 아니다.
- 메모리 내 조립으로 품질 복원·마이크 취득·운영 감사 호출·경보·G5 판정 결함을 재현했다.
  실제 카메라, 실제 이용자, 새 Cloud 자원은 사용하지 않았다.
- 196 미커밋 초안은 별도 비교했다. 해당 초안의 계약 검사는 실패하며 배포 코드에 포함되지 않는다.

## 2. 배포와 중단 기록의 정정

| 항목               | 확인 결과                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 최신 정상 배포     | Jenkins `kkakkung #96 SUCCESS`, develop `dab788ac`                                                                     |
| 릴리스 기록        | `release.json` READY, 2026-09-13 09:48:16 KST                                                                          |
| 실제 이미지        | game/web 모두 전체 revision `dab788ac9e6c205bcdbb800dc8b095b626a7f737`, 실행 중                                        |
| 배포 장벽          | 이미지 대조·SSO 격리·정상 drain·복구·resume·DP-06·최종 재검사 통과, READY/OPEN, unresolved 0, last-good 기록           |
| 적용 범위          | 193 개인 체험, 194 소리 제어, 195 복구 수정까지 적용. 196 제외                                                         |
| 운영 입장          | `SESSION_ADMISSION_MODE=gitlab-sso`, 프로젝트 팀원 제한 유지                                                           |
| 운영 값 차이       | `ROOM_IDLE_TTL_MS=1800000`: 실제 로비 30분, 승인 정책 10분과 불일치                                                    |
| 실제 API 상한      | normal 120 / total 180회·60초. 코드 최대 허용 600/900과 구분                                                           |
| 컨테이너 자원 상한 | game/web 모두 Docker Memory=0, NanoCpus=0, PidsLimit=null: 컨테이너별 상한 미설정                                      |
| 이전 실패          | #95의 `37e0204e`는 `DP06_SERVER_CLEANUP_FAILED` → SMOKE_FAILED → 이전 `217d69db`로 rollback 성공                       |
| 남은 실패 조사     | #95 서버 정리 블록의 drain·조회·resume 중 어느 동작이 실패했는지 아직 미확정. #96 성공만으로 원인 제거를 단정하지 않음 |

#95 오류는 [DeploymentSmokeHarness](../tests/cloud/DeploymentSmokeHarness.ts) 431–449행의
서버 정리/재개 catch에서 생성된다. 안전한 단계·요청 종결 코드와 API 예산 관측을 보강해
한시 장애와 재발 결함을 구분한다. 로그 원문·토큰·운영 환경 파일은 문서에 옮기지 않는다.

09:43 중단 기록의 “#96 확인 대기”는 당시 사실이다. 현재는 정상 배포 확인이 끝났으므로
다음 작업을 배포 재시도부터 시작하지 않는다. 195의 Jira는 조회 시 여전히 진행 중이다.
정상 배포 증거를 이슈에 반영하고 기존 스토리의 완료 조건을 대조하는 행정 후속이 남는다.
장기 기록 축약은 별도 작업으로 추적하며 195 완료 조건을 끝없이 확대하지 않는다.

## 3. 확인된 문제와 수정 방향

우선순위는 현재 팀 운영과 다음 인수를 기준으로 정했다. R은 기획서 번호, W는 기존 계획 번호다.
아래 K 번호는 이번 감사의 추적 번호이며 Jira 키가 아니다.

| ID·우선순위     | 문제·트리거와 영향                                                                                                                     | 코드 근거                                                                                                                                                                                                                                                                                                                | 수정·완료 조건 / 연결                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| K01 · P1        | 인증 실패 운영 조회마다 내구 감사 쓰기. 일반 팀 계정도 운영 토큰 없이 쓰기·대기열을 증가시킬 수 있음                                   | [bootstrap](../server/src/bootstrap.ts) 325–329·489–504, [OperationsHandlers](../server/src/operations/OperationsHandlers.ts) 86–98, [OperationsAudit](../server/src/operations/OperationsAudit.ts) 297–300, [CheckpointStore](../server/src/operations/CheckpointStore.ts) 141–157                                      | 운영 경로 ingress 분리·파싱 전 빈도/동시 처리·감사 집계/회전. media grants/report도 공통 HTTP 경계에 포함. 정상 6인과 혼합 부하에서 큐·메모리·디스크 증가량 상한 및 Tick 유지. W04/W14     |
| K02 · P1        | RELEASED 예약·과거 방·공유 retry 기록이 누적돼 재기동 회복 비용 증가. 195는 78방 사례 개선                                             | [UsageBudget](../server/src/operations/UsageBudget.ts) 152·270–273, [SharedRetryCheckpoint](../server/src/operations/SharedRetryCheckpoint.ts) 110–124, [RetentionPolicy](../server/src/operations/RetentionPolicy.ts) 26–37, [PreviousGenerationCleanup](../server/src/operations/PreviousGenerationCleanup.ts) 231–362 | 확인된 기록만 축약하는 제품 경로, 누계·미확인 회수 보존, 원자적 파일 교체/복원/단일 writer, 최대 보관량에서 복구 시간·API 예산 인수. W05/W14                                               |
| K03 · P1        | G5에 얼굴 0·음성 false·같은 시작/종료 시각을 넣어도 PASS. 잘못된 실제 인수 선언 가능                                                   | [6대 판정기](../scripts/collect-six-device-results.mjs) 109–110·130–132                                                                                                                                                                                                                                                  | 시각·순서·판 중복·배포 SHA·허용 관계별 영상/음성 양성 관측 검증. 실패/누락/가짜 대조가 PASS 안 되는 회귀. 모든 순간 얼굴 5개를 요구해 시야 정책을 바꾸지 않음. W06/W18 선행                |
| K04 · P1        | 종합 manifest의 PASS·SHA·경로 존재만 믿고 실제 증거 내용 미검사. feature 플래그로 옛 SHA 허용, 빈 디렉터리도 참조 가능                 | [종합 판정기](../scripts/verify-mvp-evidence.mjs) 55–63·87–103·203–207                                                                                                                                                                                                                                                   | schema/result/source SHA/환경/hash/정리 결과를 실제 산출물과 대조, 중복 gate·빈 참조·불일치 거절. continuous/attested와 team/public 분리. 구현을 W20 최종 실행보다 앞당김                  |
| K05 · P2        | 품질 low 선택 후 재경기하면 화면은 low지만 새 Runtime은 medium. 다음 얼굴 송출이 100kbps/10fps로 복귀                                  | [product-runtime](../apps/web/src/app/product-runtime.ts) 423·817, [InteractionRuntime](../apps/web/src/features/input/InteractionRuntime.ts) 555·1343                                                                                                                                                                   | 새 bridge 생성 시 음량과 품질 함께 복원. 3종 재경기·장치/미디어 재생성 후 표시와 다음 게시 옵션 일치. W10/W11/W17                                                                          |
| K06 · P2        | 카메라 없는 체험/카메라 상실 후 마이크만 조작해도 카메라 취득을 시도. 권한 요청과 busy 지연 발생                                       | [interaction-bridge](../apps/web/src/app/interaction-bridge.ts) 118–121, [device-manager](../apps/web/src/features/devices/device-manager.ts) 335                                                                                                                                                                        | 마이크 전용 변경 경로. 카메라 미취득/거부/상실/늦은 응답에서 mic on/off의 새 카메라 요청 0회. 마이크 끄기 자체는 await 전에 적용되므로 음소거 실패로 과장하지 않음. W08/W11                |
| K07 · P2        | API near-limit 임계 810 고정으로 운영 total 180이 소진돼도 경보가 안 뜸                                                                | [AlertPolicy](../server/src/observability/AlertPolicy.ts) 42·151–156, [MediaCoordinator](../server/src/media/MediaCoordinator.ts) 128                                                                                                                                                                                    | 실제 설정 상한 비율로 연결하고 120/180·600/900 양쪽 경보/해제 검사. 외부 경보 전달·수신은 별도 인수. W14                                                                                   |
| K08 · P2        | 재경기 명단이 Schema patch보다 먼저 도착하면 미래 matchId로 버리고 이후 roster=null. 다음 명단 사건 전까지 방장/명단 표시가 비는 경로  | [product-runtime](../apps/web/src/app/product-runtime.ts) 780–802·859–874, [KkakkungRoom](../server/src/rooms/KkakkungRoom.ts) 1173–1174·1343–1347                                                                                                                                                                       | patch 이후 송신 또는 유계 미래 메시지 보관/재동기화 중 일관된 계약 선택. 재경기·순서 역전·중복·옛 명단 거절을 실제 소켓+UI로 검사. 196 room-access와 함께 해결하되 기존 코드 결함으로 구분 |
| K09 · P2        | 최종 RESULT에서 개인 탈출/포획이 팀 결과로 대체됨. 술래 연습에도 지도 교환 안내 표시                                                   | [result-presenter](../apps/web/src/features/game/flow/result-presenter.ts) 15, [ResultScreen](../apps/web/src/features/game/flow/ResultScreen.tsx) 27, [PracticeScreen](../apps/web/src/features/game/flow/PracticeScreen.tsx) 59                                                                                        | 팀 승패/사유와 개인 결과 동시 표시, 도망자만 교환 안내. 승리·패배·시간 종료·중단·개인 종료 후 퇴장 분리. W09/W12                                                                           |
| K10 · 운영 공백 | 회수 identity는 모두 REVOKED인데 조회 sweep만 실패하면 정상 retry-retirement 대상이 없어 잠김에서 재시도 어려움                        | [OperationsBindings](../server/src/operations/OperationsBindings.ts) 160–182, [RecoveryCleanupBindings](../server/src/operations/RecoveryCleanupBindings.ts) 704–714                                                                                                                                                     | 동일 writer·소유권·closed admission 유지한 조회 복구 재실행 및 종결을 설계. sweep 중복·미확인/손상·세대 변경 거절. 최초 기동 예외와 구분. W14                                              |
| K11 · P1        | 연습 종료 후 미디어 회수가 unknown/TIMEOUT이면 MAP_FINALIZING에서 계속 대기. 정상 heartbeat를 유지해도 다음 단계/오류 화면으로 못 나감 | [KkakkungRoom](../server/src/rooms/KkakkungRoom.ts) 776–777·1238–1269, [RoomExpiry](../server/src/session/RoomExpiry.ts) 32–57                                                                                                                                                                                           | 회수 미확인·좌석 보호를 유지하면서 단계 기한 후 ABORTED/복구 안내로 전환. 늦은 confirmed·재경기·퇴장 경합에서 회수 확인 전 새 세대/좌석 사용 금지. W03/W12/W14                             |

K01은 비로그인 인터넷 접근이 허용된다는 의미가 아니다. SSO를 통과한 일반 팀 계정의
애플리케이션 경로가 운영 감사 디스크 작업을 유발한다는 경계 문제다.

K02 산술: 과거 방 N개는 최소 `3N+2`회 원격 확인을 요구한다. N=240이면 722회이며,
total 180/60초에서는 RTT가 0이어도 최소 240초가 필요하다. 현재 recover 180초를 넘으므로
동시성·조회 대기만 개선해서 장기 운영 안정화를 선언할 수 없다.
축약 가능 기한 전 최대 방 수와 Cloud 응답 변동도 함께 설계한다.

K11은 실제 Room·세션·슬롯·RoomExpiry와 합성 미디어 응답을 연결해 재현했다.
6인 연습 종료→회수 unknown/TIMEOUT→정상 heartbeat를 유지하며301초 경과 후에도
MAP_FINALIZING·pending6·abortReason=null이었다. 실제 Cloud/소켓 시험은 아니다.
TEAM_PRACTICE60초와 GAME_LOADING30초 제한은 이미 구현되어 있어 그 단계 전체가 무기한인 것은 아니다.
#95 서버 정리 실패와 같은 원인이라는 증거도 아직 없다.

## 4. 196 중단 초안의 재개 범위

원래 작업 폴더:
`C:/SSAFY/KKAKKUNG/S15P21C204/.local/worktrees/mvp-host-controls-20260913`,
브랜치 `feat/S15P21C204-196-host-controls`, HEAD `dab788ac`.
8개 구현/계약 파일의 미커밋 변경과 별도 문서 기록을 보존했다. 이번 감사에서 수정하지 않았다.

단순 import/UI 연결만 남은 상태가 아니다.

1. [MatchDriver](../server/src/game/MatchDriver.ts) 190–205의 phase 명령 분류에
   ROOM_LOCK/ROOM_KICK가 없다. 초안 명령은 대기 단계 core 경로에서 CANCELED로 끝날 수 있다.
2. 초안 KkakkungRoom의 ROOM_REMOVED_CLOSE_CODE import와 Lobby/ProductApp 연결이 없다.
3. room-access는 patch보다 먼저 도착할 수 있고 클라이언트 phaseChanged 정리가 값을 지운다.
   K08 명단 순서 문제와 함께 match·revision·resync 경계를 정한다.
4. 문서 타입은 새 명령을 CoreCommandType에서 제외하지 않았고 ServerMessages의 room-access도 없다.
   common·fixture·A–F 사본·검사 기대값까지 생산자/소비자와 맞춰야 한다.
5. 실제 잠금/예약/onAuth→onJoin 경합, 옛 방장·비방장·자기/다른 방 강퇴,
   accepted→단일 outcome, 내보내진 장치/미디어 종료·RETIRING 좌석 보존을 검사한다.

완료 범위는 **대기 단계 입장 잠금/해제와 “내보내고 입장 잠금”**이다.
경기 중 강퇴·영구 사용자 차단·게스트/초대 재발급까지 완료한 것으로 계산하지 않는다.
계약 검사 실패 초안을 배포하거나 완료 커밋으로 인계하지 않는다.

## 5. 다음 실행의 구간과 종료 기준

현재는 실행을 멈춘 상태다. 다음 구현 요청 때 아래 순서를 사용한다.
각 묶음은 실제 Jira를 확인해 재사용하거나 새로 만들고, 영역 소유권과 단일 조립자를 정한다.
새 번호를 임의 발급하지 않는다.

| 구간                  | 시작 → 끝                                                                 | 병렬·선행 / 종료 증거                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| S0 상태 재확인        | 최신 develop/작업 폴더 diff/운영 상태 읽기 → 시작 SHA 고정                | #96은 이번에 확인 완료. 새 실패가 없으면 재배포/최초 복구 반복 금지. 196 초안 보존, 195 상태 대조                                     |
| S1-A 운영 안정화      | K01/K02/K07/K10/K11 재현 → HTTP/감사 상한·기록 축약/조회 복구·설정 정합   | B/E/F. 최대 보관량·예산120/180·재시작/중단/복원 회귀, TTL10분 설정과 정상 이용 안내. 자원 상한은 실제 계측 후 설정                    |
| S1-B 방장/FE 안정화   | 196 + K05/K06/K08/K09 → 실제 제품 명령/화면 연결                          | B/C/D. 196 기존 스토리 유지, 독립 FE 수정은 결과 단위로 분리 가능. 계약·실제 소켓·브라우저·verify 후 MR/병합/배포·Jira 상태 각각 확인 |
| S1-C 신뢰할 판정 도구 | K03/K04 실패 fixture → 실제 산출물을 검증하는 G5/종합 판정                | F와 생산자. 허위 PASS 회귀부터 시작. 도구 통과를 G5/G1 통과로 바꾸지 않음                                                             |
| S1-D 공개 권한 조사   | 192 MC-PUBLIC-01 실제 허용/차단 대조 → 구조 선택                          | E/D/F, S1-A~C와 설계 병행. 정식 자격·유계 예산·namespace·실행/정리 확인. 1–2인일 기술 조사 후 불가 시 대안·게임/비용 영향 기록        |
| S2 공개 준비 구현     | W02/06 실제 권한·Cloud 시나리오 + W07 게스트/친구방/단일 audience         | W02는 S1-D 구조 확정 선행. W07 비활성 구현은 병행 가능. W13 안내/문의와 운영 경계 통합. 운영 SSO 계속 유지                            |
| S3 제품 통합          | 실제 0.2 제품 UI 6개로 전체 흐름 → 같은 후보 SHA의 한 판/재경기/장애 회귀 | S1-B·S2의 계약 안정화. 진단 0.1/HTTP stub/합성 카메라 범위를 구분. 모든 BLOCKED 사례의 행동·관측 연결                                 |
| S4 실제 품질 인수     | W18 6대5판 + V5 시각/성능 + 초보·밸런스 → 결함 수정·재검사                | 보강된 판정기, G1/G4 실제 선행, 동일 후보 이미지. 3모델·얼굴5트랙·음성·맵 동시 계측, 중간45/저사양30fps, 실사람 평가                  |
| S5 부하·복원          | 실제 1→3→5→10방 및 외부 백업 복원 → 확인된 상한·회수·운영 경보            | W02/W06/W14 선행, 승인된 비용/부하장치. 60세션 유효동시900초와 rolling600/60초·429=0·지연·Tick 동시 검사                              |
| S6 최종 판정          | 같은 이미지의 격리 public→team 리허설 → 팀 제한을 유지한 완료 보고        | S3~5, 자산/모델 권리·문의·경보 수신 완료. 코드 수정 없이 공개 대상 설정만 전환 가능함을 입증. 실제 공개는 제외                        |

기존 50.5–85인일/5–7주 표는 전체 미구현 범위의 초기 추정이었다.
현재 잔여 견적이나 일정 약속으로 재사용하지 않는다. S1 각 MR의 실제 소요,
S1-D 구조 결과, 실장치/부하 장비 가용성이 확인된 뒤 잔여 구현과 외부 인수 대기를
따로 재산정한다. W01을 모든 UI·운영 작업 뒤로 미루지 않는다.

## 6. 아직 구현 또는 실제 확인이 필요한 부분

- W01/02: 내부 정상 송신자 publisher 허용 목록 예외를 공개 통과로 계산하지 않는다.
  192 도구 병합과 실제 후보 검증·권한 제품 적용은 별개다.
- W06: G1-A/B/C/D, performance, mvp-flow, staged-load, ten-room-integrated는
  preflight 이후 BLOCKED throw가 남아 있다. 공용 harness가 있어도 시나리오 연결이 필요하다.
- W07: 현재 env는 invitation/gitlab-sso뿐이다. team/public 단일 설정은 아직 제안이다.
  단순 SSO 제거로 일반 입장이 완성되지 않는다.
- W08/10/11/16: 개인 체험·필터·오디오·시설 테마는 병합 완료지만 실제 장치 품질 인수는 남았다.
  V5 스크린샷 저장/Canvas 수명 검사를 이미지 비교·공포감 평가라고 보고하지 않는다.
- W13/14: 전송/보관/가공 얼굴의 한계·문의, 외부 경보·백업·복원, 이미지 위험 조치,
  모델 3개 라이선스 pending 해소. 비용 상한·경보 수신자·지원 환경은 실제 값을 확보한다.
- W15/17/18/19: 규칙 단위 회귀, 제품 UI 전체, 실제 사람, 실제 Cloud 부하는 각각 다른 결과다.
  CI의 2,383개·14 E2E나 DP-06 성공으로 전체 관문을 통과 처리하지 않는다.
- W20: MVP 기능 인수·공개 준비·현재 팀원 제한 상태의 분리는 계획이다.
  `MVP_ACCEPTED/PUBLIC_READY/ACCESS_TEAM_ONLY`를 이미 존재하는 제품 필드로 설명하지 않는다.

## 7. 문서 검토와 검증 범위

집계 계획/진행/중단/재검토4문서는 ownership의 F 경로에 등록했다.
기능별 신규 문서7개(audio-controls·failed-startup-recovery·integrated-load-evidence·
media-retention·public-media-authority·rendering-facility·solo-practice)는 기존 ownership에
명시 경로가 없다. 번호별 담당 실행 재개 전에 실제 문서 소유자를 확인해 등록할 후속으로 남기며
이번 검토만으로 구현 경로 소유권을 임의 재배정하지 않는다.

검토는 다음 문서군의 최신 설명·중단 기록·이력·구현 경로를 대조하는 방식으로 진행했다.

| 문서군           | 검토한 자료·처리                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 시작/협업        | AGENTS·CONTRIBUTING·README·collaboration-conventions·architecture, 패키지/서버/infra README와 Jenkins SETUP                                                                        |
| 제품 원본/현행   | spec README/current/decisions, 보관 v0.0.8 HTML 본문과 개정표. DOCX는 동일 원본의 보관본으로 유지하며 재편집/렌더링하지 않음                                                       |
| 전체 계획/이력   | mvp-work-plan, mvp-completion-plan, mvp-implementation-progress, mvp-resume-2026-09-13, prototype-stabilization, verification                                                      |
| 담당 실행        | execution README/common/prompts/audit, A–F 계획과 A–F handoff, ownership 및 계약 types/fixtures/tests. 과거 인계 시점·미통합 기록 보존                                             |
| 플레이/입력/렌더 | solo-practice, audio-controls, rendering-facility, onboarding, media-lifecycle, six-player-test, manual-six-device 양식                                                            |
| 서버/미디어/운영 | protocol, server/docs/protocol의 진단 계약, media-retention, public-media-authority, integrated-load-evidence, testing, deployment, continuous-operations, failed-startup-recovery |
| 자산             | third-party-assets, models README/manifest, 실제 배포 자산 검사 기록. 권리 pending을 완료로 바꾸지 않음                                                                            |

이번 제품 회귀는 읽기 전용 기준 트리에서 아래 기존 검사만 실행했다.

- FE: product-runtime, motion-sample-filter, device-recovery, audio-graph,
  audio-diagnostics, solo, scene, result-screen — 15파일 115개 PASS.
- 서버: session-routes, room-expiry, retention-policy, recovery-cleanup-bindings,
  previous-generation-cleanup-concurrency, generation-retention, integrated-summary — 7파일 88개 PASS.
- 196 초안: check:execution FAIL(타입/공통 사본 불일치). 드라이버 실행 재현 시도는
  해당 작업 폴더의 protocol dist 부재로 시작 전에 실패; 실제 명령 실행 성공으로 기록하지 않음.
- 문서 변경: 문서33개와 소유권JSON1개, 총34파일 Prettier·git diff --check PASS.
  상대 파일/문서 앵커972개를 검사해 누락0을 확인했다.
  `pnpm check:execution` PASS(원본122·활성116·보류6, fixture29·도구11, 공통 사본/소유권 검사 포함).
  도구가 고정 lockfile의358패키지를 로컬 캐시에서 설치했으며 manifest/lockfile 변경은 없다.
  새 제품 테스트나 전체 verify를 실행한 것으로 집계하지 않는다.
- 전체 verify·실제 브라우저 플레이·실장치·새 Cloud·부하·복원은 이번 감사에서 미실행.

제품 소스, Jira 상태, 커밋·푸시·MR·배포를 이번 문서 재검토 때문에 변경하지 않았다.
발견하지 못한 결함이 없다는 보장은 하지 않으며, 다음 인수 단계가 그 불확실성을 줄인다.
