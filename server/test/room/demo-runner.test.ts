/**
 * S15P21C204-259. The scenario runner on a synthetic world: it must only ever emit ordinary
 * commands, walk by the passage graph and give up instead of blocking the room. Whether the
 * rules then produce a restraint or a capture is covered by the room test on A's real core.
 */
import { expect, it } from 'vitest';
import type { GameSubject, Topology } from '../../src/game/ports.js';
import {
  availableScenarios,
  createDemoRunner,
  type DemoWorld,
  type PuppetCommand,
} from '../../src/rooms/DemoScenarios.js';

/** A 5x5 room with a solid border: every inner cell is a passage. */
const topology: Topology = {
  topologyVersion: 'demo-test-1',
  width: 5,
  height: 5,
  walkable: Array.from({ length: 25 }, (_, index) => {
    const x = index % 5;
    const y = Math.floor(index / 5);
    return x > 0 && x < 4 && y > 0 && y < 4;
  }),
};

const player = (
  over: Partial<GameSubject> & Pick<GameSubject, 'playerId' | 'role'>,
): GameSubject => ({
  status: 'ACTIVE',
  cell: { x: 1, y: 1 },
  dir: 0,
  action: null,
  ...over,
});

function world(participants: readonly GameSubject[], over: Partial<DemoWorld> = {}): DemoWorld {
  return {
    tick: 0,
    topology,
    participants,
    exits: [],
    startCells: [],
    challenges: {},
    exchanges: {},
    operatorId: 'operator',
    puppetIds: ['puppet-tagger', 'puppet-runner'],
    ...over,
  };
}

/** Applies what the rules would do: a turn changes facing, a move changes the cell. */
function apply(actor: GameSubject, command: PuppetCommand): GameSubject {
  if (command.type === 'TURN') {
    const step = command.payload.direction === 'right' ? 1 : 3;
    return { ...actor, dir: (((actor.dir + step) % 4) + 4) % 4 };
  }
  if (command.type === 'MOVE_INTENT' && command.payload.direction === 'forward') {
    const vectors = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];
    const vector = vectors[actor.dir]!;
    return { ...actor, cell: { x: actor.cell.x + vector.dx, y: actor.cell.y + vector.dy } };
  }
  return actor;
}

it('walks a puppet to the operator with turns and forward intents only', () => {
  const runner = createDemoRunner();
  let tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 }, dir: 0 });
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  const sent: PuppetCommand[] = [];
  const start = runner.start('capture', world([operator, tagger]));
  expect(start).toBeNull();

  for (let tick = 1; tick <= 60 && !sameCell(tagger, operator); tick++) {
    runner.advance(world([operator, tagger], { tick }), (actor, command) => {
      expect(actor).toBe('puppet-tagger');
      sent.push(command);
      tagger = apply(tagger, command);
      return true;
    });
  }
  expect(sameCell(tagger, operator)).toBe(true);
  // Only the two commands a player could send themselves.
  expect(new Set(sent.map((command) => command.type))).toEqual(new Set(['TURN', 'MOVE_INTENT']));
});

it('refuses a scenario the world cannot support and reports why', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'tagger' });
  expect(runner.start('capture', world([operator]))).toBe('OPERATOR_MUST_BE_RUNNER');
  expect(runner.start('exit', world([operator]))).toBe('NO_RUNNER_PUPPET');
  expect(runner.status.scenario).toBeNull();
});

it('gives up a step that cannot finish instead of blocking the room', () => {
  const runner = createDemoRunner();
  const operator = player({ playerId: 'operator', role: 'runner' });
  const tagger = player({
    playerId: 'puppet-tagger',
    role: 'tagger',
    cell: { x: 3, y: 3 },
  });
  expect(runner.start('capture', world([operator, tagger]))).toBeNull();
  // The puppet never moves, so the step runs out of its budget and the scenario stops.
  for (let tick = 1; tick <= 1300; tick++)
    runner.advance(world([operator, tagger], { tick }), () => true);
  expect(runner.status.scenario).toBeNull();
  expect(runner.status.failure).toBe('chase-operator:TIMEOUT');
});

/**
 * Runs the scenario on the synthetic world, applying each emitted command to its actor, until
 * the scenario ends or `ticks` pass. `patch` lets a test feed core-owned facts (sessions) back.
 */
