/**
 * SEC-L06: anomalous access is detected and routed to the security owner.
 *
 * Model `rules-simulated-v1`: fixed, explainable rules over (a) a light access log written from an onResponse hook, (b) the audit
 * trail (sign-ins, failed sign-ins, MFA failures, administrative changes) and (c) the session table (user agent family and the
 * first three octets of the address, recorded at sign-in). No statistical model and no machine learning is involved: every alert
 * states the rule, the numbers and the threshold that produced it. SIMULATED in the sense that a production deployment would
 * add a SIEM or a behavioural-analytics feed; the alert, routing and escalation workflow here is real.
 *
 * Access log: one row per classified request (a record view, a refused access to a record, an export) with the route pattern
 * and the record id, nothing from the content. Static, health, notification polling and the monitor's own endpoints are not
 * logged. Rows are buffered in memory and written in batches, so a request pays for a push to an array, not a database write.
 * The log is capped by age (a setting) and by count.
 *
 * The monitor never locks an account. The security owner can end a person's sessions (they must sign in again).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type Database, type RequestContext, type Tx } from '../../db/client.js';
import { accessEvent, appUser, auditEvent, securityAlert, session, tenant } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings, type Settings } from '../settings/settings.js';
import { sysCtx, tell, usersWithRoles, UUID } from './util.js';

export const MONITOR_MODEL = 'rules-simulated-v1';
export const ALERT_ROLES = ['ADMIN', 'PROBITY', 'EXEC'] as const;
const MAX_ACCESS_ROWS = 50_000;
const LOOKBACK_MS = 24 * 3_600_000;

export const RULES = {
  ACCESS_VOLUME: 'Unusual volume of record views in a short time',
  DENIED_BURST: 'Many refused attempts on different records',
  BULK_EXPORT: 'Many exports in a short time',
  NEW_DEVICE: 'Sign-in from a browser and network not seen before for this person',
  OUT_OF_HOURS_SIGNIN: 'Sign-in outside business hours',
  FAILED_THEN_SUCCESS: 'Repeated failed sign-ins followed by a success',
  PRIVILEGE_CHANGE_OFF_HOURS: 'Privilege or delegation change outside business hours',
  MFA_FAILURES: 'Many failed multi-factor codes',
  CONFIG_DRIFT: 'A configuration check that passed now fails',
} as const;
export type RuleId = keyof typeof RULES;

// ------------------------------------------------------------------------------------------ access log
interface Pending {
  tenantId: string;
  userId: string;
  kind: 'VIEW' | 'DENIED' | 'EXPORT';
  route: string;
  entityId: string | null;
  status: number;
  at: Date;
}

export class AccessRecorder {
  private buffer: Pending[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly database: Database) {}

  push(p: Pending) {
    this.buffer.push(p);
    if (this.buffer.length >= 200) void this.flush().catch(() => undefined);
  }

  /** Writes what is buffered. Calls are serialised, so a flush that is already running finishes first. */
  flush(): Promise<void> {
    this.chain = this.chain.then(async () => {
      const rows = this.buffer.splice(0, this.buffer.length);
      if (rows.length === 0) return;
      await withSystem(this.database, (tx) => tx.insert(accessEvent).values(rows));
    });
    return this.chain;
  }
}

const SKIP = [
  '/health',
  '/api/v1/health',
  '/api/v1/notifications',
  '/api/v1/auth/',
  '/api/v1/security/',
  '/api/v1/assistant/notifications',
];

/** Classifies one finished request, or returns null when it is not part of the access log. */
export function classify(
  method: string,
  url: string,
  status: number,
): { kind: 'VIEW' | 'DENIED' | 'EXPORT' } | null {
  if (SKIP.some((s) => url === s || url.startsWith(s))) return null;
  if ((status === 403 || status === 404) && url.includes(':')) return { kind: 'DENIED' };
  if (status !== 200) return null;
  if (url.includes('/export')) return { kind: 'EXPORT' };
  if (method === 'GET' && url.includes(':')) return { kind: 'VIEW' };
  return null;
}

