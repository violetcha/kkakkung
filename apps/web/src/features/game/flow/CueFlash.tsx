import { useEffect, useState } from 'react';
import type { FlashCue } from './match-cues';

/** 플래시 한 번의 길이. CSS 애니메이션과 같은 값이며 끝나면 DOM 에서 지운다. */
export const CUE_FLASH_MS = 900;

export const CUE_FLASH_LABEL: Record<FlashCue, string> = {
  captured: '포획되었습니다',
  escaped: '탈출했습니다',
  'exit-failed': '탈출에 실패했습니다',
  restrained: '덫에 걸렸습니다',
  victory: '승리',
  defeat: '패배',
};

/**
 * S15P21C204-261. 결정적 순간의 전면 플래시. 결과 화면으로 넘어가도 잠깐 겹쳐 보이도록 셸
 * 최상위에서 그린다. 색만으로 전달하지 않도록 문구를 함께 넣고, 움직임 축소 설정에서는
 * 애니메이션 없이 문구만 잠깐 보인다(styles.css).
 */
export function CueFlash({
  flash,
  durationMs = CUE_FLASH_MS,
}: {
  flash: { kind: FlashCue; id: number } | null | undefined;
  durationMs?: number;
}) {
  const [shownId, setShownId] = useState<number | null>(flash?.id ?? null);
  useEffect(() => {
    if (!flash) return;
    setShownId(flash.id);
    const timer = window.setTimeout(
      () => setShownId((id) => (id === flash.id ? null : id)),
      durationMs,
    );
    return () => window.clearTimeout(timer);
  }, [flash, durationMs]);
  if (!flash || shownId !== flash.id) return null;
  return (
    <div key={flash.id} className="cue-flash" data-cue={flash.kind} role="status">
      <span>{CUE_FLASH_LABEL[flash.kind]}</span>
    </div>
  );
}
