// S15P21C204-295. 술래의 화면 테두리. 도망자는 캠코더로 세상을 보지만 술래는 장비만 들고 본다.
// 가장자리에서 실핏줄이 안쪽으로 뻗어 들어와, 무언가가 화면 밖에서 들여다보는 느낌을 남긴다.
//
// 난류(feTurbulence)만으로는 핏자국 얼룩이 된다. 핏줄은 "선"이라 실제로 가지를 치는 경로를 그리고,
// 그 위에 변위 필터를 씌워 자로 그은 티를 지운다. 경로는 고정 씨앗으로 한 번만 만들어 매번 같다.
// 장면의 질감이라 판정·입력과 무관하며, 동작 줄이기 설정에서는 숨결이 멈춘다.

type Vessel = Readonly<{ d: string; width: number }>;

/** 고정 씨앗 난수. 화면을 다시 그려도 핏줄 모양이 바뀌지 않는다. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 한 줄기를 뻗으면서 가지를 친다. 가지는 더 짧고 가늘다. */
function grow(
  rand: () => number,
  start: { x: number; y: number; angle: number },
  length: number,
  width: number,
  depth: number,
  out: Vessel[],
) {
  let { x, y, angle } = start;
  let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
  const steps = 4;
  for (let step = 0; step < steps; step += 1) {
    angle += (rand() - 0.5) * 0.55;
    const span = length / steps;
    const cx = x + Math.cos(angle + (rand() - 0.5) * 0.8) * span * 0.55;
    const cy = y + Math.sin(angle + (rand() - 0.5) * 0.8) * span * 0.55;
    x += Math.cos(angle) * span;
    y += Math.sin(angle) * span;
    d += ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    if (depth > 0 && step > 0 && rand() < 0.62)
      grow(
        rand,
        { x, y, angle: angle + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.6) },
        length * (0.42 + rand() * 0.2),
        width * 0.55,
        depth - 1,
        out,
      );
  }
  out.push({ d, width });
}

/** 100x100 좌표계의 네 변에서 안쪽으로 자란다. 가운데 절반은 비워 시야를 가리지 않는다. */
function vessels(): readonly Vessel[] {
  const rand = seeded(20260921);
  const out: Vessel[] = [];
  const edges = [
    { count: 17, at: (t: number) => ({ x: t * 100, y: -1, angle: Math.PI / 2 }) },
    { count: 17, at: (t: number) => ({ x: t * 100, y: 101, angle: -Math.PI / 2 }) },
    { count: 12, at: (t: number) => ({ x: -1, y: t * 100, angle: 0 }) },
    { count: 12, at: (t: number) => ({ x: 101, y: t * 100, angle: Math.PI }) },
  ];
  for (const edge of edges)
    for (let i = 0; i < edge.count; i += 1) {
      const seat = edge.at((i + 0.5 + (rand() - 0.5) * 0.7) / edge.count);
      grow(
        rand,
        { ...seat, angle: seat.angle + (rand() - 0.5) * 0.9 },
        18 + rand() * 15,
        2.1 + rand() * 1.9,
        2,
        out,
      );
    }
  return out;
}

const VESSELS = vessels();

export function TaggerVeins() {
  return (
    <div className="vein-frame" aria-hidden="true">
      <svg
        className="vein-lines"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        focusable="false"
      >
        <filter id="vein-warp" x="-10%" y="-10%" width="120%" height="120%">
          {/* 경로를 흔들어 손으로 그은 선처럼 만든다. 번짐은 아주 조금만. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03"
            numOctaves="3"
            seed="41"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="2.4"
            xChannelSelector="R"
            yChannelSelector="G"
            result="bent"
          />
          <feGaussianBlur in="bent" stdDeviation="0.25" />
        </filter>
        {/* 두 겹: 번진 어두운 피와 그 위의 또렷한 줄. 겹쳐야 살 밑의 핏줄로 보인다. */}
        <g className="vein-bleed" filter="url(#vein-warp)">
          {VESSELS.map((vessel) => (
            <path key={vessel.d} d={vessel.d} strokeWidth={vessel.width * 2.4} />
          ))}
        </g>
        <g className="vein-core" filter="url(#vein-warp)">
          {VESSELS.map((vessel) => (
            <path key={vessel.d} d={vessel.d} strokeWidth={vessel.width} />
          ))}
        </g>
      </svg>
      <span className="vein-glow" />
    </div>
  );
}
