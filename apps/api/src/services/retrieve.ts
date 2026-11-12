import { reciprocalRankFusion } from '../domain/rank-fusion.js';
import type { ChunkHit, ChunkSearch, Embedder, SearchFilter } from '../ports/index.js';

export type RetrievalMode = 'hybrid' | 'vector' | 'keyword';

export interface RetrievalSettings {
  /** Candidates fetched from each search before fusion. */
  candidates: number;
  /** Chunks passed to the LLM. */
  topK: number;
  /**
   * Relevance gate: if the best vector match is below this similarity, treat
   * the question as off-topic and skip the LLM. Calibrated with
   * `pnpm eval:retrieval`: it reliably catches off-topic questions, but cannot
   * separate on-topic-yet-unanswered ones (those are left to the prompt).
   * Keyword hits deliberately don't bypass the gate: OR-matching fires on any
   * shared common word, which would make the gate meaningless.
   */
  minSimilarity: number;
}

export interface RetrievedChunk extends ChunkHit {
  /** Fused RRF score; ranks are 1-based positions in each list, null if absent. */
  vectorRank: number | null;
  keywordRank: number | null;
  similarity: number | null;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** False when the relevance gate decided nothing relevant was found. */
  relevant: boolean;
  stats: {
    vectorHits: number;
    keywordHits: number;
    topSimilarity: number | null;
    durationMs: number;
  };
}

/**
 * Hybrid retrieval: dense vector search catches paraphrases ("training
 * budget" -> "learning budget"); keyword search catches exact terms that
 * embeddings blur (IDs, acronyms like SEV1, numbers). Results are merged
 * with Reciprocal Rank Fusion.
 */
export class Retrieve {
  constructor(
    private readonly embedder: Embedder,
    private readonly search: ChunkSearch,
    private readonly settings: RetrievalSettings,
  ) {}

  async execute(
    query: string,
    filter: SearchFilter = {},
    mode: RetrievalMode = 'hybrid',
  ): Promise<RetrievalResult> {
    const startedAt = performance.now();
    const { candidates, topK, minSimilarity } = this.settings;

    const [vectorHits, keywordHits] = await Promise.all([
      mode === 'keyword'
        ? Promise.resolve([])
        : this.embedder
            .embed([query], 'query')
            .then(([embedding]) =>
              embedding ? this.search.vectorSearch(embedding, candidates, filter) : [],
            ),
      mode === 'vector'
        ? Promise.resolve([])
        : this.search.keywordSearch(query, candidates, filter),
    ]);

    const similarityById = new Map(vectorHits.map((h) => [h.chunkId, h.score]));
    const fused = reciprocalRankFusion([vectorHits, keywordHits], (h: ChunkHit) => h.chunkId);
    const topSimilarity = vectorHits[0]?.score ?? null;

    // Keyword-only mode (used by the eval) has no similarity to gate on.
    const relevant =
      mode === 'keyword' || (topSimilarity !== null && topSimilarity >= minSimilarity);

    return {
      chunks: relevant
        ? fused.slice(0, topK).map(({ item, score, ranks }) => ({
            ...item,
            score,
            vectorRank: ranks[0] ?? null,
            keywordRank: ranks[1] ?? null,
            similarity: similarityById.get(item.chunkId) ?? null,
          }))
        : [],
      relevant,
      stats: {
        vectorHits: vectorHits.length,
        keywordHits: keywordHits.length,
        topSimilarity,
        durationMs: Math.round(performance.now() - startedAt),
      },
    };
  }
}
