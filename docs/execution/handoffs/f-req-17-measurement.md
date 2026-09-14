# F-REQ-17 원 측정 확인 (B 질의 답변, 2026-09-14)

대상: B (정유림) · Jira S15P21C204-234 · 기준 develop 67d8467
작성: F (정호성). 아래 숫자는 전부 재현 가능한 원자료에서 나왔고, 추론인 부분은 추론이라고 적었다.

## 요약 (먼저 결론)

- "GAME_LOADING tick 이 CPU 만 ~160ms" 는 **kkakkung-mr #70 실패 로그의 프로브 표본 하나**에서 읽은 값이다. tick 측정도, 프로파일도 아니었다. `EventDispatcher.publishView` 를 지목한 것은 F-REQ-13 과 같은 뿌리일 것이라는 **추론**이었고, 오늘 프로파일로 보면 **틀렸다**. 철회한다.
- 오늘 로컬 CPU 프로파일(inspector, 1ms 샘플, develop 67d8467 포함 트리)에서 서버 프로세스 CPU 의 **27%(38.9s/143s)가 `server/src/health/ReservationReadiness.ts` `inspect()` 한 곳**이고, 그중 36.7s 가 `util.isDeepStrictEqual` 이다. `EventDispatcher.sameContent` 는 2.5s(1.8%)다.
- GAME_LOADING 동안 100~~190ms 정지 창은 CI 와 로컬 모두에서 **매 판 반복** 관측된다(전환 tick 하나가 아니다). 창 안의 CPU 는 60~~160ms, 나머지는 CPU 를 쓰지 않는 활성 시간이라 동기 I/O 또는 스케줄링 대기로 보인다(추론). 233(publishView 직렬화 비교 제거) 병합 전후로 창 크기 차이가 없다.

## Q1. 어느 실행에서 잰 값인가

| 항목                  | 값                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실행                  | Jenkins `kkakkung-mr` #70, 2026-09-10 16:43~16:46 KST                                                                                                                                                                                       |
| 커밋                  | c5151e3(브랜치 `docs/S15P21C204-172-handoff`, develop 12ad4e8 위 문서 커밋)                                                                                                                                                                 |
| 시험                  | `server/test/media/product-integration.test.ts` 실패 출력의 `server.probe`                                                                                                                                                                  |
| 표본                  | `phaseBefore=GAME_LOADING, phaseAfter=GAME_LOADING, fromMs=7247, elapsedMs=268.3, lagMs=258.3, cpuUserMs=157.1, cpuSystemMs=6.4, loopActiveMs=268.3, loopIdleMs=0, gcOverlapMs=1.8`                                                         |
| 같은 실행의 다른 표본 | MAP_FINALIZING→MAP_FINALIZING 119ms(cpu 113), GAME_LOADING→ABORTED 97(cpu 70), BOOT→NO_ROOM 88(cpu 106), TEAM_PRACTICE 74(cpu 77), TEAM_PRACTICE→MAP_FINALIZING 70(cpu 61), GAME_LOADING 65(cpu 63), MAP_FINALIZING→GAME_LOADING 64(cpu 42) |
| 주의                  | 이 빌드는 develop 배포 빌드 #58/#59 와 같은 4 vCPU 에서 겹쳐 돌았다. 268ms 중 CPU 163ms 이고 나머지 ~105ms 는 CPU 를 받지 못한 시간이다. "160ms" 는 그 창의 `cpuUserMs` 다                                                                  |

원자료 로그는 F 로컬에 보관(`kkakkung-mr #70 console`). 필요하면 Jenkins 콘솔에서 같은 줄을 볼 수 있다.

## Q2. GAME_LOADING 의 어느 지점인가

프로브는 서버 자식 프로세스 안의 `setInterval(10ms)` 표본이다(`server/test/media/product-server-probe.ts`). 한 표본은 "이전 표본 이후 이벤트 루프가 다음 표본 콜백을 실행하기까지" 창이고, `phaseBefore/After` 는 창 양 끝에서 읽은 방 phase 다. 따라서

- `MAP_FINALIZING→GAME_LOADING` 창 = `startLoading`(레이아웃 확정 → `createMatch` → attach → `loading.open` → `setPhase`) 이 들어간 전환 tick. #70 에서 64ms(cpu 42), 오늘 CI 에서 0~131ms.
- `GAME_LOADING→GAME_LOADING` 창 = 전환이 끝난 뒤 GAME_LOADING 이 유지되는 동안의 창. **이 창이 매 판 반복해서 90~200ms 로 나온다.** 아래 표.

B 실측(개인 뷰 전송 0건, FakeCore tick 0.58ms)과 모순되지 않는다. 그 창의 비용은 B 의 tick 경로가 아니다. 방 tick 은 `loading.evaluate()` 만 하고 돌아오지만 같은 이벤트 루프에서 E 의 미디어 세대 준비(grant 발급·바인딩 게시·readiness 검사·저널 기록)가 이 시간에 돈다. 프로파일 근거는 Q5.

### CI 프로브 창, 빌드별 (같은 시험 2회 = attested/continuous)

