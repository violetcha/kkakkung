# 기여 가이드

팀원과 AI는 먼저 [AGENTS.md](AGENTS.md)와 [팀 협업 컨벤션](docs/collaboration-conventions.md)을 읽는다. 커밋·MR 제목은 scope 없이 `type: 변경 내용` 형식으로 작성한다. 관련 Jira가 있는 커밋은 본문 또는 푸터에 키를 기록하며 기본 표기는 마지막 문단에 접두사 없이 실제 Jira 키만 단독 줄로 쓰는 것이다. MR 본문의 관련 Jira 항목에도 키를 적는다.

## 시작 전

Node.js `24.19.0`과 pnpm `11.19.0`을 사용하고 루트에서 `pnpm install --frozen-lockfile`, `pnpm setup:env`를 실행한다. 앱 폴더에서 따로 설치하거나 lockfile을 만들지 않는다.

## 변경 경계

- `apps/web`은 브라우저 표현과 입력을 소유하며 서버 내부 패키지를 import하지 않는다.
- `server`는 기존 팀의 rooms/domain 소유권을 유지하면서 접속, 권위 조정, 서버 IO를 소유한다.
- `packages/protocol` 변경은 웹과 서버 소비자를 함께 확인한다.
- `packages/game-core`는 서버 전용 순수 규칙이다.
- 실제 맵·fallback·튜닝·Secret·운영 기록을 웹이나 protocol로 옮기지 않는다.

프로토콜 변경에는 버전 호환성, 생산자·소비자, 거절 동작을 함께 기록한다. 패키지를 추가하면 해당 workspace manifest와 루트 lockfile을 같은 변경에 포함한다.

기존 `kkakkung` wire 계약과 새 `sandbox` 계약을 섞지 않는다. `server/src/domain`의 규칙 계산 소유권과 스텁 범위, `server/src/rooms`의 Room·Schema·StateView 소유권은 `server/README.md`를 따른다. 공통 검증 진입점은 루트 `pnpm verify`이며 CI 실행 환경의 준비 절차는 [테스트 가이드](docs/testing.md)를 따른다. 검토 중인 Jenkins 운영 방식과 현재 미구축 상태는 [팀 협업 컨벤션](docs/collaboration-conventions.md#연동과-병합-운영)에서 구분한다.

## 완료 전 검사

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

전체 검사는 `pnpm verify`로 실행한다. 변경 설명에는 바뀐 동작, 계약, 실행한 시험, 영향을 받는 G1~G6 관문을 적는다. 로컬 mock·인터페이스·빈 폴더를 실제 Cloud 또는 MVP 완료 증거로 표현하지 않는다.

문서만 변경한 경우에는 변경 문서의 포맷·링크·내용 일관성을 검사한다. 실행 동작에 영향이 없는 문서 변경에 앱 전체 시험은 요구하지 않는다.

비밀 `.env`, 토큰 원문, 실제 얼굴·음성, 개인 자료, 라이선스를 확인하지 않은 자산은 커밋하지 않는다. 제3자 자산을 추가할 때는 `docs/third-party-assets.md`의 기록 항목을 먼저 채운다.
