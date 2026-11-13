/**
 * Ports: the interfaces services depend on. Each has one production adapter
 * in `adapters/` and a fake in `test/fakes.ts`. Swapping infrastructure
 * (local disk -> S3, local model -> hosted embeddings) means writing a new
 * adapter; no service changes.
 */
import type { DocumentStatus, TraceOutcome, TraceSource, TraceStats } from '@docchat/shared';
import type { ChunkDraft } from '../domain/chunker.js';
import type { SupportedMimeType } from '../domain/file-types.js';
import type { ParsedDocument } from '../domain/sections.js';

/** Content-addressed storage for original uploads. Keys are sha256 hex digests. */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  /** Max input tokens; text beyond this is silently truncated by the model. */
  readonly maxTokens: number;
  countTokens(text: string): number;
  /** Queries and documents are embedded differently by asymmetric models like BGE. */
  embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]>;
}

export interface DocumentParser {
  parse(mimeType: SupportedMimeType, bytes: Buffer): Promise<ParsedDocument>;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: SupportedMimeType;
  sizeBytes: number;
  contentHash: string;
  status: DocumentStatus;
  error: string | null;
  pageCount: number | null;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDocument = Pick<
  DocumentRecord,
  'filename' | 'mimeType' | 'sizeBytes' | 'contentHash'
>;

export interface DocumentRepository {
  /**
   * Inserts the document and its ingestion job in one transaction, so a
   * document can never exist without the job that processes it. If a document
   * with the same content hash already exists, returns it instead.
   */
  createWithIngestJob(doc: NewDocument): Promise<{ document: DocumentRecord; created: boolean }>;
  findById(id: string): Promise<DocumentRecord | null>;
  findByHash(contentHash: string): Promise<DocumentRecord | null>;
  list(): Promise<DocumentRecord[]>;
  setStatus(
    id: string,
    status: DocumentStatus,
    extra?: { error?: string | null; pageCount?: number | null },
  ): Promise<void>;
  delete(id: string): Promise<DocumentRecord | null>;
}

export interface ChunkToStore extends ChunkDraft {
  embedding: number[];
}

export interface ChunkRepository {
  /** Atomically replaces all chunks for a document, so re-running ingestion is safe. */
  replaceForDocument(documentId: string, chunks: ChunkToStore[]): Promise<void>;
}

export interface Job {
  id: string;
  type: 'ingest_document';
  documentId: string;
  attempts: number;
}

export interface JobQueue {
  /** Claims the next runnable job, or returns null if there is none. Safe across concurrent workers. */
  claim(): Promise<Job | null>;
  complete(jobId: string): Promise<void>;
  /** Re-queues with a delay, or marks the job failed when `retryAfterMs` is null. */
  fail(jobId: string, error: string, retryAfterMs: number | null): Promise<void>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** A chunk returned by search, with enough metadata to cite it. */
export interface ChunkHit {
  chunkId: string;
  documentId: string;
  filename: string;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  /** Vector: cosine similarity (0..1). Keyword: ts_rank_cd. Not comparable across the two. */
  score: number;
}

export interface SearchFilter {
  /** Restrict search to these documents. Undefined means all ready documents. */
  documentIds?: string[];
}

export interface ChunkSearch {
  vectorSearch(embedding: number[], limit: number, filter?: SearchFilter): Promise<ChunkHit[]>;
  keywordSearch(query: string, limit: number, filter?: SearchFilter): Promise<ChunkHit[]>;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LLMStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'end'; usage: LLMUsage; stopReason: 'complete' | 'max_tokens' | 'refusal' };

export interface LLMClient {
  readonly modelId: string;
  complete(request: LLMRequest): Promise<{ text: string; usage: LLMUsage }>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamEvent>;
}

/** A completed question, as recorded for observability. */
export interface QueryTrace {
  requestId: string;
  question: string;
  query: string;
  rewritten: boolean;
  documentIds: string[] | null;
  outcome: TraceOutcome;
  errorCode: string | null;
  model: string;
  answer: string;
  sources: TraceSource[];
  topSimilarity: number | null;
  citations: number[];
  invalidCitations: number[];
  inputTokens: number;
  outputTokens: number;
  rewriteMs: number;
  retrievalMs: number | null;
  firstTokenMs: number | null;
  totalMs: number;
}

export interface StoredTrace extends QueryTrace {
  id: string;
  createdAt: Date;
}

export interface TraceStore {
  record(trace: QueryTrace): Promise<void>;
  recent(limit: number): Promise<StoredTrace[]>;
  stats(since: Date): Promise<Omit<TraceStats, 'since'>>;
}
