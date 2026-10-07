'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Textarea, type BadgeTone } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

type Status = 'PASS' | 'AT_RISK' | 'BREACH' | 'NO_DATA';
interface Metric {
  key: string;
  label: string;
  kind: 'FLOOR' | 'CEILING';
  unit: 'PCT' | 'T_PER_M' | 'RATING';
  limit: number;
  orgLimit: number;
  source: 'DEFAULT' | 'PLAN' | 'OVERRIDE';
  overrideReason: string | null;
  approverNote: string | null;
  forecast: number | null;
  actual: number | null;
  value: number | null;
  valueSource: 'ACTUAL' | 'FORECAST' | 'NONE';
  status: Status;
  summary: string;
  arithmetic: string;
  exception: {
    state: 'NONE' | 'RECORDED' | 'ACKNOWLEDGED';
    reason: string | null;
    acknowledgedAt: string | null;
  };
}
interface Targets {
  contractValue: number | null;
  valueBasis: 'AWARDED' | 'ESTIMATE' | 'NONE';
  atRiskBandPct: number;
  maxRelaxationPct: number;
  metrics: Metric[];
  gate: { status: 'REQUIRED' | 'SATISFIED' | null; breaches: number };
  bids: Array<{ supplierId: string; company: string; tco: number }>;
  bidSuggestion: Record<string, unknown> | null;
  locked: boolean;
  canEdit: boolean;
  canRecordException: boolean;
  canAcknowledge: boolean;
}

const TONE: Record<Status, BadgeTone> = {
  PASS: 'success',
  AT_RISK: 'warning',
  BREACH: 'error',
  NO_DATA: 'neutral',
};
const LABEL: Record<Status, string> = {
  PASS: 'Pass',
  AT_RISK: 'At risk',
  BREACH: 'Breach',
  NO_DATA: 'No figure',
};
const unit = (m: Metric) => (m.unit === 'PCT' ? '%' : m.unit === 'T_PER_M' ? ' t per $m' : '');
const aud = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

