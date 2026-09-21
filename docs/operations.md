# 운영

2026-09-15 기준. 실제 서비스는 https://j15c204.p.ssafy.io 이며 GitLab 프로젝트 멤버(Reporter 이상)만 접속한다. 파이프라인·배포 장벽·호스트 구성·비밀값·롤백 명령은 [인프라 안내](../infra/README.md)가 기준이다. 이 문서는 서버가 운영 중에 지키는 정책과 장애 시 판단 기준을 정리한다.

## 1. 운영 모드와 설정

| 구분             | continuous — 상시 서비스(기본)             | attested — 기간 한정 시험(과거 방식) |
| ---------------- | ------------------------------------------ | ------------------------------------ |
| 설정 파일        | `service-operations.json` version 2        | `runtime-evidence.json` version 1    |
| 서비스 종료 날짜 | 없음                                       | `publicWindow`                       |
| 사용량 집행      | LiveKit 공급자 할당량                      | 공식 잔량 확인값과 용도별 로컬 예약  |
| 공식 잔량 보고   | `null`(알 수 없음, 무한으로 해석하지 않음) | 확인한 공식 잔량에서 예약 차감       |
| 예약 해제        | 해당 미디어 세대의 실제 회수 확인 후       | 회수 확인 + 새 공식 checkpoint 대조  |
| DP-06 계획       | 배포 SHA·lockfile별 자동 생성              | 승인한 preflight에서 파생            |

- `service-operations.json`: `operatingMode: continuous`, `budgetPolicy: provider-quota`, 프로젝트·namespace·Cloud origin, 확정자·시각, `evidenceRefs.namespaceOwnership`. `expiresAtEpochMs`·`officialBudget`는 거절한다. 실제 값은 운영 호스트 `/opt/kkakkung/runtime-evidence/`에만 둔다.
- `capability-report.json`: 실제 SDK 버전·프로젝트·권한 모드 검사 결과. SDK나 권한 모드를 바꿀 때만 다시 검증한다.
- 서버는 두 파일을 매초 비동기로 확인하고 확인한 사본을 5초 동안 신뢰한다. 검사가 늦어 5초를 넘기면 그동안 권한을 거절하고, 같은 파일을 다시 검증하면 자동 복구한다. 파일 변경·누락·실제 만료·큰 시계 역행은 잠금을 유지한다(`RuntimeEvidence`).
- 시계 역행은 마지막으로 수락한 최대 시각보다 5ms 이내만 허용하고 기준 시각은 낮추지 않는다. 20→18→16→15는 허용, 이어서 14(6ms)는 잠근다.
- 운영 볼륨의 `usage-checkpoint`·journal·회수·감사 파일과 `runtime-first*-consumed.json` marker는 지우거나 초기화하지 않는다. marker가 있으면 설정 id를 바꿔도 최초 설치 권한을 다시 쓸 수 없다.

현재 LiveKit Cloud 프로젝트 `kkakkung`는 Build 플랜이다(2026-09-15 대시보드: 동시 참가자 100, API 분당 10,000, 월 5,000 참가자-분·50GB 고정 한도, 초과 시 차단). 서버에는 월간 청구 잔량 자동 조회와 금액 상한이 없다. 월 사용량 경보는 후속 과제다.

## 2. 제품 설정값

값은 비밀이 아닌 정책으로 [compose.continuous.yaml](../infra/compose.continuous.yaml)·[compose.product.yaml](../infra/compose.product.yaml)에 두고, 배포 러너가 overlay에서 읽어 사전 검사에 넘긴다. 비밀값은 Jenkins Secret file `kkakkung-production-env`에만 둔다.

