import { describe, expect, it } from 'vitest';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { roundFixture, viewFixture } from '../../room/product-fixture';
import {
  carryRole,
  cueState,
  captureProgressFlash,
  CAPTURE_PROGRESS_FLASHES,
  detectCues,
  detectEffectFlashes,
  EFFECT_FLASHES,
  FLASH_CUES,
  isEffectFlash,
  isFlashCue,
  isProgressCue,
  type CueState,
} from './match-cues';

const active = (overrides: Partial<Extract<PrivateView['self'], { status: 'ACTIVE' }>> = {}) => {
  const self = viewFixture().self;
  if (self?.status !== 'ACTIVE') throw Error('active self required');
  return { ...self, ...overrides };
};
const ended = (status: 'ESCAPED' | 'CAPTURED', role: 'runner' | 'tagger' = 'runner') =>
  ({ playerId: 'self', role, status }) as PrivateView['self'];
const state = (input: Partial<Parameters<typeof cueState>[0]> = {}) =>
  cueState({
    round: roundFixture(),
    self: active(),
    endedSelf: null,
    tick: 100,
    countdown: null,
    ...input,
  });

describe('cueState', () => {
  it('reads role and status from the ended self once the view is cleared', () => {
    const s = state({ self: null, endedSelf: ended('CAPTURED', 'tagger') });
    expect(s).toMatchObject({ role: 'tagger', status: 'CAPTURED', restrained: false });
  });
  it('is restrained only while the server tick is before restraintUntilTick', () => {
    expect(state({ self: active({ restraintUntilTick: 130 }), tick: 100 }).restrained).toBe(true);
    expect(state({ self: active({ restraintUntilTick: 130 }), tick: 130 }).restrained).toBe(false);
  });
  it('keeps the countdown only during COUNTDOWN', () => {
    expect(state({ round: roundFixture({ phase: 'COUNTDOWN' }), countdown: 2 }).countdown).toBe(2);
    expect(state({ round: roundFixture({ phase: 'PLAYING' }), countdown: 2 }).countdown).toBeNull();
  });
});

