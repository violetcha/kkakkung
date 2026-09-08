export interface WorldOptions {
  halfExtent: number;
  speed: number;
}

export interface PlayerRegistration {
  id: string;
  nickname: string;
}

export interface Player {
  readonly id: string;
  readonly nickname: string;
  readonly x: number;
  readonly z: number;
  readonly lastSeq: number;
}

export interface WorldState {
  readonly tick: number;
  readonly players: Readonly<Record<string, Player>>;
}

export interface MoveCommand {
  playerId: string;
  seq: number;
  x: number;
  z: number;
}

const worldConfiguration = new WeakMap<WorldState, Readonly<WorldOptions>>();

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function requireIdentifier(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function attachConfiguration(state: WorldState, options: Readonly<WorldOptions>): WorldState {
  worldConfiguration.set(state, options);
  return state;
}

function configurationOf(state: WorldState): Readonly<WorldOptions> {
  const options = worldConfiguration.get(state);
  if (options === undefined) {
    throw new TypeError('state was not created by createWorld');
  }
  return options;
}

function validateCommand(command: MoveCommand): void {
  requireIdentifier('playerId', command.playerId);
  if (!Number.isSafeInteger(command.seq) || command.seq < 0) {
    throw new RangeError('seq must be a nonnegative safe integer');
  }
  requireFinite('x', command.x);
  requireFinite('z', command.z);
  if (command.x < -1 || command.x > 1 || command.z < -1 || command.z > 1) {
    throw new RangeError('movement axes must be between -1 and 1');
  }
}

export function createWorld(options: WorldOptions): WorldState {
  requireFinite('halfExtent', options.halfExtent);
  requireFinite('speed', options.speed);
  if (options.halfExtent <= 0) {
    throw new RangeError('halfExtent must be greater than zero');
  }
  if (options.speed < 0) {
    throw new RangeError('speed must be nonnegative');
  }
  return attachConfiguration({ tick: 0, players: {} }, { ...options });
}

export function addPlayer(state: WorldState, registration: PlayerRegistration): WorldState {
  const options = configurationOf(state);
  requireIdentifier('id', registration.id);
  requireIdentifier('nickname', registration.nickname);
  if (registration.nickname.length > 20) {
    throw new RangeError('nickname must contain at most 20 characters');
  }
  if (Object.hasOwn(state.players, registration.id)) {
    throw new Error(`player is already registered: ${registration.id}`);
  }
  return attachConfiguration(
    {
      tick: state.tick,
      players: {
        ...state.players,
        [registration.id]: {
          id: registration.id,
          nickname: registration.nickname,
          x: 0,
          z: 0,
          lastSeq: -1,
        },
      },
    },
    options,
  );
}

export function removePlayer(state: WorldState, id: string): WorldState {
  const options = configurationOf(state);
  requireIdentifier('id', id);
  if (!Object.hasOwn(state.players, id)) {
    return attachConfiguration({ tick: state.tick, players: { ...state.players } }, options);
  }
  const players: Record<string, Player> = { ...state.players };
  delete players[id];
  return attachConfiguration({ tick: state.tick, players }, options);
}

export function stepWorld(
  state: WorldState,
  commands: readonly MoveCommand[],
  dtSeconds: number,
): WorldState {
  const options = configurationOf(state);
  requireFinite('dtSeconds', dtSeconds);
  if (dtSeconds < 0) {
    throw new RangeError('dtSeconds must be nonnegative');
  }

  const newestByPlayer = new Map<string, MoveCommand>();
  for (const command of commands) {
    validateCommand(command);
    const player = state.players[command.playerId];
    const selected = newestByPlayer.get(command.playerId);
    if (
      player !== undefined &&
      command.seq > player.lastSeq &&
      (selected === undefined || command.seq > selected.seq)
    ) {
      newestByPlayer.set(command.playerId, command);
    }
  }

  const players: Record<string, Player> = { ...state.players };
  for (const [playerId, command] of newestByPlayer) {
    const player = state.players[playerId];
    if (player === undefined) continue;
    const magnitude = Math.hypot(command.x, command.z);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    const distance = options.speed * dtSeconds;
    players[playerId] = {
      ...player,
      x: Math.max(
        -options.halfExtent,
        Math.min(options.halfExtent, player.x + command.x * scale * distance),
      ),
      z: Math.max(
        -options.halfExtent,
        Math.min(options.halfExtent, player.z + command.z * scale * distance),
      ),
      lastSeq: command.seq,
    };
  }

  return attachConfiguration({ tick: state.tick + 1, players }, options);
}
