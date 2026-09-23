# GitLab 로그인과 운영자 이메일 목록

2026-09-23 결정(S15P21C204-367): 로그인 게이트는 **lab.ssafy.com GitLab에 로그인한 계정 전체**를
통과시킨다(SSAFY 공개). `/demo`, `/showcase`, `/api/demo-admin`, `/api/showcase`는 같은 게이트
뒤에 두되, 운영자 판정은 **게임 서버가 등록 이메일 목록으로** 한다. 이전(2026-09-22)에는 게이트가
이메일 목록을 직접 확인해 게임까지 목록 사용자만 들어올 수 있었다. 설정 담당 F의 배포 검토 대상이다.

## 판정과 신원

- `compose.sso.yaml`은 `EMAIL_DOMAINS='*'`로 로그인 계정 전체를 허용하고, `GITLAB_PROJECTS`를
  빈 값으로 지정해 기존 env 파일의 프로젝트 제한을 덮어쓴다. GitLab provider, 검증된 이메일 요구,
  PKCE, 콜백과 신원 헤더는 유지한다. OAuth scope는 `openid profile email`이다.
- 일반 경로는 `X-SSO-User`(로그인 사용자)를 덮어써 넘기고, 서버는 그 해시로 계정당 방 하나·자리
  하나를 센다(S15P21C204-366).
- 관리 경로는 `X-Demo-Admin`을 **로그인 이메일**로 덮어쓴다. 서버는 `DEMO_ADMIN_EMAILS_FILE`
  (`/etc/kkakkung/sso-access/allowed-emails.txt`, 호스트 `/opt/kkakkung/sso-access` 읽기 전용
  마운트)에 그 이메일이 있을 때만 받는다. 요청마다 파일을 다시 읽으므로 목록 수정에 재시작이
  필요 없다. 경로가 없거나 파일을 읽을 수 없으면 관리 경로는 아무도 통과시키지 않는다.
- `/demo` 화면 자체는 로그인한 누구나 받을 수 있지만, 방을 여는 API가 목록 밖 계정을 401로
  거절하므로 데모·쇼케이스를 열 수 없다.

목록에는 GitLab OAuth가 반환하는 이메일을 한 줄에 하나씩 쓴다(대소문자 무시, 빈 줄·`#` 주석 무시).
초대·커밋 이메일과 다를 수 있다. 저장소 예시는 아무도 허용하지 않는다. 실제 목록은 서버에서만
관리한다.

## 운영 적용 순서

순서를 지키지 않으면 관리 경로가 SSAFY 전체에 잠시 열린다.

1. 목록 파일을 확인한다. 게임 서버 컨테이너(비루트)가 읽을 수 있어야 한다.

   ```bash
   sudo install -d -m 755 /opt/kkakkung/sso-access
   sudoedit /opt/kkakkung/sso-access/allowed-emails.txt
   sudo chmod 644 /opt/kkakkung/sso-access/allowed-emails.txt
   ```

2. 이 변경이 들어간 앱을 배포한다(Jenkins). 이 시점부터 서버가 관리 경로의 목록을 확인한다.
   게이트가 아직 목록을 보고 있어 사용자 입장에서는 달라지는 것이 없다.
3. 등록된 운영자로 `/demo`에서 방이 열리는지 확인한다. 실패하면 목록 경로·권한을 먼저 고친다.
4. 게이트를 교체한다. 앱 Jenkins 배포는 별개 프로젝트인 이 SSO 컨테이너를 갱신하지 않는다.

   ```bash
   sudo install -m 644 infra/compose.sso.yaml /opt/kkakkung/sso/compose.sso.yaml
   sudo docker compose -f /opt/kkakkung/sso/compose.sso.yaml config --quiet
   sudo docker compose -f /opt/kkakkung/sso/compose.sso.yaml up -d --force-recreate oauth2-proxy
   sudo docker logs --tail 20 kkakkung-sso
   ```

   `restart`만으로 Compose 환경 변수 변경은 적용되지 않는다. 비밀 env 전체나 콜백 URL 쿼리를
   공유 로그에 출력하지 않는다.

## 실제 인수

- 목록 밖 lab.ssafy.com 계정이 새 브라우저 세션으로 로그인해 게임에 들어오고 방을 만들 수 있다.
- 같은 계정이 `/api/demo-admin/rooms`, `/api/showcase/rooms`에서 401을 받는다.
- 등록된 운영자는 `/demo`와 `/showcase`에서 방을 연다. 목록에서 지운 뒤 다시 시도하면 401이다.
- 익명 요청과 위조 `X-Demo-Admin`은 통과하지 못한다. `/api/operations`의 외부 404는 유지한다.

로컬 계약 시험은 설정과 라우팅, 서버 판정만 검사한다. 실제 GitLab 로그인, 파일 가독성, 운영 반영은
위 서버 인수로 별도 기록한다. 되돌릴 때는 백업한 이전 `compose.sso.yaml`로 게이트를 재생성하면
게이트가 다시 목록을 확인한다(앱의 목록 확인은 그대로 두어도 된다).

**미확인**: lab.ssafy.com에 로그인할 수 있는 계정이 현재 SSAFY 교육생만인지(이전 기수·강사 계정
포함 여부)는 확인하지 않았다.
