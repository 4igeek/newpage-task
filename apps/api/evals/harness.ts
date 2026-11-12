/**
 * Shared setup for the evals: a throwaway pgvector database with the sample
 * documents ingested by the real parser, chunker and embedding model. Each
 * eval run starts from the same state, so results are comparable over time.
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { z } from 'zod';
import { DefaultDocumentParser } from '../src/adapters/document-parser.js';
import { LocalBlobStore } from '../src/adapters/local-blob-store.js';
import { LocalEmbedder } from '../src/adapters/local-embedder.js';
import { PgChunkRepository } from '../src/adapters/pg-chunk-repository.js';
import { PgChunkSearch } from '../src/adapters/pg-chunk-search.js';
import { PgDocumentRepository } from '../src/adapters/pg-document-repository.js';
import { PgJobQueue } from '../src/adapters/pg-job-queue.js';
import { createDatabase } from '../src/db/client.js';
import type { Logger } from '../src/ports/index.js';
import { IngestDocument } from '../src/services/ingest-document.js';
import { type RetrievalSettings, Retrieve } from '../src/services/retrieve.js';
import { processNextJob } from '../src/services/run-worker.js';
import { UploadDocument } from '../src/services/upload-document.js';

const here = import.meta.dirname;
const repoRoot = join(here, '../../..');
export const quiet: Logger = { info() {}, warn() {}, error() {} };

export const EvalSet = z.object({
  answerable: z.array(z.object({ question: z.string(), document: z.string(), expect: z.string() })),
  unanswerable: z.array(z.string()),
});
export type EvalSet = z.infer<typeof EvalSet>;

export async function loadEvalSet(): Promise<EvalSet> {
  return EvalSet.parse(JSON.parse(await readFile(join(here, 'retrieval-questions.json'), 'utf8')));
}

/** The same values production uses by default (see src/config.ts). */
export const productionRetrieval: RetrievalSettings = {
  candidates: Number(process.env.RETRIEVAL_CANDIDATES ?? 20),
  topK: Number(process.env.RETRIEVAL_TOP_K ?? 6),
  minSimilarity: Number(process.env.RETRIEVAL_MIN_SIMILARITY ?? 0.5),
};

export async function startEvalEnvironment() {
  console.log('Starting pgvector and loading the embedding model...');
  const [container, embedder] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg17').start(),
    LocalEmbedder.load({
      modelId: process.env.EMBEDDING_MODEL ?? 'Xenova/bge-small-en-v1.5',
      cacheDir: process.env.MODEL_CACHE_DIR ?? join(repoRoot, 'data/models'),
    }),
  ]);
  const database = createDatabase(container.getConnectionUri());

  try {
    await migrate(database.db, { migrationsFolder: join(here, '../drizzle') });
    await ingestSampleDocs(database, embedder);
  } catch (err) {
    await database.close();
    await container.stop();
    throw err;
  }

  return {
    embedder,
    retrieve: (settings: RetrievalSettings) =>
      new Retrieve(embedder, new PgChunkSearch(database.db), settings),
    async close() {
      await database.close();
      await container.stop();
    },
  };
}

async function ingestSampleDocs(
  database: ReturnType<typeof createDatabase>,
  embedder: LocalEmbedder,
) {
  const documents = new PgDocumentRepository(database.db);
  const blobs = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'eval-blobs-')));
  const ingest = new IngestDocument(
    {
      documents,
      chunks: new PgChunkRepository(database.db),
      blobs,
      parser: new DefaultDocumentParser(),
      embedder,
      logger: quiet,
    },
    {
      targetTokens: Number(process.env.CHUNK_TARGET_TOKENS ?? 350),
      overlapTokens: Number(process.env.CHUNK_OVERLAP_TOKENS ?? 50),
    },
  );
  const upload = new UploadDocument(documents, blobs);
  const dir = join(repoRoot, 'sample-docs');
  for (const name of await readdir(dir)) {
    await upload.execute({ filename: name, bytes: await readFile(join(dir, name)) });
  }
  const queue = new PgJobQueue(database.db);
  const settings = { pollIntervalMs: 0, maxAttempts: 1, retryBaseMs: 0 };
  while (
    await processNextJob({
      queue,
      ingest,
      onPermanentFailure: async () => {},
      logger: quiet,
      settings,
    })
  ) {}
}

/** Prints a report and saves it (plus optional raw data) under evals/results/. */
export async function saveReport(name: string, markdown: string, raw?: unknown) {
  const dir = join(here, 'results');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), markdown);
  if (raw !== undefined)
    await writeFile(join(dir, `${name}.json`), `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`\n${markdown}`);
  console.log(`Saved to evals/results/${name}.md`);
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const pct = (n: number, of: number) => (of === 0 ? '–' : `${Math.round((n / of) * 100)}%`);
