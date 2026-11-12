/**
 * Composition root for the HTTP API: the only place that creates concrete
 * infrastructure (DB pool, adapters) and hands it to the app.
 */
import { LocalBlobStore } from './adapters/local-blob-store.js';
import { PgDocumentRepository } from './adapters/pg-document-repository.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createLogger } from './logger.js';
import { DocumentLibrary } from './services/document-library.js';
import { UploadDocument } from './services/upload-document.js';

const config = loadConfig();
const logger = createLogger(config, 'api');
const database = createDatabase(config.DATABASE_URL);

const documents = new PgDocumentRepository(database.db);
const blobs = new LocalBlobStore(config.BLOB_DIR);

const app = buildApp(
  {
    health: { pingDatabase: database.ping },
    documents: {
      upload: new UploadDocument(documents, blobs),
      library: new DocumentLibrary(documents, blobs, logger),
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
