import { Buffer } from 'node:buffer';
import {
  AnimationClip,
  Box3,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
} from '../../apps/web/node_modules/three/build/three.module.js';
import { GLTFExporter } from '../../apps/web/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from '../../apps/web/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob) {
    void blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;
      this.onloadend?.();
    });
  }
}

if (typeof globalThis.FileReader === 'undefined') globalThis.FileReader = NodeFileReader;

const materials = (role) => {
  const runner = role === 'runner';
  const body = new MeshStandardMaterial({
    name: 'BodyMaterial',
    color: runner ? '#ded7c6' : '#2b2623',
    roughness: 0.94,
    flatShading: true,
  });
  const skin = new MeshStandardMaterial({
    name: 'SkinMaterial',
    color: runner ? '#8b8172' : '#74695f',
    roughness: 0.9,
    flatShading: true,
  });
  const mouth = new MeshStandardMaterial({
    name: 'MouthMaterial',
    color: '#120e0d',
    roughness: 1,
    flatShading: true,
  });
  const teeth = new MeshStandardMaterial({
    name: 'TeethMaterial',
    color: '#c9bea0',
    roughness: 0.82,
    flatShading: true,
  });
  return { body, skin, mouth, teeth };
};

function namedGroup(name, parent, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const group = new Group();
  group.name = name;
  group.position.fromArray(position);
  group.rotation.set(...rotation);
  parent.add(group);
  return group;
}

