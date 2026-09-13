# 온보딩

2026-09-13 · 코드 기준 `dab788ac`. 제품 흐름과 결정 대기 사항은 [현행 기획서](spec/current.md)를 먼저 확인한다.

## 배포된 팀 게임 테스트

[서비스 메인 주소](https://j15c204.p.ssafy.io/)에서 GitLab 로그인 후 닉네임을 입력한다. 이 프로젝트의 Reporter 이상 멤버만 접속할 수 있으며, 방장은 새 방을 만들고 나머지 5명은 6자리 방 코드로 참가한다. 현재 continuous 배포의 팀원 입장에는 운영자가 발급한 초대 링크가 필요 없다. 6명이 모여야 장치 검사와 경기 준비를 진행할 수 있다. 장치·권한·실제 플레이 확인은 [6인 시험 안내](six-player-test.md)를 따른다.

홈에서 **혼자 장치 점검·조작 체험**을 먼저 이용할 수 있다. 개인 체험은 방·좌석·LiveKit 연결 없이 키보드 이동/회전과 양 역할 행동을 연습한다. 장치 점검 버튼으로 카메라·보정을 사용하고 확인음·선택 마이크 입력 크기·음량도 확인한다. 체험 종료 시 장치·Worker·오디오를 정리하며 실제 방에서는 6인 장치 점검을 다시 진행한다. [개인 체험](solo-practice.md), [소리 점검](audio-controls.md)을 참고한다.

2026-09-13 09:48 KST 배포 #96의 game/web `dab788ac`·READY/OPEN·Cloud DP-06 PASS를 확인했다. 실제 6대·공개 권한·10방 인수는 별도다. 마이크 단독 조작의 카메라 재취득, 재경기 품질/명단 등 [최신 감사](mvp-plan-review-2026-09-13.md)의 잔여 문제를 시험 기록에 남긴다. 현재 구현 중단을 유지한다.

## 로컬 개발·진단

1. Node.js `24.19.0`과 pnpm `11.19.0`을 준비한다. `11.19.0`은 pnpm 버전이며 Corepack 버전이 아니다.
2. 저장소 루트에서 `pnpm install --frozen-lockfile`을 실행한다.
3. `pnpm setup:env`로 비밀값 없는 로컬 환경 파일을 만든다.
4. 첫 브라우저 시험 전에 `pnpm exec playwright install chromium`을 한 번 실행한다. Linux CI에서는 `pnpm exec playwright install --with-deps chromium`을 사용한다.
5. `pnpm dev`를 실행하고 웹 `http://localhost:5173`, 서버 health `http://localhost:2567/health/live`를 연다.
6. 닉네임으로 개발 세션을 만들고 연결 상태와 이동을 확인한다.

개발 세션 토큰은 짧게 유효한 일회성 토큰이다. 로컬 sandbox 편의를 위한 장치이며 운영 인증이 아니다. 브라우저 저장소나 URL에 넣지 않는다.

개발 빌드의 `/`에서 초대 fragment가 없으면 **기존 룸 연동**과 **이동 샘플**을 선택할 수 있다. 기존 kkakkung 진단은 W/S 셀 전진·후진과 A/D 단발 회전, sandbox는 연속 WASD 이동이다. 개발의 `/play`·초대 링크와 배포 빌드는 제품 화면이다. 실제 6인 게임은 product 프로필과 유효한 미디어·입장 설정이 필요하며 [6인 시험 안내](six-player-test.md)를 따른다.

기존 `kkakkung`은 서버의 `/playground`에서도 `move {"seq":1,"dir":"forward"}`, `turn`, `ready` 계약을 확인할 수 있다. Playground의 빈 `{}` 입장은 기존 로컬 호환을 위해 개발 모드에서만 허용하고, React 웹의 두 진단 모드는 일회성 토큰을 사용한다. 기본 개발 서버의 총 Room 용량은 하나이므로 웹 Room을 종료한 뒤 playground 시험을 실행한다. 개발 profile에서 `/health`, `/monitor`, `/playground`를 제공하며 Docker Nginx도 이 경로들을 proxy한다. 제품 profile과 외부 호스트 프록시는 개발 도구 접근을 차단한다.

환경값을 비워 두면 API는 같은 출처 `/api`를 사용하고 Vite가 `127.0.0.1:2567`로 전달한다. API 주소를 바꾸면 `http://127.0.0.1:2567/api`처럼 접두사를 포함한다. 개발 Colyseus 기본값은 `ws://127.0.0.1:2567` 직접 연결이며 production은 같은 출처 루트다.

처음 변경할 때는 [architecture.md](architecture.md)의 의존 방향과 [protocol.md](protocol.md)의 계약을 확인한다. 문제를 재현할 때 사용한 Node/pnpm 버전, 명령, 오류, 브라우저와 변경 파일을 함께 남긴다.
