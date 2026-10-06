/** Connector rows, their health, and the rules for what a connector's configuration may hold (NFR-C07, SEC-N03). */
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../../db/client.js';
import { connector, integrationEvent, manualTask, secretEntry } from '../../db/schema.js';
import { CATALOGUE, CONNECTOR_KINDS, providerEntry, type ConnectorKind } from './catalogue.js';
import { connectorSecretName } from './secrets.js';

export type ConnectorRow = typeof connector.$inferSelect;

/** Keys whose names suggest a secret are refused: a connector's config holds the NAME of a secret, never its value. */
const SECRETISH = /(secret|password|passwd|token|api[-_]?key|private[-_]?key|credential|bearer)/i;
const NAME_SUFFIX = /(name|ref)$/i;

export const configSchema = z
  .record(z.string().min(1).max(60), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
  .superRefine((cfg, ctx) => {
    if (Object.keys(cfg).length > 30)
      ctx.addIssue({ code: 'custom', message: 'Too many settings (30 at most)' });
    for (const [k, v] of Object.entries(cfg)) {
      if (SECRETISH.test(k) && !NAME_SUFFIX.test(k))
        ctx.addIssue({
          code: 'custom',
          path: [k],
          message: `"${k}" looks like a secret. Store the value in the secret store and put only its name here (for example "secretName")`,
        });
      if (typeof v === 'string' && /^(sk|pk|xox[bp]|ghp|AKIA)[-_A-Za-z0-9]{12,}$/.test(v))
        ctx.addIssue({
          code: 'custom',
          path: [k],
          message: 'This value looks like a credential. Use the secret store.',
        });
    }
  });

export const kindParam = z.object({
  kind: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(CONNECTOR_KINDS)),
});

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'CIRCUIT_OPEN' | 'RECOVERING' | 'DISABLED';
export function healthOf(c: ConnectorRow): HealthState {
  if (!c.enabled) return 'DISABLED';
  if (c.mode === 'DOWN') return 'DOWN';
  if (c.breakerState === 'OPEN') return 'CIRCUIT_OPEN';
  if (c.breakerState === 'HALF_OPEN') return 'RECOVERING';
  if (c.consecutiveFailures > 0) return 'DEGRADED';
  return 'HEALTHY';
}

export async function getConnector(
  tx: Tx,
  tenantId: string,
  kind: ConnectorKind,
): Promise<ConnectorRow | undefined> {
  const [row] = await tx
    .select()
    .from(connector)
    .where(and(eq(connector.tenantId, tenantId), eq(connector.kind, kind)));
  return row;
}

export async function connectorViews(tx: Tx, tenantId: string) {
  const rows = await tx.select().from(connector).where(eq(connector.tenantId, tenantId));
  const secrets = await tx
    .select({
      name: secretEntry.name,
      version: secretEntry.version,
      fp: secretEntry.fingerprint,
      at: secretEntry.createdAt,
    })
    .from(secretEntry)
    .where(eq(secretEntry.tenantId, tenantId));
  const tasks = await tx
    .select({ k: manualTask.connectorKind, n: count() })
    .from(manualTask)
    .where(and(eq(manualTask.tenantId, tenantId), eq(manualTask.status, 'OPEN')))
    .groupBy(manualTask.connectorKind);
  const events = await tx
    .select({ k: integrationEvent.connectorKind, s: integrationEvent.status, n: count() })
    .from(integrationEvent)
    .where(
      and(
        eq(integrationEvent.tenantId, tenantId),
        eq(integrationEvent.direction, 'OUT'),
        inArray(integrationEvent.status, ['PENDING', 'FAILED', 'DEAD_LETTER']),
      ),
    )
    .groupBy(integrationEvent.connectorKind, integrationEvent.status);
  const view = (c: ConnectorRow) => {
    const sname = connectorSecretName(c.kind);
    const cur = secrets.filter((s) => s.name === sname).sort((a, b) => b.version - a.version)[0];
    const waiting = (st: string) =>
      events.filter((e) => e.k === c.kind && e.s === st).reduce((m, e) => m + Number(e.n), 0);
    return {
      kind: c.kind,
      provider: c.provider,
      providerLabel: providerEntry(c.kind, c.provider)?.label ?? c.provider,
      simulated: true,
      enabled: c.enabled,
      mode: c.mode,
      config: c.config as Record<string, unknown>,
      health: {
        state: healthOf(c),
        breaker: {
          state: c.breakerState,
          consecutiveFailures: c.consecutiveFailures,
          openedAt: c.breakerOpenedAt?.toISOString() ?? null,
        },
        lastOkAt: c.lastOkAt?.toISOString() ?? null,
        lastError: c.lastError,
      },
      secret: {
        name: sname,
        set: Boolean(cur),
        version: cur?.version ?? null,
        fingerprint: cur?.fp ?? null,
        lastRotatedAt: cur?.at.toISOString() ?? null,
      },
      openManualTasks: Number(tasks.find((t) => t.k === c.kind)?.n ?? 0),
      queued: { pending: waiting('PENDING'), failed: waiting('FAILED'), deadLetter: waiting('DEAD_LETTER') },
      updatedAt: c.updatedAt.toISOString(),
    };
  };
  return CONNECTOR_KINDS.map((k) => rows.find((r) => r.kind === k)).flatMap((r) => (r ? [view(r)] : []));
}

export const catalogueView = () =>
  CATALOGUE.map((k) => ({
    kind: k.kind,
    label: k.label,
    description: k.description,
    providers: k.providers,
  }));
