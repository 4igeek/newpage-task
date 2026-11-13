import { randomUUID } from 'node:crypto';
import type { ApiError } from '@docchat/shared';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { DomainError, type DomainErrorCode } from './domain/errors.js';
import type { TraceStore } from './ports/index.js';
import { type ChatRouteDeps, chatRoutes } from './routes/chat.js';
import { type DocumentRouteDeps, documentRoutes } from './routes/documents.js';
import { healthRoutes } from './routes/health.js';
import { traceRoutes } from './routes/traces.js';

/**
 * Everything the HTTP layer needs from the outside world. Routes depend on
 * services and narrow interfaces, never on concrete adapters, so tests can
 * pass in fakes and the composition root (main.ts) is the only place that
 * wires up real infrastructure.
 */
export interface AppDeps {
  health: { pingDatabase(): Promise<void> };
  documents: DocumentRouteDeps;
  chat: ChatRouteDeps;
  traces: TraceStore;
  settings: {
    maxUploadBytes: number;
    rateLimit: { globalPerMinute: number; chatPerMinute: number; uploadPerMinute: number };
  };
}

/** The HTTP meaning of each domain error. Kept here so services stay HTTP-agnostic. */
const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  UNSUPPORTED_FILE_TYPE: 415,
  EMPTY_FILE: 400,
  NOT_FOUND: 404,
  NO_EXTRACTABLE_TEXT: 422,
  LLM_NOT_CONFIGURED: 503,
  LLM_AUTH_FAILED: 502,
  LLM_RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 502,
};

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify({
    // Honour an incoming x-request-id (e.g. from a load balancer) so a request
    // can be traced across services; otherwise mint one.
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 ? header : randomUUID();
    },
    ...opts,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const { statusCode, code, message } = describeError(err);
    if (statusCode >= 500) req.log.error({ err }, 'unhandled error');
    const body: ApiError = { error: { code, message, requestId: req.id } };
    return reply.status(statusCode).send(body);
  });

  // Per-IP limits. In-memory, so each API instance counts separately; with
  // several instances, this needs a shared store (Redis) or limits at the edge.
  app.register(rateLimit, {
    max: deps.settings.rateLimit.globalPerMinute,
    timeWindow: '1 minute',
    // The plugin *throws* what this returns, so it must be an Error for the
    // error handler above to turn it into a 429 rather than a 500.
    errorResponseBuilder: (_req, context) =>
      Object.assign(new Error(`Too many requests. Try again in ${context.after}.`), {
        statusCode: context.statusCode,
        code: 'RATE_LIMITED',
      }),
  });

  app.register(multipart, {
    limits: { fileSize: deps.settings.maxUploadBytes, files: 1, fields: 0 },
  });
  app.register(healthRoutes(deps.health), { prefix: '/api' });
  app.register(
    documentRoutes(deps.documents, { uploadPerMinute: deps.settings.rateLimit.uploadPerMinute }),
    { prefix: '/api' },
  );
  app.register(chatRoutes(deps.chat, { perMinute: deps.settings.rateLimit.chatPerMinute }), {
    prefix: '/api',
  });
  app.register(traceRoutes(deps.traces), { prefix: '/api' });

  return app;
}

export type App = ReturnType<typeof buildApp>;

function describeError(err: unknown): { statusCode: number; code: string; message: string } {
  if (err instanceof DomainError) {
    return { statusCode: DOMAIN_ERROR_STATUS[err.code], code: err.code, message: err.message };
  }
  if (isFastifyError(err) && (err.statusCode ?? 500) < 500) {
    // Validation errors, 413 from multipart, etc. are safe to echo to the client.
    return { statusCode: err.statusCode ?? 400, code: err.code, message: err.message };
  }
  // Never leak internals on 5xx.
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

function isFastifyError(err: unknown): err is FastifyError {
  return err instanceof Error && 'statusCode' in err;
}
