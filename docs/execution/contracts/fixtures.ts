import type {
  CommandEnvelope,
  CommandReceipt,
  CommandOutcome,
  RequestStatusResult,
  MediaBindings,
  AudioPolicy,
  SensorSnapshot,
  ExchangeView,
  VisibleEntity,
  KnownExit,
} from './types.ts';

export const exitStart = {
  matchId: 'fixture-match-1',
  requestId: '10000000-0000-4000-8000-000000000001',
  sequence: 12,
  type: 'EXIT_START',
  payload: { exitId: 'exit-runner-1' },
} as const satisfies CommandEnvelope;
export const acceptedThenRejected = {
  command: exitStart,
  receipt: {
    matchId: exitStart.matchId,
    requestId: exitStart.requestId,
    sequence: 12,
    stateVersion: 40,
    status: 'accepted',
    code: null,
  } satisfies CommandReceipt,
  outcome: {
    matchId: exitStart.matchId,
    requestId: exitStart.requestId,
    sequence: 12,
    tick: 101,
    stateVersion: 40,
    result: 'rejected',
    code: 'NOT_ALLOWED',
  } satisfies CommandOutcome,
  expected: {
    uiPending: false,
    success: false,
    privateStateChanged: false,
    maySubmitNewRequest: true,
  },
} as const;
export const rejectedBeforeQueue = {
  receipt: {
    ...acceptedThenRejected.receipt,
    status: 'rejected',
    code: 'QUEUE_FULL',
  } satisfies CommandReceipt,
  expected: {
    uiPending: false,
    maySubmitNewRequest: true,
    waitsForOutcome: false,
    startsStatusTimer: false,
  },
} as const;
export const endedWhilePending = {
  ...acceptedThenRejected.outcome,
  result: 'canceled',
  code: 'ROUND_ENDED',
} as const satisfies CommandOutcome;
export const requestLookup = {
  matchId: exitStart.matchId,
  requestId: exitStart.requestId,
  status: 'done',
  outcome: acceptedThenRejected.outcome,
} as const satisfies RequestStatusResult;

export const firstBindings = {
  matchId: 'fixture-match-1',
  mediaInstanceId: 'fixture-game-1',
  receiverGeneration: 1,
  bindingRevision: 8,
  participants: [
    {
      playerId: 'p1',
      publisherGeneration: 1,
      mediaIdentity: 'identity-p1-g1',
      participantSid: 'PA_1',
      faceTrackSid: 'TR_face_1',
    },
    {
      playerId: 'p2',
      publisherGeneration: 1,
      mediaIdentity: 'identity-p2-g1',
      participantSid: 'PA_2',
      faceTrackSid: 'TR_face_2',
      audioTrackSid: 'TR_audio_2',
    },
  ],
} as const satisfies MediaBindings;
export const onePublisherReconnected = {
  ...firstBindings,
  bindingRevision: 9,
  participants: [
    firstBindings.participants[0],
    {
      playerId: 'p2',
      publisherGeneration: 2,
      mediaIdentity: 'identity-p2-g2',
      participantSid: 'PA_22',
      faceTrackSid: 'TR_face_22',
      audioTrackSid: 'TR_audio_22',
    },
  ],
} as const satisfies MediaBindings;
export const audioPolicy = {
  matchId: firstBindings.matchId,
  mediaInstanceId: firstBindings.mediaInstanceId,
  receiverGeneration: 1,
  bindingRevision: 8,
  policyRevision: 4,
  stateVersion: 40,
  voices: [{ playerId: 'p2', trackSid: 'TR_audio_2', gain: 0.5, azimuthRad: 0, lowpassHz: 4000 }],
  effects: [],
} as const satisfies AudioPolicy;
export const remoteFace = {
  playerId: 'p2',
  publisherGeneration: 1,
  mediaIdentity: 'identity-p2-g1',
  participantSid: 'PA_2',
  trackSid: 'TR_face_2',
  kind: 'video',
} as const;
export const faceArrivalOrders = [
  { order: ['track', 'bindings'], expectedAttachedPlayer: 'p2', expectedBeforeBinding: false },
  { order: ['bindings', 'track'], expectedAttachedPlayer: 'p2', expectedBeforeBinding: false },
] as const;
export const audioArrivalOrders = [
  ['track', 'bindings', 'policy'],
  ['track', 'policy', 'bindings'],
  ['bindings', 'track', 'policy'],
  ['bindings', 'policy', 'track'],
  ['policy', 'track', 'bindings'],
  ['policy', 'bindings', 'track'],
] as const;

