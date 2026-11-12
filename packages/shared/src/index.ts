/**
 * The API contract shared by the backend and the frontend.
 *
 * Every request/response body is defined once here as a Zod schema. The API
 * validates against these schemas at runtime, and the web app imports the
 * inferred types, so the two sides cannot drift apart silently.
 */
import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.enum(['ok', 'unreachable']),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const DocumentStatus = z.enum(['pending', 'processing', 'ready', 'failed']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const DocumentDto = z.object({
  id: z.uuid(),
  filename: z.string(),
  mimeType: z.enum(['application/pdf', 'text/markdown', 'text/plain']),
  sizeBytes: z.number().int(),
  status: DocumentStatus,
  error: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  chunkCount: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type DocumentDto = z.infer<typeof DocumentDto>;

export const DocumentListResponse = z.object({ documents: z.array(DocumentDto) });
export type DocumentListResponse = z.infer<typeof DocumentListResponse>;

export const UploadResponse = z.object({
  document: DocumentDto,
  /** False when an identical file was already uploaded (deduplicated by content hash). */
  created: z.boolean(),
});
export type UploadResponse = z.infer<typeof UploadResponse>;

export const DocumentIdParams = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const ChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8000),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/**
 * The API is stateless: the client sends the conversation each time. The
 * server trims it to the last few turns before using it.
 */
export const ChatRequest = z.object({
  messages: z
    .array(ChatMessage)
    .min(1)
    .max(50)
    .refine((m) => m.at(-1)?.role === 'user', 'The last message must be from the user.'),
  /** Restrict answers to these documents; omit to search everything. */
  documentIds: z.array(z.uuid()).max(100).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const SourceDto = z.object({
  /** The number the answer cites, e.g. [2]. */
  n: z.number().int(),
  chunkId: z.uuid(),
  documentId: z.uuid(),
  filename: z.string(),
  heading: z.string().nullable(),
  pageStart: z.number().int().nullable(),
  pageEnd: z.number().int().nullable(),
  content: z.string(),
  similarity: z.number().nullable(),
  vectorRank: z.number().int().nullable(),
  keywordRank: z.number().int().nullable(),
});
export type SourceDto = z.infer<typeof SourceDto>;

export const AnswerOutcome = z.enum([
  'answered',
  /** The relevance gate found nothing related; the LLM was not called. */
  'no_relevant_sources',
  'refused',
  'truncated',
]);
export type AnswerOutcome = z.infer<typeof AnswerOutcome>;

/**
 * Server-sent events streamed by POST /api/chat, in order:
 * one `retrieval`, zero or more `delta`, then `done` or `error`.
 */
export const ChatEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('retrieval'),
    /** The query actually searched (rewritten from the question when there is history). */
    query: z.string(),
    rewritten: z.boolean(),
    relevant: z.boolean(),
    sources: z.array(SourceDto),
    stats: z.object({
      vectorHits: z.number().int(),
      keywordHits: z.number().int(),
      topSimilarity: z.number().nullable(),
    }),
  }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    outcome: AnswerOutcome,
    /** Source numbers cited in the answer that refer to a real source. */
    citations: z.array(z.number().int()),
    /** Citations that pointed at no source (logged as a quality signal). */
    invalidCitations: z.array(z.number().int()),
    model: z.string(),
    usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }),
    timings: z.object({
      rewriteMs: z.number(),
      retrievalMs: z.number(),
      firstTokenMs: z.number().nullable(),
      totalMs: z.number(),
    }),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;
