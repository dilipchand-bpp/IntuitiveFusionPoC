/**
 * Tenants with usage plans, per-tenant request throttling and usage metering (NFR-SC01).
 *
 * Every business table already carries `tenant_id`; this makes several tenants real. A tenant is on a usage plan
 * (`tenant_usage_plan` -> `usage_plan`: requests per minute, burst, daily requests, monthly AI calls, storage, users).
 * Each authenticated API call takes one token from that tenant's own token bucket, so one tenant cannot use up another's
 * allowance. The bucket's clock is the injected Clock (tests move it). Counts are batched in memory and written to
 * `usage_counter` on an interval, on read and on close.
 *
 * A tenant with no plan assignment (the single-tenant demonstration seed) is treated as ENTERPRISE. Tenants made through the
 * operator API are always assigned one explicitly.
 *
 * SWAP POINT (docs/swap-points.md): the buckets are in the memory of one API process. Behind several instances the same
 * rule runs in the API gateway (a usage plan on an API Gateway or a rate-limit policy at the edge) or in a shared store
 * such as Redis; `usage_counter` stays the billing and reporting record.
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '@if/shared';
import { withSystem, type Database } from '../../db/client.js';
import {
  appUser,
  contractFile,
  fileObject,
  tenantUsagePlan,
  usageCounter,
  usagePlan,
} from '../../db/schema.js';

export const DEFAULT_PLAN_KEY = 'ENTERPRISE';

export interface PlanLimits {
  key: string;
  name: string;
  requestsPerMinute: number;
  burst: number;
  dailyRequests: number;
  monthlyAiCalls: number;
  storageMb: number;
  maxUsers: number;
}

/** What is used if the plan table has no row (never expected: the migration seeds three plans). */
const FALLBACK: PlanLimits = {
  key: 'ENTERPRISE',
  name: 'Enterprise',
  requestsPerMinute: 12000,
  burst: 60000,
  dailyRequests: 5_000_000,
  monthlyAiCalls: 500_000,
  storageMb: 512_000,
  maxUsers: 5000,
};

export type LimitReason = 'REQUESTS_PER_MINUTE' | 'DAILY_REQUESTS' | 'MONTHLY_AI_CALLS';
export type Admission =
  | { ok: true }
  | {
      ok: false;
      reason: LimitReason;
      retryAfterSeconds: number;
      plan: PlanLimits;
      limit: number;
      detail: string;
    };

interface Bucket {
  tokens: number;
  last: number;
}
interface DayState {
  /** Requests already written to the database for the day when this process first saw it. */
  baseRequests: number;
  /** Requests counted in this process, written or not. */
  requests: number;
  pending: { requests: number; throttled: number; aiCalls: number };
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const CACHE_MS = 30_000;

export class Tenancy {
  private readonly buckets = new Map<string, Bucket>();
  private readonly plans = new Map<string, { plan: PlanLimits; at: number }>();
  private readonly days = new Map<string, DayState>();
  private readonly loading = new Map<string, Promise<DayState>>();
  private readonly aiMonth = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  /** Writes the batched counts every `ms` (production). Tests flush by reading usage. */
  start(ms = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush().catch(() => undefined), ms);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush().catch(() => undefined);
  }

  invalidate(tenantId: string): void {
    this.plans.delete(tenantId);
    this.buckets.delete(tenantId); // a new plan starts with a full bucket of the new size
  }

  async planFor(tenantId: string): Promise<PlanLimits> {
    const now = this.clock.now().getTime();
    const hit = this.plans.get(tenantId);
    if (hit && now - hit.at < CACHE_MS) return hit.plan;
    const plan = await withSystem(this.database, async (tx) => {
      const [a] = await tx.select().from(tenantUsagePlan).where(eq(tenantUsagePlan.tenantId, tenantId));
      const [p] = await tx
        .select()
        .from(usagePlan)
        .where(eq(usagePlan.key, a?.planKey ?? DEFAULT_PLAN_KEY));
      return p ?? null;
    });
    const limits: PlanLimits = plan
      ? {
          key: plan.key,
          name: plan.name,
          requestsPerMinute: plan.requestsPerMinute,
          burst: plan.burst,
          dailyRequests: plan.dailyRequests,
          monthlyAiCalls: plan.monthlyAiCalls,
          storageMb: plan.storageMb,
          maxUsers: plan.maxUsers,
        }
      : FALLBACK;
    this.plans.set(tenantId, { plan: limits, at: now });
    return limits;
  }

  private async dayState(tenantId: string, day: string): Promise<DayState> {
    const key = `${tenantId}|${day}`;
    const have = this.days.get(key);
    if (have) return have;
    let p = this.loading.get(key);
    if (!p) {
      p = withSystem(this.database, async (tx) => {
        const [row] = await tx
          .select()
          .from(usageCounter)
          .where(and(eq(usageCounter.tenantId, tenantId), eq(usageCounter.day, day)));
        const s: DayState = {
          baseRequests: row?.requests ?? 0,
          requests: 0,
          pending: { requests: 0, throttled: 0, aiCalls: 0 },
        };
        this.days.set(key, s);
        return s;
      }).finally(() => this.loading.delete(key));
      this.loading.set(key, p);
    }
    return p;
  }

