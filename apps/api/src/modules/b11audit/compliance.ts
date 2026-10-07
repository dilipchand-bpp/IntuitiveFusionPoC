/**
 * SEC-L08: configuration compliance, checked continuously, with remediation.
 *
 * A fixed set of checks reads the tenant's configuration and records, per check, PASS, FAIL or WARN with the reason in
 * `compliance_check_result` (when it was last checked, since when it has been failing). A run is started by a person
 * (POST /compliance/run), by the scheduler, and after every change to the settings (a hook in index.ts). A check that
 * passed and now fails raises a security alert (the SEC-L06 alert table) and notifies the security owner.
 *
 * Remediation: every check carries guidance in plain words. Where one setting change is both safe and what the guidance says, an
 * administrator can apply it in one click (POST /compliance/checks/:key/remediate); that change is audited like any settings
 * change, and the checks run again. Changes that would lock people out or alter how everyone signs in are guidance only.
 */
import { verify as argon2Verify } from '@node-rs/argon2';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS } from '../../auth/session-service.js';
import { MAX_FAILED_ATTEMPTS } from '../../auth/identity-provider.js';
import { withContext, withSystem, type RequestContext, type Tx } from '../../db/client.js';
import { DEFAULT_SEED_PASSWORD } from '../../db/seed.js';
import {
  adminChainVerification,
  appUser,
  complianceCheckResult,
  connector,
  delegation,
  secretEntry,
  session,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { DEFAULT_MODEL_ID } from '../b10ai/models.js';
import { approvalStates, isUsable } from '../b10ai/service.js';
import { loadSettings, saveSettings, type Settings } from '../settings/settings.js';
import { raiseAlert } from './access-monitor.js';
import { sysCtx, usersWithRoles } from './util.js';

export const COMPLIANCE_READERS = ['ADMIN', 'PROBITY', 'EXEC'] as const;
/** The shortest password the sign-in API accepts (auth/routes.ts). */
export const PLATFORM_MIN_PASSWORD = 8;
const DAY = 86_400_000;
const PRIVILEGED = ['ADMIN', 'PROBITY', 'EXEC', 'DELEGATE', 'FINANCE'] as const;

type Status = 'PASS' | 'FAIL' | 'WARN';
interface Outcome {
  status: Status;
  detail: string;
}
interface CheckDef {
  key: string;
  label: string;
  category: 'ACCESS' | 'DATA' | 'INTEGRATION' | 'GOVERNANCE' | 'AI';
  guidance: string;
  remediation?: { label: string; section: keyof Settings };
  run(c: Ctx): Promise<Outcome>;
}
interface Ctx {
  tx: Tx;
  tenantId: string;
  now: Date;
  settings: Settings;
}

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
const list = (xs: string[], n = 4) =>
  xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', ');

const passwordCache = new Map<string, boolean>();
async function usesDemoPassword(hash: string): Promise<boolean> {
  const hit = passwordCache.get(hash);
  if (hit !== undefined) return hit;
  const r = await argon2Verify(hash, DEFAULT_SEED_PASSWORD).catch(() => false);
  passwordCache.set(hash, r);
  return r;
}

