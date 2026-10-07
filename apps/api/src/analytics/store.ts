/**
 * The analytics store (NFR-P05): a second database, separate from the one the platform works in, holding a flat copy of
 * the facts that spend reports need. A report asks this store, not the main database, so a heavy analytical query cannot slow
 * the screens people are working in. The copy is rebuilt on a schedule and when someone asks; every answer says how old it is.
 *
 * SWAP POINT (docs/swap-points.md): here it is a second in-memory PGlite. A real deployment loads the same tables into a
 * warehouse (Redshift, BigQuery, Snowflake) with a nightly or streaming job; the reports keep their SQL.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { withSystem, type Database, type Tx } from '../db/client.js';
import {
  contract,
  contractExtension,
  contractRate,
  fieldValue,
  invoice,
  request,
  restrictedProject,
  supplier,
  tender,
} from '../db/schema.js';
import { categoryOf } from '../modules/b9/analytics-rules.js';

const DDL = `
CREATE TABLE IF NOT EXISTS fact_contract (
  tenant_id text, id text, number text, title text, supplier_id text, supplier text, category text, business_unit text,
  cost_centre text, owner_id text, doc_type text, value numeric, spent numeric, start_date date, end_date date, has_rate_card boolean
);
CREATE TABLE IF NOT EXISTS fact_extension (tenant_id text, contract_id text, months integer, exercised boolean);
CREATE TABLE IF NOT EXISTS fact_rate (tenant_id text, contract_id text, supplier_id text, supplier text, item text, unit text, unit_price numeric);
CREATE TABLE IF NOT EXISTS fact_line (tenant_id text, contract_id text, supplier_id text, supplier text, item text, qty numeric, unit_price numeric, invoice_date date, status text);
CREATE TABLE IF NOT EXISTS fact_category_tender (tenant_id text, category text, tenders integer);
CREATE TABLE IF NOT EXISTS refresh_log (tenant_id text PRIMARY KEY, refreshed_at timestamptz, ms integer, rows jsonb);
`;
const TABLES = ['fact_contract', 'fact_extension', 'fact_rate', 'fact_line', 'fact_category_tender'] as const;

export interface RefreshInfo {
  asOf: string | null;
  ms: number | null;
  rows: Record<string, number>;
}
type Row = Array<string | number | boolean | null>;

export class AnalyticsStore {
  private constructor(private readonly pg: PGlite) {}
  private running = new Map<string, Promise<RefreshInfo>>();

  static async open(): Promise<AnalyticsStore> {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(DDL);
    return new AnalyticsStore(pg);
  }
  async close() {
    await this.pg.close();
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pg.query<T>(sql, params);
    return r.rows;
  }

  async info(tenantId: string): Promise<RefreshInfo> {
    const [r] = await this.query<{ refreshed_at: string; ms: number; rows: Record<string, number> }>(
      'select refreshed_at, ms, rows from refresh_log where tenant_id = $1',
      [tenantId],
    );
    return r
      ? { asOf: new Date(r.refreshed_at).toISOString(), ms: r.ms, rows: r.rows }
      : { asOf: null, ms: null, rows: {} };
  }

  /** Rebuilds the copy for one tenant from the main database. Two requests at once share one rebuild. */
  refresh(main: Database, tenantId: string, now: Date): Promise<RefreshInfo> {
    const running = this.running.get(tenantId);
    if (running) return running;
    const p = this.rebuild(main, tenantId, now).finally(() => this.running.delete(tenantId));
    this.running.set(tenantId, p);
    return p;
  }

  /** Rebuilds only if the copy is older than `maxAgeMinutes` (or has never been made). */
  async ensureFresh(
    main: Database,
    tenantId: string,
    now: Date,
    maxAgeMinutes: number,
  ): Promise<RefreshInfo> {
    const cur = await this.info(tenantId);
    if (
      cur.asOf &&
      now.getTime() - Date.parse(cur.asOf) < maxAgeMinutes * 60_000 &&
      now.getTime() >= Date.parse(cur.asOf)
    )
      return cur;
    return this.refresh(main, tenantId, now);
  }

  private async rebuild(main: Database, tenantId: string, now: Date): Promise<RefreshInfo> {
    const started = Date.now();
    // one read of the main database, as a single consistent snapshot
    const facts = await withSystem(main, (tx) => readFacts(tx, tenantId));
    const rows: Record<string, number> = {};
    await this.pg.transaction(async (t) => {
      for (const table of TABLES) await t.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
      for (const [table, cols, data] of facts) {
        rows[table] = data.length;
        for (let i = 0; i < data.length; i += 100) {
          const chunk = data.slice(i, i + 100);
          const values = chunk
            .map((_, r) => `(${cols.map((__, c) => `$${r * cols.length + c + 1}`).join(',')})`)
            .join(',');
          await t.query(`insert into ${table} (${cols.join(',')}) values ${values}`, chunk.flat());
        }
      }
      const ms = Date.now() - started;
      await t.query(
        `insert into refresh_log (tenant_id, refreshed_at, ms, rows) values ($1,$2,$3,$4)
         on conflict (tenant_id) do update set refreshed_at = excluded.refreshed_at, ms = excluded.ms, rows = excluded.rows`,
        [tenantId, now.toISOString(), ms, JSON.stringify(rows)],
      );
    });
    return { asOf: now.toISOString(), ms: Date.now() - started, rows };
  }
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const COUNTED = ['MATCHED', 'EXCEPTION', 'PAID'] as const;

