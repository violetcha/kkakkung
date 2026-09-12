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
  LayoutSelectionInput,
  LayoutSelectionResult,
  LayoutTemplate,
  MatchLayout,
  SpawnRegion,
  PrivateView,
  PrivateEvent,
  GameViewScope,
  MediaInitializationResult,
  OperationsStatus,
  MapTemplateResult,
  MapVariantsResult,
  PracticeLayoutResult,
  IssueInvitation,
  InvitationIssueResult,
  MediaConfiguration,
  MetricSample,
  SessionRequest,
  SessionAccessResponse,
  PublicRoundState,
} from './types.ts';

// Shared planning examples. These fixtures do not run product modules or certify a real map,
// Cloud connection, journal recovery, deployment, or device test.

// API handoff examples only. No account, public window or Cloud capability is authorized.
export const roomExpiryFixture = {
  phase: 'DEVICE_CHECK',
  matchId: 'fixture-match',
  stateVersion: 1,
  serverTick: 0,
  startTick: null,
  startAt: null,
  deadlineTick: null,
  counts: { escaped: 0, captured: 0 },
  result: null,
  abortReason: null,
  roomExpiresInSeconds: 60,
} as const satisfies PublicRoundState;
export const teamSessionFixture = {
  nickname: '팀원',
  createRoom: true,
} as const satisfies SessionRequest;
export const teamAccessFixture = { method: 'gitlab-sso' } as const satisfies SessionAccessResponse;
export const operatorInvitationFixture = {
  scope: { allowCreate: false, roomCodes: ['ABC123'] },
  expiresAt: 1_900_000_000_000,
} as const satisfies IssueInvitation;
export const rejectedInvitationFixture = {
  status: 'rejected',
  code: 'OUTSIDE_PUBLIC_WINDOW',
} as const satisfies InvitationIssueResult;
export const unavailableMapFixture = {
  status: 'invalid',
  code: 'INVALID_TEMPLATE',
  path: ['runnerSpawnRegions', 0],
} as const satisfies MapTemplateResult & MapVariantsResult;
export const invalidPracticeFixture = {
  status: 'invalid',
  code: 'INVALID_PRACTICE_LAYOUT',
  path: ['layouts', 'runner'],
} as const satisfies PracticeLayoutResult;
export const unconfiguredMediaFixture = {
  httpUrl: 'https://fixture.invalid',
  wsUrl: 'wss://fixture.invalid',
  apiKey: '',
  apiSecret: '',
  namespace: 'test-only',
  opsDataDir: '.local/test-only',
  projectAlias: 'fixture-project',
  publicWindow: null,
  initialBudget: null,
  officialBudgetMaxAgeMs: 1,
  operationTimeoutMs: 1,
  productSecurityReady: false,
  maxConcurrentParticipants: 0,
  maxNormalApiCallsPer60s: 0,
  maxTotalApiCallsPer60s: 0,
} as const satisfies MediaConfiguration;
export const planningMetricFixture = {
  name: 'fixture.duration',
  value: 12,
  unit: 'ms',
  atMs: 123,
} as const satisfies MetricSample;

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

const fixtureRegion = (regionId: string, fromX: number, toX: number): SpawnRegion => ({
  regionId,
  cells: Array.from({ length: 30 * (toX - fromX + 1) }, (_, i) => ({
    x: fromX + (i % (toX - fromX + 1)),
    y: 1 + Math.floor(i / (toX - fromX + 1)),
  })),
  spawnCandidates: [{ x: fromX + 2, y: 4 }],
});
const taggerRegions = [
  fixtureRegion('tagger-west', 1, 10),
  fixtureRegion('tagger-center', 11, 20),
  fixtureRegion('tagger-east', 21, 30),
] as const;
const runnerRegion = (region: SpawnRegion, index: number): SpawnRegion => ({
  ...region,
  regionId: `runner-${index + 1}`,
  spawnCandidates: [{ x: 3 + index * 10, y: 24 }],
});
const runnerSpawnRegions = [
  runnerRegion(taggerRegions[0], 0),
  runnerRegion(taggerRegions[1], 1),
  runnerRegion(taggerRegions[2], 2),
] as const;