export const CHECKS: CheckDef[] = [
  {
    key: 'MFA_PRIVILEGED',
    label: 'Multi-factor sign-in is required',
    category: 'ACCESS',
    guidance:
      'Turn on "Require multi-factor" in Administration > Settings > Sign-in security. Everyone is asked to enrol an authenticator app at their next sign-in, so this is not applied automatically.',
    async run({ settings }) {
      return settings.security.requireMfa
        ? {
            status: 'PASS',
            detail: 'Multi-factor sign-in is required for staff, including administrators and approvers.',
          }
        : {
            status: 'FAIL',
            detail:
              'Multi-factor sign-in is optional, so privileged accounts can sign in with a password alone.',
          };
    },
  },
  {
    key: 'PASSWORD_POLICY',
    label: 'Password minimum length',
    category: 'ACCESS',
    guidance:
      'Raise the minimum password length in the sign-in service (a platform setting, not a tenant one) to the recommended length.',
    async run({ settings }) {
      const rec = settings.compliancePolicy.minPasswordLength;
      return PLATFORM_MIN_PASSWORD >= rec
        ? {
            status: 'PASS',
            detail: `Passwords need at least ${PLATFORM_MIN_PASSWORD} characters (recommended ${rec}).`,
          }
        : {
            status: 'WARN',
            detail: `Passwords need at least ${PLATFORM_MIN_PASSWORD} characters; the recommendation is ${rec}.`,
          };
    },
  },
  {
    key: 'SESSION_LENGTH',
    label: 'Session length',
    category: 'ACCESS',
    guidance: 'Shorten the idle or absolute session limits in the sign-in service.',
    async run() {
      const idle = IDLE_TIMEOUT_MS / 60_000;
      const abs = ABSOLUTE_TIMEOUT_MS / 3_600_000;
      return idle <= 30 && abs <= 12
        ? { status: 'PASS', detail: `Sessions end after ${idle} minutes idle and ${abs} hours in all.` }
        : {
            status: 'WARN',
            detail: `Sessions last ${idle} minutes idle and ${abs} hours in all; 30 minutes and 12 hours or less is expected.`,
          };
    },
  },
  {
    key: 'LOCKOUT',
    label: 'Account lock-out after failed sign-ins',
    category: 'ACCESS',
    guidance: 'Lower the failed-attempt limit in the sign-in service.',
    async run() {
      return MAX_FAILED_ATTEMPTS <= 10
        ? {
            status: 'PASS',
            detail: `An account is locked for a short time after ${MAX_FAILED_ATTEMPTS} failed sign-ins.`,
          }
        : { status: 'FAIL', detail: `Lock-out only starts after ${MAX_FAILED_ATTEMPTS} failed sign-ins.` };
    },
  },
  {
    key: 'CONNECTOR_SECRETS',
    label: 'Connector secrets present and recently rotated',
    category: 'INTEGRATION',
    guidance:
      'Rotate the named secrets from Connectors (a new version replaces the old), or set a secret for each enabled connector.',
    async run({ tx, tenantId, now, settings }) {
      const enabled = await tx
        .select({ kind: connector.kind })
        .from(connector)
        .where(and(eq(connector.tenantId, tenantId), eq(connector.enabled, true)));
      const secrets = await tx
        .select({ name: secretEntry.name, createdAt: secretEntry.createdAt })
        .from(secretEntry)
        .where(and(eq(secretEntry.tenantId, tenantId), isNull(secretEntry.retiredAt)));
      const maxAge = settings.compliancePolicy.secretMaxAgeDays;
      const old = secrets
        .filter((s) => s.name.startsWith('connector.') && s.createdAt < ago(now, maxAge * DAY))
        .map((s) => s.name);
      if (old.length)
        return {
          status: 'FAIL',
          detail: `${old.length} secret(s) are older than ${maxAge} days: ${list(old)}.`,
        };
      const missing = enabled
        .map((c) => c.kind)
        .filter((k) => !secrets.some((s) => s.name === `connector.${k.toLowerCase()}.webhook`));
      if (missing.length && enabled.length)
        return {
          status: 'WARN',
          detail: `${missing.length} enabled connector(s) have no signing secret yet: ${list(missing)}.`,
        };
      return {
        status: 'PASS',
        detail: enabled.length
          ? `${enabled.length} enabled connector(s); no secret is older than ${maxAge} days.`
          : `No connector is enabled; no secret is older than ${maxAge} days.`,
      };
    },
  },
  {
    key: 'CONNECTOR_BREAKER',
    label: 'No connector failing for long',
    category: 'INTEGRATION',
    guidance:
      'Open Connectors, read the last error and restore the connection, or switch the connector off if it is not needed.',
    async run({ tx, tenantId, now, settings }) {
      const hours = settings.compliancePolicy.breakerMaxHours;
      const rows = await tx
        .select()
        .from(connector)
        .where(and(eq(connector.tenantId, tenantId), eq(connector.enabled, true)));
      const stuck = rows
        .filter(
          (c) =>
            c.breakerState === 'OPEN' && c.breakerOpenedAt && c.breakerOpenedAt < ago(now, hours * 3_600_000),
        )
        .map((c) => c.kind);
      return stuck.length
        ? { status: 'FAIL', detail: `${list(stuck)} has been failing for more than ${hours} hours.` }
        : { status: 'PASS', detail: `No enabled connector has been failing for more than ${hours} hours.` };
    },
  },
  {
    key: 'DELEGATION_REVIEW',
    label: 'High delegations reviewed',
    category: 'GOVERNANCE',
    guidance:
      'Review each listed delegation with its holder, then save it again in Administration > Delegations to record the review.',
    async run({ tx, tenantId, now, settings }) {
      const p = settings.compliancePolicy;
      const rows = await tx
        .select()
        .from(delegation)
        .where(and(eq(delegation.tenantId, tenantId), eq(delegation.active, true)));
      const stale = rows.filter(
        (x) =>
          Number(x.maxValue) > p.delegationReviewAud && x.updatedAt < ago(now, p.delegationReviewDays * DAY),
      );
      return stale.length
        ? {
            status: 'WARN',
            detail: `${stale.length} delegation(s) above AUD ${p.delegationReviewAud.toLocaleString('en-AU')} have not been reviewed in ${p.delegationReviewDays} days.`,
          }
        : {
            status: 'PASS',
            detail: `Every delegation above AUD ${p.delegationReviewAud.toLocaleString('en-AU')} was reviewed within ${p.delegationReviewDays} days.`,
          };
    },
  },
  {
    key: 'APPROVAL_LINK_VALIDITY',
    label: 'Approval links expire quickly',
    category: 'ACCESS',
    guidance: 'Shorten the validity of approval links. One click sets it to the recommended value.',
    remediation: { label: 'Set the validity to the recommended hours', section: 'approvalLinks' },
    async run({ settings }) {
      const max = settings.compliancePolicy.approvalLinkMaxHours;
      const l = settings.approvalLinks;
      if (!l.enabled) return { status: 'PASS', detail: 'Approval links are switched off.' };
      return l.validHours <= max
        ? { status: 'PASS', detail: `Approval links expire after ${l.validHours} hours (limit ${max}).` }
        : {
            status: 'FAIL',
            detail: `Approval links stay valid for ${l.validHours} hours; the limit is ${max}.`,
          };
    },
  },
  {
    key: 'EXTERNAL_SEARCH_RESIDENCY',
    label: 'Outside AI search has an outbound allow-list',
    category: 'DATA',
    guidance:
      'Add the approved hosts to the outbound allow-list (Administration > Residency) or switch outside AI search off. One click switches it off.',
    remediation: { label: 'Switch outside AI search off', section: 'externalSearch' },
    async run({ settings }) {
      if (!settings.externalSearch.enabled)
        return {
          status: 'PASS',
          detail: 'Outside AI search is switched off, so no question leaves the platform.',
        };
      const hosts = settings.egress.allowedHosts.length;
      return hosts === 0
        ? {
            status: 'FAIL',
            detail:
              'Outside AI search is on but the outbound allow-list is empty, so there is nothing that limits where a question can go.',
          }
        : {
            status: 'PASS',
            detail: `Outside AI search is on; it can reach only the ${hosts} allow-listed host pattern(s), with hosting country ${settings.residency.country}.`,
          };
    },
  },
  {
    key: 'AI_MODEL_APPROVED',
    label: 'The active AI model is approved',
    category: 'AI',
    guidance:
      'Get the active model approved on AI models (a second person decides), or return to the built-in model. One click returns to the built-in model.',
    remediation: { label: 'Return to the built-in model', section: 'ai' },
    async run({ tx, tenantId, settings }) {
      const id = settings.ai.activeModel;
      const st = (await approvalStates(tx, tenantId)).get(id);
      if (!st)
        return { status: 'FAIL', detail: `The active model "${id}" is not a model this platform knows.` };
      return isUsable(st.state)
        ? {
            status: 'PASS',
            detail: `The active model "${id}" is ${st.state === 'BUILT_IN' ? 'built in' : 'approved for this organisation'}.`,
          }
        : {
            status: 'FAIL',
            detail: `The active model "${id}" is not approved (state ${st.state.toLowerCase().replace('_', ' ')}).`,
          };
    },
  },
  {
    key: 'RETENTION_CONFIGURED',
    label: 'Retention is configured',
    category: 'DATA',
    guidance:
      'Set how long AI conversations are kept in Privacy > Manage. Retention for the audit trail itself is part of the operations work (B12).',
    async run({ settings }) {
      const d = settings.retention.aiConversationDays;
      return d >= 1 && d <= 1825
        ? {
            status: 'PASS',
            detail: `AI conversations are kept for ${d} days. Audit-trail retention is not built yet (B12).`,
          }
        : { status: 'WARN', detail: `AI conversations are kept for ${d} days, which is unusually long.` };
    },
  },
  {
    key: 'KEY_ROTATION',
    label: 'Encryption keys rotated',
    category: 'DATA',
    guidance: 'Rotate the key on the encryption page; data is re-wrapped with the new version.',
    async run({ tx, tenantId, now, settings }) {
      const exists = await tx.execute(sql`select to_regclass('public.kms_key') as t`);
      const t = (exists as unknown as { rows?: Array<{ t: string | null }> }).rows?.[0]?.t;
      if (!t) return { status: 'WARN', detail: 'No key service is installed in this build.' };
      const r = await tx.execute(
        sql`select purpose, max(created_at) as at from kms_key where tenant_id = ${tenantId} and state = 'ACTIVE' group by purpose`,
      );
      const rows = (
        (r as unknown as { rows?: Array<{ purpose: string; at: string | Date }> }).rows ?? []
      ).map((x) => ({
        purpose: x.purpose,
        at: new Date(x.at),
      }));
      if (rows.length === 0) return { status: 'WARN', detail: 'No encryption key has been created yet.' };
      const max = settings.compliancePolicy.keyMaxAgeDays;
      const old = rows.filter((x) => x.at < ago(now, max * DAY)).map((x) => x.purpose);
      return old.length
        ? { status: 'FAIL', detail: `The active ${list(old)} key(s) are more than ${max} days old.` }
        : { status: 'PASS', detail: `Every active key is less than ${max} days old.` };
    },
  },
  {
    key: 'RESIDENCY_COUNTRY',
    label: 'Hosting country elected',
    category: 'DATA',
    guidance: 'Elect the hosting country on the residency page.',
    async run({ settings }) {
      const r = settings.residency;
      return r.country
        ? {
            status: 'PASS',
            detail: `Hosting country ${r.country}; AI in ${r.aiRegion}; logs in ${r.logRegion}.`,
          }
        : { status: 'FAIL', detail: 'No hosting country has been elected.' };
    },
  },
  {
    key: 'ADMIN_SEPARATION',
    label: 'Administrators are separate from approvers',
    category: 'GOVERNANCE',
    guidance:
      'Remove the administrator role, or the delegate or executive role, from the people listed, so no one can both change the rules and approve under them.',
    async run({ tx, tenantId, now }) {
      const admins = await usersWithRoles(tx, tenantId, ['ADMIN'], now);
      const approvers = new Set(
        (await usersWithRoles(tx, tenantId, ['DELEGATE', 'EXEC'], now)).map((u) => u.id),
      );
      const both = admins.filter((a) => approvers.has(a.id));
      return both.length
        ? {
            status: 'FAIL',
            detail: `${both.length} person(s) hold both the administrator role and an approver role: ${list(both.map((b) => b.name))}.`,
          }
        : {
            status: 'PASS',
            detail: `${admins.length} administrator(s); none also holds a delegate or executive role.`,
          };
    },
  },
  {
    key: 'DORMANT_PRIVILEGED',
    label: 'No dormant privileged accounts',
    category: 'ACCESS',
    guidance: 'Deactivate the listed accounts in Administration > Users, or ask their owners to sign in.',
    async run({ tx, tenantId, now, settings }) {
      const days = settings.compliancePolicy.dormantDays;
      const priv = await usersWithRoles(tx, tenantId, [...PRIVILEGED], now);
      const ids = [...new Set(priv.map((p) => p.id))];
      if (ids.length === 0) return { status: 'PASS', detail: 'No privileged accounts.' };
      const users = await tx
        .select({ id: appUser.id, name: appUser.name, createdAt: appUser.createdAt })
        .from(appUser)
        .where(inArray(appUser.id, ids));
      const seen = await tx
        .select({ userId: session.userId, at: sql<Date>`max(${session.lastSeenAt})` })
        .from(session)
        .where(inArray(session.userId, ids))
        .groupBy(session.userId);
      const last = new Map(seen.map((s) => [s.userId, new Date(s.at)] as const));
      const dormant = users
        .filter((u) => (last.get(u.id) ?? u.createdAt) < ago(now, days * DAY))
        .map((u) => u.name);
      return dormant.length
        ? {
            status: 'WARN',
            detail: `${dormant.length} privileged account(s) have not been used for ${days} days: ${list(dormant)}.`,
          }
        : {
            status: 'PASS',
            detail: `Every one of ${ids.length} privileged accounts was used within ${days} days.`,
          };
    },
  },
  {
    key: 'DEFAULT_PASSWORD',
    label: 'Demonstration password changed',
    category: 'ACCESS',
    guidance:
      'Informational in the demonstration. In a real deployment, set a unique password or use single sign-on for every account.',
    async run({ tx, tenantId }) {
      const users = await tx
        .select({ hash: appUser.passwordHash })
        .from(appUser)
        .where(and(eq(appUser.tenantId, tenantId), eq(appUser.active, true)));
      let n = 0;
      for (const u of users) if (await usesDemoPassword(u.hash)) n++;
      return n
        ? {
            status: 'WARN',
            detail: `${n} account(s) still use the published demonstration password (informational in the demonstration).`,
          }
        : { status: 'PASS', detail: 'No active account uses the published demonstration password.' };
    },
  },
  {
    key: 'AUDIT_CHAIN_VERIFIED',
    label: 'Audit chain verified recently',
    category: 'GOVERNANCE',
    guidance:
      'Open the audit chain page and run a verification; someone other than an administrator should do it.',
    async run({ tx, tenantId, now }) {
      const [last] = await tx
        .select()
        .from(adminChainVerification)
        .where(eq(adminChainVerification.tenantId, tenantId))
        .orderBy(desc(adminChainVerification.verifiedAt))
        .limit(1);
      if (!last) return { status: 'WARN', detail: 'The audit chain has not been verified yet.' };
      if (!last.ok)
        return {
          status: 'FAIL',
          detail: `The last verification found the chain broken at event ${last.brokenAtSeq}.`,
        };
      return last.verifiedAt < ago(now, 7 * DAY)
        ? { status: 'WARN', detail: 'The audit chain was last verified more than 7 days ago.' }
        : {
            status: 'PASS',
            detail: `Verified ${last.verifiedAt.toISOString().slice(0, 10)} by ${last.verifiedByRole ?? 'the system'}; ${last.checked} events intact.`,
          };
    },
  },
];

