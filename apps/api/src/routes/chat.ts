import { type ChatEvent, ChatRequest } from '@docchat/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AnswerQuestion } from '../services/answer-question.js';

export interface ChatRouteDeps {
  answer: Pick<AnswerQuestion, 'execute'>;
}

/**
 * POST /api/chat streams the answer as Server-Sent Events. POST (not GET +
 * EventSource) because the request carries the conversation; the browser
 * reads the stream with fetch().
 */
export const chatRoutes =
  ({ answer }: ChatRouteDeps, limits: { perMinute: number }): FastifyPluginAsyncZod =>
  async (app) => {
    const options = {
      schema: { body: ChatRequest },
      // Every chat request can cost LLM tokens, so it gets a tighter limit than the API default.
      config: { rateLimit: { max: limits.perMinute, timeWindow: '1 minute' } },
    };
    app.post('/chat', options, async (req, reply) => {
      // If the user navigates away, stop generating (and paying for) tokens.
      const controller = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) controller.abort();
      });

      // Validation has passed; from here on we write the response ourselves.
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no', // tell nginx-style proxies not to buffer
        'x-request-id': req.id,
      });
      const send = (event: ChatEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

      try {
        for await (const event of answer.execute(req.body, {
          signal: controller.signal,
          requestId: req.id,
        })) {
          if (controller.signal.aborted) break;
          send(event);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          req.log.error({ err }, 'chat failed');
          send({ type: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
        }
      } finally {
        reply.raw.end();
      }
    });
  };
