import { describe, expect, it } from 'vitest';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { hotbarSlots } from './hotbar-model';
import { appendEvent, eventTextForCue, visibleEvents, type MatchEvent } from './event-log';

const TICK = 100;

function asRole(role: 'runner' | 'tagger', patch: Record<string, unknown> = {}): PrivateView {
  const base = viewFixture();
  const self = base.self!;
  if (self.status !== 'ACTIVE') throw new Error();
  return { ...base, self: { ...self, role, ...patch } };
}

const slots = (view: PrivateView, selected: 'sensor' | 'trap' = 'sensor') =>
  hotbarSlots({ view, tick: TICK, selected }) ?? [];

describe('hotbarSlots', () => {
  it('keeps two tagger controls in a five-slot bar without inventing more equipment', () => {
    const view = asRole('tagger', { equipment: { sensor: 2, trap: 1 } });
    const bar = slots(view);
    expect(bar).toHaveLength(5);
    expect(bar.slice(0, 2).map((slot) => [slot.key, slot.label, slot.count, slot.state])).toEqual([
      ['1', '감지기', 2, 'selected'],
      ['2', '덫', 1, 'available'],
    ]);
    expect(bar.slice(2).map((slot) => [slot.id, slot.key, slot.state])).toEqual([
      ['locked-3', '3', 'reserved'],
      ['locked-4', '4', 'reserved'],
      ['locked-5', '5', 'reserved'],
    ]);
    expect(slots(view, 'trap')[1]?.state).toBe('selected');
  });

  it('marks an empty or locked equipment slot unavailable instead of hiding it', () => {
    expect(slots(asRole('tagger', { equipment: { sensor: 0, trap: 1 } }))[0]?.state).toBe(
      'unavailable',
    );
    const restrained = asRole('tagger', {
      equipment: { sensor: 2, trap: 1 },
      restraintUntilTick: TICK + 40,
    });
    expect(
      slots(restrained)
        .slice(0, 2)
        .map((slot) => slot.state),
    ).toEqual(['unavailable', 'unavailable']);
  });

  it('gives the runner an empty five-slot bar and never an interaction slot', () => {
    // 지도 교환은 아이템이 아니라 E 상호작용이다. 옆에 동료가 있어도 핫바는 비어 있다.
    const view = asRole('runner');
    const near: PrivateView = {
      ...view,
      visibleEntities: [
        { id: 'ally', kind: 'player', cell: { x: 1, y: 0 }, dir: 2, action: null, role: 'runner' },
      ],
    };
    for (const bar of [slots(view), slots(near)]) {
      expect(bar).toHaveLength(5);
      expect(bar.map((slot) => slot.key)).toEqual(['1', '2', '3', '4', '5']);
      expect(bar.every((slot) => slot.state === 'reserved')).toBe(true);
    }
  });

  it('has no hotbar for a view without an active self', () => {
    expect(hotbarSlots({ view: null, tick: TICK, selected: 'sensor' })).toBeNull();
  });
});

describe('event log', () => {
  it('names the moments worth a line and leaves the per-second countdown out', () => {
    expect(eventTextForCue('captured')).toBe('포획되었습니다');
    expect(eventTextForCue('start')).toBe('경기 시작');
    expect(eventTextForCue('countdown')).toBeNull();
  });

  it('keeps only the newest lines', () => {
    let events: readonly MatchEvent[] = [];
    for (let id = 1; id <= 6; id++) events = appendEvent(events, { id, text: `e${id}`, atMs: 0 });
    expect(events.map((event) => event.id)).toEqual([3, 4, 5, 6]);
  });

  it('drops a line once its time is up', () => {
    const events = [
      { id: 1, text: '오래됨', atMs: 0 },
      { id: 2, text: '최근', atMs: 5000 },
    ];
    expect(visibleEvents(events, 8000).map((event) => event.id)).toEqual([2]);
    expect(visibleEvents(events, 20000)).toEqual([]);
    expect(visibleEvents(events, 1000).map((event) => event.id)).toEqual([1, 2]);
  });
});