export function installAccessLog(app: FastifyInstance, d: GuardDeps): AccessRecorder {
  const recorder = new AccessRecorder(d.database);
  app.addHook('onResponse', async (req, reply) => {
    try {
      if (!req.auth) return;
      const url = req.routeOptions?.url ?? '';
      const c = classify(req.method, url, reply.statusCode);
      if (!c) return;
      const params = (req.params ?? {}) as Record<string, unknown>;
      const entity = Object.values(params).find((v) => typeof v === 'string' && UUID.test(v)) as
        string | undefined;
      recorder.push({
        tenantId: req.auth.user.tenantId,
        userId: req.auth.user.id,
        kind: c.kind,
        route: url.replace('/api/v1', '').slice(0, 120),
        entityId: entity ?? null,
        status: reply.statusCode,
        at: d.clock.now(),
      });
    } catch {
      /* the log must never fail a request */
    }
  });
  app.addHook('onClose', async () => {
    await recorder.flush().catch(() => undefined);
  });
  return recorder;
}

// ------------------------------------------------------------------------------------------ rules
interface Finding {
  rule: RuleId;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  subjectUserId: string | null;
  summary: string;
  evidence: Record<string, unknown>;
  /** One alert per event: set for rules anchored on a single event. */
  dedupeKey: string | null;
  /** Burst rules: no new alert for the same person and rule inside this many minutes. */
  cooldownMinutes: number | null;
}

