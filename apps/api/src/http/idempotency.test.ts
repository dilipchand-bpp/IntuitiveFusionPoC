import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { freshDb } from '../test-helpers.js';
import * as s from '../db/schema.js';
import { registerIdempotency } from './idempotency.js';

async function build() {
  const database = await freshDb();
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await database.db.insert(s.tenant).values({ id: tenantId, slug: 'i', name: 'I', sector: 'PRIVATE' });
  const app = Fastify();
  let sideEffects = 0;
  registerIdempotency(app, {
    database,
    identify: (req) =>
      req.headers['x-test-user'] === 'none'
        ? null
        : { tenantId, userId: (req.headers['x-test-user'] as string) ?? userId },
  });
  app.post('/submit', async (req) => ({ n: ++sideEffects, echo: req.body }));
  app.post('/fail', async (_req, reply) => reply.status(422).send({ error: 'rule failed' }));
  return { app, database, userId, effects: () => sideEffects };
}
const post = (
  app: Awaited<ReturnType<typeof build>>['app'],
  payload: unknown,
  headers: Record<string, string> = {},
  url = '/submit',
) => app.inject({ method: 'POST', url, payload: payload as object, headers });

describe('Idempotency-Key', () => {
  it('replays the stored response and does not repeat the side effect', async () => {
    const { app, effects, database } = await build();
    const a = await post(app, { x: 1 }, { 'idempotency-key': 'key-aaaaaaaa' });
    const b = await post(app, { x: 1 }, { 'idempotency-key': 'key-aaaaaaaa' });
    expect(a.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(effects()).toBe(1);
    await database.close();
  });

  it('without a key every call runs (no accidental deduplication)', async () => {
    const { app, effects, database } = await build();
    await post(app, { x: 1 });
    await post(app, { x: 1 });
    expect(effects()).toBe(2);
    await database.close();
  });

  it('same key with a different body is rejected with 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { app, effects, database } = await build();
    await post(app, { x: 1 }, { 'idempotency-key': 'key-bbbbbbbb' });
    const r = await post(app, { x: 2 }, { 'idempotency-key': 'key-bbbbbbbb' });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(effects()).toBe(1);
    await database.close();
  });

  it('keys are scoped per user: another user can reuse the same key string', async () => {
    const { app, effects, database } = await build();
    await post(app, { x: 1 }, { 'idempotency-key': 'key-cccccccc', 'x-test-user': crypto.randomUUID() });
    await post(app, { x: 1 }, { 'idempotency-key': 'key-cccccccc', 'x-test-user': crypto.randomUUID() });
    expect(effects()).toBe(2);
    await database.close();
  });

  it('rejects malformed keys', async () => {
    const { app, database } = await build();
    expect((await post(app, {}, { 'idempotency-key': 'short' })).statusCode).toBe(400);
    await database.close();
  });

  it('stores failures too, so a retry of a rejected request gets the same rejection', async () => {
    const { app, database } = await build();
    const a = await post(app, { x: 1 }, { 'idempotency-key': 'key-dddddddd' }, '/fail');
    const b = await post(app, { x: 1 }, { 'idempotency-key': 'key-dddddddd' }, '/fail');
    expect([a.statusCode, b.statusCode]).toEqual([422, 422]);
    expect(b.headers['idempotent-replay']).toBe('true');
    await database.close();
  });

  it('ignores unauthenticated callers (no identity => plugin does nothing)', async () => {
    const { app, effects, database } = await build();
    await post(app, {}, { 'idempotency-key': 'key-eeeeeeee', 'x-test-user': 'none' });
    await post(app, {}, { 'idempotency-key': 'key-eeeeeeee', 'x-test-user': 'none' });
    expect(effects()).toBe(2);
    await database.close();
  });
});
