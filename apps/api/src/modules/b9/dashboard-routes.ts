/**
 * A person's own dashboard (FR-0850): which widgets, in what order, how big, and in what style (cards, bars, a line, a donut, a
 * table, or a solid-looking bar). The widgets are defined here, with the reports each draws on and who may see them, so a person
 * can only ever choose from what their role could already open; a chosen widget whose report they cannot read simply is not offered.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoleName } from '@if/shared';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { userDashboard } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';

export const STYLES = ['CARDS', 'BAR', 'BAR3D', 'LINE', 'DONUT', 'TABLE'] as const;
export type Style = (typeof STYLES)[number];
export const SIZES = ['S', 'M', 'L'] as const;
const STAFF: RoleName[] = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'ADMIN',
  'EXEC',
];
const MONEY: RoleName[] = ['EXEC', 'FINANCE', 'PROCUREMENT'];

export interface WidgetDef {
  key: string;
  title: string;
  description: string;
  /** The report the widget draws on. */
  source: string;
  roles: RoleName[];
  styles: Style[];
  defaultStyle: Style;
  defaultSize: (typeof SIZES)[number];
}
export const WIDGETS: WidgetDef[] = [
  {
    key: 'kpis',
    title: 'Key numbers',
    description: 'Active procurements, value in flight, average cycle time and what waits for you.',
    source: '/dashboard/kpis',
    roles: STAFF,
    styles: ['CARDS', 'TABLE'],
    defaultStyle: 'CARDS',
    defaultSize: 'L',
  },
  {
    key: 'phases',
    title: 'Procurements by phase',
    description: 'How many procurements sit in each phase.',
    source: '/dashboard/kpis',
    roles: STAFF,
    styles: ['BAR', 'BAR3D', 'DONUT', 'TABLE'],
    defaultStyle: 'BAR',
    defaultSize: 'M',
  },
  {
    key: 'spend',
    title: 'Spend tracker',
    description: 'Committed and in the pipeline, by category.',
    source: '/reports/spend',
    roles: MONEY,
    styles: ['BAR', 'BAR3D', 'DONUT', 'TABLE'],
    defaultStyle: 'BAR',
    defaultSize: 'M',
  },
  {
    key: 'savings',
    title: 'Savings',
    description: 'Estimate less award, by procurement.',
    source: '/reports/performance',
    roles: MONEY,
    styles: ['BAR', 'BAR3D', 'TABLE', 'CARDS'],
    defaultStyle: 'BAR',
    defaultSize: 'M',
  },
  {
    key: 'velocity',
    title: 'Time in each phase',
    description: 'Average days a procurement spends in each phase.',
    source: '/reports/performance',
    roles: MONEY,
    styles: ['BAR', 'LINE', 'TABLE'],
    defaultStyle: 'BAR',
    defaultSize: 'M',
  },
  {
    key: 'commitment',
    title: 'Committed for future years',
    description: 'What is committed or expected for each financial year ahead.',
    source: '/reports/future-commitment',
    roles: [...MONEY, 'CONTRACT_MGR'],
    styles: ['BAR', 'BAR3D', 'LINE', 'TABLE'],
    defaultStyle: 'BAR',
    defaultSize: 'M',
  },
  {
    key: 'optimisation',
    title: 'Spend optimisation',
    description: 'Where money could be saved, by kind of opportunity.',
    source: '/reports/optimisation',
    roles: [...MONEY, 'CONTRACT_MGR'],
    styles: ['BAR', 'DONUT', 'TABLE', 'CARDS'],
    defaultStyle: 'CARDS',
    defaultSize: 'M',
  },
  {
    key: 'esg',
    title: 'ESG and diverse suppliers',
    description: 'Spend with diverse-owned suppliers, and carbon data reported.',
    source: '/reports/diversity',
    roles: ['PROCUREMENT', 'EXEC', 'FINANCE'],
    styles: ['DONUT', 'BAR', 'TABLE'],
    defaultStyle: 'DONUT',
    defaultSize: 'M',
  },
  {
    key: 'risk',
    title: 'Supplier risk scores',
    description: 'Suppliers by risk, lowest score first.',
    source: '/reports/supplier-scores',
    roles: ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY'],
    styles: ['BAR', 'TABLE'],
    defaultStyle: 'BAR',
    defaultSize: 'M',
  },
];

