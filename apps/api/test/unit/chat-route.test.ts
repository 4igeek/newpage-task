import { ChatEvent } from '@docchat/shared';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

function parseSse(body: string) {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => ChatEvent.parse(JSON.parse(frame.slice('data: '.length))));
}

describe('POST /api/chat', () => {
  it('streams contract-valid server-sent events', async () => {
    const { app } = buildTestApp({
      chat: {
        answer: {
          async *execute() {
            yield { type: 'delta', text: 'Hello' };
            yield { type: 'error', code: 'X', message: 'y' };
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(parseSse(res.body)).toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'error', code: 'X', message: 'y' },
    ]);
  });

  it('turns an unexpected failure mid-stream into a generic error event', async () => {
    const { app } = buildTestApp({
      chat: {
        answer: {
          // biome-ignore lint/correctness/useYield: simulates a failure before the first event
          async *execute() {
            throw new Error('database exploded with secrets');
          },
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(parseSse(res.body)).toEqual([
      { type: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    ]);
  });

  it.each([
    ['no messages', { messages: [] }],
    ['last message from the assistant', { messages: [{ role: 'assistant', content: 'hi' }] }],
    ['blank message', { messages: [{ role: 'user', content: '   ' }] }],
    ['bad document id', { messages: [{ role: 'user', content: 'hi' }], documentIds: ['nope'] }],
  ])('rejects %s with 400 before streaming', async (_, payload) => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/chat', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FST_ERR_VALIDATION');
  });
});
