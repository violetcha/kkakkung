# MVP 인수 증거 형식

2026-09-13, S15P21C204-201 / K03·K04. 이 문서는 [MVP 실행계획](mvp-completion-plan.md)의
인수 결과 판정 형식이다. 상시 배포의 Jenkins/continuous 경로에 수동 갱신이나 새 만료 기한을
추가하지 않는다. 운영 도메인의 팀원 제한은 유지한다.

## 무엇을 판정하는가

- `summary.mvpComplete`: 확정 범위의 필수 11개 관문을 실제 증거로 인수했는가.
- `release.ready`: 같은 빌드의 운영 점검에서 격리·회수·smoke 정리·READY/OPEN·예산을 확인했는가.
- `publication.allowed`: MVP 인수와 운영 점검을 모두 통과했고 대상이 `public`인가.
  `team-only`는 운영 점검을 통과해도 공개 완료가 아니다.
- G3-C와 미정 아이템은 `PRODUCT_DECISION_PENDING`으로 유지하며 통과 수에 합산하지 않는다.

이 도구는 증거의 내용·정합성을 확인한다. 해시가 기록 작성자의 신원이나 실제 장치 사용을
독립적으로 보증하지는 않는다. 실제 실행자가 만든 결과와 수동 관찰 기록을 보관한다.
합성 fixture의 PASS를 실제 인수 파일로 복사하지 않는다.

## manifest와 파일 경계

```json
{
  "headCommit": "<판정할 실제 checkout의 40자리 SHA>",
  "gates": [
    {
      "gate": "G1-A",
      "status": "NOT_RUN",
      "sourceCommit": "<실제 실행 소스 SHA>",
      "environmentRef": "ec2",
      "evidenceRefs": [],
      "evidenceSha256": {}
    }
  ]
}
```

PASS/FAIL을 선언할 때 `evidenceRefs`는 JSON **파일**의 상대 경로이며 `evidenceSha256`은
그 경로를 키로 하는 SHA-256 값이다. 디렉터리·빈 파일·깨진 JSON·허용 루트 밖 경로·심볼릭
링크 탈출·중복 관문/참조는 인수하지 않는다. 파일당 최대 32MiB다. 파일 바이트를 한 번 읽어
그 바이트의 해시와 JSON을 함께 검증한다.

CLI는 실제 `git rev-parse HEAD`와 루트 `pnpm-lock.yaml`의 해시를 직접 읽는다.
manifest의 자기 신고 HEAD나 `sourceCommitIsFeatureBranch`로 다른 빌드를 통과시키지 않는다.
병합 후 SHA가 바뀌면 해당 최종 빌드의 인수 결과가 필요하다. 일반 상시 배포의 통과 조건과는
별개이며, 이 규칙 때문에 매번 사람에게 운영 파일 갱신을 요구하는 구조로 되돌리지 않는다.

```bash
node scripts/verify-mvp-evidence.mjs --gates .local/qa/mvp-gates.json --input .local/qa --report docs/verification.md
```

출력은 `QA-13.json`과 보고 문서다. 모든 필수 관문과 공개 조건이 충족돼야 exit 0이며,
팀원 제한 상태·미실행·차단·불일치는 nonzero와 구체 사유로 남는다. 이 도구는 공개 설정이나
배포 상태를 변경하지 않는다.

## 관문 JSON 내용

모든 관문 증거에는 다음 필드를 기록한다.

| 필드                                                | 내용                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `evidenceVersion`                                   | `1`                                                                          |
| `scope`                                             | `confirmed-mvp`                                                              |
| `gate` / `result`                                   | 해당 관문과 실제 `PASS` 또는 `FAIL`                                          |
| `sourceCommit` / `lockfileHash` / `protocolVersion` | 실행한 제품 빌드의 실제 값. protocol은 현재 `0.2.0`                          |
| `environment`                                       | `local-fixture`, `cloud-poc`, `ec2` 중 실제 실행 환경                        |
| `recordedAt`                                        | 시간대가 있는 실제 ISO 시각. 미래 시각과 실행 종료보다 이른 보고 시각은 거절 |
| `executionMode`                                     | 아래 관문별 실행 방식                                                        |

