import type { TraceOutcome } from '@docchat/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import type { SupportedMimeType } from '../domain/file-types.js';

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
  mimeType: text('mime_type').$type<SupportedMimeType>().notNull(),
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

/** Per-source detail kept on a trace: enough to see what retrieval returned and why. */
export interface TraceSourceRecord {
  n: number;
  chunkId: string;
  documentId: string;
  filename: string;
  heading: string | null;
  similarity: number | null;
  vectorRank: number | null;
  keywordRank: number | null;
  cited: boolean;
}

/**
 * One row per question asked: the observability record. Answers how well
 * retrieval and generation are doing over time (gate rate, invalid citations,
 * latency percentiles, token spend) without re-running anything.
 *
 * It stores the question and answer text, which in production is user data:
 * it needs a retention policy and access controls (see README).
 */
export const queryTraces = pgTable(
  'query_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: text('request_id').notNull(),
    question: text('question').notNull(),
    query: text('query').notNull(),
    rewritten: boolean('rewritten').notNull(),
    /** Null means all documents were searched. */
    documentIds: uuid('document_ids').array(),
    outcome: text('outcome').$type<TraceOutcome>().notNull(),
    errorCode: text('error_code'),
    model: text('model').notNull(),
    answer: text('answer').notNull(),
    sources: jsonb('sources').$type<TraceSourceRecord[]>().notNull(),
    topSimilarity: real('top_similarity'),
    citations: integer('citations').array().notNull(),
    invalidCitations: integer('invalid_citations').array().notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    rewriteMs: integer('rewrite_ms').notNull(),
    retrievalMs: integer('retrieval_ms'),
    firstTokenMs: integer('first_token_ms'),
    totalMs: integer('total_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('query_traces_created_at_idx').on(t.createdAt)],
);
