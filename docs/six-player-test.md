# 실제 6인 시험 실행

제품 코드는 `SERVER_PROFILE=product`, 미디어는 `MEDIA_MODE=livekit`로 실행한다. `NODE_ENV`는 현재 허용된 `development`를 유지한다. `skeleton` 배포의 health 200은 게임 준비 완료가 아니다. 실제 Cloud 예산·자격·장치 증거가 준비되기 전에는 로컬 검증만 가능하다.

## 배포 전 준비

1. Jenkins에서 검증·빌드할 최종 SHA와 `pnpm-lock.yaml`을 기준으로 F가 실제 시험 preflight를 승인한다. 실제 프로젝트 별칭, 격리 namespace, 공식 잔여 예산, 시험 시간, 기기 계획을 포함해야 한다. 기존 합성 fixture를 복사해 승인 증거로 사용하지 않는다.
2. [E 인계의 MC-01 절차](execution/handoffs/E.md)를 실행해 권한·수신 차단·토큰 회수·정리 결과를 확인한다. 해당 preflight의 case/evidenceDir을 명령과 일치시킨다. 실패하거나 미확인인 결과를 SUPPORTED로 변경하지 않는다.
3. Jenkins의 Secret file `kkakkung-production-env`에 [운영 환경 예시](../infra/production.env.example)의 실제 값과 정책을 설정한다. `SERVICE_NAMESPACE`는 모든 증거와 같아야 한다. 배포용 SSO 쿠키는 별도 Secret text `kkakkung-smoke-cookie`에 둔다. 운영 토큰은 private env의 `OPS_TOKEN` 하나를 서버와 배포 러너가 함께 사용한다.
4. 서버 `/opt/kkakkung/runtime-evidence/`에 검토한 `capability-report.json`, `official-usage-input.json`, `runtime-evidence.json`을 배치한다. 마지막 파일은 namespace 소유·초기 설치/감사 근거와 공식 checkpoint 해시를 연결한다. [증거 형식](../server/src/config/RuntimeEvidence.ts)을 따른다. 호스트 Jenkins와 컨테이너 node UID 1000이 읽을 수 있게 접근 권한을 부여한다. 세 파일은 제품 overlay가 읽기 전용으로 마운트하며 저널·회수 기록은 기존 operations 볼륨에 유지한다.
5. `/opt/kkakkung/cloud-preflight.json`은 DP-06 승인 파일이다. 연결된 device manifest와 증거 디렉터리도 실제 실행 경로에서 접근 가능해야 한다. 1방 6명, 300초 시험과 30초 정리 예약 및 공개 시간이 필요하다. 배포·복구 시간도 고려해 승인자가 시간을 정한다. 공개 시간이 남지 않으면 사전 검사가 차단한다.
6. 호스트 [nginx 설정](../infra/nginx/host.conf)을 검토·적용하고 LiveKit의 webhook 목적지를 `https://j15c204.p.ssafy.io/api/livekit/webhook`으로 설정한다. 이 정확한 POST 경로만 SSO를 우회하며 서버의 서명·본문 검증은 유지한다. 나머지 앱·운영 API는 SSO를 유지한다. `/api/dev-sessions`는 외부에서 차단한다.

설정·배포는 운영자가 별도로 적용해야 한다. 이 구현 변경만으로 원격 Jenkins, nginx, LiveKit 설정이 바뀌지 않는다.

## 읽기 전용 사전 검사와 배포

배포 러너의 저장소 루트에서 Node 24.19.0, pnpm 11.19.0 및 의존성을 준비한다. `SMOKE_COOKIE`는 승인된 비밀 환경에서 주입하고 출력하지 않는다. `RELEASE_SHA`는 검증·이미지 빌드한 실제 전체 SHA다.

```bash
node --import tsx scripts/product-release.mjs \
  --check-only \
  --env-file /opt/kkakkung/production.env \
  --evidence-dir /opt/kkakkung/runtime-evidence \
  --preflight /opt/kkakkung/cloud-preflight.json \
  --sha "$RELEASE_SHA"
```

`PREPARED`는 입력 검사 통과이며 실제 Cloud나 배포 성공이 아니다. 누락·만료·프로젝트/namespace 불일치·공식 예산 불일치는 BLOCKED다. 사전 검사는 최초 설치/감사 marker를 소비하지 않는다.

Jenkins **Build with Parameters → RELEASE_PROFILE=product**로 해당 develop SHA를 실행한다. 기본값 skeleton은 계속 미디어 비활성화다. 제품 배포는 사전 검사 후 private env를 설치하고 제품 Compose overlay, 복구, resume, DP-06 Cloud smoke, 공개 상태 재검사를 수행한다. 수동 경로는 같은 러너를 사용한다.

제품 배포 이후의 업데이트도 반드시 product를 선택한다. 기존 제품 서버에 skeleton 배포를 시도하면 이미지 교체 전에 `PRODUCT_PROFILE_REQUIRED`로 차단한다. 다음 커밋도 새 SHA에 맞는 시험 승인이 필요하다.

