'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Counts {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}
interface RunCounts {
  costCentres: Counts;
  orgUnits: Counts;
  budgets: Counts;
  ledger: Counts;
}
interface LastRun {
  at: string;
  status: 'OK' | 'FAILED';
  provider: string;
  revision: number;
  financialYear: string;
  counts: RunCounts | Record<string, never>;
  error: string | null;
}
interface Centre {
  code: string;
  name: string;
  orgUnit: string | null;
  owner: string | null;
  active: boolean;
  budget: number;
  actual: number;
  committed: number;
  available: number;
}
interface Overview {
  financialYear: string;
  lastRun: LastRun | null;
  lastSuccess: LastRun | null;
  costCentres: Centre[];
  budgets: Array<{ id: string; costCentre: string; category: string; amount: number }>;
  ledgerCount: number;
  connector: {
    provider: string;
    providerLabel: string;
    mode: 'UP' | 'DOWN';
    enabled: boolean;
    health: string;
    simulatedRevision: number;
  } | null;
  providers: Array<{ id: string; label: string }>;
  maxRevision: number;
  manualTasks: Array<{ id: string; title: string; instructions: string }>;
}
interface SyncResult {
  ok: boolean;
  dryRun: boolean;
  providerLabel: string;
  revision: number;
  counts: RunCounts | null;
  totals: Counts | null;
  status: 'OK' | 'FAILED';
  reason: string | null;
  error: string | null;
}
interface LedgerRow {
  id: string;
  costCentre: string;
  postingDate: string;
  account: string;
  description: string;
  amount: number;
  kind: string;
}
interface Check {
  status: string;
  available: number | null;
  requested: number;
  source: { kind: string; label: string };
}

const money = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const at = (iso: string) => new Date(iso).toLocaleString('en-AU');
const NAMES: Array<[keyof RunCounts, string]> = [
  ['costCentres', 'Cost centres'],
  ['orgUnits', 'Organisation units'],
  ['budgets', 'Budget lines'],
  ['ledger', 'Ledger postings'],
];

