/**
 * Tenant configuration as something a person can see, move and check without a release (NFR-M05), the published browser
 * baseline check (NFR-C08) and nothing else.
 *   GET  /admin/config/inventory   every settings section: fields, default, current value, who changed it last, where to edit it
 *   GET  /admin/config/export      all tenant configuration as JSON (no secrets, no user data)
 *   POST /admin/config/import      validate with the same schemas and show the difference; applies only when dryRun is false
 *   POST /auth/client-check        a signed-in browser reports itself; the server judges it and counts it
 *   GET  /admin/client-baseline    counts by browser and whether it met the baseline
 */
import { and, desc, eq, like, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BASELINE, BROWSER_FAMILIES, checkUserAgent, type Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { auditEvent, clientCheck, tenant } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { crossCheck } from '../settings/routes.js';
import {
  DEFAULTS,
  SECTIONS,
  SECTION_NAMES,
  loadSettings,
  saveSettings,
  type SectionName,
  type Settings,
} from '../settings/settings.js';
import { SECTION_EDITORS, fieldsOf } from './config-inventory.js';
import { assertSettable, namesOf } from './service.js';

export interface ConfigDeps extends GuardDeps {
  clock: Clock;
  audit: AuditService;
}

const FORMAT = 'if-tenant-config';
const SECRET_FIELDS: Partial<Record<SectionName, string[]>> = { legalPlatform: ['webhookSecret'] };

/** A copy of a section that is safe to show or write to a file: secret fields become empty (export) or a marker (display). */
function scrub(name: SectionName, value: unknown, mode: 'export' | 'display'): unknown {
  const secret = SECRET_FIELDS[name];
  if (!secret || typeof value !== 'object' || value === null) return value;
  const out = { ...(value as Record<string, unknown>) };
  for (const f of secret) out[f] = mode === 'export' || !out[f] ? '' : '[set, not shown]';
  return out;
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

function fieldDiff(
  before: unknown,
  after: unknown,
): Array<{ field: string; before: unknown; after: unknown }> {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => !same(before[k], after[k]))
      .map((k) => ({ field: k, before: before[k] ?? null, after: after[k] ?? null }));
  }
  return same(before, after) ? [] : [{ field: '(whole section)', before, after }];
}

const importBody = z
  .object({
    dryRun: z.boolean().default(true),
    config: z
      .object({
        format: z.literal(FORMAT),
        version: z.literal(1),
        sections: z.record(z.string().max(60), z.unknown()),
      })
      .passthrough(),
  })
  .strict();

const checkBody = z
  .object({
    userAgent: z.string().max(400),
    features: z.record(z.string().max(40), z.boolean()).optional(),
  })
  .strict();

