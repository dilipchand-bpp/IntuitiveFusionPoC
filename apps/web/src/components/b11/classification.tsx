'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface Finding {
  id: string;
  class: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'SENSITIVE_PERSONAL' | 'FINANCIAL';
  detectors: Array<{ id: string; label: string }>;
  maskedSample: string | null;
  location: { type: string; field: string };
  link: string | null;
  warning: string | null;
  status: 'OPEN' | 'CONFIRMED' | 'DISMISSED';
  reviewedBy: string | null;
  reviewReason: string | null;
  scannedAt: string;
}
interface View {
  model: string;
  scope: string;
  summary: {
    total: number;
    open: number;
    confirmed: number;
    dismissed: number;
    warnings: number;
    lastScanAt: string | null;
    byClass: Array<{ class: string; count: number }>;
    byLocation: Array<{ entityType: string; label: string; count: number }>;
  };
  findings: Finding[];
}
interface Scan {
  scanned: number;
  findings: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
}
const CLASS_LABEL: Record<string, string> = {
  PUBLIC: 'Public',
  INTERNAL: 'Internal',
  CONFIDENTIAL: 'Confidential',
  SENSITIVE_PERSONAL: 'Sensitive personal',
  FINANCIAL: 'Financial',
};
const CLASS_TONE = {
  PUBLIC: 'neutral',
  INTERNAL: 'info',
  CONFIDENTIAL: 'warning',
  SENSITIVE_PERSONAL: 'error',
  FINANCIAL: 'error',
} as const;
const STATUS_TONE = { OPEN: 'warning', CONFIRMED: 'error', DISMISSED: 'neutral' } as const;

function Review({ f, csrf, done }: { f: Finding; csrf: string; done: () => Promise<void> }) {
  const { busy, run, messages } = useRun();
  const [reason, setReason] = useState('');
  const go = (decision: 'CONFIRM' | 'DISMISS') =>
    run(decision, async () => {
      await send(csrf, 'POST', `/privacy/classification/${f.id}/review`, { decision, reason });
      setReason('');
      await done();
    });
  return (
    <div className="flex min-w-[14rem] flex-col gap-2">
      <Field label={`Reason for the review of ${f.location.field}`}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          loading={busy === 'CONFIRM'}
          disabled={reason.trim().length < 5 || busy !== null}
          onClick={() => void go('CONFIRM')}
        >
          Confirm
        </Button>
        <Button
          variant="ghost"
          loading={busy === 'DISMISS'}
          disabled={reason.trim().length < 5 || busy !== null}
          onClick={() => void go('DISMISS')}
        >
          Dismiss
        </Button>
      </div>
      {messages}
    </div>
  );
}

/** Sensitive data found in text fields, by class and location, with a review step (SEC-D07). */
export function ClassificationPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const [status, setStatus] = useState('');
  const [cls, setCls] = useState('');
  const [warn, setWarn] = useState(false);
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (cls) q.set('class', cls);
  if (warn) q.set('warningsOnly', 'true');
  const { data, error, reload } = useData<View>(`/privacy/classification${q.size ? `?${q}` : ''}`);
  const scan = useRun();
  const [last, setLast] = useState<Scan | null>(null);
  const canScan = has(roles, 'ADMIN', 'PROBITY');
  const canReview = has(roles, 'ADMIN', 'PROBITY', 'LEGAL');

  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const s = data.summary;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Findings by class</h2>
          <Badge tone="info">Rules, simulated ({data.model})</Badge>
          {canScan && (
            <Button
              loading={scan.busy === 'scan'}
              disabled={scan.busy !== null}
              onClick={() =>
                void scan.run('scan', async () => {
                  setLast(await send<Scan>(csrf, 'POST', '/privacy/classification/run'));
                  await reload();
                })
              }
            >
              Scan now
            </Button>
          )}
        </div>
        {scan.messages}
        {last && (
          <p role="status" className="mt-2 text-sm font-medium text-success" data-testid="scan-result">
            Scanned {last.scanned} text fields: {last.created} new, {last.updated} changed, {last.unchanged}{' '}
            unchanged, {last.removed} cleared.
          </p>
        )}
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          {data.scope} The sensitive value is never kept: only a masked sample, such as the last three
          characters.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {s.byClass.map((c) => (
            <div key={c.class} className="rounded-lg border border-border bg-surface-alt p-3">
              <dt className="text-xs text-text-muted">{CLASS_LABEL[c.class]}</dt>
              <dd className="mt-1 text-xl font-bold" data-testid={`class-${c.class}`}>
                {c.count}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm" data-testid="class-summary">
          {s.total} findings: {s.open} open, {s.confirmed} confirmed, {s.dismissed} dismissed.{' '}
          <strong>{s.warnings} open warnings</strong> where sensitive data sits in an unexpected place.
          {s.lastScanAt
            ? ` Last scan ${new Date(s.lastScanAt).toLocaleString('en-AU')}.`
            : ' Not scanned yet.'}
        </p>
        {s.byLocation.length > 0 && (
          <p className="mt-1 text-sm text-text-muted">
            By location: {s.byLocation.map((l) => `${l.label} ${l.count}`).join(', ')}.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Findings</h2>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div className="w-48">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="DISMISSED">Dismissed</option>
              </Select>
            </Field>
          </div>
          <div className="w-56">
            <Field label="Class">
              <Select value={cls} onChange={(e) => setCls(e.target.value)}>
                <option value="">All</option>
                {Object.entries(CLASS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="inline-flex min-h-[44px] items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={warn}
              onChange={(e) => setWarn(e.target.checked)}
            />
            Warnings only
          </label>
        </div>
        {data.findings.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">Nothing found. Run a scan to check the text fields.</p>
        ) : (
          <div className="mt-3">
            <Table caption="Sensitive data findings">
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th>Where</Th>
                  <Th>Found</Th>
                  <Th>Status</Th>
                  {canReview && <Th>Review</Th>}
                </tr>
              </thead>
              <tbody>
                {data.findings.map((f) => (
                  <tr key={f.id} data-testid="finding">
                    <Td label="Class">
                      <Badge tone={CLASS_TONE[f.class]}>{CLASS_LABEL[f.class]}</Badge>
                    </Td>
                    <Td label="Where">
                      {f.link ? <Link href={f.link}>{f.location.type}</Link> : f.location.type}
                      <span className="block text-xs text-text-muted">{f.location.field}</span>
                      {f.warning && (
                        <span className="mt-1 block text-xs font-semibold text-error" role="note">
                          Warning: {f.warning}
                        </span>
                      )}
                    </Td>
                    <Td label="Found">
                      {f.detectors.map((d) => d.label).join(', ')}
                      {f.maskedSample && (
                        <span className="block text-xs text-text-muted">{f.maskedSample}</span>
                      )}
                    </Td>
                    <Td label="Status">
                      <Badge tone={STATUS_TONE[f.status]}>{f.status.toLowerCase()}</Badge>
                      {f.reviewReason && (
                        <span className="block text-xs text-text-muted">
                          {f.reviewedBy}: {f.reviewReason}
                        </span>
                      )}
                    </Td>
                    {canReview && (
                      <Td label="Review">
                        {f.status === 'OPEN' ? <Review f={f} csrf={csrf} done={reload} /> : 'Reviewed'}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