export interface CheckView {
  key: string;
  label: string;
  category: string;
  status: Status | 'NOT_RUN';
  detail: string;
  lastCheckedAt: string | null;
  firstFailedAt: string | null;
  guidance: string;
  remediation: { label: string; oneClick: true } | null;
}

/** Runs every check, stores the results, raises an alert for a check that went from pass to fail. */
export async function runChecks(
  tx: Tx,
  d: Pick<GuardDeps, 'audit' | 'clock'>,
  tenantId: string,
  ctx: RequestContext,
  opts: { auditAlways: boolean },
): Promise<{
  results: Array<{ key: string; status: Status; detail: string }>;
  changed: number;
  drifted: string[];
}> {
  const now = d.clock.now();
  const settings = await loadSettings(tx, tenantId);
  const previous = new Map(
    (await tx.select().from(complianceCheckResult).where(eq(complianceCheckResult.tenantId, tenantId))).map(
      (r) => [r.checkKey, r] as const,
    ),
  );
  const results: Array<{ key: string; status: Status; detail: string }> = [];
  const drifted: string[] = [];
  let changed = 0;
  for (const c of CHECKS) {
    let o: Outcome;
    try {
      o = await c.run({ tx, tenantId, now, settings });
    } catch {
      o = { status: 'WARN', detail: 'The check could not be completed.' };
    }
    results.push({ key: c.key, ...o });
    const old = previous.get(c.key);
    if (!old) {
      await tx.insert(complianceCheckResult).values({
        tenantId,
        checkKey: c.key,
        status: o.status,
        detail: o.detail,
        lastCheckedAt: now,
        firstFailedAt: o.status === 'FAIL' ? now : null,
        lastPassedAt: o.status === 'PASS' ? now : null,
        previousStatus: null,
      });
      changed++;
      continue;
    }
    if (old.status !== o.status) changed++;
    await tx
      .update(complianceCheckResult)
      .set({
        status: o.status,
        detail: o.detail,
        lastCheckedAt: now,
        previousStatus: old.status !== o.status ? old.status : old.previousStatus,
        firstFailedAt: o.status === 'FAIL' ? (old.status === 'FAIL' ? old.firstFailedAt : now) : null,
        lastPassedAt: o.status === 'PASS' ? now : old.lastPassedAt,
      })
      .where(eq(complianceCheckResult.id, old.id));
    if (old.status === 'PASS' && o.status === 'FAIL') {
      drifted.push(c.key);
      await raiseAlert(tx, d, tenantId, settings, {
        rule: `CONFIG_DRIFT:${c.key}`,
        severity: 'MEDIUM',
        subjectUserId: null,
        summary: `Configuration drift: "${c.label}" passed at the last check and now fails. ${o.detail}`,
        evidence: {
          check: c.key,
          detail: o.detail,
          previouslyPassedAt: old.lastPassedAt?.toISOString() ?? null,
        },
        dedupeKey: `DRIFT|${c.key}|${now.toISOString()}`,
      });
    }
  }
  if (opts.auditAlways || changed > 0)
    await d.audit.record(tx, ctx, {
      action: 'compliance.run',
      entityType: 'tenant',
      entityId: tenantId,
      after: {
        pass: results.filter((r) => r.status === 'PASS').length,
        warn: results.filter((r) => r.status === 'WARN').length,
        fail: results.filter((r) => r.status === 'FAIL').length,
        changed,
        drifted,
      },
    });
  return { results, changed, drifted };
}

