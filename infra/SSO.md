# GitLab 로그인과 이메일 허용 목록

2026-09-22 승인: GitLab 로그인 후 운영자가 등록한 이메일만 허용한다. 프로젝트 역할은
조회하지 않는다. `/demo`, `/showcase`, `/api/demo-admin`, `/api/showcase`는 같은 SSO를
유지한다. 일반 게임은 기존 team/public 선택을 따르며, 이 변경 자체는 공개 전환이 아니다.
관련 Jira는 아직 지정되지 않았다. 설정 담당 F의 배포 검토 대상이다.

## 판정과 신원

`compose.sso.yaml`은 `GITLAB_PROJECTS`와 `EMAIL_DOMAINS`를 빈 값으로 지정해 기존 env 파일의
설정을 덮어쓴다. 도메인 허용과 이메일 목록은 OR이므로 `EMAIL_DOMAINS=*`를 추가하면 안 된다.
GitLab provider, 검증된 이메일 요구, PKCE, 콜백과 신원 헤더는 유지한다. 필요한 OAuth scope는
`openid profile email`이다. GitLab 앱이 기존 `read_api` 권한도 가지고 있어도 변경된 요청은
이를 사용하지 않는다. 별도 그룹/allowed-group 제한을 운영 env나 실행 인자로 추가하지 않는다.

목록에는 GitLab OAuth가 반환하는 이메일을 한 줄에 하나씩 쓴다. 초대·커밋 이메일과 다를 수
있다. 저장소 예시는 아무도 허용하지 않는다. 실제 목록은 서버에서만 관리하며 GitLab 권한
회수와 별개로 이메일도 제거해야 한다. 파일이 없으면 프록시 기동이 실패한다.

## 기존 운영 서버 적용

먼저 `/opt/kkakkung/sso-access/allowed-emails.txt`를 준비한다. 실제 전체 허용 목록을
확인하기 전에는 프록시를 교체하지 않는다. 기존 `sso.env`와 그 비밀값은 유지한다.

```bash
sudo install -d -m 755 /opt/kkakkung/sso-access
sudoedit /opt/kkakkung/sso-access/allowed-emails.txt
sudo chmod 644 /opt/kkakkung/sso-access/allowed-emails.txt
sudo test -s /opt/kkakkung/sso-access/allowed-emails.txt
```

목록은 비밀 토큰이 아니며 비루트 컨테이너 사용자가 읽을 수 있어야 한다. 디렉터리 전체를
읽기 전용으로 마운트하므로 편집기가 파일을 교체해도 컨테이너에서 새 파일을 읽을 수 있다.
주석만 있는 파일도 크기는 있으므로 운영자는 실제 이메일이 들어 있는지 별도로 확인한다.

기존 Compose 파일을 별도로 백업한 뒤, 검토된 저장소 루트에서 다음을 실행한다.
앱 Jenkins 배포는 별개 프로젝트인 이 SSO 컨테이너를 갱신하지 않는다.

```bash
sudo install -m 644 infra/compose.sso.yaml /opt/kkakkung/sso/compose.sso.yaml
sudo docker compose -f /opt/kkakkung/sso/compose.sso.yaml config --quiet
sudo docker compose -f /opt/kkakkung/sso/compose.sso.yaml up -d --force-recreate oauth2-proxy
sudo docker logs --tail 20 kkakkung-sso
```

`restart`만으로 Compose 환경 변수와 마운트 변경은 적용되지 않는다. 최초 전환에는 컨테이너
재생성이 필요하다. 이후 목록 수정 시에는 파일 내용 확인 후 같은 컨테이너를 재시작하고
실제 허용·거절을 재검증한다. 비밀 env 전체나 콜백 URL 쿼리를 공유 로그에 출력하지 않는다.

## 실제 인수

- 등록된 팀원과 상속 Maintainer가 각각 새 브라우저 세션으로 로그인해 `/demo`와 `/showcase`
  모두 접근한다. 원래 요청한 화면으로 복귀하는지 확인한다.
- 목록 밖의 GitLab 계정은 로그인 후 403이어야 한다. Guest/Reporter/Maintainer 역할과 무관하다.
- 목록에서 제외한 계정은 기존 세션을 포함해 차단되는지 확인한다.
- 익명 `/api/demo-admin`과 `/api/showcase`는 보호되고 위조 `X-Demo-Admin`으로 통과하지 못한다.
- 일반 서비스는 기존 team/public 상태를 유지한다. 공개 전환 후에도 두 관리자 화면과 API는
  계속 보호되어야 한다. `/api/operations`의 외부 404도 유지한다.

로컬 계약 시험은 설정과 라우팅만 검사한다. 실제 GitLab 로그인, 파일 가독성, 운영 반영과
권한 회수 확인은 위 서버 인수로 별도 기록한다. 실패 시 백업 Compose로 재생성하면 이전
프로젝트 권한 정책으로 복귀하며, 상속 권한 장애도 다시 발생할 수 있다.
