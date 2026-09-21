// S15P21C204-295. 캠코더 화면의 잡음. 저해상도 캔버스를 매 프레임 난수로 채우고, 아래로 흐르는
// 트래킹 띠와 이따금 끊기는 가로줄을 얹는다. 판정·게시와 무관한 화면 질감이며, 동작 줄이기
// 설정에서는 한 장만 그리고 멈춘다.
import { useEffect, useRef } from 'react';

/** 실제 캠코더 잡음처럼 보이는 최소 해상도. 이보다 크면 알갱이가 곱게 보여 디지털 노이즈가 된다. */
const WIDTH = 168;
const HEIGHT = 126;
/** 22fps. 60fps 로 그리면 잡음이 뭉개져 회색 막처럼 보인다. */
const FRAME_MS = 1000 / 22;
const BAND_HEIGHT = 14;

type Noise = { band: number; glitchUntil: number };

function paint(image: ImageData, state: Noise, now: number) {
  // 리틀엔디언 기준 0xAABBGGRR. 회색이라 RGB 순서는 무관하고 알파 위치만 쓴다.
  const pixels = new Uint32Array(image.data.buffer);
  const glitch = now < state.glitchUntil ? 1.7 : 1;
  for (let y = 0; y < HEIGHT; y += 1) {
    const distance = Math.abs(y - state.band);
    // 트래킹 띠는 가운데가 가장 거칠고 위아래로 잦아든다.
    const band = distance < BAND_HEIGHT ? 1 + (1 - distance / BAND_HEIGHT) * 1.1 : 1;
    // 이따금 한 줄이 통째로 날아간다(드롭아웃). 밝게 튀거나 까맣게 죽는다.
    const dropout = Math.random() < 0.0035 ? (Math.random() < 0.5 ? 1.9 : 0) : 1;
    const strength = 0.24 * band * glitch * dropout;
    const row = y * WIDTH;
    for (let x = 0; x < WIDTH; x += 1) {
      const value = (Math.random() * 255) | 0;
      const alpha = Math.min(255, value * strength) | 0;
      pixels[row + x] = (alpha << 24) | (value << 16) | (value << 8) | value;
    }
  }
}

export function StaticNoise() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const image = context.createImageData(WIDTH, HEIGHT);
    const state: Noise = { band: HEIGHT, glitchUntil: 0 };
    const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
    paint(image, state, now());
    context.putImageData(image, 0, 0);
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof requestAnimationFrame !== 'function') return;
    let frame = 0;
    let last = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const time = now();
      if (time - last < FRAME_MS) return;
      last = time;
      // 띠는 아래에서 위로 천천히 흐르고, 가끔 화면 전체가 크게 튄다.
      state.band -= 0.9;
      if (state.band < -BAND_HEIGHT) state.band = HEIGHT + BAND_HEIGHT;
      if (time > state.glitchUntil && Math.random() < 0.008) state.glitchUntil = time + 110;
      paint(image, state, time);
      context.putImageData(image, 0, 0);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={ref} className="static-noise" aria-hidden="true" />;
}
