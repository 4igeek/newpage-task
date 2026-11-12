/**
 * Typed API client. Responses are parsed with the same Zod schemas the server
 * validates against, so a contract mismatch fails loudly at the boundary
 * instead of as `undefined` deep inside a component.
 */
import { HealthResponse } from '@docchat/shared';
import type { z } from 'zod';

async function request<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`);
  // Health returns a valid body on 503 too, so parse before checking status.
  const body: unknown = await res.json();
  return schema.parse(body);
}

export const api = {
  health: () => request('/health', HealthResponse),
};
