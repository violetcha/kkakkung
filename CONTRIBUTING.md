# 기여 가이드

팀원과 AI는 먼저 [AGENTS.md](AGENTS.md)와 [팀 협업 컨벤션](docs/collaboration-conventions.md)을 읽는다. 커밋·MR 제목은 scope 없이 `type: 변경 내용`, 관련 Jira 키는 커밋 마지막 문단에 단독 줄로, MR 본문의 관련 Jira 항목에 각각 적는다. 실제 Git 신원을 유지하고 AI 공동 저자를 추가하지 않는다.

제품 규칙은 [기획서](docs/product-spec.md)와 [결정 정정표](docs/spec/decisions.md)를 따른다. 미정 도망자 아이템을 임의로 설계·구현하지 않으며 술래 장비·구속·자연 만료·포획·포즈 등 확정 범위는 유지한다.

## 시작 전

Node.js `24.19.0`과 pnpm `11.19.0`을 쓰고 루트에서 `pnpm install --frozen-lockfile`, `pnpm setup:env`를 실행한다. 앱 폴더에서 따로 설치하거나 lockfile을 만들지 않는다.

## 변경 경계

- `apps/web`은 브라우저 표현과 입력을 소유하며 서버 내부 패키지를 import하지 않는다.
- `server`는 입장·Room·권위 조정·미디어·운영 IO를 소유한다. `server/src/domain`·`server/src/rooms` 경계는 [서버 구현 명세](docs/impl/server.md)를 따른다.
- `packages/protocol` 변경은 웹과 서버 소비자를 함께 확인하고 버전 호환성과 거절 동작을 기록한다.
- `packages/game-core`는 서버 전용 순수 규칙이다.
- 실제 맵·fallback·튜닝·Secret·운영 기록을 웹이나 protocol로 옮기지 않는다.
- 패키지 추가는 이름·정확한 버전·용도를 정해 해당 workspace manifest와 루트 lockfile을 같은 변경으로 갱신한다.
- 웹·서버 시험이 공유하는 계약 사례는 `tests/contracts/shared`에 두고 양쪽 소비자 시험을 함께 고친다. 제품 런타임은 이 파일을 import하지 않는다.
- 제품 `kkakkung` 0.2와 진단용 0.1·`sandbox` 계약을 섞지 않는다.

## 완료 전 검사

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

전체 검사는 `pnpm verify`이며 위 단계와 제품 자산 검사를 한 번에 실행한다. 설명에는 바뀐 동작·계약, 실행한 시험, 영향을 받는 G1–G6 관문을 적는다. 로컬 mock·인터페이스를 제품 구현이나 실제 Cloud 완료 증거로 표현하지 않는다.

문서만 바꾼 경우에는 포맷·링크·내용 일관성을 검사한다. 날짜별 작업 일지나 시험 로그를 문서에 쌓지 않고 MR 본문에 남긴다.

비밀 `.env`, 토큰 원문, 실제 얼굴·음성, 개인 자료, 라이선스를 확인하지 않은 자산은 커밋하지 않는다. 제3자 자산을 추가할 때는 [제3자 자산](docs/third-party-assets.md)의 기록 항목을 먼저 채운다.
