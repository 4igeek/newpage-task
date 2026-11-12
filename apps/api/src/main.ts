/**
 * Composition root for the HTTP API: the only place that creates concrete
 * infrastructure (DB pool, adapters) and hands it to the app.
 */
import { ClaudeLLMClient, UnconfiguredLLMClient } from './adapters/claude-llm-client.js';
import { LocalBlobStore } from './adapters/local-blob-store.js';
import { LocalEmbedder } from './adapters/local-embedder.js';
import { PgChunkSearch } from './adapters/pg-chunk-search.js';
import { PgDocumentRepository } from './adapters/pg-document-repository.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createLogger } from './logger.js';
import { AnswerQuestion } from './services/answer-question.js';
import { DocumentLibrary } from './services/document-library.js';
import { Retrieve } from './services/retrieve.js';
import { UploadDocument } from './services/upload-document.js';

const config = loadConfig();
const logger = createLogger(config, 'api');
const database = createDatabase(config.DATABASE_URL);

// The API embeds each question with the same model the worker used for chunks.
const embedder = await LocalEmbedder.load({
  modelId: config.EMBEDDING_MODEL,
  cacheDir: config.MODEL_CACHE_DIR,
});

const llm = config.ANTHROPIC_API_KEY
  ? new ClaudeLLMClient(config.LLM_MODEL, config.LLM_EFFORT, config.ANTHROPIC_API_KEY)
  : new UnconfiguredLLMClient();
if (!config.ANTHROPIC_API_KEY) {
  logger.warn('ANTHROPIC_API_KEY is not set: retrieval works, but answers are disabled');
}

const documents = new PgDocumentRepository(database.db);
const blobs = new LocalBlobStore(config.BLOB_DIR);
const retrieve = new Retrieve(embedder, new PgChunkSearch(database.db), {
  candidates: config.RETRIEVAL_CANDIDATES,
  topK: config.RETRIEVAL_TOP_K,
  minSimilarity: config.RETRIEVAL_MIN_SIMILARITY,
});

const app = buildApp(
  {
    health: { pingDatabase: database.ping },
    documents: {
      upload: new UploadDocument(documents, blobs),
      library: new DocumentLibrary(documents, blobs, logger),
    },
    chat: {
      answer: new AnswerQuestion(
        { retrieve, llm, logger },
        { historyTurns: config.CHAT_HISTORY_TURNS, maxTokens: config.LLM_MAX_TOKENS },
      ),
    },
    settings: { maxUploadBytes: config.MAX_UPLOAD_MB * 1024 * 1024 },
  },
  { loggerInstance: logger },
);

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
