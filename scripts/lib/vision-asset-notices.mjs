import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const fail = () => {
  throw new Error('VISION_ASSET_NOTICES_INVALID');
};
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const evidenceUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
};
const components = {
  face: ['face_detector.tflite', 'face_landmarks_detector.tflite', 'face_blendshapes.tflite'],
  pose: ['pose_detector.tflite', 'pose_landmarks_detector.tflite'],
  gesture: [
    'hand_landmarker.task/hand_detector.tflite',
    'hand_landmarker.task/hand_landmarks_detector.tflite',
    'hand_gesture_recognizer.task/gesture_embedder.tflite',
    'hand_gesture_recognizer.task/canned_gesture_classifier.tflite',
  ],
};

/** Verifies shipped bytes and recorded review consistency; it does not grant legal rights. */
export async function verifyVisionAssetNotices(
  publicDirectory,
  { requireReviewedRights = false } = {},
) {
  const root = await realpath(publicDirectory);
  const containedFile = async (publicPath) => {
    if (
      typeof publicPath !== 'string' ||
      !/^\/(?:models|licenses)\/[A-Za-z0-9_./-]+$/.test(publicPath)
    )
      fail();
    if (
      publicPath
        .slice(1)
        .split('/')
        .some((part) => part === '..' || part === '.' || part === '')
    )
      fail();
    const path = resolve(root, '.' + publicPath);
    if (!path.startsWith(root + sep)) fail();
    const actual = await realpath(path);
    if (!actual.startsWith(root + sep)) fail();
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 64 * 1024 * 1024)
      fail();
    return path;
  };
  const manifestPath = await containedFile('/models/manifest.json');
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length > 128 * 1024) fail();
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const notices = manifest.notices;
  if (
    manifest.manifestVersion !== 1 ||
    !date(notices?.reviewedAt) ||
    !Array.isArray(notices?.files) ||
    notices.files.length !== 3
  )
    fail();
  const checked = new Set();
  const verifyFile = async (entry, publicPath = entry?.publicPath) => {
    if (
      !entry ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      checked.has(publicPath)
    )
      fail();
    const path = await containedFile(publicPath);
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== entry.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    )
      fail();
    checked.add(publicPath);
  };
  for (const entry of notices.files) await verifyFile(entry);
  for (const path of [
    '/licenses/index.html',
    '/licenses/notices.css',
    '/licenses/Apache-2.0.txt',
  ]) {
    if (!checked.has(path)) fail();
  }
  if (
    !notices.files.some(
      (entry) =>
        entry.publicPath === '/licenses/Apache-2.0.txt' &&
        entry.license === 'Apache-2.0' &&
        evidenceUrl(entry.sourceUrl),
    )
  )
    fail();
  const pendingRights = [];
  if (
    Object.keys(manifest.models ?? {})
      .sort()
      .join(',') !== 'face,gesture,pose'
  )
    fail();
  for (const kind of ['face', 'pose', 'gesture']) {
    const model = manifest.models?.[kind];
    if (
      !model ||
      !['Apache-2.0', 'pending'].includes(model.license) ||
      !date(model.licenseReviewedAt) ||
      !Array.isArray(model.licenseEvidence) ||
      model.licenseEvidence.length === 0
    )
      fail();
    for (const evidence of model.licenseEvidence) {
      if (
        typeof evidence.component !== 'string' ||
        !evidence.component ||
        !['Apache-2.0', 'pending'].includes(evidence.license) ||
        !/^[a-f0-9]{64}$/.test(evidence.sha256) ||
        !Number.isSafeInteger(evidence.bytes) ||
        evidence.bytes <= 0 ||
        !evidenceUrl(evidence.sourceUrl)
      )
        fail();
    }
    if (
      model.licenseEvidence
        .map((entry) => entry.component)
        .sort()
        .join(',') !== [...components[kind]].sort().join(',')
    )
      fail();
    const hasPending = model.licenseEvidence.some((evidence) => evidence.license === 'pending');
    if ((model.license === 'pending') !== hasPending) fail();
    if (hasPending) pendingRights.push(`model:${kind}`);
    await verifyFile(model);
  }
  const sdk = manifest.sdk;
  if (
    !sdk ||
    sdk.license !== 'Apache-2.0' ||
    !['verified', 'pending'].includes(sdk.bundledNoticesReview) ||
    !date(sdk.licenseReviewedAt) ||
    !Array.isArray(sdk.files) ||
    sdk.files.length !== 6
  )
    fail();
  if (sdk.bundledNoticesReview === 'pending') pendingRights.push('sdk:bundled-notices');
  for (const entry of sdk.files) await verifyFile(entry, sdk.wasmBasePath + '/' + entry.file);
  const result = {
    noticeFilesVerified: true,
    assetFilesVerified: 9,
    visionRightsReviewed: pendingRights.length === 0,
    pendingRights,
  };
  if (requireReviewedRights && !result.visionRightsReviewed)
    throw new Error('VISION_ASSET_RIGHTS_PENDING');
  return result;
}
