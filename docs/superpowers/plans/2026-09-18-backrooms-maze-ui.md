# Backrooms Maze UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default block maze with a narrow Backrooms renderer and a camcorder-style, five-slot responsive HUD without changing authoritative game rules.

**Architecture:** Keep `PrivateView`, visibility filtering, movement, and map coordinates untouched. Add a quality-aware Backrooms texture/resource layer to the existing facility renderer, then replace only the visual overlay composition in `ProductApp` and `HudPreview`.

**Tech Stack:** TypeScript, React 19, React Three Fiber, Three.js, Vitest, Playwright, CSS

**Spec:** `docs/superpowers/specs/2026-09-18-backrooms-maze-ui-design.md`

## Global Constraints

- Jira key: `S15P21C204-279`.
- Branch: `feat/S15P21C204-279-backrooms-ui-redesign`.
- Preserve server movement, collision, visibility, equipment, exchange, and minimap contracts.
- Do not implement undecided runner items; three new hotbar positions remain locked placeholders.
- Medium quality uses albedo, roughness, and normal maps; low quality uses only the seamless color map.
- No new runtime dependency or post-processing pass.
- Keep the block theme as a selectable fallback and make the Backrooms facility theme the default.
- Verify targeted tests, web typecheck, desktop screenshot, and 400px screenshot locally; defer the full suite to the MR pipeline.
- Commit each task locally with `S15P21C204-279` as the final paragraph; do not push until the complete UI series is approved.

---

### Task 1: Backrooms texture contract and asset ledger

**Files:**

- Create: `apps/web/src/features/game/scene/backrooms-textures.ts`
- Create: `apps/web/src/features/game/scene/backrooms-textures.test.ts`
- Create: `apps/web/public/textures/backrooms/albedo.png`
- Create: `apps/web/public/textures/backrooms/roughness.png`
- Create: `apps/web/public/textures/backrooms/normal.png`
- Create: `apps/web/public/textures/backrooms/seamless.png`
- Modify: `docs/third-party-assets.md`

**Interfaces:**

- Produces: `BACKROOMS_TEXTURE_PATHS`, `backroomsTexturePaths(quality)`, and `configureBackroomsTexture(texture, kind)`.
- Consumes: `QualityPreset` from `quality-presets.ts`.

- [x] **Step 1: Write the failing texture contract test**

```ts
it('uses full PBR maps for medium and one seamless color map for low', () => {
  expect(backroomsTexturePaths('medium')).toEqual({
    color: '/textures/backrooms/albedo.png',
    roughness: '/textures/backrooms/roughness.png',
    normal: '/textures/backrooms/normal.png',
  });
  expect(backroomsTexturePaths('low')).toEqual({
    color: '/textures/backrooms/seamless.png',
    roughness: null,
    normal: null,
  });
});
```

- [x] **Step 2: Run the test and verify an import failure**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/scene/backrooms-textures.test.ts`

- [x] **Step 3: Add the four assets, texture configuration, and ledger hashes**

```ts
export function backroomsTexturePaths(quality: QualityPreset) {
  return quality === 'low'
    ? { color: BACKROOMS_TEXTURE_PATHS.seamless, roughness: null, normal: null }
    : {
        color: BACKROOMS_TEXTURE_PATHS.albedo,
        roughness: BACKROOMS_TEXTURE_PATHS.roughness,
        normal: BACKROOMS_TEXTURE_PATHS.normal,
      };
}
```

- [x] **Step 4: Run the texture and asset-ledger tests**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/scene/backrooms-textures.test.ts tests/contracts/asset-ledger.test.ts`

- [x] **Step 5: Commit**

```text
design: 백룸 벽지 PBR 재질을 추가한다

S15P21C204-279
```

### Task 2: Narrow Backrooms facility renderer

**Files:**

