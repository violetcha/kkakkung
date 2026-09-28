# 2. 외부 서비스 정보

까꿍이 쓰는 외부 서비스와, 가입·설정에 필요한 정보다. 비밀 값(키·토큰·시크릿)은 이 문서와 저장소에 적지 않는다. 실제 값은 운영 호스트의 비밀 파일과 Jenkins 크리덴셜에만 있다(1장 1.3·1.6).

## 2.1 요약

| 서비스                | 용도                                  | 필요한 것                                     | 비밀 값 위치                              |
| --------------------- | ------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| LiveKit Cloud         | 얼굴 영상·음성 중계(WebRTC SFU)       | 프로젝트, API Key·Secret, 서버 URL, 웹훅 등록 | `/opt/kkakkung/production.env`            |
| GitLab(lab.ssafy.com) | 소셜 로그인(OAuth), 저장소, CI 트리거 | OAuth 앱, 프로젝트 액세스 토큰, 프로젝트 웹훅 | `/opt/kkakkung/sso.env`, Jenkins 크리덴셜 |
| Mattermost(SSAFY)     | 빌드 실패·서비스 장애·사용량 알림     | 수신 웹훅 URL                                 | Jenkins 크리덴셜, `production.env`(선택)  |
| Let's Encrypt         | HTTPS 인증서                          | 도메인 `j15c204.p.ssafy.io`, certbot          | 호스트 `/etc/letsencrypt`                 |
| AWS EC2               | 서버 호스트 1대                       | SSAFY 제공 인스턴스, 도메인                   | 호스트 접속 키(교육 제공)                 |
| 컨테이너 레지스트리   | 기반 이미지 받기                      | 계정 불필요(공개 이미지)                      | 없음                                      |

소셜 로그인은 GitLab 하나뿐이다. 사진 저장 클라우드, 외부 코드 컴파일, 결제, 지도 API는 쓰지 않는다. 얼굴 인식 모델(MediaPipe)은 외부 서비스가 아니라 저장소에 포함된 파일을 브라우저 안에서 돌린다(2.7).

## 2.2 LiveKit Cloud

참가자의 가공 얼굴 영상과 음성을 중계한다. 게임 서버가 경기·세대마다 연결 권한(토큰)을 발급하고, 누가 누구의 트랙을 받을지 LiveKit 서버 API로 정한다.

**가입과 프로젝트**

1. https://cloud.livekit.io 에 가입하고 프로젝트를 만든다(현재 프로젝트 이름 `kkakkung`, Build 플랜).
2. 프로젝트 Settings → Keys에서 API Key와 Secret을 만든다.
3. 프로젝트 URL을 확인한다(`wss://<프로젝트>.livekit.cloud`, HTTP는 `https://<프로젝트>.livekit.cloud`).
4. Settings → Webhooks에 `https://j15c204.p.ssafy.io/api/livekit/webhook`을 등록하고, 서명 키로 2번의 API Key를 고른다. 서버는 서명이 틀린 웹훅을 401로 거절한다.

**서버에 넣는 값**(`production.env`, 다섯 개를 모두 넣거나 모두 뺀다)

| 변수                    | 값                                 |
| ----------------------- | ---------------------------------- |
| `LIVEKIT_HTTP_URL`      | `https://<프로젝트>.livekit.cloud` |
| `LIVEKIT_WS_URL`        | `wss://<프로젝트>.livekit.cloud`   |
| `LIVEKIT_API_KEY`       | API Key                            |
| `LIVEKIT_API_SECRET`    | API Secret                         |
| `LIVEKIT_PROJECT_ALIAS` | 프로젝트 별칭(로그·운영 식별용)    |

**플랜 한도와 사용량 관리**

- Build 플랜(2026-09-15 대시보드): 동시 참가자 100, API 분당 10,000, 월 5,000 참가자-분·50GB. 한도를 넘으면 LiveKit이 차단한다.
- 서버의 **월 사용량 가드**가 서버가 본 연결 시간을 직접 세어, 남은 분이 300분 이하가 되면 새 경기를 막는다. `LIVEKIT_MONTHLY_MINUTES=5000`과 `LIVEKIT_USAGE_BASELINE=<사용한 분>@<ISO 시각>`을 함께 넣는다. 기준값은 대시보드에서 읽는다.
- Jenkins 잡 `kkakkung-livekit-usage`가 30분마다 사용량을 조회해 Mattermost로 알린다(크리덴셜 `livekit-api-key`, `livekit-api-secret`, `livekit-project-id`, `livekit-usage-baseline-minutes`).
- 운영 구독 방식은 `MEDIA_SUBSCRIPTION_MODE=publisher-permissions`다.
- 브라우저 CSP는 `https://*.livekit.cloud`, `wss://*.livekit.cloud`만 연결을 허용한다.

## 2.3 GitLab(lab.ssafy.com)

### 소셜 로그인(OAuth)

