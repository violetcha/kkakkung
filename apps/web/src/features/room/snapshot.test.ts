import { describe, expect, it } from 'vitest';

import { collectPlayerViews } from './snapshot';

describe('collectPlayerViews', () => {
  it('waits when the SDK has not delivered the first state', () => {
    expect(collectPlayerViews(undefined)).toBeUndefined();
    expect(collectPlayerViews({ tick: 0 } as never)).toBeUndefined();
  });
});
