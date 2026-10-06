/**
 * Currencies (FR-0810): the rates the organisation uses, a way to convert, and the one place a foreign amount becomes a base
 * amount (`toBaseAmount`), so a request, its approval limits and every total all use the same figure and the same rate.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { fxRate } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import {
  ANCHORS,
  FX_MODEL,
  SUPPORTED,
  convert,
  financialYear,
  fyStart,
  rateOn,
  simulatedLiveRate,
  toBase,
  type Converted,
  type Rate,
} from './fx-rules.js';

export interface FxDeps extends GuardDeps {
  audit: AuditService;
}
const FOREIGN = SUPPORTED.filter((c) => c !== 'AUD');

export async function loadRates(tx: Tx, tenantId: string): Promise<Rate[]> {
  const rows = await tx.select().from(fxRate).where(eq(fxRate.tenantId, tenantId)).orderBy(desc(fxRate.asOf));
  return rows.map((r) => ({ currency: r.currency, rate: Number(r.rate), asOf: r.asOf, source: r.source }));
}

/** In LIVE mode, today's rate for each currency is taken from the feed the first time it is needed that day. */
export async function ensureLive(tx: Tx, tenantId: string, today: string): Promise<void> {
  const have = new Set(
    (
      await tx
        .select({ c: fxRate.currency })
        .from(fxRate)
        .where(and(eq(fxRate.tenantId, tenantId), eq(fxRate.asOf, today)))
    ).map((r) => r.c),
  );
  for (const c of FOREIGN)
    if (!have.has(c))
      await tx
        .insert(fxRate)
        .values({
          tenantId,
          currency: c,
          rate: String(simulatedLiveRate(c, ANCHORS[c]!, today)),
          asOf: today,
          source: 'LIVE',
          createdAt: new Date(`${today}T00:00:00Z`),
        })
        .onConflictDoNothing();
}

/**
 * Converts an amount a person typed into the base currency, using the rate that applies on the date. No rate for the
 * currency is an error the person can see and act on; the platform never guesses a rate.
 */
export async function toBaseAmount(
  tx: Tx,
  tenantId: string,
  currency: string,
  amount: number,
  today: string,
): Promise<Converted> {
  const s = await loadSettings(tx, tenantId);
  if (currency === s.currency.base) return toBase(amount, currency, s.currency.base, null)!;
  if (s.currency.rateMode === 'LIVE') await ensureLive(tx, tenantId, today);
  const rate = rateOn(await loadRates(tx, tenantId), currency, today, s.currency.rateMode);
  const out = toBase(amount, currency, s.currency.base, rate);
  if (!out)
    throw new AppError(
      422,
      'NO_FX_RATE',
      `There is no ${s.currency.rateMode === 'ANNUAL' ? 'rate for this financial year' : 'rate'} for ${currency}. Ask finance to set one.`,
      [{ field: 'currency', message: `No rate for ${currency}` }],
    );
  return out;
}

const setBody = z
  .object({
    currency: z.enum(FOREIGN as unknown as [string, ...string[]]),
    rate: z.number().positive().max(100000),
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
const convQuery = z.object({
  amount: z.coerce.number().min(0).max(1e12),
  from: z.enum(SUPPORTED as unknown as [string, ...string[]]),
  to: z.enum(SUPPORTED as unknown as [string, ...string[]]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export function registerFx(app: FastifyInstance, p: string, d: FxDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const today = () => d.clock.now().toISOString().slice(0, 10);
  const STAFF = [
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
  ] as const;

  reg('GET', '/fx/rates');
  app.get(`${p}/fx/rates`, { preHandler: guard(d, [...STAFF]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      if (s.currency.rateMode === 'LIVE') await ensureLive(tx, a.user.tenantId, today());
      const rates = await loadRates(tx, a.user.tenantId);
      const t = today();
      return {
        model: FX_MODEL,
        base: s.currency.base,
        mode: s.currency.rateMode,
        financialYear: financialYear(t),
        supported: SUPPORTED,
        current: FOREIGN.map((c) => {
          const r = rateOn(rates, c, t, s.currency.rateMode);
          return { currency: c, rate: r?.rate ?? null, asOf: r?.asOf ?? null, source: r?.source ?? null };
        }),
        history: rates.slice(0, 60),
      };
    });
  });

  reg('PUT', '/fx/rates');
  app.put(`${p}/fx/rates`, { preHandler: guard(d, ['ADMIN', 'FINANCE']) }, async (req) => {
    const a = req.auth!;
    const body = parse(setBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      // an annual rate is set for the whole financial year, so it is dated the first day of it
      const asOf =
        body.asOf ?? (s.currency.rateMode === 'ANNUAL' ? fyStart(financialYear(today())) : today());
      await tx
        .insert(fxRate)
        .values({
          tenantId: a.user.tenantId,
          currency: body.currency,
          rate: String(body.rate),
          asOf,
          source: s.currency.rateMode === 'ANNUAL' ? 'ANNUAL' : 'MANUAL',
          createdBy: a.user.id,
          createdAt: d.clock.now(),
        })
        .onConflictDoUpdate({
          target: [fxRate.tenantId, fxRate.currency, fxRate.asOf],
          set: { rate: String(body.rate), createdBy: a.user.id, createdAt: d.clock.now() },
        });
      await d.audit.record(tx, a.ctx, {
        action: 'fx.rate_set',
        entityType: 'fx_rate',
        entityId: a.user.tenantId,
        after: { currency: body.currency, rate: body.rate, asOf },
      });
      return { currency: body.currency, rate: body.rate, asOf };
    });
  });

  reg('POST', '/fx/refresh');
  app.post(`${p}/fx/refresh`, { preHandler: guard(d, ['ADMIN', 'FINANCE']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      if (s.currency.rateMode !== 'LIVE')
        throw new AppError(
          409,
          'INVALID_STATE',
          'Rates are set once a year. Switch to live rates in the settings to use the feed.',
        );
      await ensureLive(tx, a.user.tenantId, today());
      await d.audit.record(tx, a.ctx, {
        action: 'fx.refresh',
        entityType: 'fx_rate',
        entityId: a.user.tenantId,
        after: { asOf: today(), provider: 'simulated feed' },
      });
      return {
        asOf: today(),
        provider: 'A simulated rates feed (rules-simulated-v1)',
        currencies: FOREIGN.length,
      };
    });
  });

  reg('GET', '/fx/convert');
  app.get(`${p}/fx/convert`, { preHandler: guard(d, [...STAFF]) }, async (req) => {
    const a = req.auth!;
    const q = parse(convQuery, req.query);
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const date = q.date ?? today();
      if (s.currency.rateMode === 'LIVE') await ensureLive(tx, a.user.tenantId, today());
      const out = convert(
        q.amount,
        q.from,
        q.to,
        s.currency.base,
        await loadRates(tx, a.user.tenantId),
        date,
        s.currency.rateMode,
      );
      if (!out)
        throw new AppError(
          422,
          'NO_FX_RATE',
          'There is no rate to convert between those currencies on that date',
        );
      return {
        amount: q.amount,
        from: q.from,
        to: q.to,
        date,
        result: out.amount,
        via: out.via,
        mode: s.currency.rateMode,
      };
    });
  });
  return done;
}
