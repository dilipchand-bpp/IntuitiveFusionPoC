'use client';
import Link from 'next/link';
import { Badge, Button, EmptyState, Table, Td, Th } from '@if/ui';
import { aud, formatDateTime } from '@/lib/labels';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

const MODEL = 'rules-simulated-v1';
const compact = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

const Failure = ({ error }: { error: string }) => (
  <p role="alert" className="text-sm text-error">
    {error}
  </p>
);

// ------------------------------------------------------------------ analytics store status (NFR-P05)
interface Status {
  store: string;
  asOf: string | null;
  rebuiltInMs: number | null;
  rows: number | null;
  refreshEveryMinutes: number;
  readsFromIt: string[];
}

export function AnalyticsBadge({
  csrf,
  roles = [],
  model = MODEL,
  onRefreshed,
}: {
  csrf: string;
  roles?: readonly string[];
  model?: string;
  onRefreshed?: () => void | Promise<void>;
}) {
  const { data, error, reload } = useData<Status>('/analytics/status');
  const r = useRun();
  const canRefresh = has(roles, 'EXEC', 'FINANCE', 'PROCUREMENT', 'ADMIN');
  if (error) return <Failure error={error} />;
  if (!data) return <p className="text-sm text-text-muted">Loading analytics status…</p>;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
      data-testid="analytics-badge"
    >
      <span>
        <strong>Analytics store refreshed {data.asOf ? formatDateTime(data.asOf) : 'never'}</strong>
        <span className="text-text-muted">
          {' '}
          · {data.store}
          {data.rows !== null && ` · ${data.rows.toLocaleString('en-AU')} rows`}
          {data.rebuiltInMs !== null && ` in ${data.rebuiltInMs} ms`} · refreshes at least every{' '}
          {data.refreshEveryMinutes} min
        </span>
      </span>
      <Badge tone="info">{model}</Badge>
      {canRefresh && (
        <Button
          variant="secondary"
          loading={r.busy === 'refresh'}
          onClick={() =>
            r.run(
              'refresh',
              async () => {
                await send(csrf, 'POST', '/analytics/refresh');
                await reload();
                await onRefreshed?.();
              },
              'The analytics store was rebuilt from the main database.',
            )
          }
        >
          Refresh
        </Button>
      )}
      <div className="basis-full">{r.messages}</div>
    </div>
  );
}

// ------------------------------------------------------------------ future commitment (FR-0845)
interface Year {
  fy: number;
  label: string;
  committed: number;
  low: number;
  expected: number;
  high: number;
}
interface Commitment {
  model: string;
  asOf: string;
  by: 'businessUnit' | 'costCentre';
  years: string[];
  totals: Year[];
  rows: Array<{ key: string; years: Year[] }>;
  contracts: Array<{
    contractId: string;
    number: string;
    supplier: string;
    businessUnit: string;
    costCentre: string;
    basis: 'FIXED' | 'CEILING';
    years: Year[];
    unknowns: string[];
  }>;
  stated: string[];
}

const sum = (ys: Year[], k: 'committed' | 'low' | 'expected' | 'high') => ys.reduce((n, y) => n + y[k], 0);

