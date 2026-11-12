import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/** Dimension of the local embedding model (bge-small-en-v1.5). */
export const EMBEDDING_DIMENSIONS = 384;

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const documentStatus = pgEnum('document_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

/**
 * One row per uploaded file. The original bytes live in the blob store,
 * addressed by `contentHash` (sha256), which also makes uploads idempotent.
 */
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  contentHash: text('content_hash').notNull().unique(),
  status: documentStatus('status').notNull().default('pending'),
  error: text('error'),
  pageCount: integer('page_count'),
  ...timestamps,
});

/**
 * Retrieval units. Each chunk carries both a dense embedding (semantic search)
 * and a generated tsvector (keyword search), so hybrid retrieval is a single
 * Postgres query with no second store to keep in sync.
 */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    heading: text('heading'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(heading, '') || ' ' || content)`,
    ),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('chunks_document_ordinal_idx').on(t.documentId, t.ordinal),
    index('chunks_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_content_tsv_idx').using('gin', t.contentTsv),
  ],
);

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'done', 'failed']);

/**
 * A minimal durable job queue. Workers claim rows with
 * `SELECT ... FOR UPDATE SKIP LOCKED`, so several workers can run safely
 * without Redis or a broker. In production this maps onto SQS / Pub/Sub.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('jobs_claim_idx').on(t.status, t.runAfter)],
);
