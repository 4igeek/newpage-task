import { describe, expect, it } from 'vitest';
import { formatMs, timingBreakdown } from './timings';

describe('timingBreakdown', () => {
  it('splits the total into rewrite, search, model wait and streaming', () => {
    expect(
      timingBreakdown({ rewriteMs: 300, retrievalMs: 20, firstTokenMs: 1120, totalMs: 2500 }),
    ).toEqual([
      { label: 'Rewrite', ms: 300 },
      { label: 'Search', ms: 20 },
      { label: 'Model thinking', ms: 800 },
      { label: 'Streaming', ms: 1380 },
    ]);
  });

  it('omits stages that did not run (no rewrite on a first question)', () => {
    expect(
      timingBreakdown({ rewriteMs: 0, retrievalMs: 10, firstTokenMs: 510, totalMs: 900 }).map(
        (s) => s.label,
      ),
    ).toEqual(['Search', 'Model thinking', 'Streaming']);
  });

  it('shows only search when the LLM was skipped', () => {
    expect(
      timingBreakdown({ rewriteMs: 0, retrievalMs: 8, firstTokenMs: null, totalMs: 9 }),
    ).toEqual([{ label: 'Search', ms: 8 }]);
  });
});

describe('formatMs', () => {
  it('uses ms under a second and seconds above', () => {
    expect(formatMs(840)).toBe('840 ms');
    expect(formatMs(2140)).toBe('2.1 s');
  });
});