export function CommitmentView({ csrf, roles = [] }: { csrf: string; roles?: readonly string[] }) {
  const { data, error, reload } = useData<Commitment>('/reports/future-commitment');
  if (error) return <Failure error={error} />;
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;

  const fixed = data.contracts.filter((c) => c.basis === 'FIXED');
  const ceiling = data.contracts.filter((c) => c.basis === 'CEILING');
  const fixedFirm = fixed.reduce((n, c) => n + sum(c.years, 'committed'), 0);
  const ceilLow = ceiling.reduce((n, c) => n + sum(c.years, 'low'), 0);
  const ceilExp = ceiling.reduce((n, c) => n + sum(c.years, 'expected'), 0);
  const ceilHigh = ceiling.reduce((n, c) => n + sum(c.years, 'high'), 0);
  const extensions = data.contracts.flatMap((c) =>
    c.unknowns.filter((u) => u.includes('option to extend')).map((u) => ({ c, u })),
  );
  const max = Math.max(1, ...data.totals.map((y) => y.high));
  const w = (n: number) => `${(Math.max(0, n) / max) * 100}%`;
  const byLabel = data.by === 'costCentre' ? 'cost centre' : 'business unit';

  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="commitment">
      <AnalyticsBadge csrf={csrf} roles={roles} model={data.model} onRefreshed={reload} />

      <section aria-labelledby="cm-tot" className="grid gap-4 sm:grid-cols-2">
        <h2 id="cm-tot" className="sr-only">
          Totals by contract basis
        </h2>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <p className="text-sm font-semibold text-text-muted">Fixed-value contracts</p>
          <p className="mt-1 text-2xl font-extrabold">{aud.format(fixedFirm)}</p>
          <p className="mt-1 text-sm text-text-muted">
            Firm commitment across {fixed.length} contract{fixed.length === 1 ? '' : 's'}: what remains to be
            paid.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <p className="text-sm font-semibold text-text-muted">Ceiling contracts</p>
          <p className="mt-1 text-2xl font-extrabold">
            {ceiling.length === 0 ? 'None' : `${aud.format(ceilLow)} to ${aud.format(ceilHigh)}`}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {ceiling.length === 0
              ? 'No master agreements or rate-card contracts.'
              : `No firm commitment across ${ceiling.length} contract${ceiling.length === 1 ? '' : 's'}; a range only, expected about ${aud.format(ceilExp)}.`}
          </p>
        </div>
      </section>

      <section
        aria-labelledby="cm-fy"
        className="min-w-0 rounded-lg border border-border bg-surface p-6 shadow-sm"
      >
        <h2 id="cm-fy" className="font-heading text-lg font-semibold">
          Commitment by financial year
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Estimates from the {data.model} model, as at {formatDateTime(data.asOf)}. Years run 1 July to 30
          June.
        </p>
        {data.totals.length === 0 ? (
          <p className="mt-3 text-text-muted">No current contracts to show.</p>
        ) : (
          <>
            <ul className="mt-4 flex flex-col gap-3" aria-hidden="true">
              {data.totals.map((y) => (
                <li key={y.fy}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span>{y.label}</span>
                    <strong>
                      {compact.format(y.committed)} firm, up to {compact.format(y.high)}
                    </strong>
                  </div>
                  <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-surface-alt">
                    <div className="h-3 bg-accent" style={{ width: w(y.committed) }} />
                    <div className="h-3 bg-info" style={{ width: w(y.expected - y.committed) }} />
                    <div className="h-3 bg-border-strong" style={{ width: w(y.high - y.expected) }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex flex-wrap gap-4 text-xs text-text-muted" aria-hidden="true">
              <span>
                <span className="mr-1 inline-block size-2 rounded-full bg-accent" />
                Firm
              </span>
              <span>
                <span className="mr-1 inline-block size-2 rounded-full bg-info" />
                Further expected
              </span>
              <span>
                <span className="mr-1 inline-block size-2 rounded-full bg-border-strong" />
                Possible, up to the top of the range
              </span>
            </p>
            <div className="mt-4">
              <Table caption="Commitment by financial year">
                <thead>
                  <tr>
                    <Th>Financial year</Th>
                    <Th className="text-right">Firm</Th>
                    <Th className="text-right">Low</Th>
                    <Th className="text-right">Expected</Th>
                    <Th className="text-right">High</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.totals.map((y) => (
                    <tr key={y.fy}>
                      <Td label="Financial year">{y.label}</Td>
                      <Td label="Firm" className="text-right">
                        {aud.format(y.committed)}
                      </Td>
                      <Td label="Low" className="text-right">
                        {aud.format(y.low)}
                      </Td>
                      <Td label="Expected" className="text-right">
                        {aud.format(y.expected)}
                      </Td>
                      <Td label="High" className="text-right">
                        {aud.format(y.high)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </section>

      {data.rows.length > 0 && (
        <section aria-labelledby="cm-by" className="flex min-w-0 flex-col gap-3">
          <h2 id="cm-by" className="font-heading text-xl font-bold">
            By {byLabel}
          </h2>
          <Table caption={`Expected commitment by ${byLabel} and financial year`}>
            <thead>
              <tr>
                <Th>{data.by === 'costCentre' ? 'Cost centre' : 'Business unit'}</Th>
                {data.years.map((l) => (
                  <Th key={l} className="text-right">
                    {l}
                  </Th>
                ))}
                <Th className="text-right">Firm total</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key}>
                  <Td label="Group">{r.key}</Td>
                  {r.years.map((y) => (
                    <Td key={y.fy} label={y.label} className="text-right">
                      {aud.format(y.expected)}
                    </Td>
                  ))}
                  <Td label="Firm total" className="text-right">
                    {aud.format(sum(r.years, 'committed'))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <section aria-labelledby="cm-ct" className="flex min-w-0 flex-col gap-3">
        <h2 id="cm-ct" className="font-heading text-xl font-bold">
          Contracts and their amount basis
        </h2>
        {data.contracts.length === 0 ? (
          <EmptyState title="No current contracts" body="Contracts that have not ended appear here." />
        ) : (
          <Table caption="Contracts and their amount basis">
            <thead>
              <tr>
                <Th>Contract</Th>
                <Th>Supplier</Th>
                <Th>Basis</Th>
                <Th className="text-right">Firm</Th>
                <Th className="text-right">Range</Th>
                <Th>What is not known</Th>
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr key={c.contractId} data-testid="commitment-row">
                  <Td label="Contract">
                    <Link href={`/app/contracts/${c.contractId}`}>{c.number}</Link>
                  </Td>
                  <Td label="Supplier">{c.supplier}</Td>
                  <Td label="Basis">
                    <Badge tone={c.basis === 'FIXED' ? 'success' : 'warning'}>
                      {c.basis === 'FIXED' ? 'Fixed value' : 'Ceiling'}
                    </Badge>
                  </Td>
                  <Td label="Firm" className="text-right">
                    {c.basis === 'FIXED' ? aud.format(sum(c.years, 'committed')) : 'None firm'}
                  </Td>
                  <Td label="Range" className="text-right">
                    {aud.format(sum(c.years, 'low'))} to {aud.format(sum(c.years, 'high'))}
                  </Td>
                  <Td label="What is not known">
                    {c.unknowns.length === 0 ? (
                      <span className="text-text-muted">Nothing flagged</span>
                    ) : (
                      <ul className="list-disc pl-4 text-sm">
                        {c.unknowns.map((u) => (
                          <li key={u}>{u}</li>
                        ))}
                      </ul>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="cm-ext" className="flex min-w-0 flex-col gap-3">
        <h2 id="cm-ext" className="font-heading text-xl font-bold">
          Options to extend
        </h2>
        {extensions.length === 0 ? (
          <p className="text-text-muted">No unexercised options to extend.</p>
        ) : (
          <>
            <p className="max-w-prose text-sm text-text-muted">
              None of these is committed. Each is counted only in the top of the range.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {extensions.map(({ c, u }, i) => (
                <li key={`${c.contractId}-${i}`} className="rounded-md border border-border px-3 py-2">
                  <Link href={`/app/contracts/${c.contractId}`}>{c.number}</Link> ({c.supplier}): {u}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="cm-st" className="rounded-lg border border-border bg-surface-alt p-5">
        <h2 id="cm-st" className="font-heading text-base font-semibold">
          How these figures are worked out
        </h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-text-muted">
          {data.stated.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ spend optimisation (FR-0840)
interface Optimisation {
  model: string;
  asOf: string;
  assumptions: { consolidationPct: number; varianceThresholdPct: number; driftThresholdPct: number };
  summary: {
    consolidation: number;
    rateCards: number;
    invoicedAboveContractRate: number;
    overchargesStopped: number;
    note: string;
  };
  consolidation: Array<{
    category: string;
    suppliers: Array<{ supplier: string; annual: number }>;
    lead: string;
    addressable: number;
    estimatedSaving: number;
  }>;
  duplicates: Array<{
    a: { id: string; number: string; title: string | null };
    b: { id: string; number: string; title: string | null };
    supplier: string;
    reason: string;
    overlapDays: number;
    annualOverlap: number;
  }>;
  rateCards: Array<{
    item: string;
    unit: string;
    lowest: { supplier: string; contract: string; unitPrice: number };
    others: Array<{ supplier: string; contract: string; unitPrice: number; gapPct: number }>;
    volume12m: number;
    estimatedSaving: number | null;
  }>;
  variance: Array<{
    kind: 'VS_CONTRACT_RATE' | 'DRIFT';
    blocked: boolean;
    item: string;
    supplier: string;
    contract: string;
    detail: string;
    variancePct: number;
    impact: number;
  }>;
  categories: Array<{
    category: string;
    annualSpend: number;
    contracts: number;
    suppliers: number;
    topSupplierSharePct: number;
    nextExpiry: string | null;
    tenders: number;
    signal: 'MARKET_TEST' | 'CONSOLIDATE' | 'RENEGOTIATE' | 'MONITOR';
    why: string;
  }>;
}

type Tone = 'info' | 'warning' | 'success' | 'neutral';
const SIGNAL: Record<string, [string, Tone]> = {
  MARKET_TEST: ['Test the market', 'warning'],
  CONSOLIDATE: ['Consolidate', 'info'],
  RENEGOTIATE: ['Renegotiate', 'success'],
  MONITOR: ['Monitor', 'neutral'],
};

const Empty = ({ text }: { text: string }) => <p className="text-text-muted">{text}</p>;

export function OptimisationView({ csrf, roles = [] }: { csrf: string; roles?: readonly string[] }) {
  const { data, error, reload } = useData<Optimisation>('/reports/optimisation');
  if (error) return <Failure error={error} />;
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const s = data.summary;
  const a = data.assumptions;
  const tiles: Array<[string, number, string]> = [
    [
      'Supplier consolidation',
      s.consolidation,
      `Assumes ${pct(a.consolidationPct)} off the spend with the smaller suppliers in a category.`,
    ],
    ['Rate-card gaps', s.rateCards, 'What the last twelve months would have cost at the lowest rate.'],
    [
      'Invoiced above contract rate',
      s.invoicedAboveContractRate,
      `Invoices more than ${pct(a.varianceThresholdPct)} above the contract rate and paid.`,
    ],
    [
      'Overcharges stopped',
      s.overchargesStopped,
      'Blocked at the price check, so not paid. Not a future saving.',
    ],
  ];
  const groups: Array<[string, Optimisation['variance']]> = [
    ['Paid above the rate, or drifting', data.variance.filter((v) => !v.blocked)],
    ['Blocked at the price check', data.variance.filter((v) => v.blocked)],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="optimisation">
      <AnalyticsBadge csrf={csrf} roles={roles} model={data.model} onRefreshed={reload} />

      <section aria-labelledby="op-sum" className="flex flex-col gap-3">
        <h2 id="op-sum" className="font-heading text-xl font-bold">
          Potential saving (estimates)
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map(([label, v, note]) => (
            <li key={label} className="rounded-lg border border-border bg-surface p-5 shadow-sm">
              <p className="text-sm font-semibold text-text-muted">{label}</p>
              <p className="mt-1 text-2xl font-extrabold">
                <span className="sr-only">Estimated </span>
                {aud.format(v)}
              </p>
              <p className="mt-1 text-xs text-text-muted">{note}</p>
            </li>
          ))}
        </ul>
        <p className="max-w-prose text-sm text-text-muted">
          {s.note} Figures are estimates from {data.model}, as at {formatDateTime(data.asOf)}.
        </p>
      </section>

      <section aria-labelledby="op-con" className="flex min-w-0 flex-col gap-3">
        <h2 id="op-con" className="font-heading text-xl font-bold">
          Consolidation
        </h2>
        {data.consolidation.length === 0 ? (
          <Empty text="No category is spread across more than one supplier." />
        ) : (
          <Table caption="Categories that could be consolidated onto one supplier">
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Evidence: annual spend by supplier</Th>
                <Th className="text-right">Addressable</Th>
                <Th className="text-right">Estimated saving</Th>
              </tr>
            </thead>
            <tbody>
              {data.consolidation.map((c) => (
                <tr key={c.category}>
                  <Td label="Category">{c.category}</Td>
                  <Td label="Evidence">
                    <ul className="text-sm">
                      {c.suppliers.map((x) => (
                        <li key={x.supplier}>
                          {x.supplier}: {aud.format(x.annual)}
                          {x.supplier === c.lead && <span className="text-text-muted"> (largest, kept)</span>}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td label="Addressable" className="text-right">
                    {aud.format(c.addressable)}
                  </Td>
                  <Td label="Estimated saving" className="text-right">
                    {aud.format(c.estimatedSaving)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="op-dup" className="flex min-w-0 flex-col gap-3">
        <h2 id="op-dup" className="font-heading text-xl font-bold">
          Possible duplicate contracts
        </h2>
        {data.duplicates.length === 0 ? (
          <Empty text="No overlapping contracts with the same supplier were found." />
        ) : (
          <Table caption="Possible duplicate contracts">
            <thead>
              <tr>
                <Th>Contracts</Th>
                <Th>Supplier</Th>
                <Th>Evidence</Th>
                <Th className="text-right">Annual overlap</Th>
              </tr>
            </thead>
            <tbody>
              {data.duplicates.map((d) => (
                <tr key={`${d.a.id}-${d.b.id}`}>
                  <Td label="Contracts">
                    <Link href={`/app/contracts/${d.a.id}`}>{d.a.number}</Link>
                    {d.a.title ? ` ${d.a.title}` : ''} and{' '}
                    <Link href={`/app/contracts/${d.b.id}`}>{d.b.number}</Link>
                    {d.b.title ? ` ${d.b.title}` : ''}
                  </Td>
                  <Td label="Supplier">{d.supplier}</Td>
                  <Td label="Evidence">
                    {d.reason}; overlapping for {d.overlapDays} days.
                  </Td>
                  <Td label="Annual overlap" className="text-right">
                    {aud.format(d.annualOverlap)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="op-rate" className="flex min-w-0 flex-col gap-3">
        <h2 id="op-rate" className="font-heading text-xl font-bold">
          Rate-card gaps
        </h2>
        {data.rateCards.length === 0 ? (
          <Empty text="No item is priced differently on more than one rate card." />
        ) : (
          <Table caption="Items priced higher on one rate card than another">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Lowest rate</Th>
                <Th>Higher rates</Th>
                <Th className="text-right">Bought, last 12 months</Th>
                <Th className="text-right">Estimated saving</Th>
              </tr>
            </thead>
            <tbody>
              {data.rateCards.map((g) => (
                <tr key={g.item}>
                  <Td label="Item">
                    {g.item} <span className="text-text-muted">per {g.unit}</span>
                  </Td>
                  <Td label="Lowest rate">
                    {g.lowest.supplier} ({g.lowest.contract}): {aud.format(g.lowest.unitPrice)}
                  </Td>
                  <Td label="Higher rates">
                    <ul className="text-sm">
                      {g.others.map((o) => (
                        <li key={`${o.supplier}-${o.contract}`}>
                          {o.supplier} ({o.contract}): {aud.format(o.unitPrice)}, {pct(o.gapPct)} higher
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td label="Bought, last 12 months" className="text-right">
                    {g.volume12m.toLocaleString('en-AU')}
                  </Td>
                  <Td label="Estimated saving" className="text-right">
                    {g.estimatedSaving === null ? 'Not known: nothing bought' : aud.format(g.estimatedSaving)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="op-var" className="flex min-w-0 flex-col gap-3">
        <h2 id="op-var" className="font-heading text-xl font-bold">
          Price variance
        </h2>
        <p className="max-w-prose text-sm text-text-muted">
          Flags an invoice more than {pct(a.varianceThresholdPct)} from its contract rate, or the same item
          invoiced more than {pct(a.driftThresholdPct)} apart by one supplier.
        </p>
        {data.variance.length === 0 && <Empty text="No price variance above the thresholds." />}
        {groups.map(
          ([title, list]) =>
            list.length > 0 && (
              <Table key={title} caption={title}>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Supplier and contract</Th>
                    <Th>Evidence</Th>
                    <Th className="text-right">Variance</Th>
                    <Th className="text-right">Impact</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((v, i) => (
                    <tr key={`${v.kind}-${v.contract}-${v.item}-${i}`}>
                      <Td label="Item">
                        {v.item}{' '}
                        <Badge tone={v.blocked ? 'success' : v.kind === 'DRIFT' ? 'info' : 'warning'}>
                          {v.blocked ? 'Stopped' : v.kind === 'DRIFT' ? 'Drift' : 'Over rate'}
                        </Badge>
                      </Td>
                      <Td label="Supplier and contract">
                        {v.supplier} ({v.contract})
                      </Td>
                      <Td label="Evidence">{v.detail}</Td>
                      <Td label="Variance" className="text-right">
                        {pct(v.variancePct)}
                      </Td>
                      <Td label="Impact" className="text-right">
                        {aud.format(v.impact)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ),
        )}
      </section>

      <section aria-labelledby="op-cat" className="flex min-w-0 flex-col gap-3">
        <h2 id="op-cat" className="font-heading text-xl font-bold">
          Where to look first, by category
        </h2>
        {data.categories.length === 0 ? (
          <Empty text="No categories to show." />
        ) : (
          <Table caption="Categories, with the suggested next step">
            <thead>
              <tr>
                <Th>Category</Th>
                <Th className="text-right">Annual spend</Th>
                <Th className="text-right">Suppliers</Th>
                <Th>Suggestion</Th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((c) => {
                const [label, tone] = SIGNAL[c.signal] ?? [c.signal, 'neutral' as Tone];
                return (
                  <tr key={c.category}>
                    <Td label="Category">{c.category}</Td>
                    <Td label="Annual spend" className="text-right">
                      {aud.format(c.annualSpend)}
                    </Td>
                    <Td label="Suppliers" className="text-right">
                      {c.suppliers}
                    </Td>
                    <Td label="Suggestion">
                      <Badge tone={tone}>{label}</Badge> <span className="text-sm">{c.why}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
