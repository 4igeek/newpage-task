import { HealthResponse } from '@docchat/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../app.js';

/**
 * Liveness + dependency check. Returns 503 when the database is unreachable
 * so a load balancer / orchestrator can take the instance out of rotation.
 */
export const healthRoutes =
  (health: AppDeps['health']): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/health',
      {
        schema: { response: { 200: HealthResponse, 503: HealthResponse } },
        // Load balancers and Docker poll this constantly; never limit it.
        config: { rateLimit: false },
      },
      async (req, reply) => {
        try {
          await health.pingDatabase();
          return { status: 'ok', checks: { database: 'ok' } } as const;
        } catch (err) {
          req.log.warn({ err }, 'database health check failed');
          return reply
            .status(503)
            .send({ status: 'degraded', checks: { database: 'unreachable' } });
        }
      },
    );
  };