  private async aiThisMonth(tenantId: string, month: string): Promise<number> {
    const key = `${tenantId}|${month}`;
    const have = this.aiMonth.get(key);
    if (have !== undefined) return have;
    const start = `${month}-01`;
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const total = await withSystem(this.database, async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`coalesce(sum(${usageCounter.aiCalls}), 0)::int` })
        .from(usageCounter)
        .where(
          and(
            eq(usageCounter.tenantId, tenantId),
            gte(usageCounter.day, start),
            lt(usageCounter.day, dayOf(next)),
          ),
        );
      return r?.n ?? 0;
    });
    // another request may have set it while this one waited: keep the larger count
    const cur = this.aiMonth.get(key);
    if (cur !== undefined) return cur;
    this.aiMonth.set(key, total);
    return total;
  }

  /** One request from `tenantId`: takes a token, counts it, or refuses it with how long to wait. */
  async admit(tenantId: string, opts: { ai: boolean }): Promise<Admission> {
    const plan = await this.planFor(tenantId);
    const now = this.clock.now();
    const nowMs = now.getTime();
    const day = dayOf(now);
    const st = await this.dayState(tenantId, day);

    const refuse = (
      reason: LimitReason,
      retryAfterSeconds: number,
      limit: number,
      detail: string,
    ): Admission => {
      st.pending.throttled += 1;
      return {
        ok: false,
        reason,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
        plan,
        limit,
        detail,
      };
    };

    // daily allowance
    if (st.baseRequests + st.requests >= plan.dailyRequests) {
      const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      return refuse(
        'DAILY_REQUESTS',
        (midnight - nowMs) / 1000,
        plan.dailyRequests,
        `The ${plan.name} plan allows ${plan.dailyRequests.toLocaleString('en-AU')} requests a day and today's allowance is used up`,
      );
    }
    // monthly AI calls
    if (opts.ai) {
      const used = await this.aiThisMonth(tenantId, monthOf(now));
      if (used >= plan.monthlyAiCalls) {
        const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
        return refuse(
          'MONTHLY_AI_CALLS',
          (first - nowMs) / 1000,
          plan.monthlyAiCalls,
          `The ${plan.name} plan allows ${plan.monthlyAiCalls.toLocaleString('en-AU')} AI calls a month and this month's allowance is used up`,
        );
      }
    }
    // the per-minute bucket: refills continuously at requestsPerMinute / 60 a second, up to the burst
    const rate = plan.requestsPerMinute / 60;
    const b = this.buckets.get(tenantId) ?? { tokens: plan.burst, last: nowMs };
    b.tokens = Math.min(plan.burst, b.tokens + Math.max(0, (nowMs - b.last) / 1000) * rate);
    b.last = nowMs;
    if (b.tokens < 1) {
      this.buckets.set(tenantId, b);
      return refuse(
        'REQUESTS_PER_MINUTE',
        (1 - b.tokens) / rate,
        plan.requestsPerMinute,
        `The ${plan.name} plan allows ${plan.requestsPerMinute.toLocaleString('en-AU')} requests a minute with a burst of ${plan.burst.toLocaleString('en-AU')}`,
      );
    }
    b.tokens -= 1;
    this.buckets.set(tenantId, b);
    st.requests += 1;
    st.pending.requests += 1;
    if (opts.ai) {
      st.pending.aiCalls += 1;
      const mk = `${tenantId}|${monthOf(now)}`;
      this.aiMonth.set(mk, (this.aiMonth.get(mk) ?? 0) + 1);
    }
    return { ok: true };
  }

  /** Writes the batched counts. Safe to call at any time; concurrent callers each write what they took. */
  async flush(): Promise<void> {
    const work: Array<{ tenantId: string; day: string; p: DayState['pending'] }> = [];
    for (const [key, st] of this.days) {
      const p = st.pending;
      if (!p.requests && !p.throttled && !p.aiCalls) continue;
      const [tenantId, day] = key.split('|') as [string, string];
      work.push({ tenantId, day, p: { ...p } });
      st.pending = { requests: 0, throttled: 0, aiCalls: 0 };
    }
    if (work.length === 0) return;
    try {
      await withSystem(this.database, async (tx) => {
        for (const w of work)
          await tx
            .insert(usageCounter)
            .values({
              tenantId: w.tenantId,
              day: w.day,
              requests: w.p.requests,
              throttled: w.p.throttled,
              aiCalls: w.p.aiCalls,
            })
            .onConflictDoUpdate({
              target: [usageCounter.tenantId, usageCounter.day],
              set: {
                requests: sql`${usageCounter.requests} + ${w.p.requests}`,
                throttled: sql`${usageCounter.throttled} + ${w.p.throttled}`,
                aiCalls: sql`${usageCounter.aiCalls} + ${w.p.aiCalls}`,
              },
            });
      });
    } catch (e) {
      // put the counts back so a later flush writes them
      for (const w of work) {
        const st = this.days.get(`${w.tenantId}|${w.day}`);
        if (st) {
          st.pending.requests += w.p.requests;
          st.pending.throttled += w.p.throttled;
          st.pending.aiCalls += w.p.aiCalls;
        }
      }
      throw e;
    }
  }

  /** A tenant's plan, limits and use: today, this month and the last week. */
  async usageFor(tenantId: string) {
    await this.flush();
    const plan = await this.planFor(tenantId);
    const now = this.clock.now();
    const today = dayOf(now);
    const weekAgo = dayOf(new Date(now.getTime() - 6 * 86_400_000));
    const month = monthOf(now);
    const data = await withSystem(this.database, async (tx) => {
      const rows = await tx
        .select()
        .from(usageCounter)
        .where(and(eq(usageCounter.tenantId, tenantId), gte(usageCounter.day, `${month}-01`)));
      const [files] = await tx
        .select({ n: sql<number>`coalesce(sum(${fileObject.sizeBytes}), 0)::bigint` })
        .from(fileObject)
        .where(eq(fileObject.tenantId, tenantId));
      const [cfiles] = await tx
        .select({ n: sql<number>`coalesce(sum(${contractFile.sizeBytes}), 0)::bigint` })
        .from(contractFile)
        .where(eq(contractFile.tenantId, tenantId));
      const [users] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(appUser)
        .where(and(eq(appUser.tenantId, tenantId), eq(appUser.active, true)));
      return { rows, bytes: Number(files?.n ?? 0) + Number(cfiles?.n ?? 0), users: users?.n ?? 0 };
    });
    const t = data.rows.find((r) => r.day === today);
    const rate = plan.requestsPerMinute / 60;
    const b = this.buckets.get(tenantId);
    const tokens = b
      ? Math.min(plan.burst, b.tokens + Math.max(0, (now.getTime() - b.last) / 1000) * rate)
      : plan.burst;
    // keep the estimate on today's row so a report can see how storage grew
    await withSystem(this.database, (tx) =>
      tx
        .insert(usageCounter)
        .values({ tenantId, day: today, storageBytes: data.bytes })
        .onConflictDoUpdate({
          target: [usageCounter.tenantId, usageCounter.day],
          set: { storageBytes: data.bytes },
        }),
    );
    return {
      plan,
      today: {
        day: today,
        requests: t?.requests ?? 0,
        throttled: t?.throttled ?? 0,
        aiCalls: t?.aiCalls ?? 0,
        requestsRemaining: Math.max(0, plan.dailyRequests - (t?.requests ?? 0)),
      },
      month: {
        month,
        requests: data.rows.reduce((s, r) => s + r.requests, 0),
        throttled: data.rows.reduce((s, r) => s + r.throttled, 0),
        aiCalls: data.rows.reduce((s, r) => s + r.aiCalls, 0),
        aiCallsRemaining: Math.max(0, plan.monthlyAiCalls - data.rows.reduce((s, r) => s + r.aiCalls, 0)),
      },
      bucket: {
        tokens: Math.floor(tokens),
        capacity: plan.burst,
        refillPerSecond: Math.round(rate * 100) / 100,
      },
      storage: {
        usedBytes: data.bytes,
        usedMb: Math.round((data.bytes / 1_048_576) * 100) / 100,
        limitMb: plan.storageMb,
        estimate: true,
      },
      users: { active: data.users, max: plan.maxUsers },
      recent: data.rows
        .filter((r) => r.day >= weekAgo)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ day: r.day, requests: r.requests, throttled: r.throttled, aiCalls: r.aiCalls })),
    };
  }
}

