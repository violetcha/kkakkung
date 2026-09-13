# 운영 감사와 명령 대기 상한

관련 Jira: [S15P21C204-206](https://ssafy.atlassian.net/browse/S15P21C204-206), K01 / W14.
[HTTP 요청 상한](http-resource-limits.md)에 더해 운영 명령 접수 이후와 반복 오류 기록을 제한한다.

## 오류 이벤트 보관

- `operations-audit.json`의 오류 events는 최근 24시간, 최대 4,096개 표본을 보관한다.
  시작 시와 다음 durable 쓰기 때 오래된 표본을 정리한다. 유휴 상태에서 삭제 타이머를 돌리지 않는다.
- 동일 kind/고정 resultCode의 반복 오류는 60초에 첫 표본 하나를 기록한다.
  첫 쓰기가 늦어지면 60초가 지나도 같은 Promise를 공유하며 완료 전에 후속 쓰기를 쌓지 않는다.
  실패한 첫 쓰기를 성공으로 숨기지 않으며 공유한 호출도 그 실패를 받는다.
- 키는 고정 enum 조합만 사용한다. 공격자가 보낸 requestId·토큰·원문 오류로 집계 키를 늘리지 않는다.
  인증 실패와 잘못된 입력의 임의 식별자/원문은 기존과 같이 저장하지 않는다.
- `operations.audit.events`는 유효한 오류 관측마다1, `operations.audit.coalesced`는 합친 관측마다1이다.
  `operations.audit.retained`는 현재 보관한 표본 수다. 모두 수치이며 수집 누락은 기존
  `observability.dropped`로 확인한다. 이 계수는 모든 오류의 영구 원본 보관을 뜻하지 않는다.

운영 명령의 pending·최종 결과·requestId fingerprint를 담은 **entries는 삭제하지 않는다**.
이력에서 지운 requestId를 새 명령으로 실행하거나 이미 확정된 결과를 바꾸지 않는다.
파일 version/checksum 및 `entries`/`events` 형식은 유지하므로 이전 이미지도 읽을 수 있다.
명령 결과의 장기 인덱스와 미디어 journal/usage/retry 전체 축약은 별도 K02다.

## 명령 접수와 과부하

controller는 대기/실행 중 명령, 종료되지 않은 backend Promise와 지연 감사 쓰기를 합산해
64를 접수 상한으로 사용한다. 같은 작업을 보수적으로 중복 계수할 수 있다.
실행/감사 완료 전에는 HTTP 연결 종료나 명령 시간 초과만으로 점유를 없애지 않는다.
기존 requestId의 조회/동일 재접수는 상한 중에도 기존 결과를 반환한다.

일반 명령이 포화됐어도 drain용 여유 한 개를 둔다. 임계 이후 새 명령은
`429 {"code":"OPERATIONS_BUSY"}`, `Retry-After: 1`을 반환한다.
이 요청은 접수되지 않았으므로 여유가 생기면 같은 requestId로 다시 보낼 수 있다.
과부하 자체로 readiness를 영구 LOCKED로 바꾸지 않는다. 실제 감사 쓰기 실패·시계 오류는
기존처럼 잠그며, 명령 시간 초과는 DRAINING과 실패 결과로 남는다.

`operations.queue.pending`은 위 합산값, `operations.queue.rejected`는 과부하 거절 건수다.
이미 허용된 작업이 다음 단계로 진행하며 잠시 합산값이 접수 임계보다 커질 수 있지만
그때 새 요청을 더 받지 않는다. controller는 timeout 뒤 남은 비동기 작업도 계속 계수한다.

## 검사

느린 실제 파일 rename을 막고 같은 오류1,001건이 한 쓰기를 공유하는지 확인한다.
기존 형식의 4,196개 초과 표본을 복원해 시간/개수 제한과 명령 결과 보존을 검사한다.
실제 로컬 HTTP100개 혼합 요청에서 정상 접수/429·상태 조회·중복 결과·drain 여유와
감사 장애 알림이 오작동하지 않는지 확인한다. 기한이 지난 미완료 파일 쓰기도 상한에 남는다.
실제 Cloud·6대·60세션 부하 인수와 장기 미디어 기록 상한은 이 검사로 대체하지 않는다.
