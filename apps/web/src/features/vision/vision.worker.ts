/// <reference lib="webworker" />
// D-02 / IN-02. 전용 비전 Worker. 고정 로컬 자산만 읽고 프레임마다 요청한 모델만 실행한다.
// main이 준 frameId/sampledAtMs를 그대로 돌려주고 Worker 시계를 섞지 않는다.
import {
  FilesetResolver,
  FaceLandmarker,
  GestureRecognizer,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';

import { readFaceSensor } from './face-sensor';
import { readGestureSensor } from './gesture-sensor';
import { readPoseSensor } from './pose-sensor';
import type {
  FrameOutcomes,
  ModelPaths,
  VisionModelKind,
  WorkerRequest,
  WorkerResponse,
} from './worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

type Models = {
  face: FaceLandmarker | null;
  pose: PoseLandmarker | null;
  gesture: GestureRecognizer | null;
};

const models: Models = { face: null, pose: null, gesture: null };
let runtimeGeneration = 0;
let closing = false;

const post = (message: WorkerResponse) => {
  if (closing && message.type !== 'closed') return;
  self.postMessage(message);
};

function closeModels(): void {
  for (const kind of ['face', 'pose', 'gesture'] as const) {
    const model = models[kind];
    models[kind] = null;
    try {
      model?.close();
    } catch {
      // 이미 닫힌 모델은 무시한다.
    }
  }
}

async function loadModels(paths: ModelPaths): Promise<readonly VisionModelKind[]> {
  const fileset = await FilesetResolver.forVisionTasks(paths.wasmBasePath);
  const face = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: paths.face },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });
  const pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: paths.pose },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  const gesture = await GestureRecognizer.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: paths.gesture },
    runningMode: 'VIDEO',
    numHands: 2,
  });
  // 로딩 중 종료 요청이 왔으면 만들어진 모델을 즉시 닫고 준비하지 않는다.
  if (closing) {
    face.close();
    pose.close();
    gesture.close();
    return [];
  }
  models.face = face;
  models.pose = pose;
  models.gesture = gesture;
  return ['face', 'pose', 'gesture'];
}

function runFrame(
  bitmap: ImageBitmap,
  sampledAtMs: number,
  requested: readonly VisionModelKind[],
): FrameOutcomes {
  const outcomes: {
    face?: FrameOutcomes['face'];
    pose?: FrameOutcomes['pose'];
    gesture?: FrameOutcomes['gesture'];
  } = {};
  if (requested.includes('face') && models.face)
    outcomes.face = readFaceSensor(models.face.detectForVideo(bitmap, sampledAtMs));
  if (requested.includes('pose') && models.pose)
    outcomes.pose = readPoseSensor(models.pose.detectForVideo(bitmap, sampledAtMs));
  if (requested.includes('gesture') && models.gesture)
    outcomes.gesture = readGestureSensor(models.gesture.recognizeForVideo(bitmap, sampledAtMs));
  return outcomes;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'close') {
    closing = true;
    closeModels();
    post({ type: 'closed', runtimeGeneration });
    self.close();
    return;
  }
  if (message.type === 'init') {
    runtimeGeneration = message.runtimeGeneration;
    void loadModels(message.paths)
      .then((loaded) => {
        if (loaded.length === 0) return;
        post({ type: 'ready', runtimeGeneration, loaded });
      })
      .catch(() => {
        closeModels();
        // 로딩 실패는 한 번 보고하고 무한 재시도하지 않는다.
        post({ type: 'error', runtimeGeneration, frameId: null, code: 'MODEL_LOAD_FAILED' });
      });
    return;
  }
  if (message.type !== 'frame') {
    post({ type: 'error', runtimeGeneration, frameId: null, code: 'PROTOCOL_ERROR' });
    return;
  }

  const { bitmap, frameId, sampledAtMs, models: requested } = message;
  try {
    if (closing || message.runtimeGeneration !== runtimeGeneration) {
      post({ type: 'error', runtimeGeneration, frameId, code: 'DISPOSED' });
      return;
    }
    const outcomes = runFrame(bitmap, sampledAtMs, requested);
    post({ type: 'result', runtimeGeneration, frameId, sampledAtMs, outcomes });
  } catch {
    post({ type: 'error', runtimeGeneration, frameId, code: 'INFERENCE_FAILED' });
  } finally {
    // 정상·예외·폐기 어느 경로에서도 bitmap을 반드시 닫는다.
    bitmap.close();
  }
};

self.onerror = () => {
  post({ type: 'error', runtimeGeneration, frameId: null, code: 'INFERENCE_FAILED' });
};