function MetricRow({
  m,
  planId,
  csrf,
  t,
  onDone,
}: {
  m: Metric;
  planId: string;
  csrf: string;
  t: Targets;
  onDone: () => Promise<void>;
}) {
  const { busy, run, messages } = useRun();
  const [forecast, setForecast] = useState(m.forecast?.toString() ?? '');
  const [target, setTarget] = useState(m.limit.toString());
  const [reason, setReason] = useState(m.overrideReason ?? '');
  const [note, setNote] = useState(m.approverNote ?? '');
  const [exc, setExc] = useState('');
  const relaxes =
    Number(target) !== m.orgLimit &&
    (m.kind === 'FLOOR' ? Number(target) < m.orgLimit : Number(target) > m.orgLimit);
  const path = `/plans/${planId}/esg-targets/${m.key}`;
  return (
    <li className="rounded-md border border-border p-3" data-testid={`esg-${m.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{m.label}</p>
        <Badge tone={TONE[m.status]}>
          <span data-testid={`esg-status-${m.key}`}>{LABEL[m.status]}</span>
        </Badge>
        <span className="text-xs text-text-muted">
          {m.kind === 'FLOOR' ? 'Target at least' : 'Ceiling at most'} {m.limit}
          {unit(m)}
          {m.source === 'DEFAULT'
            ? ' (organisation default)'
            : m.source === 'PLAN'
              ? ' (set for this plan)'
              : ' (relaxed for this plan)'}
        </span>
      </div>
      <p className="mt-1 text-sm" data-testid={`esg-summary-${m.key}`}>
        {m.summary}
      </p>
      <p className="text-xs text-text-muted">
        {m.arithmetic}
        {m.valueSource === 'ACTUAL' ? ' (from awarded contracts and declared supplier data)' : ''}
      </p>
      {m.source === 'OVERRIDE' && (
        <p className="text-xs text-text-muted">
          Reason: {m.overrideReason}. Approver note: {m.approverNote}.
        </p>
      )}
      {m.exception.state !== 'NONE' && (
        <p className="mt-1 text-sm" data-testid={`esg-exception-${m.key}`}>
          <Badge tone={m.exception.state === 'ACKNOWLEDGED' ? 'success' : 'warning'}>
            {m.exception.state === 'ACKNOWLEDGED'
              ? 'Exception acknowledged'
              : 'Exception waiting for a delegate'}
          </Badge>{' '}
          <span className="text-text-muted">{m.exception.reason}</span>
        </p>
      )}
      {t.canAcknowledge && m.exception.state === 'RECORDED' && (
        <div className="mt-2">
          <Button
            variant="secondary"
            loading={busy === 'ack'}
            onClick={() =>
              void run('ack', async () => {
                await send(csrf, 'POST', `${path}/acknowledge`, {});
                await onDone();
              })
            }
          >
            Acknowledge this exception
          </Button>
        </div>
      )}
      {t.canRecordException && m.status === 'BREACH' && m.exception.state === 'NONE' && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run('exc', async () => {
              await send(csrf, 'POST', `${path}/exception`, { reason: exc });
              setExc('');
              await onDone();
            });
          }}
        >
          <Field
            label={`Why ${m.label.toLowerCase()} may go ahead in breach`}
            hint="At least 10 characters. A delegate must acknowledge it."
          >
            <Textarea rows={2} value={exc} onChange={(e) => setExc(e.target.value)} />
          </Field>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={busy === 'exc'}
              disabled={busy !== null || exc.trim().length < 10}
            >
              Record exception
            </Button>
          </div>
        </form>
      )}
      {t.canEdit && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold">Change the figure or the limit</summary>
          <form
            className="mt-2 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'save',
                async () => {
                  await send(csrf, 'PUT', path, {
                    ...(forecast.trim() === '' ? { forecast: null } : { forecast: Number(forecast) }),
                    ...(Number(target) !== m.limit
                      ? {
                          target: Number(target),
                          ...(relaxes ? { overrideReason: reason, approverNote: note } : {}),
                        }
                      : {}),
                  });
                  await onDone();
                },
                'Saved.',
              );
            }}
          >
            <Field
              label={`Forecast${unit(m) ? ` (${unit(m).trim()})` : ''}`}
              hint="Used until an awarded contract gives an actual figure."
            >
              <Input
                type="number"
                min={0}
                step="any"
                value={forecast}
                onChange={(e) => setForecast(e.target.value)}
              />
            </Field>
            <Field
              label={m.kind === 'FLOOR' ? 'Target for this plan' : 'Ceiling for this plan'}
              hint={`Organisation default ${m.orgLimit}. Looser by up to ${t.maxRelaxationPct}% with a reason.`}
            >
              <Input
                type="number"
                min={0}
                step="any"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </Field>
            {relaxes && (
              <>
                <Field label="Reason for the looser limit" hint="At least 10 characters.">
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Field label="Approver note" hint="Who approved it, at least 10 characters.">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </>
            )}
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
              <Button type="submit" loading={busy === 'save'} disabled={busy !== null}>
                Save
              </Button>
              {m.source !== 'DEFAULT' && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('reset', async () => {
                      await send(csrf, 'PUT', path, { resetTarget: true });
                      setTarget(m.orgLimit.toString());
                      await onDone();
                    })
                  }
                >
                  Use the organisation limit
                </Button>
              )}
            </div>
          </form>
        </details>
      )}
      {messages}
    </li>
  );
}

/** ESG and socio-economic targets and ceilings with the ratios checked; a breach holds the plan until an exception is acknowledged (NFR-R05). */
export function EsgTargetsCard({ planId, csrf }: { planId: string; csrf: string }) {
  const router = useRouter();
  const d = useData<Targets>(`/plans/${planId}/esg-targets`);
  const { busy, run, messages } = useRun();
  const t = d.data;
  if (d.error && !t) return null;
  if (!t) return null;
  const done = async () => {
    await d.reload();
    router.refresh();
  };
  return (
    <Card role="region" aria-labelledby="esgt-h" data-testid="esg-targets-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="esgt-h" className="font-heading text-xl font-bold">
          ESG and socio-economic limits
        </h2>
        {t.gate.status === 'REQUIRED' && (
          <Badge tone="error">
            <span data-testid="esg-gate">Holds the plan: {t.gate.breaches} in breach</span>
          </Badge>
        )}
        {t.gate.status === 'SATISFIED' && (
          <Badge tone="success">
            <span data-testid="esg-gate">Breaches accepted by exception</span>
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-text-muted">
        Shares are of{' '}
        {t.valueBasis === 'AWARDED' ? 'the awarded contract value' : 'the estimated contract value'}
        {t.contractValue !== null ? ` (${aud(t.contractValue)})` : ''}. A result within {t.atRiskBandPct}% of
        its limit is at risk. A breach stops the plan being approved until procurement records an exception
        and a delegate acknowledges it.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {t.metrics.map((m) => (
          <MetricRow key={m.key} m={m} planId={planId} csrf={csrf} t={t} onDone={done} />
        ))}
      </ul>
      {t.bids.length > 0 && (
        <div className="mt-4 border-t border-border pt-3 text-sm" data-testid="esg-bids">
          <p className="font-semibold">Bids received</p>
          <p className="text-text-muted">
            {t.bids.map((b) => `${b.company} (${aud(b.tco)})`).join(', ')}. What each declared about
            ownership, emissions and modern slavery is used once a contract is awarded.
          </p>
          {t.bidSuggestion && t.canEdit && (
            <div className="mt-2">
              <Button
                variant="secondary"
                loading={busy === 'bids'}
                onClick={() =>
                  void run(
                    'bids',
                    async () => {
                      await send(csrf, 'POST', `/plans/${planId}/esg-targets/apply-bids`);
                      await done();
                    },
                    'Forecasts filled from the lowest-priced bid. They are indicative until a contract is awarded.',
                  )
                }
              >
                Use the lowest-priced bid as the starting forecast
              </Button>
            </div>
          )}
        </div>
      )}
      {messages}
    </Card>
  );
}
