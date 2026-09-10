# 테스트

## DP-06 배포 합성 미디어 검사

`tests/cloud/deployment-smoke.cloud.test.ts`는 실제 초대/세션 HTTP, Colyseus 6클라이언트, C 제품 런타임과 Playwright의 합성 영상·음성 6개를 사용한다. 연습의 실제 E 바인딩/가청 정책에 허용된 수신, 연습 세대 종료, 경기 발급/게시, 실제 3,600틱 경기와 입력 결과, RESULT 이후 클라이언트 정리 및 운영 drain 성공을 확인한다. drain 완료는 실제 E의 참가자·저널·예약 정리 장벽이며 `unresolvedCount=0`도 재확인한다. 성공한 경우에만 resume 후 READY/OPEN으로 복구한다. 실패하면 임의 재개하지 않는다. 카메라·제스처·공간 음향 재생·대표 장치 및 G5/G6 인수는 별도다.

F가 실제로 확인한 DP-06 preflight, SSO cookie와 운영 자격이 없으면 실행할 수 없다. 이번 사용자 응답은 `아직 없음 — 로컬 검증 계속`이므로 실제 Cloud·배포 검사는 BLOCKED다. 로컬 fixture의 예산·증거 파일을 운영 승인으로 복사하면 안 된다. 비밀은 기존 환경으로만 제공하고 토큰·cookie·grant 원문을 로그/trace/스크린샷에 저장하지 않는다.

사전 승인은 게임 방 1개·참가자 6명으로 고정한다. 여기서 `maxRooms=1`은 기존 F 계약의 6좌석 게임 방 수이며, 실제 LiveKit 위상은 팀 연습 2룸을 정리한 뒤 경기 1룸이다. 하네스는 실제 발급 응답의 룸 수를 검증하고 결과에 개수만 기록한다. 실행 시간은 브라우저 준비부터 최소 300초(준비 여유 120초와 실제 경기 180초), 별도 정리 최소 30초를 예약한다. 영상 150kbps·음성 32kbps, 최대 30방향 수신과 25% 여유를 적용한 최소 330초 예약은 참가자 33분 및 281,531,250바이트다. 승인 만료가 전체 실행/정리 시각보다 빠르거나 예약/잔량이 부족하면 첫 요청 전에 거절한다. `tests/cloud/devices.deployment-synthetic.json`은 합성 소스 설명이며 사용 승인이 아니다.

이 물리적 전송 예상량과 E의 내부 예약은 별도 조건이다. E `MediaUsageLease`는 룸마다 6좌석×5분×100% 여유로 60분·369,000,000바이트를 예약하고 공식 사용량 대조 전에는 예약을 해제하지 않는다. 연습 2룸→경기 1룸의 DP-06에는 최소 180분·1,107,000,000바이트의 내부 예약과 public 40% bucket 여유가 필요하다. 실제 운영 상태의 공식 잔량, 기간, 기존 public 예약에 따라 더 많은 여유가 필요할 수 있다. preflight의 33분·281MB만 충족했다고 E의 입장/발급 가능성을 승인하면 안 된다. 공식 잔량·기간을 임의 생성하거나 저널 예약을 우회하지 않는다.

배포 러너는 product 변경 전에 DP-06 사전 문서와 자격 존재를 검사한다. 증거 경로는 승인 문서의 정확한 `.local/qa/...` 경로를 사용하고, `SMOKE_BASE_URL`은 배포 `--base-url`에서 전달한다. `OPS_OFFICIAL_BUDGET_MAX_AGE_MS`는 실제 서버 정책과 같은 운영자 값을 manifest에 전달해야 하며 기본값으로 승인하지 않는다.

기본 `pnpm verify`의 `tests/contracts/deployment-*.test.ts`는 로컬 계약 검증이다. 로컬 DP-06 통합은 실제 A/B/C/E/F 코드와 별도 서버 프로세스를 쓰되 Cloud transport·수신 카운터를 fixture로 대신하고 3,600틱을 가속한다. 보고서의 `LOCAL_CONTRACT_ONLY`를 실제 Cloud 성공으로 바꾸지 않는다. 실제 Cloud 파일은 기본 검사에서 계속 제외한다. QA strict 타입검사는 웹 소비 모듈을 포함하기 위해 QA 설정에서만 Bundler 해석을 사용하며 제품 서버 NodeNext 설정은 유지한다.

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

단위 시험은 protocol 계약과 game-core의 결정성·입력 경계를, Room 통합 시험은 토큰·입장·이동·퇴장을, E2E는 실제 웹과 서버의 개발 흐름을 확인한다. `test:maps`는 `packages/game-core/test/match/certified-maps.test.ts`에서 실제 맵 변형·연결성·fallback·온라인 선발을 검사한다. 웹 typecheck에는 D의 Worker 전용 타입 검사도 포함한다. `verify`는 포맷, 실행계획 정합성, lint, 타입, 테스트, 빌드와 E2E를 실제로 실행해야 한다.