`GL` = GAME_LOADING→GAME_LOADING 창 중 최대 lag 와 그 창의 cpuUser, `≥90ms` = 그런 창의 개수(상위 8개 안에서), `MF` = MAP_FINALIZING 관련 창 최대 lag. 233 = `fix/S15P21C204-233-publish-view-cost` 포함 여부.

| 빌드             | 커밋     | 233    | run1 GL max lag / cpu / ≥90ms / MF | run2 GL max lag / cpu / ≥90ms / MF |
| ---------------- | -------- | ------ | ---------------------------------- | ---------------------------------- |
| kkakkung-mr #128 | cbdb8d67 | 아니오 | 127 / 130 / 3 / 0                  | 83 / 83 / 0 / 0                    |
| kkakkung-mr #130 | d5d87cf7 | 아니오 | 116 / 108 / 2 / 0                  | 67 / 61 / 0 / 50                   |
| kkakkung-mr #132 | 689b9556 | 아니오 | 158 / 162 / 4 / 0                  | 139 / 117 / 2 / 0                  |
| kkakkung-mr #136 | efe8deca | 아니오 | 200 / 140 / 2 / 115                | 95 / 104 / 1 / 0                   |
| kkakkung-mr #138 | a2db8162 | 아니오 | 188 / 152 / 3 / 86                 | 109 / 112 / 2 / 0                  |
| kkakkung #124    | b692243f | 아니오 | 144 / 142 / 3 / 98                 | 87 / 91 / 0 / 0                    |
| kkakkung-mr #141 | be9709ec | **예** | 120 / 124 / 2 / 0                  | 91 / 100 / 1 / 0                   |
| kkakkung-mr #143 | 59b78148 | **예** | 106 / 102 / 2 / 131                | 101 / 110 / 1 / 47                 |

233 전후 차이는 실행 간 편차 안이다. GAME_LOADING 창의 주된 비용은 publishView 가 아니다.

### 로컬(Windows, 정호성 노트북) 같은 시험의 프로브 창

attested: GAME_LOADING 147ms(cpu 93), 108(78), 104(78) · continuous: 191(63), 186(79), 154(78), 116(79), 115(47). CPU 가 창의 절반 안팎이고 `loopIdleMs≈0` 이므로 나머지는 CPU 를 쓰지 않는 활성 시간이다. 동기 디스크 쓰기(`RuntimeEvidence` 의 `fsyncSync`, 저널 내구 기록) 또는 OS 스케줄링으로 추정한다(추론, 미확인).

## Q3. CPU 시간을 어떻게 분리했나

`process.cpuUsage()` 차분이다(`product-server-probe.ts`: 표본마다 `cpu.user - previousCpu.user`). `loopActiveMs/loopIdleMs` 는 `performance.eventLoopUtilization()` 차분, `gcOverlapMs` 는 `PerformanceObserver('gc')` 항목과 창의 겹침이다. 프로파일러가 아니라 프로세스 단위 합계다. 그래서 "어느 함수" 는 이 값으로 말할 수 없었고, 그 부분이 추론이었다.

## Q4. tick 별 원자료

tick 별 원자료는 **없다**. 있는 것은

1. 위 프로브 창(10ms 표본, 상위 8개만 보존). 매 CI 실행의 콘솔에 성공 시 `{"productServerProbe":…}`, 실패 시 `Error: {…"server":{"probe":…}}` 로 남는다. `scripts/probe-extract.mjs <log>` 로 표로 뽑을 수 있다(이 MR 에 추가).
2. E 의 `product-phase-profile`(`KKAKKUNG_TEST_CPU_PROFILE=1` 일 때 `.local/integration/product-child-<pid>.cpu-metadata.json` 의 `phases`): phase×구성요소별 count/total/own/max. 오늘 로컬 attested 실행의 GAME_LOADING 부분:

| 구성요소                | count  | own     | max    |
| ----------------------- | ------ | ------- | ------ |
| GAME_LOADING/driver     | 669    | 745ms   | 29.4ms |
| GAME_LOADING/media      | 669    | 285ms   | 25.6ms |
| GAME_LOADING/readiness  | 26,378 | 1,594ms | 12.5ms |
| GAME_LOADING/accounting | 26,378 | 3,087ms | 12.4ms |
| GAME_LOADING/state-view | 4,086  | 1,725ms | 7.1ms  |

readiness/accounting 이 GAME_LOADING 동안 26,378번 호출됐다(tick 669번의 약 40배). PLAYING 에서는 365,539번이다.

3. CPU 프로파일(`.local/integration/product-child-<pid>.cpuprofile`, inspector 1ms 샘플). 이 MR 의 `scripts/profile-summary.mjs`·`scripts/profile-callers.mjs` 로 요약한다. 파일 두 개(5MB 씩)는 저장소에 넣지 않았고 MM 으로 전달한다.

## Q5. EventDispatcher 를 지목한 근거

근거가 없었다. F-REQ-13 과 같은 뿌리일 것이라는 추론이었다. 오늘 프로파일(attested, 서버 자식 프로세스 전체 143.5s 표본, 그중 idle 41.5s):

