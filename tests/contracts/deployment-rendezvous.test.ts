/**
 * S15P21C204-308. What the DP-06 game driver must do so the smoke's in-game audio evidence stops
 * depending on luck. Nothing here starts a server, a browser or the network.
 *
 * The properties worth pinning are the ones that make the evidence deterministic: the pair is
 * same-role (a tagger reaching a runner captures it and closes the window it just opened), the
 * two stop inside speech range instead of on each other, and a client that cannot reach its
 * partner yet opens ground rather than standing still.
 */
import { describe, expect, it } from 'vitest';
import {
  DeploymentGameRendezvous,
  MEETING_DISTANCE,
  type RendezvousView,
} from '../../tests/cloud/DeploymentGameRendezvous.js';

/** A one-cell corridor along y=1 from x=1 to x=9, walled on both sides and at both ends. */
const FLOORS = Array.from({ length: 9 }, (_, index) => ({ x: index + 1, y: 1 }));
const WALLS = [
  { x: 0, y: 1 },
  { x: 10, y: 1 },
  ...Array.from({ length: 11 }, (_, x) => [
    { x, y: 0 },
    { x, y: 2 },
  ]).flat(),
];

const seen = (
  over: Partial<NonNullable<RendezvousView>> & Pick<NonNullable<RendezvousView>, 'cell' | 'role'>,
): RendezvousView => ({ dir: 1, acting: false, floors: FLOORS, walls: WALLS, ...over });