`check:execution`은 [실행계획](execution/README.md)의 122개 ID·116개 실행/6개 결정 대기·명시적 선행 관계·파일 소유권·링크·Markdown 표·여섯 공통 블록과 공개 타입·fixture를 검사한다. 정상 fixture와 의도적으로 타입 오류가 나야 하는 입력도 확인한다. 이는 문서 자료 검사이며, 실제 제품 모듈 연결 시험은 QA-07에서 별도로 구현한다. 공통 계약을 수정했다면 `node scripts/check-execution-plan.mjs --sync`로 담당 문서의 사본을 갱신한 뒤 `pnpm check:execution`을 실행한다. 원본 기획서보다 [최신 결정 정정표](spec/decisions.md)를 우선하고 미정 아이템을 통과 처리하지 않는다.

G1~G6는 별도 제품 검증 관문이다. 특히 가짜 Gateway는 실제 Cloud의 불허 구독 차단이나 토큰 회수를 증명하지 않는다. 로컬 G1/G3/G4 회귀는 `tests/contracts`, 게임 전용 부하 도구는 `scripts/run-game-load.mjs`, Cloud 시험은 승인된 preflight를 요구하는 `scripts/run-cloud-check.mjs`를 사용한다. 시험 증거에는 소스 버전, lockfile, protocolVersion, 설정 버전, 장치·네트워크 조건을 기록하고 원본 토큰·얼굴·음성을 저장하지 않는다.

`EXEC-CONTRACT-3`의 fixture는 맵 영역·변형 출처와 fallback, 논리 게임 scope 전환과 늦은 개인 데이터, 초기화/READY/입장 재개, 격리 배포 순서의 정상·거절·경계 자료를 추가로 검사한다. 합성 맵으로 실제 플레이 맵을 인증하거나 배포 순서 자료로 Jenkins를 실행한 것은 아니다. Origin 차단은 B가 실제 SDK HTTP/OPTIONS/WS 진입 경로에 구현한 뒤, 허용되지 않은 요청에서 방 생성·좌석 예약·세션 소비가 모두 0인지와 매칭 본문 2,048/2,049바이트 경계를 회귀 시험해야 완료다. 이번 문서 보완 자체는 현재 서버의 Origin 우회를 해소하지 않는다.

합성 미디어·공개 projection 시험 자료는 `tests/fixtures`에 있다. `tests/load`의 게임 진단은 실제 A 엔진·맵과 B Room을 loopback에서 실행하며 미디어를 연결하지 않는다. 기본 개발 프로필은 1방·6슬롯이며 Cloud 부하 시험은 사용량·관리 API 예산과 G1을 먼저 확인한다.

## 2026-09-10 로컬 통합 검증

`SERVER_PROFILE=product`는 실제 게임 조립을 선택한다. F의 완전한 admission 설정이 필요하며 `MEDIA_MODE=disabled`이면 미디어와 제품 입장은 잠긴다. `MEDIA_MODE=livekit`는 완전한 자격·공개 시간·API 한도 설정을 요구하고, E의 공식 capability·예산·복구 증거가 있어야 READY가 된다. `NODE_ENV=production`은 배포 검증 전까지 거절한다. 실제 비밀 `.env`를 시험 자료로 사용하지 않는다.

```bash
pnpm exec vitest run tests/contracts/g1-a.test.ts tests/contracts/g1-c.test.ts tests/contracts/g1-d.test.ts tests/contracts/recovery-fixtures.test.ts tests/contracts/g3-room.test.ts tests/contracts/g3-overload.test.ts tests/contracts/producer-consumer.test.ts tests/contracts/g4-packets.test.ts tests/contracts/g4-bundle.test.ts
node scripts/inspect-public-bundle.mjs --directory apps/web/dist --evidence .local/qa/integration-bundle
node scripts/run-game-load.mjs --stages 1 --final-duration-seconds 25 --stage-duration-seconds 25 --network "local loopback, same host" --evidence .local/qa/integration-load-short
```

짧은 진단은 1방·합성 6클라이언트와 별도 진단용 admission을 사용한다. 실제 Cloud 권한이나 10방·30분 게임 부하, 60 WebRTC 세션의 G6 통과로 계산하지 않는다. G1 로컬 시험의 원격 응답은 제어 가능한 fixture이며, G3/G4는 실제 A 코어와 B 드라이버·projection·전송 스키마를 연결한다. 공식 Cloud 사례는 `*.cloud.test.ts`로 기본 시험에서 제외된다.

게임 지연 판정의 `eventLoop.lag`는 B Tick 코디네이터의 실제 예정 시각 대비 지연만 사용하며 p95 기준은 20ms다. Node `monitorEventLoopDelay`의 구간 p99는 별도 `eventLoop.delayP99/ms`로 수집·내보낸다. 구간 백분위와 개별 Tick 표본을 하나의 분포로 합치지 않는다. 진단 전용 10ms 해상도 히스토그램도 `diag.eventLoopDelayP99`로 분리해 보관한다.

