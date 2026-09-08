import type {
  CommandPayloads,
  VisibleEntity,
  RequestStatusResult,
  MediaBinding,
  SensorSnapshot,
  GestureSensor,
  LayoutSelectionInput,
  LayoutTemplate,
  FallbackLayout,
  PrivateView,
  PrivateEvent,
  CreateMatchInput,
  MediaInitializationResult,
  MediaCoordinator,
  MapTemplateResult,
  MapVariantsResult,
  PracticeLayoutResult,
  MapPreparationPort,
  PracticeLayoutPort,
  MediaConfiguration,
  MediaCoordinatorDeps,
  MetricSample,
  InvitationIssueResult,
  IssueInvitation,
  CreateOperatorAuth,
} from './types.ts';
import {
  layoutSelectionFixture,
  mapTemplateFixture,
  scopeTransitionViews,
  practiceMarkerEvent,
  initializedRecovering,
  unconfiguredMediaFixture,
} from './fixtures.ts';

// Negative type fixtures must fail. If a contract weakens, tsc reports an unused expect-error.
// @ts-expect-error Undecided runner items have no product command.
type UndecidedItemCommand = CommandPayloads['USE_ITEM'];

// @ts-expect-error A visible sensor needs its observed wall face.
const sensorWithoutWall: VisibleEntity = {
  id: 's',
  kind: 'sensor',
  cell: { x: 1, y: 1 },
  state: 'ARMED',
};

// @ts-expect-error A terminal request lookup must contain the actual outcome.
const doneWithoutOutcome: RequestStatusResult = {
  matchId: 'm',
  requestId: 'r',
  status: 'done',
  outcome: null,
};

// @ts-expect-error Each publisher has its own generation.
const unversionedPublisher: MediaBinding = {
  playerId: 'p',
  mediaIdentity: 'i',
  participantSid: 's',
};

const unstampedPose: SensorSnapshot = {
  runtimeGeneration: 1,
  emittedAtMs: 100,
  face: null,
  gesture: null,
  // @ts-expect-error Bundle timestamps cannot replace individual sample timestamps.
  pose: { status: 'valid', data: { landmarks: [], quality: 'valid' } },
};

const multipleGestureOutputs: GestureSensor = {
  kind: 'none',
  score: 0,
  // @ts-expect-error Multi-hand candidate arrays are not this contract.
  candidates: ['palm', 'victory'],
};

const legacyFlatMapInput: LayoutSelectionInput = {
  ...layoutSelectionFixture,
  // @ts-expect-error Spawns belong to a role's region, not a shared flat input list.
  spawnCandidates: [{ x: 3, y: 4 }],
};

const onlyTwoTaggerRegions: LayoutTemplate = {
  ...mapTemplateFixture,
  // @ts-expect-error The map contract requires exactly three tagger regions.
  taggerRegions: [mapTemplateFixture.taggerRegions[0], mapTemplateFixture.taggerRegions[1]],
};

// @ts-expect-error A fallback must carry the source identity, version, hash and variant.
const fallbackWithoutSource: FallbackLayout = { layout: layoutSelectionFixture.fallback.layout };

const { gameScope: omittedScope, ...viewWithoutScope } = scopeTransitionViews[0];
// @ts-expect-error Match ID alone cannot separate practice and main-game private views.
const unscopedPrivateView: PrivateView = viewWithoutScope;

const eventInInactiveScope: PrivateEvent = {
  ...practiceMarkerEvent,
  // @ts-expect-error Private events require an active instance, never the 'none' scope.
  gameScope: { gameInstanceId: null, kind: 'none', revision: 2 },
};

// @ts-expect-error Core creation requires an explicit game instance identity.
const matchWithoutInstance: Pick<CreateMatchInput, 'gameInstanceId'> = {};

const initializedAlreadyReady: MediaInitializationResult = {
  status: 'initialized',
  // @ts-expect-error Initialization exposes HTTP while RECOVERING/LOCKED, not automatic READY.
  readiness: { ...initializedRecovering.readiness, state: 'READY' },
  admission: 'DRAINING',
};

const initializedAlreadyOpen: MediaInitializationResult = {
  ...initializedRecovering,
  // @ts-expect-error Initialization cannot reopen admission before an explicit resume.
  admission: 'OPEN',
};

// @ts-expect-error A coordinator must provide the explicit initialization lifecycle method.
const coordinatorWithoutInitialize: Pick<MediaCoordinator, 'initialize'> = {};

// @ts-expect-error Initialization is asynchronous, allowing one shared pending operation.
const synchronousInitialize: MediaCoordinator['initialize'] = () => initializedRecovering;

void (null as UndecidedItemCommand);
void sensorWithoutWall;
void doneWithoutOutcome;
void unversionedPublisher;
void unstampedPose;
void multipleGestureOutputs;
void legacyFlatMapInput;
void onlyTwoTaggerRegions;
void fallbackWithoutSource;
void omittedScope;
void unscopedPrivateView;
void eventInInactiveScope;
void matchWithoutInstance;
void initializedAlreadyReady;
void initializedAlreadyOpen;
void coordinatorWithoutInitialize;
void synchronousInitialize;

// @ts-expect-error Valid map preparation must carry the validated template.
const absentPreparedMap: MapTemplateResult = { status: 'valid' };
// @ts-expect-error Variants use an explicit validated result, not a bare optional array.
const bareVariants: MapVariantsResult = [];
// @ts-expect-error Practice failure is not a successful empty layout.
const emptyPractice: PracticeLayoutResult = { status: 'ready' };
// @ts-expect-error Public map preparation must expose both validation and transformation.
const incompleteMapPort: MapPreparationPort = {};
// @ts-expect-error Practice normalization has its own required public function.
const missingPracticePort: PracticeLayoutPort = {};
const rejectedWithSecret: InvitationIssueResult = {
  status: 'rejected',
  code: 'NOT_READY',
  // @ts-expect-error The token is returned only in a successful issued invitation result.
  invitation: { inviteToken: 'fixture' },
};
// @ts-expect-error Expiry and room/create scope are required even for operator requests.
const incompleteInvitation: IssueInvitation = { expiresAt: 1 };
const { productSecurityReady: removedSecurity, ...withoutSecurity } = unconfiguredMediaFixture;
// @ts-expect-error Security initialization must be passed explicitly by B.
const implicitSecurity: MediaConfiguration = withoutSecurity;
// @ts-expect-error Media metrics must have an actual configured callback.
const omittedMetrics: Pick<MediaCoordinatorDeps, 'emitMetric'> = {};
const unsafeMetric: MetricSample = {
  name: 'x',
  value: 1,
  unit: 'count',
  atMs: 0,
  // @ts-expect-error Arbitrary raw identity labels are not a metrics contract.
  mediaIdentity: 'private',
};
// @ts-expect-error The factory returns an authorization checker, not an authenticated constant.
const constantOperatorAuth: CreateOperatorAuth = () => true;
void absentPreparedMap;
void bareVariants;
void emptyPractice;
void incompleteMapPort;
void missingPracticePort;
void rejectedWithSecret;
void incompleteInvitation;
void removedSecurity;
void implicitSecurity;
void omittedMetrics;
void unsafeMetric;
void constantOperatorAuth;
