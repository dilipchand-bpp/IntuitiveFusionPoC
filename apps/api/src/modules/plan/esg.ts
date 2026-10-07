/**
 * ESG and social objectives on a procurement plan (FR-0095): carbon ceiling, local labour content, diversity-owned
 * vendor target and socio-economic tags. They are stored against the plan, written into the plan's ESG section,
 * carried into the tender pack and counted in the ESG report.
 */
import { openFieldRows } from '../b11enc/projects.js';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { fieldValue, plan, request } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';

export interface Esg {
  carbonCeilingKg?: number;
  localLabourPct?: number;
  diversityOwnedTarget?: number;
  socioEconomic: string[];
}

const KEYS = {
  carbonCeilingKg: 'esg.carbonCeilingKg',
  localLabourPct: 'esg.localLabourPct',
  diversityOwnedTarget: 'esg.diversityOwnedTarget',
  socioEconomic: 'esg.socioEconomic',
} as const;
export const SOCIO_TAGS = [
  'Indigenous business',
  'Regional supplier',
  'Social enterprise',
  'Disability enterprise',
  'Women-owned business',
  'Veteran-owned business',
  'Net zero commitment',
] as const;

export function esgFrom(rows: Array<{ key: string; value: string | null }>): Esg {
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? undefined;
  const num = (k: string) => {
    const v = get(k);
    return v !== undefined && v !== '' ? Number(v) : undefined;
  };
  const tags = get(KEYS.socioEconomic);
  return {
    ...(num(KEYS.carbonCeilingKg) !== undefined ? { carbonCeilingKg: num(KEYS.carbonCeilingKg)! } : {}),
    ...(num(KEYS.localLabourPct) !== undefined ? { localLabourPct: num(KEYS.localLabourPct)! } : {}),
    ...(num(KEYS.diversityOwnedTarget) !== undefined
      ? { diversityOwnedTarget: num(KEYS.diversityOwnedTarget)! }
      : {}),
    socioEconomic: tags ? (JSON.parse(tags) as string[]) : [],
  };
}

/** The wording used in the plan section and, unchanged, in the tender pack. */
export function esgText(e: Esg): string {
  const lines: string[] = [];
  if (e.carbonCeilingKg !== undefined)
    lines.push(
      `Carbon: respondents are asked to keep estimated emissions for this contract at or below ${e.carbonCeilingKg.toLocaleString('en-AU')} kg CO2-e, or to offset the difference.`,
    );
  if (e.localLabourPct !== undefined)
    lines.push(
      `Local content: at least ${e.localLabourPct}% of labour hours are to be delivered by domestic or regional labour.`,
    );
  if (e.diversityOwnedTarget !== undefined)
    lines.push(
      `Supplier diversity: the organisation seeks ${e.diversityOwnedTarget}% of spend with diversity-owned businesses.`,
    );
  if (e.socioEconomic.length > 0)
    lines.push(`Social and economic objectives: ${e.socioEconomic.join(', ')}.`);
  return lines.length > 0 ? lines.join('\n\n') : '';
}

const body = z
  .object({
    carbonCeilingKg: z.number().min(0).max(1e9).nullable().optional(),
    localLabourPct: z.number().min(0).max(100).nullable().optional(),
    diversityOwnedTarget: z.number().min(0).max(100).nullable().optional(),
    socioEconomic: z.array(z.enum(SOCIO_TAGS)).max(10).optional(),
  })
  .strict();

export interface EsgDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