async function readFacts(tx: Tx, tenantId: string): Promise<Array<[string, string[], Row[]]>> {
  // a restricted project (FR-0865) is left out of the analytics store: it is read by roles that are not in its sourcing group
  const restricted = (
    await tx
      .select({ id: restrictedProject.requestId })
      .from(restrictedProject)
      .where(eq(restrictedProject.tenantId, tenantId))
  ).map((r) => r.id);
  const hiddenTenders = new Set(
    restricted.length
      ? (await tx.select({ id: tender.id }).from(tender).where(inArray(tender.requestId, restricted))).map(
          (t) => t.id,
        )
      : [],
  );
  const roots = (
    await tx
      .select()
      .from(contract)
      .where(
        and(
          eq(contract.tenantId, tenantId),
          eq(contract.status, 'EXECUTED'),
          isNull(contract.deletedAt),
          isNull(contract.parentId),
        ),
      )
  ).filter((c) => !c.tenderId || !hiddenTenders.has(c.tenderId));
  const ids = roots.map((c) => c.id);
  const kids = ids.length
    ? await tx
        .select()
        .from(contract)
        .where(
          and(inArray(contract.parentId, ids), eq(contract.status, 'EXECUTED'), isNull(contract.deletedAt)),
        )
    : [];
  const sups = new Map(
    (await tx.select().from(supplier).where(eq(supplier.tenantId, tenantId))).map((s) => [s.id, s.company]),
  );
  const tenders = await tx.select().from(tender).where(eq(tender.tenantId, tenantId));
  const reqs = new Map(
    (await tx.select().from(request).where(eq(request.tenantId, tenantId))).map((r) => [r.id, r]),
  );
  const costCentres = new Map(
    (
      await tx
        .select({ id: fieldValue.ownerId, v: fieldValue.value })
        .from(fieldValue)
        .where(
          and(
            eq(fieldValue.tenantId, tenantId),
            eq(fieldValue.ownerType, 'REQUEST'),
            eq(fieldValue.key, 'costCentre'),
          ),
        )
    ).map((x) => [x.id, x.v]),
  );
  const rates = ids.length
    ? await tx.select().from(contractRate).where(inArray(contractRate.contractId, ids))
    : [];
  const exts = ids.length
    ? await tx.select().from(contractExtension).where(inArray(contractExtension.contractId, ids))
    : [];
  const invs = ids.length ? await tx.select().from(invoice).where(inArray(invoice.contractId, ids)) : [];
  const rateOwners = new Set(rates.map((r) => r.contractId));

  const contractRows: Row[] = roots.map((c) => {
    const t = tenders.find((x) => x.id === c.tenderId);
    const r = t ? reqs.get(t.requestId) : c.linkedRequestId ? reqs.get(c.linkedRequestId) : undefined;
    const mine = kids.filter((k) => k.parentId === c.id);
    const end =
      [c.endDate, ...mine.map((k) => k.endDate)]
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null;
    const spent = invs
      .filter((i) => i.contractId === c.id && (COUNTED as readonly string[]).includes(i.status))
      .reduce((n, i) => n + num(i.amount), 0);
    return [
      tenantId,
      c.id,
      c.number,
      c.title,
      c.supplierId,
      sups.get(c.supplierId) ?? '',
      categoryOf(r?.category ?? null),
      r?.businessUnit ?? 'Not recorded',
      (r ? costCentres.get(r.id) : null) || 'Not recorded',
      c.ownerId,
      c.docType,
      num(c.value) + mine.reduce((n, k) => n + num(k.value), 0),
      spent,
      c.startDate,
      end,
      rateOwners.has(c.id),
    ];
  });
  const lineRows: Row[] = [];
  for (const i of invs) {
    const c = roots.find((x) => x.id === i.contractId);
    for (const l of (i.lines as Array<{ item: string; qty: number; unitPrice: number }>) ?? [])
      lineRows.push([
        tenantId,
        i.contractId,
        c?.supplierId ?? '',
        sups.get(c?.supplierId ?? '') ?? '',
        l.item,
        l.qty,
        l.unitPrice,
        i.invoiceDate,
        i.status,
      ]);
  }
  const perCategory = new Map<string, number>();
  for (const t of tenders) {
    if (!['CLOSED', 'EVALUATING', 'AWARDED'].includes(t.status)) continue;
    const cat = categoryOf(reqs.get(t.requestId)?.category ?? null);
    perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1);
  }
  return [
    [
      'fact_contract',
      [
        'tenant_id',
        'id',
        'number',
        'title',
        'supplier_id',
        'supplier',
        'category',
        'business_unit',
        'cost_centre',
        'owner_id',
        'doc_type',
        'value',
        'spent',
        'start_date',
        'end_date',
        'has_rate_card',
      ],
      contractRows,
    ],
    [
      'fact_extension',
      ['tenant_id', 'contract_id', 'months', 'exercised'],
      exts.map((e) => [tenantId, e.contractId, e.months, e.exercisedAt !== null]),
    ],
    [
      'fact_rate',
      ['tenant_id', 'contract_id', 'supplier_id', 'supplier', 'item', 'unit', 'unit_price'],
      rates.map((r) => {
        const c = roots.find((x) => x.id === r.contractId);
        return [
          tenantId,
          r.contractId,
          c?.supplierId ?? '',
          sups.get(c?.supplierId ?? '') ?? '',
          r.item,
          r.unit,
          num(r.unitPrice),
        ];
      }),
    ],
    [
      'fact_line',
      [
        'tenant_id',
        'contract_id',
        'supplier_id',
        'supplier',
        'item',
        'qty',
        'unit_price',
        'invoice_date',
        'status',
      ],
      lineRows,
    ],
    [
      'fact_category_tender',
      ['tenant_id', 'category', 'tenders'],
      [...perCategory.entries()].map(([c, n]) => [tenantId, c, n]),
    ],
  ];
}
