/**
 * S15P21C204-336. What the process does with an exception no room caught.
 *
 * Rooms contain their own faults (the tick coordinator and `onUncaughtException`), so anything
 * that still reaches the process is outside every room and its state is unknown. Continuing is
 * not safe (https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly), and
 * before this nothing was recorded at all: Node printed a stack and the container restarted.
 * The guard keeps that outcome - the process ends with exit code 1 and `restart: unless-stopped`
 * brings it back - but records the fault first and gives the rooms one bounded chance to close.
 */
export type ProcessFaultKind = 'uncaughtException' | 'unhandledRejection';

export type ProcessGuardDeps = Readonly<{
  on: (event: ProcessFaultKind, listener: (error: unknown) => void) => void;
  report: (kind: ProcessFaultKind, error: unknown) => void;
  close: () => Promise<void>;
  exit: (code: number) => void;
  /** Hard stop if close never settles. The returned timer must not keep the process alive. */
  schedule: (callback: () => void, ms: number) => void;
  closeTimeoutMs?: number;
}>;

export function installProcessGuard(deps: ProcessGuardDeps) {
  let ending = false;
  const fault = (kind: ProcessFaultKind) => (error: unknown) => {
    try {
      deps.report(kind, error);
    } catch {
      // Recording must never stop the process from ending.
    }
    if (ending) return;
    ending = true;
    deps.schedule(() => deps.exit(1), deps.closeTimeoutMs ?? 10_000);
    void deps
      .close()
      .catch(() => undefined)
      .finally(() => deps.exit(1));
  };
  deps.on('uncaughtException', fault('uncaughtException'));
  deps.on('unhandledRejection', fault('unhandledRejection'));
}