export const uaFamily = (ua: string | null | undefined): string => {
  const s = ua ?? '';
  if (!s) return 'unknown';
  if (/Edg\//.test(s)) return 'Edge';
  if (/OPR\/|Opera/.test(s)) return 'Opera';
  if (/Firefox\//.test(s)) return 'Firefox';
  if (/Chrome\//.test(s)) return 'Chrome';
  if (/Safari\//.test(s)) return 'Safari';
  if (/curl|node|undici|python|axios|HeadlessChrome/i.test(s)) return 'script';
  return 'other';
};
export const ipPrefix = (ip: string | null | undefined): string => {
  const s = (ip ?? '').replace(/^::ffff:/, '');
  if (!s) return 'unknown';
  if (s.includes('.')) return `${s.split('.').slice(0, 3).join('.')}.x`;
  return `${s.split(':').slice(0, 4).join(':')}::`;
};

/** Local hour and weekday in the organisation's time zone (the business hours setting is read in that zone). */
export function localParts(at: Date, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  return { hour, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) };
}
export function outsideHours(at: Date, s: Settings['securityMonitor']): boolean {
  const { hour, weekday } = localParts(at, s.timeZone);
  if (weekday === 0 || weekday === 6) return true;
  return hour < s.businessHoursStart || hour >= s.businessHoursEnd;
}

const names = async (tx: Tx, tenantId: string) =>
  new Map(
    (
      await tx
        .select({ id: appUser.id, name: appUser.name })
        .from(appUser)
        .where(eq(appUser.tenantId, tenantId))
    ).map((u) => [u.id, u.name] as const),
  );

export async function evaluateRules(
  tx: Tx,
  tenantId: string,
  now: Date,
  s: Settings['securityMonitor'],
): Promise<Finding[]> {
  const out: Finding[] = [];
  const who = await names(tx, tenantId);
  const nm = (id: string) => who.get(id) ?? id;
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const lookback = new Date(now.getTime() - LOOKBACK_MS);

  // record views
  const views = await tx
    .select({ userId: accessEvent.userId, n: sql<number>`count(*)::int` })
    .from(accessEvent)
    .where(
      and(
        eq(accessEvent.tenantId, tenantId),
        eq(accessEvent.kind, 'VIEW'),
        gte(accessEvent.at, ago(s.viewBurstMinutes)),
      ),
    )
    .groupBy(accessEvent.userId);
  for (const v of views)
    if (v.n >= s.viewBurstCount)
      out.push({
        rule: 'ACCESS_VOLUME',
        severity: v.n >= s.viewBurstCount * 3 ? 'HIGH' : 'MEDIUM',
        subjectUserId: v.userId,
        summary: `${nm(v.userId)} viewed ${v.n} records in ${s.viewBurstMinutes} minutes (limit ${s.viewBurstCount}).`,
        evidence: { views: v.n, windowMinutes: s.viewBurstMinutes, threshold: s.viewBurstCount },
        dedupeKey: null,
        cooldownMinutes: s.viewBurstMinutes,
      });

  // refused attempts on different records
  const denied = await tx
    .select({
      userId: accessEvent.userId,
      n: sql<number>`count(*)::int`,
      distinctIds: sql<number>`count(distinct coalesce(${accessEvent.entityId}, ${accessEvent.route}))::int`,
    })
    .from(accessEvent)
    .where(
      and(
        eq(accessEvent.tenantId, tenantId),
        eq(accessEvent.kind, 'DENIED'),
        gte(accessEvent.at, ago(s.deniedBurstMinutes)),
      ),
    )
    .groupBy(accessEvent.userId);
  for (const v of denied)
    if (v.distinctIds >= s.deniedBurstCount)
      out.push({
        rule: 'DENIED_BURST',
        severity: 'HIGH',
        subjectUserId: v.userId,
        summary: `${nm(v.userId)} was refused access to ${v.distinctIds} different records in ${s.deniedBurstMinutes} minutes (limit ${s.deniedBurstCount}).`,
        evidence: {
          refused: v.n,
          distinctRecords: v.distinctIds,
          windowMinutes: s.deniedBurstMinutes,
          threshold: s.deniedBurstCount,
        },
        dedupeKey: null,
        cooldownMinutes: s.deniedBurstMinutes,
      });

  // exports
  const exports_ = await tx
    .select({ userId: accessEvent.userId, n: sql<number>`count(*)::int` })
    .from(accessEvent)
    .where(
      and(
        eq(accessEvent.tenantId, tenantId),
        eq(accessEvent.kind, 'EXPORT'),
        gte(accessEvent.at, ago(s.exportBurstMinutes)),
      ),
    )
    .groupBy(accessEvent.userId);
  for (const v of exports_)
    if (v.n >= s.exportBurstCount)
      out.push({
        rule: 'BULK_EXPORT',
        severity: 'MEDIUM',
        subjectUserId: v.userId,
        summary: `${nm(v.userId)} made ${v.n} exports in ${s.exportBurstMinutes} minutes (limit ${s.exportBurstCount}).`,
        evidence: { exports: v.n, windowMinutes: s.exportBurstMinutes, threshold: s.exportBurstCount },
        dedupeKey: null,
        cooldownMinutes: s.exportBurstMinutes,
      });

  // new device or network: a sign-in whose browser family and address prefix this person has not used before
  if (s.newDeviceCheck) {
    const recent = await tx
      .select()
      .from(session)
      .where(and(eq(session.tenantId, tenantId), gte(session.createdAt, lookback)))
      .orderBy(asc(session.createdAt));
    for (const sess of recent) {
      const profile = `${uaFamily(sess.userAgent)}|${ipPrefix(sess.ip)}`;
      const earlier = await tx
        .select({ userAgent: session.userAgent, ip: session.ip })
        .from(session)
        .where(and(eq(session.userId, sess.userId), lt(session.createdAt, sess.createdAt)));
      if (earlier.length === 0) continue; // nothing to compare with: a first sign-in is not "new"
      if (earlier.some((e) => `${uaFamily(e.userAgent)}|${ipPrefix(e.ip)}` === profile)) continue;
      out.push({
        rule: 'NEW_DEVICE',
        severity: 'MEDIUM',
        subjectUserId: sess.userId,
        summary: `${nm(sess.userId)} signed in from ${uaFamily(sess.userAgent)} on ${ipPrefix(sess.ip)}, not used in their ${earlier.length} earlier sign-in(s).`,
        evidence: {
          browser: uaFamily(sess.userAgent),
          network: ipPrefix(sess.ip),
          earlierSignIns: earlier.length,
        },
        dedupeKey: `NEW_DEVICE|${sess.id}`,
        cooldownMinutes: null,
      });
    }
  }

  // events from the audit trail
  const trail = await tx
    .select({
      seq: auditEvent.seq,
      at: auditEvent.at,
      action: auditEvent.action,
      actorId: auditEvent.actorId,
      entityId: auditEvent.entityId,
    })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.tenantId, tenantId),
        gte(auditEvent.at, lookback),
        inArray(auditEvent.action, [
          'auth.login',
          'auth.login_failed',
          'auth.mfa_failed',
          'user.update',
          'user.create',
          'delegation.create',
          'delegation.update',
          'access.grant',
          'grant.expiry_set',
        ]),
      ),
    )
    .orderBy(asc(auditEvent.seq));

  for (const e of trail) {
    if (e.action === 'auth.login' && e.actorId) {
      const failed = trail.filter(
        (f) =>
          f.action === 'auth.login_failed' &&
          (f.entityId === e.actorId || f.actorId === e.actorId) &&
          f.at <= e.at &&
          f.at.getTime() >= e.at.getTime() - 30 * 60_000,
      ).length;
      if (failed >= s.failedLoginsBeforeSuccess)
        out.push({
          rule: 'FAILED_THEN_SUCCESS',
          severity: 'MEDIUM',
          subjectUserId: e.actorId,
          summary: `${nm(e.actorId)} signed in after ${failed} failed attempts in 30 minutes (limit ${s.failedLoginsBeforeSuccess}).`,
          evidence: { failedAttempts: failed, windowMinutes: 30, threshold: s.failedLoginsBeforeSuccess },
          dedupeKey: `FTS|${e.seq}`,
          cooldownMinutes: null,
        });
      if (s.outOfHoursCheck && outsideHours(e.at, s))
        out.push({
          rule: 'OUT_OF_HOURS_SIGNIN',
          severity: 'LOW',
          subjectUserId: e.actorId,
          summary: `${nm(e.actorId)} signed in outside business hours (${s.businessHoursStart}:00 to ${s.businessHoursEnd}:00 ${s.timeZone}, weekdays).`,
          evidence: { at: e.at.toISOString(), timeZone: s.timeZone },
          dedupeKey: `OOH|${e.seq}`,
          cooldownMinutes: null,
        });
    }
    if (
      s.outOfHoursCheck &&
      e.actorId &&
      [
        'user.update',
        'user.create',
        'delegation.create',
        'delegation.update',
        'access.grant',
        'grant.expiry_set',
      ].includes(e.action) &&
      outsideHours(e.at, s)
    )
      out.push({
        rule: 'PRIVILEGE_CHANGE_OFF_HOURS',
        severity: 'MEDIUM',
        subjectUserId: e.actorId,
        summary: `${nm(e.actorId)} made a privilege or delegation change (${e.action}) outside business hours.`,
        evidence: { action: e.action, at: e.at.toISOString(), timeZone: s.timeZone },
        dedupeKey: `PRIV|${e.seq}`,
        cooldownMinutes: null,
      });
  }

  // many failed MFA codes by one person within the window
  const mfaByUser = new Map<string, number>();
  for (const e of trail)
    if (e.action === 'auth.mfa_failed' && e.actorId && e.at >= ago(s.mfaWindowMinutes))
      mfaByUser.set(e.actorId, (mfaByUser.get(e.actorId) ?? 0) + 1);
  for (const [userId, n] of mfaByUser)
    if (n >= s.mfaFailureCount)
      out.push({
        rule: 'MFA_FAILURES',
        severity: 'HIGH',
        subjectUserId: userId,
        summary: `${nm(userId)} entered ${n} wrong multi-factor codes in ${s.mfaWindowMinutes} minutes (limit ${s.mfaFailureCount}).`,
        evidence: { failures: n, windowMinutes: s.mfaWindowMinutes, threshold: s.mfaFailureCount },
        dedupeKey: null,
        cooldownMinutes: s.mfaWindowMinutes,
      });
  return out;
}

