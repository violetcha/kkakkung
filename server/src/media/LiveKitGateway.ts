import { createHash, randomUUID } from 'node:crypto';
import {
  RoomServiceClient,
  type ClientOptions,
  type CreateOptions,
  type RemoveParticipantOptions,
  type UpdateParticipantOptions,
} from 'livekit-server-sdk';
import { ApiBudget, type ApiKind, type ApiPriority } from '../operations/ApiBudget.js';

export const LIVEKIT_SDK_VERSION = '2.18.0';
export const DEFAULT_CLOUD_REQUEST_TIMEOUT_MS = 10_000;

export type GatewayClient = Pick<
  RoomServiceClient,
  | 'createRoom'
  | 'listRooms'
  | 'listParticipants'
  | 'getParticipant'
  | 'updateSubscriptions'
  | 'updateParticipant'
  | 'removeParticipant'
  | 'deleteRoom'
>;

export type GatewayCallContext = Readonly<{
  requestId: string;
  deadlineMs: number;
  priority?: ApiPriority;
  signal?: AbortSignal;
  beforeDispatch?: () => boolean;
}>;

export type GatewayObservation = Readonly<{
  requestId: string;
  method: keyof GatewayClient;
  /** Digest of the target; never a raw identity, room, SID, token, or URL. */
  target: string;
  sentAtMs: number;
  completedAtMs?: number;
  result: 'sent' | 'succeeded' | 'failed';
  statusCode?: number;
}>;

export type GatewayOptions = Readonly<{
  monotonicNow: () => number;
  /** Transport wait only; queue and policy security deadlines remain independent. */
  requestTimeoutMs?: number;
  observe?: (observation: GatewayObservation) => void;
  clientFactory?: (
    httpUrl: string,
    apiKey: string,
    apiSecret: string,
    options: ClientOptions,
  ) => GatewayClient;
}>;

/** SDK errors can echo sensitive remote request data; only allowlisted codes cross this boundary. */
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | undefined,
    readonly outcomeUnknown: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'GatewayError';
  }
}

function safeError(error: unknown): GatewayError {
  const record = error && typeof error === 'object' ? error : {};
  const candidateStatus = 'status' in record ? record.status : undefined;
  const status =
    typeof candidateStatus === 'number' &&
    Number.isInteger(candidateStatus) &&
    candidateStatus >= 400 &&
    candidateStatus <= 599
      ? candidateStatus
      : undefined;
  const candidateCode = 'code' in record ? record.code : undefined;
  const safeCodes = [
    'not_found',
    'permission_denied',
    'unauthenticated',
    'resource_exhausted',
    'unavailable',
    'internal',
    'unknown',
    'deadline_exceeded',
    'invalid_argument',
    'already_exists',
    'failed_precondition',
  ];
  const code =
    typeof candidateCode === 'string' && safeCodes.includes(candidateCode)
      ? candidateCode
      : status === undefined
        ? 'TRANSPORT_ERROR'
        : 'REMOTE_ERROR';
  let retryAfterMs: number | undefined;
  const metadata = 'metadata' in record ? record.metadata : null;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const values = metadata as Record<string, unknown>;
    const milliseconds = values.retry_after_ms;
    const seconds = values.retry_after;
    const raw = milliseconds ?? seconds;
    if (typeof raw === 'string' && /^\d{1,12}$/.test(raw)) {
      const parsed = Number(raw) * (milliseconds !== undefined ? 1 : 1_000);
      if (Number.isSafeInteger(parsed) && parsed >= 0) retryAfterMs = parsed;
    }
  }
  return new GatewayError(
    code,
    status,
    status === undefined || status >= 500 || status === 408,
    retryAfterMs,
  );
}

/** The only product RoomServiceClient construction site. Every method uses the shared budget. */
export class LiveKitGateway {
  private readonly client: GatewayClient;

