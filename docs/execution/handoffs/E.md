# E 공개 인계 기록

## 2026-09-13 제품 자동 축약 — S15P21C204-209

- localStage: INTEGRATED. Coordinator 유지보수→journal→현재/과거 retry 소유자→공유 retry→usage를
  연결했다. 모든 회수/정산 뒤24시간·JWT 만료·최대256묶음/분, 누계와 미확인 보호를 유지한다.
- 실제 파일·257묶음·중간 종료·rename 실패·재시작·현재 코디네이터6경기와 새 발급 등4파일101회귀 통과.
  공개 wire나 문서용 타입은 제품 의존성으로 추가하지 않았다.
- 전체 pnpm verify247파일·2,527개·E2E14개 통과. 선행 reader 배포 #103의 last-good 확인.
- blockedOn: writer 원격 검사·실제 배포.24시간 내 과거 방의 조회 최적화,
  실제 다수 방/Cloud·6대·외부 복원과 운영 명령의 장기 requestId 인덱스는 별도다.
  [동작과 장애 순서](../../durable-retention.md)를 따른다.

## 2026-09-13 내구 이력 축약 reader — S15P21C204-209

- localStage: INTEGRATED. 사용량의 선택 aggregate를 읽고 누계를 보존한다.
  신규 서버 예약 ID의 시각 경계로 옛 요청 재사용을 거절하며 공유 retry가 이를 되살리면 실패한다.
  실제 디스크/Coordinator5파일108회귀·타입 검사 통과. 새 aggregate writer는 아직 없다.
- 208 통합 소스 `166d834`의 pnpm verify246파일·2,513개·E2E14개 통과.
- blockedOn: 원격 검사·reader 정상 배포·last-good 이후 제품 축약 경로 연결.
  [저장 형식과 순서](../../durable-retention.md)를 따르며 중간 병합을 K02 완료로 계산하지 않는다.

## 2026-09-13 조회 실패 복구 — S15P21C204-205

- K10의 기존 checkpoint 소비자/생산자를 OperationsController → OperationsBindings →
  RecoveryCleanupBindings → gateway/저널/usage에 연결했다. 공개 명령과 저장 형식은 유지한다.
- 정상 기록의 원격 관측 실패만 closed admission에서 재검증하며 동일 writer·소유권·세대·빈 경기·
  미확인 회수 0 조건을 전송 전후에 확인한다. 일반 기한과 분리한 복구 checkpoint180초,
  중복 sweep/지연 성공 거절, 성공 후 별도 resume를 공통 원본과 사본에 동기화했다.
- localStage: INTEGRATED. 204 통합 pnpm verify245파일·2,491개·E2E14개 통과.
  실제 로컬 파일 구성에서 attested/continuous, 늦은 응답·취소·손상·소유권/세대 변경을 검사했다.
- blockedOn: 원격 CI·MR·실제 배포 확인, K02 장기 보관, 실제 Cloud 장애/장치/부하 인수.
  [조회 재검증](../../recovery-observation.md)과 [구현 기록](../../mvp-implementation-progress.md)을 따른다.

## S15P21C204-174 제출 기준

