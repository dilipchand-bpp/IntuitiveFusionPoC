import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '@if/shared';

export const API_PREFIX = '/api/v1';

/** Builds the API without listening, so tests can use app.inject(). */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
    genReqId: (req) => (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: false,
  });
  await app.register(helmet);

  // Every response carries the correlation id (Technical Spec section 4).
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
  });

  // RFC 7807 problem+json for every error; never leak internals (Technical Spec sections 4.1, 7).
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    void reply
      .status(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: status >= 500 ? 'Internal error' : err.message,
        status,
        code: status >= 500 ? 'INTERNAL_ERROR' : status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED',
        correlationId: req.id,
      });
  });
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).type('application/problem+json').send({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      correlationId: req.id,
    });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'if-api', time: new Date().toISOString() }));
  app.get(`${API_PREFIX}/health`, async () => ({
    status: 'ok',
    version: '0.1.0',
    simulatedAi: config.AI_PROVIDER === 'mock',
  }));
  return app;
}
