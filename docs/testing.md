# 테스트

기본 검증은 Node.js `24.19.0`, pnpm `11.19.0`에서 Cloud Secret 없이 수행한다. 설치는 루트 lockfile을 사용하며 로컬과 향후 Jenkins 모두 같은 `pnpm verify`를 실행한다. 현재 원격 파이프라인은 미구축이다.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check:execution
pnpm test
pnpm test:e2e
pnpm test:maps
pnpm verify
```

Linux CI에서는 브라우저와 OS 의존성을 함께 준비한다.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm verify
```

깨끗한 checkout에는 `dist`가 없으므로 루트 명령이 protocol과 game-core를 소비자보다 먼저 빌드한다. E2E는 독립 개발 서버를 시작하므로 실행 중인 `pnpm dev`를 종료해 5173·2567 포트를 비운 뒤 실행한다.

단위 시험은 protocol 계약과 game-core의 결정성·입력 경계를, Room 통합 시험은 토큰·입장·이동·퇴장을, E2E는 실제 웹과 서버의 개발 흐름을 확인한다. `test:maps`는 현재 `packages/game-core/test/world.test.ts`의 sandbox 경계·이동만 검사하며 전체 실제 맵 검증이 아니다. `verify`는 포맷, 실행계획 정합성, lint, 타입, 테스트, 빌드와 E2E를 실제로 실행해야 한다.

`check:execution`은 [실행계획](execution/README.md)의 122개 ID·116개 실행/6개 결정 대기·명시적 선행 관계·파일 소유권·링크·Markdown 표·여섯 공통 블록과 공개 타입·fixture를 검사한다. 정상 fixture와 의도적으로 타입 오류가 나야 하는 입력도 확인한다. 이는 문서 자료 검사이며, 실제 제품 모듈 연결 시험은 QA-07에서 별도로 구현한다. 공통 계약을 수정했다면 `node scripts/check-execution-plan.mjs --sync`로 담당 문서의 사본을 갱신한 뒤 `pnpm check:execution`을 실행한다. 원본 기획서보다 [최신 결정 정정표](spec/decisions.md)를 우선하고 미정 아이템을 통과 처리하지 않는다.

G1~G6는 별도 제품 검증 관문이다. 특히 가짜 Gateway는 실제 Cloud의 불허 구독 차단이나 토큰 회수를 증명하지 않는다. 부하와 Cloud 시험은 아직 스크립트가 없으며 “미실시”다. 시험 증거에는 소스 버전, lockfile, protocolVersion, 설정 버전, 장치·네트워크 조건을 기록하고 원본 토큰·얼굴·음성을 저장하지 않는다.

합성 미디어·공개 projection 시험 자료는 필요할 때 `tests/fixtures`에 추가한다. `tests/load`는 G6의 실제 WebRTC 60세션·10방·15분 통합 구간과 게임 단독 30분 진단을 구현할 때 만든다. 현재 개발 프로필은 1방·6슬롯이며 Cloud 부하 시험은 사용량·관리 API 예산과 G1을 먼저 확인한다.
