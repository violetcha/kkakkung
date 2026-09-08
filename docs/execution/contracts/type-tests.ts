import type {
  CommandPayloads,
  VisibleEntity,
  RequestStatusResult,
  MediaBinding,
  SensorSnapshot,
  GestureSensor,
} from './types.ts';

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

void (null as UndecidedItemCommand);
void sensorWithoutWall;
void doneWithoutOutcome;
void unversionedPublisher;
void unstampedPose;
void multipleGestureOutputs;