// The repeated digest is synthetic fixture metadata, never an accepted asset checksum.
// B must independently hash the original JSON bytes before consuming a real template.
export const mapTemplateFixture = {
  templateId: 'fixture-open-grid',
  templateVersion: 'fixture-v1',
  templateHash: 'a'.repeat(64),
  variantId: 'identity',
  topology: {
    topologyVersion: 'fixture-topology-v1',
    width: 32,
    height: 32,
    walkable: Array.from({ length: 32 * 32 }, (_, i) => {
      const x = i % 32;
      const y = Math.floor(i / 32);
      return x > 0 && x < 31 && y > 0 && y < 31;
    }),
  },
  taggerRegions,
  runnerSpawnRegions,
  exitCandidates: [
    { x: 3, y: 0, side: 2 },
    { x: 13, y: 0, side: 2 },
    { x: 23, y: 0, side: 2 },
  ],
} as const satisfies LayoutTemplate;
export const fallbackLayoutFixture = {
  layoutId: 'fixture-fallback-1',
  topology: mapTemplateFixture.topology,
  players: [
    { playerId: 'tagger-1', role: 'tagger', cell: { x: 3, y: 4 }, dir: 2 },
    { playerId: 'tagger-2', role: 'tagger', cell: { x: 13, y: 4 }, dir: 2 },
    { playerId: 'tagger-3', role: 'tagger', cell: { x: 23, y: 4 }, dir: 2 },
    { playerId: 'runner-1', role: 'runner', cell: { x: 3, y: 24 }, dir: 0 },
    { playerId: 'runner-2', role: 'runner', cell: { x: 13, y: 24 }, dir: 0 },
    { playerId: 'runner-3', role: 'runner', cell: { x: 23, y: 24 }, dir: 0 },
  ],
  exits: [
    {
      exitId: 'fixture-exit-r1',
      ownerId: 'runner-1',
      wall: { x: 3, y: 0, side: 2 },
      approach: { x: 3, y: 1 },
      poseKind: 'left',
    },
    {
      exitId: 'fixture-exit-r2',
      ownerId: 'runner-2',
      wall: { x: 13, y: 0, side: 2 },
      approach: { x: 13, y: 1 },
      poseKind: 'right',
    },
    {
      exitId: 'fixture-exit-r3',
      ownerId: 'runner-3',
      wall: { x: 23, y: 0, side: 2 },
      approach: { x: 23, y: 1 },
      poseKind: 'y',
    },
  ],
  territories: [
    { playerId: 'tagger-1', cells: taggerRegions[0].cells },
    { playerId: 'tagger-2', cells: taggerRegions[1].cells },
    { playerId: 'tagger-3', cells: taggerRegions[2].cells },
  ],
} as const satisfies MatchLayout;
// Session IDs intentionally differ from persisted slot IDs. Mixed case makes locale-based
// sorting visibly different from the contract's default JavaScript string ordering.
export const fallbackSessionPlayers = [
  { playerId: 'session-r-b', role: 'runner' },
  { playerId: 'session-t-a', role: 'tagger' },
  { playerId: 'session-r-Z', role: 'runner' },
  { playerId: 'session-t-10', role: 'tagger' },
  { playerId: 'session-r-2', role: 'runner' },
  { playerId: 'session-t-Z', role: 'tagger' },
] as const;
export const expectedFallbackSlotBindings = {
  'tagger-1': 'session-t-10',
  'tagger-2': 'session-t-Z',
  'tagger-3': 'session-t-a',
  'runner-1': 'session-r-2',
  'runner-2': 'session-r-Z',
  'runner-3': 'session-r-b',
} as const;
// Expected identity transformation only. Real certification must subsequently recheck all
// gameplay constraints; this synthetic open grid is not a certified production fallback.
export const reboundFallbackLayoutFixture = {
  ...fallbackLayoutFixture,
  players: fallbackLayoutFixture.players.map((player) => ({
    ...player,
    playerId: expectedFallbackSlotBindings[player.playerId],
  })),
  exits: fallbackLayoutFixture.exits.map((exit) => ({
    ...exit,
    ownerId: expectedFallbackSlotBindings[exit.ownerId],
  })),
  territories: fallbackLayoutFixture.territories.map((region) => ({
    ...region,
    playerId: expectedFallbackSlotBindings[region.playerId],
  })),
} as const satisfies MatchLayout;
export const layoutSelectionFixture = {
  template: mapTemplateFixture,
  players: fallbackSessionPlayers,
  seed: 204,
  maxAttempts: 256,
  fallback: {
    templateId: mapTemplateFixture.templateId,
    templateVersion: mapTemplateFixture.templateVersion,
    templateHash: mapTemplateFixture.templateHash,
    variantId: mapTemplateFixture.variantId,
    layout: fallbackLayoutFixture,
  },
} as const satisfies LayoutSelectionInput;
export const unavailableFallbackCertification = {
  status: 'unavailable',
  code: 'LAYOUT_UNAVAILABLE',
} as const satisfies LayoutSelectionResult;
export const invalidFallbackSlotInputs = [
  {
    name: 'missing-persisted-runner-slot',
    input: {
      ...layoutSelectionFixture,
      fallback: {
        ...layoutSelectionFixture.fallback,
        layout: { ...fallbackLayoutFixture, players: fallbackLayoutFixture.players.slice(0, 5) },
      },
    } satisfies LayoutSelectionInput,
    expectedViolation: 'missing-or-duplicate-slot',
    expectedCertification: unavailableFallbackCertification,
  },
  {
    name: 'slot-has-wrong-role',
    input: {
      ...layoutSelectionFixture,
      fallback: {
        ...layoutSelectionFixture.fallback,
        layout: {
          ...fallbackLayoutFixture,
          players: fallbackLayoutFixture.players.map((player) =>
            player.playerId === 'tagger-1' ? { ...player, role: 'runner' as const } : player,
          ),
        },
      },
    } satisfies LayoutSelectionInput,
    expectedViolation: 'slot-role-mismatch',
    expectedCertification: unavailableFallbackCertification,
  },
  {
    name: 'current-roster-has-wrong-role-count',
    input: {
      ...layoutSelectionFixture,
      players: fallbackSessionPlayers.map((player) =>
        player.playerId === 'session-t-10' ? { ...player, role: 'runner' as const } : player,
      ),
    } satisfies LayoutSelectionInput,
    expectedViolation: 'current-role-count',
    expectedCertification: unavailableFallbackCertification,
  },
  {
    name: 'saved-exit-owned-by-tagger-slot',
    input: {
      ...layoutSelectionFixture,
      fallback: {
        ...layoutSelectionFixture.fallback,
        layout: {
          ...fallbackLayoutFixture,
          exits: fallbackLayoutFixture.exits.map((exit, i) =>
            i === 0 ? { ...exit, ownerId: 'tagger-1' } : exit,
          ),
        },
      },
    } satisfies LayoutSelectionInput,
    expectedViolation: 'exit-owner-role',
    expectedCertification: unavailableFallbackCertification,
  },
  {
    name: 'saved-territory-owned-by-runner-slot',
    input: {
      ...layoutSelectionFixture,
      fallback: {
        ...layoutSelectionFixture.fallback,
        layout: {
          ...fallbackLayoutFixture,
          territories: fallbackLayoutFixture.territories.map((region, i) =>
            i === 0 ? { ...region, playerId: 'runner-1' } : region,
          ),
        },
      },
    } satisfies LayoutSelectionInput,
    expectedViolation: 'territory-owner-role',
    expectedCertification: unavailableFallbackCertification,
  },
] as const;
export const incompleteFallbackRebindings = [
  {
    name: 'player-slot-remains',
    layout: {
      ...reboundFallbackLayoutFixture,
      players: fallbackLayoutFixture.players,
    } satisfies MatchLayout,
    expectedRemainingSlots: 6,
    expectedCertification: unavailableFallbackCertification,
  },
  {
    name: 'exit-owner-slot-remains',
    layout: {
      ...reboundFallbackLayoutFixture,
      exits: fallbackLayoutFixture.exits,
    } satisfies MatchLayout,
    expectedRemainingSlots: 3,
    expectedCertification: unavailableFallbackCertification,
  },
  {
    name: 'territory-owner-slot-remains',
    layout: {
      ...reboundFallbackLayoutFixture,
      territories: fallbackLayoutFixture.territories,
    } satisfies MatchLayout,
    expectedRemainingSlots: 3,
    expectedCertification: unavailableFallbackCertification,
  },
] as const;
export const invalidRegionFixtures = [
  {
    name: 'overlapping-tagger-regions',
    template: {
      ...mapTemplateFixture,
      taggerRegions: [taggerRegions[0], taggerRegions[0], taggerRegions[2]],
    } satisfies LayoutTemplate,
    expectedViolation: 'same-role-overlap',
  },
  {
    name: 'overlapping-runner-regions',
    template: {
      ...mapTemplateFixture,
      runnerSpawnRegions: [runnerSpawnRegions[0], runnerSpawnRegions[0], runnerSpawnRegions[2]],
    } satisfies LayoutTemplate,
    expectedViolation: 'same-role-overlap',
  },
  {
    name: 'empty-spawn-candidates',
    template: {
      ...mapTemplateFixture,
      taggerRegions: [
        { ...taggerRegions[0], spawnCandidates: [] },
        taggerRegions[1],
        taggerRegions[2],
      ],
    } satisfies LayoutTemplate,
    expectedViolation: 'empty-candidates',
  },
  {
    name: 'spawn-outside-own-region',
    template: {
      ...mapTemplateFixture,
      taggerRegions: [
        { ...taggerRegions[0], spawnCandidates: [{ x: 13, y: 4 }] },
        taggerRegions[1],
        taggerRegions[2],
      ],
    } satisfies LayoutTemplate,
    expectedViolation: 'candidate-outside-region',
  },
  {
    name: 'region-on-wall',
    template: {
      ...mapTemplateFixture,
      taggerRegions: [
        { ...taggerRegions[0], cells: [...taggerRegions[0].cells, { x: 0, y: 0 }] },
        taggerRegions[1],
        taggerRegions[2],
      ],
    } satisfies LayoutTemplate,
    expectedViolation: 'non-walkable-region',
  },
] as const;
export const fallbackMetadataCases = [
  { field: 'templateId', value: 'other-template' },
  { field: 'templateVersion', value: 'fixture-v0' },
  { field: 'templateHash', value: 'b'.repeat(64) },
  { field: 'variantId', value: 'rotated' },
] as const;
export const layoutSelectionBudgetCases = [
  { attempted: 8, batchAttempts: 8, elapsedMs: 99, expected: 'continue' },
  { attempted: 256, batchAttempts: 8, elapsedMs: 99, expected: 'use-prevalidated-fallback' },
  { attempted: 8, batchAttempts: 8, elapsedMs: 100, expected: 'use-prevalidated-fallback' },
  { attempted: 9, batchAttempts: 9, elapsedMs: 1, expected: 'invalid-progress' },
] as const;

