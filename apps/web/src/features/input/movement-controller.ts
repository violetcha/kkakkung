type InputTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

type Move = { seq: number; x: number; z: number };

export interface MovementController {
  connect(): void;
  disconnect(): void;
}

const DIRECTIONS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export function createMovementController(options: {
  target: InputTarget;
  send(command: Move): void;
}): MovementController {
  const pressed = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let seq = 0;

  const onKeyDown = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    if (!DIRECTIONS[event.code]) return;
    event.preventDefault();
    pressed.add(event.code);
  };
  const onKeyUp = (rawEvent: Event) => {
    pressed.delete((rawEvent as KeyboardEvent).code);
  };
  const clear = () => pressed.clear();
  const tick = () => {
    let x = 0;
    let z = 0;
    for (const code of pressed) {
      const [dx, dz] = DIRECTIONS[code] ?? [0, 0];
      x += dx;
      z += dz;
    }
    if (x === 0 && z === 0) return;
    const length = Math.hypot(x, z);
    options.send({ seq: seq++, x: x / length, z: z / length });
  };

  return {
    connect() {
      if (timer) return;
      options.target.addEventListener('keydown', onKeyDown);
      options.target.addEventListener('keyup', onKeyUp);
      options.target.addEventListener('blur', clear);
      timer = setInterval(tick, 50);
    },
    disconnect() {
      if (timer) clearInterval(timer);
      timer = undefined;
      clear();
      options.target.removeEventListener('keydown', onKeyDown);
      options.target.removeEventListener('keyup', onKeyUp);
      options.target.removeEventListener('blur', clear);
    },
  };
}