```bash
DEPLOY_PROFILE=product ./infra/deploy.sh "$RELEASE_SHA"
```

첫 제품 전환은 이전 last-good 이미지 digest와 skeleton 프로파일 및 실제 health 상태가 일치할 때만 허용한다. 이전 운영 API가 503인 제품 서버를 skeleton으로 간주하지 않는다. 이전 프로파일 기록이 없으면 과거 release manifest로 검증하며, 그것도 없으면 기존 skeleton 배포를 먼저 정상 검증해 기록한다. 승인 기록을 임의 작성하지 않는다.

병합·코드 빌드와 배포 성공을 구분한다. `release.json`이 READY이고 운영 API가 OPEN/READY, 미해결 회수 0, 공식 예산 최신 상태인 것을 확인한다. `ROLLED_BACK`은 새 배포 성공이 아니다. 실패 시 이전 기록의 프로파일로 복귀하며 `ROLLBACK_BLOCKED`는 운영자 확인이 필요하다.

## 방장과 나머지 5명 입장

6명 모두 **먼저 서비스에 접속해 GitLab SSO 로그인을 완료**한다. 이후 새 초대 링크를 연다. 각자 별도 PC·카메라·이어폰을 준비하고 카메라 권한과 소리 재생을 허용한다. 여러 탭을 6개 실제 기기로 계산하지 않는다.

운영자만 서버에서 다음 명령을 실행한다. `OPS_TOKEN`은 비밀 환경으로 주입한다. `INVITE_EXPIRES_AT_MS`는 승인된 공개 시간 및 INVITE_MAX_TTL_MS 안의 실제 만료 epoch ms다. 로컬 주소는 SSO를 거치지 않지만 운영 토큰 인증은 필수다. 출력 파일은 새 이름을 사용하고 저장소·MR·로그에 넣지 않는다.

```bash
node scripts/issue-team-invitation.mjs \
  --base-url http://127.0.0.1:8080 \
  --public-url https://j15c204.p.ssafy.io \
  --expires-at "$INVITE_EXPIRES_AT_MS" \
  --output /opt/kkakkung/private/host-invitation.json
```

파일의 URL을 방장 1명에게 전달한다. 방장이 닉네임을 입력해 새 방을 만들고 표시된 방 코드를 운영자에게 알려 준다. 이어서 해당 방 입장 전용 링크를 발급해 다른 5명에게 전달한다.

```bash
node scripts/issue-team-invitation.mjs \
  --base-url http://127.0.0.1:8080 \
  --public-url https://j15c204.p.ssafy.io \
  --expires-at "$INVITE_EXPIRES_AT_MS" \
  --room-code "$ROOM_CODE" \
  --output /opt/kkakkung/private/team-invitation.json
```

방 코드가 포함된 링크는 기존 방 입장을 자동 선택한다. 초대 토큰은 URL fragment에서 읽은 즉시 주소에서 지우고 localStorage/sessionStorage에 저장하지 않는다. 링크 권한은 서버가 최종 판정한다. 새로고침 후 토큰이 없어지면 원래 초대 링크를 다시 연다.

## 실제 시험 순서와 기록

1. 2명으로 먼저 입장·카메라 미리보기·보정·소리 재생·퇴장 정리를 확인한다. 실제 장치 실패를 강제로 READY 처리하지 않는다.
2. 기존 방을 정리한 후 6명이 같은 방에 들어가 팀·준비 상태를 확인한다. 장치 검사 → 연습 → 경기 → 결과 → 재경기를 한 흐름으로 진행한다.
3. 연습/경기에서 본인 이동, 다른 참가자 위치, 허용 상대 얼굴/음성, 금지 상대 미수신을 확인한다. 경기에서는 확정된 술래 장비·구속·포획·포즈·종료 판정을 확인한다. 미정 아이템 6개는 시험 완료 수에 포함하지 않는다.
4. 한 명의 일시 연결 끊김과 복귀를 확인한다. 종료·퇴장 후 원격 참가자와 트랙이 남지 않고 이전 토큰으로 재입장할 수 없는지 E/F 증거와 대조한다. 토큰 값·얼굴 영상·음성 원문을 기록하지 않는다.
5. 실패 시 정확한 단계, 참가자 익명 식별자, 브라우저/기기, 시간, 기대/실제 결과, 비밀값 없는 서버 오류 코드만 기록한다. 실패한 경계 수정 후 해당 회귀와 전체 흐름을 다시 실행한다.

로컬 회귀: `pnpm verify`. 빌드된 Worker·고정 모델의 초기화 및 빈 프레임 실제 추론: `node scripts/check-product-assets.mjs` (`pnpm build` 이후). 이 검사는 실제 카메라·얼굴 인식 품질·Cloud 수신 증거가 아니다. 대표 장치 전체 G5/G6와 장시간 부하/복구 인수는 별도 실제 결과로 완료 판단한다.
