# E 인계 · 미디어 권한·세대·운영 복구

담당 이주헌 · 2026-09-15 정리 · 코드 `server/src/{media,operations,health}`

E는 LiveKit 발급·바인딩·가청 권한·원격 회수, 지속 저널·사용량 예약·재시작 복구, 운영 명령과 readiness를 소유한다. 구조와 권한 방식은 [미디어](../media.md), 운영 정책과 장애 대응은 [운영](../operations.md)이 기준이다.

## 상태

- `publisher-permissions` 모드가 제품 배포에 연결돼 매 배포 DP-06을 통과한다. 실제 Cloud MC-01 R9(2026-09-11) SUPPORTED: 허용 영상·음성 수신, 금지 수신자 직접 구독 차단, 허용 철회 후 재구독 차단, 기존·갱신·미입장 토큰 401.
- 복구·운영: 과거 방 병렬 조회와 예산 대기, 최초 기동 실패 제한 복구, 조회 실패 checkpoint 재검증, 내구 이력 자동 축약과 과거 방 전체 목록 재검증, 운영 HTTP·감사 상한이 병합·배포돼 있다.
- 성능: 249에서 readiness 예약 대조의 깊은 비교 제거(서버 비유휴 CPU 약 절반), 251에서 다중 방 readiness 제곱 비용 제거. 로컬 10방 동시 발급 3회 연속 통과(lag 73–88ms).
- 최대 10방: `publisher-permissions`의 1방 강제 제거, 방 수는 제품 Compose overlay가 원본, 미디어 API 설정 상한 `MEDIA_API_CEILINGS` 6,000/9,000(D-2026-09-15-01). 운영 값은 아직 1방.
- split(`server-forwarding`)은 보류(S15P21C204-215). 구현·검증 범위는 [미디어 6장](../media.md#6-보류된-split-서버-전달-server-forwarding).

## 조립 진입점

`server/src/media/MediaCoordinator.ts`의 `createMediaCoordinator(deps, services?)`가 발급·회수·복구·운영·readiness를 같은 registry·journal·사용량·API 예산으로 묶는다. B의 `ProductProfileLoader`가 호출한다.

```ts
const media = createMediaCoordinator(mediaDeps, verifiedServices);
const initialized = await media.initialize(); // fatal이면 close 후 listen하지 않는다
const health = createHealthHandlers({
  getReadiness: () => media.getReadiness(),
  isInitialized: media.isInitialized,
});
const operations = media.createOperationsHandlers(createOperatorAuth(validatedOpsToken));
media.lifecycle.setGameConnection({ matchId, playerId, connected });
media.observeFrame(trustedFrame);
const preparation = await media.prepareGeneration(serverPreparedRequest);
media.lifecycle.report({ ...validatedMediaReport, playerId: authenticatedPlayerId }); // report HTTP에서 별도 처리
await media.close(); // B가 새 요청·producer를 닫은 뒤
```

- `services`의 운영 증거(`namespaceOwnershipConfirmed`, 최초 설치·감사, 공식 revision)는 검증된 값만 돌려준다. 임의 true·빈 디렉터리·현재 시각으로 만들지 않는다. 빠진 증거는 발급 차단이다.
- `initialize()` 뒤 상태는 RECOVERING/LOCKED + DRAINING이다. READY가 돼도 운영 `resume`이 내구 terminal 성공하기 전까지 OPEN하지 않는다.
- B의 초대·입장·방 생성·자동 시작은 같은 `media.canIssue`를 await 전후로 검사한다.

## 모듈

| 모듈                                                                                        | 책임                                                                                                                 |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `media/LiveKitGateway.ts`, `operations/ApiBudget.ts`                                        | 모든 관리 API의 공유 예산(60초 정상/전체), 유한 HTTP timeout, 자동 failover 금지                                     |
| `media/MediaGenerationRegistry.ts`, `GrantIssuer.ts`                                        | 세대·Identity 할당, 사용량 선예약 → 저널 기록 → JWT 서명 → 최종 재검사                                               |
| `media/GenerationTransition.ts`, `MediaLifecycle.ts`                                        | matchId·playerId별 전환 직렬화(phase-change/reconnect/round-ended). 새 발급은 원격 회수 확인 + D 로컬 정리 확인 뒤   |
| `media/MediaPolicyBindings.ts`, `AudibilityPolicy.ts`, `TrackRegistry.ts`                   | 서버 프레임 기준 가청 판정, 확인된 트랙 SID 바인딩, 송신자 허용 목록. 방 범위 먼저 비교, 트랙별 바인딩 조회          |
| `media/RetirementBarrier.ts`, `RemoteRevocation.ts`                                         | remove ACK + 참가자 부재 + 내구 REVOKED. `RemoveParticipant` 404는 성공이 아니다                                     |
| `operations/OperationJournal.ts`                                                            | 지속 저널과 원자적 checkpoint. `restore()` 뒤 integrity·writable·unresolved 확인 후에만 쓰기                         |
| `operations/UsageBudget.ts`, `MediaUsageLease.ts`, `UsageCheckpoint.ts`                     | 참가자-분·바이트 예약과 반환, 축약 누계                                                                              |
| `operations/RevocationRetries.ts`, `RevocationRetryBindings.ts`, `SharedRetryCheckpoint.ts` | 회수 재시도(1/2/4초, Retry-After 우선, 10초 뒤 UNRESOLVED). 이전 부팅·현재 프로세스 intent를 한 checkpoint에 병합    |
| `operations/RecoveryBootstrap.ts`, `RecoveryState.ts`, `RecoveryRecords.ts`                 | 부팅 복구 상태와 기록 대조. `snapshot()`은 상태가 바뀔 때까지 공유되는 얼린 객체를 돌려준다(읽기 전용)               |
| `operations/PreviousGenerationCleanup.ts`, `RecoveryCleanupBindings.ts`                     | 저널·Cloud 목록·관측 대상의 합집합 정리, 조회 실패 checkpoint 재검증                                                 |
| `operations/OperatorAuth.ts`, `OperationsController.ts`, `OperationsAudit.ts`               | OPS_TOKEN timingSafeEqual, drain/resume/checkpoint/retry-retirement 명령, 감사 표본 상한                             |
| `operations/RetentionPolicy.ts`                                                             | 24시간·JWT 만료·전 조각 RELEASED 묶음만 축약                                                                         |
| `health/Readiness.ts`, `ReadinessRuntime.ts`, `ReservationReadiness.ts`                     | READY 판정. 시간·seq 기반 캐시 없음, 제자리 변경 매 호출 반영. 파싱된 capability 보고서는 WeakSet 표시로 재파싱 생략 |
| `media/CloudCapabilityProbe.ts`                                                             | `capability-report.json` 파싱. 모드별 보고서를 섞지 않는다                                                           |

## B·C·D와의 경계

- 실패 코드 매핑(B 제어 큐): `TIMEOUT` → `ABORT_MATCH(MEDIA_UNAVAILABLE)`, `POLICY_UNKNOWN` → `MEDIA_POLICY_UNCERTAIN`. `MEDIA_PREPARED/MEDIA_RETIRED`는 requestId + scope, `MEDIA_FAILED`는 eventId + scope로 중복 제거한다.
- ready grant는 게시 완료가 아니다. B는 현재 self faceTrackSid와 `LOAD_READY`를 함께 확인한다.
- `closed` 보고는 D의 `await retireMediaGeneration()` 완료 뒤 C가 보낸다. 이전 세대 대기만 풀 뿐 원격 회수를 증명하지 않는다. `playerId`는 인증 세션에서 채운다.
- 일반 미디어 장애는 최초 신고부터 monotonic 10초. 반복 신고로 늘리지 않는다. 권한 UNKNOWN 1초 차단이 우선한다.
- 한 명 전체 교체 시 그 참가자의 receiverGeneration·Identity만 바뀌고 나머지 다섯은 자기 세대를 유지한다. E는 gameInstanceId·gameScope.revision을 만들지 않는다.
- 예산 예약 거절만 `abandonUnissued()`로 표시하며, 같은 match의 다음 요청은 거절 결과의 `receiverGeneration`을 `expectedPreviousGeneration`으로 쓴다(번호 재사용 없음).

## Cloud 시험

MC-01(`server/test/media/capability.cloud.test.ts`)은 방 1개·합성 Identity 5개, 본 시험 최대 240초, 관리 API 60초 정상 40·전체 60회 이내다. 자격 6개(`LIVEKIT_HTTP_URL`, `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PROJECT_ALIAS`, `SERVICE_NAMESPACE`)는 프로세스 환경으로만 주입한다. 결과 `capability-report.json`은 검토 뒤 운영 evidence 디렉터리에 명시적으로 배치하며 시험기가 운영 설정을 자동으로 바꾸지 않는다.

```bash
node scripts/run-cloud-check.mjs --case MC-01 --preflight .local/qa/cloud-preflight.json --evidence .local/qa/MC-01
```

## 남은 일

- [S15P21C204-251](https://ssafy.atlassian.net/browse/S15P21C204-251) 게임 단독 60클라이언트 30분 → 실제 Cloud 1→3→5→10방 단계 부하(약 1,710 참가자-분) → 운영 `MAX_ROOMS` 상향 배포. G2 “정상 API ≤ 600회/60초” 기준 조정 여부는 실측 후 결정.
- readiness 남은 비용: `matchCachedInput` 누적 대조, 발급 중 캐시 miss, `MediaGenerationRegistry.observe`의 프레임 복제.
- LiveKit 월 사용량 경보, 호스트 외부 백업·복원(F와 함께). 외부 장애 알림은 S15P21C204-288.
- 단일 모드 공유 방 첫 예약 fsync와 첫 journal 기록 사이의 종료 공백.
- [S15P21C204-195](https://ssafy.atlassian.net/browse/S15P21C204-195) Jira 상태 정리(복구 코드는 병합·배포됨).