function CountsTable({ counts }: { counts: RunCounts }) {
  return (
    <Table caption="What the import changed">
      <thead>
        <tr>
          <Th>Records</Th>
          <Th className="text-right">Added</Th>
          <Th className="text-right">Changed</Th>
          <Th className="text-right">Removed</Th>
          <Th className="text-right">Unchanged</Th>
        </tr>
      </thead>
      <tbody>
        {NAMES.map(([k, label]) => (
          <tr key={k} data-testid="erp-count-row">
            <Td label="Records">{label}</Td>
            <Td label="Added" className="text-right">
              {counts[k].added}
            </Td>
            <Td label="Changed" className="text-right">
              {counts[k].changed}
            </Td>
            <Td label="Removed" className="text-right">
              {counts[k].removed}
            </Td>
            <Td label="Unchanged" className="text-right">
              {counts[k].unchanged}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Imported budgets, cost centres and ledger from the connected ERP (simulated SAP, Oracle or Dynamics) (NFR-C02). */
export function ErpPanel({ csrf, canRun, canCheck }: { csrf: string; canRun: boolean; canCheck: boolean }) {
  const ov = useData<Overview>('/erp/overview');
  const ledger = useData<LedgerRow[]>('/erp/ledger?limit=40');
  const { busy, run, messages } = useRun();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [rev, setRev] = useState('');
  const [unit, setUnit] = useState('');
  const [amount, setAmount] = useState('1000000');
  const [check, setCheck] = useState<Check | null>(null);
  const o = ov.data;
  if (ov.error && !o)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {ov.error}
      </p>
    );
  if (!o) return <p className="text-sm text-text-muted">Loading ERP data…</p>;
  const doSync = (dryRun: boolean) =>
    run(
      dryRun ? 'dry' : 'sync',
      async () => {
        const r = await send<SyncResult>(csrf, 'POST', '/erp/sync', {
          dryRun,
          ...(rev ? { revision: Number(rev) } : {}),
        });
        setResult(r);
        await Promise.all([ov.reload(), ledger.reload()]);
      },
      undefined,
    );
  const c = o.connector;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">ERP connection</h2>
          <Badge tone="info">SIMULATED</Badge>
          {c && (
            <Badge tone={c.mode === 'DOWN' || !c.enabled ? 'error' : 'success'}>
              <span data-testid="erp-provider">{c.providerLabel}</span>:{' '}
              {c.enabled ? c.health.toLowerCase() : 'switched off'}
            </Badge>
          )}
          <span className="text-sm text-text-muted">Financial year {o.financialYear}</span>
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Cost centres, organisation units, budgets and the ledger are pulled from the ERP chosen on the
          Connectors page (SAP, Oracle or Dynamics: each sends a different shape and a mapper normalises it).
          Running it again changes only what changed at the source. Budget checks use these budgets when a
          unit has one.
        </p>
        {o.lastRun ? (
          <p className="mt-2 text-sm" data-testid="erp-last-run">
            Last run {at(o.lastRun.at)}: <strong>{o.lastRun.status === 'OK' ? 'imported' : 'failed'}</strong>
            {o.lastRun.error ? ` (${o.lastRun.error})` : ''}, {o.lastRun.provider}, source revision{' '}
            {o.lastRun.revision}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-text-muted" data-testid="erp-last-run">
            Nothing has been imported yet.
          </p>
        )}
        {canRun && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field
              label="Source version (demonstration)"
              hint="Version 2 changes a budget and a name, removes one cost centre and adds one."
            >
              <Select value={rev} onChange={(e) => setRev(e.target.value)} aria-label="Source version">
                <option value="">Keep current ({c?.simulatedRevision ?? 1})</option>
                {Array.from({ length: o.maxRevision }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Version {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Button onClick={() => void doSync(false)} loading={busy === 'sync'} disabled={busy !== null}>
              Run sync
            </Button>
            <Button
              variant="secondary"
              onClick={() => void doSync(true)}
              loading={busy === 'dry'}
              disabled={busy !== null}
            >
              Preview only
            </Button>
          </div>
        )}
        {messages}
        {result && (
          <div className="mt-4 flex flex-col gap-2" data-testid="erp-result">
            {result.ok ? (
              <>
                <p role="status" className="text-sm font-medium text-success">
                  {result.dryRun ? 'Preview (nothing written)' : 'Imported'} from {result.providerLabel}:{' '}
                  {result.totals?.added} added, {result.totals?.changed} changed, {result.totals?.removed}{' '}
                  removed, {result.totals?.unchanged} unchanged.
                </p>
                {result.counts && <CountsTable counts={result.counts} />}
              </>
            ) : (
              <p role="alert" className="text-sm font-medium text-error">
                The ERP could not be reached ({result.reason}). The last imported data stays in use and a task
                for doing it by hand was queued below.
              </p>
            )}
          </div>
        )}
        {o.lastSuccess?.counts && 'costCentres' in o.lastSuccess.counts && !result && (
          <div className="mt-4">
            <p className="mb-2 text-sm text-text-muted">Changes in the last successful import</p>
            <CountsTable counts={o.lastSuccess.counts as RunCounts} />
          </div>
        )}
      </Card>

      {o.manualTasks.length > 0 && (
        <Card>
          <h2 className="font-heading text-xl font-bold">Do by hand while the ERP is down</h2>
          {o.manualTasks.map((t) => (
            <div key={t.id} className="mt-2 text-sm" data-testid="erp-manual-task">
              <p className="font-semibold">{t.title}</p>
              <p className="max-w-prose text-text-muted">{t.instructions}</p>
            </div>
          ))}
          <p className="mt-2 text-sm">
            Close it on the{' '}
            <a href="/app/connectors" className="underline">
              Connectors page
            </a>{' '}
            once done.
          </p>
        </Card>
      )}

      <Card>
        <h2 className="font-heading text-xl font-bold">Cost centres and budgets ({o.financialYear})</h2>
        <Table caption="Imported cost centres">
          <thead>
            <tr>
              <Th>Cost centre</Th>
              <Th>Organisation unit</Th>
              <Th>Owner</Th>
              <Th className="text-right">Budget</Th>
              <Th className="text-right">Actual</Th>
              <Th className="text-right">Committed</Th>
              <Th className="text-right">Available</Th>
            </tr>
          </thead>
          <tbody>
            {o.costCentres.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-text-muted">
                  No cost centres yet. Run the sync.
                </td>
              </tr>
            )}
            {o.costCentres.map((k) => (
              <tr key={k.code} data-testid="erp-centre-row">
                <Td label="Cost centre">
                  <span className="font-mono text-xs">{k.code}</span> {k.name}{' '}
                  {!k.active && <Badge tone="warning">Suspended</Badge>}
                </Td>
                <Td label="Organisation unit">{k.orgUnit ?? '–'}</Td>
                <Td label="Owner">{k.owner ?? '–'}</Td>
                <Td label="Budget" className="text-right">
                  {money(k.budget)}
                </Td>
                <Td label="Actual" className="text-right">
                  {money(k.actual)}
                </Td>
                <Td label="Committed" className="text-right">
                  {money(k.committed)}
                </Td>
                <Td label="Available" className="text-right">
                  {money(k.available)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {canCheck && (
        <Card>
          <h2 className="font-heading text-xl font-bold">Try the budget check</h2>
          <p className="mt-1 max-w-prose text-sm text-text-muted">
            Choose an imported cost centre or a unit name. The answer names where the figure came from.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run('check', async () => {
                const isCentre = o.costCentres.some((k) => k.code === unit);
                setCheck(
                  await send<Check>(csrf, 'POST', '/erp/budget-check', {
                    ...(isCentre ? { costCentre: unit } : { businessUnit: unit }),
                    amount: Number(amount),
                  }),
                );
              });
            }}
          >
            <Field label="Cost centre or business unit">
              <Input
                list="erp-centres"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="FAC-100 or Facilities"
              />
            </Field>
            <datalist id="erp-centres">
              {o.costCentres
                .filter((k) => k.active)
                .map((k) => (
                  <option key={k.code} value={k.code}>
                    {k.name}
                  </option>
                ))}
            </datalist>
            <Field label="Amount (AUD)">
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Button type="submit" loading={busy === 'check'} disabled={!unit || !(Number(amount) > 0)}>
              Check
            </Button>
          </form>
          {check && (
            <p className="mt-3 text-sm" data-testid="erp-check-result" role="status">
              <Badge
                tone={
                  check.status === 'CLEARED' ? 'success' : check.status === 'EXCEEDED' ? 'error' : 'warning'
                }
              >
                {check.status}
              </Badge>{' '}
              {check.available !== null ? `${money(check.available)} available. ` : ''}Source:{' '}
              {check.source.label}.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 className="font-heading text-xl font-bold">Ledger ({o.ledgerCount} postings, newest first)</h2>
        <Table caption="Imported ledger postings">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Cost centre</Th>
              <Th>Account</Th>
              <Th>Kind</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {(ledger.data ?? []).map((l) => (
              <tr key={l.id} data-testid="erp-ledger-row">
                <Td label="Date">{l.postingDate}</Td>
                <Td label="Cost centre">{l.costCentre}</Td>
                <Td label="Account">
                  {l.account} {l.description}
                </Td>
                <Td label="Kind">{l.kind === 'ACTUAL' ? 'Actual' : 'Commitment'}</Td>
                <Td label="Amount" className="text-right">
                  {money(l.amount)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