- Jira: [S15P21C204-174](https://ssafy.atlassian.net/browse/S15P21C204-174), 담당 이주헌, 상위 에픽 S15P21C204-44.
- 제출 브랜치: `feat/S15P21C204-174-livekit-publisher-permissions` → `develop`. 사용자의 스토리 생성·커밋·푸시 요청에 따라 검증된 최종 변경을 제출용 단일 커밋으로 묶었다. 아래 임시 브랜치·Jira 미지정·푸시 미실행 설명은 시험 당시 기록이다.
- 실제 Cloud 시험 원본 SHA `09c2a2912905083f8b817d903c919debe3b5dae2`는 그대로 보존한다. 제출 시 제품 코드·시험 코드·설정이 원본과 동일한지 Git diff로 확인하며 제출 메타데이터만 인계 문서에 추가한다. 이전 로컬 시험 브랜치는 증거 추적용으로 남긴다.
- MR 본문을 제공하며 MR 생성·병합·제품 배포·실제 6대 완주는 별도다.

## 2026-09-11 내부 6인 송신 허용 목록 — 구현·실제 Cloud 통과

- 사용자 승인: “내부 테스트 우선 — 송신 허용 목록 방식 적용”. 정상 팀 송신 앱을 전제로 하는 1방·6인 예외다. 변조된 송신 앱에 대한 서버 단독 통제 또는 공개 운영 통과를 의미하지 않는다. 기본 `server-controlled`의 아래 실패 기록은 유지한다.
- 구현 SHA `09c2a2912905083f8b817d903c919debe3b5dae2`, 브랜치 `codex/livekit-cloud-timeout`. `MEDIA_SUBSCRIPTION_MODE=publisher-permissions`를 명시하고 동일 모드의 capability 보고서가 있어야 발급한다. 다른 프로필의 보고서로 readiness/배포 사전 검사를 통과할 수 없다.
- B/E/D 연결: grant에 프로필을 전달하고 AudioPolicy에 송신자의 전체 Identity·트랙별 허용 목록을 넣는다. 현재 scope·bindingRevision·새 policyRevision만 반영하고, 자기 게시 SID만 SFU에 허용한다. 게시 전 빈 목록, 권위 프레임별 lease 갱신, 1.5초 갱신 중단·재연결·세대 종료 시 철회를 적용한다. 같은 목록 갱신은 SDK 설정 호출을 반복하지 않으며 기존 API 예산을 유지한다.
- `localStage`: **INTEGRATED**. `pnpm verify` 통과: 214파일 2,095시험, 브라우저 E2E 4개, 타입/lint/빌드/실제 모델 Worker 검사. 실제 장치 카메라 시험은 아니다.
- 실제 MC-01 R9: 2026-09-11 10:19:40–10:20:01 KST, 위 구현 SHA, `kkakkung` / `kkakkung-ec2`, **SUPPORTED(publisher-permissions)**. 영상 표식과 660/880/1100Hz 음성 수신, 금지 수신자의 직접 구독 차단, 금지→허용 대조, 허용 철회 후 재구독 차단 통과. 기존·갱신·미입장 토큰 모두 401, 동일 초 발급/회수 및 새 Identity 정상 접속 통과. 19,123ms, 정상 API 4회·정리 17회, 참가자 및 시험 방 부재 확인.
- 원본 증거: 서버 `/opt/kkakkung/preflight-6280538/.local/qa/MC-01-r9/`. 검토/배포 준비용 사본: `/opt/kkakkung/runtime-evidence/MC-01-r9/`, capability 보고서 `/opt/kkakkung/runtime-evidence/capability-report.json`. `capability-evidence.json` SHA-256: `30fc8849cd576d1eabb1e7671031bef858ab785e9513f0fb48fb5dd2e542a6df`. 로컬 사본은 해당 작업 디렉터리 `.local/qa/MC-01-r9/`이며 다른 팀원의 checkout에 있다고 가정하지 않는다.
- `blockedOn`: 이 변경의 develop 반영, Jenkins Secret file의 내부 시험 정책 반영, 공식 잔여 예산·namespace/최초 설치·감사 증거의 최종 운영 파일, 제품 배포 readiness, 실제 6대 연습→경기→종료→재경기. 실제 합성 Cloud 통과를 이들 전체 완료로 확장하지 않는다.
- 사용자 Git 신원으로 로컬 커밋했다. 새 Jira는 미지정이다. GitLab 푸시·MR·원격 병합·제품 배포는 실행하지 않았다. 운영 중 컨테이너와 비밀 환경 파일은 변경하지 않았다.

## 2026-09-11 실제 Cloud 재시험 — 수신 권한 BLOCKED

- 당시 기본 서버 통제 모드의 결과다. 시작 `fdaf8e3af8724143b1d242ccc8ff8bb9d696c436`, 브랜치 `codex/livekit-cloud-timeout`. 새 Jira 미지정으로 기존 스토리 키를 재사용하지 않았다. 사용자 승인 범위는 코드 제한 수정·실제 재시험·통과한 증거와 운영 정책 반영이며 제품 배포는 포함하지 않는다.
- `LiveKitGateway` HTTP 응답 제한을 기본 10초로 변경하고 제품에서는 `operationTimeoutMs`를 전달한다. 대기열 발송 제한과 구독 보안 UNKNOWN 1초, 자동 failover 금지, API 예산, 회수 cutoff는 유지한다.
- `localStage`: 로컬 검사 통과. `pnpm verify`의 214파일 2,089시험, E2E 4개, 빌드·실제 모델 Worker 검사 통과. 이후 Cloud 시험 진단 변경은 QA 타입 검사와 capability harness 36시험으로 추가 확인했다. Worker 검사는 실제 카메라나 실제 6명 시험이 아니다.
- 실제 MC-01 최종 시험 SHA `d63aed24ab20c7fddee3004fd09b32ccb2aa1f9d`, Cloud `kkakkung`, namespace `kkakkung-ec2`. 서버 격리 체크아웃 `/opt/kkakkung/preflight-6280538/.local/qa/MC-01-r5/`의 `run-summary.json`, `capability-evidence.json`, `capability-report.json`이 원본이다. 디렉터리 이름과 최종 시험 SHA는 다르므로 증거의 sourceCommit을 따른다.
- 실제 성공: 방 생성·참가자 연결·게시 트랙 확인, 퇴장 기존/SDK 갱신/미입장 토큰의 재접속 401 거절, 같은 초 발급·회수, 새 Identity 정상 접속, 참가자 회수와 방 삭제 후 부재 확인. 최종 시험 22,471ms, 정상 API 3회·정리 16회. 원본·갱신 토큰은 프로세스/브라우저 메모리에서만 사용한다.
- `blockedOn`: `MC01_RECEPTION_UNCONFIRMED`. `canSubscribe:false` 수신자에게 서버 `updateSubscriptions`가 성공 응답해도 10초 뒤 실제 구독 0개·수신 0 bytes·영상/음성 미검출이다. 연결 true·게시 트랙 2개로 확인됐으며 허용 수신·금지 수신 대조·원격 구독 해제 후 차단 증거는 통과하지 않았다. 독립적인 토큰 회수 통과만으로 전체 SUPPORTED를 만들지 않는다.
- 동일 증상의 [LiveKit 공개 이슈 #4651](https://github.com/livekit/livekit/issues/4651)가 열려 있다. 현 프로젝트의 서버 원인 확정은 아니며 배포된 Cloud 버전/해당 조합 지원 확인이 필요하다. `canSubscribe:true`나 로컬 음소거로 바꿔 통과시킨 것이 아니다. 권한 방식 변경은 B/D와 공개 계약·금지 수신 방어를 함께 재설계하고 실제 재시험해야 한다.
- 시험 한도는 회당 방 1개·Identity 최대 5개·본 시험 240초+정리 60초, 예약 25 participant-min/300 MB이며 이번 3회는 서로 종료·정리를 확인한 뒤 순차 실행했다. 대시보드 최근 30일 표시 0초/0 bytes와 Build 명목 제공량을 관측했고 후속 시험은 앞선 예약 전체를 보수적으로 차감했다. 계정 공유 잔량·보고 지연을 독립 측정한 공식 운영 잔여량으로 승격하지 않는다.
- Nginx 및 SSO 기존 설정은 유지한다. 실패한 capability report를 제품 통과 증거로 배치하지 않았으며 운영 정책은 후보 상태다. 제품 배포·GitLab 푸시·MR·Jira 변경은 하지 않았다. 수신 통과 후 공식 잔여량과 운영 증거를 갱신하고 정책을 적용해야 한다.

전달 기준: [S15P21C204-171](https://ssafy.atlassian.net/browse/S15P21C204-171) · 브랜치 `feat/S15P21C204-171-product-integration` · 병합 대상 `develop`. 로컬 통합 검증 후 사용자 요청으로 스토리 생성·커밋·푸시 및 MR 본문 작성을 진행한다. 아래의 임시 브랜치·미커밋·Jira 미생성 표기는 검증 당시 기록이다. 실제 Cloud·배포 인수와 MR 병합은 별도다.

수정자: **E** · 2026-09-10 · [담당 계획](../e-media-operations.md) · [공통 규칙](../common.md)

이 파일은 팀원 AI가 E의 전체 계획을 다시 읽지 않고 공개 산출물과 요청을 확인하는 장소다. 최신 작업은 위 **2026-09-11 실제 Cloud 재시험**이다. 아래 전체 연결 검증과 S15P21C204-170, E-01~E-16 항목은 당시 검증·인계를 보존하며 과거의 선행 미도착 설명보다 최신 항목을 우선한다. 병합과 최종 기능 인수는 구분한다.

## 2026-09-10 전체 연결 검증

- 사용자 요청: 최신 develop의 A~F 실제 구현 연결과 통합 검증. 시작 SHA는 `d5816f6db20efa1340d229ca18313d53fb017143`, 로컬 브랜치는 `codex/integration-20260910`이다. 이번 통합에 대응하는 별도 Jira는 확인되지 않아 과거 170번을 새 작업의 키로 사용하지 않았다.
- 작업 중 도착한 F-16 `baffe7a`와 F QA `4c84d207f08b9a9bc3fd4497d0e078cd8723176d`까지 로컬 fast-forward한 뒤 통합 변경을 복원했다. 최종 검증 기준은 `4c84d20`과 이번 로컬 변경이며, 앞선 측정은 당시 기준을 별도로 기록한다.
- 이번 실행은 E 단독 소유 범위를 넘어 B/C/D/F 담당별로 통합 수정을 분담했다. 실제 `.env`, 원격 설정, Jira, 푸시, MR, 병합, 배포는 변경하지 않았다.
- B의 제품 진입점이 실제 A 엔진·맵·튜닝, E coordinator·운영·readiness·서명 webhook, F의 명시적 설정·운영 증거 provider를 연결한다. 초대/운영 인증 middleware를 해당 라우트로 제한하고 E 발급은 첫 신뢰 frame 관측 후 진행한다. epoch 초의 정수 절삭도 제거했다.
- C/D는 HTTP 204 정리 응답, 구세대 정리 후 신세대 발급, 종료된 SDK의 전체 교체와 늦게 끝난 연결·게시의 정리를 연결한다. E의 세대·회수·구독·예산 구현을 성공 stub으로 대체하지 않는다.
- C는 연결 중인 세대와 마지막 발급 세대를 따로 보존하여 응답 대기 중 논리 단계가 바뀌어도 다음 발급의 이전 세대 번호를 유지한다. 같은 경기의 일시적인 private view 공백은 복구를 취소하지 않는다. B는 연습 참가자 전원의 발급 결과가 tick에 적용되고 진행 중인 발급이 끝나야 다음 단계로 전환한다. 60초 제한과 정상 장치 미준비 복귀는 유지하고, 발급 결과 불명은 세대를 추측해 이어가지 않는다. 실제 B/E와 HTTP/SDK 회귀에서 초기 grant보다 빠른 PRACTICE_READY와 발급 후 응답 지연을 검증했다.
- F의 `OPS_DATA_DIR/runtime-evidence.json`은 검증된 운영자 증거만 받는다. namespace·최초 설치/감사·공식 사용량 revision이 없으면 LOCKED다. 최초 증거는 용도별 내구성 marker로 한 번만 소비한다. 파일 재확인은 1초 주기·5초 검증 임대이며, 실제 만료·최대 나이·역행·관측된 변경/누락·종료는 차단한다. 이 간격은 초기 운영 정책이며 배포 SLA나 게임 250ms 기준 완화가 아니다.
- 실제 6인 연결에서 GAME_LOADING CPU 지연을 추적해 구독별 readiness의 반복 저널 체크섬·예약 대조를 확인했다. `ReservationReadinessInspector`는 독립 복제한 직전 입력과 현재 입력이 깊은 값 비교로 동일할 때만 순수 대조 결과를 재사용한다. 저널 seq만이나 시간 기반 READY 캐시는 사용하지 않는다. 현재 registry 객체와 pending 객체의 동일성은 매번 확인하며 세대 상태·저널 내용·예약 변경·pending 기한 종료를 즉시 반영한다. 공식 예산/자격/시계/감사/쓰기 가능 여부는 매 조회 다시 검사한다. 기존 및 신규 회귀 2파일 56시험으로 동일 입력 재사용, 변조, 복제된 pending과 동적 잠금을 확인했다.
- Windows에서 관측된 checkpoint 원자 교체의 일시적인 `EPERM`에 대응해 `EPERM/EACCES/EBUSY`만 동일 임시파일로 최대 4회(대기 10/20/40ms) 재시도한다. Linux와 다른 오류는 즉시 실패하고, 재시도 소진 시 기존 checkpoint·임시 증거와 실패 잠금을 유지한다. 삭제·복사 우회나 작업 기한 연장은 없다. 신규 15개를 포함한 6파일 133시험과 strict 타입/lint가 통과했다. 앞선 간헐 발급/감사 실패 2건과 동일 원인이라고 확정하지 않는다.
- 검증 범위와 최종 결과는 [전체 검증 기록](../../verification.md)에 집계한다. 실제 A/B/C/E/F와 6개 SDK의 연습→경기→한 명의 미디어 세대 교체→종료→재경기를 검사한다. 합성 경계는 장치 facade·Cloud 전송·운영 증거이며 실제 Cloud 권한·토큰 회수·카메라·음성 성공이 아니다. 3,600 tick을 IO와 함께 전진시키는 기능 시험이며 실제 180초 부하 시험이 아니다.
- `localStage`: **LOCAL_VERIFIED** — `4c84d20`과 로컬 통합 변경의 `pnpm verify` 통과(209파일 2,038시험·빌드·기존 Playwright 2개). `blockedOn`: 실제 F 승인 자격·공식 예산·namespace/provisioning 증거, MC-01 Cloud 시험, 대표 장치 6대 G5, 배포 환경의 G6. 사용자는 Cloud preflight가 아직 없으므로 로컬 검증을 계속하도록 확정했다. 이 조건 전까지 **ACCEPTED 아님**. MP-06·EQ-06·EQ-07·EQ-08·EQ-09·EQ-12는 계속 PRODUCT_DECISION_PENDING이다.

### B/D/F가 이어서 확인할 경계

- B: 제품 실행은 `SERVER_PROFILE=product`로 명시한다. 미디어 disabled 또는 증거 누락에서는 정상적으로 LOCKED여야 하며 개발 admission을 제품에 적용하지 않는다.
- D: 이번 합성 장치는 InteractionRuntime/LiveKit SDK의 실장치 인수를 대신하지 않는다. 실제 연결·게시·수신·종료 및 복구 기한은 대표 장치에서 확인한다.
- F: `runtime-evidence.json`, capability report, official usage의 실제 근거를 확인한 후 격리 namespace와 승인 예산으로 MC-01/G5/G6를 진행한다. 합성 fixture의 증거·JWT·환경 값을 운영 입력에 복사하지 않는다. `NODE_ENV=production` 차단은 유지한다.

## S15P21C204-170 — 권한·복구 경계와 MC-01 시험 보완

- Jira: [S15P21C204-170](https://ssafy.atlassian.net/browse/S15P21C204-170), E / 이주헌. 사용자 요청에 따라 기존 E 작업의 네 보완 항목을 **한 스토리·한 브랜치**로 처리했다.
- 브랜치: `fix/S15P21C204-170-media-hardening` → `develop`. 구현 commit: `055e51c203d6fd5eeba75e7a5cf7063971441ed9`.
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**. 실제 Cloud 호출은 **0회**이며 실제 권한 지원·옛 JWT 회수·장치 통합의 성공 증거는 만들지 않았다.
- 계약: EXEC-CONTRACT-3 / D-2026-09-08-01. 공개 요청·응답의 필수 필드와 라우트 소유권은 유지한다. B/D의 소비 검토와 F의 실제 시험 인수가 필요하다.

### 수정된 동작과 소비자 주의점

1. readiness가 READY를 잃어 기존 구독의 유효성이 사라지면 `SubscriptionController`가 `onUnknown`을 전달한다. factory는 `POLICY_UNKNOWN` 실패 통지와 해당 세대 원격 회수를 수행한다. 복원 후 같은 세대의 권한을 자동 재개하지 않는다. READY가 유지되는 정상 admission DRAINING은 이 종료 조건에 해당하지 않는다.
2. `lifecycle.report(status:'closed')`는 D의 로컬 정리 확인이다. 최초 recovering/failed의 monotonic 10초는 구세대 원격 회수와 새 요청 사이에도 유지된다. 기한 초과는 TIMEOUT이고 새 토큰은 발급하지 않는다. 이미 치명적 실패/게임 종료가 처리된 경우 factory의 내부 `isRecoveryAllowed`가 타이머를 정리해 뒤늦은 TIMEOUT을 중복 통지하지 않는다.
3. 명확한 예산 예약 거절만 `MediaGenerationRegistry.abandonUnissued()`로 표시한다. 서명·저널 이전의 미발급 시도는 새 match 입장, 참가자 용량, 같은 예약/방 정리를 막지 않는다. 같은 match의 새 요청은 거절 결과의 `receiverGeneration`을 `expectedPreviousGeneration`으로 사용하며 번호를 재사용하지 않는다. 이 시도의 종료 확인은 원격 회수 증거가 아닌 로컬 취소다. 예산 저장 예외·서명 결과 불명·실제 발급 세대에는 이 예외를 적용하지 않는다.
4. [공식 MC-01 시험](../../../server/test/media/capability.cloud.test.ts)과 [합성 브라우저 계측](../../../server/test/media/cloud/capability-browser.ts)을 추가했다. 실제 CAMERA/MICROPHONE 최소 grant, autoSubscribe=false, 허용 수신·직접 구독 차단·같은 수신자의 허용 대조·재차 차단, 미입장/퇴장/SDK 갱신 토큰 재접속 거절을 시험한다. 원격 API ACK만으로 실제 수신이나 토큰 회수를 확정하지 않는다.

### F가 준비한 뒤 실행할 MC-01

비밀값을 문서·명령 인수·로그·브라우저 저장소에 넣지 않고 프로세스 환경으로 주입한다. 다음 여섯 이름이 F preflight의 `credentialEnvNames`에도 있어야 한다: `LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PROJECT_ALIAS`, `SERVICE_NAMESPACE`. HTTPS/WSS의 host가 일치하고 별칭·namespace가 승인된 preflight와 같아야 한다. `.env` 자동 로딩은 하지 않는다.

- F의 `CloudPreflight` 원본 parser를 사용한다. 현재 **최종 HEAD**와 lockfile hash, 유효 기간, 예약/공식 잔여량, 격리 namespace, 합성 deviceManifest와 `.local/qa/` 증거 경로를 확인한다. 추적/미추적 변경이 있는 checkout, DEBUG/PWDEBUG가 활성화된 실행도 거절한다.
- 이 시나리오는 방 1개·합성 Identity 5개를 사용한다. 승인 `maxParticipants >= 5`, `maxDurationSeconds` 60~~300, `cleanupAllowanceSeconds` 30~~120이 필요하다. 최소 예약은 **5 × (승인 실행 초 + 정리 초) / 60 참가자분**, **(승인 실행 초 + 정리 초) × 1,000,000 bytes**다. 공식 잔량을 대신 계산하거나 예약을 임의 생성하지 않는다.
- 실제 본 시험은 승인 시간 이내, 최대 240초로 제한한다. 관리 API는 공통 `LiveKitGateway`/`ApiBudget`을 거쳐 60초 정상 40회·총 60회, 시험 전체 정상 40회·정리 20회 이내다. 명시 cutoff는 매 호출 현재 epoch 초 + 5이며 실제 방 생성 시각으로 계산한 시계 오차 상한도 증거에 남긴다.
- Vite/Chromium 준비가 끝난 뒤 첫 Cloud 요청을 보낸다. 영상 색 표식·음성 주파수·수신 bytes를 계측하고, 갱신 JWT는 고정 SDK 2.22.2의 시험 전용 `EngineEvent.TokenRefreshed` 계측으로 페이지 메모리에만 유지한다. 임의 네트워크 오류나 만료 토큰의 실패를 회수 성공으로 계산하지 않는다.
- 실패/timeout 시 브라우저를 종료하고 정리 예약 범위에서 모든 생성 Identity의 회수·부재를 확인한다. 하나가 실패해도 나머지는 계속 시도한다. 전부 확인된 뒤에만 방을 삭제하며 미확인 결과는 BLOCKED다.

```bash
node scripts/run-cloud-check.mjs --case MC-01 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/MC-01
```

실제 preflight의 `evidenceDir`을 명령과 맞춘다. 자격/예산 미확보는 skip 성공이 아니라 BLOCKED/비정상 종료다. 결과는 `capability-evidence.json`, `capability-report.json`, F runner의 `run-summary.json`이다. 모든 수신·차단·토큰 회수·정리 증거가 있어야 SUPPORTED다. F가 검토 후 보고서를 `OPS_DATA_DIR`에 명시적으로 배치하며 시험기가 제품 설정을 자동 활성화하지 않는다. SDK 근거: [토큰 회수](https://docs.livekit.io/frontends/reference/tokens-grants/), [RoomService API](https://docs.livekit.io/reference/other/roomservice-api/).

### 검증과 남은 인계

- `pnpm verify` exit 0: **87개 파일, 1,128개 시험**, 기존 Room E2E 2개, format/실행 계약/lint/전체 타입/build 통과.
- 추가 시험 파일 5개의 strict NodeNext 타입 검사 통과. Cloud 시험 도구의 로컬 검증에는 공식 runner의 preflight 부재 차단, 증거/예약 거절, 부분 정리 실패, **실제 로컬 Chromium에서 Cloud 연결 없이 계측 페이지 로딩**이 포함된다. 이 결과는 실제 Cloud 합격이 아니다.
- 코드 소유권 검사 14경로 통과. 인계 문서를 포함한 최종 변경도 `node scripts/check-role-scope.mjs --role E --base 45057e166a1fad0f32bf0fe477eacb8bc1fa7931`로 확인한다. 개인 기록/검증 로그/MR 초안은 로컬 `.local/`이며 다른 checkout에 있다고 가정하지 않는다.
- **E170-B-01 / B:** `bootstrap.ts`·Room의 실제 `createMediaCoordinator`/authenticated report/게임 연결 생존/health/운영 조립과 MEDIA_FAILED 큐 반영을 완료한다. 기존 TIMEOUT→MEDIA_UNAVAILABLE, POLICY_UNKNOWN→MEDIA_POLICY_UNCERTAIN 경계를 검증한다.
- **E170-D-01 / D:** `reportMediaStatus` 실제 전달을 연결한다. recovering은 즉시, closed는 진행 중 게시까지 정리한 뒤 정확한 구세대 scope로 보고한다. 구세대 바인딩 거절과 늦은 게시 완료의 보상 정리를 D 소유 파일에서 검증한다. D-01~17 원격 코드가 존재하므로 과거의 “D-17 없음” 문구를 현재 상태로 해석하지 않는다.
- **E170-F-01 / F:** 실제 프로젝트 별칭·공식 예산 예약·격리 namespace·deviceManifest/preflight 및 Chromium 실행 환경을 승인·인계한다. 위 MC-01을 실행하고 증거 검토 후 capability 보고서를 배치한다. Jenkins/컨테이너의 기존 실측과 별도로 E 제품 readiness/단일 writer/권한·회수·복구 실증은 필요하다.

요청은 이 인계 파일에 기록한 것이며 팀원에게 외부 메시지를 보내거나 다른 역할의 파일을 수정하지 않았다.

## E-16 / MC-08 — 미디어 세대 전환과 게임 연결을 유지하는 복구

- Jira: [S15P21C204-150](https://ssafy.atlassian.net/browse/S15P21C204-150).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `3a9838601936873c84d3578a1aa9138da576be83`, 운영 감사/내구 회수 보완 `5e52bfed8240d63e66d103b5bb6cfddf9ebf5a9d`.
- 제출 브랜치: `feat/S15P21C204-150-media-generation-lifecycle` → `develop`. E-15 병합 후 `79e590392a84d929bb56f1dd00b253fb58767cab`에서 새로 분기한 E-16 단일 스토리다. 이전 누적 브랜치는 제출 대상이 아니다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01. 기존 `MediaCoordinator`·`MediaCoordinatorDeps`의 필수 구조는 유지한다. 아래 E 소유 추가 조립/수명 API는 B/D의 소비 검토와 B의 공통 계약 반영이 필요하다.
- 직접 선행 E-05/E-10 및 E-11~E-15 구현은 이 기준 develop에 있다. **D-17의 실제 InteractionRuntime 정리·전환 구현 인계는 아직 없다.** B/D/F 공개 인계는 검증 0건의 양식이며, 현재 B bootstrap은 여전히 개발 skeleton이다.
- blockedOn: B 실제 미디어 HTTP·게임 제어 큐·개별 게임 연결 생존·health/운영/입장 조립 및 추가 API 계약 검토, D-17의 로컬 정리/게시/재연결, F-01/F-05의 실제 Cloud 권한·회수 프로필·namespace 소유권·공식 예산·지속 볼륨/격리 환경, 실제 Cloud/장치 통합 검증.
- E 소유 모듈의 구현과 로컬 연결 검증은 먼저 진행했다. 실제 제품 통합, Cloud 성공, ACCEPTED, Jira 완료와 구분한다. 이번 작업에 푸시·MR 생성·원격 병합·Jira 변경은 포함하지 않는다.

### 전체 factory와 공개 진입점

`server/src/media/MediaCoordinator.ts`는 `createMediaCoordinator(deps, services?)`, `MediaCoordinatorServices`, `MediaCoordinatorRuntime`을 제공한다. 반환값은 기존 `MediaCoordinator` 메서드에 `lifecycle`, bound `isInitialized/canIssue`, `reconcile()`, `createOperationsHandlers(authorize)`를 추가한다. B가 라우트·Room·Tick·HTTP listen을 소유하며, E는 E-05 발급, E-10/E-11 회수, E-12/E-13 복구, E-14 운영, E-15 readiness를 같은 registry·journal·사용량·API 예산으로 조립한다.

1. `deps`는 기존 `MediaCoordinatorDeps` 그대로다. F가 검증한 config, epoch 초/monotonic ms 시계, B의 실제 `getGameActivity`, `enqueueControl`, `enqueueBindings`, `enqueueAudioPolicy`, F의 관측 callback을 전달한다. B의 방·게임 상태를 E callback 안에서 직접 변경하지 않고 기존 제어/송신 큐로 전달한다.
2. `services.mediaMode`, `productSecurityReady`, `namespaceOwnershipConfirmed`는 현재의 검증된 서버 증거를 반환해야 한다. `firstInstallationConfirmed`, `firstAuditConfirmed`는 각각 최초 설치/감사 최초 생성의 외부 근거를 확인한다. `getOfficialRevision(checkpoint)`은 해당 공식 입력과 결합된 실제 periodId/version을 반환한다. 임의 true·빈 디렉터리·현재 시각으로 근거를 만들지 않는다. 생략된 필수 증거는 발급 차단으로 남는다.
3. `services.clientFactory/sign`은 명시적인 로컬 시험 주입점이다. 실제 운영 조립에서 시험 transport나 가짜 서명 함수를 넣어 실제 Cloud 검증으로 계산하지 않는다. 기본 Gateway/SDK와 서명을 사용해도 실제 Cloud 시험 통과를 자동 의미하지 않는다.
4. `initialize()`는 같은 Promise를 공유한다. `OPS_DATA_DIR/capability-report.json`과 로컬 기록을 검사하고, 회수·공식 예산 복구는 초기화 이후 진행한다. `initialBudget`의 예시 잔량을 공식 사용량 증거로 바꾸지 않는다. 공식 입력은 `official-usage-input.json`과 별도 신뢰 revision 검증을 거친다.
5. initialized는 관찰 가능한 RECOVERING/LOCKED와 DRAINING이다. B는 initialized 이후 health/인증 운영/서명 webhook을 열고 fatal 또는 예상 밖 초기화 거절이면 listen 없이 close한다. 복구가 READY가 되어도 운영 resume의 내구 terminal 성공 전까지 OPEN하지 않는다.
6. `createHealthHandlers({getReadiness: () => media.getReadiness(), isInitialized: media.isInitialized})`를 사용한다. B의 초대·새 입장·방 생성·자동 시작은 같은 `media.canIssue`를 await 전후 검사한다. 운영 HTTP는 `media.createOperationsHandlers(createOperatorAuth(검증된OPS_TOKEN))`의 command/snapshot/status를 기존 E-14 경로에 등록한다. 이 함수가 내부의 동일 OperationsAudit와 onAuditFailure 잠금을 연결하므로 B는 별도 감사 저장소를 만들지 않는다. HTTP 밖에서는 `media.getOperations()`를 사용할 수 있다. 스켈레톤 health를 함께 등록하여 응답을 가리지 않는다.
7. `reconcile()`는 E의 유지 루프와 같은 진행 작업을 공유하며 게임 Tick 밖에서 트랙·구독·복구/사용량 상태를 대조한다. 별도 SDK나 별도 API 예산을 추가하지 않는다. 실제 게임 frame은 `observeFrame()`으로만 전달한다.
8. B가 새 요청·외부 producer 접수를 닫은 뒤 `await media.close()`로 종료한다. E는 새 세대 발급/전환/정책을 봉쇄하고 회수·운영·복구의 접수된 로컬 기록을 정리한 뒤 journal writer를 해제한다. 한 하위 종료 오류 때문에 나머지 정리를 생략해서는 안 된다.

아래는 B의 조립 위치에 넣을 호출 순서다. `mediaDeps`, `verifiedServices`, 세션/요청/연결 상태 변수는 **B/F가 실제 구현·검증하여 제공할 값**이며 이 이름의 기존 export가 이미 있다는 뜻이 아니다. 검증된 callback을 전달하며 운영 증거를 true로 채우는 실행 예제가 아니다.

```ts
import { createMediaCoordinator } from './media/MediaCoordinator.js';
import { createHealthHandlers } from './health/HealthHandlers.js';
import { createOperatorAuth } from './operations/OperatorAuth.js';

const media = createMediaCoordinator(mediaDeps, verifiedServices);
const initialized = await media.initialize();
if (initialized.status === 'fatal') {
  await media.close();
  throw new Error(initialized.code);
}
const health = createHealthHandlers({
  getReadiness: () => media.getReadiness(),
  isInitialized: media.isInitialized,
});
const operations = media.createOperationsHandlers(createOperatorAuth(validatedOpsToken));
// B: health/운영/미디어 경로를 등록하고 initialized 이후에만 listen.

media.lifecycle.setGameConnection({
  matchId: serverMatchId,
  playerId: authenticatedPlayerId,
  connected: authoritativeGameConnectionAlive,
});
media.observeFrame(trustedFrame);
const preparation = await media.prepareGeneration(serverPreparedRequest);
// B: preparation과 enqueueControl 결과를 requestId + scope로 중복 제거.

// B: 실제 게임 연결 종료 판정을 받으면 같은 setGameConnection에 판정 결과를 전달.
// B: 새 요청과 producer를 닫은 뒤 await media.close().
```

grant가 기다리는 closed 보고는 **별도의 report HTTP 처리기**에서 아래처럼 전달한다. 위 prepareGeneration의 완료를 기다린 다음 보고를 처리하는 직렬 구조로 만들면 안 된다.

```ts
media.lifecycle.report({ ...validatedMediaReport, playerId: authenticatedPlayerId });
```

### 세대 전환과 D의 로컬 정리 조건

`GenerationTransition.ts`의 `GenerationTransition`은 matchId/playerId별 전환과 회수를 직렬화한다. 동일 requestId의 논리 결과를 공유하며 다른 내용 재사용과 옛 scope 결과를 거절한다. 연습→경기는 phase-change, 같은 미디어 instance의 전체 Identity 교체는 reconnect, 라운드 종료/재경기의 이전 세대 종료는 round-ended로 전달한다.

- 새 발급은 기존 E-10/E-11의 **원격 ACK + 참가자 부재 + 내구 REVOKED**와 D의 **로컬 정리 완료**를 각각 확인한 뒤 진행한다. unknown이면 새 token/grant는 없고 B는 loading/countdown을 진행하면 안 된다.
- `MediaLifecycle.ts`의 `MediaLifecycle`과 `LifecycleReport`는 B를 위한 서버 내부 포트다. `lifecycle.setGameConnection({matchId, playerId, connected})`는 B가 확인한 개별 게임 연결 상태를 받는다. ACTIVE frame이나 activeMatches 합계가 개별 게임 연결 생존 증거를 대신하지 않는다.
- `lifecycle.report({playerId, matchId, mediaInstanceId, receiverGeneration, status})`는 기존 wire `MediaStatusReport`의 `ready|recovering|failed|closed`와 **인증 세션에서 얻은 playerId**를 받는다. B가 요청자가 해당 scope의 소유자인지 검사하고, 서버가 전환 중이라고 기록한 옛 세대의 closed 보고도 정확한 대상에만 전달한다. 클라이언트가 새 generation/playerId/mediaInstanceId를 선택하게 하지 않는다.
- `closed`는 D의 `await retireMediaGeneration()` 완료 후 보내는 로컬 정리 신고다. 해당 이전 세대의 대기를 해제할 뿐 원격 회수·토큰 폐기·권한 성공을 증명하지 않는다. D 정리를 호출했다는 사실이나 `ready` 신고를 두 확인 조건의 대체재로 쓰지 않는다.
- `awaitLocalRetirement`/`hasLocalRetirement`는 E 내부에서 해당 registry 세대 객체에 묶인 로컬 정리 증거를 확인한다. 신호 취소·기한 초과·옛 응답은 새 세대 발급을 허용하지 않는다. B/D가 미연결이면 성공 stub 대신 대기/거절을 유지한다.
- 같은 SDK 연결 안의 짧은 reconnect는 현재 Identity/generation을 유지하며 서버 트랙 대조를 다시 요청한다. 최초 일반 미디어 장애부터 monotonic 10초를 적용하고 반복 recovering/failed 신고로 기한을 늘리지 않는다. ready 신고만으로 해제하지 않으며 장애 이후 동일 Identity/participant SID의 실제 camera 게시 대조를 확인한다. 권한 UNKNOWN의 1초 차단은 이 10초 창과 별개로 우선한다.
- P2 한 명의 전체 교체에서는 P2 receiverGeneration/Identity만 바뀐다. 다른 다섯 명은 자기 receiverGeneration을 유지하고 P2 publisherGeneration/Identity/SID와 자기 bindingRevision만 갱신한다. E는 gameInstanceId나 gameScope.revision을 생성하지 않는다.
- 실제 게임 연결 상실·개인 종료·라운드 종료·close가 시작되면 늦은 prepare/sign/ready/webhook이 새 연결을 되살리지 않아야 한다. 이전 instance의 frame과 현재 instance에서 사라진 참가자의 처리는 현재 권위 scope와 함께 검사한다. 이 경계는 아래 실제 factory 회귀 시험에서 확인했다.

### 정책·회수·예산 조립

`MediaPolicyBindings.ts`는 E-06~E-09의 가청/음향/구독/트랙·서명 webhook을 묶는다. 새 SDK SID는 서버 대조 전 허용하지 않고, 세대 종료 시 해당 수신자·발신자의 오래된 바인딩/정책을 정리한다. D의 로컬 ready를 원격 게시 확인으로 사용하지 않는다.

`SharedRetryCheckpoint.ts`의 `SharedRetryCheckpoint`는 E-13의 이전 부팅 intent와 E-11의 현재 프로세스 intent를 하나의 `revocation-checkpoint.json`에 직렬 병합한다. E-13은 검증된 이전 이력을 받고 E-11은 현재 새 registry에 대응하는 빈 초기 집합에서 시작한다. snapshot에서 빠졌다는 이유로 다른 엔진의 intent를 삭제하지 않으며 lastSeq 최댓값, 신원/세대/예약 불변성, attempt/terminal 진행을 검사한다. 기록 누락/손상을 성공 이력으로 만들지 않고 accepted 쓰기를 배출한 뒤 닫는다.

E-15 readiness의 회수 진행 예외는 실제 현재 registry 객체에 대한 **유계 최초 정상 회수**만 대상으로 한다. 현재 최초 회수의 3초 이내 구간만 인정하고 monotonic 역행도 거절한다. 그동안 해당 플레이어는 terminal/전환 큐로 차단하고 원격 확인을 기다리되 정상 진행 때문에 전체 admission을 자동 DRAINING으로 떨어뜨리지는 않는다. 과거 부팅 이력, UNKNOWN/UNRESOLVED, 실패 재시도·기한 초과는 예외가 아니며 실패 후 자동 OPEN하지 않는다. 정원은 설정된 maxConcurrentParticipants와 내구 회수 기록으로 검사한다. 같은 예약의 모든 세대가 내구 REVOKED여야 점유 종료를 반영하며 공식 사용량 조정 전에는 예약을 해제하지 않는다.

### 실제 검증과 남은 조건

Node 24.19.0 / pnpm 11.19.0에서 `pnpm verify` 전체가 종료 코드 0으로 통과했다. 포맷·실행 계약·lint/경계·workspace 타입·빌드, **80개 시험 파일 1,008개 시험**, 기존 Room 브라우저 E2E **2개**를 포함한다. 최종 로그는 이번 작업 폴더 `.local/execution/E-16-verify.log`에 보존한다. 중간 편집 중 실행에서 시험 fixture 초기화 오류를 발견해 수정했고 최종 고정 상태에서 전체 검사를 다시 통과했다.

- E-16 추가 회귀 **141개**: 전환 43, 수명 31, 정책 조립 16, 전체 factory 24, 공유 retry checkpoint 20, readiness 예약 대조 7. 마지막 파일은 기존 18개에 7개를 추가했다.
- 실제 factory 시험은 E-12/E-13 로컬 복구·E-14 resume·E-15 READY/OPEN·실제 로컬 JWT 서명·원격 회수 adapter·D 신고 포트를 연결한다. 원격 ACK와 D closed의 양쪽 장벽, 6명 중 1명 교체, 이전 match 정리, 구 frame·누락 참가자·정원·예산 갱신 실패·서명 중 종료·요청별 회수 결과·마지막 Identity 확인 뒤 방 삭제를 검사했다. 추가로 실제 loopback 운영 HTTP와 동일 감사 저장소의 이벤트/명령 공존, 감사 실패 잠금, 원격·로컬 ACK 뒤 REVOKED 저장 대기 중 재경기 차단을 검증했다.
- 새로 발급할 토큰의 만료 검사는 유지한다. 기존 검증된 연결은 사용량 예약을 갱신하고, 미입장/부재인 만료 세대는 회수한다. JWT 초기 접속 만료와 연결 수명의 구분은 [LiveKit 공식 문서](https://docs.livekit.io/frontends/reference/tokens-grants/)와 기존 E-02/E-05 계약으로 확인했으며 5분 이후 연결/사용량 유지 및 만료된 grant 재응답 거절을 시험했다.
- 신규·수정 시험 6개 파일 strict NodeNext 타입 검사 통과. E 소유권 검사와 문서 포맷·링크·실행 계약, `git diff --check`도 확인했다. 외부 소유 manifest/lockfile/config/라우트/공통 계약은 수정하지 않았다.
- 기존 설치 의존성을 재사용하여 workspace 구조 경고가 남지만 이 작업 폴더의 protocol/game-core 링크를 사용한다. 기존 web 청크 크기·THREE.Clock·색상 환경 경고는 실패가 아니며 변경하지 않았다.

로컬 시험은 실제 E 모듈·디스크를 연결하고 **Cloud transport, B/D caller, 공식 잔량·namespace 소유권·최초 설치·운영 증거는 명시적 fixture**로 제공한다. 실제 Cloud 호출은 이번 작업에서 **0회**다. 실제 장치 게시/수신·옛 토큰 재입장 거절·연습→경기→종료→재경기·격리 배포/볼륨 장애는 **미실행**이며 최종 인수는 BLOCKED다. 공식 Cloud 자격/예산/시험 환경과 실제 B/D 소비자가 도착하면 그 경계의 회귀를 별도로 수행해야 한다.

### 다른 소유자에게 요청

- **E16-B-01 / B / `server/src/bootstrap.ts`, `server/src/session/`, `server/src/rooms/`, `server/src/game/`:** 전체 factory의 initialize/listen/close, 같은 canIssue와 운영/health, 실제 활동 집계·개별 게임 연결 생존을 조립한다. `/api/media/grants`는 인증 세션/phase에서 requestId·playerId·mediaInstanceId·expectedPreviousGeneration을 결정한다. `/api/media/report`는 현재 또는 서버가 회수 중인 이전 scope를 검증한 뒤 lifecycle에 전달한다. `/api/livekit/webhook`은 JSON 재직렬화 없이 raw body/Authorization을 E에 전달한다. 세션 Bearer·OPS_TOKEN·webhook 서명을 혼용하지 않는다. 확인: 실제 B HTTP/Room 통합 시험과 `pnpm verify`, 인계 commit/결과.
- **E16-B-02 / B / `server/src/game/ports.ts`, `docs/execution/common.md`, `docs/execution/contracts/`, 관련 protocol/소비 경계:** 기존 EXEC-CONTRACT-3 필수 형태를 유지한 E 추가 `MediaCoordinatorServices`와 `MediaCoordinatorRuntime.lifecycle/isInitialized/canIssue/reconcile/createOperationsHandlers` 소비 계약을 검토하여 공통 원본·타입·fixture에 일관되게 반영한다. 현재 E만 원본을 바꾸지 않았다. `MEDIA_PREPARED/MEDIA_RETIRED`는 requestId와 전체 scope로 중복/구세대를 제거하고, `MEDIA_FAILED`는 eventId와 scope로 제거한다. **TIMEOUT → ABORT_MATCH의 MEDIA_UNAVAILABLE, POLICY_UNKNOWN → MEDIA_POLICY_UNCERTAIN**을 B 제어 큐에서 매핑한다. 기타 실패 코드의 loading/countdown 차단도 실제 경로로 확인한다. ready grant는 게시 완료가 아니므로 현재 self faceTrackSid와 LOAD_READY를 함께 확인한다. 확인: `pnpm check:execution`, B/E/D 계약 소비 시험, 실제 queue/Room 회귀 및 구현 SHA.
- **E16-D-01 / D / D-17, `apps/web/src/features/media/`·InteractionRuntime:** `retireMediaGeneration()`의 기존 트랙·구독·재생 그래프·video element 정리 완료 후 정확한 이전 MediaScope로 closed를 보고하고 새 grant 연결을 시작한다. C의 texture 정리 callback도 보존한다. SDK 내 reconnect와 전체 Identity 교체를 구분하고 recovering/failed/ready를 현재 세대에만 보고한다. 이전 ready/grant/FaceTrackEvent가 새 세대를 열거나 닫지 않는 실제 소비 시험, 한 명만 교체할 때 나머지 다섯 명 세대가 유지되는 증거와 인계 SHA를 제공한다. 확인: D 담당 미디어 수명 시험과 `pnpm verify`, B/E와 실제 브라우저 연결 시험.
- **E16-F-01 / F / F-01·F-05·QA-06/QA-07, `server/src/config/`, `infra/`, `tests/`, `server/src/observability/`:** 실제 Cloud capability/회수 프로필·namespace 소유권·공식 예산과 기간/버전·격리된 시험 대상/시간 창·최초 설치/감사 생성 증거를 인계한다. 같은 지속 볼륨과 writer 아래 journal/usage/retry/cleanup/audit를 검증한다. 실제 토큰 재입장 거절, 새 SID·동일 SID replaceTrack·한 명 전체 교체, 429/UNKNOWN/재부팅·disk 실패·예약 조정을 회귀하고 안전한 지표/결과만 남긴다. Cloud 자격만 있다는 이유로 예산 전제를 생략하지 않는다. 확인: F가 인계할 격리 Cloud/배포 시험 명령과 실제 결과·commit. 새 패키지/lockfile 변경 요청은 없다.

공유 코드와 최종 시험·이 인계는 E-16 MR에 포함한다. `.local/`에는 개인 진행 기록과 복사용 작업별/합본 MR 본문을 두며 다른 팀원에게 이 디렉터리가 있다고 가정하지 않는다. 원격 제출과 병합은 사용자가 별도로 진행하고 실제 통합 인수는 각 선행 증거를 확인한 후 갱신한다.

## E-15 / OP-08 — live·ready와 공통 입장·발급 장벽

- Jira: [S15P21C204-149](https://ssafy.atlassian.net/browse/S15P21C204-149).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `068e4b0bef8c83db74aaf9cffd16ea307a4748ee`.
- 제출 브랜치: `feat/S15P21C204-149-product-readiness` → `develop`. E-14 MR !33 병합 후 `7e6489bfea2569d7c3f5a8d9fc8c3081085dadb5`에서 새로 분기했다. 예전 누적 `feat/S15P21C204-149-health-readiness`는 이번 제출 대상이 아니다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01.
- blockedOn: B 실제 health/운영 라우트·제품 인증/입장/자동 시작·활동 집계 조립, F-05 지속 볼륨/단일 쓰기자와 공식 Cloud·예산·운영 입력 증거, E-16 전체 MediaCoordinator 조립과 D-17 세대 전환, 실제 Cloud/격리 배포 검증.
- E-15의 독립 구현은 B/D의 전체 완료를 선행으로 요구하지 않는다. F-05의 실제 환경 인수가 없으므로 로컬 시험을 배포 완료로 계산하지 않는다. 이번에 E-16·푸시·MR 생성·원격 병합·Jira 변경은 하지 않았다.

- 이후 사용자 요청으로 `143f6ace773a2c8627e5c36b0810de97c9216f57`까지 푸시했고 사용자가 MR !37을 develop에 병합했다(`79e590392a84d929bb56f1dd00b253fb58767cab`, squash `cd791f483eb9d8ff1970e7fd1854e725917f2aea`). 제출한 E 코드·시험·인계와 병합 결과가 동일함을 확인했다. E-16 전체 factory와 새 소비 요청은 위 최신 인계를 우선하며 이 항목의 후속 대기는 당시 상태다.

### 공개 API와 연결 순서

`server/src/health/Readiness.ts`는 `ReadinessGate`, `ReadinessGateOptions`, `sanitizeReadiness`를 제공한다. `ReadinessRuntime.ts`의 `createReadinessRuntime(options)`는 기존 E-12 복구, E-14 운영 제어, E-05 발급기와 E-03 예약을 같은 판정으로 연결한다. **이 factory는 E-15 조립이며 전체 createMediaCoordinator의 구현 완료가 아니다.** E-16의 전환 큐와 B/D의 실제 이벤트 연결은 별도다.

1. 기존 `OperationJournal`, `UsageCheckpoint/UsageBudget`, retry/cleanup 체크포인트, `OperationsAudit`, `MediaGenerationRegistry`를 공유한다. 체크포인트와 감사의 isWritable은 같은 journal.writable을 참조한다. 다른 writer나 SDK/API 예산을 추가하지 않는다. UsageBudget 생성 시 `canIssue: () => ({ allowed: runtime?.canIssue() ?? false })`처럼 아직 factory가 없으면 거절하는 참조를 연결한다.
2. 기존 E-12 `createRecoveryBootstrap`에 registry.serverEpoch를 공유하고 E-13의 `beginCleanup: input => cleanup.run(input)`, `closeCleanup: () => cleanup.close()`, `onReport → state.completeCleanup/refreshBudget`를 연결한다. 최초 설치·namespace 소유권·감사 최초 생성 증거는 F가 확인한 실제 근거만 사용한다. 빈 디렉터리나 빈 Cloud 목록에서 true를 추정하지 않는다.
3. `createReadinessRuntime`에는 같은 config/recovery/registry/journal/usageBudget/audit/retryCheckpoint/cleanupCheckpoint, 기존 E-11/E-13 retries, recoveryCleanup, epoch/monotonic 시계, B getGameActivity와 정확한 공식 입력의 getOfficialRevision을 전달한다. `mediaMode()`는 F가 검증한 실제 운영 모드(`cloud|disabled|mock|null`), `productSecurityReady()`는 B의 현재 인증·입장 보호 확인, `namespaceOwnershipConfirmed()`와 `capability()`는 검증된 증거를 반환한다. config.productSecurityReady와 동적 확인을 모두 요구하며 환경의 임의 true로 충족하지 않는다.
4. `await runtime.initialize()`는 로컬 복구·감사 복원까지만 기다린다. Cloud 정리는 기다리지 않는다. initialized는 DRAINING과 RECOVERING/LOCKED를 반환한다. 감사 손상도 health로 관찰 가능한 initialized/LOCKED이며 발급과 운영 변경은 차단한다. fatal WRITER_CONFLICT/INITIALIZATION_FAILED에는 B가 listen/health를 열지 않는다.
5. `createHealthHandlers({getReadiness: runtime.getReadiness, isInitialized: runtime.isInitialized})`의 live/ready를 **B가** GET `/health/live`, GET `/health/ready`에 등록한다. 초기화 전에는 두 핸들러가 503, initialized 이후 live는 복구 상태와 독립적으로 200이다. ready는 검증된 READY에만 200, 나머지는 503이다. 모든 응답은 no-store이고 state와 고정 reasonCodes만 공개한다.
6. B `InviteStore.operationsReady`, 방 생성·입장·자동 시작의 await 전후와 UsageBudget.canIssue는 **runtime.canIssue**를 사용한다. 운영 HTTP에는 runtime.getOperations()와 E-14 핸들러를 연결한다. ready 상태와 admission은 별개이며 신규 발급은 READY + OPEN을 요구한다.
7. E-16 조립자는 `runtime.createGrantIssuer({retire,onPrepared,sign?})`로 기존 E-05 발급기를 한 번만 만든다. retire/onPrepared는 실제 회수/게임 제어 큐에 연결한다. sign 생략 시 기존 SDK의 실제 로컬 JWT 서명을 사용한다. runtime이 같은 usageLease로 예약하고 PREPARED를 내구 기록한 다음에만 발급기가 서명한다. 세대 전환·구 세대 회수 순서는 E-16이 추가하며 이 함수 자체가 전환을 구현하지 않는다.
8. 종료 시 B가 새 요청을 닫고 E 조립자가 **runtime.close → 기존 E-11/E-13 종료 → RecoveryBootstrap.close** 순서로 진행한다. runtime.close는 발급을 봉쇄하고 운영/감사 쓰기를 배출하지만 주입받은 registry/복구/저널의 전체 수명을 대신 소유하지 않는다. 마지막 복구 종료가 usage/retry/cleanup 저장을 기다리고 journal writer를 해제하도록 기존 closeCleanup 연결을 유지한다. 최종 Gateway/API 예산과 registry 종료도 E-16 전체 coordinator 소유자가 처리한다.

### 판정과 실패 경계

- 저널 무결·현재 쓰기·단일 writer, 복구 이력과 이전 세대 회수, 현재 공식 예산의 프로젝트/신선도·예약 정합, retry/cleanup/감사 저장소, 실제 cloud 모드·제품 인증·namespace 소유권·검증된 권한 프로필을 모두 확인한다. SDK 버전·프로젝트·namespace·미래 시험 시각 또는 불완전한 권한 증거도 거절한다.
- `ReservationReadiness.ts`의 `inspectReservationReadiness`는 현재 durable 저널과 예약·registry를 대조한다. 현재 정상 PREPARED는 미회수로 세지 않는다. 이전 epoch, REVOKING/UNRESOLVED, 종료 세대의 모순된 예약과 orphan 예약은 차단한다.
- 예약 fsync → PREPARED fsync 사이에는 **발급기가 실제 추적 중인 동일 registry 객체**만 일시적 예외다. 단순히 메모리에 할당된 객체나 사본은 예외가 아니다. 실패/기록 완료 시 추적을 해제하고 토큰은 PREPARED 기록 이후에만 발급한다. 이 구간의 예산이 이미 디스크에 남았으면 실패를 이유로 예약을 삭제하지 않는다.
- 정상 drain은 READY를 유지하면서 admission만 DRAINING으로 바꾼다. 복구 완료·증거 회복·첫 설치가 OPEN을 만들지 않는다. 검증된 새 resume의 내구 terminal succeeded 이후에만 OPEN이다. 과거 succeeded 요청 재전송은 입장을 다시 열지 않는다.
- 현재 시각으로 공식 잔량을 다시 검사하고 예약 총액이 공식 잔량보다 크면 잠근다. 런타임 저장/감사 실패는 영구 잠금으로 남는다. 일시적인 보안/Cloud/예산 조건이 회복되어도 OPEN은 자동 복구되지 않는다.
- F의 disabled/mock production 시작 차단을 변경하지 않았다. B 현재 bootstrap의 스켈레톤 health는 이 제품 핸들러와 별개이며 실제 교체를 완료한 것으로 표시하지 않는다.

### 실제 검증과 남은 조건

Node 24.19.0 / pnpm 11.19.0에서 `pnpm verify` 전체가 종료 코드 0으로 통과했다. 포맷·실행 계약·lint/경계·workspace 타입·빌드, 75개 시험 파일 **867개 시험**, 기존 Room 브라우저 E2E **2개**를 포함한다. 로그는 작업 폴더 `.local/execution/E-15-verify.log`에 보존한다. 기존 설치 의존성을 재사용하고 workspace 패키지 링크는 이번 브랜치로 연결했다. manifest/lockfile 변경은 없으며 기존 node_modules 구조·web 청크 크기·THREE.Clock·색상 환경 경고가 남는다.

신규 시험은 공개 HTTP 30개, 예약 대조 18개, 실제 로컬 복구/운영/초대/발급 통합 25개로 **73개**다. 초기화 후 복구 대기, 명시적 resume과 정상 drain, 두 참가자의 공유 예약·서명, 5개 저장소의 쓰기 불가, 감사 손상, 과거 미회수 Identity, 공식 예산 누락/시간/과다 예약, 단일 writer 충돌, 서명 대기 중 저장 실패를 확인했다. 신규 시험 파일의 strict NodeNext 타입 검사와 E 소유권 검사도 통과했다.

외부 Cloud 권한·namespace/최초 설치·공식 잔량·운영 모드, B 보안/활동 상태, retire/onPrepared 콜백, E-13 정리 보고서는 명시적인 로컬 fixture 또는 spy다. 실제 저널·사용량·복구 상태·운영 제어·InviteStore·GrantIssuer를 사용했으며 이번 E-15 시험이 실제 RecoveryCleanupBindings의 Cloud 정리를 실행한 것은 아니다. 실제 Cloud 호출은 **0회**이며 토큰 원문을 인계에 기록하지 않았다. 실제 B bootstrap에서 연습→경기→종료→재경기, F의 Docker/지속 볼륨·격리 배포, 실제 장치/Cloud 권한 회귀는 미실행이다. 이 테스트 통과는 ACCEPTED나 Jira 완료가 아니다.

### 다른 소유자에게 요청

- **E15-B-01 / B / server/src/bootstrap.ts·session·rooms·game:** initialized 이후 위 health/운영 경로를 등록하고 fatal에는 listen하지 않는다. 기존 스켈레톤 health와 제품 응답을 중복 등록하지 않는다. 실제 제품 인증/입장 보호 상태·getGameActivity와 공통 canIssue를 초대/방 생성/입장/자동 시작에 연결한다. 정상 drain READY/DRAINING, Cloud 대기 live200/ready503, 늦은 resume·입장 경합·동적 실패 거절을 실제 서버로 시험하여 SHA/결과를 인계한다. 확인 명령은 pnpm verify 및 실제 HTTP/Room 통합 시험이다.
- **E15-F-01 / F / server/src/config/·infra/·tests:** F-05의 실제 지속 볼륨/단일 호스트·단일 writer, 같은 볼륨의 journal/usage/retry/cleanup/audit, 공식 잔량/기간/버전·Cloud capability·namespace 소유권·최초 생성 증거와 검증된 모드 export를 인계한다. 현재 compose의 ready healthcheck를 무한 재시작으로 연결하지 말고 live/ready 용도를 구분한다. disabled/mock production 차단을 유지한 채 격리 smoke·재시작·disk 오류·회수 실패로 QA-05/DP-06을 확인한다. 패키지/lockfile 변경 요청은 없다.
- **E-16 / B/D:** D-17 공개 연결이 도착하면 이번 runtime의 같은 getReadiness/canIssue/getOperations와 bound GrantIssuer를 전체 MediaCoordinator에 연결한다. 실제 세대 전환·재경기·권한 회수 검증 후 B에 인계한다. E-15 구현 완료를 기다리는 동안 D의 다른 독립 구현을 막지 않는다.

## E-14 / OP-07 — 제한 공개창과 운영 제어

- Jira: [S15P21C204-148](https://ssafy.atlassian.net/browse/S15P21C204-148).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `0a289b329efcad7511c15da92418f013eb24aaaa`.
- 제출 브랜치: `feat/S15P21C204-148-operator-commands` → `develop`. E-13 MR !27 병합 후 `56d9691114f4b7919b81c00a27773871c78ba671`에서 분기했다. 예전 누적 `feat/S15P21C204-148-operations-control`은 이번 제출 대상이 아니다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01.
- blockedOn: B 실제 운영 라우트/HTTP 공통 경계·활동 집계·입장 조립, F OPS_TOKEN/공개창·공식 잔량과 revision 근거·감사 이력 최초 생성 증빙/지속 볼륨, E-15 전체 product readiness/factory, 실제 Cloud/격리 배포 검증.
- 이번 실행은 E-14 하나다. E-15~E-16 구현·푸시·MR 생성·원격 병합·Jira 변경은 하지 않았다. 사용자가 병합한 뒤 최신 develop에서 E-15를 시작한다.
- 이후 사용자 요청으로 `586070d6a077259df0691429a899f578bfa786d4`까지 푸시했고 사용자가 MR !33을 develop에 병합했다(`7e6489bfea2569d7c3f5a8d9fc8c3081085dadb5`, squash `b23f9ed28f3ea8e787ff5f5b2f8aca9f8c3a8d4f`). 제출한 E 코드·시험·인계와 병합 결과가 동일함을 확인했다. E-15 최신 연결은 위 인계를 우선하며 이 항목의 후속 대기는 당시 상태다.

### 공개 API와 조립 순서

1. `server/src/operations/OperatorAuth.ts`의 `createOperatorAuth(OPS_TOKEN)`을 B가 생성한다. 비어 있거나 잘못된 token/Authorization은 거절하고, 유효한 동일 길이 토큰만 timingSafeEqual로 비교한다. OPS_TOKEN은 HTTP body·protocol·로그에 전달하지 않는다.
2. `OperationsAudit.ts`의 `OperationsAudit({opsDataDir, nowEpochMs, isWritable: () => journal.writable, actorAlias?, allowMissingHistory?})`는 같은 writer 아래 `operations-audit.json`을 저장한다. 이력 누락의 기본값은 차단이다. `allowMissingHistory`는 과거 운영 명령이 없는 최초 생성의 외부 증거를 소유자가 확인했을 때만 true로 주입하며 빈 디렉터리만으로 판단하지 않는다.
3. `OperationsBindings.ts`의 `OperationsBindings(options)`에 기존 journal·UsageBudget·동일 E-11/E-13 retry 엔진들, 필요 시 RecoveryCleanupBindings, F 검증 config, 시계, 실제 `getGameActivity`, **E-15의 전체 product getReadiness**를 주입한다. `getOfficialRevision(checkpoint)`은 해당 공식 입력의 검증된 periodId/version을 서버 내부에서 반환한다. 중앙 6필드 OfficialBudgetCheckpoint나 클라이언트 명령에 revision 필드를 추가하지 않는다. 임의 기간·현재 시각으로 revision을 만들지 않는다.
4. `OperationsController.ts`의 `OperationsController(options)`에 bindings의 `setAdmission/getStatus/canResume/canComplete/run`, 같은 감사 저장소, epoch/monotonic 시계, `config.operationTimeoutMs`를 연결한다. run은 `(command, signal, beforeDispatch)`를 모두 전달한다. 클래스 메서드는 화살표 함수나 `.bind(bindings)`로 감싸 this를 유지한다(예: `run: (command, signal, guard) => bindings.run(command, signal, guard)`). journal/usage/recovery를 먼저 초기화하고 `initializeAudit()`를 기다린 다음 OperationsPort를 공개한다. 감사 초기화 실패에는 OPEN으로 진행하지 않는다.
5. `getOperations()`는 이 Controller의 `submit/getSnapshot/getStatus`를 위임한다. `submit`은 동기 accepted+snapshot 또는 conflict+REQUEST_ID_CONFLICT다. `parseOperationsCommand`/`validateOperationsCommand`, `isOperationsRequestId`를 공통 strict 검사에 사용한다. 모르는 필드/action, retry-retirement의 retirementId 누락·다른 action의 retirementId는 거절한다.
6. `OperationsHandlers.ts`의 `createOperationsHandlers({authorize, operations, audit, onAuditFailure})`는 Express RequestHandler `command/snapshot/status`를 반환한다. B가 POST `/api/operations/commands`, GET `/api/operations/commands/:requestId`, GET `/api/operations/status`에 각각 등록한다. 인증 오류 403, schema 오류 400, accepted 202, 다른 body 재사용 409, 없는 조회 404, 내부 실패 고정 503을 반환하며 no-store와 응답 필드 제한을 적용한다.
7. 실제 HTTP에서는 **B가 JSON parser 앞 공통 인증·no-store 경계와 JSON 오류 처리도 조립**한다. 핸들러에 도달하기 전의 깨진 원시 JSON을 이 모듈이 처리했다고 계산하지 않는다. B 기존 InvitationRoutes의 인증 오류 401 분기와 운영 공통 경계의 403 정책도 실제 조립에서 대조한다.
8. B `InviteStore.operationsReady`, 입장/방 생성/자동 시작의 await 전후, E GrantIssuer·UsageBudget의 canIssue는 같은 `bindings.canIssue()`를 참조한다. 실제 InviteStore와 GrantIssuer 소비 시험은 이번에 연결했지만 B의 실제 Room 집계·서버 부팅 연결은 아직 없다.

### 명령의 완료와 실패 경계

- **drain:** submit 안에서 admission=DRAINING을 먼저 적용한다. activeMatches/activePractices/pendingAdmissions가 모두 검증 가능한 0이고, 현재 내구 저널의 모든 세대가 REVOKED이며 회수·저장·이력 확인이 충족돼야 성공한다. 이미 진행 중인 게임/연습을 강제 종료하지 않는다. AWAITING_OFFICIAL 예약은 남아 있어도 drain이 완료될 수 있지만 예약 해제나 배포 성공을 뜻하지 않는다.
- **resume:** 보통의 DRAINING과 readiness를 구분한다. 공개창 [opensAt, closesAt), 제품 인증·전체 READY/historyComplete·미해결 0·정상 저널/공식 예산·양수 가용량을 확인한다. 시간 초과된 공식 입력 저장이 아직 진행 중이면 재개하지 않는다. 저장 후에도 다시 검사하며, 창이 닫힌 뒤 타이머가 늦어도 다음 입장 검사에서 차단한다. 실패 뒤 자동 OPEN하지 않는다.
- **retry-retirement:** 지정한 UNRESOLVED ID 하나만 기존 엔진으로 보낸다. 다른 세대·이미 REVOKED인 대상·없는 ID는 실행하지 않는다. 공급자 대기 불명을 운영 명령 자체로 확인했다고 바꾸지 않는다. E-13 엔진의 성공은 추가 잔존 방 대조까지 확인한다. 예약은 AWAITING_OFFICIAL로 남으며 Cloud API 총한도를 우회하지 않는다.
- **checkpoint:** `OPS_DATA_DIR/official-usage-input.json`의 기존 6필드만 읽고 신선도·프로젝트·비음수·실제 확인자와 별도 신뢰 revision을 검증해 UsageBudget의 내구 기록에 반영한다. 공식 입력을 기록하려고 가짜 Media Generation/JournalRecord를 만들지 않는다. 확인된 회수와 이력이 있는 예약에만 공식 조정 후 해제를 적용한다. 기록 유실 잠금은 새 공식 잔량으로 해제하지 않는다.
- 접수 시점부터 monotonic timeout을 적용하고 내부 실행은 직렬화한다. 같은 requestId+body는 같은 operationId이며 서버 재시작 뒤에도 side effect를 재실행하지 않는다. pending 감사 기록 → 실행 → 내구 terminal → 외부 성공 공개 순서다. 타이머 지연·늦은 응답·감사 저장 경합 뒤에도 오래된 resume이 OPEN을 만들 수 없다.
- 실패는 admission 잠금을 유지한다. timeout 이후 이미 전송한 원격 작업에서 도착한 실제 회수 증거/429 대기는 보존하지만 운영 결과를 succeeded로 뒤집지 않는다. 감사의 남은 pending은 재시작 시 RECOVERY_UNCONFIRMED로 내구 종결한다.
- 감사에는 안전한 actor 별칭·requestId·operationId·action·상태/고정 코드·시각 및 멱등 비교용 명령 해시만 저장한다. 원시 retirementId, OPS_TOKEN/JWT, 맵/좌표, Identity 목록, 임의 예외 메시지를 응답이나 감사에 복사하지 않는다.

### 종료와 선행 모듈 보완

새 producer/운영 HTTP 접수를 먼저 닫고 bindings.close와 controller.close를 시작한다. controller는 감사 저장/보상 큐를, bindings는 이미 접수한 로컬 작업을 기다린다. 기존 E-13 cleanup/E-11 retry 작업도 중지·배출한 뒤 E-12 bootstrap.close로 usage/retry 저장을 끝내고 마지막 journal writer 잠금을 해제한다. checkpoint 쓰기 중 writer lease를 먼저 해제하면 안 된다.

`OperationJournal.snapshot()`은 현재 내구 세대 기록을 복사해 반환하고 `flush()`는 접수된 기록 큐를 기다린다. 부팅 때 캐시된 restore 결과를 현재 drain 증거로 사용하지 않는다. `RevocationRetries.retryNow`의 signal/beforeDispatch는 운영 기한을 실제 dispatch까지 전달한다. `UsageBudget.reconcileOfficial/releaseConfirmed`의 beforeCommit은 큐 실행 직전에 취소를 확인한다. 공식 검증은 큐 대기 후 시각/신선도를 재검사하며 유효하지 않은 epoch 값을 허용하지 않는다.

전체 `createMediaCoordinator(deps)` factory와 E-15 health/product READY, E-16 세대 전환은 후속 스토리다. 이 모듈들을 독립 호스트 감시자나 즉시 원격 강제 종료 보장으로 표현하지 않는다.

### 실제 검증과 남은 조건

Node 24.19.0 / pnpm 11.19.0에서 `pnpm verify` **전체 통과**: 62개 시험 파일 **731개 시험**, E-14 신규 8개 파일 **192개 시험**, 기존 Room 브라우저 E2E **2개**. 포맷·실행 계약·lint/경계·workspace 타입·빌드를 모두 통과했다. 신규 8개 시험 파일을 별도 strict NodeNext 타입 검사로도 확인했다.

검증 로그는 작업 폴더 `.local/execution/E-14-verify.log`에 보존한다. 최초 검사는 재사용 node_modules가 이전 checkout의 protocol을 참조하여 중단됐고, 작업 폴더 내부의 workspace 링크를 현재 브랜치로 고친 뒤 전체 재실행이 종료 코드 0으로 완료됐다. manifest/lockfile과 다른 checkout은 변경하지 않았다. node_modules 재사용, 기존 web 청크 크기·THREE.Clock·색상 환경 경고가 남는다.

실제 Cloud 호출은 **0회**다. 네트워크 전송·공식 예산/revision·완전한 product Readiness의 명시적 로컬 fixture를 실제 F 환경이나 E-15 구현으로 바꾸어 보고하지 않는다. 운영 경로 시험은 로컬 Express fixture이며 실제 B bootstrap/배포 서버 조립은 미실행이다.

### 다른 소유자에게 요청

- **E14-B-01 / B:** `server/src/bootstrap.ts`, 운영 router/Room·입장 집계. 위 고정 3경로, E 인증과 JSON parser 앞 no-store/auth, 오류 정책, 실제 getGameActivity 세 수치, 초대/방/grant await 전후 공통 admission을 연결한다. syntax-invalid JSON·세션 Bearer·pendingAdmissions 경합·drain→회수→resume을 실제 서버로 시험하고 commit/결과를 인계한다.
- **E14-F-01 / F:** `server/src/config/`, `infra/`, 운영 배포/QA. OPS_TOKEN·공개창·operationTimeoutMs·공식 입력과 연결된 신뢰 periodId/version·감사 이력 최초 생성 증거를 검증하여 주입한다. 기존 환경은 disabled/development이며 임의 production 활성화를 하지 않는다. 같은 지속 볼륨에서 감사/usage/retry/journal 쓰기·SIGKILL 복구와 중복 requestId·terminal 조회를 시험한다. 실제 Cloud 회수 및 격리 resume→smoke→drain 배포 증거를 제공한다. 패키지/lockfile 변경 요청은 없다.
- **E-15:** 전체 product readiness/factory에서 E-14의 admission과 작업 수명을 조립한다. RecoveryState.READY만으로 bindings.getReadiness를 대체하지 않는다. 정상 drain은 건강한 readiness와 분리하고 감사/기록 실패는 영구 잠금으로 전달한다.

공유 API·시험·이 인계는 MR에 포함한다. 개인 진행 기록과 작업별·이번 실행분 MR 본문은 `.local/`에 보존한다.

## E-13 / OP-06 — 이전 세대·잔존 방 대조와 회수

- Jira: [S15P21C204-147](https://ssafy.atlassian.net/browse/S15P21C204-147).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `740025ff722380a583ab20bd102ed0db323696f0`.
- 제출 브랜치: `feat/S15P21C204-147-boot-cleanup` → `develop`. 기준은 E-12 MR !20 병합 후 `fdd47548e82df2ad9fc4341bdb8119c62e0bd228`이다. 예전 누적 브랜치 `feat/S15P21C204-147-previous-generation-cleanup`은 제출 대상이 아니다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01.
- blockedOn: F-01 실제 namespace/Cloud 프로젝트 소유권·공식 예산·검증된 회수 프로필, 실제 Cloud/배포 볼륨 회귀, E-14~E-15 전체 coordinator 조립과 B의 실제 서버 연결.
- 이후 사용자 요청으로 `783838a96d40d75fab8734e362694364342f8e97`까지 푸시했고 사용자가 MR !27을 develop에 병합했다(`56d9691114f4b7919b81c00a27773871c78ba671`, squash `d1d3014d72dd79aa38c8723b6dd99e6a78727b59`). 제출한 E 코드·시험·인계 파일과 병합 결과가 동일함을 확인했다. Jira 완료는 별도다.

### 공개 진입점과 실제 연결

`server/src/operations/PreviousGenerationCleanup.ts`는 `PreviousGenerationCleanup`, `ownsMediaRoom`, `CleanupRunInput`, `CleanupTarget`, `CleanupObservedTarget`, `CleanupCallContext`를 제공한다. `CleanupInput/CleanupReport`는 E-12 `RecoveryState.ts` 원본을 재사용한다. `run(input)`은 저널·Cloud 목록·영속 observedTargets의 합집합을 정리한다. 동시 실행은 CLEANUP_IN_PROGRESS로 거절하고 완료 뒤 명시적으로 재실행할 수 있다.

- namespace와 UUIDv4 형식, 기록 epoch 일치, 체크섬·순번·세대 불변 정보를 확인한다. 현재 serverEpoch, 타 서비스, 모호한 자기 prefix 방에는 참가자 조회·회수·삭제를 보내지 않는다.
- 목록에 없는 PREPARED/미입장 Identity도 회수 대상이다. 모든 기록 방을 포함해 참가자 조회 → 확인 가능한 Identity 회수 → 방 삭제 → 전역 목록과 각 방 참가자 재조회 → 체크포인트 순서를 따른다.
- 최종 조회에서 새 소유 방이나 모호한 이름이 나타나도 성공으로 간주하지 않는다. unknown Identity를 정리한 사실은 발급 이력을 복구한 증거가 아니다.
- callback의 `CleanupCallContext`를 실제 Gateway dispatch까지 전달하고 비동기 응답 후 guard를 다시 확인한다. 취소 후 삭제·저장으로 계속 진행하지 않는다.

`server/src/operations/RecoveryCleanupBindings.ts`의 `RecoveryCleanupBindings`는 위 알고리즘을 **실제 E Gateway·E-11 RevocationRetries·journal·사용량·체크포인트**에 연결한다. 공개 옵션은 같은 파일의 `RecoveryCleanupBindingsOptions`이고 저장 스키마는 `CleanupCheckpointState`, `validateCleanupCheckpoint`다.

1. F가 확인한 namespace/projectAlias, `namespaceOwnershipConfirmed()`, 검증된 `capability()`, 기존 `journal`, `usageBudget`, **같은 Gateway/API 예산**, epoch/monotonic 시계, 기존 retryCheckpoint와 새 cleanupCheckpoint를 주입한다. cleanupCheckpoint는 `OPS_DATA_DIR/cleanup-checkpoint.json`, validator는 `validateCleanupCheckpoint`, isWritable은 같은 journal.writable로 연결한다. 별도 Cloud SDK나 API 예산을 만들지 않는다.
2. E coordinator의 부팅 조립에서 `beginCleanup: input => cleanup.run(input)`, `closeCleanup: () => cleanup.close()`, `allowIncompleteHistoryCleanup: true`로 `createRecoveryBootstrap`에 연결한다. 이 opt-in은 E-13의 소유권·영속 기록 보호 어댑터에만 사용한다. 기본 E-12 동작은 유지하며 integrity/scope/retry/clock 오류가 있으면 여전히 정리를 시작하지 않는다.
3. 누락 이력의 정리를 허용해도 input/report의 historyComplete는 false로 고정하고 LOCKED/DRAINING을 유지한다. 최초 설치 외부 증거와 공식 예산을 임의로 만들지 않는다.
4. 모든 조회·회수·삭제는 cleanup 우선순위, 요청별 1초 deadline, signal과 실제 발송 guard를 사용한다. 소유권 증거/프로필/저장 가능성이 바뀌면 발송하지 않는다. 정상 API가 잠겨도 남은 cleanup 예산 안에서 정리하며 총한도는 우회하지 않는다.
5. 알려진 저널 Identity는 회수 전 미확인 intent와 journal을 내구 저장하고, ACK → 참가자 부재 확인 → REVOKED 내구 기록 순으로 진행한다. 응답 불명으로 끝나면 E-11의 1/2/4초·10초 창과 429 대기 규칙을 재사용한다. 최초 요청 도중 재부팅한 intent는 공급자 대기 불명으로 보존해 즉시 재전송하지 않는다.
6. `retries`는 기존 E-11 엔진이다. 재시도 성공 후에는 자동으로 방 삭제·최종 조회를 다시 수행한다. `reconcile()`는 이 부팅 정리의 명시적 재대조이며 살아 있는 현재 epoch 방의 주기적 청소 명령이 아니다. `snapshot()`은 마지막 pass의 CleanupReport만 반환한다.
7. `onReport(report)`는 `bootstrap.state.completeCleanup(report)`와 `bootstrap.refreshBudget()`에 연결한다. **onUnresolved는 경보 코드 통지**다. 일시적인 RECOVERY_UNCONFIRMED/RETIREMENT_UNRESOLVED를 RecoveryState.lock의 영구 reason으로 추가하지 않는다. 현재 보고의 unresolved가 준비 잠금을 유지하며 재대조 성공 후 해제될 수 있다. JOURNAL_WRITE_FAILED는 영구 저장 실패 잠금으로 전달한다. historyComplete=false는 이후 빈 목록으로 해제하지 않는다.
8. 전체 대조가 확인된 후 같은 예약의 모든 저널 세대가 REVOKED이면 사용량을 AWAITING_OFFICIAL까지 반영한다. REVOKED 저장 직후 중단된 경우도 다음 sweep에서 이어 간다. 공식 조정 전에는 예약/잔량을 해제하지 않는다.
9. 종료는 위 closeCleanup hook을 반드시 포함한다. 원격 응답 대기를 취소하고 늦은 결과를 무시하되 접수된 journal/retry/cleanup 저장은 모두 기다린다. 새 cleanup 체크포인트의 rename도 끝난 뒤에야 E-12가 writer 잠금을 해제한다. Gateway/API 예산의 최종 close는 같은 소유자가 이어서 수행한다.

### 이력 불명·회수 확인의 경계

저널 밖 참가자와 REVOKED 뒤 다시 관측된 Identity는 회수 **전에** cleanup 체크포인트의 observedTargets에 저장한다. 다음 재부팅에서 Cloud 목록에 없더라도 다시 대조한다. 기존 terminal 저널을 UNRESOLVED로 뒤집거나 없는 playerId/purpose/예약을 만들어 `Generation`으로 복원하지 않는다. 발급 이력/예약이 없는 관측 대상에는 가짜 RetryIntent를 만들지 않고 현재 회수 결과와 고정 경보를 보존하며 후속 명시적 대조·운영자 확인을 기다린다.

`server/src/media/RemoteRevocation.ts`의 `confirmRemoteRevocation`을 E-10 RetirementBarrier와 E-13이 함께 사용한다. remove ACK와 참가자 부재를 모두 요구한다. **RemoveParticipant의 404는 성공이 아니다.** 조회의 typed not_found/404는 현재 참가자 부재로만 해석하고, 이미 없는 방의 DeleteRoom 404도 최종 재조회를 생략하는 근거가 되지 않는다. GatewayError의 429/Retry-After 정보는 원본대로 재시도에 전달한다.

전체 `createMediaCoordinator(deps)` 런타임 factory와 E-14 운영 명령·E-15 제품 readiness는 아직 후속 스토리다. 이번 연결 시험은 E-12/E-13 실제 로컬 모듈 연결이며 B의 HTTP 서버·Cloud 실환경 조립 완료가 아니다. 복구 구성 요소가 READY여도 admission은 DRAINING이며 제품 전체 READY와 명시적 resume 전까지 발급/입장을 허용하면 안 된다.

### 실제 검증과 남은 조건

Node 24.19.0 / pnpm 11.19.0에서 `pnpm verify` 전체 통과: 40개 시험 파일 **465개 시험**, E-13 신규 **126개**(정리 알고리즘 45·공유 회수 27·실제 로컬 연결 24·체크포인트 18·복구 수명 12), 기존 Room 브라우저 E2E **2개**. 포맷·실행 계약·lint/경계·workspace 타입·빌드가 통과했다. 신규 5개 시험 파일의 별도 strict NodeNext 타입 검사도 통과했다.

검증 로그는 작업 폴더 `.local/execution/E-13-verify.log`에 보존한다. 기존 node_modules를 재사용했고 manifest/lockfile 변경은 없다. 기존 web 청크 크기·THREE.Clock·색상 환경 경고가 있었으며 전체 검사는 종료 코드 0이다.

모든 Cloud 응답·공식 잔량·소유권 증거는 명시한 로컬 fixture이고 실제 Cloud 호출은 **0회**다. 실제 SDK/Cloud의 옛 토큰 재접속 거절, 잔존 방·미입장 토큰 회수, Linux 배포 볼륨 장애와 연습→경기→종료→재경기 검증은 미실행이다. 이 결과를 Cloud 성공이나 최종 ACCEPTED로 표시하지 않는다.

### 다른 소유자에게 요청

- **E13-B-01 / B:** 대상 `server/src/bootstrap.ts`, `server/src/rooms/`. 후속 전체 E factory의 initialize → initialized이면 listen/fatal이면 close 계약과 같은 readiness/admission을 연결한다. E 비동기 콜백의 게임 상태 반영은 `enqueueControl`로 처리한다. B 인계 SHA, 부팅 중 grant 0·복구/종료 후 재개 순서의 실제 HTTP 시험 및 `pnpm verify`를 제공한다.
- **E13-F-01 / F:** 대상 `server/src/config/`, `infra/`, `tests/`, `server/src/observability/`. 실제 Cloud 프로젝트와 namespace의 소유권 증거, 공식 minutes/bytes 예산·시점/기간/버전, 회수 프로필과 격리된 시험 범위를 인계한다. `cleanup-checkpoint.json`을 journal·retry·usage와 같은 지속 볼륨/단일 writer 아래 두고 Linux sync/rename·재부팅 회귀를 실행한다. QA-05에는 PREPARED 미입장, unknown 소유 방, 타 서비스 보존, remove 성공 뒤 재조회 실패, 429와 늦은 응답을 포함한다. 고정 경보/요약만 공개하고 원시 Identity·Secret은 로그에 넣지 않는다. 새 패키지나 버전 변경 요청은 없다.
- **E-14~E-15:** E-13의 미해결 경보·report, E-11 `retries`, E-12 closeCleanup 수명 연결을 실제 운영/전체 readiness 조립에서 사용한다. 운영자가 공급자 대기를 확인하지 않은 429와 이력 유실 잠금은 resume으로 우회하지 않는다.

공유 API·시험·이 인계는 MR에 포함한다. 개인 진행 기록과 작업별·이번 실행분 MR 본문만 `.local/`에 보존한다.

## E-12 / OP-05 — 부팅 복구 상태와 기록 검사

- Jira: [S15P21C204-146](https://ssafy.atlassian.net/browse/S15P21C204-146).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `82a083df196ce19fc99d7d0bc291521ec95a71f3`.
- 제출 브랜치: `feat/S15P21C204-146-boot-recovery` → `develop`. 기준 SHA는 `e1b93937328e6ef1650abbb9b89be80df0f4e294`이며 E-11 병합 후 새로 분기한 E-12 단일 스토리다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01.
- blockedOn: 전체 `createMediaCoordinator(deps)`의 E-13~E-15 조립, B의 실제 HTTP 초기화/발급 장벽 연결, E-13 실제 잔존 세대 정리, F-01 공식 예산·최초 설치 증빙·격리 Cloud 환경 및 배포 볼륨 검증.
- 이후 사용자 요청으로 `177b3d0e85f758a675f834253d6b5dc6c09bf65c`까지 푸시했고, 사용자가 MR !20을 develop에 병합했다(`fdd47548e82df2ad9fc4341bdb8119c62e0bd228`). squash 병합이지만 제출한 E 코드·시험·인계 파일과 병합 결과가 동일함을 확인했다. Jira 완료 상태는 별도다.

### 공개 진입점과 B 초기화 연결

`server/src/operations/RecoveryBootstrap.ts`의 `createRecoveryBootstrap(options)`는 **동기 생성**하고 IO를 시작하지 않는다. 초기 상태는 RECOVERING / DRAINING이다. 같은 모듈의 `RecoveryBootstrapOptions`, `RecoveryCleanupInput`이 실제 입력 타입이다.

1. 동일한 단일 writer 아래의 `OperationJournal`, `UsageBudget`, retry `CheckpointStore<readonly RetryIntent[]>`와 namespace, epoch/monotonic 시계, 공식 예산 유효기간을 주입한다. 체크포인트 validator는 E-11의 `validateRetryCheckpoint`를 사용한다. 저장소의 `isWritable`은 같은 `journal.writable`에 연결한다. 미디어 registry를 함께 만들면 새 `registry.serverEpoch` UUID를 옵션으로 공유하며 이전 epoch를 현재 epoch로 덮어쓰지 않는다.
2. `initialize()`는 같은 Promise를 재사용한다. 저널 → retry 체크포인트 → 사용량 기록을 복원하고 무결성·namespace·세대·예약·순번을 대조한다. `initialized`의 readiness는 RECOVERING 또는 LOCKED, admission은 항상 DRAINING이다. 저장소를 안전하게 관측할 수 없는 경우 `fatal/INITIALIZATION_FAILED`, 쓰기자 충돌은 `fatal/WRITER_CONFLICT`를 반환한다.
3. B는 최종 E coordinator의 `initialize()` 결과를 기다린 뒤 `initialized`일 때 관측용 HTTP listen을 시작하고, `fatal` 또는 예상 밖 reject이면 `close()` 후 listen 없이 종료한다. initialized는 경기 시작·토큰 발급 허용이 아니다. 발급은 최종 product readiness와 admission OPEN을 함께 확인해야 한다.
4. `beginCleanup(input)`은 로컬 초기화 이후 시작하며 initialize가 Cloud 완료를 기다리지 않는다. 현재 E-12는 이 **E-13 포트만** 제공한다. 어댑터가 없으면 CLEANUP_NOT_CONFIGURED로 LOCKED이며 빈 성공 결과를 만들지 않는다.
5. `getReadiness()`는 E-12 복구 구성 요소의 결과다. cleanup·공식 예산이 확인되더라도 `getAdmission()`은 DRAINING을 유지한다. **제품 전체 READY는 E-15 검사를 합친 후**, OPEN은 E-14 명시적 resume 후에만 허용한다. `refreshBudget()`은 공식 예산 재대조와 저장 가능성 변화를 반영하며 손상/기록 유실 잠금을 제거하지 않는다.
6. 종료 시 외부 producers와 E-11 bindings의 새 작업을 먼저 중지하고 `close()`를 기다린다. E-12 close는 cleanup AbortSignal과 guard를 닫고, 사용량·retry 저장 큐를 비운 **후 마지막으로 journal writer 잠금을 해제**한다. 늦게 도착한 Cloud 응답은 복구 상태를 변경하지 않는다. E-13은 저장/큐 대기 후 원격 발송 및 후속 로컬 쓰기 직전에 `signal`과 `beforeDispatch()`를 확인해야 한다.

공통 계약의 전체 `createMediaCoordinator(deps)` 런타임 factory는 현재 develop에 없으며 이 MR에서도 완성했다고 주장하지 않는다. E-12의 실제 factory는 `createRecoveryBootstrap`이다. E-13~~E-15 구현과 기존 E-01~~E-11을 합치는 E 소유 조립 후 B가 최종 factory를 사용한다. B용 실행 순서는 `server/test/media/recovery-initialization.test.ts`의 소비자 계약 시험으로 검증했으며 실제 B HTTP 조립 시험은 아니다.

### E-13에 전달하는 복원 기록

`server/src/operations/RecoveryRecords.ts`는 순수 함수 `reconcileRecoveryRecords`와 `RecoveryRecords`, `RecoveryRetryDeadline`을 제공한다. `bootstrap.recovered()` 및 cleanup 입력은 최신 journal records, PREPARED를 포함한 pendingRecords, 실제 저널 lastSeq, 대조한 retryIntents/monotonic retryDeadlines와 예약을 보존한다. identity·예약 원문을 공개 health나 로그에 내보내지 않는다.

- 같은 namespace·room·identity·generation을 묶고 불변 세대 정보, 예약 root와 숫자 구간, match 일치 및 미해결 예약을 대조한다. 사용량 체크포인트의 순번은 별도 계열이므로 저널 순번과 비교하지 않는다.
- 이미 압축된 저널은 records가 비어 있어도 실제 lastSeq를 보존한다. retry 체크포인트가 저널보다 앞서거나 미해결 journal과 맞지 않으면 잠근다. 최신 내구 REVOKED는 이전 retry intent를 완료 상태로 정규화한다.
- 기록에서 사라진 REVOKED intent는 같은 예약 root와 모든 구간의 공식 조정·24시간 보관 증거가 검증된 경우에만 제외한다. 알 수 없는 공급자 대기, 만료된 10초 자동 창, 유실된 retry 기록을 즉시 재시도 가능한 상태로 바꾸지 않는다.
- journal에는 playerId/purpose가 없어 전체 `Generation`을 복원할 수 없다. E-13은 위 검증된 journal/예약 자료를 직접 사용하고 값을 만들어 registry에 넣지 않는다. 압축된 기록을 E-11 bindings에 연결할 때는 실제 lastSeq와 검증된 intent 집합을 유지하는 어댑터 검증이 추가로 필요하다.

`server/src/operations/RecoveryState.ts`는 `RecoveryState`, `CleanupInput`, `CleanupReport`, `RecoverySnapshot`, `restoreMonotonicDeadline`을 제공한다. 반복 restore/initialize는 기존 잠금을 초기화하지 않는다. 첫 설치는 외부 증거가 확인된 빈 기록에만 적용하며 빈 디렉터리나 빈 Cloud 목록을 증거로 간주하지 않는다. 기록이 남은 상태에서 사라진 사용량 파일을 0으로 재생성하지 않는다.

기존 `UsageBudget.close()`와 `CheckpointStore.close()`는 이제 새 쓰기를 즉시 거절하고 접수된 저장을 기다린다. 사용량 close 이후 reserve/reconcileOfficial은 기존 typed 거절, mark/release는 false를 반환하며 snapshot.writable은 false다. close한 인스턴스는 다시 열지 않는다.

### 실제 검증과 남은 조건

Node 24.19.0 / pnpm 11.19.0에서 `pnpm verify` 전체가 exit 0으로 통과했다. 33파일 322시험, 기존 개발 Room 브라우저 E2E 2개, 포맷·실행 계약·lint·경계·workspace 타입·빌드를 포함한다. E-12 신규 시험은 상태 36개, 기록 대조 23개, 실제 디스크 부팅 16개, 발급/초기화 소비 4개, 종료 경쟁 4개로 총 83개다. 신규 5개 시험 파일의 strict NodeNext TypeScript 검사도 통과했다. E 소유권 검사는 인계 문서 포함 11파일에 대해 `node scripts/check-role-scope.mjs --role E --base e1b93937328e6ef1650abbb9b89be80df0f4e294`로 확인한다.

기존 설치 의존성을 재사용하며 `pnpm_config_verify_deps_before_run=warn`을 적용했다. manifest·lockfile 변경이나 재설치는 없다. 기존 web bundle 크기·THREE.Clock·색상 환경 경고는 남는다. 전체 로그는 이 브랜치 작업 디렉터리의 `.local/execution/E-12-verify.log`에 보존했다. 실행 문서 변경 후에는 해당 문서의 포맷·실행 계약·소유권·diff 검사를 별도로 확인한다.

추가된 주요 회귀는 첫 설치/정상/유실/손상/부분 기록의 구분, 기존 epoch·예약 보존, writer 충돌, 압축 후 lastSeq, retry/저널 불일치, 시계 복원과 예산 잠금, 초기화/종료 멱등성, 종료 이후 발송·grant 차단이다. 실제 임시 디스크에서 usage/retry rename을 지연해 저장 중에는 새 writer가 잠금을 얻지 못하고 종료 후 이전 저장이 새 기록을 덮지 않는 것도 확인했다.

실제 `GrantIssuer` 소비 시험에서 초기·RECOVERING·LOCKED·복구 READY/DRAINING·종료 상태의 예약·저장·서명·grant·네트워크 호출이 0이었다. cleanup 결과와 공식 예산은 명시한 **로컬 fixture**이며 실제 Cloud 성공 증거가 아니다. 기존 개발 Room E2E도 실제 브라우저 미디어/권한 시험이 아니다. Cloud 호출은 이번 실행에 0회이며 실제 토큰 재접속 거절·연습→경기→종료→재경기·Linux 볼륨 장애 검증은 미실행이다.

### 다른 소유자와 후속 E 작업에 요청

- **E12-B-01 / B:** 대상 `server/src/bootstrap.ts`, `server/src/rooms/`. 위 initialize → initialized이면 listen / fatal이면 close 순서와 발급의 product READY + OPEN 장벽을 연결한다. Tick 밖에서 IO를 수행하고 완료 응답은 `enqueueControl`로 전달한다. 전체 E factory의 인계 SHA가 도착한 후 실제 HTTP listen 순서·fatal 시 listen 0·부팅 중 grant 0 시험 및 `pnpm verify` 결과를 B 인계에 남긴다.
- **E12-F-01 / F:** 대상 `server/src/config/`, `infra/`, `server/src/observability/`, `tests/`. OPS_DATA_DIR의 단일 writer·권한·Linux fsync/rename 내구성, 공식 예산·기간/버전·checkedAt/checkedBy, 외부 최초 설치 증명 절차를 인계한다. 최초 설치 boolean을 항상 true로 설정하거나 기록 유실을 초기화 명령으로 복구하지 않는다. 관측은 readiness의 고정 reasonCodes만 노출한다. F 인계 SHA와 `pnpm verify`, 실제 볼륨 손상/재부팅·Cloud 회귀 명령/결과를 제공한다. 새 패키지·버전 변경 요청은 없다.
- **E-13 / OP-06:** 위 `RecoveryCleanupInput`으로 소유 namespace의 이전 세대 목록·PREPARED까지 실제 회수하고 Cloud 재조회와 내구 기록 증거를 `CleanupReport`로 반환한다. 누락/실패를 0으로 간주하지 말고 같은 cleanup API 예산을 사용한다. 이 MR을 사용자가 develop에 병합한 뒤 다음 단일 스토리로 진행한다.
- **E-14~E-15:** E-14 명시적 resume, E-15 전체 readiness와 E coordinator 조립을 별도 스토리에서 연결한다. 이번 E-12에는 해당 기능이나 성공 stub을 추가하지 않았다.

공유 API·시험은 이 MR에 들어 있고 개인 진행 기록·복사용 MR 본문만 `.local/`에 둔다. 다른 담당자가 로컬 파일을 전달받아야 공개 계약을 이해할 수 있는 구조가 아니다.

## E-11 / OP-04 — 회수 재시도와 예약·기록 해제

- Jira: [S15P21C204-145](https://ssafy.atlassian.net/browse/S15P21C204-145).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `f094d91f33a40236d9344c102493c1f330b4b25b`.
- 제출 브랜치: `feat/S15P21C204-145-revocation-retry` → `develop`. 기준 SHA `48f7efa20c5454eeb5ea518c82c513669241d7f8`에서 분기한 E-11 단일 스토리였다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01.
- blockedOn: B의 실제 발급·종료 흐름 조립, F-01 공식 예산·시험 환경과 검증된 Cloud revocationProfile, F의 실제 회수·429·배포 볼륨 회귀. E-12 부팅 조립과 E-14 운영 라우트는 후속 스토리다.
- 원격 이력: 사용자 요청으로 `278f5e9`까지 푸시했고 사용자가 MR !16을 develop에 병합했다. squash 커밋 `da007bc`와 merge 커밋 `e1b9393`을 확인했으며 병합 트리가 제출 HEAD와 동일하다. Jira 완료는 별도로 확인해야 한다.

### 공개 진입점과 연결 순서

`server/src/operations/RevocationRetries.ts`는 `RevocationRetries`, `RetryIntent`, `RetryAttemptResult`, `RevocationRetryOptions`, `validateRetryIntent`를 제공한다. `begin()`은 이미 실패한 E-10 종료에 대해 최초 회수 시각과 예약·identity·generation을 저장한 후 재시도를 예약한다. 실패 후 최신 monotonic 시각을 기준으로 1/2/4초를 기다리며 공급자 Retry-After가 더 길면 그 대기를 따른다. 첫 회수 후 10초까지 확인되지 않으면 UNRESOLVED와 경보를 한 번 기록한다. 자동 무제한 재시도는 없다.

`send(intent, {beforeDispatch})` 연결자는 저장·예산 대기 이후 실제 원격 발송 직전에 guard를 실행해야 한다. `retryNow(retirementId, {providerWaitConfirmed?})`는 같은 큐로 운영자 단일 재시도를 제공하며 알려진 Retry-After는 우회하지 않는다. 공급자 대기를 확인할 수 없는 429는 명시적 확인 전까지 차단한다. `snapshot()`은 상태·attempt·경보 여부를 반환한다. `close()`는 새 시도를 막고 진행 중 쓰기와 콜백을 기다린다. 저장 실패는 전체 재시도를 잠그고 `onPersistenceFailure`로 전달한다.

`server/src/operations/RevocationRetryBindings.ts`는 `RevocationRetryBindings`, `RevocationRetryBindingsOptions`, `validateRetryCheckpoint`를 제공한다. 별도 SDK 인스턴스나 예산을 만들지 않고 기존 `LiveKitGateway`·`UsageBudget`·`OperationJournal`·`RetirementBarrier`에 재시도를 연결한다.

1. 단일 writer 아래에서 저널·사용량 예산·retry 체크포인트를 복원하고 일치 여부를 검증한다. B/E-12는 검증한 `initialCheckpoint`와 `initialJournalRecords`, 해당 `generations()`를 주입한다. 초기화가 허용된 빈 저장소에서만 빈 상태를 사용한다. E-11 생성자가 부팅 복구 판정을 대신하지 않는다.
2. `namespace`, 기존 `journal`, `checkpoint`, `usageBudget`, `gateway`, `generations`, 검증된 `capability`, monotonic/epoch 시계와 `stopPermissions`, `onOccupancyEnded`, `lockIssuance`, `onUnresolved` 콜백으로 bindings를 만든다. 체크포인트 저장소 validator는 `validateRetryCheckpoint`를 사용한다. 복원 상태가 있으면 검증 완료 후 `restoreRetries()`를 호출한다.
3. 종료 요청은 `retire(RetireGenerationRequest)`로 전달한다. 최초 E-10 종료가 불명이면 영속 retry intent를 생성한다. 재시도도 같은 Gateway의 cleanup 예산을 사용하고 검증된 회수 방식으로 새 cutoff를 계산한다. 저널과 retry 체크포인트가 저장되기 전에는 발송하지 않는다.
4. 원격 확인과 journal.REVOKED 저장 후 `onOccupancyEnded(generation)`을 호출한다. 같은 방 예약을 공유하는 모든 세대의 회수가 내구 기록으로 확인돼야 사용량 예약을 AWAITING_OFFICIAL로 옮긴다. 공식 조정 전에는 예약을 해제하지 않는다. `reconcileOfficial(checkpoint, {periodId,version})`로 검증된 공식 사용량을 반영한 뒤에만 해제한다.
5. 종료 때 `bindings.close()`를 기다린 다음 외부에서 소유한 저널·체크포인트·Gateway 예산을 닫는다. 콜백의 Room 상태 변경과 완료 응답은 B의 `enqueueControl`로 전달하고 Tick에서 파일 IO를 수행하지 않는다.

`server/src/operations/RetentionPolicy.ts`의 `canCompact(record, nowEpochMs)`는 종료·회수·공식 조정 시각의 최대값부터 24시간이 지났는지 판단한다. `compactConfirmedRetirements(journal, usageBudget, nowEpochMs)`는 검증된 예산의 원본 예약과 모든 구간이 RELEASED인지 확인한 뒤 기존 저널의 checkpoint → 로그 교체 절차를 호출한다. 원본 예약 누락·다른 match·검증 실패·미해결 상태는 삭제 근거가 되지 않는다. 호출자는 공식 조정·예약 변경과 정리를 직렬화해야 한다. 시간 경과만으로 PREPARED/REVOKING/UNRESOLVED를 삭제하지 않는다.

### 실제 검증과 남은 조건

Node 24.19.0 / pnpm 11.19.0에서 최종 `pnpm verify` 전체가 exit 0으로 통과했다. 28파일 239시험, 기존 개발 Room 브라우저 E2E 2개, 포맷·실행 계약·lint·경계·workspace 타입·빌드 검사를 포함한다. E-11 시험은 재시도 32개, 실제 로컬 모듈 연결 14개, 보관 정책 7개로 총 53개다. 세 시험 파일의 strict NodeNext TypeScript 검사와 `node scripts/check-role-scope.mjs --role E --base 48f7efa20c5454eeb5ea518c82c513669241d7f8`도 통과했다.

주요 회귀는 1/2/4초와 10초 경계, 느린 저장·종료 이후 발송 차단, 전체 복원 사전 검증, 지속 저장 실패, 실제 journal 순번과 retry checkpoint 일치, 600회 정상 예산 소진 후 cleanup 허용·900회 총한도에서 추가 전송 0, 429 대기, 공유 예약 6세대 회수, 공식 조정 전 예약 유지와 해제 실패 잠금, 최신 확인 후 24시간 경계와 미해결 보존이다.

첫 전체 실행에서는 보관 시험의 준비 단계 `markRemoteConfirmed`가 false를 반환해 1시험이 실패했다. 원래 저장 오류가 결과값으로 감춰져 원인은 확인하지 못했다. 관련 32시험을 별도로 재실행해 통과했고, 시험에 원인 보존을 추가한 뒤 전체 239시험 재실행과 최종 같은 `pnpm verify`도 통과했다. 재현되지 않은 실패를 수정 완료로 단정하지 않으며 원격 CI/배포 볼륨에서도 재확인한다. 시험 병렬성·제품 저장 실패 정책을 완화하지 않았다.

기존 설치 의존성을 재사용하며 `pnpm_config_verify_deps_before_run=warn`을 적용했다. manifest·lockfile 변경이나 재설치는 없다. 기존 web bundle 크기·THREE.Clock 경고는 남는다. 로컬 증거는 이번 작업 디렉터리의 `.local/execution/E-11-verify.log`, `E-11-verify-initial-failure.log`, `E-11-test-diagnostic.log`에 보존했다.

Cloud SDK 경계만 로컬 시험용 transport로 대체한 연결 시험이며 실제 Cloud 성공 증거가 아니다. 실제 브라우저 미디어 게시·수신·기존 토큰 재접속 거절·연습→경기→종료→재경기·배포 볼륨 장애 복원은 이번에 실행하지 않았다. F의 공식 잔여 예산과 실제 시험 조건이 도착하면 영향받는 권한/회수 회귀를 재실행해야 한다.

### 다른 소유자와 후속 E 작업에 요청

- **E11-B-01 / B:** `server/src/bootstrap.ts`의 `createApplication`과 `server/src/rooms/`의 실제 조립 위치에서 위 bindings와 `enqueueControl`을 연결한다. 기존 발급 잠금·종료 요청·점유 종료에 같은 세대 registry와 Gateway를 사용한다. 완료 증거는 B 인계 SHA와 실제 종료 → REVOKED 내구 기록 → 점유 종료 연결 시험 및 `pnpm verify` 결과다.
- **E11-F-01 / F:** `server/src/config/`·`server/.env.example`·`infra/`에서 F-01의 프로젝트 별칭·공식 minutes/bytes 잔량·checkedAt/checkedBy·기간/버전, 검증된 revocationProfile 및 격리된 시험 환경을 인계한다. 비밀값은 로컬/배포 환경에만 둔다. `server/src/observability/`와 `tests/`에서 `onUnresolved`와 `retries.snapshot()`의 미해결 수·attempt를 알람/지표에 연결하고 실제 429·재시도·Linux 지속 볼륨 회귀 명령과 결과를 F 인계에 남긴다. 로컬 확인은 `pnpm verify`, 실제 Cloud 시험 명령은 F-01 환경을 확정한 뒤 함께 인계한다. 새 패키지나 버전 변경 요청은 없다.
- **E-12 / OP-05:** 부팅 시 저널과 retry 체크포인트의 순번·최신 세대·회수 증거를 대조하고 검증된 입력만 넘긴다. 영속 REVOKED 후 점유 콜백 실패, 체크포인트 이후 로그, 24시간 보관 정리가 반영된 상태를 멱등 복구해야 한다. 이번 E-11에 부팅 정책 구현을 포함하지 않는다.
- **E-13 / OP-06, E-14 / OP-07:** 잔존 세대 정리에서 위 재시도 API를 재사용하고 운영 재시도도 같은 cleanup 예산을 통과시킨다. 운영 라우트 조립은 B, 환경 설정은 F가 소유한다.

관련 코드와 시험은 이 MR에 포함하므로 다른 담당자가 `.local/` 파일을 받아야만 연결할 수 있는 구조가 아니다. 개인 진행 기록과 복사용 MR 본문만 로컬에 둔다.

## E-02 / OP-01 — 지속 저널과 원자적 체크포인트

- Jira: [S15P21C204-136](https://ssafy.atlassian.net/browse/S15P21C204-136).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED** — B의 부팅/제어 큐 연결 및 F의 배포 볼륨 내구성 확인 대기.
- 구현 commit: `0ac38e7879de8cf03e01c62a65f4d4989afeeb33`.
- 제출 브랜치: `feat/S15P21C204-136-journal-storage` → `develop`.
- 기준: `b12cb9cb25d1058dcfde4bd6193ea55b0e7a7427`, EXEC-CONTRACT-3 / D-2026-09-08-01.
- E-01~E-10 제출 순서의 첫 번째 MR이며 다른 E 구현을 포함하지 않는다. 기존 누적 브랜치는 보존했다.

### 공개 진입점과 연결

`server/src/operations/OperationJournal.ts`는 `OperationJournal`, `JournalRecord`, `JournalEntry`, `JournalRestore`를 제공한다. 절대 경로인 `opsDataDir`로 생성하고 먼저 `restore({afterSeq?})`를 기다린다. `integrity`, `writable`, `unresolved`, 선택적인 `reason`을 확인한 뒤에만 쓰기를 진행한다. 재생 구간보다 앞선 미해결 세대도 `unresolved`에 반영한다.

`append(record)`는 허용 필드·순번·체크섬을 기록하고 파일 sync가 끝난 뒤 `{seq,durable:true}`를 반환한다. 필수 필드가 undefined이거나 미허용 필드가 있으면 저장을 거절한다. 저장 실패 뒤에는 `writable=false`와 거절 결과를 발급 잠금으로 연결해야 한다. `close()`는 이미 접수한 쓰기를 기다리고 새 쓰기를 거절한다.

`CheckpointStore<T>`는 입력 상태 검증과 `lastSeq`를 유지하며 임시 파일 쓰기 → sync → 같은 볼륨 rename → 지원 OS의 디렉터리 sync 순서로 교체한다. 직접 사용할 때는 같은 저널의 단일 쓰기자 잠금 아래에서 사용해야 한다.

`compact(isEligible)`는 최신 REVOKED 기록만 외부 정책에 질의하고, 체크포인트 내구성 확보 후 로그를 교체한다. 미해결 상태는 callback 결과와 무관하게 유지한다. 24시간 보관 판단은 E-11의 후속 정책이며 이 MR에는 해당 정책 구현을 포함하지 않는다.

### 실제 검증

별도 제출 작업 디렉터리에서 Node 24.19.0 / pnpm 11.19.0으로 `pnpm verify` 전체가 exit 0으로 통과했다. 전체 13파일 91시험에 E-02 저널 시험 25개가 포함되며, 기존 개발 Room 브라우저 E2E 2개도 통과했다. 포맷·실행 계약·lint·경계·workspace 타입·빌드가 포함된 결과다. 저널 시험 자체의 strict TypeScript 검사도 통과했다.

기존 설치 의존성을 재사용했으며 workspace 구조 변경 경고를 `pnpm_config_verify_deps_before_run=warn`으로 처리했다. manifest·lockfile 변경이나 재설치는 없다. 기존 web bundle 크기/THREE.Clock 경고는 남는다.

시험은 sync 완료 전 반환 금지, ENOSPC, 두 번째 writer, 부분 JSON/체크섬/순번 손상, rename 및 로그 교체 중단, 외부 보관 정책 허용/거절, 필수 undefined 거절과 afterSeq 이전 미해결 세대를 확인한다. 디스크/프로세스 장애의 일부 경계는 주입한 로컬 회귀이며 실제 배포 볼륨의 전원 차단 실증은 아니다.

### 소비자 요청과 병합 순서

- **B / 부팅 및 제어 큐:** journal 복원 결과를 초기 발급 장벽에 반영하고 append 완료/실패는 `enqueueControl`을 통해 처리한다. Tick 안의 동기 IO로 연결하지 않는다.
- **F / 배포 볼륨:** OPS_DATA_DIR 권한·단일 호스트/단일 인스턴스 잠금, Linux 디렉터리 sync와 실제 디스크 장애 복원을 확인한다. 현재 PID 소유자 검사는 단일 호스트를 전제로 하며 Windows에서는 디렉터리 fsync를 수행하지 않는다.
- **후속 E-03:** 이 MR이 develop에 반영된 뒤 저널/체크포인트를 기반으로 사용량 예산을 제출한다. E-04는 독립적으로 제출 가능하다.
- **병합:** 이 MR을 먼저 `develop`에 **Merge commit, Squash 해제**로 병합한다. 후속 MR이 이 소스 브랜치를 임시 대상으로 사용하는 동안에는 삭제를 미룬다. 원격 병합은 사용자가 수행하며 Jira 완료 전환은 별도 판단한다.

## 인계 항목 양식

| 항목                   | 기록할 내용                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| 고정 번호 / 원본 ID    | 실제 담당 작업 번호와 원본 ID                                                       |
| localStage / 최종 상태 | PLANNED, CONTRACT_READY, LOCAL_VERIFIED, INTEGRATED, ACCEPTED / 필요한 경우 BLOCKED |
| 구현 commit            | 검증한 실제 SHA, 미커밋이면 미커밋이라고 명시                                       |
| 계약 기준              | EXEC-CONTRACT-3, 적용 제품 결정 D-2026-09-08-01                                     |
| 공개 진입점            | 실제 파일 경로와 export 이름, 입력·출력·실패 타입                                   |
| 소비자와 조립 담당     | 필요한 역할, 해당 고정 번호, 연결할 파일과 호출 순서                                |
| 검증                   | 실행 명령·exit code·검증 환경·기대/실제 결과·증거 위치                              |
| blockedOn              | 미도착 선행 export/commit, 실제 계정·장치·제품 결정 등                              |
| 다음 단계              | 누가 어떤 산출물을 제공하면 무엇을 다시 검사할지                                    |

공유 가능한 증거는 MR에 첨부하거나 팀이 접근 가능한 위치를 기록한다. `.local/` 경로만 적고 상대 checkout에도 파일이 있다고 가정하지 않는다. 비밀 env·JWT·OPS_TOKEN·실제 얼굴·음성을 기록하지 않는다. Cloud 시험 미실행을 mock 통과로 대체하지 않는다. 제품 결정 대기 작업은 그대로 PRODUCT_DECISION_PENDING이다.

## 다른 소유자에게 요청할 변경

요청할 때 **요청 ID / 대상 역할 / 대상 파일 / 필요한 export 또는 패키지·정확 버전 / 이유 / 연결 작업 / 완료 확인 명령**을 적는다. 여기 적힌 요청은 팀원에게 메시지를 보낸 것이 아니며, 외부 알림·Jira 변경을 자동 수행하지 않는다. 대상 담당자는 자기 인계 파일에 결과와 구현 SHA를 남긴다.

## 재개 시 확인

1. 인계 구현 SHA가 현재 checkout에 실제 반영됐는지 확인한다. MR 링크만 있거나 열린 MR이면 적용된 것으로 보지 않는다.
2. 공개 export와 소비 시험을 확인하고 필요한 연결 시험을 실행한다.
3. 성공한 단계와 아직 막힌 단계를 별도로 갱신한다. 동일 구현을 중복 커밋하지 않는다.
