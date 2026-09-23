# 운영

서비스 주소는 https://j15c204.p.ssafy.io 이다. 2026-09-22 승인된 SSO 기준은 GitLab 로그인과 운영자 등록 이메일이다. 기존 프로젝트 Reporter 이상 정책에서의 서버 전환과 검증은 [SSO 절차](../infra/SSO.md)를 따른다. 일반 공개 전환은 별도이며 `/demo`와 `/showcase` 및 각 관리자 API는 공개 이후에도 이 SSO를 유지한다. 파이프라인·배포 장벽·호스트 구성·비밀값·롤백 명령은 [인프라 안내](../infra/README.md)가 기준이다. 이 문서는 서버가 운영 중에 지키는 정책과 장애 시 판단 기준을 정리한다.

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

현재 LiveKit Cloud 프로젝트 `kkakkung`는 Build 플랜이다(2026-09-15 대시보드: 동시 참가자 100, API 분당 10,000, 월 5,000 참가자-분·50GB 고정 한도, 초과 시 차단). 서버는 청구 잔량을 LiveKit에서 읽지 못한다(Build 플랜에 Analytics API 없음). 대신 **월 사용량 가드**가 서버가 본 연결 시간을 직접 세어, 남은 분이 여유 아래로 내려가면 새 경기(연습 진입)를 멈춘다(364, 아래 "LiveKit 월 사용량 가드").

## 2. 제품 설정값

값은 비밀이 아닌 정책으로 [compose.continuous.yaml](../infra/compose.continuous.yaml)·[compose.product.yaml](../infra/compose.product.yaml)에 두고, 배포 러너가 overlay에서 읽어 사전 검사에 넘긴다. 비밀값은 Jenkins Secret file `kkakkung-production-env`에만 둔다.

