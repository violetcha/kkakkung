# A 인계 기록 · 게임 규칙·맵·지식·장비·출구

갱신일: 2026-09-09 · 담당 손주연 · 계약 EXEC-CONTRACT-3 · 결정 D-2026-09-08-01

표의 commit은 `develop`에 병합된 실제 SHA다. 스토리별 브랜치 하나에 MR 하나로 순서대로 병합했다. `develop` 병합은 코드 반영이며 아직 실제 생산자·소비자 연결 검증(INTEGRATED)이나 인수(ACCEPTED)가 아니다.

이 문서는 A가 검증한 공개 함수·자료를 B/C/D/E/F가 연결할 때 참고하는 인계 기록이다. 단계는 `PLANNED → CONTRACT_READY → LOCAL_VERIFIED → INTEGRATED → ACCEPTED`이며 여기 적힌 LOCAL_VERIFIED는 A의 순수 함수 시험 통과를 뜻하고 실제 서버 연결·6인 검증은 아직 아니다. Jira는 A-nn ↔ `S15P21C204-(47+nn)`로 일대일 대응하며 라벨(execution-role-A, 고정 번호, 원본 ID)을 실제 스토리와 대조했다. Jira 상태 변경은 담당자가 직접 한다.

## 작업 ↔ Jira ↔ 커밋

