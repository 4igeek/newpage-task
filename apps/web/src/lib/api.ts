/**
 * Typed API client. Responses are parsed with the same Zod schemas the server
 * validates against, so a contract mismatch fails loudly at the boundary
 * instead of as `undefined` deep inside a component.
 */
import {
  ApiError,
  type ChatEvent,
  type ChatRequest,
  type DocumentDto,
  DocumentListResponse,
  HealthResponse,
  UploadResponse,
} from '@docchat/shared';
import type { z } from 'zod';
import { parseSse } from './sse';

/** An error response from the API, with the server's error code and request ID. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, init);
  if (res.ok) return res;

  const parsed = ApiError.safeParse(await res.json().catch(() => null));
  if (parsed.success) {
    const { code, message, requestId } = parsed.data.error;
    throw new ApiRequestError(res.status, code, message, requestId);
  }
  throw new ApiRequestError(res.status, `HTTP_${res.status}`, `Request failed (${res.status}).`);
}

async function json<T extends z.ZodType>(path: string, schema: T, init?: RequestInit) {
  const res = await send(path, init);
  return schema.parse(await res.json()) as z.infer<T>;
}

export const api = {
  /** Health returns a valid body on 503 too, so it is parsed regardless of status. */
  async health(): Promise<HealthResponse> {
    const res = await fetch('/api/health');
    return HealthResponse.parse(await res.json());
  },

  async listDocuments(): Promise<DocumentDto[]> {
    return (await json('/documents', DocumentListResponse)).documents;
  },

  uploadDocument(file: File): Promise<UploadResponse> {
    const body = new FormData();
    body.append('file', file);
    return json('/documents', UploadResponse, { method: 'POST', body });
  },

  async deleteDocument(id: string): Promise<void> {
    await send(`/documents/${id}`, { method: 'DELETE' });
  },

  /** Streams the answer as events. Aborting `signal` stops generation server-side too. */
  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const res = await send('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal && { signal }),
    });
    if (!res.body) throw new ApiRequestError(res.status, 'EMPTY_RESPONSE', 'Empty response.');
    yield* parseSse(res.body);
  },
};
