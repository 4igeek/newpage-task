export interface Fused<T> {
  item: T;
  score: number;
  /** 1-based rank of the item in each input list, or null if it was absent. */
  ranks: (number | null)[];
}

/**
 * Reciprocal Rank Fusion (Cormack et al., 2009): score = sum of 1 / (k + rank).
 *
 * Used to merge vector and keyword results. It only looks at *ranks*, so it
 * needs no calibration between incomparable scores (cosine similarity vs
 * ts_rank). An item ranked well by both lists beats one ranked first by only
 * one. k = 60 is the value from the paper and dampens the top-rank advantage.
 */
export function reciprocalRankFusion<T>(
  lists: T[][],
  keyOf: (item: T) => string,
  k = 60,
): Fused<T>[] {
  const fused = new Map<string, Fused<T>>();

  lists.forEach((list, listIndex) => {
    list.forEach((item, i) => {
      const key = keyOf(item);
      const entry = fused.get(key) ?? { item, score: 0, ranks: lists.map(() => null) };
      entry.score += 1 / (k + i + 1);
      entry.ranks[listIndex] = i + 1;
      fused.set(key, entry);
    });
  });

  return [...fused.values()].sort((a, b) => b.score - a.score);
}