export function registerConfigRoutes(app: FastifyInstance, p: string, d: ConfigDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);

  reg('GET', '/admin/config/inventory');
  app.get(`${p}/admin/config/inventory`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const events = await tx
        .select({ action: auditEvent.action, actorId: auditEvent.actorId, at: auditEvent.at })
        .from(auditEvent)
        .where(and(eq(auditEvent.tenantId, a.user.tenantId), like(auditEvent.action, 'settings.%')))
        .orderBy(desc(auditEvent.seq))
        .limit(2000);
      const lastBy = new Map<string, { actorId: string | null; at: Date }>();
      for (const e of events) {
        const sec = e.action.slice('settings.'.length);
        if (!lastBy.has(sec)) lastBy.set(sec, { actorId: e.actorId, at: e.at });
      }
      const names = await namesOf(
        tx,
        [...lastBy.values()].map((x) => x.actorId),
      );
      return {
        count: SECTION_NAMES.length,
        sections: SECTION_NAMES.map((name) => {
          const last = lastBy.get(name);
          return {
            section: name,
            fields: fieldsOf(name),
            default: scrub(name, DEFAULTS[name], 'display'),
            current: scrub(name, s[name], 'display'),
            isDefault: same(s[name], DEFAULTS[name]),
            editor: SECTION_EDITORS[name],
            lastChangedBy: last?.actorId ? (names.get(last.actorId) ?? null) : null,
            lastChangedAt: last?.at.toISOString() ?? null,
          };
        }),
      };
    });
  });

  reg('GET', '/admin/config/export');
  app.get(`${p}/admin/config/export`, { preHandler: guard(d, ['ADMIN']) }, async (req, reply) => {
    const a = req.auth!;
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const [t] = await tx.select({ slug: tenant.slug }).from(tenant).where(eq(tenant.id, a.user.tenantId));
      await d.audit.record(tx, a.ctx, {
        action: 'config.export',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        after: { sections: SECTION_NAMES.length },
      });
      return {
        format: FORMAT,
        version: 1,
        exportedAt: d.clock.now().toISOString(),
        tenant: t?.slug ?? null,
        note: 'Settings only. Secrets are left empty and no user data is included.',
        sections: Object.fromEntries(SECTION_NAMES.map((n) => [n, scrub(n, s[n], 'export')])),
      };
    });
    reply.header(
      'content-disposition',
      `attachment; filename="tenant-config-${out.tenant ?? 'tenant'}.json"`,
    );
    return out;
  });

  reg('POST', '/admin/config/import');
  app.post(`${p}/admin/config/import`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const body = parse(importBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const current = await loadSettings(tx, a.user.tenantId);
      const errors: Array<{ field: string; message: string }> = [];
      const parsed: Partial<Record<SectionName, unknown>> = {};
      for (const [name, raw] of Object.entries(body.config.sections)) {
        if (!(SECTION_NAMES as string[]).includes(name)) {
          errors.push({ field: `sections.${name}`, message: 'Not a configuration section' });
          continue;
        }
        const n = name as SectionName;
        const r = SECTIONS[n].safeParse(raw);
        if (!r.success) {
          for (const i of r.error.issues)
            errors.push({ field: [`sections.${name}`, ...i.path].join('.'), message: i.message });
          continue;
        }
        let value: unknown = r.data;
        // a file never carries a secret, so an empty one means "keep what is there"
        for (const f of SECRET_FIELDS[n] ?? [])
          if ((value as Record<string, unknown>)[f] === '')
            value = {
              ...(value as Record<string, unknown>),
              [f]: (current[n] as Record<string, unknown>)[f],
            };
        parsed[n] = value;
      }
      const merged = { ...current, ...parsed } as Settings;
      if (errors.length === 0) {
        for (const e of crossCheck(merged)) errors.push(e);
        if (parsed.ai) {
          try {
            await assertSettable(tx, a.user.tenantId, merged.ai);
          } catch (e) {
            if (e instanceof AppError)
              errors.push(
                ...e.fieldErrors.map((f) => ({ field: `sections.ai.${f.field}`, message: f.message })),
              );
            else throw e;
          }
        }
      }
      const changes = (Object.keys(parsed) as SectionName[])
        .map((n) => ({
          section: n,
          fields: fieldDiff(scrub(n, current[n], 'display'), scrub(n, merged[n], 'display')),
        }))
        .filter((c) => c.fields.length > 0);
      const unchanged = Object.keys(parsed).length - changes.length;
      const valid = errors.length === 0;

      if (!body.dryRun) {
        if (!valid)
          throw new AppError(
            422,
            'VALIDATION_FAILED',
            'The file is not valid, so nothing was applied',
            errors,
          );
        if (changes.length > 0) {
          const patch = Object.fromEntries(
            changes.map((c) => [c.section, merged[c.section]]),
          ) as Partial<Settings>;
          const { before, after } = await saveSettings(tx, a.user.tenantId, patch);
          for (const c of changes)
            await d.audit.record(tx, a.ctx, {
              action: `settings.${c.section}`,
              entityType: 'tenant',
              entityId: a.user.tenantId,
              before: { [c.section]: before[c.section] },
              after: { [c.section]: after[c.section], via: 'config.import' },
            });
        }
        await d.audit.record(tx, a.ctx, {
          action: 'config.import',
          entityType: 'tenant',
          entityId: a.user.tenantId,
          after: { sections: changes.map((c) => c.section), unchanged },
        });
      }
      return {
        dryRun: body.dryRun,
        valid,
        applied: !body.dryRun && valid && changes.length > 0,
        errors,
        changes,
        unchanged,
      };
    });
  });

  // ------------------------------------------------------------------ browser baseline (NFR-C08)
  reg('POST', '/auth/client-check');
  app.post(`${p}/auth/client-check`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    const b = parse(checkBody, req.body);
    const { browser, result } = checkUserAgent(b.userAgent, b.features);
    const supported = result.status === 'SUPPORTED';
    await withContext(d.database, a.ctx, async (tx) => {
      // browser family, major version and the verdict only: no user agent string, no person, no address
      await tx
        .insert(clientCheck)
        .values({
          tenantId: a.user.tenantId,
          browser: browser.family,
          major: browser.major,
          supported,
          count: 1,
          lastSeenAt: d.clock.now(),
        })
        .onConflictDoUpdate({
          target: [clientCheck.tenantId, clientCheck.browser, clientCheck.major, clientCheck.supported],
          set: { count: sql`${clientCheck.count} + 1`, lastSeenAt: d.clock.now() },
        });
    });
    return {
      browser: browser.family,
      major: browser.major,
      os: browser.os,
      status: result.status,
      supported,
      message: result.message,
      ...(result.minimum ? { minimum: result.minimum } : {}),
      missingFeatures: result.missingFeatures,
    };
  });

  reg('GET', '/admin/client-baseline');
  app.get(`${p}/admin/client-baseline`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(clientCheck)
        .where(eq(clientCheck.tenantId, a.user.tenantId))
        .orderBy(desc(clientCheck.count));
      const total = rows.reduce((n, r) => n + r.count, 0);
      const supportedCount = rows.filter((r) => r.supported).reduce((n, r) => n + r.count, 0);
      const byBrowser = BROWSER_FAMILIES.map((family) => {
        const mine = rows.filter((r) => r.browser === family);
        return {
          browser: family,
          supported: mine.filter((r) => r.supported).reduce((n, r) => n + r.count, 0),
          below: mine.filter((r) => !r.supported).reduce((n, r) => n + r.count, 0),
        };
      }).filter((x) => x.supported + x.below > 0);
      return {
        baseline: BASELINE,
        total,
        supported: supportedCount,
        belowBaseline: total - supportedCount,
        byBrowser,
        versions: rows.map((r) => ({
          browser: r.browser,
          major: r.major,
          supported: r.supported,
          count: r.count,
          lastSeenAt: r.lastSeenAt.toISOString(),
        })),
      };
    });
  });

  return done;
}
