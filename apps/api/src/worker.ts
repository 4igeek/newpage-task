/**
 * Composition root for the ingestion worker. Same codebase and image as the
 * API, different entrypoint, so the two scale independently (CPU-heavy
 * embedding never competes with request latency).
 */
import { DefaultDocumentParser } from './adapters/document-parser.js';
import { LocalBlobStore } from './adapters/local-blob-store.js';
import { LocalEmbedder } from './adapters/local-embedder.js';
import { PgChunkRepository } from './adapters/pg-chunk-repository.js';
import { PgDocumentRepository } from './adapters/pg-document-repository.js';
import { PgJobQueue } from './adapters/pg-job-queue.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createLogger } from './logger.js';
import { IngestDocument } from './services/ingest-document.js';
import { runWorker } from './services/run-worker.js';

const config = loadConfig();
const logger = createLogger(config, 'worker');
const database = createDatabase(config.DATABASE_URL);

logger.info({ model: config.EMBEDDING_MODEL }, 'loading embedding model');
const embedder = await LocalEmbedder.load({
  modelId: config.EMBEDDING_MODEL,
  cacheDir: config.MODEL_CACHE_DIR,
});

const documents = new PgDocumentRepository(database.db);
const ingest = new IngestDocument(
  {
    documents,
    chunks: new PgChunkRepository(database.db),
    blobs: new LocalBlobStore(config.BLOB_DIR),
    parser: new DefaultDocumentParser(),
    embedder,
    logger,
  },
  { targetTokens: config.CHUNK_TARGET_TOKENS, overlapTokens: config.CHUNK_OVERLAP_TOKENS },
);

const controller = new AbortController();
const stop = (signal: string) => {
  logger.info({ signal }, 'stopping after current job');
  controller.abort();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

logger.info('worker started');
await runWorker(
  {
    queue: new PgJobQueue(database.db),
    ingest,
    onPermanentFailure: (documentId, error) => documents.setStatus(documentId, 'failed', { error }),
    logger,
    settings: {
      pollIntervalMs: config.WORKER_POLL_MS,
      maxAttempts: config.JOB_MAX_ATTEMPTS,
      retryBaseMs: config.JOB_RETRY_BASE_MS,
    },
  },
  controller.signal,
);
await database.close();
logger.info('worker stopped');
