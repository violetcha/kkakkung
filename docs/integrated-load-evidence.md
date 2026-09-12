# 10방 통합 부하 증거 형식

Jira [S15P21C204-191](https://ssafy.atlassian.net/browse/S15P21C204-191), MVP W06/W19. 판정 구현은 [TenRoomSchedule](../tests/load/TenRoomSchedule.ts), 파일 소비자는 [집계 CLI](../scripts/summarize-integrated-load.mjs)다. 제품 전송 계약을 바꾸지 않는다.

## 실제 측정의 경계

판정기 시험은 합성 데이터의 계산·거절 동작을 검증한다. JSON 형식 통과는 실제 Cloud 실행의 증명이 아니다. 실제 실행은 승인된 preflight, 동일 소스 SHA/lockfile, 실제 Cloud 표식·게임 이벤트·원격 API 관측, 정리 결과를 함께 보관해야 한다. 10방 러너와 G1·실장치 인수는 별도 작업이다.

## 파일과 필드

같은 시험의 전용 증거 디렉터리에 다음 파일을 기록한다. 기존 수치 합계만 있는 증거는 v2 완료 판정에 사용할 수 없다.

| 파일                  | 필드와 의미                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.json`            | `sourceCommit` 40자리 SHA, `startedAtEpochMs`, `endedAtEpochMs`. 실제 측정 시작과 끝이며 모든 구간은 이 범위 안에 있어야 한다.                                                                                  |
| `windows.json`        | `IntegratedWindow[]`. 원점부터 모든 시간을 중복·겹침·누락 없이 관측한다. 입력 순서는 달라도 시간 순서로 검증한다.                                                                                               |
| `requirements.json`   | 스케줄의 실제 관측 이름 배열. 이 이름만 채우는 것으로 해당 행동의 Cloud trace를 대신하지 않는다.                                                                                                                |
| `cleanup.json`        | `unresolvedRetirements` 0 이상의 정수. 파일 누락·잘못된 값은 정리 관문 실패다.                                                                                                                                  |
| `official-after.json` | `remainingMinutes`, `remainingBytes` 0 이상의 유한 수치 및 `checkedAtEpochMs`. 확인 시각은 해당 측정 종료 이후여야 한다. attested 부하 시험의 공식 잔량이며 continuous 제품 배포의 만료 조건을 추가하지 않는다. |

각 관측 구간은 다음을 포함한다.

- `atSecond`: 측정 원점 기준 시작 시각. `durationSeconds`: 실제 관측한 1–60초의 정수. 짧은 마지막 구간을 자동으로 60초로 계산하지 않는다.
- `tag`: `normal | transitional | reduced | destructive`. 감소·재접속·파괴 구간을 생략하거나 실패 후 정상 구간의 태그를 바꾸지 않는다.
- `rooms`: `{roomId, sessionIds}` 배열. 방 식별자는 재경기에도 유지한다. 세션은 구간 전체에 계속 연결되어 있던 참가자 집합이며, 구간 중 잠깐 연결한 사람을 합산하지 않는다. 수집기는 참가자 변화 시 구간을 나눠야 한다.
- 방·세션 식별자는 시험 안에서만 사용하는 불투명한 라벨이다. 방 코드·초대 토큰·사용자 세션 토큰·실제 개인정보를 기록하지 않는다. 한 방은 최대 6세션, 전체는 최대 10방이다. 같은 세션이 두 방에 중복될 수 없다.
- `concurrentSessions`는 방별 세션 수의 실제 합계다. `normal`은 10방 각 6세션이며, `reduced`는 60세션 미만이어야 한다.
- `apiCalls`, `tooManyRequests`, `policyChanges`, `movementCells`는 0 이상의 정수다. `apiRequestAtSeconds`는 같은 원점 기준 실제 서버 전체 API 요청 시각이며 개수가 `apiCalls`와 같아야 한다. 방 하나의 값을 10배로 환산하지 않는다.
- `effectLatencyMs`는 실제 정책 변경에서 새 표식/차단까지의 유효 지연 표본이다. NaN·무한대·음수는 거절한다.

## 판정과 실행

G2는 정상 구간의 실제 API 시각을 합쳐 이동하는 60초 동안 최대 600회를 확인한다. 1분 경계를 사이에 둔 집중 호출도 포함한다. 429가 없어야 하며 실제 효과 지연 p95 500ms/p99 1초를 유지한다. 60초보다 짧은 정상 구간은 온전한 API 1분을 증명하지 못한다.

G6는 동일한 10방의 각 6세션을 관측한 정상/전환 구간의 유효 시간이 900초 이상이어야 한다. 감소·파괴 구간은 따로 보고하며 60세션 시간에 더하지 않는다. 재접속 공백으로 유효 시간이 줄었다면 preflight의 시간·예산 범위 안에서 추가 관측해야 한다. 예산을 넘겨 자동 연장하지 않는다.

어느 관문이든 실패하거나 미실행이면 `publishHold=true`다. 구조가 잘못되면 계산을 중단하며, 과거 성공 파일을 재사용하지 말고 CLI의 종료 코드를 확인한다.

```bash
node scripts/summarize-integrated-load.mjs --input .local/qa/QA-12 --output .local/qa/QA-12-summary.json
```

모든 관문 통과는 exit 0, 부족한 관측·관문 실패는 exit 1, 누락·손상된 입력은 BLOCKED exit 3이다. 출력에는 증거 형식 2와 소스 SHA/측정 시간이 포함된다. 실제 10방 Cloud 시험과 운영 공개 전환을 이 명령이 실행하지 않는다.
