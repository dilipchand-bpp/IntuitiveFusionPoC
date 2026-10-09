/**
 * Historical spend as the reports see it (CP-07): one aggregation used by the analytics-store route and by the main spend
 * report, so the two always agree. Financial years are Australian (1 July to 30 June).
 */
import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { histSpendLine } from '../../db/schema.js';
import { fyLabel, fyOf } from '../b9/analytics-rules.js';

export interface SpendRow {
  supplier: string;
  category: string;
  businessUnit: string;
  amount: number;
  date: string;
}

export interface HistoricalSpend {
  lines: number;
  total: number;
  from: string | null;
  to: string | null;
  byFinancialYear: Array<{ year: string; total: number; lines: number }>;
  byCategory: Array<{ category: string; total: number; lines: number }>;
  bySupplier: Array<{ supplier: string; total: number; lines: number }>;
  byBusinessUnit: Array<{ businessUnit: string; total: number; lines: number }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateSpend(rows: SpendRow[]): HistoricalSpend {
  const group = <K extends string>(key: (r: SpendRow) => string, name: K) => {
    const m = new Map<string, { total: number; lines: number }>();
    for (const r of rows) {
      const e = m.get(key(r)) ?? { total: 0, lines: 0 };
      e.total += r.amount;
      e.lines += 1;
      m.set(key(r), e);
    }
    return [...m.entries()]
      .map(
        ([k, v]) =>
          ({ [name]: k, total: r2(v.total), lines: v.lines }) as { [P in K]: string } & {
            total: number;
            lines: number;
          },
      )
      .sort((a, b) => b.total - a.total);
  };
  const dates = rows.map((r) => r.date).sort();
  const byFy = new Map<string, { total: number; lines: number }>();
  for (const r of rows) {
    const k = fyLabel(fyOf(r.date));
    const e = byFy.get(k) ?? { total: 0, lines: 0 };
    e.total += r.amount;
    e.lines += 1;
    byFy.set(k, e);
  }
  return {
    lines: rows.length,
    total: r2(rows.reduce((n, r) => n + r.amount, 0)),
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    byFinancialYear: [...byFy.entries()]
      .map(([year, v]) => ({ year, total: r2(v.total), lines: v.lines }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    byCategory: group((r) => r.category, 'category'),
    bySupplier: group((r) => r.supplier, 'supplier').slice(0, 25),
    byBusinessUnit: group((r) => r.businessUnit, 'businessUnit'),
  };
}

/** From the main database (what the main spend report shows). */
export async function historicalSpend(tx: Tx, tenantId: string): Promise<HistoricalSpend> {
  const rows = await tx.select().from(histSpendLine).where(eq(histSpendLine.tenantId, tenantId));
  return aggregateSpend(
    rows.map((r) => ({
      supplier: r.supplierName,
      category: r.category,
      businessUnit: r.businessUnit,
      amount: Number(r.amount),
      date: r.spendDate,
    })),
  );
}
