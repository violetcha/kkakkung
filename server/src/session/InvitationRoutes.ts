/**
 * Operator-only invitation routes. Authorization comes from E's `createOperatorAuth(OPS_TOKEN)`
 * function; a player's session Bearer never passes it. The raw invite token appears only in
 * the 201 response body and is never logged or persisted.
 */
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { INVITATION_ROUTES, type InvitationPort } from './invite-types.js';

export type OperatorAuthorize = (authorization: string | undefined) => boolean;

const issueSchema = z.strictObject({
  scope: z.strictObject({
    allowCreate: z.boolean(),
    roomCodes: z.array(z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/)).max(16),
  }),
  expiresAt: z.number().int().positive().safe(),
});

export function requireOperator(authorize: OperatorAuthorize): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !authorize(header)) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
  };
}

export function createInvitationRoutes(deps: {
  invites: InvitationPort;
  authorize: OperatorAuthorize;
}): Router {
  const router = Router();
  const authorize = requireOperator(deps.authorize);
  router.post(INVITATION_ROUTES.issue, authorize, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_REQUEST' });
      return;
    }
    const result = deps.invites.issue(parsed.data);
    if (result.status === 'issued') {
      res.status(201).json(result.invitation);
      return;
    }
    res.status(result.code === 'INVALID_INVITATION' ? 400 : 409).json({ error: result.code });
  });
  router.post(INVITATION_ROUTES.revoke, authorize, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const inviteId = String(req.params.inviteId ?? '');
    if (!/^[0-9a-f-]{36}$/.test(inviteId)) {
      res.status(400).json({ error: 'INVALID_REQUEST' });
      return;
    }
    deps.invites.revoke(inviteId);
    res.status(204).end();
  });
  return router;
}
