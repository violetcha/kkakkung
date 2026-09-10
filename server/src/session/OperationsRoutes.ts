/**
 * Operator command routes delegating exactly to E's OperationsPort. 202 is acceptance only;
 * terminal success is read back through the snapshot route. Without an operations port the
 * routes answer 503 so nothing is reported as accepted.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { OperationsPort } from '../game/ports.js';
import { requireOperator, type OperatorAuthorize } from './InvitationRoutes.js';

export const OPERATIONS_ROUTES = {
  commands: '/api/operations/commands',
  snapshot: '/api/operations/commands/:requestId',
  status: '/api/operations/status',
} as const;

const requestIdSchema = z.string().min(1).max(128);
export const operationsCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ requestId: requestIdSchema, action: z.literal('drain') }),
  z.strictObject({ requestId: requestIdSchema, action: z.literal('resume') }),
  z.strictObject({ requestId: requestIdSchema, action: z.literal('checkpoint') }),
  z.strictObject({
    requestId: requestIdSchema,
    action: z.literal('retry-retirement'),
    retirementId: z.string().min(1).max(128),
  }),
]);

export function createOperationsRoutes(deps: {
  operations: () => OperationsPort | null;
  authorize: OperatorAuthorize;
}): Router {
  const router = Router();
  const authorize = requireOperator(deps.authorize);
  const unavailable = (res: Response) => res.status(503).json({ error: 'OPERATIONS_UNAVAILABLE' });
  router.post(OPERATIONS_ROUTES.commands, authorize, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const port = deps.operations();
    if (!port) return void unavailable(res);
    const parsed = operationsCommandSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'INVALID_REQUEST' });
    const submission = port.submit(parsed.data);
    if (submission.status === 'conflict')
      return void res.status(409).json({ error: submission.code });
    res.status(202).json(submission.snapshot);
  });
  router.get(OPERATIONS_ROUTES.snapshot, authorize, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const port = deps.operations();
    if (!port) return void unavailable(res);
    const snapshot = port.getSnapshot(String(req.params.requestId ?? ''));
    if (!snapshot) return void res.status(404).json({ error: 'NOT_FOUND' });
    res.status(200).json(snapshot);
  });
  router.get(OPERATIONS_ROUTES.status, authorize, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const port = deps.operations();
    if (!port) return void unavailable(res);
    res.status(200).json(port.getStatus());
  });
  return router;
}
