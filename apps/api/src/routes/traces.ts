import {
  type TraceDto,
  TraceListQuery,
  TraceListResponse,
  TraceStats,
  TraceStatsQuery,
} from '@docchat/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { StoredTrace, TraceStore } from '../ports/index.js';

/**
 * Read-only observability endpoints.
 *
 * These expose users' questions and answers, so in production they would sit
 * behind admin authentication (or only be reachable on an internal network).
 * The app has no auth yet; see "Skipped: authentication" in the README.
 */
export const traceRoutes =
  (traces: TraceStore): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/traces',
      { schema: { querystring: TraceListQuery, response: { 200: TraceListResponse } } },
      async (req) => ({ traces: (await traces.recent(req.query.limit)).map(toDto) }),
    );

    app.get(
      '/traces/stats',
      { schema: { querystring: TraceStatsQuery, response: { 200: TraceStats } } },
      async (req) => {
        const since = new Date(Date.now() - req.query.hours * 60 * 60 * 1000);
        return { since: since.toISOString(), ...(await traces.stats(since)) };
      },
    );
  };

function toDto(trace: StoredTrace): TraceDto {
  return { ...trace, createdAt: trace.createdAt.toISOString() };
}