| 설정                                       | 현재 값                 | 비고                                                                                                                                                     |
| ------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVICE_AUDIENCE` / 입장 방식             | `team` / `gitlab-sso`   | `public`은 guest 입장. public+livekit은 publisher-permissions만 허용                                                                                     |
| `MEDIA_SUBSCRIPTION_MODE`                  | `publisher-permissions` | D-2026-09-15-01. `server-forwarding`(split)은 보류                                                                                                       |
| `MAX_ROOMS` / `MAX_SLOTS`                  | `10` / `60`             | 스키마 상한과 같다(`MAX_SLOTS = MAX_ROOMS × 6`). 게임 단독 60클라이언트 30분은 통과(QA-10), 실제 미디어 단계 부하(QA-11/12)는 미실행                     |
| `ROOM_IDLE_TTL_MS`                         | `600000`(로비 10분)     | 장치 준비·결과·중단 5분, 종료 60초 전 안내                                                                                                               |
| `MEDIA_MAX_NORMAL/TOTAL_API_CALLS_PER_60S` | 운영 120 / 180          | 설정 상한 6,000 / 9,000(`MEDIA_API_CEILINGS`). 기본값 600 / 900                                                                                          |
| API 경보                                   | total 설정의 90%        | 180이면 162. warning이라 로그에만 남고, 외부로는 429부터 알린다(6장 외부 알림)                                                                           |
| `DEMO_ROOMS`                               | `1`(켜짐)               | 관리자 시연용 데모 방. 운영 토큰이 있어야 하고, 열려 있는 동안 방 수 예산에서 한 방을 쓴다                                                               |
| `PRODUCT_MAP_TEMPLATE`                     | `maze-v1`               | 본경기 맵. 통로 1칸 미로가 기본(267·302). 개방 격자 `master-v1`도 인증되어 있어 골라 쓸 수 있다. `maps/<id>.json`과 `placements/<id>-fallback.json`이 짝 |

`NODE_ENV=production`은 거절하며 제품 배포도 `NODE_ENV=development`, `SERVER_PROFILE=product`, `MEDIA_MODE=livekit`을 쓴다.

### 관리자 데모 방 열기

홈에 진입점이 없으므로 주소를 `scripts/open-demo.mjs`로 받는다. `DEMO_ROOMS=1`과 `OPS_TOKEN`이 함께 있어야 하고, 토큰은 환경변수로만 준다(명령행 인자는 프로세스 목록에 보인다).

```bash
OPS_TOKEN=... node scripts/open-demo.mjs \
  --base-url http://127.0.0.1:2567 --public-url http://127.0.0.1:5173 --role runner
```

주소에 살아 있는 세션이 들어 있어 내 기기(loopback)에서만 화면에 찍고, 그 밖의 대상은 `--output`으로 비공개 파일(0600)에 쓴다. 실패는 원인별로 답한다: `DEMO_UNAVAILABLE`은 `DEMO_ROOMS=0`, `CAPACITY`는 방 예산 소진(열린 데모 방을 닫는다), `401`은 토큰이다. 데모 방도 `MAX_ROOMS`를 함께 쓰므로 열려 있는 동안 실제 경기가 쓸 수 있는 방이 하나 줄어든다.

## 3. 배포와 헬스

배포 순서: 매니페스트(SHA·digest) → SSO 격리 확인 → drain → 이미지 교체 → `/health/ready` → resume/OPEN → 실제 Cloud DP-06(1방·6 합성 클라이언트, 시험 600초+정리 60초, 계획 유효 30분) → 공개 재검사 → last-good 기록. 실패하면 새 requestId로 다시 drain한 뒤에만 이전 digest로 복귀하며, 조건을 확인할 수 없으면 `ROLLBACK_BLOCKED`로 둔다. 세부 장벽은 [인프라 안내](../infra/README.md)의 “배포 장벽”을 따른다.

- **drain은 진행 중 경기·연습·입장 대기가 모두 0이어야 끝나고, 최대 5분까지 기다린다**(S15P21C204-291). 경기가 없으면 즉시 끝나 배포 시간이 달라지지 않는다. 경기가 돌고 있으면 그 판이 끝날 때까지 기다리며, 그동안 새 입장은 막힌다. 곧 교체될 서버에 사람을 더 들이지 않는 것이다. drain 중에는 `startCountdown`이 admission OPEN을 요구하므로 재경기로 시작되는 새 라운드는 없다.
- `/health/live`는 프로세스 생존, `/health/ready`는 복구·저널·예약·capability 준비다. READY만으로 입장하지 않고 admission=OPEN이 따로 필요하다.
- 배포 성공은 해당 실행의 `release.json=READY`, 실행 이미지 SHA, READY/OPEN, 미해결 회수 0을 대조해 확인한다. CI 성공·MR 병합·배포 성공은 각각 다르다.
- 사전 검사: `node --import tsx scripts/product-release.mjs --check-only --operating-mode continuous --env-file /opt/kkakkung/production.env --evidence-dir /opt/kkakkung/runtime-evidence --sha "$RELEASE_SHA"`. `PREPARED`는 입력 검증일 뿐이다.

### 공개 대상 전환 (team ↔ public)

두 곳을 함께 바꿔야 한다. 호스트 nginx의 audience 조각과 배포의 `--audience`다. 하나만 바꾸면 compose만 public일 때는 SSO가 계속 막아 아무도 못 들어오고, nginx만 public일 때는 도달은 하지만 서버가 입장을 거절한다.

**순서는 nginx가 먼저다.** 배포 장벽이 `--audience public`일 때 공개 URL의 `/api/config`가 200이기를 요구하기 때문에, 조각을 바꾸지 않고 배포하면 `AUDIENCE_MISMATCH`로 멈춘다. 그 사이 잠깐 로그인 없이 도달하지만 서버가 team 모드라 입장은 거절된다. **알리기 전에 끝내야 하는 이유가 이것이다.**

```bash
# 1) 공개로 연다
sudo install -m 644 infra/nginx/audience-public.conf /etc/nginx/snippets/kkakkung-audience.conf
sudo nginx -t && sudo systemctl reload nginx
# 2) 현재 대상을 기록한다. 이후 Jenkins 자동 배포가 이 값을 따라간다(없으면 team 으로 되돌아간다)
echo public | sudo tee /opt/kkakkung/audience
# 3) 같은 이미지로 audience 만 바꿔 배포한다 (Jenkins 대신 호스트에서 직접)
DEPLOY_PROFILE=product node --import tsx scripts/product-release.mjs \
  --env-file /opt/kkakkung/production.env --evidence-dir /opt/kkakkung/runtime-evidence \
  --preflight /opt/kkakkung/cloud-preflight.json --sha "$RELEASE_SHA" --audience public
