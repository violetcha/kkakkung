/**
 * S15P21C204-308. Brings two of the six synthetic clients into hearing range during the game
 * round, so DP-06's positive in-game audio evidence stops depending on where a random walk
 * happens to go.
 *
 * Why this exists. S15P21C204-302 made the product map the one-cell corridor maze. Six clients
 * wandering it for 180 s reached a shortest path of 8-9 cells between the closest pair, while
 * speech carries 5 (`AudibilityPolicy`), so the round produced no audible pair at all in two of
 * three measured runs and the deployment rolled back a healthy commit. The failing runs were
 * measured at the audibility computation itself, before bindings, projection or delivery: the
 * server never found a pair, so nothing downstream could have carried a voice. The cause is
 * distance. (302's note said the opposite; its rendezvous attempt is not recorded in enough
 * detail to say why it failed, but pairing opposing roles self-defeats — see below.)
 *
 * Two properties of the rules make one deliberate encounter enough:
 *
 * - A game instance has **no team filter**. Only practice restricts voices to one's own role, so
 *   in the game two taggers hear each other exactly as a tagger and a runner would. Pairing two
 *   clients of the **same role** produces the same evidence with no capture: a tagger reaching a
 *   runner would end that runner and close the window in the same tick it opened.
 * - An audible pair is **sticky**: `AudibilityPolicy` keeps a pair once seen while any path
 *   exists between them. So the driver only has to make the two meet once, not hold station.
 *
 * What the driver may look at. It pools the six clients' own `knownTerrain`, which is what those
 * clients were told; no private map, layout or server state enters here. Pooling is a liberty the
 * harness takes as the owner of all six, and it is what makes a meeting reachable at all: early
 * in a round each client's knowledge is an island, and a path between two of them exists only in
 * the union.
 */
import type { Cell, Dir } from '@kkakkung/protocol/game-schema';

/** One client's own view, or null once it is no longer an active player in this round. */
export type RendezvousView = Readonly<{
  cell: Cell;
  dir: Dir;
  role: string;
  /**
   * True while the rules are already moving or turning this client. It takes no new command, but
   * it is still in the round: a partner keeps walking toward where it is. A client is mid-action
   * for most of any tick (a cell takes 600 ms, the driver steps about every 500 ms), so treating
   * that as "gone" would leave the pair exploring past each other nearly all the time.
   */
  acting: boolean;
  /** Floor cells this client knows. Walls are cells in this game, so these are the passable ones. */
  floors: readonly Cell[];
  /**
   * Wall cells this client knows. Needed to tell "not explored" from "explored and solid": a
   * corridor cell has walls on both sides, so counting those as unknown would make every cell
   * look like a frontier and exploration would never leave the spot it stands on.
   */
  walls: readonly Cell[];
}> | null;

export type RendezvousStep =
  | Readonly<{ kind: 'turn'; direction: 'left' | 'right' }>
  | Readonly<{ kind: 'forward' }>
  | Readonly<{ kind: 'hold' }>;

/** Stop here rather than on the partner: inside speech range (5) and never a shared cell. */
export const MEETING_DISTANCE = 3;

const VECTORS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const key = (cell: Cell) => `${cell.x},${cell.y}`;

/** The quarter turn that brings `from` one step closer to `to`, or null when it already faces it. */
function turnToward(from: Dir, to: Dir): RendezvousStep | null {
  if (from === to) return null;
  return { kind: 'turn', direction: (to - from + 4) % 4 === 3 ? 'left' : 'right' };
}

function directionTo(from: Cell, to: Cell): Dir | null {
  const index = VECTORS.findIndex(([dx, dy]) => from.x + dx === to.x && from.y + dy === to.y);
  return index < 0 ? null : (index as Dir);
}

/** Distances from `start` across `passable`, and the step that walks back down them. */
function distances(start: Cell, passable: ReadonlySet<string>): Map<string, number> {
  const seen = new Map<string, number>([[key(start), 0]]);
  const queue: Cell[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const distance = seen.get(key(cell))!;
    for (const [dx, dy] of VECTORS) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (!passable.has(key(next)) || seen.has(key(next))) continue;
      seen.set(key(next), distance + 1);
      queue.push(next);
    }
  }
  return seen;
}

/** The neighbour of `from` that stands one step nearer `target` in `field`, or null. */
function descend(from: Cell, field: ReadonlyMap<string, number>): Cell | null {
  const here = field.get(key(from));
  if (here === undefined) return null;
  for (const [dx, dy] of VECTORS) {
    const next = { x: from.x + dx, y: from.y + dy };
    if (field.get(key(next)) === here - 1) return next;
  }
  return null;
}