// ------------------------------------------------------------------------------------------ alerts
export async function resolveOwner(
  tx: Tx,
  tenantId: string,
  s: Settings['securityMonitor'],
  now: Date,
): Promise<string | null> {
  if (s.ownerUserId) {
    const [u] = await tx
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.id, s.ownerUserId), eq(appUser.tenantId, tenantId), eq(appUser.active, true)));
    if (u) return u.id;
  }
  const probity = await usersWithRoles(tx, tenantId, ['PROBITY'], now);
  if (probity[0]) return probity[0].id;
  return (await usersWithRoles(tx, tenantId, ['ADMIN'], now))[0]?.id ?? null;
}

export interface RaiseInput {
  rule: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  subjectUserId: string | null;
  summary: string;
  evidence: Record<string, unknown>;
  dedupeKey?: string | null;
  cooldownMinutes?: number | null;
}

/** Writes one alert, notifies the security owner, audits. Returns null when it is a repeat of an alert already raised. */
export async function raiseAlert(
  tx: Tx,
  d: Pick<GuardDeps, 'audit' | 'clock'>,
  tenantId: string,
  settings: Settings,
  f: RaiseInput,
): Promise<string | null> {
  const now = d.clock.now();
  if (f.dedupeKey) {
    const [dup] = await tx
      .select({ id: securityAlert.id })
      .from(securityAlert)
      .where(and(eq(securityAlert.tenantId, tenantId), eq(securityAlert.dedupeKey, f.dedupeKey)));
    if (dup) return null;
  }
  if (f.cooldownMinutes) {
    const conds = [
      eq(securityAlert.tenantId, tenantId),
      eq(securityAlert.rule, f.rule),
      gte(securityAlert.createdAt, new Date(now.getTime() - f.cooldownMinutes * 60_000)),
    ];
    if (f.subjectUserId) conds.push(eq(securityAlert.subjectUserId, f.subjectUserId));
    const [recent] = await tx
      .select({ id: securityAlert.id })
      .from(securityAlert)
      .where(and(...conds))
      .limit(1);
    if (recent) return null;
  }
  const owner = await resolveOwner(tx, tenantId, settings.securityMonitor, now);
  const [row] = await tx
    .insert(securityAlert)
    .values({
      tenantId,
      rule: f.rule,
      severity: f.severity,
      subjectUserId: f.subjectUserId,
      summary: f.summary,
      evidence: f.evidence,
      ownerUserId: owner,
      dedupeKey: f.dedupeKey ?? null,
      model: MONITOR_MODEL,
      createdAt: now,
    })
    .returning({ id: securityAlert.id });
  if (owner)
    await tell(
      tx,
      tenantId,
      owner,
      `Security alert (${f.severity.toLowerCase()}): ${(RULES as Record<string, string>)[f.rule.split(':')[0]!] ?? f.rule}`,
      f.summary,
      '/app/security-alerts',
      'security.alert',
    );
  await d.audit.record(tx, sysCtx(tenantId), {
    action: 'security.alert_raised',
    entityType: 'security_alert',
    entityId: row!.id,
    after: { rule: f.rule, severity: f.severity, subject: f.subjectUserId, owner, model: MONITOR_MODEL },
  });
  return row!.id;
}

