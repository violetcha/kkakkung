import { describe, expect, it } from 'vitest';
import { Euler, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { CHARACTER, cellPosition, directionYaw, wallModel } from './scene-model';

describe('product scene coordinates', () => {
  it('keeps the cell origin and a shared head/body size for both teams', () => {
    expect(cellPosition({ x: 0, y: 31 })).toEqual([0, 0, 31]);
    expect(CHARACTER.head).toBeGreaterThan(CHARACTER.body);
  });
  it('keeps each face on the boundary of its wall cell', () => {
    expect(([0, 1, 2, 3] as const).map((side) => wallModel({ x: 4, y: 5, side }).position)).toEqual(
      [
        [4, 0.6, 4.5],
        [4.5, 0.6, 5],
        [4, 0.6, 5.5],
        [3.5, 0.6, 5],
      ],
    );
  });

  const faces = [
    { side: 0, passage: [4, 0.6, 4] },
    { side: 1, passage: [5, 0.6, 5] },
    { side: 2, passage: [4, 0.6, 6] },
    { side: 3, passage: [3, 0.6, 5] },
  ] as const;

  it.each(faces)(
    'faces the passage and culls the wall interior for side $side',
    ({ side, passage }) => {
      const model = wallModel({ x: 4, y: 5, side });
      const mesh = new Mesh(new PlaneGeometry(1, 1.2), new MeshBasicMaterial());
      mesh.position.fromArray(model.position);
      mesh.rotation.set(...model.rotation);
      mesh.updateMatrixWorld(true);
      const center = new Vector3(...model.position);
      const fromPassage = new Vector3(...passage);
      const fromInterior = new Vector3(4, 0.6, 5);
      try {
        const frontRay = new Raycaster(fromPassage, center.clone().sub(fromPassage).normalize());
        const backRay = new Raycaster(fromInterior, center.clone().sub(fromInterior).normalize());
        expect(frontRay.intersectObject(mesh).length).toBeGreaterThan(0);
        expect(backRay.intersectObject(mesh)).toHaveLength(0);
      } finally {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  );

  it.each(faces)(
    'points exit offsets and local +Z attachments into passage $side',
    ({ side, passage }) => {
      const model = wallModel({ x: 4, y: 5, side });
      const outward = new Vector3(...passage).sub(new Vector3(...model.position)).normalize();
      const attachmentNormal = new Vector3(0, 0, 1).applyEuler(new Euler(...model.rotation));
      expect(new Vector3(...model.normal).distanceTo(outward)).toBeCloseTo(0);
      expect(attachmentNormal.distanceTo(outward)).toBeCloseTo(0);
      // Camera forward is local -Z; changing walls must not reverse player headings.
      const cameraForward = new Vector3(0, 0, -1).applyEuler(new Euler(0, directionYaw(side), 0));
      expect(cameraForward.distanceTo(outward)).toBeCloseTo(0);
    },
  );
});