export class DeploymentGameRendezvous {
  /** Which two clients are walking together. Re-chosen if one of them leaves the round. */
  private pair: readonly [number, number] | null = null;
  private met = false;

  /**
   * One tick of intent for each client. The chosen pair closes on each other as soon as the
   * pooled knowledge joins them; everyone else pushes into unexplored ground, which is what makes
   * that join happen. Returns null for a client that cannot take a command this tick.
   */
  plan(views: readonly RendezvousView[]): readonly (RendezvousStep | null)[] {
    const pooled = new Set<string>();
    for (const view of views) for (const cell of view?.floors ?? []) pooled.add(key(cell));
    // A client mid-action still reports itself, so a null here means captured or escaped: it
    // never comes back and the pair is chosen again among whoever is still playing.
    if (this.pair?.some((index) => views[index] === null)) this.pair = null;
    this.pair ??= this.choosePair(views);
    const steps: (RendezvousStep | null)[] = views.map(() => null);
    const partnerOf = new Map<number, number>();
    if (this.pair) {
      partnerOf.set(this.pair[0], this.pair[1]);
      partnerOf.set(this.pair[1], this.pair[0]);
    }
    for (let index = 0; index < views.length; index++) {
      const view = views[index];
      if (!view || view.acting) continue;
      const partner = partnerOf.get(index);
      const other = partner === undefined ? null : views[partner];
      steps[index] = other ? this.approach(view, other, pooled) : this.explore(view);
    }
    return steps;
  }

  /** True once the pair stood close enough that the rules must have opened a voice. */
  get arrived(): boolean {
    return this.met;
  }

  /**
   * Two clients of the same role, preferring the ones already nearest by straight-line guess.
   * Same role because a tagger that reaches a runner captures it, which ends the runner's
   * participation in the same tick the pair would have become audible.
   */
  private choosePair(views: readonly RendezvousView[]): readonly [number, number] | null {
    let best: { pair: [number, number]; gap: number } | null = null;
    for (let a = 0; a < views.length; a++) {
      const left = views[a];
      if (!left) continue;
      for (let b = a + 1; b < views.length; b++) {
        const right = views[b];
        if (!right || right.role !== left.role) continue;
        const gap = Math.abs(left.cell.x - right.cell.x) + Math.abs(left.cell.y - right.cell.y);
        if (!best || gap < best.gap) best = { pair: [a, b], gap };
      }
    }
    return best?.pair ?? null;
  }

  /** Walk toward the partner across pooled knowledge, stopping inside speech range. */
  private approach(
    view: NonNullable<RendezvousView>,
    partner: NonNullable<RendezvousView>,
    pooled: ReadonlySet<string>,
  ): RendezvousStep | null {
    const field = distances(partner.cell, pooled);
    const here = field.get(key(view.cell));
    // Not joined yet: the two islands of knowledge have not touched, so keep opening ground.
    if (here === undefined) return this.explore(view);
    if (here <= MEETING_DISTANCE) {
      this.met = true;
      return { kind: 'hold' };
    }
    return this.stepTo(view, descend(view.cell, field));
  }

  /** Head for the nearest known floor that still borders ground nobody has seen. */
  private explore(view: NonNullable<RendezvousView>): RendezvousStep | null {
    const own = new Set(view.floors.map(key));
    const seen = new Set([...own, ...view.walls.map(key)]);
    const field = distances(view.cell, own);
    let target: { cell: Cell; distance: number } | null = null;
    for (const cell of view.floors) {
      const distance = field.get(key(cell));
      if (distance === undefined || distance === 0) continue;
      const opens = VECTORS.some(([dx, dy]) => !seen.has(key({ x: cell.x + dx, y: cell.y + dy })));
      if (!opens) continue;
      if (!target || distance < target.distance) target = { cell, distance };
    }
    // Everything reachable is already explored, or we stand on the only opening: press ahead.
    if (!target) return { kind: 'forward' };
    return this.stepTo(view, descend(view.cell, distances(target.cell, own)));
  }

  private stepTo(view: NonNullable<RendezvousView>, next: Cell | null): RendezvousStep | null {
    if (!next) return { kind: 'forward' };
    const desired = directionTo(view.cell, next);
    if (desired === null) return { kind: 'forward' };
    return turnToward(view.dir, desired) ?? { kind: 'forward' };
  }
}
