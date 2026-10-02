import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.js';
import { idempotencyKey } from '../db/schema.js';

/**
 * Idempotency-Key support for retry-safe mutations (NFR-AV03). A repeated request with the same key returns the
 * stored response without re-running the handler; the same key with a different body is rejected (422).
 *
 * Identity is supplied by `identify(req)` so this plugin has no dependency on how authentication is implemented.
 */
export interface IdempotencyOptions {
  database: Database;
  identify: (req: FastifyRequest) => { tenantId: string; userId: string } | null;
  methods?: string[];
}

const hashBody = (req: FastifyRequest) =>
  createHash('sha256')
    .update(req.method)
    .update(req.url)
    .update(JSON.stringify(req.body ?? null))
    .digest('hex');

export function registerIdempotency(app: FastifyInstance, opts: IdempotencyOptions): void {
  const methods = opts.methods ?? ['POST', 'PUT', 'PATCH'];
  const { db } = opts.database;

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers['idempotency-key'];
    if (!methods.includes(req.method) || typeof key !== 'string') return;
    const who = opts.identify(req);
    if (!who) return;
    if (key.length < 8 || key.length > 128) {
      return reply.status(400).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Idempotency-Key must be 8-128 characters',
        status: 400,
        code: 'VALIDATION_FAILED',
        correlationId: req.id,
      });
    }
    const requestHash = hashBody(req);
    const inserted = await db
      .insert(idempotencyKey)
      .values({
        tenantId: who.tenantId,
        userId: who.userId,
        key,
        method: req.method,
        path: req.url,
        requestHash,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKey.id });
    if (inserted.length === 1) {
      (req as FastifyRequest & { idemId?: string }).idemId = inserted[0]!.id;
      return;
    }
    const [existing] = await db
      .select()
      .from(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.tenantId, who.tenantId),
          eq(idempotencyKey.userId, who.userId),
          eq(idempotencyKey.key, key),
        ),
      );
    if (existing && existing.requestHash !== requestHash) {
      return reply.status(422).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Idempotency-Key reused with a different request',
        status: 422,
        code: 'IDEMPOTENCY_KEY_REUSED',
        correlationId: req.id,
      });
    }
    if (!existing || existing.status === null) {
      return reply.status(409).type('application/problem+json').send({
        type: 'about:blank',
        title: 'A request with this Idempotency-Key is still in progress',
        status: 409,
        code: 'IDEMPOTENCY_IN_PROGRESS',
        correlationId: req.id,
      });
    }
    reply.header('idempotent-replay', 'true');
    return reply.status(existing.status).send(existing.response);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const id = (req as FastifyRequest & { idemId?: string }).idemId;
    if (!id) return payload;
    const parse = (): unknown => {
      try {
        return typeof payload === 'string' ? JSON.parse(payload) : null;
      } catch {
        return null;
      }
    };
    const body = parse();
    await db
      .update(idempotencyKey)
      .set({ status: reply.statusCode, response: body as never })
      .where(eq(idempotencyKey.id, id));
    return payload;
  });
}
