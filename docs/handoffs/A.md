# A 인계 · 게임 규칙·맵·지식·장비·출구

담당 손주연 · 2026-09-15 정리 · 코드 `packages/game-core/src/match`

A는 서버 전용 순수 규칙이다. 파일 IO·SHA-256·시계·네트워크는 B가 소유하고 A는 파싱된 자료만 받는다. 모든 공개 함수는 `@kkakkung/game-core/match`에서 import한다. 규칙 값은 `server/config/tuning/mvp-v1.json`(`MatchTuning`)에서 오며 코어에 하드코딩한 규칙 상수는 없다.

## 상태

- 확정 범위의 맵 파이프라인·이동·회전·입력 버퍼·포획·승패·개인 종료·시야·지식·출구 발견·지도 교환·추적 표식·술래 장비·구속·출구 도전이 `develop`에 있고 제품 Room에 연결돼 있다.
- G3-A(포획·탈출·개인 종료·이탈)와 G3-B(설치·무장·구속·같은 Tick 후보)는 `tests/contracts/g3-room.test.ts`에서 실제 핸들러로 로컬 통과. 실제 6대 인수는 아니다.
- 도망자 아이템(MP-06, EQ-06–09)은 `PRODUCT_DECISION_PENDING`. 구현·stub·완료 집계를 하지 않는다. G3-C도 같다.

## B에게 · 맵 로드와 매치 생성

```ts
import {
  validateTemplate,
  createTemplateVariants,
  validateTuning,
  createLayoutSelector,
  type LayoutSelectionInput,
  type MapSource,
} from '@kkakkung/game-core/match';

const source: MapSource = {
  templateId: 'master-v1',
  templateVersion: '1',
  templateHash,
  variantId: 'r0',
};
const base = validateTemplate(JSON.parse(text), source); // valid | invalid{code,path}
const variants = createTemplateVariants(base.template); // r0–r3/mr0–mr3, variantId 오름차순
const template = variants.variants[seed % variants.variants.length]; // seed uint32
const fallback = fallbackFile.fallbacks.find((f) => f.variantId === template.variantId);
const tuning = validateTuning(JSON.parse(tuningText)).template;
const selector = createLayoutSelector(tuning);
const input: LayoutSelectionInput = {
  template,
  players,
  seed,
  maxAttempts: tuning.selection.maxAttempts,
  fallback,
};
const certified = selector.certifyFallback(input); // 탐색 전에 인증·보관
const iterator = selector.selectWithFallback(input); // next()마다 후보 최대 8개. 시간 초과면 iterator.return(certified)
```

- 자료: `server/content/maps/master-v1.json`, `maze-v1.json`(267, 통로 1칸 미로), `practice-v1.json`(`preparePracticeLayout(raw, players, role)`), `server/content/placements/master-v1-fallback.json`, `maze-v1-fallback.json`, `server/config/tuning/mvp-v1.json`. 본경기 템플릿은 `PRODUCT_MAP_TEMPLATE`으로 고르며 `maps/<id>.json`과 `placements/<id>-fallback.json`이 짝이다. maze-v1은 `scripts/generate-maze-template.mjs`(seed 267)가 재생성한다.
- core에는 `LayoutSelectionResult.selected.layout`만 넘긴다. seed·후보·fallback 원문은 서버 내부 자료다. fallback의 `tagger-1..3`/`runner-1..3` 슬롯은 `certifyFallback`이 실제 playerId로 치환한다.
- 거리는 경로 간선 수다. E의 가청 거리는 `buildGraph(topology)` → `bfsDistances`/`distance`/`distanceMatrix`(미도달 `UNREACHABLE` = −1). 브라우저에 graph를 주지 않는다.

## B에게 · 코어 진입점과 Tick 순서

```ts
import { matchCore, createMatch, createPractice, stepMatch } from '@kkakkung/game-core/match';
// matchCore: { createMatch, createPractice, stepMatch, getPlayerKnowledge,
//   getVisibleEntities, getPlayerSelf, getVisibleSurfaces, getFrame }
let state = createMatch({
  matchId,
  gameInstanceId,
  seed,
  tuning: tuningConfig.match,
  layout,
  players,
});
let result = stepMatch(state, {
  tick,
  commands: [],
  controls: [{ type: 'START_PLAYING', startTick: tick }],
});
result = stepMatch(result.state, { tick: tick + 1, commands, controls });
// result.outcomes: 명령마다 정확히 1개(applied|rejected|canceled). stateVersion은 B가 붙인다.
// result.events: SPATIAL_SOUND → TrustedMediaFrame.events(E), 개인 사건 → audience
// result.mediaIntents: RETIRE_PLAYER(personal-ended|connection-lost), RETIRE_INSTANCE(round-ended|aborted)
```