function simulate(
  runner: ReturnType<typeof createDemoRunner>,
  actors: Map<string, GameSubject>,
  ticks: number,
  options: {
    patch?: (
      tick: number,
      sent: readonly { actor: string; command: PuppetCommand }[],
    ) => Partial<DemoWorld> | undefined;
    drop?: (actor: string) => boolean;
  } = {},
) {
  const sent: { actor: string; command: PuppetCommand }[] = [];
  const dropped: string[] = [];
  let over: Partial<DemoWorld> = {};
  for (let tick = 1; tick <= ticks && runner.status.scenario !== null; tick++) {
    over = { ...over, ...options.patch?.(tick, sent) };
    runner.advance(world([...actors.values()], { tick, ...over }), {
      send: (actor, command) => {
        sent.push({ actor, command });
        actors.set(actor, apply(actors.get(actor)!, command));
        return true;
      },
      ...(options.drop
        ? { drop: options.drop }
        : {
            drop: (actor) => {
              dropped.push(actor);
              return true;
            },
          }),
    });
  }
  return { sent, dropped };
}

it('lists only the scenarios the operator role and the puppets can carry out', () => {
  const asRunner = world([
    player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } }),
    player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 1 } }),
    player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } }),
  ]);
  const runnerList = availableScenarios(asRunner);
  expect(runnerList).toEqual(
    expect.arrayContaining(['trap', 'sensor', 'capture', 'capture-one', 'approach', 'exchange']),
  );
  expect(runnerList).toContain('exchange-cancel');
  expect(runnerList).toContain('abort-connection-lost');
  // A tagger's view and two-runner results need what this world lacks.
  expect(runnerList).not.toContain('exchange-trace');
  expect(runnerList).not.toContain('result-runner-win');
  expect(runnerList).not.toContain('result-tagger-win');
  // No exit is known for the puppet, so the escape scenarios cannot be built.
  expect(runnerList).not.toContain('exit');

  const asTagger = world(
    [
      player({ playerId: 'operator', role: 'tagger', cell: { x: 2, y: 2 } }),
      player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 1 } }),
      player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } }),
      player({ playerId: 'puppet-runner-2', role: 'runner', cell: { x: 3, y: 1 } }),
    ],
    { puppetIds: ['puppet-tagger', 'puppet-runner', 'puppet-runner-2'] },
  );
  const taggerList = availableScenarios(asTagger);
  expect(taggerList).toContain('exchange-trace');
  expect(taggerList).toContain('trap');
  expect(taggerList).not.toContain('capture');
  expect(taggerList).not.toContain('exchange');
  expect(taggerList).not.toContain('exchange-cancel');
});

it('makes two puppet runners exchange beside a tagger operator and accepts the offer it sees', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'tagger', cell: { x: 2, y: 2 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } })],
    [
      'puppet-runner-2',
      player({ playerId: 'puppet-runner-2', role: 'runner', cell: { x: 3, y: 3 } }),
    ],
  ]);
  const puppetIds = ['puppet-runner', 'puppet-runner-2'];
  expect(runner.start('exchange-trace', world([...actors.values()], { puppetIds }))).toBeNull();
  const { sent } = simulate(runner, actors, 200, {
    patch: (_tick, sentSoFar) =>
      // The core opens the session one tick after the request reaches it.
      sentSoFar.some((entry) => entry.command.type === 'EXCHANGE_REQUEST')
        ? { puppetIds, exchanges: { 'puppet-runner': 'x-1', 'puppet-runner-2': 'x-1' } }
        : { puppetIds },
  });
  const request = sent.find((entry) => entry.command.type === 'EXCHANGE_REQUEST');
  expect(request).toMatchObject({
    actor: 'puppet-runner',
    command: { payload: { targetPlayerId: 'puppet-runner-2' } },
  });
  expect(sent.find((entry) => entry.command.type === 'EXCHANGE_ACCEPT')).toMatchObject({
    actor: 'puppet-runner-2',
    command: { payload: { exchangeId: 'x-1' } },
  });
  // Neither runner ever stepped onto the tagger: that would have been a capture, not a trace.
  const operator = actors.get('operator')!;
  expect(sameCell(actors.get('puppet-runner')!, operator)).toBe(false);
  expect(sameCell(actors.get('puppet-runner-2')!, operator)).toBe(false);
  expect(runner.status).toEqual({ scenario: null, step: null, failure: null });
});