서비스 전체가 GitLab 로그인 뒤에 있다. 호스트의 oauth2-proxy가 로그인을 처리하고, nginx가 로그인한 사용자를 `X-SSO-User` 헤더로 게임 서버에 넘긴다.

1. lab.ssafy.com → 프로필 → Preferences → **Applications**에서 새 앱을 만든다.
   - Confidential: 켬
   - Redirect URI: `https://j15c204.p.ssafy.io/oauth2/callback`
   - Scopes: `openid`, `profile`, `email`, `read_api`
2. 받은 Application ID와 Secret을 `/opt/kkakkung/sso.env`의 `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`에 넣는다.
3. `OAUTH2_PROXY_COOKIE_SECRET`은 `openssl rand -hex 16`으로 만든다(32자 hex. base64 44자는 거절된다).
4. `docker compose -f /opt/kkakkung/sso/compose.sso.yaml up -d`로 띄우고, 로그에 `OAuthProxy configured for GitLab`이 보이는지 확인한다.

- 공개 범위: lab.ssafy.com 계정으로 로그인한 누구나. 계정당 방 하나·자리 하나.
- 데모(`/demo`)·시연(`/showcase`) 방은 같은 로그인 뒤, 운영자 이메일 목록(`/opt/kkakkung/sso-access/allowed-emails.txt`)에 있는 사람만 발급받는다. 목록은 요청마다 다시 읽으므로 고치면 바로 반영된다.

### 저장소와 CI

| 설정                 | 값                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 프로젝트 액세스 토큰 | 개인 계정이 아닌 프로젝트 토큰. Jenkins 크리덴셜 `gitlab-token`(Username with password)                                                        |
| 웹훅(MR 검증)        | Settings → Webhooks, URL `https://j15c204.p.ssafy.io/jenkins/project/kkakkung-mr`, Merge request events만, Secret token은 Jenkins 잡과 같은 값 |
| 웹훅(develop 배포)   | Push events(develop). 웹훅이 끊겨도 Jenkins가 15분마다 폴링한다                                                                                |
| 기본 브랜치          | `develop`(병합 대상이자 배포 입력)                                                                                                             |

## 2.4 Mattermost(SSAFY)

| 알림                     | 설정                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 빌드 실패 DM             | Jenkins 크리덴셜 Secret text `mattermost-webhook`. 받는 사람은 `infra/jenkins/notify-map.json`이 GitLab 사용자명으로 정한다 |
| 서비스 감시(5분마다)     | Jenkins 잡 `kkakkung-watchdog`, 같은 크리덴셜                                                                               |
| LiveKit 사용량(30분마다) | Jenkins 잡 `kkakkung-livekit-usage`, 같은 크리덴셜                                                                          |
| 서버 경보(선택)          | `production.env`의 `ALERT_WEBHOOK_URL`(선택 `ALERT_WEBHOOK_CHANNEL`). 비우면 로그에만 남는다                                |

수신 웹훅은 Mattermost 채널 → 통합 → 수신 웹훅(Incoming Webhook)에서 만든다. URL은 저장소·문서·로그에 적지 않는다.

## 2.5 Let's Encrypt

- 도메인 `j15c204.p.ssafy.io`의 인증서를 certbot(nginx 플러그인)으로 발급한다.
- 호스트 nginx가 `/etc/letsencrypt/live/j15c204.p.ssafy.io/fullchain.pem`, `privkey.pem`을 쓴다.
- 80번 포트는 ACME 경로를 빼고 HTTPS로 넘긴다.

## 2.6 AWS EC2

- SSAFY가 제공한 인스턴스 1대에 Jenkins, 호스트 nginx, oauth2-proxy, 게임 컨테이너(웹·게임 서버)를 모두 둔다.
- 게임 서버는 호스트 포트를 열지 않고, 웹 컨테이너는 `127.0.0.1:8080`에만 묶는다. 인스턴스 방화벽이 1024~65535를 열어 두어 `0.0.0.0`으로 띄우면 외부에 노출되기 때문이다.

## 2.7 외부 서비스가 아닌 제3자 자산

| 자산                             | 출처·권리                                                                                             | 사용                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| MediaPipe Tasks Vision 모델·WASM | Google. 얼굴·자세 모델과 SDK는 Apache-2.0, 손동작 분류 모델의 임베더·분류기 권리는 확인 중(`pending`) | 저장소 `apps/web/public/models`에 포함. 브라우저 Worker에서 얼굴·손·자세 인식. 외부 호출 없음(모델의 통계 전송은 CSP가 막는다) |
| 경기 배경음 `match.mp3`          | Philippe Groarke, _Dark ambiance_, CC BY-SA 3.0                                                       | 경기 중 반복 재생                                                                                                              |
| 기반 컨테이너 이미지             | Docker Hub(`node`, `nginx`, `aquasec/trivy`, `zricethezav/gitleaks`), quay.io(`oauth2-proxy`)         | 계정 없이 공개 이미지를 받는다                                                                                                 |

전체 목록과 고지는 저장소 `docs/third-party-assets.md`와 서비스의 `/licenses/index.html`에 있다.