`tick`은 반드시 증가한다. 연습은 `createPractice({..., role})`이며 바로 `TEAM_PRACTICE`(포획·승패·마감 없음). 한 step의 처리 순서:

1. `START_PLAYING`/`EXPIRE_MOVE` control
2. 구속 자연 만료와 재구속 면역 시작
3. 이전 상태 기준 행동 완료 → 발소리 `SPATIAL_SOUND`
4. 포획(게임 모드)
5. 설치 예약 완료·무장(완료 Tick에 온 `INSTALL_CANCEL`은 늦음)
6. 2명 판정으로 terminal이면 남은 명령 canceled/`ROUND_ENDED`
7. 장비 발동(감지기 단발, 덫은 공통 우선순위로 정확히 1명)
8. 출구 도전 유지 검사(기한·구속·자세·개인 종료)
9. 명령(B 확정 수신 순서) → 대기 회전 슬롯/유지 이동 시작
10. 교환 세션 정리 → 지연 표식 공개 → 마감 Tick 판정
11. `CONNECTION_LOST`/`ABORT_MATCH`

## 명령과 거절 코드

공통 거절: `WRONG_MATCH`, `INVALID_PHASE`(PLAYING·TEAM_PRACTICE 외), `NOT_ALLOWED`(미등록·벽·구속), `NOT_ACTIVE`, `INVALID_COMMAND`(payload 형식). 같은 step에서 개인 종료된 actor의 뒤 명령은 canceled/`NOT_ACTIVE`.

| 명령               | payload                              | applied 조건                                                                                   | 추가 거절                                          |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `MOVE_INTENT`      | `{ direction: forward\|back\|null }` | 유지 의도(B가 500ms TTL로 `EXPIRE_MOVE`). `null`은 유지 이동만 제거                            | —                                                  |
| `TURN`             | `{ direction: left\|right }`         | 단발. 대기 슬롯 1개(교체)                                                                      | —                                                  |
| `EXCHANGE_REQUEST` | `{ targetPlayerId }`                 | 같은 칸 또는 직교로 붙은 통로의 다른 ACTIVE 도망자, 양쪽 세션 없음, 줄 새 지식 있음            | `NOT_ALLOWED`                                      |
| `EXCHANGE_ACCEPT`  | `{ exchangeId }`                     | 수신자가 40 Tick 안에 수락, 병합할 지식 남음                                                   | `STALE_REQUEST`·`EXPIRED`·`NOT_ALLOWED`            |
| `EXCHANGE_CANCEL`  | `{ exchangeId }`                     | 자기 세션                                                                                      | `STALE_REQUEST`·`NOT_ALLOWED`·`EXPIRED`            |
| `INSTALL`          | `{ kind: sensor\|trap }`             | 정지한 술래, 재고 1, 시작 칸 아님, 칸·벽면 미점유. 감지기는 앞이 내벽                          | `NOT_ALLOWED`                                      |
| `INSTALL_CANCEL`   | `{ installationId }`                 | 완료 Tick 전 자기 예약                                                                         | `STALE_REQUEST`·`NOT_ALLOWED`                      |
| `EXIT_START`       | `{ exitId }`                         | 자기 활성 출구 접근 칸에서 벽을 마주 본 ACTIVE 도망자, 행동·도전·구속 없음, 재시도 게이트 지남 | `NOT_ALLOWED`                                      |
| `EXIT_CANCEL`      | `{ challengeId }`                    | 자기 진행 중 도전                                                                              | `NOT_ALLOWED`                                      |
| `EXIT_PROGRESS`    | `{ challengeId, method, completed }` | 최소 40 Tick 경과·기한 160 Tick 전·접근 칸에서 벽을 마주 봄. `completed:false`는 도전 유지     | `STALE_REQUEST`·`NOT_READY`·`EXPIRED`·`NOT_ACTIVE` |

## 개인 사건