function namedMesh(name, geometry, material, parent, position, scale, rotation = [0, 0, 0]) {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.fromArray(position);
  mesh.scale.fromArray(scale);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function rig() {
  const root = namedGroup('AvatarRoot', new Group());
  const skeleton = namedGroup('Rig', root);
  const hip = namedGroup('Hip', skeleton, [0, 0.38, 0]);
  const spine = namedGroup('Spine', hip, [0, 0.25, 0]);
  const head = namedGroup('Head', spine, [0, 0.31, 0]);
  const upperArmL = namedGroup('UpperArm.L', spine, [-0.22, 0.21, 0]);
  const upperArmR = namedGroup('UpperArm.R', spine, [0.22, 0.21, 0]);
  const handL = namedGroup('Hand.L', upperArmL, [0, -0.43, 0]);
  const handR = namedGroup('Hand.R', upperArmR, [0, -0.43, 0]);
  const thighL = namedGroup('Thigh.L', hip, [-0.1, -0.02, 0]);
  const thighR = namedGroup('Thigh.R', hip, [0.1, -0.02, 0]);
  return { root, hip, spine, head, upperArmL, upperArmR, handL, handR, thighL, thighR };
}

function q(x, y = 0, z = 0) {
  const quaternion = new Quaternion().setFromEuler(new Euler(x, y, z));
  return quaternion.toArray();
}

function track(name, values) {
  return new QuaternionKeyframeTrack(`${name}.quaternion`, [0, 0.5, 1], values.flat());
}

function clips(role) {
  const crouch = role === 'tagger' ? 0.26 : 0.025;
  const idle = new AnimationClip('idle', 1, [
    track('Spine', [q(crouch), q(crouch + 0.025), q(crouch)]),
    track('Head', [q(0), q(-0.018), q(0)]),
  ]);
  const arm = role === 'tagger' ? 0.27 : 0.48;
  const leg = role === 'tagger' ? 0.33 : 0.52;
  const walk = new AnimationClip('walk', 1, [
    track('UpperArm.L', [q(-arm), q(arm), q(-arm)]),
    track('UpperArm.R', [q(arm), q(-arm), q(arm)]),
    track('Thigh.L', [q(leg), q(-leg), q(leg)]),
    track('Thigh.R', [q(-leg), q(leg), q(-leg)]),
  ]);
  return [idle, walk];
}

function runnerModel() {
  const bones = rig();
  const material = materials('runner');
  namedMesh(
    'RobeHem',
    new CylinderGeometry(0.31, 0.43, 0.62, 7, 2, false),
    material.body,
    bones.hip,
    [0, 0.02, 0.015],
    [1, 1, 0.78],
    [0.02, 0.08, -0.025],
  );
  namedMesh(
    'ShoulderCape',
    new ConeGeometry(0.36, 0.26, 8, 1, true),
    material.body,
    bones.spine,
    [0, 0.16, 0],
    [1, 1, 0.82],
    [0, 0.08, 0],
  );
  namedMesh(
    'Hood',
    new IcosahedronGeometry(0.27, 1),
    material.body,
    bones.head,
    [0, 0.02, 0.01],
    [0.92, 1.12, 0.88],
  );
  namedMesh(
    'DollFace',
    new CircleGeometry(0.145, 10),
    material.skin,
    bones.head,
    [0, 0, -0.235],
    [1, 1.18, 1],
    [0, Math.PI, 0],
  );
  namedGroup('FaceSocket', bones.head, [0, 0, -0.247], [0, Math.PI, 0]);
  for (const [side, arm] of [
    [-1, bones.upperArmL],
    [1, bones.upperArmR],
  ])
    namedMesh(
      side < 0 ? 'Sleeve.L' : 'Sleeve.R',
      new ConeGeometry(0.085, 0.34, 6),
      material.body,
      arm,
      [0, -0.19, 0],
      [1, 1, 1],
      [0, 0, side * -0.08],
    );
  for (const [side, leg] of [
    [-1, bones.thighL],
    [1, bones.thighR],
  ])
    namedMesh(
      side < 0 ? 'Foot.L' : 'Foot.R',
      new BoxGeometry(0.13, 0.1, 0.21),
      material.skin,
      leg,
      [0, -0.28, -0.035],
      [1, 1, 1],
    );
  return { scene: bones.root, animations: clips('runner'), armLength: 0.29 };
}

function taggerArmGeometry(side) {
  const parts = [];
  const arm = new ConeGeometry(0.075, 0.76, 6);
  arm.translate(0, -0.35, 0);
  parts.push(arm);
  for (let finger = 1; finger <= 3; finger += 1) {
    const offset = finger - 2;
    const claw = new ConeGeometry(0.022, 0.19 - Math.abs(offset) * 0.02, 5);
    claw.rotateZ(offset * -0.12 * side);
    claw.translate(offset * 0.045, -0.81 - Math.abs(offset) * 0.012, -0.025);
    parts.push(claw);
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('AVATAR_ARM_MERGE_FAILED');
  return merged;
}

function taggerModel() {
  const bones = rig();
  bones.hip.position.y = 0.48;
  bones.spine.position.y = 0.3;
  bones.spine.rotation.x = 0.26;
  bones.head.position.set(0, 0.37, -0.05);
  bones.upperArmL.position.set(-0.28, 0.24, 0);
  bones.upperArmR.position.set(0.28, 0.24, 0);
  bones.handL.position.y = -0.68;
  bones.handR.position.y = -0.68;
  const material = materials('tagger');
  namedMesh(
    'TornBackCloth',
    new ConeGeometry(0.41, 0.64, 7, 2, true),
    material.body,
    bones.spine,
    [0, -0.06, 0.06],
    [1.06, 1, 0.72],
    [0.12, 0.07, 0],
  );
  namedMesh(
    'WrappedHead',
    new IcosahedronGeometry(0.29, 1),
    material.skin,
    bones.head,
    [0, 0, 0],
    [0.82, 1.18, 0.88],
  );
  for (const [side, arm, hand] of [
    [-1, bones.upperArmL, bones.handL],
    [1, bones.upperArmR, bones.handR],
  ]) {
    namedMesh(
      side < 0 ? 'LongArm.L' : 'LongArm.R',
      taggerArmGeometry(side),
      material.skin,
      arm,
      [0, 0, 0],
      [1, 1, 0.9],
      [0.04, 0, side * -0.07],
    );
    for (let finger = 1; finger <= 3; finger += 1)
      namedGroup(
        `Finger.${side < 0 ? 'L' : 'R'}.${finger}`,
        hand,
        [(finger - 2) * 0.045, -0.08 - Math.abs(finger - 2) * 0.015, -0.02],
        [0.12, 0, (finger - 2) * -0.08],
      );
  }
  for (const [side, leg] of [
    [-1, bones.thighL],
    [1, bones.thighR],
  ])
    namedMesh(
      side < 0 ? 'LongLeg.L' : 'LongLeg.R',
      new ConeGeometry(0.095, 0.62, 6),
      material.skin,
      leg,
      [0, -0.31, 0],
      [1, 1, 1],
    );
  namedMesh(
    'Mouth',
    new BoxGeometry(0.31, 0.09, 0.025),
    material.mouth,
    bones.head,
    [0, -0.055, -0.255],
    [1, 1, 1],
  );
  namedGroup('Teeth.Upper', bones.head, [0, -0.025, -0.276]);
  namedGroup('Teeth.Lower', bones.head, [0, -0.087, -0.276]);
  const toothGeometries = [];
  for (const row of [-1, 1])
    for (let column = -3; column <= 3; column += 1) {
      const tooth = new ConeGeometry(0.014, 0.055, 4);
      if (row < 0) tooth.rotateZ(Math.PI);
      tooth.translate(column * 0.037, row * 0.03, 0);
      toothGeometries.push(tooth);
    }
  const teeth = mergeGeometries(toothGeometries, false);
  if (!teeth) throw new Error('AVATAR_TEETH_MERGE_FAILED');
  namedMesh('TeethMesh', teeth, material.teeth, bones.head, [0, -0.055, -0.276], [1, 1, 1]);
  return { scene: bones.root, animations: clips('tagger'), armLength: 0.72 };
}

function metrics(scene, armLength) {
  let triangles = 0;
  const materialsFound = new Set();
  let drawCalls = 0;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    drawCalls += 1;
    materialsFound.add(object.material.name);
    const geometry = object.geometry;
    triangles += geometry.index
      ? geometry.index.count / 3
      : geometry.getAttribute('position').count / 3;
  });
  const bounds = new Box3().setFromObject(scene);
  const size = bounds.getSize(new Vector3());
  return {
    triangles: Math.round(triangles),
    materials: materialsFound.size,
    drawCalls,
    height: Number(size.y.toFixed(3)),
    armLength,
  };
}

export async function buildAvatarGlb(role) {
  const model = role === 'runner' ? runnerModel() : role === 'tagger' ? taggerModel() : null;
  if (!model) throw new Error('AVATAR_ROLE_INVALID');
  model.scene.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const output = await exporter.parseAsync(model.scene, {
    binary: true,
    animations: model.animations,
    onlyVisible: true,
    truncateDrawRange: true,
  });
  if (!(output instanceof ArrayBuffer)) throw new Error('AVATAR_GLB_EXPORT_FAILED');
  return { bytes: Buffer.from(output), metrics: metrics(model.scene, model.armLength) };
}
