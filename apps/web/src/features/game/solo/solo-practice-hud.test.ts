import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createSoloWorld } from './solo-world';
import { SoloPracticeHud } from './SoloPracticeHud';

describe('SoloPracticeHud', () => {
  it('shows the same recording, five-slot, crosshair and map HUD used during a match', () => {
    const snapshot = createSoloWorld(() => 2_000).snapshot;
    const html = renderToStaticMarkup(
      createElement(SoloPracticeHud, {
        view: snapshot.view,
        tick: snapshot.tick,
        selected: 'sensor',
        startedAtMs: 1_000,
        nowMs: 5_000,
      }),
    );

    expect(html).toContain('aria-label="녹화 중 00:00:04"');
    expect(html).toContain('class="crosshair"');
    expect(html.match(/class="hotbar-slot"/g)).toHaveLength(5);
    expect(html).toContain('class="mini-map"');
  });
});
