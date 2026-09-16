import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * S15P21C204-260. A drawn stand-in face for demo puppets, which have no camera. It is generated
 * here rather than shipped as an image so no third-party asset enters the bundle, and it is only
 * used in a demo room: an ordinary participant without a face track still shows the plain head.
 */
export function drawDemoFace(canvas: HTMLCanvasElement): HTMLCanvasElement {
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  // The published face is masked greyscale, so the stand-in keeps the same range.
  context.fillStyle = '#20211f';
  context.fillRect(0, 0, 160, 160);
  context.fillStyle = '#b9bfba';
  context.beginPath();
  context.ellipse(80, 84, 46, 58, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#2b2d2b';
  for (const x of [62, 98]) {
    context.beginPath();
    context.ellipse(x, 74, 7, 9, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = '#2b2d2b';
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.beginPath();
  context.arc(80, 96, 22, 0.25 * Math.PI, 0.75 * Math.PI);
  context.stroke();
  return canvas;
}

export function createDemoFaceTexture(): CanvasTexture {
  const texture = new CanvasTexture(drawDemoFace(document.createElement('canvas')));
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
