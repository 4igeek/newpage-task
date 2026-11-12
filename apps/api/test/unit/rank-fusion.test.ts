import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../../src/domain/rank-fusion.js';

const id = (s: string) => s;

describe('reciprocalRankFusion', () => {
  it('ranks an item found by both lists above items found by only one', () => {
    const fused = reciprocalRankFusion(
      [
        ['a', 'b', 'c'],
        ['d', 'e', 'b'],
      ],
      id,
    );
    expect(fused[0]?.item).toBe('b');
  });

  it('records the rank of each item in each list', () => {
    const fused = reciprocalRankFusion([['a', 'b'], ['b']], id);
    const b = fused.find((f) => f.item === 'b');
    const a = fused.find((f) => f.item === 'a');
    expect(b?.ranks).toEqual([2, 1]);
    expect(a?.ranks).toEqual([1, null]);
  });

  it('computes 1/(k + rank) summed across lists', () => {
    const [top] = reciprocalRankFusion([['a'], ['a']], id, 60);
    expect(top?.score).toBeCloseTo(2 / 61);
  });

  it('handles empty lists', () => {
    expect(reciprocalRankFusion([[], []], id)).toEqual([]);
    expect(reciprocalRankFusion([['a'], []], id).map((f) => f.item)).toEqual(['a']);
  });
});