describe('detectCues', () => {
  it('never cues on the first state or across a rematch', () => {
    const first = state();
    expect(detectCues(null, first)).toEqual([]);
    const next = state({
      round: roundFixture({ matchId: 'next', counts: { escaped: 2, captured: 0 } }),
    });
    expect(detectCues(first, next)).toEqual([]);
  });
  it('ticks each displayed countdown second once and cues the start', () => {
    const three = state({ round: roundFixture({ phase: 'COUNTDOWN' }), countdown: 3 });
    const still = state({ round: roundFixture({ phase: 'COUNTDOWN' }), countdown: 3 });
    const two = state({ round: roundFixture({ phase: 'COUNTDOWN' }), countdown: 2 });
    const zero = state({ round: roundFixture({ phase: 'COUNTDOWN' }), countdown: 0 });
    expect(detectCues(state({ round: roundFixture({ phase: 'GAME_LOADING' }) }), three)).toEqual([
      'countdown',
    ]);
    expect(detectCues(three, still)).toEqual([]);
    expect(detectCues(three, two)).toEqual(['countdown']);
    expect(detectCues(two, zero)).toEqual([]);
    expect(detectCues(zero, state())).toEqual(['start']);
  });
  it('cues restraint on entry only', () => {
    const free = state();
    const held = state({ self: active({ restraintUntilTick: 160 }) });
    expect(detectCues(free, held)).toEqual(['restrained']);
    expect(detectCues(held, held)).toEqual([]);
    expect(detectCues(held, free)).toEqual([]);
  });
  it('cues my own capture or escape and drops the count cue that reports the same event', () => {
    const before = state();
    const captured = state({
      round: roundFixture({ counts: { escaped: 0, captured: 1 } }),
      self: null,
      endedSelf: ended('CAPTURED'),
    });
    expect(detectCues(before, captured)).toEqual(['captured']);
    const escaped = state({
      round: roundFixture({ counts: { escaped: 1, captured: 0 } }),
      self: null,
      endedSelf: ended('ESCAPED'),
    });
    expect(detectCues(before, escaped)).toEqual(['escaped']);
    // 이미 종료된 뒤 남은 경기의 누계는 알리지 않는다.
    const later = state({
      round: roundFixture({ counts: { escaped: 1, captured: 1 } }),
      self: null,
      endedSelf: ended('ESCAPED'),
    });
    expect(detectCues(escaped, later)).toEqual([]);
  });
  it('turns public count changes into ally or enemy progress by role', () => {
    const runner = state();
    const tagger = state({ self: active({ role: 'tagger' }) });
    const escapedOne = (base: CueState) => ({ ...base, escaped: 1 });
    const capturedOne = (base: CueState) => ({ ...base, captured: 1 });
    expect(detectCues(runner, escapedOne(runner))).toEqual(['ally-progress']);
    expect(detectCues(runner, capturedOne(runner))).toEqual(['enemy-progress']);
    expect(detectCues(tagger, escapedOne(tagger))).toEqual(['enemy-progress']);
    expect(detectCues(tagger, capturedOne(tagger))).toEqual(['ally-progress']);
    expect(isProgressCue('ally-progress')).toBe(true);
    expect(isProgressCue('captured')).toBe(false);
  });
  it('shows a confirmed capture only to an active tagger during play', () => {
    const tagger = state({ self: active({ role: 'tagger' }) });
    const runner = state();
    expect(captureProgressFlash(tagger, { ...tagger, captured: 1 })).toBe('capture-success');
    expect(captureProgressFlash(runner, { ...runner, captured: 1 })).toBeNull();
    expect(captureProgressFlash(tagger, { ...tagger, captured: 0 })).toBeNull();
    expect(captureProgressFlash(tagger, { ...tagger, phase: 'RESULT', captured: 2 })).toBeNull();
    expect(CAPTURE_PROGRESS_FLASHES).toEqual(['capture-success']);
  });
  it('decides victory, defeat or abort once and suppresses count cues in the same transition', () => {
    const playing = state();
    const runnersWin = state({
      round: roundFixture({
        phase: 'RESULT',
        counts: { escaped: 2, captured: 0 },
        result: { winner: 'runners', reason: 'two-escaped' },
      }),
    });
    expect(detectCues(playing, runnersWin)).toEqual(['victory']);
    expect(detectCues(runnersWin, runnersWin)).toEqual([]);
    const taggersWin = state({
      round: roundFixture({
        phase: 'RESULT',
        counts: { escaped: 0, captured: 2 },
        result: { winner: 'taggers', reason: 'two-captured' },
      }),
    });
    expect(detectCues(playing, taggersWin)).toEqual(['defeat']);
    expect(
      detectCues(
        playing,
        state({ round: roundFixture({ phase: 'ABORTED', abortReason: 'GAME_CONNECTION_LOST' }) }),
      ),
    ).toEqual(['aborted']);
    // 이미 포획된 사람도 팀 결과는 듣는다.
    const capturedSelf = state({
      round: roundFixture({ counts: { escaped: 0, captured: 1 } }),
      self: null,
      endedSelf: ended('CAPTURED'),
    });
    expect(detectCues(capturedSelf, { ...taggersWin, status: 'CAPTURED' })).toEqual(['defeat']);
  });
  // S15P21C204-334. 경기 종료 전이로 self 가 비워진 생존자.
  it('gives a survivor whose view was emptied at RESULT the team result, never an abort', () => {
    const playing = state();
    const emptied = state({
      self: null,
      round: roundFixture({
        phase: 'RESULT',
        counts: { escaped: 1, captured: 1 },
        result: { winner: 'runners', reason: 'timeout' },
      }),
    });
    expect(emptied.role).toBeNull();
    expect(detectCues(playing, emptied)).toEqual(['victory']);
    const tagger = state({ self: active({ role: 'tagger' }) });
    expect(detectCues(tagger, emptied)).toEqual(['defeat']);
  });
  it('does not call a decided match void for someone whose role was never known', () => {
    const unknown = state({ self: null });
    const decided = state({
      self: null,
      round: roundFixture({ phase: 'RESULT', result: { winner: 'runners', reason: 'timeout' } }),
    });
    expect(detectCues(unknown, decided)).toEqual([]);
  });
  it('carries the role forward within a match once the view is emptied', () => {
    const playing = state();
    const emptied = state({ self: null });
    expect(carryRole(playing, emptied)).toMatchObject({ role: 'runner', status: null });
    expect(carryRole(null, emptied).role).toBeNull();
    expect(carryRole(playing, { ...emptied, matchId: 'next' }).role).toBeNull();
    // 이미 아는 역할은 덮지 않는다.
    const tagger = state({ self: active({ role: 'tagger' }) });
    expect(carryRole(playing, tagger).role).toBe('tagger');
    // self 가 비워진 뷰가 결과보다 먼저 와도 결과 전이에서 역할이 남아 있다.
    const held = carryRole(playing, emptied);
    const decided = state({
      self: null,
      round: roundFixture({ phase: 'RESULT', result: { winner: 'taggers', reason: 'timeout' } }),
    });
    expect(detectCues(held, carryRole(held, decided))).toEqual(['defeat']);
  });
  it('flags exactly the cues that also flash the screen', () => {
    expect(FLASH_CUES).toEqual([
      'captured',
      'escaped',
      'exit-failed',
      'restrained',
      'victory',
      'defeat',
    ]);
    expect(isFlashCue('countdown')).toBe(false);
    expect(isFlashCue('victory')).toBe(true);
  });
});

describe('detectEffectFlashes', () => {
  const effect = (eventId: string, kind: 'footstep' | 'sensor' | 'trap') => ({ eventId, kind });

  it('flashes only the sensor and trap effects and leaves footsteps to sound', () => {
    expect(EFFECT_FLASHES).toEqual(['sensor', 'trap']);
    expect(isEffectFlash('footstep')).toBe(false);
    expect(
      detectEffectFlashes(
        [effect('ev-1', 'footstep'), effect('ev-2', 'sensor'), effect('ev-3', 'trap')],
        new Set(),
      ),
    ).toEqual([
      { eventId: 'ev-2', kind: 'sensor' },
      { eventId: 'ev-3', kind: 'trap' },
    ]);
  });

  it('drops an eventId already shown, in the same policy or an earlier one', () => {
    expect(detectEffectFlashes([effect('ev-2', 'sensor')], new Set(['ev-2']))).toEqual([]);
    expect(
      detectEffectFlashes([effect('ev-2', 'sensor'), effect('ev-2', 'sensor')], new Set()),
    ).toEqual([{ eventId: 'ev-2', kind: 'sensor' }]);
    expect(detectEffectFlashes([], new Set())).toEqual([]);
  });
});