const emptyKnowledge = { mapVersion: 0, knownTerrain: [], knownActiveExits: [] } as const;
const noneScope = { gameInstanceId: null, kind: 'none', revision: 0 } as const;
const practiceScope = {
  gameInstanceId: 'fixture-practice-runners',
  kind: 'practice',
  revision: 1,
} as const;
const betweenScope = { gameInstanceId: null, kind: 'none', revision: 2 } as const;
const gameScope = { gameInstanceId: 'fixture-game-round-1', kind: 'game', revision: 3 } as const;
const scopedView = (scope: GameViewScope, stateVersion: number): PrivateView => {
  const cell = scope.kind === 'practice' ? { x: 2, y: 2 } : { x: 3, y: 24 };
  return {
    ...emptyKnowledge,
    mapVersion: scope.kind === 'none' ? 0 : 1,
    knownTerrain: scope.kind === 'none' ? [] : [{ ...cell, kind: 'floor' }],
    matchId: 'fixture-match-1',
    gameScope: scope,
    stateVersion,
    self:
      scope.kind === 'none'
        ? null
        : {
            playerId: 'r1',
            role: 'runner',
            status: 'ACTIVE',
            cell,
            dir: 0,
            action: null,
            equipment: { sensor: 0, trap: 0 },
            ownedEquipment: [],
            restraintUntilTick: null,
            restraintImmuneUntilTick: null,
            installation: null,
            exchange: null,
            challenge: null,
            loading:
              scope.kind === 'game'
                ? {
                    loadId: 'fixture-load-game-1',
                    initialViewVersion: stateVersion,
                    mediaInstanceId: 'fixture-media-game-1',
                    receiverGeneration: 1,
                    assetVersion: 'fixture-assets-v1',
                  }
                : null,
          },
    visibleCells: scope.kind === 'none' ? [] : [cell],
    visibleWallFaces: [],
    visibleEntities: [],
  };
};
export const scopeTransitionViews = [
  scopedView(noneScope, 10),
  scopedView(practiceScope, 20),
  scopedView(betweenScope, 30),
  scopedView(gameScope, 40),
] as const;
export const sameScopePhaseResend = {
  previous: scopedView(gameScope, 40),
  publicTransition: { from: 'GAME_LOADING', to: 'COUNTDOWN', stateVersion: 41 },
  resent: { ...scopedView(gameScope, 40), stateVersion: 41 },
  expectedFullViewSends: 1,
  laterVersionOnly: { phase: 'COUNTDOWN', stateVersion: 42, expectedFullViewSends: 0 },
} as const;
export const scopeDeliveryCases = [
  {
    name: 'late-practice-view',
    current: gameScope,
    incoming: scopedView(practiceScope, 39),
    publicPhase: 'GAME_LOADING',
    expected: 'discard-old-scope',
  },
  {
    name: 'same-revision-different-instance',
    current: gameScope,
    incoming: scopedView({ ...gameScope, gameInstanceId: 'other-game-instance' }, 41),
    publicPhase: 'GAME_LOADING',
    expected: 'reject-and-resync',
  },
  {
    name: 'new-game-view-before-public-phase',
    current: betweenScope,
    incoming: scopedView(gameScope, 40),
    publicPhase: 'MAP_FINALIZING',
    expected: 'wait-for-phase-barrier',
  },
  {
    name: 'new-game-view-after-public-phase',
    current: betweenScope,
    incoming: scopedView(gameScope, 40),
    publicPhase: 'GAME_LOADING',
    expected: 'replace-entire-view',
  },
] as const;
export const privateViewBarrierCases = [
  {
    name: 'public-state-has-not-caught-up',
    viewVersion: 40,
    publicVersion: 39,
    transitionMinimumVersion: 40,
    lastAppliedVersion: 30,
    waitMs: 999,
    expected: 'hold-latest-one',
  },
  {
    name: 'public-state-catches-up',
    viewVersion: 40,
    publicVersion: 40,
    transitionMinimumVersion: 40,
    lastAppliedVersion: 30,
    waitMs: 999,
    expected: 'apply-after-phase-check',
  },
  {
    name: 'initial-view-is-older-than-transition',
    viewVersion: 39,
    publicVersion: 40,
    transitionMinimumVersion: 40,
    lastAppliedVersion: 30,
    waitMs: 0,
    expected: 'discard-and-resync',
  },
  {
    name: 'public-state-never-catches-up',
    viewVersion: 40,
    publicVersion: 39,
    transitionMinimumVersion: 40,
    lastAppliedVersion: 30,
    waitMs: 1000,
    expected: 'discard-and-resync',
  },
  {
    name: 'same-scope-old-state',
    viewVersion: 41,
    publicVersion: 45,
    transitionMinimumVersion: 40,
    lastAppliedVersion: 42,
    waitMs: 0,
    expected: 'discard-old-state',
  },
] as const;
export const practiceMarkerEvent = {
  matchId: 'fixture-match-1',
  gameScope: practiceScope,
  eventId: 'fixture-practice-marker',
  tick: 100,
  stateVersion: 25,
  type: 'HUNTER_MARKER',
  payload: {
    markerId: 'marker-practice',
    kind: 'sensor',
    point: { x: 2, y: 2 },
    occurredTick: 100,
    showAtTick: 100,
    expiresTick: 140,
  },
} as const satisfies PrivateEvent;
export const futureGameMarkerEvent = {
  ...practiceMarkerEvent,
  gameScope,
  eventId: 'fixture-game-marker',
  tick: 150,
  stateVersion: 40,
  payload: { ...practiceMarkerEvent.payload, occurredTick: 150, showAtTick: 150, expiresTick: 190 },
} as const satisfies PrivateEvent;
export const scopedEventCases = [
  { current: gameScope, event: practiceMarkerEvent, expected: 'discard' },
  { current: betweenScope, event: futureGameMarkerEvent, expected: 'bounded-wait' },
  { current: gameScope, event: futureGameMarkerEvent, expected: 'deliver' },
  {
    current: gameScope,
    event: {
      ...futureGameMarkerEvent,
      gameScope: { ...gameScope, gameInstanceId: 'other-game-instance' },
    },
    expected: 'reject-and-resync',
  },
] as const;
export const futureEventQueueCases = [
  { buffered: 63, ageMs: 999, expectedAfterEnqueue: 64, expected: 'wait' },
  { buffered: 64, ageMs: 999, expectedAfterEnqueue: 0, expected: 'discard-and-resync' },
  { buffered: 1, ageMs: 1000, expectedAfterEnqueue: 0, expected: 'discard-and-resync' },
] as const;

