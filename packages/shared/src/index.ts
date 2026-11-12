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