/** Alerts nobody acknowledged within the setting go to the executives. */
export async function escalateDue(
  tx: Tx,
  d: Pick<GuardDeps, 'audit' | 'clock'>,
  tenantId: string,
  settings: Settings,
): Promise<number> {
  const now = d.clock.now();
  const cutoff = new Date(now.getTime() - settings.securityMonitor.escalateAfterMinutes * 60_000);
  const due = await tx
    .select()
    .from(securityAlert)
    .where(
      and(
        eq(securityAlert.tenantId, tenantId),
        eq(securityAlert.status, 'NEW'),
        lt(securityAlert.createdAt, cutoff),
      ),
    );
  if (due.length === 0) return 0;
  const execs = await usersWithRoles(tx, tenantId, ['EXEC'], now);
  for (const a of due) {
    await tx
      .update(securityAlert)
      .set({ status: 'ESCALATED', escalatedAt: now, escalatedTo: execs.map((e) => e.id) })
      .where(eq(securityAlert.id, a.id));
    for (const e of execs)
      await tell(
        tx,
        tenantId,
        e.id,
        `Escalated security alert (${a.severity.toLowerCase()}) not acknowledged`,
        `${a.summary} It was not acknowledged within ${settings.securityMonitor.escalateAfterMinutes} minutes.`,
        '/app/security-alerts',
        'security.alert',
      );
    await d.audit.record(tx, sysCtx(tenantId), {
      action: 'security.alert_escalated',
      entityType: 'security_alert',
      entityId: a.id,
      after: {
        escalatedTo: execs.map((e) => e.id),
        afterMinutes: settings.securityMonitor.escalateAfterMinutes,
      },
    });
  }
  return due.length;
}