export function registerEsgRoutes(app: FastifyInstance, p: string, d: EsgDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const idp = z.object({ id: z.string().uuid() });

  async function load(tx: Parameters<Parameters<typeof withContext>[2]>[0], tenantId: string, id: string) {
    const [pl] = await tx
      .select()
      .from(plan)
      .where(and(eq(plan.id, id), eq(plan.tenantId, tenantId)));
    if (!pl) throw new AppError(404, 'NOT_FOUND', 'Plan not found');
    const rows = await openFieldRows(
      tx,
      tenantId,
      pl.requestId,
      await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, id))),
    );
    return { pl, rows };
  }

  reg('GET', '/plans/{id}/esg');
  app.get(
    `${p}/plans/:id/esg`,
    { preHandler: guard(d, ['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'PROBITY', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idp, req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const { pl, rows } = await load(tx, a.user.tenantId, id);
        if (a.user.roles.length === 1 && a.user.roles[0] === 'REQUESTER') {
          const [r] = await tx.select().from(request).where(eq(request.id, pl.requestId));
          if (r?.requesterId !== a.user.id) throw new AppError(404, 'NOT_FOUND', 'Plan not found');
        }
        return { ...esgFrom(rows), options: SOCIO_TAGS, locked: pl.locked };
      });
    },
  );

  reg('PUT', '/plans/{id}/esg');
  app.put(`${p}/plans/:id/esg`, { preHandler: guard(d, ['PROCUREMENT', 'REQUESTER']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idp, req.params);
    const b = parse(body, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const { pl, rows } = await load(tx, a.user.tenantId, id);
      const [r] = await tx.select().from(request).where(eq(request.id, pl.requestId));
      const mine = a.user.roles.includes('PROCUREMENT') || r?.requesterId === a.user.id;
      if (!mine) throw new AppError(404, 'NOT_FOUND', 'Plan not found');
      if (pl.locked) throw new AppError(423, 'PLAN_LOCKED', 'This plan is approved and locked');
      const before = esgFrom(rows);
      const now = d.clock.now();
      const put = async (key: string, label: string, value: string | null) => {
        const set = {
          value,
          source: 'USER' as const,
          aiDrafted: false,
          missing: false,
          updatedBy: a.user.id,
          updatedAt: now,
        };
        await tx
          .insert(fieldValue)
          .values({ tenantId: a.user.tenantId, ownerType: 'PLAN', ownerId: id, key, label, ...set })
          .onConflictDoUpdate({ target: [fieldValue.ownerType, fieldValue.ownerId, fieldValue.key], set });
      };
      const next: Esg = { ...before };
      if (b.carbonCeilingKg !== undefined) {
        if (b.carbonCeilingKg === null) delete next.carbonCeilingKg;
        else next.carbonCeilingKg = b.carbonCeilingKg;
        await put(
          KEYS.carbonCeilingKg,
          'Carbon offset ceiling (kg)',
          b.carbonCeilingKg === null ? null : String(b.carbonCeilingKg),
        );
      }
      if (b.localLabourPct !== undefined) {
        if (b.localLabourPct === null) delete next.localLabourPct;
        else next.localLabourPct = b.localLabourPct;
        await put(
          KEYS.localLabourPct,
          'Domestic or regional labour content (%)',
          b.localLabourPct === null ? null : String(b.localLabourPct),
        );
      }
      if (b.diversityOwnedTarget !== undefined) {
        if (b.diversityOwnedTarget === null) delete next.diversityOwnedTarget;
        else next.diversityOwnedTarget = b.diversityOwnedTarget;
        await put(
          KEYS.diversityOwnedTarget,
          'Diversity-owned vendor target (%)',
          b.diversityOwnedTarget === null ? null : String(b.diversityOwnedTarget),
        );
      }
      if (b.socioEconomic !== undefined) {
        next.socioEconomic = b.socioEconomic;
        await put(KEYS.socioEconomic, 'Socio-economic tags', JSON.stringify(b.socioEconomic));
      }
      // the readable plan section follows the structured values
      await put(
        'esg',
        'Sustainability and social goals',
        esgText(next) || 'No ESG or social objectives have been set yet.',
      );
      await d.audit.record(tx, a.ctx, {
        action: 'plan.esg_update',
        entityType: 'plan',
        entityId: id,
        before: { ...before },
        after: { ...next },
      });
      return { ...next, options: SOCIO_TAGS, locked: false };
    });
  });

  return done;
}
