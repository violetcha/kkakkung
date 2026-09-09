import type { RequestHandler, Response } from 'express';
import type { Readiness } from '../media/types.js';
import { sanitizeReadiness } from './Readiness.js';

export type HealthHandlersOptions = Readonly<{
  getReadiness: () => Readiness;
  /** B registers these handlers only after a nonfatal initialize result. */
  isInitialized: () => boolean;
}>;

function initializing(response: Response): void {
  response.status(503).json({
    state: 'INITIALIZING',
    reasonCodes: ['INITIALIZATION_UNCONFIRMED'],
  });
}

/** Public health projection; identities, usage and recovery counts stay on internal ports. */
export function createHealthHandlers(options: HealthHandlersOptions): Readonly<{
  live: RequestHandler;
  ready: RequestHandler;
}> {
  const initialized = (): boolean => {
    try {
      return options.isInitialized() === true;
    } catch {
      return false;
    }
  };

  const live: RequestHandler = (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!initialized()) {
      initializing(response);
      return;
    }
    // Recovery, Cloud and admission are outside the process-liveness probe.
    response.status(200).json({ state: 'LIVE', reasonCodes: [] });
  };

  const ready: RequestHandler = (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!initialized()) {
      initializing(response);
      return;
    }
    try {
      const snapshot = sanitizeReadiness(options.getReadiness());
      const isReady =
        snapshot.state === 'READY' &&
        snapshot.historyComplete === true &&
        snapshot.unresolvedCount === 0 &&
        snapshot.reasonCodes.length === 0;
      response.status(isReady ? 200 : 503).json({
        state: isReady ? 'READY' : snapshot.state === 'RECOVERING' ? 'RECOVERING' : 'LOCKED',
        reasonCodes: snapshot.reasonCodes,
      });
    } catch {
      response.status(503).json({ state: 'LOCKED', reasonCodes: ['READINESS_UNCONFIRMED'] });
    }
  };

  return Object.freeze({ live, ready });
}