it('gives up an exchange the rules refused within the offer lifetime, not the step budget', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } })],
  ]);
  expect(runner.start('exchange-cancel', world([...actors.values()]))).toBeNull();
  const { sent } = simulate(runner, actors, 400);
  // The request went out, no session ever appeared, so the cancel was never sent.
  expect(sent.some((entry) => entry.command.type === 'EXCHANGE_REQUEST')).toBe(true);
  expect(sent.some((entry) => entry.command.type === 'EXCHANGE_CANCEL')).toBe(false);
  expect(runner.status.failure).toBe('offer-pending:TIMEOUT');
});

it('withdraws its own offer after the operator has seen it', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 1 } })],
  ]);
  expect(runner.start('exchange-cancel', world([...actors.values()]))).toBeNull();
  const { sent } = simulate(runner, actors, 400, {
    patch: (_tick, sentSoFar) =>
      sentSoFar.some((entry) => entry.command.type === 'EXCHANGE_REQUEST')
        ? { exchanges: { 'puppet-runner': 'x-2' } }
        : undefined,
  });
  expect(sent.at(-1)).toMatchObject({
    actor: 'puppet-runner',
    command: { type: 'EXCHANGE_CANCEL', payload: { exchangeId: 'x-2' } },
  });
  expect(runner.status).toEqual({ scenario: null, step: null, failure: null });
});

it('drops one puppet connection and sends no command for the abort scenario', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner' })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } })],
  ]);
  expect(runner.start('abort-connection-lost', world([...actors.values()]))).toBeNull();
  const { sent, dropped } = simulate(runner, actors, 5);
  expect(sent).toEqual([]);
  expect(dropped).toEqual(['puppet-tagger']);
  expect(runner.status).toEqual({ scenario: null, step: null, failure: null });

  // A room that cannot drop puppets fails the step instead of leaving the scenario hanging.
  const without = createDemoRunner();
  expect(without.start('abort-connection-lost', world([...actors.values()]))).toBeNull();
  without.advance(world([...actors.values()], { tick: 1 }), () => true);
  expect(without.status.failure).toBe('drop-connection:FAILED');
});

it('moves the installer off the device before a puppet runner walks into it', () => {
  const runner = createDemoRunner();
  // The operator is a tagger facing up: the device goes on (2,1), the cell straight ahead.
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'tagger', cell: { x: 2, y: 2 }, dir: 0 })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 1, y: 3 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 3 } })],
  ]);
  expect(runner.start('trap', world([...actors.values()]))).toBeNull();
  const { sent } = simulate(runner, actors, 400);
  const install = sent.findIndex((entry) => entry.command.type === 'INSTALL');
  expect(sent[install]?.actor).toBe('puppet-tagger');
  // After installing, the tagger left the device cell and the runner ended on it.
  expect(actors.get('puppet-tagger')!.cell).not.toEqual({ x: 2, y: 1 });
  expect(actors.get('puppet-runner')!.cell).toEqual({ x: 2, y: 1 });
  // The runner only started moving once the tagger's own commands were done.
  const firstRunnerMove = sent.findIndex((entry) => entry.actor === 'puppet-runner');
  const lastTaggerMove = sent.map((entry) => entry.actor).lastIndexOf('puppet-tagger');
  expect(firstRunnerMove).toBeGreaterThan(lastTaggerMove);
  expect(runner.status).toEqual({ scenario: null, step: null, failure: null });
});

it('never installs on a start cell or on a cell someone stands on', () => {
  // Straight ahead of the operator (2,1) is a start cell and (1,2) holds a runner puppet, so
  // the device goes on (3,2): the remaining free neighbour of the operator.
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 }, dir: 0 })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 2 } })],
  ]);
  const startCells = [{ x: 2, y: 1 }];
  const runner = createDemoRunner();
  expect(runner.start('trap', world([...actors.values()], { startCells }))).toBeNull();
  const { sent } = simulate(runner, actors, 400, { patch: () => ({ startCells }) });
  const install = sent.findIndex((entry) => entry.command.type === 'INSTALL');
  expect(install).toBeGreaterThan(0);
  // The installer's cell at the moment of installing is where the trap goes.
  const installerPath = sent.slice(0, install).filter((entry) => entry.actor === 'puppet-tagger');
  const before = installerPath.reduce(
    (actor, entry) => apply(actor, entry.command),
    player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } }),
  );
  expect(before.cell).toEqual({ x: 3, y: 2 });
  expect(actors.get('puppet-tagger')!.cell).not.toEqual({ x: 3, y: 2 });
  expect(runner.status).toEqual({ scenario: null, step: null, failure: null });

  // With every neighbour taken, the scenario is refused instead of walking into someone.
  const boxed = world(
    [
      player({ playerId: 'operator', role: 'runner', cell: { x: 2, y: 2 }, dir: 0 }),
      player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 2 } }),
      player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 1, y: 2 } }),
    ],
    {
      startCells: [
        { x: 2, y: 1 },
        { x: 2, y: 3 },
      ],
    },
  );
  expect(createDemoRunner().start('trap', boxed)).toBe('NO_ROOM_TO_INSTALL');
});

