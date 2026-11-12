import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

describe('GET /api/health', () => {
  it('returns ok when the database responds', async () => {
    const { app } = buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('returns 503 when the database is unreachable', async () => {
    const { app } = buildTestApp({
      health: {
        pingDatabase: async () => {
          throw new Error('connection refused');
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { database: 'unreachable' } });
  });

  it('echoes an incoming x-request-id for cross-service tracing', async () => {
    const { app } = buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'trace-123' },
    });

    expect(res.headers['x-request-id']).toBe('trace-123');
  });
});