describe('DP-06 game rendezvous', () => {
  it('walks two of the same role together and never the closer opposing pair', () => {
    // The nearest two are the runner and the tagger one cell apart. Pairing those would put the
    // driver one step from a capture, and that tagger would already be inside meeting distance,
    // so it would hold. Pairing the two taggers instead makes it walk.
    const steps = new DeploymentGameRendezvous().plan([
      seen({ cell: { x: 1, y: 1 }, role: 'runner' }),
      seen({ cell: { x: 2, y: 1 }, role: 'tagger' }),
      seen({ cell: { x: 9, y: 1 }, role: 'tagger' }),
    ]);
    expect(steps[1]).toEqual({ kind: 'forward' });
    expect(steps[2]).toEqual({ kind: 'turn', direction: 'right' });
  });

  it('holds once the pair stands inside speech range', () => {
    const rendezvous = new DeploymentGameRendezvous();
    // Three cells apart: close enough for the rules to open a voice, never the same cell.
    const steps = rendezvous.plan([
      seen({ cell: { x: 1, y: 1 }, role: 'tagger' }),
      seen({ cell: { x: 4, y: 1 }, role: 'tagger' }),
    ]);
    expect(MEETING_DISTANCE).toBe(3);
    expect(steps).toEqual([{ kind: 'hold' }, { kind: 'hold' }]);
    expect(rendezvous.arrived).toBe(true);
  });

  it('turns before it moves and only ever emits an ordinary turn or forward', () => {
    // Facing south with the partner east: south → east is one quarter turn left.
    const steps = new DeploymentGameRendezvous().plan([
      seen({ cell: { x: 1, y: 1 }, role: 'tagger', dir: 2 }),
      seen({ cell: { x: 9, y: 1 }, role: 'tagger', dir: 2 }),
    ]);
    expect(steps[0]).toEqual({ kind: 'turn', direction: 'left' });
    for (const step of steps) expect(['turn', 'forward', 'hold']).toContain(step?.kind);
  });

  it('opens ground instead of standing still while the two islands of knowledge are apart', () => {
    // Neither client knows a cell the other knows, so no path between them exists yet. Walking
    // toward a partner you cannot reach is the case S15P21C204-302's attempt ran into.
    const steps = new DeploymentGameRendezvous().plan([
      seen({
        cell: { x: 1, y: 1 },
        role: 'tagger',
        floors: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
        walls: [
          { x: 0, y: 1 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: 2 },
          { x: 2, y: 2 },
        ],
      }),
      seen({
        cell: { x: 9, y: 1 },
        role: 'tagger',
        floors: [
          { x: 8, y: 1 },
          { x: 9, y: 1 },
        ],
        walls: [
          { x: 10, y: 1 },
          { x: 8, y: 0 },
          { x: 9, y: 0 },
          { x: 8, y: 2 },
          { x: 9, y: 2 },
        ],
      }),
    ]);
    // (2,1) is the only cell of the first island that still borders unseen ground, so it heads
    // there instead of holding or freezing on an unreachable partner.
    expect(steps[0]).toEqual({ kind: 'forward' });
  });

  it('treats a known wall as explored, not as ground still worth walking to', () => {
    // A corridor cell has walls on both sides. Counting those as unknown would make the cell
    // underfoot and the one behind look like frontiers, and the client would turn back and forth
    // beside its own walls instead of pushing to the open end.
    const known = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ];
    const sides = [
      { x: 0, y: 1 },
      ...[1, 2, 3].flatMap((x) => [
        { x, y: 0 },
        { x, y: 2 },
      ]),
    ];
    const steps = new DeploymentGameRendezvous().plan([
      // Facing west, away from the only opening at (4,1): it has to turn to reach it.
      seen({ cell: { x: 2, y: 1 }, role: 'tagger', dir: 3, floors: known, walls: sides }),
      seen({ cell: { x: 9, y: 1 }, role: 'runner' }),
    ]);
    expect(steps[0]).toEqual({ kind: 'turn', direction: 'right' });
  });

  it('leaves a client alone while the rules are moving it or it has left the round', () => {
    const steps = new DeploymentGameRendezvous().plan([
      null,
      seen({ cell: { x: 9, y: 1 }, role: 'tagger', acting: true }),
    ]);
    expect(steps).toEqual([null, null]);
  });

  // The west end of the corridor is left unseen, so a client that stops approaching and falls
  // back to exploring turns around and heads that way. Without this the two behaviours both come
  // out as "forward" on a fully explored corridor and the tests below prove nothing.
  const WEST_STILL_OPEN = WALLS.filter((cell) => !(cell.x === 0 && cell.y === 1));
  const AWAY = { kind: 'turn', direction: 'right' } as const;

  it('keeps closing on a partner the rules are moving instead of wandering off', () => {
    // A cell takes 600 ms and the driver steps about every 500 ms, so the partner is mid-action
    // most ticks. Treating that as "no partner" would send this client exploring nearly always.
    const steps = new DeploymentGameRendezvous().plan([
      seen({ cell: { x: 2, y: 1 }, role: 'tagger', walls: WEST_STILL_OPEN }),
      seen({ cell: { x: 8, y: 1 }, role: 'tagger', acting: true }),
    ]);
    expect(steps[0]).toEqual({ kind: 'forward' });
    expect(steps[0]).not.toEqual(AWAY);
    // The one the rules are already moving takes no command of its own.
    expect(steps[1]).toBeNull();
  });

  it('picks a new pair when one of the two is captured or escapes', () => {
    // Pairing two runners is safe from capture between them, but a tagger can still take one.
    // Holding on to a partner that is never coming back would end the rendezvous for the round.
    const rendezvous = new DeploymentGameRendezvous();
    const before = rendezvous.plan([
      seen({ cell: { x: 1, y: 1 }, role: 'runner', walls: WEST_STILL_OPEN }),
      seen({ cell: { x: 5, y: 1 }, role: 'runner' }),
      seen({ cell: { x: 9, y: 1 }, role: 'runner' }),
    ]);
    // The first two are nearest, so they are the pair and both walk toward each other.
    expect(before[0]).toEqual({ kind: 'forward' });
    const after = rendezvous.plan([
      seen({ cell: { x: 2, y: 1 }, role: 'runner', walls: WEST_STILL_OPEN }),
      null,
      seen({ cell: { x: 9, y: 1 }, role: 'runner' }),
    ]);
    // Now paired with the survivor at (9,1): still walking east, not turning back to explore.
    expect(after[0]).toEqual({ kind: 'forward' });
    expect(after[0]).not.toEqual(AWAY);
    expect(after[2]).toEqual(AWAY);
  });
});