- Modify: `apps/web/src/features/game/scene/facility-theme.ts`
- Modify: `apps/web/src/features/game/scene/primitives.tsx`
- Modify: `apps/web/src/features/game/scene/WorldCanvas.tsx`
- Modify: `apps/web/src/features/game/scene/scene-theme.ts`
- Modify: `apps/web/src/features/game/scene/facility-rendering.test.ts`
- Modify: `apps/web/src/features/game/scene/facility-lighting.test.ts`
- Modify: `apps/web/src/features/game/scene/scene-theme.test.ts`

**Interfaces:**

- Consumes: quality-specific `BackroomsTextureSet` from Task 1.
- Produces: `createFacilityResources(textures, quality)`, elevated Backrooms geometry, and the default `facility` scene theme.

- [x] **Step 1: Add failing tests for default theme, tall corridor, and quality geometry**

```ts
expect(DEFAULT_SCENE_THEME).toBe('facility');
expect(FACILITY.wallHeight).toBeGreaterThan(1.6);
expect(createFacilityResources(undefined, 'low').geometry.panel).toBeNull();
```

- [x] **Step 2: Run the three scene tests and verify the assertions fail**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/scene/scene-theme.test.ts apps/web/src/features/game/scene/facility-rendering.test.ts apps/web/src/features/game/scene/facility-lighting.test.ts`

- [x] **Step 3: Implement the Backrooms geometry and quality-aware materials**

Use a `1 × wallHeight` wall, carpet floor, ceiling tile, fluorescent housing/tube, and optional low-cost trim. Apply `RepeatWrapping` and the correct color space through the texture helper; keep wall positions and server cells unchanged.

- [x] **Step 4: Pass `quality` through `VisibleTerrain` and `ScenePrimitives`**

```tsx
<VisibleTerrain view={view} theme={theme} quality={quality} />
```

- [x] **Step 5: Run the targeted scene tests and web typecheck**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/scene/*.test.ts`
Run: `.\\node_modules\\.bin\\tsc.cmd --noEmit -p apps/web/tsconfig.json`

- [x] **Step 6: Commit**

```text
design: 미로를 좁은 백룸형 복도로 바꾼다

S15P21C204-279
```

### Task 3: Camcorder recording overlay

**Files:**

- Create: `apps/web/src/features/game/flow/CamcorderOverlay.tsx`
- Create: `apps/web/src/features/game/flow/camcorder-overlay.test.ts`
- Modify: `apps/web/src/app/ProductApp.tsx`
- Modify: `apps/web/src/app/HudPreview.tsx`

**Interfaces:**

- Produces: `formatRecordingTime(elapsedSeconds)` and `<CamcorderOverlay startedAtMs? nowMs?>`.
- Consumes: no game-authoritative time.

- [x] **Step 1: Write failing formatting and markup tests**

```ts
expect(formatRecordingTime(4)).toBe('00:00:04');
expect(formatRecordingTime(3_661)).toBe('01:01:01');
expect(html).toContain('aria-label="녹화 중 00:00:04"');
```

- [x] **Step 2: Run the test and verify the module is missing**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/flow/camcorder-overlay.test.ts`

- [x] **Step 3: Implement the timer and overlay component**

Use a one-second interval, clear it on unmount, and render four decorative corner spans plus a red REC indicator. Injected times keep the test deterministic.

- [x] **Step 4: Replace visible `GameHud` and `EventLog` placement**

Render `<CamcorderOverlay />` in `ProductApp` and a fixed four-second overlay in `HudPreview`. Keep `GameHud` in an `sr-only` container so authoritative state remains accessible.

- [x] **Step 5: Run the component tests**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/flow/camcorder-overlay.test.ts apps/web/src/features/game/flow/game-hud.test.ts`

- [x] **Step 6: Commit**

```text
design: 경기 화면에 캠코더 녹화 프레임을 적용한다

S15P21C204-279
```

### Task 4: Five-slot non-pixel hotbar

**Files:**

- Modify: `apps/web/src/features/game/flow/hotbar-model.ts`
- Modify: `apps/web/src/features/game/flow/hotbar-model.test.ts`
- Modify: `apps/web/src/features/game/flow/Hotbar.tsx`