async function purgeAccessLog(tx: Tx, tenantId: string, now: Date, days: number) {
  await tx
    .delete(accessEvent)
    .where(
      and(
        eq(accessEvent.tenantId, tenantId),
        lt(accessEvent.at, new Date(now.getTime() - days * 86_400_000)),
      ),
    );
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(accessEvent)
    .where(eq(accessEvent.tenantId, tenantId));
  if (n > MAX_ACCESS_ROWS) {
    const [cut] = await tx
      .select({ id: accessEvent.id })
      .from(accessEvent)
      .where(eq(accessEvent.tenantId, tenantId))
      .orderBy(desc(accessEvent.id))
      .offset(MAX_ACCESS_ROWS)
      .limit(1);
    if (cut)
      await tx
        .delete(accessEvent)
        .where(and(eq(accessEvent.tenantId, tenantId), lt(accessEvent.id, cut.id + 1)));
  }
}

const lastRun = new Map<string, { at: string; findings: number; created: number; escalated: number }>();

/** One pass for a tenant: flush the log, apply the rules, raise alerts, escalate, trim the log. */
export async function runMonitor(
  d: GuardDeps,
  recorder: AccessRecorder,
  tenantId: string,
): Promise<{ findings: number; created: number; escalated: number; skipped?: 'DISABLED' }> {
  await recorder.flush();
  return withSystem(d.database, async (tx) => {
    const settings = await loadSettings(tx, tenantId);
    if (!settings.securityMonitor.enabled)
      return { findings: 0, created: 0, escalated: 0, skipped: 'DISABLED' as const };
    const now = d.clock.now();
    const findings = await evaluateRules(tx, tenantId, now, settings.securityMonitor);
    let created = 0;
    for (const f of findings) if (await raiseAlert(tx, d, tenantId, settings, f)) created++;
    const escalated = await escalateDue(tx, d, tenantId, settings);
    await purgeAccessLog(tx, tenantId, now, settings.securityMonitor.accessLogRetentionDays);
    const r = { findings: findings.length, created, escalated };
    lastRun.set(tenantId, { at: now.toISOString(), ...r });
    return r;
  });
}

export async function runMonitorAllTenants(d: GuardDeps, recorder: AccessRecorder) {
  const tenants = await withSystem(d.database, (tx) => tx.select({ id: tenant.id }).from(tenant));
  for (const t of tenants) await runMonitor(d, recorder, t.id);
}

// ------------------------------------------------------------------------------------------ routes
const noteSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();
const closeSchema = z.object({ note: z.string().trim().min(5).max(500) }).strict();
const idParam = z.object({ id: z.string().uuid() });

