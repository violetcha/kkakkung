/**
 * S15P21C204-260. The puppet stand-in face is drawn here, not shipped as an image, so the demo
 * adds no third-party asset. The drawing itself is checked by the calls it makes.
 */
import { expect, it, vi } from 'vitest';
import { drawDemoFace } from './demo-face';

function fakeCanvas() {
  const calls: string[] = [];
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    fillRect: vi.fn(() => calls.push('fillRect')),
    beginPath: vi.fn(),
    ellipse: vi.fn(() => calls.push('ellipse')),
    arc: vi.fn(() => calls.push('arc')),
    fill: vi.fn(),
    stroke: vi.fn(() => calls.push('stroke')),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, context, calls };
}

it('draws a face at the published face size without loading an image', () => {
  const { canvas, context, calls } = fakeCanvas();
  expect(drawDemoFace(canvas)).toBe(canvas);
  expect([canvas.width, canvas.height]).toEqual([160, 160]);
  // Background, head and two eyes are ellipses/rects; the mouth is the single arc.
  expect(calls.filter((call) => call === 'ellipse')).toHaveLength(3);
  expect(calls).toContain('fillRect');
  expect(calls).toContain('arc');
  expect(context.fill).toHaveBeenCalled();
});

it('leaves the canvas alone when the page has no 2d context', () => {
  const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
  expect(() => drawDemoFace(canvas)).not.toThrow();
});