| 설정                                       | 현재 값                 | 비고                                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVICE_AUDIENCE` / 입장 방식             | `team` / `gitlab-sso`   | `public`은 guest 입장. public+livekit은 publisher-permissions만 허용                                                                                                                                  |
| `MEDIA_SUBSCRIPTION_MODE`                  | `publisher-permissions` | D-2026-09-15-01. `server-forwarding`(split)은 보류                                                                                                                                                    |
| `MAX_ROOMS` / `MAX_SLOTS`                  | `10` / `60`             | 스키마 상한과 같다(`MAX_SLOTS = MAX_ROOMS × 6`). 게임 단독 60클라이언트 30분은 통과(QA-10), 실제 미디어 단계 부하(QA-11/12)는 미실행                                                                  |
| `MAX_ROOMS_PER_ORIGIN`                     | `2`                     | 한 출처(IPv4 주소 또는 IPv6 /64)가 동시에 여는 방 수(300). 공유 NAT는 한 출처로 묶이므로 "한 회선" 기준. `MAX_ROOMS` 미만이어야 부팅                                                                  |
| `MAX_ROOMS_PER_ACCOUNT`                    | `1`                     | 팀 SSO 계정 하나가 동시에 여는 방 수(366). IP가 아니라 계정으로 세므로 캠퍼스 NAT 뒤 팀원끼리 막지 않는다. 초대 링크로 만든 방은 세지 않는다. `MAX_ROOMS` 미만이어야 부팅                             |
| `ROOM_IDLE_TTL_MS`                         | `600000`(로비 10분)     | 장치 준비·결과·중단 5분, 종료 60초 전 안내                                                                                                                                                            |
| `MEDIA_MAX_NORMAL/TOTAL_API_CALLS_PER_60S` | 운영 120 / 180          | 설정 상한 6,000 / 9,000(`MEDIA_API_CEILINGS`). 기본값 600 / 900                                                                                                                                       |
| API 경보                                   | total 설정의 90%        | 180이면 162. warning이라 로그에만 남고, 외부로는 429부터 알린다(6장 외부 알림)                                                                                                                        |
| `DEMO_ROOMS`                               | `1`(켜짐)               | 관리자 시연용 데모 방. 운영 토큰이 있어야 한다. 미디어를 쓰지 않으며 경기·시연 방 예산(`MAX_ROOMS`·`MAX_SLOTS`)과 따로 센다                                                                           |
| `DEMO_MAX_ROOMS`                           | `3`                     | 동시에 열 수 있는 데모 방 수(1~3). 부하 여유는 "경기 방 `MAX_ROOMS` + 데모 방 이 값"으로 본다                                                                                                         |
| `SHOWCASE_ROOMS`                           | `1`                     | 발표 시연 방(`/showcase`)이 동시에 모일 수 있는 수(0~10, 발표 배포는 `3`). 팀원 넷이 2:2 로 고정 소형 미로에서 3분을 뛴다. SSO 만 필요하고, 시연 방마다 `MAX_ROOMS` 예산에서 한 방을 쓴다. `0`이면 끔 |
| `PRODUCT_MAP_TEMPLATE`                     | `maze-v1`               | 본경기 맵. 통로 1칸 미로가 기본(267·302). 개방 격자 `master-v1`도 인증되어 있어 골라 쓸 수 있다. `maps/<id>.json`과 `placements/<id>-fallback.json`이 짝                                              |

### LiveKit 월 사용량 가드

비밀 env 파일(Jenkins `kkakkung-production-env`)에 둘 다 넣어야 켜진다. 하나만 있으면 기동을 거절하고, 둘 다 없으면 꺼진 채 돌며 기동 로그에 `LiveKit monthly usage guard is OFF` 경고를 남긴다.

| 설정                              | 예                            | 뜻                                                                                        |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `LIVEKIT_MONTHLY_MINUTES`         | `5000`                        | 플랜의 월 참가자-분 한도                                                                  |
| `LIVEKIT_USAGE_BASELINE`          | `1307@2026-09-23T10:00+09:00` | 대시보드에서 읽은 사용량과 읽은 시각. 서버는 이 시각 이후만 더한다                        |
| `LIVEKIT_MONTHLY_RESERVE_MINUTES` | 기본 `300`                    | 남은 분이 이 값 이하가 되면 새 연습 진입을 멈춘다. 이미 진행 중인 경기가 끝까지 쓸 여유다 |
| `LIVEKIT_BILLING_CYCLE_DAY`       | 기본 `1`                      | 청구 주기가 바뀌는 날(UTC, 1~28). 이날 누적과 기준값을 버리고 0부터 센다                  |

- 세는 것: 서버가 발급한 세대 중 LiveKit에 붙어 있는 참가자 수 × 시간(250ms 주기). 누적은 운영 볼륨 `livekit-monthly-usage.json`에 30초마다 남아 배포·재시작 뒤에도 이어진다.
- 세지 못하는 것: 이 서버가 발급하지 않은 연결(대시보드 시험, 같은 키를 쓰는 로컬 개발 등). 그래서 **대시보드를 볼 때마다 기준값을 새로 넣는다.** 기준값이 바뀌면 이전 누적은 버리고 새 값부터 센다.
- 막히면 장치 점검 화면에 "이번 달 영상·음성 사용량이 한도에 가까워…"가 뜨고, 운영 상태(`/api/operations/status`)의 `monthlyUsage`에 사용·잔여·여유·`blocked`가 보인다. 열림·닫힘이 바뀔 때만 `media.budget.near_limit` 이벤트를 남긴다. 방장이 다시 시작을 누르면 열린 뒤 바로 들어간다.
- **배포 스모크(DP-06)도 새 경기라 같이 막힌다.** 가드가 닫힌 동안 배포하면 스모크가 실패해 롤백된다. 기준값을 새로 넣거나 다음 주기를 기다린 뒤 배포한다.
- 기존 `remainingMinutes`는 continuous 배포 게이트가 `null`을 요구하므로 이 값과 섞지 않는다.

`NODE_ENV=production`은 거절하며 제품 배포도 `NODE_ENV=development`, `SERVER_PROFILE=product`, `MEDIA_MODE=livekit`을 쓴다.

### 관리자 데모 방 열기

관리자는 서비스의 **`/demo`**에서 역할과 화면 표시 이름을 고른 뒤 데모 방을 연다. 이 경로와
`/api/demo-admin/rooms`는 게임 audience가 `public`이어도 GitLab 로그인·등록 이메일 SSO를 계속
요구한다. SSO를 통과한 호스트 nginx가 관리자 신원을 서버에 다시 쓰므로, 브라우저에는
`OPS_TOKEN`이 전달되지 않는다. 홈에는 이 페이지로 가는 링크가 없다.

호스트 설정을 처음 적용할 때는 `host.conf`와 함께 전용 조각을 설치한다.

```bash
sudo install -m 644 infra/nginx/demo-admin.conf /etc/nginx/snippets/kkakkung-demo-admin.conf
sudo install -m 644 infra/nginx/host.conf /etc/nginx/sites-available/kkakkung
sudo nginx -t && sudo systemctl reload nginx
```

### 발표 시연 방 열기 (`/showcase`)

팀원 넷이 **2:2**로 뛰는 발표용 방이다. 각자 서비스의 **`/showcase`**에서 역할(도망자·술래)과
표시 이름을 고르고 들어가면 지금 열려 있는 시연 방 하나에 모인다(없으면 첫 사람이 연다). 한
역할은 둘까지라 셋째가 같은 역할을 고르면 `ROLE_FULL`로 다른 역할을 고르게 한다. 맵은 소형
(16x16)·고정 시드라 매번 같은 미로와 출구가 나오고, 방장도 맵 크기를 바꿀 수 없다. 경기는 탈출·
포획 수로 일찍 끝나지 않고 3분을 다 뛴 뒤 탈출이 포획보다 많으면 도망자, 아니면 술래가 이긴다.
재경기는 없고 결과 화면이 끝이다. 미디어(카메라·음성)는 일반 경기와 같이 발급된다.

인증은 `/demo`와 같은 GitLab 로그인·등록 이메일 SSO 조각을 쓰고 운영 토큰은 필요 없다. `SHOWCASE_ROOMS`
는 동시에 모이는 중일 수 있는 시연 방 수로 기본 `1`, 발표 배포는 `3`이다. `0`이면 발급 API가 503
`SHOWCASE_UNAVAILABLE`로 답한다. `/showcase`를 연 사람은 빈 자리가 있는 시연 방 중 가장 먼저 열린 방에
앉고, 그런 방이 없으면 모이는 중인 시연 방이 한도 미만일 때 새 방이 열리며, 한도에 닿았으면 503
`CAPACITY`로 기다린다. 시연 방도 데모 방과 달리 `MAX_ROOMS`·좌석 예산에서 방마다 한 방을 쓴다(시연
3개면 일반 방은 `MAX_ROOMS - 3`개). 호스트 nginx에 `/showcase`·`/api/showcase` 위치가 있어야 하므로 처음
배포할 때 `host.conf`를 다시 설치한다.

CLI는 장애 대응·자동화처럼 호스트에서만 쓰는 보조 경로다. `DEMO_ROOMS=1`과 `OPS_TOKEN`이
함께 있어야 하고, 토큰은 환경변수로만 준다(명령행 인자는 프로세스 목록에 보인다).

```bash
OPS_TOKEN=... node scripts/open-demo.mjs \
  --base-url http://127.0.0.1:2567 --public-url http://127.0.0.1:5173 --role runner