| 관문       | 실행 방식과 원시 결과                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1-A/B/C/D | `cloud`. 각 `tests/cloud/g1-*.cloud.test.ts`의 실제 Vitest JSON 보고서                                                                                             |
| G3-A/B     | `product-integration`. `tests/contracts/g3-room.test.ts` 보고서                                                                                                    |
| G3-D       | `product-integration`. `tests/contracts/g3-overload.test.ts` 보고서                                                                                                |
| G4         | `cloud`. `g4-packets.test.ts`, `g4-bundle.test.ts`, `g4-metadata.cloud.test.ts` 보고서 모두                                                                        |
| G5         | `real-devices`. `records: { devices, matches }`에 [6대 5판 원시 기록](../tests/fixtures/manual-six-device.md) 전체                                                 |
| G2/G6      | `cloud`. `integratedEvidence`에 [10방 원시 측정](integrated-load-evidence.md)의 `run`, `windows`, `unresolvedRetirements`, `officialAfter`, `observedRequirements` |

G1/G2/G4/G5/G6는 `local-fixture`로 인수할 수 없다. G3의 제품 규칙 회귀를 Cloud 권한
시험으로 대체하지 않는다. Cloud 시나리오가 현재 BLOCKED라면 그대로 남기며, 형식만 맞춘
성공 파일을 만들지 않는다. 실제 시나리오 생산자 연결은 실행계획 W06에서 계속한다.

네이티브 시험 보고서는 `testReports` 배열에 담는다. 각 보고서는 필수 파일만 선택해 실행한
Vitest `--reporter=json --outputFile=...`의 `testResults/assertionResults`,
`numTotalTests/numPassedTests/numFailedTests/numPendingTests/success`를 그대로 보존한다.
필수 파일의 assertion이 없거나 skipped/pending, 개수와 결과가 불일치하면 인수하지 않는다.
G5는 수동 원시 기록을 다시 검증하고 G2/G6는 같은 900초의 원시 창을 다시 계산한다.
요약 파일의 `PASS`나 manifest의 숫자만으로 통과시키지 않는다.

`capacity`에 적은 숫자는 `declaredCapacity`로만 보관한다. G6 원시 측정이 통과한 경우에만
`withMediaRooms=10`을 보고한다. 게임 단독 부하는 이 형식의 인수 대상에 아직 연결하지 않았으므로
`gameOnlyRooms=0`은 **인수된 증거 없음**이며 실제 수용 인원이 0이라는 뜻은 아니다.
게임 단독 실측 보고서는 기존 QA-10 결과를 따로 보관한다.

## 운영 점검 증거

manifest의 `publication`에는 `evidenceRef`와 `evidenceSha256`을 기록한다. 참조 JSON은
위 공통 헤더의 `scope: operations-release`, `environment: ec2`, `result: PASS`와 함께
다음 실제 점검값을 가진다. manifest의 이전 boolean 필드만으로는 인수하지 않는다.

- `audience`: `team-only` 또는 `public`
- `operatingMode`: `continuous` 또는 `attested`
- `isolationVerified`, `smokeCleanupConfirmed`: 실제 확인 후 `true`
- `unresolvedRetirements`: `0`
- `readiness`, `admission`: `READY`, `OPEN`
- continuous: 실제 설정 예산의 `serviceBudgetStatus: within-limit`
- attested: 유효한 `officialBudgetCheckedAt`, 아직 지나지 않은 `officialBudgetExpiresAt`

continuous에는 attested의 공식 확인 만료를 적용하지 않는다. 같은 팀 전용 상시 서비스의
배포 준비와 일반 공개 인수는 별도로 보고한다. 이 문서의 새 인수 보고서는 런타임 설정 파일이나
운영 비밀을 대체하는 파일이 아니다.
