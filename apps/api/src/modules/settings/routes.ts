/**
 * Settings and notification endpoints (FR-0690, FR-0695, FR-0700, FR-0710, FR-0720, FR-0065, FR-0066).
 * Administrators change the rules here; every change is audited with the section, who changed it and the old and new
 * values. Administrators change policy only: this module has no path to bid content (SEC-AC13).
 */
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_NAMES, primaryRole, type Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { appUser, notification, notificationDelivery } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { FIELD_BY_KEY } from '../intake/fields.js';
import { sweepGrants } from '../admin/grants.js';
import { assertSettable } from '../b10ai/service.js';
import { refusable } from '../b11priv/outbound.js';
import { EscalationService } from '../notify/dispatch.js';
import {
  SECTIONS,
  SECTION_NAMES,
  formatNumber,
  loadSettings,
  mapRecord,
  saveSettings,
  type Layout,
  type Settings,
} from './settings.js';

export interface SettingsDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
  /** Minutes between scheduled escalation runs; omit to run only on request (tests, one-shot scripts). */
  schedulerMinutes?: number | undefined;
}

const STAFF = ROLE_NAMES.filter((r) => r !== 'SUPPLIER');
const updateBody = z
  .object(
    Object.fromEntries(SECTION_NAMES.map((n) => [n, SECTIONS[n].optional()])) as {
      [K in keyof typeof SECTIONS]: z.ZodOptional<(typeof SECTIONS)[K]>;
    },
  )
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Send at least one section' });

/** Cross-field rules a single-section schema cannot see. Returns the problems found. */
export function crossCheck(next: Settings): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];
  const custom = new Set(next.customFields.map((c) => c.key));
  for (const c of next.customFields)
    if (FIELD_BY_KEY.has(c.key))
      problems.push({ field: 'customFields', message: `"${c.key}" is already a built-in field name` });
  for (const key of Object.keys(next.fieldLabels))
    if (!FIELD_BY_KEY.has(key) && !custom.has(key))
      problems.push({ field: 'fieldLabels', message: `"${key}" is not a field that can be relabelled` });
  for (const role of Object.keys(next.intake.layouts))
    if (!(STAFF as readonly string[]).includes(role))
      problems.push({ field: 'intake.layouts', message: `"${role}" is not a staff role` });
  return problems;
}

const view = (s: Settings, now: Date) => ({
  ...s,
  numberingExample: formatNumber(s.numbering, now, 7),
});

export function registerSettingsRoutes(app: FastifyInstance, p: string, d: SettingsDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const escalations = new EscalationService(d.clock, d.audit);
  if (d.schedulerMinutes) {
    const h = setInterval(() => {
      void escalations.runDue(d.database).catch(() => undefined);
      void sweepGrants(d.database, d.clock, d.audit, d.sessions).catch(() => undefined);
    }, d.schedulerMinutes * 60_000);
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }

  reg('GET', '/admin/settings');
  app.get(`${p}/admin/settings`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) =>
      view(await loadSettings(tx, a.user.tenantId), d.clock.now()),
    );
  });

  reg('PUT', '/admin/settings');
  app.put(`${p}/admin/settings`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const body = parse(updateBody, req.body);
    return refusable(d.database, a.ctx, async (tx) => {
      const current = await loadSettings(tx, a.user.tenantId);
      // the hosting country and the egress allow-list change only on the residency page, with a reason (NFR-R02, SEC-D05)
      for (const guarded of ['residency', 'egress'] as const)
        if (body[guarded] !== undefined && JSON.stringify(body[guarded]) !== JSON.stringify(current[guarded]))
          throw new AppError(
            422,
            'USE_RESIDENCY_PAGE',
            'The hosting country, allowed regions and egress allow-list are changed on the Residency page, which asks for a reason',
            [{ field: guarded, message: 'Change this on /admin/residency' }],
          );
      const merged = {
        ...current,
        ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
      };
      const problems = crossCheck(merged as Settings);
      if (problems.length > 0)
        throw new AppError(422, 'VALIDATION_FAILED', 'Some settings are not valid', problems);
      // a third-party AI model can be named only once it is approved for this organisation (SEC-TP07)
      if (body.ai) await assertSettable(tx, a.user.tenantId, body.ai, a.user.id);
      const { before, after } = await saveSettings(tx, a.user.tenantId, body as Partial<Settings>);
      // one audit event per changed section: who, which setting, the old and the new value (FR-0690)
      for (const name of SECTION_NAMES) {
        if (body[name] === undefined) continue;
        if (JSON.stringify(before[name]) === JSON.stringify(after[name])) continue;
        await d.audit.record(tx, a.ctx, {
          action: `settings.${name}`,
          entityType: 'tenant',
          entityId: a.user.tenantId,
          before: { [name]: before[name] },
          after: { [name]: after[name] },
        });
      }
      return view(after, d.clock.now());
    });
  });

  reg('GET', '/settings');
  app.get(`${p}/settings`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const mine = primaryRole(a.user.roles);
      const layout: Layout = s.intake.layouts[mine] ?? 'LIST';
      return {
        fieldLabels: s.fieldLabels,
        customFields: s.customFields,
        layout,
        layouts: s.intake.layouts,
        taxonomy: s.intake.taxonomy,
      };
    });
  });

  reg('POST', '/admin/erp-mapping/preview');
  app.post(`${p}/admin/erp-mapping/preview`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const body = parse(
      z
        .object({
          direction: z.enum(['INBOUND', 'OUTBOUND']),
          record: z.record(
            z.string().max(60),
            z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
          ),
        })
        .strict(),
      req.body,
    );
    return withContext(d.database, a.ctx, async (tx) => ({
      direction: body.direction,
      record: mapRecord((await loadSettings(tx, a.user.tenantId)).erpFieldMap, body.record, body.direction),
    }));
  });

  reg('POST', '/admin/notifications/run-escalations');
  app.post(`${p}/admin/notifications/run-escalations`, { preHandler: guard(d, ['ADMIN']) }, async () => ({
    escalated: await escalations.runDue(d.database),
  }));

  reg('GET', '/admin/notification-log');
  app.get(`${p}/admin/notification-log`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({
          id: notificationDelivery.id,
          channel: notificationDelivery.channel,
          status: notificationDelivery.status,
          detail: notificationDelivery.detail,
          createdAt: notificationDelivery.createdAt,
          title: notification.title,
          recipient: appUser.name,
        })
        .from(notificationDelivery)
        .innerJoin(notification, eq(notification.id, notificationDelivery.notificationId))
        .innerJoin(appUser, eq(appUser.id, notification.userId))
        .where(eq(notificationDelivery.tenantId, a.user.tenantId))
        .orderBy(desc(notificationDelivery.createdAt))
        .limit(100);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), detail: r.detail ?? undefined }));
    });
  });

  return done;
}