```

주소에 살아 있는 세션이 들어 있어 내 기기(loopback)에서만 화면에 찍고, 그 밖의 대상은 `--output`으로 비공개 파일(0600)에 쓴다. 실패는 원인별로 답한다: `DEMO_UNAVAILABLE`은 `DEMO_ROOMS=0`, `DEMO_ROOM_LIMIT`는 다른 데모 방이 아직 열려 있음(그 방에서 라운드를 끝내고 나가거나 2분 뒤 다시), `CAPACITY`는 서버의 세션 예산 소진, `401`은 토큰이다. 데모 방은 경기 방 예산을 쓰지 않으므로 시연 중에도 실제 경기가 쓸 수 있는 방 수는 그대로다.

준비 화면에서 맵 크기를 고른다. 시연은 인형이 덜 걷는 15×15 가 빠르고, 31×31 은 대본 하나에 1~2분이 든다. 목록은 경기에 들어가면 무대 옆 패널에 나오고, 지금 시작할 수 없는 대본은 이유와 함께 잠긴 채 보인다. 관리자를 기다리는 대본은 패널의 "시나리오 취소" 로 라운드를 끝내지 않고 내릴 수 있다.

관리자가 새로고침하거나 잠시 끊겨도 같은 주소로 다시 들어오면 경기 중이라도 그 경기로 돌아간다. 끊긴 뒤 2분 안에 돌아오지 않으면 방을 닫고 데모 방 자리(`DEMO_MAX_ROOMS`)를 돌려준다(데모 라운드는 제한시간이 없어 닫지 않으면 자리를 계속 차지한다).

## 3. 배포와 헬스

배포 순서: 매니페스트(SHA·digest) → SSO 격리 확인 → drain → 이미지 교체 → `/health/ready` → resume/OPEN → 실제 Cloud DP-06(1방·6 합성 클라이언트, 시험 600초+정리 60초, 계획 유효 30분) → 공개 재검사 → last-good 기록. 실패하면 새 requestId로 다시 drain한 뒤에만 이전 digest로 복귀하며, 조건을 확인할 수 없으면 `ROLLBACK_BLOCKED`로 둔다. 세부 장벽은 [인프라 안내](../infra/README.md)의 “배포 장벽”을 따른다.

되돌린 뒤의 확인은 DP-06이 아니라 **HTTP 스모크**(리다이렉트·TLS·live/ready·Origin 허용거부·WSS 입장·정적 MIME)로 한다(S15P21C204-343). DP-06은 배포 잡의 작업 공간에 있는 웹 클라이언트 소스를 실행하는데 롤백이 되돌리는 것은 **이전** 서버 이미지라, 프로토콜이 바뀐 배포를 되돌리면 아무도 쓰지 않을 조합(새 클라이언트 ↔ 옛 서버)을 보고 무조건 실패한다. 실사용자는 web 이미지도 함께 되돌아가 짝이 맞는다. 되돌린 뒤의 `readiness`·`admission`·미정리 세대·예산 재검사는 그대로 돌므로, 복구가 실제로 열렸는지는 여전히 증명된다.

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

확인할 것 세 가지다. 공개 주소가 로그인 없이 열리고(`/api/config` 200), 공개 주소로 운영 API에 **어떤 철자로도** 닿지 않고, 운영자는 loopback으로 여전히 닿는다.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://j15c204.p.ssafy.io/api/config
for p in /api/operations/status /API/OPERATIONS/status /api/operations; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "https://j15c204.p.ssafy.io$p"
done
```