```

되돌릴 때는 반대다. **문을 먼저 닫는다.** 조각을 team으로 되돌려 reload하고, `echo team | sudo tee /opt/kkakkung/audience` 로 기록을 바꾼 뒤 `--audience team`으로 다시 배포한다.

`/opt/kkakkung/audience`는 배포가 대상을 잃지 않게 하는 유일한 장치다. 이 파일과 nginx 조각이 어긋나면 배포가 `AUDIENCE_MISMATCH`(조각이 team인데 public 배포) 또는 `ISOLATION_UNVERIFIED`(조각이 public인데 team 배포)로 멈춘다. 멈추는 쪽이 맞다.

확인할 것 세 가지다. 공개 주소가 로그인 없이 열리고(`/api/config` 200), 공개 주소로 운영 API에 닿지 않고(`/api/operations/status` 404), 운영자는 loopback으로 여전히 닿는다.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://j15c204.p.ssafy.io/api/config
curl -s -o /dev/null -w '%{http_code}\n' https://j15c204.p.ssafy.io/api/operations/status
```

운영 API는 **두 대상 모두** 바깥에서 404다. 운영자는 호스트에서 `127.0.0.1:8080`으로 쓴다.

## 4. 요청과 기록의 상한

**HTTP 입구**(S15P21C204-204). JSON 파싱 전에 운영·미디어 경로를 분류해 제한한다. 거절은 `429/RATE_LIMITED`.

| 종류               | 키                  | 1초 키별 / 전체 | 동시 HTTP / 미완료 처리기 |
| ------------------ | ------------------- | --------------- | ------------------------- |
| 무인증·잘못된 인증 | 신뢰 프록시 기준 IP | 5 / 20          | 4 / 4                     |
| 정상 운영 인증     | 운영 그룹           | 60 / 120        | 16 / 16                   |
| 정상 미디어 세션   | 내부 세션 ID        | 12 / 240        | 128 / 128                 |

본문 2,048바이트, 헤더 후 본문 완료 5초(`408/BODY_TIMEOUT`). 키 저장은 차원별 4,096개이며 토큰 원문은 보관하지 않는다. LiveKit webhook raw body는 사전 파싱에서 제외하고 서명을 검증한다.

**게스트 방 점유**(S15P21C204-293). 게스트가 만든 방은 만든 출처(IP)를 기록하고, 같은 출처가 **동시에 2개**까지만 열어 둘 수 있다. 넘으면 `429 TOO_MANY_ROOMS`로 거절한다. 서비스가 찬 `503 CAPACITY`와 다른 사실이라 따로 답한다 — 자기 방을 닫으면 바로 다시 열 수 있다. 팀(SSO) 입장은 사람이 식별되고 한 IP 뒤에 여러 명이 있을 수 있어 이 상한의 대상이 아니다. 상한은 `SlotRegistry`의 `maxRoomsPerOwner`이며 기본 2다.

