import { describe, expect, it } from 'vitest';
import { buildTestApp, multipartFile } from '../fakes.js';

const limits = { globalPerMinute: 5, chatPerMinute: 2, uploadPerMinute: 1 };
const chat = { messages: [{ role: 'user', content: 'hi' }] };

describe('rate limiting', () => {
  it('limits chat more tightly, with a 429 the client can act on', async () => {
    const { app } = buildTestApp({ settings: { rateLimit: limits } });
    const post = () => app.inject({ method: 'POST', url: '/api/chat', payload: chat });

    expect((await post()).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(200);
    const limited = await post();

    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.json().error.message).toMatch(/Try again in/);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('limits uploads separately from chat', async () => {
    const { app } = buildTestApp({ settings: { rateLimit: limits } });
    const upload = (name: string) =>
      app.inject({ method: 'POST', url: '/api/documents', ...multipartFile(name, name) });

    expect((await upload('a.txt')).statusCode).toBe(201);
    expect((await upload('b.txt')).statusCode).toBe(429);
    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: chat })).statusCode).toBe(
      200,
    );
  });

  it('applies the global limit to other endpoints', async () => {
    const { app } = buildTestApp({ settings: { rateLimit: limits } });
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/api/documents' })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('never limits the health check', async () => {
    const { app } = buildTestApp({ settings: { rateLimit: limits } });
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    }
  });

  it('counts each client IP separately', async () => {
    const { app } = buildTestApp({ settings: { rateLimit: limits } });
    const post = (ip: string) =>
      app.inject({ method: 'POST', url: '/api/chat', payload: chat, remoteAddress: ip });

    await post('10.0.0.1');
    await post('10.0.0.1');
    expect((await post('10.0.0.1')).statusCode).toBe(429);
    expect((await post('10.0.0.2')).statusCode).toBe(200);
  });
});