export const stalePoseWithNewFace = {
  runtimeGeneration: 1,
  emittedAtMs: 1600,
  face: {
    frameId: 16,
    sampledAtMs: 1600,
    receivedAtMs: 1600,
    status: 'valid',
    data: { landmarks: [], yawRad: 0, quality: 'valid' },
  },
  pose: {
    frameId: 10,
    sampledAtMs: 1000,
    receivedAtMs: 1020,
    status: 'valid',
    data: { landmarks: [], quality: 'valid' },
  },
  gesture: null,
} as const satisfies SensorSnapshot;
export const missingPose = {
  ...stalePoseWithNewFace,
  pose: { frameId: 17, sampledAtMs: 1700, receivedAtMs: 1710, status: 'missing', data: null },
  emittedAtMs: 1710,
} as const satisfies SensorSnapshot;
export const gestureCases = [
  { observed: ['palm', 'victory'], scores: [0.95, 0.96], expectedKind: 'none' },
  { observed: ['palm', 'palm'], scores: [0.95, 0.96], expectedKind: 'palm', expectedScore: 0.96 },
] as const;
export const exchangeViews = {
  outgoing: {
    exchangeId: 'exchange-1',
    fromPlayerId: 'runner-1',
    toPlayerId: 'runner-2',
    direction: 'outgoing',
    expiresAtTick: 140,
  } satisfies ExchangeView,
  incoming: {
    exchangeId: 'exchange-1',
    fromPlayerId: 'runner-1',
    toPlayerId: 'runner-2',
    direction: 'incoming',
    expiresAtTick: 140,
  } satisfies ExchangeView,
} as const;
export const otherPlayersSensor = {
  id: 'sensor-1',
  kind: 'sensor',
  cell: { x: 10, y: 10 },
  wall: { x: 10, y: 9, side: 2 },
  state: 'ARMED',
} as const satisfies VisibleEntity;
export const observedExit = {
  exitId: 'exit-runner-1',
  ownerId: 'runner-1',
  wall: { x: 12, y: 10, side: 3 },
  approach: { x: 11, y: 10 },
} as const satisfies KnownExit;
export const exitVisibilityCases = [
  { known: true, currentlyVisible: true, active: true, expectedWorldPortal: true },
  { known: true, currentlyVisible: false, active: true, expectedWorldPortal: false },
  { known: true, currentlyVisible: true, active: false, expectedWorldPortal: false },
] as const;
export const hearingBoundary = [
  { wasAllowed: false, distance: 6, allowed: false },
  { wasAllowed: false, distance: 5, allowed: true },
  { wasAllowed: true, distance: 6, allowed: true },
  { wasAllowed: true, distance: 7, allowed: false },
  { wasAllowed: false, distance: 6, allowed: false },
  { wasAllowed: false, distance: 5, allowed: true },
] as const;
export const playbackReplacementCases = [
  { kind: 'new-sid', expectsPublicationChange: true, expected: 'deny-validate-allow' },
  { kind: 'same-sid', expectsPublicationChange: false, expected: 'keep-policy-check-new-marker' },
  {
    kind: 'full-reconnect',
    expectsPublicationChange: true,
    expected: 'retire-old-before-new-grant',
  },
] as const;
export const deviceReadyCases = [
  {
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
    microphone: 'denied',
    expectedReady: true,
  },
  {
    camera: 'failed',
    vision: 'ready',
    calibration: 'ready',
    microphone: 'ready',
    expectedReady: false,
  },
  {
    camera: 'ready',
    vision: 'loading',
    calibration: 'ready',
    microphone: 'ready',
    expectedReady: false,
  },
] as const;
