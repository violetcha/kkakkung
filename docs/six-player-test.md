# 실제 6인 시험 실행

2026-09-13 · 코드 기준 `dab788ac`. 현재 제품 범위·알려진 결함·공개 전 인수 조건은 [현행 기획서](spec/current.md)를 함께 확인한다. 이 안내의 존재는 실제 기기 시험 완료를 뜻하지 않는다.

제품 코드는 `SERVER_PROFILE=product`, `MEDIA_MODE=livekit`, `NODE_ENV=development`로 실행한다. skeleton health 200은 게임 준비 완료가 아니다. 실제 Cloud 자격·권한·장치 검증은 로컬 fixture 통과와 구분한다. 상시 서비스 기본값 continuous의 비용 정책과 운영 파일은 [상시 운영](continuous-operations.md)을 따른다.

현재 확인된 배포는 2026-09-13 09:48 KST Jenkins #96 SUCCESS, game/web `dab788ac`, READY/OPEN과 실제 Cloud 합성 DP-06 PASS다. 실기기 6대 5판·공개 서버 통제·10방 부하는 별도 인수다. 현재 구현 중단 상태에서 문서를 갱신하며 아래 절차를 새로 실행하지 않는다.

## 배포 전 준비

1. Jenkins에서 검증·빌드할 최종 SHA와 pnpm-lock.yaml을 확정한다. continuous의 DP-06 계획은 자동 생성된다. MC-01 등 다른 Cloud/실기기/부하 시험과 attested 모드에는 기존 승인 preflight가 필요하며 합성 fixture를 실제 검증 결과로 사용하지 않는다.
2. [E 인계의 MC-01 절차](execution/handoffs/E.md)를 실행해 권한·수신 차단·토큰 회수·정리 결과를 확인한다. 해당 preflight의 case/evidenceDir을 명령과 일치시킨다. 실패하거나 미확인인 결과를 SUPPORTED로 변경하지 않는다.
3. Jenkins의 Secret file `kkakkung-production-env`에 [운영 환경 예시](../infra/production.env.example)의 실제 값과 정책을 설정한다. `SERVICE_NAMESPACE`는 모든 증거와 같아야 한다. 자동 배포 시험은 [loopback 전용 인증](../infra/README.md#자동-배포-시험-인증)의 `SMOKE_INTERNAL_TOKEN`을 사용한다. 운영 토큰은 private env의 `OPS_TOKEN` 하나를 서버와 배포 러너가 함께 사용한다. 실제 참가자 접속의 SSO는 유지한다.
4. 서버 `/opt/kkakkung/runtime-evidence/`에 실제 capability-report.json과 service-operations.json을 준비한다. [설정 형식](../server/src/config/RuntimeEvidence.ts)을 따르고 호스트 Jenkins와 컨테이너 node UID 1000이 읽을 수 있게 한다. 기존 operations 볼륨의 저널·회수·사용량·최초 사용 marker와 attested 롤백용 official-usage-input.json/runtime-evidence.json을 보존한다.
5. continuous DP-06은 실행마다 검증된 SHA/lock에 맞춰 1방 6명·최대 600초+60초 정리 계획을 생성한다. 30분 유효기간은 해당 자동 시험만 제한하며 다음 배포에서 자동 재생성한다. attested에서는 `/opt/kkakkung/cloud-preflight.json`과 승인된 공개 시간이 필요하다.
6. 호스트 [nginx 설정](../infra/nginx/host.conf)을 검토·적용하고 LiveKit의 webhook 목적지를 `https://j15c204.p.ssafy.io/api/livekit/webhook`으로 설정한다. 이 정확한 POST 경로만 SSO를 우회하며 서버의 서명·본문 검증은 유지한다. 나머지 앱·운영 API는 SSO를 유지한다. `/api/dev-sessions`는 외부에서 차단한다.

설정·배포는 운영자가 별도로 적용해야 한다. 이 구현 변경만으로 원격 Jenkins, nginx, LiveKit 설정이 바뀌지 않는다.

## 읽기 전용 사전 검사와 배포

배포 러너의 저장소 루트에서 Node 24.19.0, pnpm 11.19.0 및 의존성을 준비한다. 시험 자격은 승인된 비밀 환경에서 주입하고 출력하지 않는다. preflight의 자격 이름은 실제 내부 인증 방식과 일치시킨다. `RELEASE_SHA`는 검증·이미지 빌드한 실제 전체 SHA다.

```bash
node --import tsx scripts/product-release.mjs \
  --check-only \
  --env-file /opt/kkakkung/production.env \
  --evidence-dir /opt/kkakkung/runtime-evidence \
  --operating-mode continuous \
  --sha "$RELEASE_SHA"
```

`PREPARED`는 입력 검사 통과이며 실제 Cloud나 배포 성공이 아니다. 누락·프로젝트/namespace/origin 불일치는 BLOCKED다. 만료·공식 예산 대조는 attested에 적용한다. 사전 검사는 최초 설치/감사 marker를 소비하지 않는다.

Jenkins **Build with Parameters → RELEASE_PROFILE=product**로 해당 develop SHA를 실행한다. 현재 Jenkinsfile 기본값도 product다. skeleton은 미디어 없는 진단 배포 선택지다. 제품 배포는 사전 검사 후 private env를 설치하고 제품 Compose overlay, 복구, resume, DP-06 Cloud smoke, 공개 상태 재검사를 수행한다. 수동 경로는 같은 러너를 사용한다.

제품 배포 이후의 업데이트도 반드시 product를 선택한다. 기존 제품 서버에 skeleton 배포를 시도하면 이미지 교체 전에 `PRODUCT_PROFILE_REQUIRED`로 차단한다. 다음 커밋은 새 SHA에 맞는 DP-06을 자동 실행한다.

```bash
DEPLOY_PROFILE=product ./infra/deploy.sh "$RELEASE_SHA"
```

첫 제품 전환은 이전 last-good 이미지 digest와 skeleton 프로파일 및 실제 health 상태가 일치할 때만 허용한다. 이전 운영 API가 503인 제품 서버를 skeleton으로 간주하지 않는다. 이전 프로파일 기록이 없으면 과거 release manifest로 검증하며, 그것도 없으면 기존 skeleton 배포를 먼저 정상 검증해 기록한다. 승인 기록을 임의 작성하지 않는다.

병합·코드 빌드와 배포 성공을 구분한다. release.json=READY, 운영 API=OPEN/READY, 미해결 회수 0, 매니페스트와 동일한 운영 모드를 확인한다. continuous 공식 잔량은 null이다. ROLLED_BACK은 새 배포 성공이 아니다. 실패 시 이전 프로필·운영 모드로 복귀하며 ROLLBACK_BLOCKED는 운영자 확인이 필요하다.

## 방장과 나머지 5명 입장

현재 continuous 배포에서는 6명 모두 **서비스 메인 주소에 접속해 GitLab SSO 로그인을 완료**한다.
프로젝트 Reporter 이상 멤버만 입장할 수 있다. 방장은 닉네임을 입력하고 **새 방 만들기**를 누른다.
나머지 5명은 **친구 방 참가**에서 방장이 알려준 6자리 방 코드를 입력한다.
이 흐름에는 운영자의 초대 링크 발급이 필요 없다.
각자 별도 PC·카메라·이어폰을 준비하고 카메라 권한과 소리 재생을 허용한다.
여러 탭을 6개 실제 기기로 계산하지 않는다.

아래 초대 발급 절차는 기존 invitation 모드와 내부 자동 시험용이다.

운영자만 서버에서 다음 명령을 실행한다. OPS_TOKEN은 비밀 환경으로 주입한다. INVITE_EXPIRES_AT_MS는 INVITE_MAX_TTL_MS 안의 실제 만료 epoch ms이며 attested에서는 공개 시간 안이어야 한다. 로컬 주소에서도 운영 토큰 인증은 필수다. 출력 파일은 새 이름을 사용하고 저장소·MR·로그에 넣지 않는다.

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

방 코드가 포함된 링크는 기존 방 입장을 자동 선택한다. 초대 토큰은 URL fragment에서 읽은 즉시 주소에서 지우고 localStorage/sessionStorage에 저장하지 않는다. 링크 권한은 서버가 최종 판정한다. 새로고침 후 토큰이 없어지면 유효한 원래 링크를 다시 연다. 만료·폐기·서버 재시작으로 거절되면 새 링크를 발급한다. 같은 탭에서 새 초대를 열어도 갱신되며 경기 중에는 현재 참가를 마친 뒤 새 초대를 적용한다.

입장 취소·SDK 연결 실패는 자신의 미사용 예약을 반환한다. 응답 자체를 받지 못해 취소할 수 없는 예약도 60초 뒤 만료된다. 이미 연결된 참가자와 회수 중 좌석은 이 만료로 강제 해제하지 않는다.

## 실제 시험 순서와 기록

입장 전 개인 체험으로 전후진·90° 회전·중립 복귀·양 역할 행동과 확인음·마이크 입력 크기를 점검할 수 있다. 체험 결과를 실제 경기 준비 통과나 G5로 합산하지 않는다. [개인 체험](solo-practice.md), [소리 점검](audio-controls.md)을 따른다.

최종 후보에서는 [최신 감사](mvp-plan-review-2026-09-13.md)의 재경기 품질/명단, 마이크 취득 경계, 개인 결과/역할 안내와 G5 판정 공백을 먼저 처리한다. 196 방장 제어는 현재 미배포 초안이다. 회수 불명으로 MAP_FINALIZING이 무기한 대기하는 결함도 기한·ABORTED/안내 회귀를 거친 뒤 시험한다. 미확인 회수 기록을 삭제하거나 새 발급을 허용해 대기를 해제하지 않는다.

1. 1~5명으로는 로비 입장·취소·퇴장만 확인한다. **6명이 모여야 장치 검사로 진입한다.** 각자 카메라·추론·보정·소리 재생을 확인하고 준비한다. 최초 준비는 키보드 선택 여부와 무관하게 이 장벽을 통과해야 한다. 마이크는 선택이다.
2. 장치 검사 → 연습 → 로딩 → 경기 → 결과를 완주한다. 도망자는 3분 안에 2명 탈출, 술래는 2명 포획 또는 시간 초과가 승리 조건이다. W/S 전진·후진, A/D 단발 90° 회전과 모션 중립 복귀를 확인한다.
3. 허용 상대 얼굴·음성, 금지 상대 미수신, 개인 지도·교환·사건 표시를 확인한다. 장비 선택 후 F를 계속 눌러도 설치가 자동 취소되지 않는지, 손동작을 유지해도 한 번만 실행되는지 확인한다. 구속·자연 만료·포획·포즈를 확인하고 이번 MVP 제외 아이템 6개는 합산하지 않는다. 장기 PRODUCT_DECISION_PENDING 추적은 유지한다.
4. 결과에서 역할 교환 재경기와 같은 팀 재경기를 각각 다음 **결과까지** 진행한다. 로비로 돌아가 1명을 교체한 뒤 6인 완주를 반복한다. 매치 ID 전환, 구 미디어 회수와 새 발급, 결과 초기화를 E/F 기록으로 확인한다.
5. 연습/경기에서 카메라를 끊으면 키보드와 기본 얼굴로 전환되는지 확인한다. 복구 후 ‘장치 다시 연결·점검’ → 새 보정 → 사용자의 모션 선택 순서를 확인한다. 마이크만 끊거나 다시 켰을 때 얼굴·게임 연결은 유지되는지, 소리 재시도가 실제 재생으로 이어지는지 확인한다.
6. **미디어 연결 장애**는 같은 게임 참가를 유지하고 구 Identity 회수 후 새 세대로 복구하는지 확인한다. **PLAYING의 ACTIVE 참가자 게임 소켓 종료**는 GAME_CONNECTION_LOST로 경기를 중단한다. 중단 후 새 방장이 로비로 돌아가 교체 인원을 받아 새 경기를 시작할 수 있어야 한다. 연습 중 이탈은 연습 규칙에 따라 준비 단계로 돌아가는 경로를 확인한다. 종료된 게임 세션의 자동 복귀를 기대하지 않는다.
7. 전체 음량·음소거·상대별 목소리 끄기가 허용된 소리에만 적용되고 서버 금지 수신을 열지 않는지 확인한다. 같은 방 재경기의 설정 유지·퇴장의 초기화, 품질 low의 화면/다음 게시 일치, 카메라 없는 상태의 마이크 단독 조작, 최종 팀/개인 결과와 재경기 명단을 각각 기록한다.
8. 모든 참가자가 퇴장한 뒤 원격 참가자·트랙·로컬 Worker·장치가 남지 않는지 확인한다. 옛 토큰 회수는 E의 실제 Cloud 증거로 판정한다. 토큰·얼굴·음성 원문은 저장하지 않는다.

continuous는 해당 예약의 모든 미디어 세대가 실제로 회수된 것을 확인한 뒤 로컬 예약을 반환한다. 공식 청구 잔량은 알 수 없어 null로 보고하며 공급자 할당량을 따른다. attested는 회수 확인에 더해 공식 사용량 checkpoint 대조가 필요하므로, 예정 경기·연습·재시도 전체와 public bucket 여유를 사전에 확인한다. 두 모드 모두 경기 종료 화면만으로 회수·예산 복원을 확정하거나 BUDGET_EXHAUSTED를 임의로 우회하지 않는다.

각 결과에는 소스 SHA·이미지 digest, 날짜·단계·익명 참가자, OS/브라우저·장치, 네트워크, 기대/실제 결과, 비밀값 없는 오류 코드를 기록한다. 미실행 칸은 NOT_RUN으로 남기고 실제 기기 6대의 결과만 G5에 반영한다. 실패한 경계를 수정한 뒤 해당 회귀와 전체 흐름을 다시 확인한다.

로컬 회귀: `pnpm verify`. 빌드된 Worker·고정 모델의 초기화 및 빈 프레임 실제 추론: `node scripts/check-product-assets.mjs` (`pnpm build` 이후). 이 검사는 실제 카메라·얼굴 인식 품질·Cloud 수신 증거가 아니다. 대표 장치 전체 G5/G6와 장시간 부하/복구 인수는 별도 실제 결과로 완료 판단한다.