운영 API는 **두 대상 모두** 바깥에서 404다. 운영자는 호스트에서 `127.0.0.1:8080`으로 쓴다.

세 줄이 모두 404여야 한다. 셋을 다 두드리는 이유는 nginx와 Express가 경로를 다르게 읽기 때문이다(S15P21C204-296). nginx의 접두·정확 일치 location은 대소문자를 가리는데 Express는 가리지 않아, `^~ /api/operations/` 하나로는 `/API/OPERATIONS/status`와 슬래시 없는 `/api/operations`가 그대로 앱까지 갔다. 지금은 대소문자를 무시하는 정규식으로 막는다. 배포 장벽도 같은 세 경로를 두드려 하나라도 404가 아니면 `OPERATIONS_PUBLICLY_REACHABLE`로 멈춘다.

### 보안 헤더

CSP를 비롯한 응답 헤더는 **web-proxy 컨테이너**가 붙인다([조각](../infra/nginx/security-headers.conf)). 호스트 nginx는 `proxy_pass`로 받은 헤더를 그대로 흘려보내므로 인터넷까지 그대로 간다. `Strict-Transport-Security`만 TLS를 끝내는 호스트가 붙인다. 두 곳에서 같은 헤더를 붙이면 값이 갈리므로 하지 않는다.

**nginx 함정 하나.** 어떤 `location`에 자기 `add_header`가 하나라도 있으면 바깥 level의 `add_header`를 **전부 잃는다.** 그래서 `Cache-Control`을 따로 붙이는 경로마다 조각을 다시 `include`한다. 계약 시험이 이 누락을 잡는다.

CSP 값은 실제 프로덕션 빌드를 브라우저로 돌려 정했다. 다시 확인하려면:

```bash
pnpm --filter @kkakkung/web build && node scripts/check-security-headers.mjs
```

비전 Worker·MediaPipe WASM 추론·폰트·캔버스에 도달하면서 위반이 0건이어야 한다. `'unsafe-eval'`은 필요 없다 — Zod 4의 JIT가 `new Function`을 쓰는 것을 웹 진입점에서 껐다(서버는 매 tick parse하므로 그대로 둔다). 이 스크립트는 LiveKit 실제 연결과 Colyseus WebSocket까지는 확인하지 못한다. `connect-src`의 해당 항목은 설정 검토로 남는다.

## 4. 요청과 기록의 상한

**HTTP 입구**(S15P21C204-204). JSON 파싱 전에 운영·미디어 경로를 분류해 제한한다. 거절은 `429/RATE_LIMITED`.

| 종류               | 키                  | 1초 키별 / 전체 | 동시 HTTP / 미완료 처리기 |
| ------------------ | ------------------- | --------------- | ------------------------- |
| 무인증·잘못된 인증 | 신뢰 프록시 기준 IP | 5 / 20          | 4 / 4                     |
| 정상 운영 인증     | 운영 그룹           | 60 / 120        | 16 / 16                   |
| 정상 미디어 세션   | 내부 세션 ID        | 12 / 240        | 128 / 128                 |

