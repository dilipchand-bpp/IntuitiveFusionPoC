import { describe, expect, it } from 'vitest';
import { loadConfig } from '@if/shared';
import { freshDb, newClock } from './test-helpers.js';
import { buildApp } from './app.js';

const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(32), API_PORT: '0' });

const build = async () => buildApp(config, { database: await freshDb(), clock: newClock() });

describe('API skeleton', () => {
  it('GET /health returns ok with a correlation id', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    expect(res.headers['x-correlation-id']).toBeTruthy();
    await app.close();
  });
  it('echoes a supplied correlation id', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'abc-123' },
    });
    expect(res.headers['x-correlation-id']).toBe('abc-123');
    await app.close();
  });
  it('unknown routes return RFC 7807 problem+json without internals', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(JSON.stringify(res.json())).not.toMatch(/stack|node_modules/i);
    await app.close();
  });
  it('sets security headers (helmet)', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });
  it('smoke: really listens on a port and answers over HTTP', async () => {
    const app = await build();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { simulatedAi: boolean }).simulatedAi).toBe(true);
    await app.close();
  });
});