export async function runChecksAllTenants(d: GuardDeps) {
  const ts = await withSystem(d.database, (tx) => tx.select({ id: tenant.id }).from(tenant));
  for (const t of ts)
    await withSystem(d.database, (tx) => runChecks(tx, d, t.id, sysCtx(t.id), { auditAlways: false }));
}

async function views(tx: Tx, tenantId: string): Promise<CheckView[]> {
  const rows = new Map(
    (await tx.select().from(complianceCheckResult).where(eq(complianceCheckResult.tenantId, tenantId))).map(
      (r) => [r.checkKey, r] as const,
    ),
  );
  return CHECKS.map((c) => {
    const r = rows.get(c.key);
    return {
      key: c.key,
      label: c.label,
      category: c.category,
      status: r?.status ?? 'NOT_RUN',
      detail: r?.detail ?? 'Not checked yet.',
      lastCheckedAt: r?.lastCheckedAt.toISOString() ?? null,
      firstFailedAt: r?.firstFailedAt?.toISOString() ?? null,
      guidance: c.guidance,
      remediation:
        c.remediation && r && r.status !== 'PASS' ? { label: c.remediation.label, oneClick: true } : null,
    };
  });
}
const summary = (v: CheckView[]) => ({
  pass: v.filter((x) => x.status === 'PASS').length,
  warn: v.filter((x) => x.status === 'WARN').length,
  fail: v.filter((x) => x.status === 'FAIL').length,
  notRun: v.filter((x) => x.status === 'NOT_RUN').length,
});