export const initializedRecovering = {
  status: 'initialized',
  readiness: {
    state: 'RECOVERING',
    reasonCodes: ['RECOVERY_PENDING'],
    historyComplete: false,
    unresolvedCount: 1,
  },
  admission: 'DRAINING',
} as const satisfies MediaInitializationResult;
export const initializedLocked = {
  status: 'initialized',
  readiness: {
    state: 'LOCKED',
    reasonCodes: ['BUDGET_UNKNOWN'],
    historyComplete: true,
    unresolvedCount: 0,
  },
  admission: 'DRAINING',
} as const satisfies MediaInitializationResult;
export const initializationFatal = {
  status: 'fatal',
  code: 'WRITER_CONFLICT',
} as const satisfies MediaInitializationResult;
export const initializationIdempotenceCase = {
  concurrentCalls: ['initialize-call-1', 'initialize-call-2'],
  expectedPromiseIdentities: ['initialization-promise-1', 'initialization-promise-1'],
  expectedWriterAcquisitions: 1,
  expectedResult: initializedRecovering,
} as const;
export const initializationListenCases = [
  { result: initializedRecovering, expectedListen: true, expectedGrantCount: 0 },
  { result: initializedLocked, expectedListen: true, expectedGrantCount: 0 },
  { result: initializationFatal, expectedListen: false, expectedGrantCount: 0 },
] as const;
const readyButDraining = {
  admission: 'DRAINING',
  readiness: 'READY',
  unresolvedCount: 0,
  remainingMinutes: 500,
  remainingBytes: 100000000,
  checkedAtEpochMs: 1000000,
} as const satisfies OperationsStatus;
export const grantAdmissionCases = [
  {
    status: { ...readyButDraining, readiness: 'RECOVERING' } satisfies OperationsStatus,
    expectedGrant: false,
  },
  {
    status: { ...readyButDraining, readiness: 'LOCKED' } satisfies OperationsStatus,
    expectedGrant: false,
  },
  { status: readyButDraining, expectedGrant: false },
  {
    status: { ...readyButDraining, admission: 'OPEN' } satisfies OperationsStatus,
    expectedGrant: true,
  },
] as const;