### 운영 증거 공급

B의 제품 loader는 F의 `server/src/config/RuntimeEvidence.ts`를 통해 `OPS_DATA_DIR/runtime-evidence.json`을 읽어 E의 네 증거 서비스를 연결한다. 파일이 없어도 잠긴 상태로 기동하며, 자격·정상 capability만으로 소유권·공식 예산·최초 설치를 추정하지 않는다. 이 파일은 **F가 실제 증거를 확인한 뒤 서버에 배치하는 운영자 증명**이며 브라우저 입력, QA preflight 또는 자동 Cloud 인증 결과가 아니다. 이번 통합 작업에서 실제 운영 증명 파일은 만들지 않았다.

허용 스키마는 아래와 같다. 채워진 성공 예시는 제공하지 않는다. 모든 문자열은 실제 확인자·보관된 증거 참조·공식 기간/버전에서 가져오며 키·시크릿·토큰은 넣지 않는다. 추가 필드와 `firstInstallationConfirmed: true` 같은 boolean 설정은 거절된다.

```ts
type RuntimeEvidenceV1 = {
  version: 1;
  attestationId: string;
  projectAlias: string;
  namespace: string;
  checkedBy: string;
  checkedAtEpochMs: number;
  expiresAtEpochMs: number;
  evidenceRefs: {
    namespaceOwnership: string;
    firstInstallation?: string;
    firstAudit?: string;
  };
  officialBudget?: {
    checkpointSha256: string;
    periodId: string;
    version: number;
    evidenceRef: string;
  };
};
```

- `namespaceOwnership`는 해당 LiveKit 프로젝트와 서비스 namespace의 소유/할당을 F가 확인한 근거다. 파일 scope는 설정의 프로젝트·namespace와 정확히 같아야 한다.
- `firstInstallation`은 과거 게임·미디어 운영 이력이 없는 신규 저장소라는 프로비저닝 근거, `firstAudit`은 과거 운영 명령/감사 이력이 없는 최초 생성 근거다. 이미 운영한 저장소를 비웠거나 기록이 유실된 경우에는 두 필드를 넣지 않는다. 기존의 온전한 기록을 복원할 때는 필요하지 않다.
- `officialBudget`은 `official-usage-input.json`의 기존 6필드 전체와 결합한다. `officialCheckpointDigest(checkpoint)`가 엄격 검증 후 E의 canonical JSON SHA-256을 계산한다. F는 실제 대시보드 확인에 연결된 `periodId`와 증가하는 `version`, 보관한 근거 참조를 함께 기록한다. 현재 시각이나 Git SHA를 공식 revision으로 바꾸지 않는다.
- 시각은 현재보다 미래가 아니고 `OPS_OFFICIAL_BUDGET_MAX_AGE_MS` 이내이며 만료 전이어야 한다. 권한 조회는 파일 IO 없는 메모리 검사를 사용하고, 별도 1초 비동기 검사에서 부팅 시 검증된 파일과 SHA-256을 대조한다. 내용 변경·누락·읽기 오류는 해당 검사에서 잠그며, 검사가 늦어져도 마지막 검증 후 5초가 지나면 잠긴다. 이는 정적 운영 증명 파일의 IO 확인에 다섯 번의 실행 기회를 주는 **이번 통합의 초기 운영 정책이며 검증된 배포 SLA가 아니다.** 실제 증거 만료·최대 나이 초과·시각 역행은 5초 임대와 무관하게 다음 조회에서 즉시 거절한다. 게임의 250ms 과부하 기준과 미디어 권한·회수 deadline은 바꾸지 않는다. 증거를 갱신한 뒤에는 새 검증을 위해 재시작한다. 서버 종료는 공급기의 `close()`를 호출해 즉시 잠그고 검사 타이머와 진행 중인 읽기를 정리한다.
- 최초 확인은 목적별 `runtime-firstInstallation-consumed.json`/`runtime-firstAudit-consumed.json`을 `wx`로 원자 생성하고 파일을 fsync한 뒤 한 번만 허용한다. 기존/불완전 marker는 재사용을 거절하며 자동 삭제하지 않는다. marker는 운영 이력과 함께 보존한다. **볼륨과 marker를 함께 잃은 경우 과거 최초 설치 증명을 재사용하지 말고 F가 외부 프로비저닝 기록을 재검증해야 한다.** Windows의 디렉터리 fsync는 Node에서 지원되지 않으므로 Linux 지속 볼륨의 장애 내구성 검증은 별도다.

`tests/contracts/runtime-evidence.test.ts`는 임시 디렉터리에서만 누락·변조·만료·역행·scope 불일치·6필드 digest·목적별 단일 소비·불완전 marker·비동기 임대 갱신·종료 정리를 검증한다. 실제 Cloud 자료를 작성하거나 실제 운영 marker를 소비하지 않는다.
