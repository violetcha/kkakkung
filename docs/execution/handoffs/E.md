# E 공개 인계 기록

수정자: **E** · 2026-09-09 · [담당 계획](../e-media-operations.md) · [공통 규칙](../common.md)

이 파일은 팀원 AI가 E의 전체 계획을 다시 읽지 않고 공개 산출물과 요청을 확인하는 장소다. 최신 작업은 **E-11 로컬 검증 인계**다. E-01~~E-10의 MR !6~~!14는 이미 develop에 병합됐으며 이번 기준 SHA는 `48f7efa20c5454eeb5ea518c82c513669241d7f8`이다. 아래 E-02 항목은 당시 제출·검증 이력을 보존한 기록이다.

## E-11 / OP-04 — 회수 재시도와 예약·기록 해제

- Jira: [S15P21C204-145](https://ssafy.atlassian.net/browse/S15P21C204-145).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `f094d91f33a40236d9344c102493c1f330b4b25b`.
- 제출 브랜치: `feat/S15P21C204-145-revocation-retry` → `develop`. 위 기준 SHA에서 분기한 E-11 단일 스토리이며 이전 누적 브랜치를 기반으로 하지 않는다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01.
- blockedOn: B의 실제 발급·종료 흐름 조립, F-01 공식 예산·시험 환경과 검증된 Cloud revocationProfile, F의 실제 회수·429·배포 볼륨 회귀. E-12 부팅 조립과 E-14 운영 라우트는 후속 스토리다.
- 원격 작업: 이번 실행에서는 푸시·MR 생성·병합·Jira 변경을 수행하지 않는다. 사용자가 이 스토리를 develop에 병합한 후 최신 develop에서 다음 E 스토리를 시작한다.

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
