'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import { api } from '@/lib/api-client';

interface RateRow {
  currency: string;
  rate: number | null;
  asOf: string | null;
  source: 'ANNUAL' | 'LIVE' | 'MANUAL' | null;
}
interface HistoryRow {
  currency: string;
  rate: number;
  asOf: string;
  source: 'ANNUAL' | 'LIVE' | 'MANUAL';
}
interface Rates {
  model: string;
  base: string;
  mode: 'ANNUAL' | 'LIVE';
  financialYear: number;
  supported: string[];
  current: RateRow[];
  history: HistoryRow[];
}
interface Converted {
  amount: number;
  from: string;
  to: string;
  date: string;
  result: number;
  via: string;
  mode: string;
}

const SOURCE = { ANNUAL: 'Annual rate', LIVE: 'Live feed', MANUAL: 'Entered by hand' } as const;
const fyLabel = (fy: number) => `FY${String(fy).slice(-2)} (1 July ${fy - 1} to 30 June ${fy})`;

/** Currencies (FR-0810): the rates in force, the annual rate table, a live refresh and a converter. */
export function CurrencyAdmin({ csrf, canEdit }: { csrf: string; canEdit: boolean }) {
  const { data, error, reload } = useData<Rates>('/fx/rates');
  const { busy, run, messages } = useRun();
  const [edit, setEdit] = useState<{ currency: string; rate: string }>({ currency: '', rate: '' });
  const [conv, setConv] = useState({ amount: '1000', from: 'USD', to: 'AUD' });
  const [out, setOut] = useState<Converted | null>(null);

  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading rates…</p>;

  const foreign = data.current.map((c) => c.currency);
  const fyRows = data.history.filter(
    (h) =>
      h.source !== 'LIVE' &&
      h.asOf >= `${data.financialYear - 1}-07-01` &&
      h.asOf <= `${data.financialYear}-06-30`,
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">How rates are set</h2>
          <Badge tone={data.mode === 'ANNUAL' ? 'info' : 'success'}>
            {data.mode === 'ANNUAL' ? 'Annual rates' : 'Live rates'}
          </Badge>
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          {data.mode === 'ANNUAL'
            ? `One rate for each currency is used for the whole financial year, ${fyLabel(data.financialYear)}. Finance sets them below.`
            : 'The latest rate from the rates feed is used. It is read the first time it is needed each day.'}{' '}
          Totals, budgets and approval limits are all in {data.base}. The amount a person typed and its
          currency are kept beside the {data.base} figure.
        </p>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          International delegations apply only to foreign-currency spend: a request valued in a currency other
          than {data.base} is approved against international limits, and a request in {data.base} never is.
        </p>
        <p className="mt-2 text-xs text-text-muted">The rate source here is simulated ({data.model}).</p>
      </Card>

      <section aria-labelledby="fx-now-h" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="fx-now-h" className="font-heading text-xl font-bold">
            Rates in force today
          </h2>
          {canEdit && data.mode === 'LIVE' && (
            <Button
              variant="secondary"
              className="ml-auto"
              loading={busy === 'refresh'}
              onClick={() =>
                void run(
                  'refresh',
                  async () => {
                    await send(csrf, 'POST', '/fx/refresh');
                    await reload();
                  },
                  'Live rates refreshed.',
                )
              }
            >
              Refresh live rates
            </Button>
          )}
        </div>
        <Table caption={`Rates in force, ${data.base} for one unit of each currency`}>
          <thead>
            <tr>
              <Th>Currency</Th>
              <Th className="text-right">Rate ({data.base} per unit)</Th>
              <Th>As of</Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody>
            {data.current.map((c) => (
              <tr key={c.currency} data-testid="fx-current-row">
                <Td label="Currency">{c.currency}</Td>
                <Td label="Rate" className="text-right">
                  {c.rate === null ? (
                    <Badge tone="warning">No rate set</Badge>
                  ) : (
                    c.rate.toLocaleString('en-AU', { maximumFractionDigits: 6 })
                  )}
                </Td>
                <Td label="As of">{c.asOf ?? '–'}</Td>
                <Td label="Source">{c.source ? SOURCE[c.source] : '–'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!canEdit && (
          <p className="text-sm text-text-muted">Only finance or an administrator can change the rates.</p>
        )}
      </section>

      {data.mode === 'ANNUAL' && (
        <section aria-labelledby="fx-fy-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="fx-fy-h" className="font-heading text-xl font-bold">
            Annual rates, {fyLabel(data.financialYear)}
          </h2>
          {fyRows.length === 0 ? (
            <p className="text-sm text-text-muted">No annual rates have been set for this financial year.</p>
          ) : (
            <Table caption="Annual rates for the current financial year">
              <thead>
                <tr>
                  <Th>Currency</Th>
                  <Th className="text-right">Rate ({data.base} per unit)</Th>
                  <Th>Dated</Th>
                </tr>
              </thead>
              <tbody>
                {fyRows.map((h) => (
                  <tr key={`${h.currency}-${h.asOf}`}>
                    <Td label="Currency">{h.currency}</Td>
                    <Td label="Rate" className="text-right">
                      {h.rate.toLocaleString('en-AU', { maximumFractionDigits: 6 })}
                    </Td>
                    <Td label="Dated">{h.asOf}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {canEdit && (
            <form
              aria-label="Set an annual rate"
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  'set',
                  async () => {
                    await send(csrf, 'PUT', '/fx/rates', {
                      currency: edit.currency,
                      rate: Number(edit.rate),
                    });
                    setEdit({ currency: '', rate: '' });
                    await reload();
                  },
                  'Rate saved and recorded in the audit trail.',
                );
              }}
            >
              <Field label="Currency">
                <Select
                  value={edit.currency}
                  onChange={(e) => setEdit({ ...edit, currency: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {foreign.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Rate (${data.base} per unit)`}>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={edit.rate}
                  onChange={(e) => setEdit({ ...edit, rate: e.target.value })}
                  className="w-40"
                />
              </Field>
              <Button
                type="submit"
                loading={busy === 'set'}
                disabled={!edit.currency || !(Number(edit.rate) > 0)}
              >
                Save rate
              </Button>
            </form>
          )}
        </section>
      )}

      <section aria-labelledby="fx-conv-h" className="flex min-w-0 flex-col gap-3">
        <h2 id="fx-conv-h" className="font-heading text-xl font-bold">
          Convert an amount
        </h2>
        <form
          aria-label="Convert an amount"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run('convert', async () => {
              const q = new URLSearchParams({ amount: conv.amount, from: conv.from, to: conv.to });
              setOut(await api<Converted>(`/fx/convert?${q.toString()}`));
            });
          }}
        >
          <Field label="Amount">
            <Input
              type="number"
              min={0}
              step="any"
              value={conv.amount}
              onChange={(e) => setConv({ ...conv, amount: e.target.value })}
              className="w-40"
            />
          </Field>
          <Field label="From">
            <Select value={conv.from} onChange={(e) => setConv({ ...conv, from: e.target.value })}>
              {data.supported.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="To">
            <Select value={conv.to} onChange={(e) => setConv({ ...conv, to: e.target.value })}>
              {data.supported.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Button
            type="submit"
            variant="secondary"
            loading={busy === 'convert'}
            disabled={conv.amount === ''}
          >
            Convert
          </Button>
        </form>
        {out && (
          <p role="status" className="text-sm font-medium" data-testid="fx-result">
            {out.amount.toLocaleString('en-AU')} {out.from} = {out.result.toLocaleString('en-AU')} {out.to} on{' '}
            {out.date} ({out.mode === 'ANNUAL' ? 'annual rates' : 'live rates'}; {out.via}).
          </p>
        )}
      </section>
      {messages}
    </div>
  );
}
