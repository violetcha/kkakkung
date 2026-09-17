# F 인계 · 인프라·CI·관측·QA 도구

담당 정호성 · 2026-09-15 정리 · 코드 `infra/`, `Jenkinsfile`, `scripts/`, `server/src/config`, `server/src/observability`, `tests/{cloud,load,fixtures,contracts}`

F는 설정 스키마, 배포 파이프라인과 배포 러너, 관측 등록명, Cloud·부하·6대 시험 도구와 인수 판정기를 소유한다. 파이프라인·배포 장벽·호스트 구성은 [인프라 안내](../../infra/README.md), 시험 절차는 [테스트](../testing.md), 운영 정책은 [운영](../operations.md)이 기준이다.

## 상태

- Jenkins: Prepare → Secret scan(gitleaks) → Verify(`scripts/ci-verify.mjs` → `pnpm verify` 1회) → Build images → Scan(trivy, 기록만) → Deploy(develop만). 무거운 단계는 같은 flock을 잡고, 동일 트리 재검증은 생략하며, CI에서만 Playwright 1회 재시도.
- 제품 배포(`DEPLOY_PROFILE=product`, continuous)가 기본이며 매 배포 DP-06 실제 Cloud 합성 6인 시험을 통과한다. 호스트 nginx가 GitLab SSO(프로젝트 Reporter 이상)를 강제한다.
- 2026-09-15: 실행계획 문서 검사(`check:execution`)를 CI와 `pnpm verify`에서 제거했다(S15P21C204-252). 방 수·좌석은 제품 Compose overlay가 원본이고 배포 러너가 `scripts/lib/product-capacity.mjs`로 읽어 사전 검사에 넘긴다(251).
- QA 도구(G1 fault adapter, 증거 writer, 10방 판정기, 6대 수집기, MVP 판정기)는 로컬 검증까지. G1·G2·G4 metadata·G5·G6의 실제 실행은 BLOCKED(관측 생산자 미연결, preflight·장치 필요).

## 진입점

| 영역       | 파일                                                                                                                                                                 | 비고                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 설정       | `server/src/config/env.ts`(`parseConfig`), `ProductDeployment.ts`, `RuntimeEvidence.ts`                                                                              | E는 `process.env`를 직접 읽지 않는다. `NODE_ENV=production` 거절                             |
| 배포       | `scripts/product-release.mjs`, `deploy-release.mjs`, `verify-release.mjs`, `lib/release-sequence.mjs`, `infra/deploy.sh`                                             | Jenkins와 수동 배포가 같은 러너. 결과 `/opt/kkakkung/releases/<tag>/release.json`            |
| CI         | `Jenkinsfile`, `scripts/ci-verify.mjs`, `infra/docker/Dockerfile.ci`                                                                                                 | 도구체인 → SHA 대조 → frozen install → Chromium → `pnpm verify`                              |
| 관측       | `server/src/observability/MetricRegistry.ts`, `StructuredEvents.ts`, `AlertPolicy.ts`, `scripts/collect-observability.mjs`                                           | 등록되지 않은 이름·단위는 registry가 거절한다. label은 `matchRef`·`generation`·`requestId`만 |
| Cloud 시험 | `scripts/run-cloud-check.mjs`, `tests/cloud/CloudPreflight.ts`(`CLOUD_CASES`), `ProbeHarness.ts`, `EvidenceWriter.ts`, `GatewayFaultAdapter.ts`, `SyntheticMedia.ts` | 사례 allowlist → preflight → 한 사례. 직접 vitest로 열면 실패                                |
| 부하       | `scripts/run-game-load.mjs`, `summarize-load.mjs`, `run-media-load.mjs`, `summarize-integrated-load.mjs`, `tests/load/*`                                             | 게임 단독은 LiveKit에 연결하지 않는다                                                        |
| 성능 분석  | `scripts/probe-extract.mjs`, `profile-summary.mjs`, `profile-callers.mjs`                                                                                            | CI 프로브 창과 로컬 CPU 프로파일 요약                                                        |
| 인수 판정  | `scripts/collect-six-device-results.mjs`, `scripts/verify-mvp-evidence.mjs`, `tests/fixtures/manual-six-device.md`                                                   | 보고서는 `.local/qa/mvp-gate-report.md`(기본값)에 쓴다                                       |
| 운영 도구  | `scripts/issue-team-invitation.mjs`, `scripts/open-demo.mjs`(+`lib/`)                                                                                                | 운영 토큰은 환경변수로만. 세션이 든 주소는 loopback에서만 출력하고 그 밖에는 0600 파일       |
| 자산 검사  | `scripts/check-product-assets.mjs`, `scripts/lib/vision-asset-notices.mjs`                                                                                           | 모델·WASM 해시와 고지. `--require-reviewed-rights`는 현재 pending 때문에 실패                |
| 공유 계약  | `tests/contracts/shared/`                                                                                                                                            | 웹·서버 시험용 계약 사본(EXEC-CONTRACT-3). 제품 코드는 import하지 않음                       |
=======
| 영역        | 파일                                                                                                                                                                 | 비고                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 설정        | `server/src/config/env.ts`(`parseConfig`), `ProductDeployment.ts`, `RuntimeEvidence.ts`                                                                              | E는 `process.env`를 직접 읽지 않는다. `NODE_ENV=production` 거절                                                                                     |
| 배포        | `scripts/product-release.mjs`, `deploy-release.mjs`, `verify-release.mjs`, `lib/release-sequence.mjs`, `infra/deploy.sh`                                             | Jenkins와 수동 배포가 같은 러너. 결과 `/opt/kkakkung/releases/<tag>/release.json`                                                                    |
| CI          | `Jenkinsfile`, `scripts/ci-verify.mjs`, `infra/docker/Dockerfile.ci`                                                                                                 | 도구체인 → SHA 대조 → frozen install → Chromium → `pnpm verify`                                                                                      |
| 관측        | `server/src/observability/MetricRegistry.ts`, `StructuredEvents.ts`, `AlertPolicy.ts`, `scripts/collect-observability.mjs`                                           | 등록되지 않은 이름·단위는 registry가 거절한다. label은 `matchRef`·`generation`·`requestId`만                                                         |
| Cloud 시험  | `scripts/run-cloud-check.mjs`, `tests/cloud/CloudPreflight.ts`(`CLOUD_CASES`), `ProbeHarness.ts`, `EvidenceWriter.ts`, `GatewayFaultAdapter.ts`, `SyntheticMedia.ts` | 사례 allowlist → preflight → 한 사례. 직접 vitest로 열면 실패                                                                                        |
| 부하 프로브 | `tests/cloud/LoadProbePool.ts`, `load-probe.ts`, `MarkerDetector.ts`, `LoadProbeTypes.ts`                                                                            | QA-11/12용. 표식 트랙을 게시하고 수신 트랙에서 다시 읽어 `MediaObserver`에 넣는다. 제품 `composeMediaEvidence`로 증거를 낸다(REQ-D-13). Cloud 미검증 |
| 부하        | `scripts/run-game-load.mjs`, `summarize-load.mjs`, `run-media-load.mjs`, `summarize-integrated-load.mjs`, `tests/load/*`                                             | 게임 단독은 LiveKit에 연결하지 않는다                                                                                                                |
| 성능 분석   | `scripts/probe-extract.mjs`, `profile-summary.mjs`, `profile-callers.mjs`                                                                                            | CI 프로브 창과 로컬 CPU 프로파일 요약                                                                                                                |
| 인수 판정   | `scripts/collect-six-device-results.mjs`, `scripts/verify-mvp-evidence.mjs`, `tests/fixtures/manual-six-device.md`                                                   | 보고서는 `.local/qa/mvp-gate-report.md`(기본값)에 쓴다                                                                                               |
| 자산 검사   | `scripts/check-product-assets.mjs`, `scripts/lib/vision-asset-notices.mjs`                                                                                           | 모델·WASM 해시와 고지. `--require-reviewed-rights`는 현재 pending 때문에 실패                                                                        |
| 공유 계약   | `tests/contracts/shared/`                                                                                                                                            | 웹·서버 시험용 계약 사본(EXEC-CONTRACT-3). 제품 코드는 import하지 않음                                                                               |

