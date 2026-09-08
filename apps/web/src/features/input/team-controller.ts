type InputTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type Step = 'forward' | 'back';
type Turn = 'left' | 'right';

export function createTeamController(options: {
  target: InputTarget;
  move(command: { seq: number; dir: Step }): void;
  turn(command: { seq: number; dir: Turn }): void;
}) {
  let held: Step | undefined;
  let seq = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const onKeyDown = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (event.code === 'KeyW' || event.code === 'ArrowUp') {
      held = 'forward';
      if (!event.repeat) options.move({ seq: seq++, dir: held });
    } else if (event.code === 'KeyS' || event.code === 'ArrowDown') {
      held = 'back';
      if (!event.repeat) options.move({ seq: seq++, dir: held });
    } else if (!event.repeat && (event.code === 'KeyA' || event.code === 'ArrowLeft'))
      options.turn({ seq: seq++, dir: 'left' });
    else if (!event.repeat && (event.code === 'KeyD' || event.code === 'ArrowRight'))
      options.turn({ seq: seq++, dir: 'right' });
    else return;
    event.preventDefault();
  };
  const onKeyUp = (raw: Event) => {
    const code = (raw as KeyboardEvent).code;
    if (
      (held === 'forward' && (code === 'KeyW' || code === 'ArrowUp')) ||
      (held === 'back' && (code === 'KeyS' || code === 'ArrowDown'))
    )
      held = undefined;
  };
  const clear = () => {
    held = undefined;
  };
  return {
    connect() {
      if (timer) return;
      options.target.addEventListener('keydown', onKeyDown);
      options.target.addEventListener('keyup', onKeyUp);
      options.target.addEventListener('blur', clear);
      timer = setInterval(() => {
        if (held) options.move({ seq: seq++, dir: held });
      }, 150);
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