const AI_PATH = /\/(assistant|instructions|generate|draft|ask)(\/|$)/;

/**
 * The throttle: a hook that runs after the session is resolved. Signed-in API calls take a token from their tenant's bucket.
 * Health checks and sign-in are not counted here (sign-in has its own limiter), and neither are callers with no session.
 */
export function installThrottle(app: FastifyInstance, tenancy: Tenancy, prefix: string): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.auth) return;
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith(prefix)) return;
    if (path === `${prefix}/health` || path.startsWith(`${prefix}/auth/login`)) return;
    const r = await tenancy.admit(req.auth.user.tenantId, {
      ai: req.method === 'POST' && AI_PATH.test(path),
    });
    if (r.ok) return;
    void reply
      .header('retry-after', String(r.retryAfterSeconds))
      .status(429)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        status: 429,
        title: 'Your organisation has used its request allowance',
        code: 'TENANT_THROTTLED',
        detail: `${r.detail}. Try again in ${r.retryAfterSeconds} second${r.retryAfterSeconds === 1 ? '' : 's'}.`,
        limit: r.reason,
        limitValue: r.limit,
        plan: {
          key: r.plan.key,
          name: r.plan.name,
          requestsPerMinute: r.plan.requestsPerMinute,
          burst: r.plan.burst,
          dailyRequests: r.plan.dailyRequests,
          monthlyAiCalls: r.plan.monthlyAiCalls,
        },
        retryAfterSeconds: r.retryAfterSeconds,
        correlationId: req.id,
      });
    return reply;
  });
}
