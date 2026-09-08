# 온보딩

1. Node.js `24.19.0`과 pnpm `11.19.0`을 준비한다. `11.19.0`은 pnpm 버전이며 Corepack 버전이 아니다.
2. 저장소 루트에서 `pnpm install --frozen-lockfile`을 실행한다.
3. `pnpm setup:env`로 비밀값 없는 로컬 환경 파일을 만든다.
4. 첫 브라우저 시험 전에 `pnpm exec playwright install chromium`을 한 번 실행한다. Linux CI에서는 `pnpm exec playwright install --with-deps chromium`을 사용한다.
5. `pnpm dev`를 실행하고 웹 `http://localhost:5173`, 서버 health `http://localhost:2567/health/live`를 연다.
6. 닉네임으로 개발 세션을 만들고 연결 상태와 이동을 확인한다.

개발 세션 토큰은 짧게 유효한 일회성 토큰이다. 로컬 sandbox 편의를 위한 장치이며 운영 인증이 아니다. 브라우저 저장소나 URL에 넣지 않는다.

새 React 웹의 기본 선택인 **기존 룸 연동**은 `kkakkung`을 사용한다. 준비 버튼과 phase·role·남은 시간을 확인하고, `W/S`로 셀 전진/후진, `A/D` 키 눌림으로 한 번씩 좌/우 회전한다. 선택기의 **이동 샘플**은 `sandbox`의 연속 20Hz WASD 이동이다.

기존 `kkakkung`은 서버의 `/playground`에서도 `move {"seq":1,"dir":"forward"}`, `turn`, `ready` 계약을 확인할 수 있다. Playground의 빈 `{}` 입장은 기존 로컬 호환을 위해 개발 모드에서만 허용하고, React 웹은 두 모드 모두 일회성 토큰을 사용한다. 서버의 현재 총 Room 용량은 하나이므로 웹 Room을 종료한 뒤 playground 시험을 실행한다. 개발 profile에서 `/health`, `/monitor`, `/playground`를 제공하며 Docker Nginx도 이 경로들을 proxy한다.

환경값을 비워 두면 API는 같은 출처 `/api`를 사용하고 Vite가 `127.0.0.1:2567`로 전달한다. API 주소를 바꾸면 `http://127.0.0.1:2567/api`처럼 접두사를 포함한다. 개발 Colyseus 기본값은 `ws://127.0.0.1:2567` 직접 연결이며 production은 같은 출처 루트다.

처음 변경할 때는 [architecture.md](architecture.md)의 의존 방향과 [protocol.md](protocol.md)의 계약을 확인한다. 문제를 재현할 때 사용한 Node/pnpm 버전, 명령, 오류, 브라우저와 변경 파일을 함께 남긴다.
