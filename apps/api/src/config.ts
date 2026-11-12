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

  // Embeddings (see ADR on embedding model choice).
  EMBEDDING_MODEL: z.string().default('Xenova/bge-small-en-v1.5'),
  MODEL_CACHE_DIR: z.string().default('./data/models'),

  // Chunking. Target + overlap must stay under the model's 512-token input limit.
  CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(350),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().nonnegative().default(50),

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
