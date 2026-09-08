# E 공개 인계 기록

수정자: **E** · 2026-09-08 · [담당 계획](../e-media-operations.md) · [공통 규칙](../common.md)

이 파일은 팀원 AI가 E의 전체 계획을 다시 읽지 않고 공개 산출물과 요청을 확인하는 장소다. 현재 제출본에는 **E-02 로컬 검증 인계 1건**만 포함한다. 다른 E 작업의 구현·인수 상태를 이 MR에 합산하지 않는다.

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
