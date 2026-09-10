import {
  commandEnvelopeSchema,
  commandReceiptSchema,
  commandOutcomeSchema,
  requestStatusResultSchema,
  type CommandEnvelope,
  type CommandOutcome,
} from '@kkakkung/protocol/game-messages';

export type CommandInput = {
  [K in CommandEnvelope['type']]: Pick<Extract<CommandEnvelope, { type: K }>, 'type' | 'payload'>;
}[CommandEnvelope['type']];
export type RequestDisplay = {
  requestId: string;
  type: CommandInput['type'];
  status: 'pending' | 'waiting-view' | 'applied' | 'rejected' | 'canceled' | 'unconfirmed';
  code: string | null;
};
type Pending = {
  command: CommandEnvelope;
  nextAt: number;
  polls: number;
  outcome?: CommandOutcome;
  display: RequestDisplay;
};
export function createCommandLifecycle(deps: {
  now(): number;
  uuid(): string;
  send(channel: string, value: unknown): void;
  changed(value: RequestDisplay): void;
}) {
  let matchId = '';
  let sequence = 0;
  let version = -1;
  const requests = new Map<string, Pending>();
  const publish = (p: Pending, status: RequestDisplay['status'], code: string | null = null) => {
    p.display = { ...p.display, status, code };
    deps.changed(p.display);
  };
  const unconfirmed = (p: Pending) => {
    publish(p, 'unconfirmed', 'UNCONFIRMED');
    requests.delete(p.command.requestId);
    deps.send('view-resync', { matchId, lastStateVersion: Math.max(0, version) });
  };
  const outcome = (value: unknown) => {
    const parsed = commandOutcomeSchema.safeParse(value);
    if (!parsed.success || parsed.data.matchId !== matchId) return;
    const item = parsed.data;
    const p = requests.get(item.requestId);
    if (!p || item.sequence !== p.command.sequence || p.outcome) return;
    p.outcome = item;
    if (item.result === 'applied' && item.stateVersion > version) {
      publish(p, 'waiting-view');
      p.nextAt = deps.now() + 2000;
    } else {
      publish(p, item.result, item.code);
      requests.delete(item.requestId);
    }
  };
  return {
    setMatch(next: string) {
      if (next !== matchId) {
        requests.clear();
        matchId = next;
        version = -1;
      }
    },
    send(input: CommandInput) {
      const command = commandEnvelopeSchema.parse({
        ...input,
        matchId,
        requestId: deps.uuid(),
        sequence: sequence++,
      });
      const display: RequestDisplay = {
        requestId: command.requestId,
        type: command.type,
        status: 'pending',
        code: null,
      };
      const p: Pending = { command, nextAt: deps.now() + 2000, polls: 0, display };
      requests.set(command.requestId, p);
      deps.changed(display);
      try {
        deps.send('command', command);
      } catch {
        unconfirmed(p);
      }
      return command.requestId;
    },
    receipt(value: unknown) {
      const result = commandReceiptSchema.safeParse(value);
      if (!result.success || result.data.matchId !== matchId) return;
      const p = requests.get(result.data.requestId);
      if (!p || p.command.sequence !== result.data.sequence || p.outcome) return;
      if (result.data.status === 'rejected') {
        publish(p, 'rejected', result.data.code);
        requests.delete(p.command.requestId);
      }
    },
    outcome,
    lookup(value: unknown) {
      const result = requestStatusResultSchema.safeParse(value);
      if (!result.success || result.data.matchId !== matchId) return;
      const item = result.data;
      const p = requests.get(item.requestId);
      if (!p) return;
      if (item.status === 'unknown') unconfirmed(p);
      if (item.status === 'done' && item.outcome.requestId === item.requestId)
        outcome(item.outcome);
    },
    view(next: number) {
      version = Math.max(version, next);
      for (const p of requests.values())
        if (p.outcome && p.outcome.stateVersion <= version) {
          publish(p, p.outcome.result, p.outcome.code);
          requests.delete(p.command.requestId);
        }
    },
    poll() {
      for (const p of requests.values()) {
        if (deps.now() < p.nextAt) continue;
        if (p.outcome || p.polls >= 3) {
          unconfirmed(p);
          continue;
        }
        p.polls++;
        p.nextAt = deps.now() + 2000;
        deps.send('request-status', { matchId, requestId: p.command.requestId });
      }
    },
    clear() {
      requests.clear();
    },
    get size() {
      return requests.size;
    },
  };
}