it('captures one puppet runner with one puppet tagger for the tally scenario', () => {
  const runner = createDemoRunner();
  const actors = new Map<string, GameSubject>([
    ['operator', player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } })],
    ['puppet-tagger', player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 } })],
    ['puppet-runner', player({ playerId: 'puppet-runner', role: 'runner', cell: { x: 3, y: 1 } })],
  ]);
  expect(runner.start('capture-one', world([...actors.values()]))).toBeNull();
  simulate(runner, actors, 60, {
    patch: () => {
      // Standing on the prey is the rules' capture; the world then reports the prey as ended.
      const tagger = actors.get('puppet-tagger')!;
      const prey = actors.get('puppet-runner')!;
      if (sameCell(tagger, prey)) actors.set('puppet-runner', { ...prey, status: 'CAPTURED' });
      return undefined;
    },
  });
  expect(actors.get('puppet-runner')!.status).toBe('CAPTURED');
  expect(sameCell(actors.get('puppet-tagger')!, actors.get('operator')!)).toBe(false);
  expect(runner.status).toEqual({ scenario: null, step: null, failure: null });
});

function sameCell(a: GameSubject, b: GameSubject) {
  return a.cell.x === b.cell.x && a.cell.y === b.cell.y;
}

// S15P21C204-267. On the real server a forward intent stays held until released or expired, and
// the held move resumes in the tick the first cell completes: an unreleased intent is two cells.
it('releases every forward intent on the next tick so a puppet walks exactly one cell', () => {
  const runner = createDemoRunner();
  let tagger = player({ playerId: 'puppet-tagger', role: 'tagger', cell: { x: 3, y: 3 }, dir: 0 });
  const operator = player({ playerId: 'operator', role: 'runner', cell: { x: 1, y: 1 } });
  expect(runner.start('capture', world([operator, tagger]))).toBeNull();
  const sent: PuppetCommand[] = [];
  for (let tick = 1; tick <= 40 && !sameCell(tagger, operator); tick++) {
    // The world shows the move in progress on the tick after the intent, then it lands.
    const last = sent.at(-1);
    const busy = last?.type === 'MOVE_INTENT' && last.payload.direction === 'forward';
    const shown = busy
      ? {
          ...tagger,
          action: {
            kind: 'move' as const,
            from: { ...tagger.cell, dir: tagger.dir },
            to: { ...apply(tagger, last).cell, dir: tagger.dir },
            startTick: tick - 1,
            endTick: tick + 8,
          },
        }
      : tagger;
    runner.advance(world([operator, shown], { tick }), (actor, command) => {
      expect(actor).toBe('puppet-tagger');
      sent.push(command);
      if (command.type === 'MOVE_INTENT' && command.payload.direction === null) {
        // The move the intent started still lands; only the hold is gone.
        tagger = apply(tagger, { type: 'MOVE_INTENT', payload: { direction: 'forward' } });
      }
      if (command.type === 'TURN') tagger = apply(tagger, command);
      return true;
    });
  }
  expect(sameCell(tagger, operator)).toBe(true);
  const forwards = sent.filter(
    (command) => command.type === 'MOVE_INTENT' && command.payload.direction === 'forward',
  );
  const releases = sent.filter(
    (command) => command.type === 'MOVE_INTENT' && command.payload.direction === null,
  );
  expect(forwards.length).toBeGreaterThan(0);
  expect(releases.length).toBe(forwards.length);
  // Every release directly follows its intent: nothing else is sent while the puppet is moving.
  sent.forEach((command, index) => {
    if (command.type === 'MOVE_INTENT' && command.payload.direction === 'forward') {
      expect(sent[index + 1]).toEqual({ type: 'MOVE_INTENT', payload: { direction: null } });
    }
  });
});