본문 2,048바이트, 헤더 후 본문 완료 5초(`408/BODY_TIMEOUT`). 키 저장은 차원별 4,096개이며 토큰 원문은 보관하지 않는다. LiveKit webhook raw body는 사전 파싱에서 제외하고 서명을 검증한다.

**게스트 방 점유**(S15P21C204-293). 게스트가 만든 방은 만든 출처(IP)를 기록하고, 같은 출처가 **동시에 2개**까지만 열어 둘 수 있다. 넘으면 `429 TOO_MANY_ROOMS`로 거절한다. 서비스가 찬 `503 CAPACITY`와 다른 사실이라 따로 답한다 — 자기 방을 닫으면 바로 다시 열 수 있다. 상한은 `SlotRegistry`의 `maxRoomsPerOwner`이며 기본 2다. 팀(SSO)은 IP가 아니라 **계정**으로 센다(366): 한 계정이 연 방은 `MAX_ROOMS_PER_ACCOUNT`(기본 1)개까지이고, 서비스 전체에서 **자리도 하나**다. 다른 창에서 접속 중이면 `409 ALREADY_IN_ROOM`, 아직 접속하지 않은 예약은 새 요청으로 교체한다. 일반 세션은 연결이 끊기면 바로 무효가 되므로 창을 닫으면 곧바로 다시 들어올 수 있다.

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
docker logs --since 1h kkakkung-game 2>&1 | grep -E '"event":"(room.phase|room.preparation_failed|room.command_rejected|room.load_ready|room.heartbeat_stall|room.media_uncertain_released|room.uncaught_exception|process.fault|media.prepare_failed|media.api.failed|media.retirement.unresolved|media.webhook|media.policy.uncertain)"'
```

- `room.preparation_failed`: `outcome`(ABORTED 또는 DEVICE_CHECK 복귀), `reason`(`LOADING_TIMEOUT`, `MAP_FINALIZING_TIMEOUT`, `LAYOUT:…`, `MEDIA_PREPARE:…`), 로딩 집계.
- `room.command_rejected`: READY·PRACTICE_READY·LOAD_READY·REMATCH 거절 코드와 지점(gate·queue·apply). 실패 시 `room.load_ready`가 0건이면 클라이언트가 보고하지 않은 것이다.
- `room.heartbeat_stall`: 서버가 하트비트 간격(2초) 이상 멈췄다가 재개됨. `durationMs`는 멈춘 길이, `count`는 그 시간을 침묵으로 세지 않은 연결 수. 이때 연결을 끊지 않으므로 방이 해체되지 않는다.
- `room.media_uncertain_released`: 결과를 모르는 미디어 준비(커서 없는 TIMEOUT 등)로 잡혀 있던 방을 놓아줌. `reason`은 `round-ended`(새 라운드가 이전 경기를 E에 넘김)·`disposed`(방 폐기)·`expired`(330초 경과, E의 세대 수명 300초 뒤). 자주 보이면 준비 실패 원인을 `media.prepare_failed`에서 찾는다.
- `room.uncaught_exception`: 방의 메시지 처리·타이머·수명 주기에서 잡히지 않은 예외. `name`은 Colyseus 메서드 이름, `reason`은 원인 메시지. 경기 중(TEAM_PRACTICE~PLAYING)이면 그 방만 `SERVER_TICK_OVERLOAD`로 중단되고, RESULT·ABORTED와 입장 실패(`onJoin` 등)는 결과를 바꾸지 않는다. 입장 거절(`ServerError`)은 기록하지 않는다.
- `process.fault`: 어느 방에서도 잡히지 않은 예외(`name`=`uncaughtException`·`unhandledRejection`). 기록 뒤 방을 한 번 정리하고(최대 10초) 종료 코드 1로 끝나며 `restart: unless-stopped`가 다시 띄운다.
- `media.*`: 세대 준비 실패, 회수 미결 사유, LiveKit API 실패(메서드·HTTP 상태), webhook 수신 결과.

운영 HTTP 순서: `GET /api/operations/status` → `POST /api/operations/commands {requestId, action}`(202는 접수) → `GET /api/operations/commands/<requestId>`로 종결 확인. 운영 토큰은 서버 신뢰 경로에서만 쓰고 브라우저로 넘기지 않는다.

### 외부 알림

| 경로                                                    | 알리는 것                                                                                                                       | 시점                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 서버 → `ALERT_WEBHOOK_URL`                              | critical 경보: `READINESS_LOCKED`·`MEDIA_API_RATE_LIMITED`·`JOURNAL_NOT_WRITABLE`·`MEDIA_RETIREMENT_UNRESOLVED`·`TICK_OVERLOAD` | 발생 즉시. 해제는 60초 유지 뒤, 같은 경보 재발생은 5분 간격. 전달 전에 이미 풀린 경보는 "일시 경보"로 한 번                                                                             |
| Jenkins `kkakkung-watchdog` → `mattermost-webhook`      | 서비스 무응답(컨테이너 없음·중지·unhealthy, `/health/live` 실패), 게임 서버 비정상 재시작, 복구                                 | 5분마다 확인. 무응답은 연속 2회부터, 지속 중에는 1시간마다 다시. 재시작은 같은 컨테이너의 RestartCount 증가만(배포는 새 컨테이너)                                                       |
| Jenkins `kkakkung-livekit-usage` → `mattermost-webhook` | LiveKit Cloud Analytics API의 현재 월 참가자-분이 4,000/4,500/5,000분 임계치에 도달, API 인증·429·timeout 실패                  | 30분마다. 사용량은 session detail의 `connectionMinutes`를 세션별 최대값으로 누적하고, 첫 실행은 대시보드 기준값을 요구. Build 플랜에서는 Analytics API가 제공되지 않아 `BLOCKED`로 알림 |

- warning 경보는 로그에만 남는다. 수동 해제 경보(회수 미확인·틱 과부하)는 서버에 해제 경로가 없어 발생 알림만 가고 재기동까지 켜져 있다.
- 전달 실패는 `alert.notify.failed`(경보 id·코드만)로 남고 60초 뒤 다시 보낸다. 감시 잡은 전달에 실패하면 상태를 저장하지 않아 다음 회차에 다시 보낸다. 웹훅 URL은 메시지·오류·로그에 남지 않는다.
- Docker는 unhealthy 컨테이너를 재시작하지 않는다. 멈춘 서버는 감시 알림을 받고 사람이 재시작한다.
- 켜기: `kkakkung-production-env`에 `ALERT_WEBHOOK_URL`(선택 `ALERT_WEBHOOK_CHANNEL`)을 넣고 재배포한다. 비어 있으면 경보는 로그에만 남는다. 감시 잡은 [Jenkins 설정 11장](../infra/jenkins/SETUP.md#11-서비스-감시-잡-s15p21c204-288), LiveKit 사용량 잡은 [12장](../infra/jenkins/SETUP.md#12-livekit-사용량-잡-s15p21c204-304)의 별도 호스트 작업이다.
- 호스트 자체가 죽으면 두 경로가 함께 멈춘다. 호스트 밖 감시는 없다.

## 7. 남은 운영 과제

- 게스트 공개 대상(W07): ingress·배포 manifest가 같은 audience를 선택하고, 같은 이미지로 team→격리 public→team 리허설. 운영 도메인 제한은 유지.
- 게스트 남용 방어(방 생성 IP 제한 외 추가 정책), LiveKit 월 사용량 경보의 실제 플랜·자격 증명·수신 영수증 확인. 잡 코드와 절차는 준비됐지만 현재 Build 플랜에서는 공식 Analytics API가 제공되지 않아 대시보드 확인이 선행된다.
- 호스트 외부 백업과 실제 복원 훈련. 호스트 자체 장애는 외부 알림도 함께 멈춘다(호스트 밖 감시 없음).
- Docker 메모리·CPU·PID 상한이 없다. 실제 게임·미디어·CI 조건에서 상한과 회복을 검증한다.
- 단일 모드의 공유 방 첫 예약 fsync와 첫 journal 기록 사이 종료 공백.
- 준비 단계 30초 반복 실패(S15P21C204-231)의 원인 확정. 재경기 뒤 입장 503(S15P21C204-236)은 로컬에서 재현되지 않았다. 재발하면 `/api/sessions` 응답, matchmake 오류 코드, 운영 status의 readiness·admission, room phase를 같은 시각으로 남긴다([B 인계](handoffs/B.md)).
- 운영 방 수 상향: 게임 단독 60클라이언트 30분 → 실제 Cloud 1→3→5→10방 → 검증된 단계만큼 `MAX_ROOMS` 배포(S15P21C204-251).
- Trivy HIGH/CRITICAL은 기록만 하고 배포를 막지 않는다. 실제 노출 경로 검토와 예외 기준이 필요하다.
