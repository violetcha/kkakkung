# E 공개 인계 기록

수정자: **E** · 2026-09-09 · [담당 계획](../e-media-operations.md) · [공통 규칙](../common.md)

이 파일은 팀원 AI가 E의 전체 계획을 다시 읽지 않고 공개 산출물과 요청을 확인하는 장소다. 최신 작업은 **E-14 로컬 검증 인계**다. E-13 MR !27의 develop 병합을 확인했고 이번 기준 SHA는 `56d9691114f4b7919b81c00a27773871c78ba671`이다. E-01~E-13은 병합 이력이며 아래 이전 항목은 당시 검증·인계를 보존한다. 병합과 최종 기능 인수는 구분한다.

## E-14 / OP-07 — 제한 공개창과 운영 제어

- Jira: [S15P21C204-148](https://ssafy.atlassian.net/browse/S15P21C204-148).
- localStage: **LOCAL_VERIFIED**. 최종 인수: **BLOCKED**.
- 구현 commit: `0a289b329efcad7511c15da92418f013eb24aaaa`.
- 제출 브랜치: `feat/S15P21C204-148-operator-commands` → `develop`. E-13 MR !27 병합 후 `56d9691114f4b7919b81c00a27773871c78ba671`에서 분기했다. 예전 누적 `feat/S15P21C204-148-operations-control`은 이번 제출 대상이 아니다.
- 계약 기준: EXEC-CONTRACT-3 / D-2026-09-08-01.
- blockedOn: B 실제 운영 라우트/HTTP 공통 경계·활동 집계·입장 조립, F OPS_TOKEN/공개창·공식 잔량과 revision 근거·감사 이력 최초 생성 증빙/지속 볼륨, E-15 전체 product readiness/factory, 실제 Cloud/격리 배포 검증.
- 이번 실행은 E-14 하나다. E-15~E-16 구현·푸시·MR 생성·원격 병합·Jira 변경은 하지 않았다. 사용자가 병합한 뒤 최신 develop에서 E-15를 시작한다.

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