### 관측 등록명

`tick.duration/ms`, `tick.due/count`, `tick.catchup/count`, `tick.overload/count`, `input.queueDepth/count`, `input.rejected/count`, `process.memory/bytes`, `process.cpu/ratio`, `eventLoop.lag/ms`(B 코디네이터 예정 시각 대비), `eventLoop.delayP99/ms`(Node 히스토그램, lag와 섞지 않음), `media.api.total60s/count`, `media.api.normal60s/count`, `media.api.429/count`, `media.policy.queueWait/ms`, `media.policy.responseLatency/ms`, `media.policy.effectLatency/ms`, `media.retirement.unresolved/count`, `media.reservation.participantMs/ms`, `media.reservation.bytes/bytes`, `operations.journal.writable/count`, `operations.audit.events/coalesced/retained`, `operations.queue.pending/rejected`, `http.requests.active/work/rejected`, `observability.dropped/count`. 새 이름은 F에 요청한다.

### 배포 계약 (바꾸면 F에 먼저 알린다)

Node 24.19.0·pnpm 11.19.0, 이미지 컨텍스트 = 루트, 서버 엔트리 `server/dist/main.js`, 헬스 `/health/live`·`/health/ready`, `ALLOWED_ORIGINS` 정확 일치, 웹은 same-origin(`VITE_*` 비움), Colyseus 경로 루트 기준, DP-06 자동 시험은 loopback `127.0.0.1:18081` + `SMOKE_INTERNAL_TOKEN`.

## 요청 받은 것 (미반영)

| 요청     | 출처 | 내용                                                                                    |
| -------- | ---- | --------------------------------------------------------------------------------------- |
| REQ-D-12 | D    | `vision-asset-notices.mjs`가 `bundledNoticesReview:'verified'`일 때 고지 파일 쪽도 확인 |

## 남은 일

- G1(QA-03–06)·G4 metadata(QA-08)·제품 6화면(QA-09)·성능(QA-02)·단계 부하(QA-11/12) Cloud 사례의 BLOCKED를 실제 관측 생산자로 교체.
- QA-11/12 단계 구동기: 부하 프로브(위)는 있고, 브라우저마다 실제 제품 세션을 붙여 5→6→7→6→5 셀을 걷게 하고 구간별 `MediaStageInput`을 만드는 쪽이 없다. 두 Cloud 사례는 그 이유로 BLOCKED다.
- 게임 단독 60클라이언트 30분 재실행(이전 10방 포화의 원인 F-REQ-12–15와 readiness 비용은 해소됨) → 실제 Cloud 단계 부하(S15P21C204-251과 함께).
- 외부 장애 알림 전달, 호스트 외부 백업과 복원 훈련, Docker 메모리·CPU·PID 상한, Trivy 결과의 차단·예외 기준.
- W07 공개 대상: `infra/nginx/host.conf`·배포 manifest·`release-sequence`의 audience 선택과 동일 이미지 team→public→team 리허설.
- 실제 6대 5판 일정·장치 확보와 수집기 실행(G5).
