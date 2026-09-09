# A 인계 기록 · 게임 규칙·맵·지식·장비·출구

갱신일: 2026-09-08 · 브랜치 `feat/mvp-a-d1` · 계약 EXEC-CONTRACT-3 · 결정 D-2026-09-08-01

이 문서는 A가 검증한 공개 함수·자료를 B/C/D/E/F가 연결할 때 참고하는 인계 기록이다. 단계 표기는 `PLANNED → CONTRACT_READY → LOCAL_VERIFIED → INTEGRATED → ACCEPTED`이며, 여기 적힌 LOCAL_VERIFIED는 A의 순수 함수 시험 통과를 뜻하고 실제 서버 연결·6인 검증은 아직 아니다. 관련 Jira 스토리는 아직 등록되지 않았다(맵 에픽 S15P21C204-30, 출구 에픽 S15P21C204-36만 존재).

## 1차 인계 · 맵 파이프라인 A-01~~A-05 (MP-01~~05)

| 고정 번호 | 원본 ID | localStage               | blockedOn                                | commit    |
| --------- | ------- | ------------------------ | ---------------------------------------- | --------- |
| A-01      | MP-01   | LOCAL_VERIFIED           | B-01 loader/Room 연결, F 배포 포함 목록  | `4ca2a95` |
| A-02      | MP-02   | LOCAL_VERIFIED           | B loader의 variantId 정렬·seed 선택 연결 | `69d1254` |
| A-03      | MP-03   | LOCAL_VERIFIED           | E MC-03 graph 조회 연결                  | `c780c19` |
| A-04      | MP-04   | LOCAL_VERIFIED           | B FL-05 createMatch 주입                 | `8be4b49` |
| A-05      | MP-05   | LOCAL_VERIFIED           | B FL-05 시간 예산·양보 결합, F test:maps | `86e6315` |
| A-06      | MP-06   | PRODUCT_DECISION_PENDING | 사용자 아이템 결정                       | 없음      |

### B에게 · 서버 loader와 매치 생성 (B-01/FL-05)

모든 함수는 `@kkakkung/game-core/match`(server/src/domain 재노출 포함)에서 import한다. 파일 IO·SHA-256·시계는 B가 소유하고 A는 파싱된 자료만 받는다.

```ts
import {
  validateTemplate,
  generateVariants,
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
  variantId: 'identity',
};
const base = validateTemplate(JSON.parse(text), source); // { ok, template } | { ok:false, issues }
const variants = generateVariants(base.template); // 최대 8개, variantId 오름차순
const template = variants.template[seed % variants.template.length]; // seed는 uint32
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

- 자료: `server/content/maps/master-v1.json`, `server/content/maps/practice-v1.json`(+ `practice` 블록은 `validatePracticeResources`), `server/config/tuning/mvp-v1.json`, `server/content/placements/master-v1-fallback.json`(`{ templateId, templateVersion, templateHash, fallbacks: FallbackLayout[] }`).
- `LayoutSelectionResult.selected.layout`만 core에 주입한다. seed·후보·MapSource·fallback 원문·`layoutId`의 해시 부분은 서버 내부 자료다.
- 정적 fallback의 `tagger-1..3`/`runner-1..3` 슬롯은 `certifyFallback`이 역할별 기본 문자열 정렬로 실제 playerId에 치환한다. 슬롯 문자열을 core 참가자로 넘기지 않는다.
- 거리 단위는 경로 이동 횟수(간선 수)다. 인접 두 셀의 거리는 1이다.
- 타입 이름: `Cell`, `WallFace`(`x,y`=벽 셀, `side`=접근 셀 방향), `Topology`, `LayoutTemplate`, `SpawnRegion`, `MapSource`, `FallbackLayout`, `MatchLayout`, `MatchTuning`, `MatchTuningConfig`. 상태 열거는 `MatchPhase`, `MatchPlayerStatus`로 export하며(기존 개발용 `Phase`/`PlayerStatus`와 구분) B가 protocol 쪽 이름으로 변환한다.

### E에게 · MC-03 거리 조회

`buildGraph(topology)` → `bfsDistances(graph, cell)`, `distance(graph, a, b)`, `distanceMatrix(graph, cells)`. 미도달은 `UNREACHABLE`(−1). 브라우저에는 graph를 주지 않는다.

### F에게 · 요청 사항

- `server/content/**`와 `server/config/tuning/**`을 서버 배포 산출물에 포함하고 서버가 읽을 설정 경로를 정한다(A는 manifest를 수정하지 않았다).
- 루트 `test:maps`를 `packages/game-core/test/match/certified-maps.test.ts`로 바꾸어 실제 맵 인증(8변형 연결성·fallback 인증·온라인 선발)을 CI 대상으로 연결한다.

### 검증 결과 (2026-09-08, 로컬)

```bash
pnpm build:packages
pnpm exec vitest run packages/game-core/test/match/   # 6 files, 52 tests passed
pnpm -r typecheck                                     # 통과
pnpm exec eslint packages server apps scripts         # 통과 (untracked prototype/ 폴더는 제외)
node scripts/check-boundaries.mjs                     # 통과
pnpm exec prettier --check packages server/content server/config
```

미실행: `pnpm verify` 전체(e2e 포함)는 오늘 종료 인계 시 실행 예정. 실제 B loader·Room 연결 시험, 6클라이언트 확인은 미실시.

## 2차 인계 · 규칙 엔진 A-07~A-18

진행 중. 완료 시 이 절을 갱신한다.