| 고정 번호 | 원본 ID | Jira                                                              | localStage               | 최종 commit | blockedOn                                         |
| --------- | ------- | ----------------------------------------------------------------- | ------------------------ | ----------- | ------------------------------------------------- |
| A-01      | MP-01   | [S15P21C204-48](https://ssafy.atlassian.net/browse/S15P21C204-48) | LOCAL_VERIFIED           | `270436e`   | B-01 loader/Room 연결, F 배포 포함 목록           |
| A-02      | MP-02   | [S15P21C204-49](https://ssafy.atlassian.net/browse/S15P21C204-49) | LOCAL_VERIFIED           | `d41dd30`   | B loader variantId 정렬·seed 선택 연결            |
| A-03      | MP-03   | [S15P21C204-50](https://ssafy.atlassian.net/browse/S15P21C204-50) | LOCAL_VERIFIED           | `fa83607`   | E MC-03 graph 조회 연결                           |
| A-04      | MP-04   | [S15P21C204-51](https://ssafy.atlassian.net/browse/S15P21C204-51) | LOCAL_VERIFIED           | `12cf829`   | B FL-05 createMatch 주입                          |
| A-05      | MP-05   | [S15P21C204-52](https://ssafy.atlassian.net/browse/S15P21C204-52) | LOCAL_VERIFIED           | `eeb53c0`   | B FL-05 시간 예산·양보 결합, F `test:maps` 연결   |
| A-06      | MP-06   | [S15P21C204-53](https://ssafy.atlassian.net/browse/S15P21C204-53) | PRODUCT_DECISION_PENDING | 없음        | 사용자 아이템 결정(구현·stub·완료 집계 대상 아님) |
| A-07      | EX-01   | [S15P21C204-54](https://ssafy.atlassian.net/browse/S15P21C204-54) | LOCAL_VERIFIED           | `fb7543b`   | KN-03 발견 연결(A-18), B/C poseKind 전달 경계     |
| A-08      | RL-05   | [S15P21C204-55](https://ssafy.atlassian.net/browse/S15P21C204-55) | LOCAL_VERIFIED           | `eb23a60`   | EQ-04 덫 연결(A-26), F QA-07 회귀 입력            |
| A-09      | RL-01   | [S15P21C204-56](https://ssafy.atlassian.net/browse/S15P21C204-56) | LOCAL_VERIFIED           | `e199e9b`   | B SV-04 Tick 어댑터 결합, C VI-02 fixture         |
| A-10      | RL-02   | [S15P21C204-57](https://ssafy.atlassian.net/browse/S15P21C204-57) | LOCAL_VERIFIED           | `667e2c9`   | D IN-08 turn 의도, C VI-02 회전 fixture           |
| A-11      | RL-03   | [S15P21C204-58](https://ssafy.atlassian.net/browse/S15P21C204-58) | LOCAL_VERIFIED           | `8a7068a`   | B SV-03 TTL 계측 연결, D IN-07/08 정책            |
| A-12      | RL-04   | [S15P21C204-59](https://ssafy.atlassian.net/browse/S15P21C204-59) | LOCAL_VERIFIED           | `99982d9`   | B SV-04·F QA-07 동시 완료 fixture 결합            |
| A-13      | RL-06   | [S15P21C204-60](https://ssafy.atlassian.net/browse/S15P21C204-60) | LOCAL_VERIFIED           | `d314770`   | B FL-06/08 start/deadline 계약 결합               |
| A-14      | RL-07   | [S15P21C204-61](https://ssafy.atlassian.net/browse/S15P21C204-61) | LOCAL_VERIFIED           | `d47274e`   | E MC-07 retire 결합, B KN-04 projection           |
| A-15      | RL-08   | [S15P21C204-62](https://ssafy.atlassian.net/browse/S15P21C204-62) | LOCAL_VERIFIED           | `65eb892`   | B SV-06 onLeave control 주입                      |
| A-16      | KN-01   | [S15P21C204-63](https://ssafy.atlassian.net/browse/S15P21C204-63) | LOCAL_VERIFIED           | `45d7269`   | B KN-04 projection, C VI-03 카메라 기준 연결      |
| A-17      | KN-02   | [S15P21C204-64](https://ssafy.atlassian.net/browse/S15P21C204-64) | LOCAL_VERIFIED           | `7712e28`   | B KN-04 wire 변환, C KN-09 지도 자료 연결         |
| A-18      | KN-03   | [S15P21C204-65](https://ssafy.atlassian.net/browse/S15P21C204-65) | LOCAL_VERIFIED           | `d7e8f23`   | B KN-04 역할별 출구 필드 허용 목록                |

보조 커밋: `97c615c` docs(1차 인계, 48부터 52), `955e603` docs(2차 인계·Jira 대응, 48부터 62), `5f170b9` fix(engine lint no-useless-assignment, 59·60).

한 커밋이 여러 작업의 모듈을 포함한 경우는 다음과 같다. 시험은 각 작업 커밋에 따로 있다.

| 커밋      | 포함한 모듈                                                | 시험이 있는 작업 |
| --------- | ---------------------------------------------------------- | ---------------- |
| `270436e` | MP-01 검증기와 `preparePracticeLayout`(PracticeLayoutPort) | A-01             |
| `667e2c9` | RL-02 회전과 RL-03 단일 슬롯 버퍼 helper                   | A-10, A-11       |
| `99982d9` | RL-04 포획과 RL-06/07/08 결과·개인 종료·이탈 모듈          | A-12 ~ A-15      |
| `45d7269` | KN-01 시야와 KN-02/03 지형 지식·출구 발견 모듈             | A-16 ~ A-18      |

## 1차 인계 · 맵 파이프라인 A-01부터 A-05

### B에게 · 서버 loader와 매치 생성 (B-01/FL-05)

모든 함수는 `@kkakkung/game-core/match`(server/src/domain 재노출 포함)에서 import한다. 파일 IO·SHA-256·시계는 B가 소유하고 A는 파싱된 자료만 받는다.

```ts
import {
  validateTemplate,
  createTemplateVariants,
  validateTuning,
  createLayoutSelector,
  type LayoutSelectionInput,
  type MapSource,
} from '@kkakkung/game-core/match';

// 1. 파일 바이트 → SHA-256(hex) → source. templateHash는 원본 바이트 hash다.
const source: MapSource = {
  templateId: 'master-v1',
  templateVersion: '1',
  templateHash,
  variantId: 'r0',
};
const base = validateTemplate(JSON.parse(text), source); // { status:'valid', template } | { status:'invalid', code, path }
const variants = createTemplateVariants(base.template); // { status:'valid', variants } · r0~r3/mr0~mr3, variantId 오름차순
const template = variants.variants[seed % variants.variants.length]; // seed는 uint32
// 2. fallback 파일에서 같은 variantId 항목을 고른다.
const fallback = fallbackFile.fallbacks.find((f) => f.variantId === template.variantId);
// 3. tuning을 묶어 포트를 만든다.
const tuning = validateTuning(JSON.parse(tuningText)).template;
const selector = createLayoutSelector(tuning);
const input: LayoutSelectionInput = {
  template,
  players,
  seed,
  maxAttempts: tuning.selection.maxAttempts,
  fallback,
};
const certified = selector.certifyFallback(input); // 탐색 전 먼저 인증·보관
const iterator = selector.selectWithFallback(input);
// next() 전후로 monotonic deadline을 검사한다. 각 next()는 최대 8개 후보만 검사한다.
// 시간 초과: iterator.return(certified). 정상 소진: 같은 인증 결과가 반환된다.
```

- 자료: `server/content/maps/master-v1.json`, `server/content/maps/practice-v1.json`(`PracticeLayoutTemplate {practiceVersion, layouts:{runner,tagger}}`, `preparePracticeLayout(raw, players, role)`으로 팀 1~3명 슬롯 바인딩), `server/config/tuning/mvp-v1.json`, `server/content/placements/master-v1-fallback.json`(`{ templateId, templateVersion, templateHash, fallbacks: FallbackLayout[] }`).
- `LayoutSelectionResult.selected.layout`만 core에 주입한다. seed·후보·MapSource·fallback 원문·`layoutId`의 해시 부분은 서버 내부 자료다.
- 정적 fallback의 `tagger-1..3`/`runner-1..3` 슬롯은 `certifyFallback`이 역할별 기본 문자열 정렬로 실제 playerId에 치환한다. 슬롯 문자열을 core 참가자로 넘기지 않는다.
- 거리 단위는 경로 이동 횟수(간선 수)다. 인접 두 셀의 거리는 1이다.
- 타입 이름: `Cell`, `WallFace`(`x,y`=벽 셀, `side`=접근 셀 방향), `Topology`, `LayoutTemplate`, `SpawnRegion`, `MapSource`, `FallbackLayout`, `MatchLayout`, `MatchTuning`, `MatchTuningConfig`. 상태 열거는 계약 이름 `Phase`/`PlayerStatus`(대문자)이며 기존 개발용은 `LegacyPhase`/`LegacyPlayerStatus`로 분리했다.

### E에게 · MC-03 거리 조회

`buildGraph(topology)` → `bfsDistances(graph, cell)`, `distance(graph, a, b)`, `distanceMatrix(graph, cells)`. 미도달은 `UNREACHABLE`(−1). 브라우저에는 graph를 주지 않는다.

### F에게 · 요청 사항

- `server/content/**`와 `server/config/tuning/**`을 서버 배포 산출물에 포함하고 서버가 읽을 설정 경로를 정한다(A는 manifest를 수정하지 않았다).
- 루트 `test:maps`를 `packages/game-core/test/match/certified-maps.test.ts`로 바꾸어 실제 맵 인증(8변형 연결성·fallback 인증·온라인 선발)을 CI 대상으로 연결한다.

## 2차 인계 · 규칙 엔진 A-07부터 A-15

### B에게 · 코어 진입점 (SV-04/FL-05/SV-06)

```ts
import {
  matchCore,
  createMatch,
  createPractice,
  stepMatch,
  preparePracticeLayout,
} from '@kkakkung/game-core/match';
// matchCore: CorePort<MatchState> = { createMatch, createPractice, stepMatch, getPlayerKnowledge,
//   getVisibleEntities, getPlayerSelf, getVisibleSurfaces, getFrame }
let state = createMatch({
  matchId,
  gameInstanceId,
  seed,
  tuning: tuningConfig.match,
  layout: selected.layout,
  players,
});
// 라운드 시작: B가 확정한 startTick을 control로 주입한다. deadlineTick = startTick + 3600.
let result = stepMatch(state, {
  tick,
  commands: [],
  controls: [{ type: 'START_PLAYING', startTick: tick }],
});
// 매 Tick: B가 접수한 명령(actorId 주입)과 control(EXPIRE_MOVE/CONNECTION_LOST/ABORT_MATCH)을 넣는다.
result = stepMatch(result.state, { tick: tick + 1, commands, controls });
// result.outcomes: 명령마다 정확히 1개(applied/rejected/canceled, stateVersion 없음 → B가 붙임)
// result.events: SPATIAL_SOUND(footstep)는 TrustedMediaFrame.events로 E에, EXIT_CHALLENGE_ENDED는 audience에게
// result.mediaIntents: RETIRE_PLAYER(personal-ended/connection-lost), RETIRE_INSTANCE(round-ended/aborted)
```

- 명령 처리 순서(한 step): START_PLAYING/EXPIRE_MOVE control → 이전 상태 기준 행동 완료 → 포획(게임 모드) → 2명 승패 판정(terminal이면 남은 명령 canceled/ROUND_ENDED) → 명령(B 확정 수신 순서) → 대기 슬롯/heldMove 시작 → 마감 Tick 판정 → CONNECTION_LOST/ABORT_MATCH.
- 거절 코드: `WRONG_MATCH`, `INVALID_PHASE`(PLAYING 또는 TEAM_PRACTICE 외), `NOT_ALLOWED`(미등록 actor·벽·구속), `NOT_ACTIVE`, `INVALID_COMMAND`(미지원 타입·잘못된 payload). 같은 step에서 개인 종료된 actor의 뒤 명령은 `canceled/NOT_ACTIVE`.
- `tick`은 반드시 증가해야 하며 첫 step 전 `getFrame().tick`은 0이다. 연습은 `createPractice({ ..., role })`+`preparePracticeLayout(practiceJson, players, role).layout`이고 phase는 바로 `TEAM_PRACTICE`(START_PLAYING 불필요, 포획·승패·마감 없음).
- 아직 미지원 명령: EXCHANGE, INSTALL, EXIT 계열(D2 A-19부터 A-27, A-32부터 A-33)은 현재 `rejected/INVALID_COMMAND`. 시야·지식 selector는 `e5512a4`부터 실제 마스크·지식을 반환한다.

### C/D에게 · 상태 샘플

- `Action = { kind: 'move'|'turn', from: {x,y,dir}, to: {x,y,dir}, startTick, endTick }`, 이동 9 Tick·회전 6 Tick, 완료 Tick에만 cell/dir 커밋. 3D 변환(x→x, y→z)은 C가 한다.
- 입력 버퍼 정책: MOVE_INTENT는 10Hz 유지 의도(heldMove, B가 500ms TTL로 EXPIRE_MOVE), TURN은 단발 대기 슬롯 1개(교체), 완료 후 단발 먼저 소비. `direction: null`은 heldMove만 제거.

### E에게 · 미디어 의도

- `RETIRE_PLAYER{playerId, reason:'personal-ended'}`는 개인 종료마다 1회(멱등), `RETIRE_INSTANCE{reason:'round-ended'|'aborted'}`는 RESULT/ABORTED 전환 시 1회. 원격 회수 성공 여부는 core가 판단하지 않는다.

## 3차 인계 · 시야·지식 A-16부터 A-18

### B에게 · 개인 projection 재료 (KN-04)

- `getVisibleSurfaces(state, playerId)` → `{ visibleCells, visibleWallFaces }`. 현재 Tick의 서버 카메라(행동 보간, 수평 80도, 3.5셀) 기준이며 ACTIVE가 아닌 플레이어는 빈 배열. private-view의 visibleCells/visibleWallFaces에 그대로 쓴다.
- `getVisibleEntities(state, playerId)` → 같은 마스크로 걸러진 다른 ACTIVE 플레이어(`kind:'player'`, cell/dir/action/role). sensor/trap 엔티티는 EQ 작업(A-23 이후)에서 추가한다.
- `getPlayerKnowledge(state, playerId)` → `{ mapVersion, knownTerrain, knownActiveExits }`. knownTerrain은 floor(`{x,y,kind}`)와 wall(`{x,y,side,kind}`)만, 정렬 고정. knownActiveExits는 도망자만 채워지고(poseKind 없음) 술래는 항상 빈 배열이다. mapVersion은 지형 지식이나 활성 출구 집합이 바뀔 때만 증가하며 stateVersion과 별개다.
- 초기 지식: 도망자 자기 셀+첫 시야, 술래 담당 구역 통로·경계 벽면+첫 시야(createMatch 시점). 출구 발견은 활성 출구의 벽면이 visibleWallFaces에 정확히 있을 때만이며 RL-07 폐쇄 시 모든 도망자의 공개 집합에서 즉시 빠진다.

### C에게 · VI-03 카메라 기준

- 서버 카메라 위치는 셀 중심(+0.5), 이동 중에는 from→to 보간, 회전 중에는 최단 90도 회전(3→0은 90도). `cameraFor(player, tick)`와 `computeVisibility(topology, camera)`를 export하므로 fixture 비교에 쓸 수 있다.
- 벽면은 카메라가 접근 셀 쪽에 있을 때만 보이며 뒷면·벽 뒤 통로·대각 틈새는 공개되지 않는다(시험 고정).

### 검증 결과 (2026-09-09 병합 시점, 로컬)

| 검사                                                                     | 결과                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                      | 통과                                                                                      |
| `pnpm check:execution`                                                   | 통과                                                                                      |
| `pnpm exec eslint packages server apps scripts` + `check-boundaries.mjs` | 통과                                                                                      |
| `pnpm typecheck`                                                         | 통과 (4 workspace)                                                                        |
| `pnpm test`                                                              | 통과. 병합 직전 기준 game-core match 22 files 148 tests, 저장소 전체 112 files 1227 tests |
| `pnpm build`                                                             | 통과                                                                                      |
| `pnpm test:e2e`                                                          | Playwright chromium 설치 후 실행 가능. A 변경은 브라우저 경로를 쓰지 않는다               |

미실시: 실제 B Room 연결, 6클라이언트·Cloud 확인. 모든 A 작업의 localStage는 LOCAL_VERIFIED이며 INTEGRATED/ACCEPTED가 아니다.

각 스토리 브랜치는 병합 직전에 해당 커밋 단독으로 빌드·시험·lint를 다시 확인했다. 저장소 전체 시험에서 E 소유 운영 시험 1건(공식 체크포인트 시간 초과 경로)이 간헐적으로 실패하고 재실행에서 통과한다. A 변경과 무관하며 소유자 확인이 필요하다.

## D2(2026-09-09) 예정

A-19부터 A-27(지도 교환·장비 설치·감지기·덫·구속)과 A-32·A-33(출구 도전·탈출)을 구현한다. A-28부터 A-31은 도망자 아이템 결정 대기로 유지한다.
