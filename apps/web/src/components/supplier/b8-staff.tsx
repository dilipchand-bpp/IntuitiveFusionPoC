'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { Bar, send, useData, useRun } from '@/components/contract/b5-shared';
import { aud } from '@/lib/labels';

const LEVEL_TONE = { LOW: 'success', MEDIUM: 'warning', HIGH: 'error' } as const;
const BAND_TONE: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
  EXCELLENT: 'success',
  GOOD: 'info',
  FAIR: 'warning',
  POOR: 'error',
};

// ------------------------------------------------------------------ duplicates (FR-0795)
interface Dupes {
  checked: number;
  pairs: Array<{
    a: { id: string; company: string; abn: string };
    b: { id: string; company: string; abn: string };
    score: number;
    reasons: string[];
  }>;
}
export function DuplicatesCard({ csrf, canDismiss }: { csrf: string; canDismiss: boolean }) {
  const { data, error, reload } = useData<Dupes>('/suppliers/duplicates');
  const [why, setWhy] = useState<Record<string, string>>({});
  const r = useRun();
  if (error || !data) return null;
  if (data.pairs.length === 0)
    return (
      <p className="text-sm text-text-muted" data-testid="no-duplicates">
        No suppliers look like duplicates ({data.checked} checked).
      </p>
    );
  return (
    <Card role="region" aria-labelledby="dup-h" data-testid="duplicates">
      <h2 id="dup-h" className="font-heading text-xl font-bold">
        Possible duplicate suppliers ({data.pairs.length})
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        These look like the same business under two names. Check, then merge by hand or say they are
        different.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {data.pairs.map((p) => {
          const k = `${p.a.id}|${p.b.id}`;
          return (
            <li key={k} className="rounded-md border border-border p-3 text-sm">
              <p>
                <Link href={`/app/suppliers/${p.a.id}`}>{p.a.company}</Link>{' '}
                <span className="font-mono text-xs">({p.a.abn})</span> and{' '}
                <Link href={`/app/suppliers/${p.b.id}`}>{p.b.company}</Link>{' '}
                <span className="font-mono text-xs">({p.b.abn})</span>
              </p>
              <p className="mt-1">
                <Badge tone={p.score >= 0.95 ? 'error' : 'warning'}>{Math.round(p.score * 100)}% alike</Badge>{' '}
                {p.reasons.join('; ')}
              </p>
              {canDismiss && (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  aria-label={`Say ${p.a.company} and ${p.b.company} are different`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void r.run('d', async () => {
                      await send(csrf, 'POST', '/suppliers/duplicates/dismiss', {
                        supplierA: p.a.id,
                        supplierB: p.b.id,
                        reason: why[k] ?? '',
                      });
                      await reload();
                    });
                  }}
                >
                  <Field label="Why they are different">
                    <Input
                      value={why[k] ?? ''}
                      onChange={(e) => setWhy({ ...why, [k]: e.target.value })}
                      className="w-72"
                      maxLength={500}
                    />
                  </Field>
                  <Button type="submit" variant="secondary" disabled={(why[k] ?? '').trim().length < 5}>
                    Not duplicates
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ ratings (FR-0790)
interface Ratings {
  ofSupplier: {
    count: number;
    average: number | null;
    band: string | null;
    dimensions: Array<{ key: string; average: number | null }>;
  };
  ofEnterprise: { count: number; average: number | null; band: string | null } | null;
  theirRatingsVisible: boolean;
  entries: Array<{
    id: string;
    direction: string;
    overall: number;
    comment: string | null;
    by: string;
    at: string;
  }>;
  dimensions: Record<string, string[]>;
}
export function RatingsCard({
  supplierId,
  csrf,
  canRate,
  contracts,
}: {
  supplierId: string;
  csrf: string;
  canRate: boolean;
  contracts: Array<{ id: string; number: string }>;
}) {
  const { data, reload } = useData<Ratings>(`/suppliers/${supplierId}/ratings`);
  const [pick, setPick] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const r = useRun();
  if (!data) return null;
  const dims = data.dimensions.ENTERPRISE_RATES_SUPPLIER ?? [];
  return (
    <Card role="region" aria-labelledby="rat-h" data-testid="ratings">
      <h2 id="rat-h" className="font-heading text-xl font-bold">
        Ratings
      </h2>
      <p className="mt-2 text-sm">
        Our rating of them:{' '}
        {data.ofSupplier.average === null ? (
          'none yet'
        ) : (
          <>
            <strong>{data.ofSupplier.average}</strong> out of 5{' '}
            <Badge tone={BAND_TONE[data.ofSupplier.band ?? 'FAIR'] ?? 'neutral'}>
              {data.ofSupplier.band?.toLowerCase()}
            </Badge>{' '}
            from {data.ofSupplier.count}
          </>
        )}
      </p>
      <p className="mt-1 text-sm">
        Their rating of us:{' '}
        {data.ofEnterprise === null
          ? 'not shown (organisation setting)'
          : data.ofEnterprise.average === null
            ? 'none yet'
            : `${data.ofEnterprise.average} out of 5 from ${data.ofEnterprise.count}`}
      </p>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {data.entries.map((e) => (
          <li key={e.id}>
            <Badge tone="neutral">{e.direction === 'ENTERPRISE_RATES_SUPPLIER' ? 'ours' : 'theirs'}</Badge>{' '}
            {e.overall} by {e.by}
            {e.comment ? `: ${e.comment}` : ''}
          </li>
        ))}
      </ul>
      {canRate && contracts.length > 0 && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
          aria-label="Rate this supplier"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'rate',
              async () => {
                await send(csrf, 'POST', `/suppliers/${supplierId}/ratings`, {
                  contractId: pick,
                  scores,
                  ...(comment ? { comment } : {}),
                });
                setPick('');
                setScores({});
                setComment('');
                await reload();
              },
              'Rating recorded.',
            );
          }}
        >
          <Field label="Signed contract">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            {dims.map((d) => (
              <Field key={d} label={`${d[0]!.toUpperCase()}${d.slice(1)} (1 to 5)`}>
                <Select
                  value={scores[d] ? String(scores[d]) : ''}
                  onChange={(e) => setScores({ ...scores, [d]: Number(e.target.value) })}
                >
                  <option value="">Choose…</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <Field label="Comment (optional)">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
          </Field>
          <div>
            <Button
              type="submit"
              loading={r.busy === 'rate'}
              disabled={!pick || dims.some((d) => !scores[d])}
            >
              Record rating
            </Button>
          </div>
          {r.messages}
        </form>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ risk, resilience and ESG (FR-0800)
interface Risk {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  factors: Array<{ key: string; label: string; score: number; weight: number; note: string }>;
  recommendations: string[];
  alternatives: Array<{
    supplierId: string;
    company: string;
    score: number;
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    sharedCategories: string[];
  }>;
  note: string;
}
export function RiskCard({
  supplierId,
  csrf,
  canCheck,
}: {
  supplierId: string;
  csrf: string;
  canCheck: boolean;
}) {
  const { data, error, reload } = useData<Risk>(`/suppliers/${supplierId}/risk`);
  const r = useRun();
  if (error || !data) return null;
  return (
    <Card role="region" aria-labelledby="risk-h" data-testid="risk-card" className="lg:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="risk-h" className="font-heading text-xl font-bold">
          Risk, resilience and ESG
        </h2>
        <Badge tone={LEVEL_TONE[data.level]}>
          {data.score} out of 100 · {data.level.toLowerCase()} risk
        </Badge>
        {canCheck && (
          <Button
            className="ml-auto"
            variant="secondary"
            loading={r.busy === 'ms'}
            onClick={() =>
              void r.run(
                'ms',
                async () => {
                  await send(csrf, 'POST', `/suppliers/${supplierId}/modern-slavery-check`);
                  await reload();
                },
                'Modern slavery check recorded.',
              )
            }
          >
            Run the modern slavery check
          </Button>
        )}
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2" aria-label="Factors">
        {data.factors.map((f) => (
          <li key={f.key}>
            <Bar
              label={`${f.label} (${Math.round(f.weight * 100)}% of the score): ${f.score}`}
              pct={f.score}
            />
            <p className="text-xs text-text-muted">{f.note}</p>
          </li>
        ))}
      </ul>
      {data.recommendations.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">What to do</h3>
          <ul className="mt-1 list-disc pl-5 text-sm" data-testid="recommendations">
            {data.recommendations.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {data.alternatives.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">Alternative suppliers in the same category</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm" data-testid="alternatives">
            {data.alternatives.map((a) => (
              <li key={a.supplierId}>
                <Link href={`/app/suppliers/${a.supplierId}`}>{a.company}</Link>{' '}
                <Badge tone={LEVEL_TONE[a.level]}>{a.score}</Badge> · {a.sharedCategories.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-text-muted">{data.note}</p>
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ reports
interface Scores {
  items: Array<{
    supplierId: string;
    company: string;
    score: number;
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    committed: number;
    topRecommendation: string | null;
  }>;
}
/** `canOpen`: only people who may open a supplier's page are given a link to it. */
export function SupplierScores({ canOpen }: { canOpen: boolean }) {
  const { data } = useData<Scores>('/reports/supplier-scores');
  if (!data) return null;
  return (
    <Card role="region" aria-labelledby="sc-h" data-testid="supplier-scores">
      <h2 id="sc-h" className="font-heading text-xl font-bold">
        Supplier scores, lowest first
      </h2>
      <Table caption="Supplier risk, resilience and ESG scores" className="mt-2">
        <thead>
          <tr>
            <Th>Supplier</Th>
            <Th>Score</Th>
            <Th className="text-right">Committed</Th>
            <Th>First thing to do</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.supplierId}>
              <Td label="Supplier">
                {canOpen ? <Link href={`/app/suppliers/${i.supplierId}`}>{i.company}</Link> : i.company}
              </Td>
              <Td label="Score">
                <Badge tone={LEVEL_TONE[i.level]}>
                  {i.score} · {i.level.toLowerCase()}
                </Badge>
              </Td>
              <Td label="Committed" className="text-right">
                {aud.format(i.committed)}
              </Td>
              <Td label="First thing to do">{i.topRecommendation ?? 'Nothing needed'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

interface Diversity {
  totalCommitted: number;
  groups: Array<{ group: string; suppliers: number; committed: number; sharePct: number }>;
  carbon: { reportedBy: number; of: number; tonnesCo2e: number };
}
const GROUP: Record<string, string> = {
  INDIGENOUS: 'Indigenous-owned',
  WOMEN: 'Women-owned',
  DISABILITY: 'Owned by people with disability',
  SOCIAL_ENTERPRISE: 'Social enterprise',
  NOT_REPORTED_OR_NONE: 'Not reported, or none of these',
};
export function DiversityCard() {
  const { data } = useData<Diversity>('/reports/diversity');
  if (!data) return null;
  return (
    <Card role="region" aria-labelledby="div-h" data-testid="diversity">
      <h2 id="div-h" className="font-heading text-xl font-bold">
        Diverse suppliers and carbon
      </h2>
      <Table caption="Committed spend by supplier ownership" className="mt-2">
        <thead>
          <tr>
            <Th>Ownership</Th>
            <Th className="text-right">Suppliers</Th>
            <Th className="text-right">Committed</Th>
            <Th className="text-right">Share</Th>
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => (
            <tr key={g.group}>
              <Td label="Ownership">{GROUP[g.group] ?? g.group}</Td>
              <Td label="Suppliers" className="text-right">
                {g.suppliers}
              </Td>
              <Td label="Committed" className="text-right">
                {aud.format(g.committed)}
              </Td>
              <Td label="Share" className="text-right">
                {g.sharePct}%
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-2 text-sm">
        Carbon data reported by {data.carbon.reportedBy} of {data.carbon.of} suppliers:{' '}
        {data.carbon.tonnesCo2e.toLocaleString('en-AU')} tonnes of CO2e a year.
      </p>
    </Card>
  );
}
