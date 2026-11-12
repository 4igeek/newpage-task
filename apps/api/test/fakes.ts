/**
 * In-memory implementations of the ports. Services and routes are tested
 * against these: fast, deterministic, and never touching a network or paid API.
 */
import { createHash, randomUUID } from 'node:crypto';
import { type AppDeps, buildApp } from '../src/app.js';
import { approximateTokens } from '../src/domain/chunker.js';
import type {
  BlobStore,
  ChunkRepository,
  ChunkToStore,
  DocumentRecord,
  DocumentRepository,
  Embedder,
  LLMClient,
  LLMRequest,
  LLMStreamEvent,
  Logger,
  NewDocument,
  QueryTrace,
  StoredTrace,
  TraceStore,
} from '../src/ports/index.js';
import { AnswerQuestion } from '../src/services/answer-question.js';
import { DocumentLibrary } from '../src/services/document-library.js';
import { UploadDocument } from '../src/services/upload-document.js';

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export class InMemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.blobs.set(key, data);
  }
  async get(key: string) {
    const blob = this.blobs.get(key);
    if (!blob) throw new Error(`blob not found: ${key}`);
    return blob;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly docs = new Map<string, DocumentRecord>();
  readonly enqueuedJobs: string[] = [];

  async createWithIngestJob(doc: NewDocument) {
    const existing = await this.findByHash(doc.contentHash);
    if (existing) return { document: existing, created: false };
    const now = new Date();
    const record: DocumentRecord = {
      ...doc,
      id: randomUUID(),
      status: 'pending',
      error: null,
      pageCount: null,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.docs.set(record.id, record);
    this.enqueuedJobs.push(record.id);
    return { document: record, created: true };
  }
  async findById(id: string) {
    return this.docs.get(id) ?? null;
  }
  async findByHash(hash: string) {
    return [...this.docs.values()].find((d) => d.contentHash === hash) ?? null;
  }
  async list() {
    return [...this.docs.values()];
  }
  async setStatus(
    id: string,
    status: DocumentRecord['status'],
    extra: { error?: string | null; pageCount?: number | null } = {},
  ) {
    const doc = this.docs.get(id);
    if (doc) this.docs.set(id, { ...doc, status, ...extra });
  }
  async delete(id: string) {
    const doc = this.docs.get(id) ?? null;
    this.docs.delete(id);
    return doc;
  }
}

export class InMemoryChunkRepository implements ChunkRepository {
  readonly byDocument = new Map<string, ChunkToStore[]>();
  async replaceForDocument(documentId: string, chunks: ChunkToStore[]) {
    this.byDocument.set(documentId, chunks);
  }
}

export class InMemoryTraceStore implements TraceStore {
  readonly traces: StoredTrace[] = [];
  /** Set to make `record` fail, to test that tracing can't break an answer. */
  failWith: Error | null = null;

  async record(trace: QueryTrace) {
    if (this.failWith) throw this.failWith;
    this.traces.push({ ...trace, id: randomUUID(), createdAt: new Date() });
  }
  async recent(limit: number) {
    return [...this.traces].reverse().slice(0, limit);
  }
  async stats() {
    return {
      questions: this.traces.length,
      outcomes: {},
      answeredWithoutCitations: 0,
      withInvalidCitations: 0,
      latencyMs: { p50Total: null, p95Total: null, p50FirstToken: null, p95FirstToken: null },
      tokens: { input: 0, output: 0 },
      avgTopSimilarity: null,
    };
  }
}

/** Deterministic pseudo-embeddings derived from a hash of the text. */
export class FakeEmbedder implements Embedder {
  readonly modelId = 'fake';
  readonly dimensions = 384;
  readonly maxTokens = 512;
  readonly calls: { texts: string[]; kind: 'query' | 'document' }[] = [];

  countTokens(text: string) {
    return approximateTokens(text);
  }
  async embed(texts: string[], kind: 'query' | 'document') {
    this.calls.push({ texts, kind });
    return texts.map((t) => fakeVector(t, this.dimensions));
  }
}

export function fakeVector(text: string, dimensions = 384): number[] {
  const seed = createHash('sha256').update(text).digest();
  const v = Array.from({ length: dimensions }, (_, i) => (seed[i % seed.length] ?? 0) / 255 - 0.5);
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

/**
 * Scripted LLM: `complete` returns `rewriteTo` (for query rewriting) and
 * `stream` yields `answer` in small pieces. Records every request it gets.
 */
export class FakeLLM implements LLMClient {
  readonly modelId = 'fake-llm';
  readonly requests: { kind: 'complete' | 'stream'; request: LLMRequest }[] = [];

  constructor(
    private readonly script: {
      answer?: string;
      rewriteTo?: string;
      stopReason?: 'complete' | 'max_tokens' | 'refusal';
      /** Thrown by every call. */
      error?: Error;
      /** Thrown by `complete` (query rewriting) only. */
      failRewrite?: boolean;
    } = {},
  ) {}

  async complete(request: LLMRequest) {
    this.requests.push({ kind: 'complete', request });
    if (this.script.error) throw this.script.error;
    if (this.script.failRewrite) throw new Error('rewrite failed');
    return { text: this.script.rewriteTo ?? '', usage: { inputTokens: 10, outputTokens: 5 } };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    this.requests.push({ kind: 'stream', request });
    if (this.script.error) throw this.script.error;
    for (const piece of (this.script.answer ?? 'An answer [1].').match(/.{1,8}/gs) ?? []) {
      yield { type: 'text', text: piece };
    }
    yield {
      type: 'end',
      usage: { inputTokens: 100, outputTokens: 20 },
      stopReason: this.script.stopReason ?? 'complete',
    };
  }
}

type TestAppOverrides = Partial<Omit<AppDeps, 'settings'>> & {
  settings?: Partial<AppDeps['settings']>;
};

/** Builds the real Fastify app wired to in-memory fakes. Settings are merged with test defaults. */
export function buildTestApp({ settings, ...overrides }: TestAppOverrides = {}) {
  const documents = new InMemoryDocumentRepository();
  const blobs = new InMemoryBlobStore();
  const app = buildApp({
    health: { pingDatabase: async () => {} },
    documents: {
      upload: new UploadDocument(documents, blobs),
      library: new DocumentLibrary(documents, blobs, silentLogger),
    },
    chat: {
      answer: new AnswerQuestion(
        {
          retrieve: {
            execute: async () => ({
              chunks: [],
              relevant: false,
              stats: { vectorHits: 0, keywordHits: 0, topSimilarity: null, durationMs: 0 },
            }),
          },
          llm: new FakeLLM(),
          traces: new InMemoryTraceStore(),
          logger: silentLogger,
        },
        { historyTurns: 6, maxTokens: 1000 },
      ),
    },
    traces: new InMemoryTraceStore(),
    ...overrides,
    settings: {
      maxUploadBytes: 1024 * 1024,
      rateLimit: { globalPerMinute: 1000, chatPerMinute: 1000, uploadPerMinute: 1000 },
      ...settings,
    },
  });
  return { app, documents, blobs };
}

/** Encodes a single-file multipart body for `app.inject`. */
export function multipartFile(filename: string, content: Buffer | string) {
  const boundary = `----test${randomUUID()}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
