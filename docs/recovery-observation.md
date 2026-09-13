# 회수 기록의 원격 조회 재검증

관련 Jira: [S15P21C204-205](https://ssafy.atlassian.net/browse/S15P21C204-205), K10 / W14.

미디어 회수 기록이 모두 REVOKED여도 Cloud 방 목록 조회가 실패하면 입장은 잠긴다.
이 경우 UNRESOLVED identity가 없어서 `retry-retirement`로 재시도할 대상이 없을 수 있다.
기존 인증된 운영 `checkpoint` 명령이 아래 조건을 만족할 때 전체 조회를 다시 수행한다.
정상 운영 중 정기 수동 갱신이 생기는 것은 아니며 새로운 API나 운영 명령은 추가하지 않는다.

## 시작·진행 조건

- admission은 DRAINING, 실제 경기·연습·진행 중 입장은 각각 0이다.
- 최초 복원 기록의 무결성과 단일 writer, namespace·Cloud 프로젝트 소유권이 유효하다.
- 이전 실패는 원격 관측 미완료이며 알려진 identity와 모든 재시도 엔진은 REVOKED다.
- 현재 journal은 복원 당시의 기록과 같고 새 세대가 없으며 usage 및 checkpoint가 쓰기 가능하다.
- 이미 진행 중인 복구 검사가 없다. 종료되지 않은 SDK 호출이 있으면 새 검사를 시작하지 않는다.

처음 한 번만 검사하지 않는다. 실제 전송 전·응답 후·사용량 확인 전후·checkpoint 쓰기 전에
시그널, writer, 소유권, 세대와 경기 상태를 다시 확인한다. 오래된 성공 응답으로 잠금을 풀지 않는다.
이미 회수됐다는 로컬 기록만으로 Cloud 확인을 생략하지 않는다.

## 결과와 기한

통신 실패는 `unresolved > 0`으로 유지하고 검증된 로컬 이력 자체를 손상됐다고 바꾸지 않는다.
`historyComplete: true`만으로 READY가 되지 않으며 원격 잔여 방과 미확인 항목도 모두 0이어야 한다.
잘못된 응답 형식·알 수 없는 소유 방/참가자·손상/누락 기록·소유권 상실은 재조회 성공만으로 복원하지 않는다.

이 조건을 만족하는 복구 `checkpoint`만 **접수부터 최대 180초**를 사용한다.
일반 운영 명령은 `operationTimeoutMs`를 유지한다. Cloud 개별 HTTP 응답 기한, 공유 API 예산,
과거 조회의 최대 65초 예산 대기, 실시간 권한 철회의 1초 기한은 바꾸지 않는다.
180초를 넘으면 작업은 실패로 종결되고 지연된 응답은 성공으로 바뀌지 않는다.
오랜 SDK 호출이 끝나기 전까지 복구 검사의 배타성을 유지한다.

성공 후에도 admission은 DRAINING이다. 별도 `resume`가 전체 readiness·예산·인증 조건을 통과해야
입장을 연다. continuous에서는 원격 회수 확인 후 로컬 예약을 해제하며 대시보드 갱신을 요구하지 않는다.
attested에서는 기존 공식 사용량 revision/시각 대조도 계속 통과해야 한다.

## 운영 HTTP 순서

서버의 기존 OPS_TOKEN을 주입하는 신뢰된 운영 경로에서 사용한다. 브라우저로 운영 토큰을 전달하지 않는다.

1. `GET /api/operations/status`에서 DRAINING·LOCKED와 미확인 상태를 확인한다.
2. `POST /api/operations/commands`에 새로운 requestId와 `action: "checkpoint"`를 보낸다.
   접수 ACK는 복구 완료가 아니다. 같은 requestId의 재전송은 기존 작업을 반환한다.
3. `GET /api/operations/commands/<requestId>`로 최대 180초와 응답 전달 시간을 고려해 종결을 확인한다.
   실패·취소 시 기록을 삭제하거나 값을 변경하지 않는다. 조건을 복구한 뒤 새 requestId로 재검증한다.
4. succeeded 이후 READY·미확인 0·DRAINING을 다시 확인하고 별도 `resume`를 접수·종결 확인한다.

최초 기동의 기록 누락 예외는 [별도 복구 절차](failed-startup-recovery.md)를 따른다.
장기 기록 축약과 많은 과거 방에 대한 복구 시간 상한은 K02에 남으며 이 변경만으로 해결되지 않는다.

## 검증 범위

실제 로컬 journal·usage·감사 파일과 운영 controller/bindings, gateway·API 예산을 연결하고
Cloud 전송만 합성했다. 조회 실패 뒤 재검증, 성공 후 별도 resume, 중복 요청·중복 sweep,
손상/새 세대/활성 경기/소유권 상실, 10초 이상 대기·180초 종결·늦은 성공 거절을 검사한다.
운영 서버에 장애를 주입하거나 실제 Cloud 장애 인수를 수행한 증거는 아니다.
