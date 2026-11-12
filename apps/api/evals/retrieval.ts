/**
 * Retrieval evaluation. No LLM involved, so it is free, fast and deterministic.
 *
 *   pnpm --filter @docchat/api eval:retrieval
 *
 * Starts a throwaway pgvector container, ingests ../../sample-docs with the
 * real embedding model and chunker, then for each retrieval mode reports:
 *   - hit@1 / hit@3 / hit@k: share of questions with a correct chunk in the top N
 *   - MRR: mean reciprocal rank of the first correct chunk
 * It also prints the best vector similarity for answerable vs unanswerable
 * questions, which is how RETRIEVAL_MIN_SIMILARITY is calibrated.
 */
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
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
import { type RetrievalMode, Retrieve } from '../src/services/retrieve.js';
import { processNextJob } from '../src/services/run-worker.js';
import { UploadDocument } from '../src/services/upload-document.js';

const EvalSet = z.object({
  answerable: z.array(z.object({ question: z.string(), document: z.string(), expect: z.string() })),
  unanswerable: z.array(z.string()),
});

const TOP_K = Number(process.env.RETRIEVAL_TOP_K ?? 6);
const here = import.meta.dirname;
const repoRoot = join(here, '../../..');
const quiet: Logger = { info() {}, warn() {}, error() {} };

const evalSet = EvalSet.parse(
  JSON.parse(await readFile(join(here, 'retrieval-questions.json'), 'utf8')),
);

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
  await ingestSampleDocs();

  // Gate disabled here: we want the raw rankings, and to measure similarities.
  const retrieve = new Retrieve(embedder, new PgChunkSearch(database.db), {
    candidates: 20,
    topK: TOP_K,
    minSimilarity: 0,
  });

  console.log(`\n## Retrieval quality (${evalSet.answerable.length} questions, k=${TOP_K})\n`);
  console.log('| Mode | hit@1 | hit@3 | hit@k | MRR |');
  console.log('|---|---|---|---|---|');
  const misses: string[] = [];
  for (const mode of ['vector', 'keyword', 'hybrid'] as RetrievalMode[]) {
    const ranks = await Promise.all(
      evalSet.answerable.map(async (q) => {
        const { chunks } = await retrieve.execute(q.question, {}, mode);
        const index = chunks.findIndex(
          (c) =>
            c.filename === q.document && c.content.toLowerCase().includes(q.expect.toLowerCase()),
        );
        if (index === -1 && mode === 'hybrid') misses.push(q.question);
        return index === -1 ? null : index + 1;
      }),
    );
    const hitAt = (n: number) => pct(ranks.filter((r) => r !== null && r <= n).length);
    const mrr = ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length;
    console.log(`| ${mode} | ${hitAt(1)} | ${hitAt(3)} | ${hitAt(TOP_K)} | ${mrr.toFixed(3)} |`);
  }
  if (misses.length) console.log(`\nHybrid misses:\n${misses.map((m) => `- ${m}`).join('\n')}`);

  console.log('\n## Relevance gate calibration (best vector similarity)\n');
  const best = async (q: string) =>
    (await retrieve.execute(q, {}, 'hybrid')).stats.topSimilarity ?? 0;
  const answerable = await Promise.all(evalSet.answerable.map((q) => best(q.question)));
  const unanswerable = await Promise.all(evalSet.unanswerable.map(best));
  console.log(
    `answerable:   min ${fmt(Math.min(...answerable))}  median ${fmt(median(answerable))}`,
  );
  console.log(
    `unanswerable: max ${fmt(Math.max(...unanswerable))}  median ${fmt(median(unanswerable))}`,
  );
  for (const [i, q] of evalSet.unanswerable.entries()) {
    console.log(`  ${fmt(unanswerable[i] ?? 0)}  ${q}`);
  }

  const gate = Number(process.env.RETRIEVAL_MIN_SIMILARITY ?? 0.5);
  const passed = answerable.filter((s) => s >= gate).length;
  const blocked = unanswerable.filter((s) => s < gate).length;
  console.log(
    `\nGate at ${gate}: lets through ${passed}/${answerable.length} answerable, ` +
      `blocks ${blocked}/${unanswerable.length} unanswerable (the rest is left to the prompt).`,
  );

  function pct(n: number) {
    return `${Math.round((n / evalSet.answerable.length) * 100)}%`;
  }
} finally {
  await database.close();
  await container.stop();
}

async function ingestSampleDocs() {
  const documents = new PgDocumentRepository(database.db);
  const blobs = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'eval-blobs-')));
  const upload = new UploadDocument(documents, blobs);
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

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function fmt(n: number) {
  return n.toFixed(3);
}