export const allowedFor = (roles: readonly string[]) =>
  WIDGETS.filter((w) => w.roles.some((r) => roles.includes(r)));
/** What a person sees until they choose: the key numbers, the phases and, for those who may, the money views. */
export const defaultsFor = (roles: readonly string[]) =>
  allowedFor(roles)
    .filter((w) => ['kpis', 'phases', 'spend', 'commitment'].includes(w.key))
    .map((w) => ({ key: w.key, size: w.defaultSize, style: w.defaultStyle }));

const putBody = z
  .object({
    widgets: z
      .array(z.object({ key: z.string().max(30), size: z.enum(SIZES), style: z.enum(STYLES) }).strict())
      .min(1)
      .max(12),
  })
  .strict();

export function registerDashboardPrefs(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const STAFF_ONLY = [...STAFF];
  const view = (
    roles: readonly string[],
    saved: Array<{ key: string; size: string; style: string }> | null,
  ) => {
    const ok = new Set(allowedFor(roles).map((w) => w.key));
    return {
      custom: saved !== null,
      // a saved widget the person's role can no longer open is left out, not shown broken
      widgets: (saved ?? defaultsFor(roles)).filter((w) => ok.has(w.key)),
      catalogue: allowedFor(roles).map(({ roles: _r, ...w }) => w),
      styles: STYLES,
      sizes: SIZES,
    };
  };

  reg('GET', '/me/dashboard');
  app.get(`${p}/me/dashboard`, { preHandler: guard(d, STAFF_ONLY) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const [row] = await tx.select().from(userDashboard).where(eq(userDashboard.userId, a.user.id));
      return view(
        a.user.roles,
        row ? (row.widgets as Array<{ key: string; size: string; style: string }>) : null,
      );
    });
  });

  reg('PUT', '/me/dashboard');
  app.put(`${p}/me/dashboard`, { preHandler: guard(d, STAFF_ONLY) }, async (req) => {
    const a = req.auth!;
    const body = parse(putBody, req.body);
    const defs = new Map(allowedFor(a.user.roles).map((w) => [w.key, w]));
    const errors: Array<{ field: string; message: string }> = [];
    const seen = new Set<string>();
    for (const [n, w] of body.widgets.entries()) {
      const def = defs.get(w.key);
      if (!def) errors.push({ field: `widgets.${n}.key`, message: `"${w.key}" is not a widget you can use` });
      else if (!def.styles.includes(w.style))
        errors.push({
          field: `widgets.${n}.style`,
          message: `${def.title} can be shown as: ${def.styles.join(', ').toLowerCase()}`,
        });
      if (seen.has(w.key))
        errors.push({ field: `widgets.${n}.key`, message: `${w.key} is in the dashboard twice` });
      seen.add(w.key);
    }
    if (errors.length) throw new AppError(422, 'VALIDATION_FAILED', 'That dashboard cannot be saved', errors);
    return withContext(d.database, a.ctx, async (tx) => {
      await tx
        .insert(userDashboard)
        .values({
          userId: a.user.id,
          tenantId: a.user.tenantId,
          widgets: body.widgets,
          updatedAt: d.clock.now(),
        })
        .onConflictDoUpdate({
          target: userDashboard.userId,
          set: { widgets: body.widgets, updatedAt: d.clock.now() },
        });
      return view(a.user.roles, body.widgets);
    });
  });

  reg('DELETE', '/me/dashboard');
  app.delete(`${p}/me/dashboard`, { preHandler: guard(d, STAFF_ONLY) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      await tx.delete(userDashboard).where(eq(userDashboard.userId, a.user.id));
      return view(a.user.roles, null);
    });
  });
  return done;
}