  constructor(
    config: Readonly<{ httpUrl: string; apiKey: string; apiSecret: string }>,
    private readonly budget: ApiBudget,
    private readonly options: GatewayOptions,
  ) {
    let url: URL;
    try {
      url = new URL(config.httpUrl);
    } catch {
      throw new Error('INVALID_LIVEKIT_CONFIGURATION');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !config.apiKey.trim() ||
      !config.apiSecret.trim()
    ) {
      throw new Error('INVALID_LIVEKIT_CONFIGURATION');
    }
    const factory =
      options.clientFactory ??
      ((host, key, secret, clientOptions) =>
        new RoomServiceClient(host, key, secret, clientOptions));
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_CLOUD_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs <= 0 ||
      requestTimeoutMs > 2 ** 32 - 1
    )
      throw new Error('INVALID_CLOUD_REQUEST_TIMEOUT');
    // Timeout is in seconds. Disabling implicit region replay is necessary for exact accounting.
    this.client = factory(config.httpUrl, config.apiKey, config.apiSecret, {
      requestTimeout: requestTimeoutMs / 1000,
      failover: false,
    });
  }

  createRoom(options: CreateOptions, context?: GatewayCallContext) {
    return this.call('createRoom', options.name, 'room', 'normal', context, () =>
      this.client.createRoom(options),
    );
  }

  listRooms(names?: string[], context?: GatewayCallContext) {
    return this.call('listRooms', JSON.stringify(names ?? []), 'query', 'normal', context, () =>
      this.client.listRooms(names),
    );
  }

  listParticipants(room: string, context?: GatewayCallContext) {
    return this.call('listParticipants', room, 'query', 'normal', context, () =>
      this.client.listParticipants(room),
    );
  }

  getParticipant(room: string, identity: string, context?: GatewayCallContext) {
    return this.call('getParticipant', `${room}/${identity}`, 'query', 'normal', context, () =>
      this.client.getParticipant(room, identity),
    );
  }

  updateSubscriptions(
    room: string,
    identity: string,
    trackSids: string[],
    subscribe: boolean,
    context?: GatewayCallContext,
  ) {
    return this.call(
      'updateSubscriptions',
      `${room}/${identity}`,
      subscribe ? 'grant' : 'revoke',
      subscribe ? 'normal' : 'cleanup',
      context,
      () => this.client.updateSubscriptions(room, identity, trackSids, subscribe),
    );
  }

  updateParticipant(
    room: string,
    identity: string,
    options: UpdateParticipantOptions,
    context?: GatewayCallContext,
  ) {
    return this.call('updateParticipant', `${room}/${identity}`, 'grant', 'normal', context, () =>
      this.client.updateParticipant(room, identity, options),
    );
  }

  removeParticipant(
    room: string,
    identity: string,
    options?: RemoveParticipantOptions,
    context?: GatewayCallContext,
  ) {
    return this.call('removeParticipant', `${room}/${identity}`, 'revoke', 'cleanup', context, () =>
      this.client.removeParticipant(room, identity, options),
    );
  }

  deleteRoom(room: string, context?: GatewayCallContext) {
    return this.call('deleteRoom', room, 'room', 'cleanup', context, () =>
      this.client.deleteRoom(room),
    );
  }

  private call<T>(
    method: keyof GatewayClient,
    rawTarget: string,
    kind: ApiKind,
    defaultPriority: ApiPriority,
    context: GatewayCallContext | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const requestId = context?.requestId ?? randomUUID();
    const target = createHash('sha256').update(rawTarget).digest('hex').slice(0, 24);
    return this.budget.dispatch({
      requestId,
      method,
      target,
      kind,
      priority: context?.priority ?? defaultPriority,
      // This is a queue dispatch deadline, not the in-flight HTTP response timeout.
      deadlineMs: context?.deadlineMs ?? this.options.monotonicNow() + 1_000,
      signal: context?.signal,
      beforeDispatch: context?.beforeDispatch,
      run: async () => {
        const sentAtMs = this.options.monotonicNow();
        const base = { requestId, method, target, sentAtMs };
        this.observe({ ...base, result: 'sent' });
        try {
          const result = await run();
          this.observe({
            ...base,
            result: 'succeeded',
            completedAtMs: this.options.monotonicNow(),
          });
          return result;
        } catch (error) {
          const safe = safeError(error);
          this.observe({
            ...base,
            result: 'failed',
            completedAtMs: this.options.monotonicNow(),
            statusCode: safe.status,
          });
          throw safe;
        }
      },
    });
  }

  private observe(observation: GatewayObservation): void {
    try {
      this.options.observe?.(observation);
    } catch {
      // An exporter failure cannot trigger a duplicate remote request.
    }
  }
}