**방 수명은 사람이 들어올 때만 는다.** 초대 링크를 회전해도 로비 체류 기한이 갱신되지 않는다. 예전에는 갱신돼서, 아무도 없는 방을 10분마다 한 번 돌리는 것만으로 영원히 붙잡을 수 있었다.

**운영 명령과 감사**(S15P21C204-206). 대기·실행·미완료 쓰기를 합산해 64를 넘으면 `429 OPERATIONS_BUSY`(`Retry-After: 1`)로 거절하고 drain 여유 1개를 남긴다. `operations-audit.json`의 오류 표본은 최근 24시간·최대 4,096개, 같은 종류 반복 오류는 60초에 한 번만 쓴다. 명령 결과 entries는 지우지 않는다.

**미디어 런타임 캐시**. 발급·전환·회수 요청과 제어 알림은 캐시별 4,096개·완료 후 10분, Generation은 4,096개이며 REVOKED·사용량 반환·경기 종료·토큰 만료 뒤 10분이 지나야 제거한다. 미확인 회수 세대는 보존한다.

**내구 이력 축약**(S15P21C204-209). 유지보수 루프가 READY이고 경기·입장 대기가 없을 때 분당 최대 1회, 256묶음씩 처리한다. 모든 조각이 RELEASED, 회수·사용량 확인 뒤 24시간, JWT 만료, 관련 저널·retry가 REVOKED인 묶음만 journal checkpoint → retry 정리 → 공유 retry 제거 → usage 누계 기록 순서로 축약한다. 중간 종료는 다음 기동에서 남은 증거로 재검증한다.

## 5. 재시작 복구

- 기동 시 저널의 모든 과거 방에 대해 참가자 조회·회수·삭제·최종 조회를 수행한다(방 N개에 최소 `3N+2`회). 한 단계 최대 4개 병렬, 공유 API 예산 대기는 65초까지 허용한다. 실시간 권한 회수와 직후 부재 확인의 대기 기한은 1초다.
- 회수·정산이 끝나고 원래 JWT 만료와 마지막 확인 뒤 10분(+검증된 시계 오차·1초)이 지난 방은 처음과 마지막 전체 방 목록 조회로 부재를 확인한다. 240방이 722회에서 2회로 줄었다. LiveKit이 연결된 참가자 토큰을 갱신하므로 원래 JWT 만료만으로 생략하지 않는다.
- 진행 중 경기는 복원하지 않는다. 회수가 확인되지 않으면 발급과 좌석 반환을 잠근 채 `REMOTE_RETIREMENT_UNCONFIRMED`로 남긴다.

## 6. 장애 대응

| 상황                                                                  | 대응                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 회수 기록은 모두 REVOKED인데 Cloud 조회만 실패해 LOCKED               | 인증된 운영 `checkpoint` 명령으로 전체 조회를 다시 한다(최대 180초). 조건: DRAINING, 경기·연습·입장 0, 기록 무결성·단일 writer·소유권 유효, 새 세대 없음. 성공 뒤에도 `resume`를 따로 접수·확인한다                                                                             |
| 이전 drain은 성공했지만 새 서버가 한 번도 입장을 못 연 최초 기동 실패 | `product-release.mjs --recover-failed-startup <실패 태그>`. 실행 이미지·기동 시각·신규 발급 없음·저널 불변·정상 종료·writer 해제·호스트 백업을 모두 확인한 뒤 수정 이미지가 전체 복구와 배포 장벽을 다시 통과해야 한다. 압축된 저널·신규 발급·재시작된 프로세스는 대상이 아니다 |
| 준비 단계(MAP_FINALIZING·GAME_LOADING) 실패                           | 아래 명령으로 서버 구조화 이벤트를 읽는다. 참가자 화면의 “내 준비 대기” 항목과 대조한다                                                                                                                                                                                         |
| Cloud 자격 오류·할당량 소진·기록 손상·SHA 불일치                      | 계속 차단한다. 숫자 변경, 성공 파일 생성, 빈 원장 재생성으로 풀지 않는다                                                                                                                                                                                                        |

```bash
docker logs --since 1h kkakkung-game 2>&1 | grep -E '"event":"(room.phase|room.preparation_failed|room.command_rejected|room.load_ready|media.prepare_failed|media.api.failed|media.retirement.unresolved|media.webhook|media.policy.uncertain)"'
```

