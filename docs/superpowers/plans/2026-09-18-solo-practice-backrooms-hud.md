# Solo Practice Backrooms HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the existing backrooms camcorder HUD to the solo practice canvas shown from the production root flow.

**Architecture:** Reuse the existing `CamcorderOverlay`, `Hotbar`, and `MiniMap` components through a small solo-practice HUD composition. Keep the local session, device-check panel, and movement behavior unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, CSS

**Spec:** Jira S15P21C204-287

## Global Constraints

- Preserve the solo practice session and device-check behavior.
- Reuse the five-slot hotbar and minimap rather than duplicating their models.
- Keep the low-quality renderer setting for low-end devices.

---

### Task 1: Compose and mount the solo HUD

**Files:**

- Create: `apps/web/src/features/game/solo/SoloPracticeHud.tsx`
- Create: `apps/web/src/features/game/solo/solo-practice-hud.test.ts`
- Modify: `apps/web/src/features/game/solo/SoloPracticeScreen.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

- Consumes: `PrivateView`, render tick, selected equipment.
- Produces: `SoloPracticeHud` with recording frame, crosshair, hotbar, and minimap.

- [ ] Write a server-rendered test asserting all four HUD regions and five item slots.
- [ ] Run the test and confirm it fails because `SoloPracticeHud` does not exist.
- [ ] Implement the composition and mount it inside the solo stage.
- [ ] Reuse game-stage positioning and add only solo-specific responsive sizing.
- [ ] Run the focused test, typecheck, and formatting checks.
- [ ] Commit with Jira key `S15P21C204-287`.