export function registerCompliance(
  app: FastifyInstance,
  p: string,
  d: GuardDeps,
  schedulerMinutes?: number,
): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  if (schedulerMinutes) {
    const h = setInterval(
      () => void runChecksAllTenants(d).catch(() => undefined),
      schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }

  reg('GET', '/compliance');
  app.get(`${p}/compliance`, { preHandler: guard(d, [...COMPLIANCE_READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const v = await views(tx, a.user.tenantId);
      return { summary: summary(v), canRemediate: a.user.roles.includes('ADMIN'), checks: v };
    });
  });

  reg('POST', '/compliance/run');
  app.post(`${p}/compliance/run`, { preHandler: guard(d, [...COMPLIANCE_READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await runChecks(tx, d, a.user.tenantId, a.ctx, { auditAlways: true });
      const v = await views(tx, a.user.tenantId);
      return {
        summary: summary(v),
        drifted: r.drifted,
        canRemediate: a.user.roles.includes('ADMIN'),
        checks: v,
      };
    });
  });

  reg('POST', '/compliance/checks/{key}/remediate');
  app.post(`${p}/compliance/checks/:key/remediate`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { key } = parse(z.object({ key: z.string().min(2).max(60) }), req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }).strict(), req.body);
    const def = CHECKS.find((c) => c.key === key);
    if (!def) throw new AppError(404, 'NOT_FOUND', 'Unknown check');
    if (!def.remediation)
      throw new AppError(
        409,
        'NO_ONE_CLICK',
        'This check has guidance only; it cannot be fixed in one click',
      );
    return withContext(d.database, a.ctx, async (tx) => {
      const now = d.clock.now();
      const current = await loadSettings(tx, a.user.tenantId);
      const outcome = await def.run({ tx, tenantId: a.user.tenantId, now, settings: current });
      if (outcome.status === 'PASS') throw new AppError(409, 'ALREADY_PASSING', 'This check already passes');
      let patch: Partial<Settings>;
      if (key === 'APPROVAL_LINK_VALIDITY')
        patch = {
          approvalLinks: {
            ...current.approvalLinks,
            validHours: Math.min(48, current.compliancePolicy.approvalLinkMaxHours),
          },
        };
      else if (key === 'EXTERNAL_SEARCH_RESIDENCY') patch = { externalSearch: { enabled: false } };
      else if (key === 'AI_MODEL_APPROVED') patch = { ai: { activeModel: DEFAULT_MODEL_ID } };
      else throw new AppError(409, 'NO_ONE_CLICK', 'This check has no one-click remediation');
      const { before, after } = await saveSettings(tx, a.user.tenantId, patch);
      const section = def.remediation!.section;
      await d.audit.record(tx, a.ctx, {
        action: `settings.${section}`,
        entityType: 'tenant',
        entityId: a.user.tenantId,
        before: { [section]: before[section] },
        after: { [section]: after[section] },
      });
      await d.audit.record(tx, a.ctx, {
        action: 'compliance.remediate',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        after: { check: key, setting: section, reason },
      });
      await runChecks(tx, d, a.user.tenantId, a.ctx, { auditAlways: false });
      const v = (await views(tx, a.user.tenantId)).find((x) => x.key === key)!;
      return { check: v, summary: summary(await views(tx, a.user.tenantId)) };
    });
  });

  return done;
}
