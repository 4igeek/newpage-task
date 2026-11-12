/**
 * Integration tests for the Postgres adapters against a real pgvector
 * container (testcontainers). These cover what fakes cannot: SQL correctness,
 * migrations, constraints, cascades and SKIP LOCKED concurrency.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DefaultDocumentParser } from '../../src/adapters/document-parser.js';
import { LocalBlobStore } from '../../src/adapters/local-blob-store.js';
import { PgChunkRepository } from '../../src/adapters/pg-chunk-repository.js';
import { PgChunkSearch } from '../../src/adapters/pg-chunk-search.js';
import { PgDocumentRepository } from '../../src/adapters/pg-document-repository.js';
import { PgJobQueue } from '../../src/adapters/pg-job-queue.js';
import { createDatabase } from '../../src/db/client.js';
import { chunks, documents, jobs } from '../../src/db/schema.js';
import { IngestDocument } from '../../src/services/ingest-document.js';
import { processNextJob } from '../../src/services/run-worker.js';
import { UploadDocument } from '../../src/services/upload-document.js';
import { FakeEmbedder, fakeVector, silentLogger } from '../fakes.js';

let container: StartedPostgreSqlContainer;
let database: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').start();
  database = createDatabase(container.getConnectionUri());
  await migrate(database.db, { migrationsFolder: join(import.meta.dirname, '../../drizzle') });
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

beforeEach(async () => {
  await database.db.execute(sql`truncate ${documents} cascade`);
});

const newDoc = (hash: string) => ({
  filename: `${hash}.txt`,
  mimeType: 'text/plain' as const,
  sizeBytes: 1,
  contentHash: hash.padEnd(64, '0'),
});

describe('PgDocumentRepository', () => {
  it('creates a document and its ingestion job in one transaction', async () => {
    const repo = new PgDocumentRepository(database.db);

    const { document, created } = await repo.createWithIngestJob(newDoc('a'));

    expect(created).toBe(true);
    expect(document).toMatchObject({ status: 'pending', chunkCount: 0 });
    const queued = await database.db.select().from(jobs).where(eq(jobs.documentId, document.id));
    expect(queued).toHaveLength(1);
  });

  it('returns the existing document for a duplicate content hash, without a second job', async () => {
    const repo = new PgDocumentRepository(database.db);
    const first = await repo.createWithIngestJob(newDoc('b'));

    const second = await repo.createWithIngestJob(newDoc('b'));

    expect(second).toMatchObject({ created: false, document: { id: first.document.id } });
    expect(await database.db.select().from(jobs)).toHaveLength(1);
  });
});

describe('PgJobQueue', () => {
  it('hands each job to exactly one of several concurrent workers (SKIP LOCKED)', async () => {
    const repo = new PgDocumentRepository(database.db);
    await Promise.all(['c', 'd', 'e'].map((h) => repo.createWithIngestJob(newDoc(h))));
    const queue = new PgJobQueue(database.db);

    const claims = await Promise.all(Array.from({ length: 5 }, () => queue.claim()));

    const ids = claims.filter((j) => j !== null).map((j) => j.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('delays retried jobs until their backoff has elapsed', async () => {
    await new PgDocumentRepository(database.db).createWithIngestJob(newDoc('f'));
    const queue = new PgJobQueue(database.db);
    const job = await queue.claim();
    if (!job) throw new Error('expected a job');

    await queue.fail(job.id, 'transient', 60_000);

    expect(await queue.claim()).toBeNull();
    const [row] = await database.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row).toMatchObject({ status: 'queued', attempts: 1, lastError: 'transient' });
  });

  it('reclaims a job whose worker died mid-run', async () => {
    await new PgDocumentRepository(database.db).createWithIngestJob(newDoc('g'));
    const queue = new PgJobQueue(database.db, '1 second');
    const first = await queue.claim();
    await database.db.execute(sql`update ${jobs} set locked_at = now() - interval '1 minute'`);

    const reclaimed = await queue.claim();

    expect(reclaimed?.id).toBe(first?.id);
    expect(reclaimed?.attempts).toBe(2);
  });
});

describe('ingestion end to end', () => {
  it('uploads, processes the queued job, and stores searchable chunks', async () => {
    const documentRepo = new PgDocumentRepository(database.db);
    const blobs = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'blobs-')));
    const queue = new PgJobQueue(database.db);
    const ingest = new IngestDocument(
      {
        documents: documentRepo,
        chunks: new PgChunkRepository(database.db),
        blobs,
        parser: new DefaultDocumentParser(),
        embedder: new FakeEmbedder(),
        logger: silentLogger,
      },
      { targetTokens: 100, overlapTokens: 10 },
    );

    const { document } = await new UploadDocument(documentRepo, blobs).execute({
      filename: 'policy.md',
      bytes: Buffer.from(
        '# Leave\nStaff receive 25 days of annual leave.\n# Travel\nBook trains via the portal.',
      ),
    });
    const ran = await processNextJob({
      queue,
      ingest,
      onPermanentFailure: async () => {},
      logger: silentLogger,
      settings: { pollIntervalMs: 10, maxAttempts: 3, retryBaseMs: 10 },
    });

    expect(ran).toBe(true);
    const ready = await documentRepo.findById(document.id);
    expect(ready).toMatchObject({ status: 'ready', chunkCount: 2 });

    // The generated tsvector column makes chunks keyword-searchable immediately.
    const hits = await database.db
      .select({ heading: chunks.heading })
      .from(chunks)
      .where(sql`${chunks.contentTsv} @@ plainto_tsquery('english', 'annual leave')`);
    expect(hits).toEqual([{ heading: 'Leave' }]);

    // Deleting the document cascades to its chunks and jobs.
    await documentRepo.delete(document.id);
    expect(await database.db.select().from(chunks)).toHaveLength(0);
    expect(await database.db.select().from(jobs)).toHaveLength(0);
  });
});

describe('PgChunkSearch', () => {
  /** Creates a document with one chunk per text, embedded with fakeVector(text). */
  async function seed(name: string, texts: string[], status: 'ready' | 'pending' = 'ready') {
    const repo = new PgDocumentRepository(database.db);
    const { document } = await repo.createWithIngestJob(newDoc(name));
    await new PgChunkRepository(database.db).replaceForDocument(
      document.id,
      texts.map((content, ordinal) => ({
        ordinal,
        content,
        tokenCount: 1,
        embedding: fakeVector(content),
      })),
    );
    await repo.setStatus(document.id, status);
    return document.id;
  }

  it('ranks the exact vector match first, with similarity ~1', async () => {
    await seed('h', ['annual leave policy', 'expense rules', 'laptop choices']);
    const search = new PgChunkSearch(database.db);

    const hits = await search.vectorSearch(fakeVector('expense rules'), 3);

    expect(hits[0]?.content).toBe('expense rules');
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    expect(hits[0]?.filename).toBe('h.txt');
  });

  it('keyword search matches ANY stemmed term, ranking more matches higher', async () => {
    await seed('k', [
      'Employees receive annual leave.',
      'Leave requests need approval and annual planning.',
      'Laptops are refreshed every three years.',
    ]);
    const search = new PgChunkSearch(database.db);

    const hits = await search.keywordSearch('how much annual leave do I get?', 10);

    expect(hits.map((h) => h.content)).toEqual([
      'Employees receive annual leave.',
      'Leave requests need approval and annual planning.',
    ]);
  });

  it('only searches ready documents', async () => {
    await seed('p', ['pending content about leave'], 'pending');
    const search = new PgChunkSearch(database.db);

    expect(await search.keywordSearch('leave', 10)).toEqual([]);
    expect(await search.vectorSearch(fakeVector('pending content about leave'), 10)).toEqual([]);
  });

  it('restricts results to the requested documents', async () => {
    const a = await seed('a', ['leave in document a']);
    await seed('b', ['leave in document b']);
    const search = new PgChunkSearch(database.db);

    const hits = await search.keywordSearch('leave', 10, { documentIds: [a] });

    expect(hits.map((h) => h.content)).toEqual(['leave in document a']);
    expect(await search.keywordSearch('leave', 10, { documentIds: [] })).toEqual([]);
  });
});