export function registerAccessMonitor(
  app: FastifyInstance,
  p: string,
  d: GuardDeps,
  recorder: AccessRecorder,
  schedulerMinutes?: number,
): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  if (schedulerMinutes) {
    const h = setInterval(
      () => void runMonitorAllTenants(d, recorder).catch(() => undefined),
      schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }

  const view = (r: typeof securityAlert.$inferSelect, who: Map<string, string>) => ({
    id: r.id,
    rule: r.rule,
    ruleLabel: (RULES as Record<string, string>)[r.rule.split(':')[0]!] ?? r.rule,
    severity: r.severity,
    status: r.status,
    summary: r.summary,
    evidence: r.evidence,
    model: r.model,
    subjectUserId: r.subjectUserId,
    subject: r.subjectUserId ? (who.get(r.subjectUserId) ?? null) : null,
    owner: r.ownerUserId ? (who.get(r.ownerUserId) ?? null) : null,
    ownerUserId: r.ownerUserId,
    createdAt: r.createdAt.toISOString(),
    acknowledgedBy: r.acknowledgedBy ? (who.get(r.acknowledgedBy) ?? null) : null,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    escalatedAt: r.escalatedAt?.toISOString() ?? null,
    closedBy: r.closedBy ? (who.get(r.closedBy) ?? null) : null,
    closedAt: r.closedAt?.toISOString() ?? null,
    closeNote: r.closeNote,
    sessionsEndedAt: r.sessionsEndedAt?.toISOString() ?? null,
  });

  reg('GET', '/security/alerts');
  app.get(`${p}/security/alerts`, { preHandler: guard(d, [...ALERT_ROLES]) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z
        .object({
          status: z.enum(['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'CLOSED', 'OPEN']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        })
        .strict(),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const conds = [eq(securityAlert.tenantId, a.user.tenantId)];
      if (q.status === 'OPEN')
        conds.push(inArray(securityAlert.status, ['NEW', 'ACKNOWLEDGED', 'ESCALATED']));
      else if (q.status) conds.push(eq(securityAlert.status, q.status));
      const rows = await tx
        .select()
        .from(securityAlert)
        .where(and(...conds))
        .orderBy(desc(securityAlert.createdAt))
        .limit(q.limit);
      const who = await names(tx, a.user.tenantId);
      const [{ open } = { open: 0 }] = await tx
        .select({ open: sql<number>`count(*)::int` })
        .from(securityAlert)
        .where(
          and(
            eq(securityAlert.tenantId, a.user.tenantId),
            inArray(securityAlert.status, ['NEW', 'ACKNOWLEDGED', 'ESCALATED']),
          ),
        );
      return { model: MONITOR_MODEL, open, items: rows.map((r) => view(r, who)) };
    });
  });

  async function load(tx: Tx, a: NonNullable<FastifyRequest['auth']>, id: string) {
    const [row] = await tx
      .select()
      .from(securityAlert)
      .where(and(eq(securityAlert.id, id), eq(securityAlert.tenantId, a.user.tenantId)));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Alert not found');
    return row;
  }
  const respond = async (tx: Tx, a: NonNullable<FastifyRequest['auth']>, id: string) =>
    view(await load(tx, a, id), await names(tx, a.user.tenantId));

  reg('POST', '/security/alerts/{id}/acknowledge');
  app.post(
    `${p}/security/alerts/:id/acknowledge`,
    { preHandler: guard(d, [...ALERT_ROLES]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const body = parse(noteSchema, req.body ?? {});
      return withContext(d.database, a.ctx, async (tx) => {
        const row = await load(tx, a, id);
        if (row.status === 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'The alert is closed');
        if (row.status === 'ACKNOWLEDGED') return respond(tx, a, id);
        await tx
          .update(securityAlert)
          .set({ status: 'ACKNOWLEDGED', acknowledgedBy: a.user.id, acknowledgedAt: d.clock.now() })
          .where(eq(securityAlert.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'security.alert_acknowledged',
          entityType: 'security_alert',
          entityId: id,
          after: { rule: row.rule, wasEscalated: row.status === 'ESCALATED', note: body.note ?? null },
        });
        return respond(tx, a, id);
      });
    },
  );

  reg('POST', '/security/alerts/{id}/close');
  app.post(`${p}/security/alerts/:id/close`, { preHandler: guard(d, [...ALERT_ROLES]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const body = parse(closeSchema, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const row = await load(tx, a, id);
      if (row.status === 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'The alert is already closed');
      await tx
        .update(securityAlert)
        .set({
          status: 'CLOSED',
          closedBy: a.user.id,
          closedAt: d.clock.now(),
          closeNote: body.note,
          acknowledgedBy: row.acknowledgedBy ?? a.user.id,
          acknowledgedAt: row.acknowledgedAt ?? d.clock.now(),
        })
        .where(eq(securityAlert.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'security.alert_closed',
        entityType: 'security_alert',
        entityId: id,
        after: { rule: row.rule, note: body.note },
      });
      return respond(tx, a, id);
    });
  });

  reg('POST', '/security/alerts/{id}/end-sessions');
  app.post(
    `${p}/security/alerts/:id/end-sessions`,
    { preHandler: guard(d, ['ADMIN', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const body = parse(noteSchema, req.body ?? {});
      return withContext(d.database, a.ctx, async (tx) => {
        const row = await load(tx, a, id);
        if (!row.subjectUserId) throw new AppError(409, 'NO_SUBJECT', 'This alert is not about one person');
        if (row.subjectUserId === a.user.id)
          throw new AppError(409, 'OWN_SESSIONS', 'You cannot end your own sessions here');
        const ended = await tx
          .update(session)
          .set({ revokedAt: d.clock.now() })
          .where(and(eq(session.userId, row.subjectUserId), isNull(session.revokedAt)))
          .returning({ id: session.id });
        await tx
          .update(securityAlert)
          .set({ sessionsEndedBy: a.user.id, sessionsEndedAt: d.clock.now() })
          .where(eq(securityAlert.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'security.sessions_ended',
          entityType: 'app_user',
          entityId: row.subjectUserId,
          after: {
            alertId: id,
            rule: row.rule,
            sessionsEnded: ended.length,
            note: body.note ?? null,
            accountLocked: false,
          },
        });
        return { ...(await respond(tx, a, id)), sessionsEnded: ended.length };
      });
    },
  );

  reg('POST', '/security/monitor/run');
  app.post(`${p}/security/monitor/run`, { preHandler: guard(d, [...ALERT_ROLES]) }, async (req) => {
    const a = req.auth!;
    return { model: MONITOR_MODEL, ...(await runMonitor(d, recorder, a.user.tenantId)) };
  });

  reg('GET', '/security/monitor/status');
  app.get(`${p}/security/monitor/status`, { preHandler: guard(d, [...ALERT_ROLES]) }, async (req) => {
    const a = req.auth!;
    await recorder.flush();
    return withContext(d.database, a.ctx, async (tx) => {
      const s = (await loadSettings(tx, a.user.tenantId)).securityMonitor;
      const counts = await tx
        .select({ kind: accessEvent.kind, n: sql<number>`count(*)::int` })
        .from(accessEvent)
        .where(
          and(
            eq(accessEvent.tenantId, a.user.tenantId),
            gte(accessEvent.at, new Date(d.clock.now().getTime() - LOOKBACK_MS)),
          ),
        )
        .groupBy(accessEvent.kind);
      const owner = await resolveOwner(tx, a.user.tenantId, s, d.clock.now());
      const who = await names(tx, a.user.tenantId);
      return {
        model: MONITOR_MODEL,
        simulated: true,
        enabled: s.enabled,
        owner: owner ? { id: owner, name: who.get(owner) ?? null, configured: Boolean(s.ownerUserId) } : null,
        escalateAfterMinutes: s.escalateAfterMinutes,
        lastRun: lastRun.get(a.user.tenantId) ?? null,
        accessLog24h: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
        rules: [
          {
            rule: 'ACCESS_VOLUME',
            label: RULES.ACCESS_VOLUME,
            on: true,
            threshold: `${s.viewBurstCount} views in ${s.viewBurstMinutes} min`,
          },
          {
            rule: 'DENIED_BURST',
            label: RULES.DENIED_BURST,
            on: true,
            threshold: `${s.deniedBurstCount} records in ${s.deniedBurstMinutes} min`,
          },
          {
            rule: 'BULK_EXPORT',
            label: RULES.BULK_EXPORT,
            on: true,
            threshold: `${s.exportBurstCount} exports in ${s.exportBurstMinutes} min`,
          },
          {
            rule: 'NEW_DEVICE',
            label: RULES.NEW_DEVICE,
            on: s.newDeviceCheck,
            threshold: 'browser family + first three address octets',
          },
          {
            rule: 'OUT_OF_HOURS_SIGNIN',
            label: RULES.OUT_OF_HOURS_SIGNIN,
            on: s.outOfHoursCheck,
            threshold: `${s.businessHoursStart}:00 to ${s.businessHoursEnd}:00 ${s.timeZone}, weekdays`,
          },
          {
            rule: 'FAILED_THEN_SUCCESS',
            label: RULES.FAILED_THEN_SUCCESS,
            on: true,
            threshold: `${s.failedLoginsBeforeSuccess} failures in 30 min`,
          },
          {
            rule: 'PRIVILEGE_CHANGE_OFF_HOURS',
            label: RULES.PRIVILEGE_CHANGE_OFF_HOURS,
            on: s.outOfHoursCheck,
            threshold: 'user, delegation or access grant change outside business hours',
          },
          {
            rule: 'MFA_FAILURES',
            label: RULES.MFA_FAILURES,
            on: true,
            threshold: `${s.mfaFailureCount} in ${s.mfaWindowMinutes} min`,
          },
          {
            rule: 'CONFIG_DRIFT',
            label: RULES.CONFIG_DRIFT,
            on: true,
            threshold: 'a configuration check goes from pass to fail',
          },
        ],
      };
    });
  });

  return done;
}

export type { RequestContext };