| 사건                   | audience         | payload                                                                                        |
| ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `EXCHANGE_OFFER`       | 요청 받은 도망자 | `exchangeId`, `fromPlayerId`, `expiresAtTick`                                                  |
| `EXCHANGE_CANCELED`    | 양쪽             | `exchangeId`, `reason`                                                                         |
| `EXCHANGE_COMPLETED`   | 양쪽 각자        | `exchangeId`, 자기 `mapVersion`                                                                |
| `HUNTER_MARKER`        | ACTIVE 술래 전원 | `markerId`, `kind`(exchange/sensor/trap), `point`, `occurredTick`, `showAtTick`, `expiresTick` |
| `EXIT_CHALLENGE`       | 도전한 도망자    | `challengeId`, `exitId`, `poseKind`, `startedAtTick`, `minSuccessTick`, `expiresAtTick`        |
| `EXIT_CHALLENGE_ENDED` | 해당 도망자      | `challengeId`, `result`(canceled/failed/escaped), `reason`                                     |

- `HUNTER_MARKER.point`는 두 칸의 중점이라 0.5 단위일 수 있다. 도망자 id·방향·현재 위치는 담지 않는다. 교환 표식은 `traceDelayTicks`(20) 뒤, 장비 표식은 즉시 공개되고 `traceVisibleTicks`(40) 동안 유지된다.
- `SPATIAL_SOUND`는 발소리·감지기·덫. 감지기·덫에는 `sourcePlayerId`가 없다.

## C/D에게 · 개인 뷰 재료

- `getVisibleSurfaces(state, playerId)` → `{ visibleCells, visibleWallFaces }`. 서버 카메라(셀 중심, 행동 보간, 수평 80도, 3.5셀) 기준. 벽면은 접근 셀 쪽에서만 보인다. `cameraFor`·`computeVisibility`를 export한다.
- `getVisibleEntities` → 같은 마스크의 다른 ACTIVE 플레이어(`cell`/`dir`/`action`/`role`)와 `sensor`(cell·wall·state)·`trap`(cell·state). 장비 소유자와 무장 예정 Tick은 없다.
- `getPlayerKnowledge` → `{ mapVersion, knownTerrain, knownActiveExits }`. `knownActiveExits`는 도망자만(poseKind 없음), 술래는 항상 빈 배열. `mapVersion`은 지형·활성 출구 집합이 바뀔 때만 증가한다. 출구 발견은 활성 출구 벽면이 `visibleWallFaces`에 정확히 있을 때만.
- `getPlayerSelf`(ACTIVE): `exchange`, `installation`, `ownedEquipment`, `equipment`, `restraintUntilTick`, `restraintImmuneUntilTick`, `challenge`. 개인 종료자는 `playerId`/`role`/`status`만.
- `Action = { kind: move|turn, from, to, startTick, endTick }`. 이동·회전 길이는 튜닝 `moveTicks`·`turnTicks`(현재 12·8 Tick, 270 임시값, `MATCH_TUNING_RANGES` 안의 정수), 완료 Tick에만 cell/dir 확정. 3D 변환(x→x, y→z)은 C.
- 설치 10 Tick → UNARMED(재고 소모) → 20 Tick → ARMED. 구속 30 Tick, 해제 뒤 면역 40 Tick(끝 경계 배타). 구속 중 회전 허용·이동 거절, 진행 중 도전은 canceled, 교환 세션은 같은 Tick 정리 단계에서 종료. 도전 실패 뒤 재시도 게이트 10 Tick.
- 서버는 실제 신체 자세나 카메라 진위를 증명하지 않는다. C가 보고한 성공의 시간·위치·중복만 보장한다.

## E·F에게

- 미디어 의도: 개인 종료(탈출 포함)마다 `RETIRE_PLAYER{reason:'personal-ended'}` 1회(멱등), RESULT/ABORTED 전환 시 `RETIRE_INSTANCE` 1회. 원격 회수 성공은 core가 판단하지 않는다.
- 회귀 재현: 덫 동시 후보는 `createPriorityOrder`·`priorityForTick`·`selectPriorityCandidate`로 같은 seed·Tick에서 재현한다. 경계 Tick은 `packages/game-core/test/match`의 sensor·trap·restraint·exit 시험에 고정돼 있다.

## 남은 일

- [S15P21C204-227](https://ssafy.atlassian.net/browse/S15P21C204-227) 6대 시험 판정 불일치의 같은 seed·Tick 재현과 회귀.
- [S15P21C204-229](https://ssafy.atlassian.net/browse/S15P21C204-229) 역할 교환 20판 밸런스 회귀와 규칙 값 튜닝.
- 실제 6대 5판(G5)에서 규칙·밸런스 확인.