| self time   | 함수                                                          |
| ----------- | ------------------------------------------------------------- |
| 19.7s       | `keyCheck` node:internal/util/comparisons (isDeepStrictEqual) |
| 8.8s        | `objEquiv` 〃                                                 |
| 8.3s        | `structuredClone` node:internal/worker/js_transferable        |
| 3.7s + 3.7s | `innerDeepEqual`, `objectComparisonStart` 〃                  |
| 3.2s        | `writev` (native)                                             |
| 2.9s        | `observe` server/src/media/MediaGenerationRegistry.ts         |
| 2.5s        | `sameContent` server/src/game/EventDispatcher.ts              |
| 2.3s        | `computeVisibility` packages/game-core vision                 |
| 2.2s        | `observe` server/src/health/Readiness.ts                      |
| 1.9s        | `inspect` server/src/health/ReservationReadiness.ts           |

deep-equal·structuredClone 시간(합 46.1s)을 가장 가까운 앱 프레임에 귀속하면

| 귀속                                                                                                     | 시간   |
| -------------------------------------------------------------------------------------------------------- | ------ |
| `ReservationReadiness.inspect` (`isDeepStrictEqual(input, this.previous)` + `structuredClone(previous)`) | 36.7s  |
| `MediaGenerationRegistry.observe` (`structuredClone(frame)`)                                             | 4.8s   |
| `RecoveryState.snapshot` (`structuredClone(this.state)`)                                                 | 4.5s   |
| 나머지                                                                                                   | < 0.2s |

앱 프레임 포함 시간 상위: `ReservationReadiness.inspect` 38.9s, `MediaGenerationRegistry.observe` 7.7s, `RecoveryState.snapshot` 4.6s, `Readiness.observe` 4.1s, `EventDispatcher.sameContent` 2.5s, `computeVisibility` 2.3s, `KkakkungRoom` 익명 2.2s.

즉 서버 CPU 의 약 3분의 1이 readiness 캐시의 "입력이 이전과 같은가" 비교에 들어간다. 비교 대상이 저널 기록·예약 배열을 포함한 큰 입력이고 호출이 트랙 권한 검사마다(PLAYING 에서 초당 약 3,000회) 일어나기 때문이다. 이건 E 소유 코드다. F-REQ-17 의 "여유가 얇다" 는 B 가 아니라 여기서 온다. GAME_LOADING 창의 남은 절반(CPU 를 쓰지 않는 활성 시간)은 위 프로파일로는 안 보이며 동기 I/O 추적이 따로 필요하다.

A `createMatch` 는 `MAP_FINALIZING→GAME_LOADING` 창(전환 tick)에 들어가고 그 창은 CI 에서 최대 131ms, 대부분 0~100ms 다. 별도 항목으로 볼 가치는 있지만 GAME_LOADING 유지 구간의 반복 창과는 다른 문제다.

## Q6. 종료 기준의 `taskset -c 0` 대체

Windows 에서 못 쓰는 기준을 적은 것은 F 잘못이다. 다음으로 바꾼다.

- **측정 위치**: Jenkins `kkakkung-mr` 의 Verify(Linux, 4 vCPU, 다른 무거운 단계와 flock 으로 직렬화). 매 빌드 콘솔에 프로브가 남으므로 추가 배선 없이 `scripts/probe-extract.mjs` 로 읽는다.
- **기준**: 연속 3개 빌드에서 `GAME_LOADING→GAME_LOADING` 창의 최대 lag < 100ms 이고 `cpuUserMs` < 80ms, `MAP_FINALIZING→GAME_LOADING` 창 최대 lag < 150ms. 현재 값은 위 표(최대 lag 91~~200, cpu 61~~162).
- **보조**: E 가 붙이는 `tick.duration` 수집이 들어오면 GAME_LOADING 동안 tick 최대값 < 30ms 를 함께 본다(현재 phase-profile 의 GAME_LOADING/driver max 29.4ms 와 일치해야 함).
- 로컬 재현이 필요하면 `KKAKKUNG_TEST_CPU_PROFILE=1 pnpm exec vitest run server/test/media/product-integration.test.ts` 뒤 `node scripts/profile-callers.mjs .local/integration/product-child-<pid>.cpu-metadata.json .local/integration/product-child-<pid>.cpuprofile`. Windows 에서 그대로 된다.

## 인계 정리

- F-REQ-17 의 대상 파일에서 `server/src/game/EventDispatcher.ts` 를 뺀다. 남는 근거 있는 대상: `server/src/health/ReservationReadiness.ts`(E, 캐시 입력 비교·복제), `server/src/media/MediaGenerationRegistry.ts`(E, 프레임 복제), `server/src/operations/RecoveryState.ts`(E, 상태 복제), 그리고 GAME_LOADING 창의 비 CPU 절반(동기 I/O 의심, 미확인).
- B 쪽 조치는 지금 근거로는 없다. B 실측(개인 뷰 0건, tick 0.58ms)과 프로파일이 같은 말을 한다.
- E 에게 같은 문서로 넘긴다. 프로파일 파일은 MM 으로.
