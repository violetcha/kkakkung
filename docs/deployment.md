# 배포

2026-09-13 재검토 · 코드 기준 develop `dab788ac9e6c205bcdbb800dc8b095b626a7f737`. 현재 제품은 인증·LiveKit 미디어·지속 저널·사용량 예약·이전 세대 복구와 Jenkins 배포 경로가 연결된 팀 테스트용 프로토타입이다. 제품 범위와 일반 공개 전 과제는 [현행 기획서](spec/current.md), 실제 운영 설정과 명령은 [인프라 안내](../infra/README.md)와 [상시 운영](continuous-operations.md)을 따른다. 이번 요청은 [실행계획 재검토](mvp-plan-review-2026-09-13.md)와 문서 갱신이며 제품 구현 중단 상태를 유지한다.

2026-09-13 09:48 KST 확인에서 Jenkins 제품 배포 #96 SUCCESS, release READY, 운영 READY/OPEN과 게임·웹 동일 `dab788ac` revision 및 DP-06 실제 Cloud PASS를 확인했다. #95는 `DP06_SERVER_CLEANUP_FAILED`를 기록하고 정상 rollback한 실패 이력으로 보존한다. 이 코드는 DP-06 finally의 서버 drain/resume 정리 블록을 가리키며 세부 원인·재발 조건은 아직 확정하지 않았다. 이전 `99f90baa`의 배포 상태를 기록한 문서와 당시 증거를 최신 실행 증거로 재사용하지 않는다.

같은 커밋에서 빌드한 정적 web-proxy와 Node game-server 두 컨테이너를 배포한다. 호스트 Nginx가 HTTPS/WSS와 GitLab 프로젝트 멤버 인증을 처리하고 Node 포트는 내부 네트워크에 둔다. health는 프로세스 생존(`/health/live`)과 복구·저널·예약 등의 서비스 준비(`/health/ready`)를 분리한다. READY만으로 입장을 허용하지 않으며 별도의 admission=OPEN과 외부 접근 조건도 충족해야 한다.

현재 제품 배포는 `SERVER_PROFILE=product`, `MEDIA_MODE=livekit`, `NODE_ENV=development`를 사용한다. `NODE_ENV=production` 값은 설정 파서에서 거절하며 이를 제품 기능 미구현과 혼동하지 않는다. 기본 배포 운영 모드 continuous는 일일 운영 증명 갱신이나 서비스 종료 날짜를 요구하지 않는다. 기존 attested는 기간 한정 공개창·공식 잔량 확인을 유지한다. 두 모드 모두 실제 capability·설정 무결성·지속 기록·미디어 회수 장벽을 검사한다.

Jenkins의 product 배포는 격리 확인 → drain/회수 → 이미지 교체 → initialize/복구 → READY → resume/OPEN → 실제 Cloud 합성 6인 smoke → 정리·공개 상태 재검사 → last-good 기록 순서를 따른다. continuous는 SHA/lockfile에 맞는 DP-06 계획을 자동 생성하며 1방·6명·최대 600초 시험과 60초 정리, 30분 유효기간을 사용한다. attested와 다른 Cloud/실장치/부하 시나리오는 해당 승인 계획을 사용한다.

실패 시 접근 제한을 유지하고 재배수·회수 완료 후 이전 digest와 운영 모드로 복귀한다. 미확인 회수를 재시작으로 숨기지 않으며 복귀 조건을 확인할 수 없으면 ROLLBACK_BLOCKED로 남긴다. 커밋 CI 성공·MR 병합·실제 배포 성공은 구분한다. 배포 성공은 해당 실행의 release.json=READY, 이미지 SHA/digest, READY/OPEN·미해결 회수 0을 대조해 확인한다. 코드나 이 문서의 존재는 새 배포 성공 증거가 아니다.

현재 팀 테스트는 프로젝트 Reporter 이상 멤버와 정상 팀원 6명·1방의 내부 미디어 권한 예외에 한정된다. 일반 공개의 미디어 권한 통제·대표 기기 G5·동시 부하 G6 인수는 별도이며 SSO 제거만으로 공개 전환하지 않는다. 실제 참가 순서는 [6인 시험 안내](six-player-test.md)를 따른다.

## 다음 배포·공개 준비의 미완료 범위

정상 배포 한 번의 성공과 다음 조건을 구분한다. 변경·재검증의 순서는 [MVP 실행계획](mvp-completion-plan.md)을 따른다.

- #95 정리 실패의 원인을 실제 실패 기록으로 좁히고 재현·회수·rollback 회귀를 남긴다. #96 성공만으로 일시적 장애였다고 단정하지 않는다.
- 기록 축약·조회 복구 재시도·최대 보관량의 복구 시간과 API 예산을 연결한다. 최초 기동 예외는 [명시된 조건](failed-startup-recovery.md)에서만 사용하며 일반 drain 차단을 제거하지 않는다.
- 현재 로비 TTL 30분을 승인한 10분 목표와 맞추는 설정 변경, normal 120/total 180에 맞는 경보, CPU·메모리·PID 상한, 운영/미디어 HTTP·감사 기록 상한과 외부 복원을 검증한다. 구체 관측은 [상시 운영](continuous-operations.md)에 기록한다.
- 공개 대상의 단일 설정, 게스트·친구 초대, 공개 audience와 배포 격리를 분리하는 경로는 미구현이다. 동일 빌드의 격리 환경에서 팀→공개→팀 복귀를 검증하되 운영 도메인의 팀 제한은 유지한다.
- 공개 미디어 권한, 실제 6대 5판, 실제 단계·10방 부하, 모델 라이선스와 개인정보 안내를 각각 인수한다. G5와 종합 증거 판정기도 이번에 확인한 실패 누락·과거 증거·운영 모드 문제를 먼저 보강한다.

S15P21C204-195는 재검토 시 Jira 진행 중이다. 코드 반영·MR 병합·Jira 완료·배포 성공·실기기 인수의 상태를 각각 기록하며 이 문서 갱신으로 상태를 전환하지 않는다.

## 로컬 개발 Compose

현재 Docker 개발 템플릿은 루트에서 다음 명령으로 구성한다.

```bash
docker compose -f infra/compose.yaml up --build
```

초기 스켈레톤 문서 작성 환경에서는 Docker daemon이 실행 중이지 않아 이미지 빌드와 컨테이너 런타임을 검증하지 못했다. 이는 당시의 기록이며 현재 배포 상태를 뜻하지 않는다. 날짜·SHA별 결과는 [검증 이력](verification.md)을 확인한다.

개발 Compose의 Nginx는 React/API/WebSocket 외에 기존 서버 도구의 `/health`, `/monitor`, `/playground`와 각 하위 자산 경로를 game-server로 전달한다. 직접 서버 도구를 열 때 허용 Origin은 로컬 `localhost:2567`과 `127.0.0.1:2567`을 포함한다. 이 노출은 개발 profile 전용이다.

배포 계약과 기존 작업 번호는 [공통 실행 계약](execution/common.md)과 [F 실행 계획](execution/f-infra-qa.md)의 DP-03·DP-06에서 추적한다. 로컬 health 성공을 제품 배포나 일반 공개 인수 완료로 계산하지 않는다.
