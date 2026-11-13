import { z } from 'zod';

/**
 * All runtime configuration comes from environment variables and is validated
 * once at startup. A missing or malformed value fails fast with a readable
 * error instead of surfacing later as an obscure runtime bug.
 */
const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url(),
  BLOB_DIR: z.string().default('./data/blobs'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),

  // Embeddings (see "Embeddings" in the README for why this model).
  EMBEDDING_MODEL: z.string().default('Xenova/bge-small-en-v1.5'),
  MODEL_CACHE_DIR: z.string().default('./data/models'),

  // Chunking. Target + overlap must stay under the model's 512-token input limit.
  CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(350),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().nonnegative().default(50),

  // LLM. Without a key the app still runs: retrieval works, answers explain what's missing.
  ANTHROPIC_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  LLM_MODEL: z.string().default('claude-opus-5-5'),
  LLM_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(8000),

  // Retrieval (see `pnpm eval:retrieval` for how these were chosen).
  RETRIEVAL_CANDIDATES: z.coerce.number().int().positive().default(20),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(6),
  RETRIEVAL_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.5),
  CHAT_HISTORY_TURNS: z.coerce.number().int().nonnegative().default(6),

  // Abuse protection. Per client IP, per minute. Chat costs money per request, so it's tightest.
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_CHAT_PER_MIN: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_UPLOAD_PER_MIN: z.coerce.number().int().positive().default(30),
  /**
   * Which proxies may set X-Forwarded-For (so rate limits apply to the real
   * client, not to nginx). Private ranges cover the Docker network; behind a
   * cloud load balancer, set this to its address range. Never "true" in production.
   */
  TRUST_PROXY: z.string().default('loopback,uniquelocal'),

  // Worker.
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_RETRY_BASE_MS: z.coerce.number().int().positive().default(5000),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}