// These deployment stages and timing limits describe example traces, not product constants.
export const isolatedDeploymentStages = [
  'isolate',
  'drain-succeeded',
  'deploy',
  'initialize',
  'ready',
  'isolated-resume',
  'six-player-smoke',
  'cleanup',
  'publish',
] as const;
export type DeploymentFixtureStage = (typeof isolatedDeploymentStages)[number];
export type DeploymentFixtureStep = Readonly<{
  stage: DeploymentFixtureStage;
  externalRoute: 'blocked' | 'public';
  admission: 'DRAINING' | 'OPEN';
  readiness: 'RECOVERING' | 'READY';
  activeSessions: number;
  unresolvedCount: number;
}>;
export const isolatedDeploymentSuccess: readonly DeploymentFixtureStep[] = [
  {
    stage: 'isolate',
    externalRoute: 'blocked',
    admission: 'DRAINING',
    readiness: 'READY',
    activeSessions: 6,
    unresolvedCount: 0,
  },
  {
    stage: 'drain-succeeded',
    externalRoute: 'blocked',
    admission: 'DRAINING',
    readiness: 'READY',
    activeSessions: 0,
    unresolvedCount: 0,
  },
  {
    stage: 'deploy',
    externalRoute: 'blocked',
    admission: 'DRAINING',
    readiness: 'RECOVERING',
    activeSessions: 0,
    unresolvedCount: 0,
  },
  {
    stage: 'initialize',
    externalRoute: 'blocked',
    admission: 'DRAINING',
    readiness: 'RECOVERING',
    activeSessions: 0,
    unresolvedCount: 1,
  },
  {
    stage: 'ready',
    externalRoute: 'blocked',
    admission: 'DRAINING',
    readiness: 'READY',
    activeSessions: 0,
    unresolvedCount: 0,
  },
  {
    stage: 'isolated-resume',
    externalRoute: 'blocked',
    admission: 'OPEN',
    readiness: 'READY',
    activeSessions: 0,
    unresolvedCount: 0,
  },
  {
    stage: 'six-player-smoke',
    externalRoute: 'blocked',
    admission: 'OPEN',
    readiness: 'READY',
    activeSessions: 6,
    unresolvedCount: 0,
  },
  {
    stage: 'cleanup',
    externalRoute: 'blocked',
    admission: 'OPEN',
    readiness: 'READY',
    activeSessions: 0,
    unresolvedCount: 0,
  },
  {
    stage: 'publish',
    externalRoute: 'public',
    admission: 'OPEN',
    readiness: 'READY',
    activeSessions: 0,
    unresolvedCount: 0,
  },
];
export const isolatedDeploymentFailures = isolatedDeploymentStages.map((failedStage) => ({
  failedStage,
  expectedExternalRoute: 'blocked' as const,
  expectedPublishCompleted: false,
  // Failure must finish or abort by this synthetic fixture deadline; it must not poll forever.
  fixtureDeadlineMs: 10000,
  elapsedMs: 10000,
  expected: 'abort-and-keep-isolation' as const,
}));
export const invalidDeploymentOrders = [
  {
    name: 'smoke-before-isolated-resume',
    stages: [
      'isolate',
      'drain-succeeded',
      'deploy',
      'initialize',
      'ready',
      'six-player-smoke',
      'isolated-resume',
      'cleanup',
      'publish',
    ],
  },
  {
    name: 'publish-before-cleanup',
    stages: [
      'isolate',
      'drain-succeeded',
      'deploy',
      'initialize',
      'ready',
      'isolated-resume',
      'six-player-smoke',
      'publish',
      'cleanup',
    ],
  },
  {
    name: 'missing-initialize',
    stages: [
      'isolate',
      'drain-succeeded',
      'deploy',
      'ready',
      'isolated-resume',
      'six-player-smoke',
      'cleanup',
      'publish',
    ],
  },
] as const;
export const rollbackDeploymentOrder = [
  're-isolate',
  're-drain-succeeded',
  'cleanup-zero-activity-and-unresolved',
  'deploy-previous-image',
  'initialize',
  'ready',
  'isolated-resume',
  'six-player-smoke',
  'cleanup',
  'publish',
] as const;
