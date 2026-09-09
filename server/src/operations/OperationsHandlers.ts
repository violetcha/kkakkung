import type { Request, RequestHandler, Response } from 'express';
import type { OperationsPort, OperationsStatus, OperationSnapshot } from '../media/types.js';
import {
  OperationsAudit,
  OPERATIONS_AUDIT_CODES,
  type OperationsAuditCode,
} from './OperationsAudit.js';
import { isOperationsRequestId, validateOperationsCommand } from './OperationsController.js';

const oneOf = (value: unknown, allowed: readonly unknown[]): boolean => allowed.includes(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const amount = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

function publicSnapshot(value: OperationSnapshot): OperationSnapshot {
  if (
    !value ||
    !isOperationsRequestId(value.requestId) ||
    !isOperationsRequestId(value.operationId) ||
    !oneOf(value.action, ['drain', 'resume', 'checkpoint', 'retry-retirement']) ||
    !oneOf(value.status, ['pending', 'succeeded', 'failed']) ||
    !count(value.updatedAtEpochMs) ||
    (value.status === 'failed' ? !oneOf(value.code, OPERATIONS_AUDIT_CODES) : value.code !== null)
  )
    throw new Error('INVALID_OPERATION_RESPONSE');
  return {
    requestId: value.requestId,
    operationId: value.operationId,
    action: value.action,
    status: value.status,
    code: value.code,
    updatedAtEpochMs: value.updatedAtEpochMs,
  };
}

function publicStatus(value: OperationsStatus): OperationsStatus {
  if (
    !value ||
    !oneOf(value.admission, ['OPEN', 'DRAINING', 'LOCKED']) ||
    !oneOf(value.readiness, ['READY', 'RECOVERING', 'LOCKED']) ||
    !count(value.unresolvedCount) ||
    !amount(value.remainingMinutes) ||
    !amount(value.remainingBytes) ||
    (value.checkedAtEpochMs !== null && !count(value.checkedAtEpochMs))
  )
    throw new Error('INVALID_OPERATION_RESPONSE');
  return {
    admission: value.admission,
    readiness: value.readiness,
    unresolvedCount: value.unresolvedCount,
    remainingMinutes: value.remainingMinutes,
    remainingBytes: value.remainingBytes,
    checkedAtEpochMs: value.checkedAtEpochMs,
  };
}

/** B mounts these handlers at the three fixed operations routes behind its HTTP boundary. */
export function createOperationsHandlers(deps: {
  authorize: (authorization: string | undefined) => boolean;
  operations: OperationsPort;
  audit: OperationsAudit;
  onAuditFailure: () => void;
}): Readonly<{ command: RequestHandler; snapshot: RequestHandler; status: RequestHandler }> {
  const lock = () => {
    try {
      deps.onAuditFailure();
    } catch {
      /* Responses never include callback exceptions. */
    }
  };
  const auditEvent = async (
    kind: 'rejected' | 'locked' | 'auth-failed',
    code: OperationsAuditCode,
  ) => {
    try {
      await deps.audit.recordEvent({ kind, code });
      return true;
    } catch {
      lock();
      return false;
    }
  };
  const authenticate = async (request: Request, response: Response) => {
    response.setHeader('Cache-Control', 'no-store');
    let authorized = false;
    try {
      authorized = deps.authorize(request.get('authorization')) === true;
    } catch {
      /* Reject. */
    }
    if (authorized) return true;
    await auditEvent('auth-failed', 'UNAUTHORIZED');
    response.status(403).json({ code: 'UNAUTHORIZED' });
    return false;
  };
  const unavailable = async (response: Response) => {
    lock();
    await auditEvent('locked', 'OPERATION_FAILED');
    response.status(503).json({ code: 'OPERATIONS_UNAVAILABLE' });
  };
  const rejectInput = async (response: Response) => {
    if (await auditEvent('rejected', 'INVALID_COMMAND'))
      response.status(400).json({ code: 'INVALID_COMMAND' });
    else response.status(503).json({ code: 'OPERATIONS_UNAVAILABLE' });
  };

  const command: RequestHandler = async (request, response) => {
    if (!(await authenticate(request, response))) return;
    let parsed;
    try {
      parsed = validateOperationsCommand(request.body as unknown);
    } catch {
      await rejectInput(response);
      return;
    }
    try {
      const result = deps.operations.submit(parsed);
      if (result.status === 'conflict' && result.code === 'REQUEST_ID_CONFLICT') {
        response.status(409).json({ code: 'REQUEST_ID_CONFLICT' });
      } else if (result.status === 'accepted') {
        const safe = publicSnapshot(result.snapshot);
        if (safe.requestId !== parsed.requestId || safe.action !== parsed.action)
          throw new Error('INVALID_OPERATION_RESPONSE');
        response.status(202).json(safe);
      } else throw new Error('INVALID_OPERATION_RESPONSE');
    } catch {
      await unavailable(response);
    }
  };
  const snapshot: RequestHandler = async (request, response) => {
    if (!(await authenticate(request, response))) return;
    const requestId = request.params.requestId;
    if (!isOperationsRequestId(requestId)) {
      await rejectInput(response);
      return;
    }
    try {
      const result = deps.operations.getSnapshot(requestId);
      if (result === null) response.status(404).json({ code: 'OPERATION_NOT_FOUND' });
      else {
        const safe = publicSnapshot(result);
        if (safe.requestId !== requestId) throw new Error('INVALID_OPERATION_RESPONSE');
        response.json(safe);
      }
    } catch {
      await unavailable(response);
    }
  };
  const status: RequestHandler = async (request, response) => {
    if (!(await authenticate(request, response))) return;
    try {
      response.json(publicStatus(deps.operations.getStatus()));
    } catch {
      await unavailable(response);
    }
  };
  return { command, snapshot, status };
}