- `room.preparation_failed`: `outcome`(ABORTED 또는 DEVICE_CHECK 복귀), `reason`(`LOADING_TIMEOUT`, `MAP_FINALIZING_TIMEOUT`, `LAYOUT:…`, `MEDIA_PREPARE:…`), 로딩 집계.
- `room.command_rejected`: READY·PRACTICE_READY·LOAD_READY·REMATCH 거절 코드와 지점(gate·queue·apply). 실패 시 `room.load_ready`가 0건이면 클라이언트가 보고하지 않은 것이다.
- `media.*`: 세대 준비 실패, 회수 미결 사유, LiveKit API 실패(메서드·HTTP 상태), webhook 수신 결과.

운영 HTTP 순서: `GET /api/operations/status` → `POST /api/operations/commands {requestId, action}`(202는 접수) → `GET /api/operations/commands/<requestId>`로 종결 확인. 운영 토큰은 서버 신뢰 경로에서만 쓰고 브라우저로 넘기지 않는다.

### 외부 알림

| 경로                                               | 알리는 것                                                                                                                       | 시점                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 서버 → `ALERT_WEBHOOK_URL`                         | critical 경보: `READINESS_LOCKED`·`MEDIA_API_RATE_LIMITED`·`JOURNAL_NOT_WRITABLE`·`MEDIA_RETIREMENT_UNRESOLVED`·`TICK_OVERLOAD` | 발생 즉시. 해제는 60초 유지 뒤, 같은 경보 재발생은 5분 간격. 전달 전에 이미 풀린 경보는 "일시 경보"로 한 번                       |
| Jenkins `kkakkung-watchdog` → `mattermost-webhook` | 서비스 무응답(컨테이너 없음·중지·unhealthy, `/health/live` 실패), 게임 서버 비정상 재시작, 복구                                 | 5분마다 확인. 무응답은 연속 2회부터, 지속 중에는 1시간마다 다시. 재시작은 같은 컨테이너의 RestartCount 증가만(배포는 새 컨테이너) |

- warning 경보는 로그에만 남는다. 수동 해제 경보(회수 미확인·틱 과부하)는 서버에 해제 경로가 없어 발생 알림만 가고 재기동까지 켜져 있다.
- 전달 실패는 `alert.notify.failed`(경보 id·코드만)로 남고 60초 뒤 다시 보낸다. 감시 잡은 전달에 실패하면 상태를 저장하지 않아 다음 회차에 다시 보낸다. 웹훅 URL은 메시지·오류·로그에 남지 않는다.
- Docker는 unhealthy 컨테이너를 재시작하지 않는다. 멈춘 서버는 감시 알림을 받고 사람이 재시작한다.
- 켜기: `kkakkung-production-env`에 `ALERT_WEBHOOK_URL`(선택 `ALERT_WEBHOOK_CHANNEL`)을 넣고 재배포한다. 비어 있으면 경보는 로그에만 남는다. 감시 잡은 [Jenkins 설정 11장](../infra/jenkins/SETUP.md#11-서비스-감시-잡-s15p21c204-288).
- 호스트 자체가 죽으면 두 경로가 함께 멈춘다. 호스트 밖 감시는 없다.

## 7. 남은 운영 과제

- 게스트 공개 대상(W07): ingress·배포 manifest가 같은 audience를 선택하고, 같은 이미지로 team→격리 public→team 리허설. 운영 도메인 제한은 유지.
- 게스트 남용 방어(방 생성 IP 제한 외 추가 정책), LiveKit 월 사용량 경보.
- 호스트 외부 백업과 실제 복원 훈련. 호스트 자체 장애는 외부 알림도 함께 멈춘다(호스트 밖 감시 없음).
- Docker 메모리·CPU·PID 상한이 없다. 실제 게임·미디어·CI 조건에서 상한과 회복을 검증한다.
- 단일 모드의 공유 방 첫 예약 fsync와 첫 journal 기록 사이 종료 공백.
- 준비 단계 30초 반복 실패(S15P21C204-231)의 원인 확정. 재경기 뒤 입장 503(S15P21C204-236)은 로컬에서 재현되지 않았다. 재발하면 `/api/sessions` 응답, matchmake 오류 코드, 운영 status의 readiness·admission, room phase를 같은 시각으로 남긴다([B 인계](handoffs/B.md)).
- 운영 방 수 상향: 게임 단독 60클라이언트 30분 → 실제 Cloud 1→3→5→10방 → 검증된 단계만큼 `MAX_ROOMS` 배포(S15P21C204-251).
- Trivy HIGH/CRITICAL은 기록만 하고 배포를 막지 않는다. 실제 노출 경로 검토와 예외 기준이 필요하다.
