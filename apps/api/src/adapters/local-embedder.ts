import { env, type FeatureExtractionPipeline, pipeline } from '@huggingface/transformers';
import type { Embedder } from '../ports/index.js';

/**
 * BGE is an asymmetric model: queries get an instruction prefix, passages
 * don't. Skipping the prefix measurably hurts retrieval.
 */
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/**
 * Runs bge-small-en-v1.5 in-process via ONNX Runtime. No API key, no network
 * at runtime (the model is baked into the Docker image), and document content
 * never leaves the machine for embedding.
 */
export class LocalEmbedder implements Embedder {
  readonly dimensions = 384;
  readonly maxTokens = 512;

  private constructor(
    readonly modelId: string,
    private readonly extractor: FeatureExtractionPipeline,
  ) {}

  static async load(opts: { modelId: string; cacheDir: string }): Promise<LocalEmbedder> {
    env.cacheDir = opts.cacheDir;
    const extractor = await pipeline('feature-extraction', opts.modelId, { dtype: 'fp32' });
    return new LocalEmbedder(opts.modelId, extractor);
  }

  countTokens(text: string): number {
    return this.extractor.tokenizer.encode(text).length;
  }

  async embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const inputs = kind === 'query' ? texts.map((t) => BGE_QUERY_PREFIX + t) : texts;
    // BGE uses CLS pooling; normalising lets cosine similarity be a dot product.
    const output = await this.extractor(inputs, { pooling: 'cls', normalize: true });
    return output.tolist() as number[][];
  }
}
