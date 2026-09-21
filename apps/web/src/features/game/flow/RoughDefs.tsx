// S15P21C204-295. 화면 전체가 쓰는 "닳은 선" 필터. 자로 그은 1px 선 대신 난류로 흔들고 살짝
// 번지게 해서 오래된 인쇄처럼 보이게 한다. 앱에 한 번만 두고 CSS 가 filter: url(#…) 로 부른다.
// 규칙은 docs/design/ui-system.md 에 있다.
export function RoughDefs() {
  return (
    <svg className="rough-defs" aria-hidden="true" focusable="false">
      <filter id="rough-line" x="-5%" y="-400%" width="110%" height="900%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.014 0.9"
          numOctaves="3"
          seed="7"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="2.6"
          xChannelSelector="R"
          yChannelSelector="G"
          result="rough"
        />
        <feGaussianBlur in="rough" stdDeviation="0.45" />
      </filter>
      <filter id="rough-line-v" x="-400%" y="-5%" width="900%" height="110%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9 0.014"
          numOctaves="3"
          seed="3"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="2.6"
          xChannelSelector="R"
          yChannelSelector="G"
          result="rough"
        />
        <feGaussianBlur in="rough" stdDeviation="0.45" />
      </filter>
      <filter id="rough-box" x="-4%" y="-4%" width="108%" height="108%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.016"
          numOctaves="3"
          seed="11"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="3"
          xChannelSelector="R"
          yChannelSelector="G"
          result="rough"
        />
        <feGaussianBlur in="rough" stdDeviation="0.6" />
      </filter>
    </svg>
  );
}