**Interfaces:**

- Produces: exactly five `HotbarSlot` values for every active runner or tagger.
- Preserves: existing sensor, trap, and exchange selection behavior.

- [ ] **Step 1: Change tests to require exactly five slots and three locked placeholders**

```ts
expect(slots).toHaveLength(5);
expect(slots.slice(2).every((slot) => slot.state === 'reserved')).toBe(true);
```

- [ ] **Step 2: Run the model test and verify the expected two-versus-five failure**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/flow/hotbar-model.test.ts`

- [ ] **Step 3: Append immutable placeholder slots without adding runner equipment**

Use IDs `locked-3`, `locked-4`, and `locked-5`, empty labels, and `reserved` state. Preserve the two existing role slots as positions 1 and 2.

- [ ] **Step 4: Run hotbar model and markup tests**

Run: `.\\node_modules\\.bin\\vitest.cmd run apps/web/src/features/game/flow/hotbar-model.test.ts apps/web/src/features/game/flow/game-hud.test.ts`

- [ ] **Step 5: Commit**

```text
design: 중앙 하단 핫바를 다섯 칸으로 정리한다

S15P21C204-279
```

### Task 5: Responsive camcorder HUD layout

**Files:**

- Modify: `apps/web/src/styles.css`
- Modify: `tests/e2e/game-hud-layout.spec.ts`

**Interfaces:**

- Consumes: `.camcorder-overlay`, `.hotbar`, `.mini-map`, `.hud-drawer`, `.game-status-a11y`.
- Produces: desktop and 400px layouts with no left-bottom HUD or horizontal overflow.

- [ ] **Step 1: Rewrite the E2E assertions before CSS**

Assert that the camcorder frame fills the stage, the event log is absent, the hotbar has five slots at bottom center, and the minimap stays bottom right at desktop and 400px.

- [ ] **Step 2: Run the E2E spec and verify it fails against the old layout**

Run: `.\\node_modules\\.bin\\playwright.cmd test tests/e2e/game-hud-layout.spec.ts --project=chromium`

- [ ] **Step 3: Implement glass/metal HUD CSS and responsive sizing**

Use fluid slot sizes with `clamp()`, no pixel-art border radius, corner brackets via CSS borders, and a compact minimap. Hide hotbar labels/details below 700px while retaining accessible names.

- [ ] **Step 4: Run the E2E spec and capture screenshots**

Run: `.\\node_modules\\.bin\\playwright.cmd test tests/e2e/game-hud-layout.spec.ts --project=chromium`

Save desktop and 400px screenshots under `artifacts/S15P21C204-279/` and inspect both.

- [ ] **Step 5: Commit**

```text
design: 백룸 경기 HUD를 반응형으로 배치한다

S15P21C204-279
```

### Task 6: Documentation and targeted verification

**Files:**

- Modify: `docs/spec/current.md`
- Modify: `docs/third-party-assets.md`
- Modify: `docs/superpowers/plans/2026-09-18-backrooms-maze-ui.md`

**Interfaces:**

- Records: decided default theme, asset provenance, quality behavior, screenshots, and executed checks.

- [ ] **Step 1: Update current product documentation**

Replace the block-default description with the Backrooms corridor, PBR/low-quality split, camcorder overlay, five-slot hotbar, and responsive placement.

- [ ] **Step 2: Run focused verification**

```powershell
.\node_modules\.bin\vitest.cmd run apps/web/src/features/game/scene apps/web/src/features/game/flow tests/contracts/asset-ledger.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p apps/web/tsconfig.json
.\node_modules\.bin\tsc.cmd --noEmit -p apps/web/tsconfig.worker.json
git diff --check
```

- [ ] **Step 3: Record actual results and plan completion**

Mark only completed checkboxes in this plan. Do not claim `pnpm verify`, push, MR, Jira completion, or pipeline success.

- [ ] **Step 4: Commit**

```text
docs: 백룸형 경기 UI 변경을 문서화한다

S15P21C204-279
```
