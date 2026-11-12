/**
 * Ports: the interfaces services depend on. Each has one production adapter
 * in `adapters/` and a fake in `test/fakes/`. Swapping infrastructure
 * (local disk -> S3, local model -> hosted embeddings) means writing a new
 * adapter; no service changes.
 */
import type { DocumentStatus } from '@docchat/shared';
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
