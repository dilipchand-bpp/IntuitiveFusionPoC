'use client';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, Field, Input, KpiCard, Table, Td, Th } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

interface Issue {
  category: string;
  field?: string;
  message: string;
}
export interface MigrationRecord {
  id: string;
  rowNo: number;
  status: 'VALID' | 'EXCEPTION' | 'SKIPPED' | 'LOADED';
  contractNumber: string;
  title: string;
  supplier: string;
  raw: Record<string, string>;
  issues: Issue[];
  warnings: string[];
  extraction?: {
    noticeDays: number | null;
    obligations: number;
    kpis: number;
    slas: number;
    extensions: number[];
  };
  reviewNote?: string;
}
export interface MigrationBatch {
  id: string;
  filename: string;
  sourceSystem: string;
  status: 'VALIDATED' | 'CUTOVER' | 'CANCELLED';
  total: number;
  valid: number;
  exceptions: number;
  skipped: number;
  loaded: number;
  canCutover: boolean;
  createdAt: string;
  records?: MigrationRecord[];
  reconciliation?: { total: number; loaded: number; skipped: number; reconciles: boolean };
}

const TONE = { VALID: 'success', EXCEPTION: 'error', SKIPPED: 'neutral', LOADED: 'info' } as const;
const LABEL = { VALID: 'Ready', EXCEPTION: 'Needs review', SKIPPED: 'Set aside', LOADED: 'Loaded' } as const;
const FIELDS = ['contract_number', 'title', 'supplier', 'start_date', 'end_date', 'value'] as const;
const SAMPLE =
  'contract_number,title,supplier,start_date,end_date,value,procurement_ref,procurement_title,owner,notice_months,supplier_abn,text\nLEG-001,Legacy cleaning,Old Cleaners Pty Ltd,01/07/2022,31/12/2027,"$240,000",OLD-PR-77,Cleaning market approach,Sofia Rossi,,,"Either party may terminate on six months written notice. The Supplier shall deliver monthly reports."';
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** Upload a legacy extract, review what profiling found, correct or set aside each exception, then cut over. */
export function MigrationPanel({
  initial,
  csrf,
  canCutover,
}: {
  initial: MigrationBatch[];
  csrf: string;
  canCutover: boolean;
}) {
  const [batches, setBatches] = useState(initial);
  const [open, setOpen] = useState<MigrationBatch | null>(null);
  const [source, setSource] = useState('');
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('legacy.csv');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fix, setFix] = useState<MigrationRecord | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<MigrationRecord | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);

  const reload = async (id: string) => {
    const b = await api<MigrationBatch>(`/migration/batches/${id}`);
    setOpen(b);
    setBatches(await api<MigrationBatch[]>('/migration/batches'));
    return b;
  };
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
          data-testid="migration-note"
        >
          {note}
        </p>
      )}
      {error && !fix && !skip && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}

      <Card role="region" aria-labelledby="up-h">
        <h2 id="up-h" className="font-heading text-xl font-bold">
          Upload an extract
        </h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          A CSV of legacy contracts. Required columns: contract_number, title, supplier, start_date, end_date,
          value. Optional: procurement_ref (links the contract to its originating procurement), owner,
          notice_months, supplier_abn and text (the contract wording, from which obligations, KPIs, service
          levels, the notice period and extension options are read).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Source system" hint="Where the records came from, for example OldERP">
            <Input value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <Field label="CSV file">
            <input
              type="file"
              accept=".csv,text/csv"
              className="min-h-[44px] w-full text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFilename(f.name);
                  setCsv(await f.text());
                }
              }}
            />
          </Field>
        </div>
        <Field label="Or paste the CSV">
          <textarea
            className="min-h-32 w-full rounded-sm border border-border-strong bg-surface p-2 font-mono text-xs"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setCsv(SAMPLE)}>
            Use a sample
          </Button>
          <Button
            loading={busy}
            disabled={!source.trim() || csv.trim().length < 10}
            onClick={() =>
              void run(async () => {
                const b = await api<MigrationBatch>('/migration/uploads', {
                  method: 'POST',
                  csrf,
                  body: { filename, sourceSystem: source.trim(), csv },
                });
                setOpen(b);
                setBatches(await api<MigrationBatch[]>('/migration/batches'));
                setNote(`Checked ${b.total} record(s): ${b.valid} ready, ${b.exceptions} need review.`);
              })
            }
          >
            Upload and check
          </Button>
        </div>
      </Card>

      {batches.length > 0 && (
        <section aria-labelledby="batches-h" className="flex flex-col gap-2">
          <h2 id="batches-h" className="font-heading text-xl font-bold">
            Batches
          </h2>
          <Table caption="Migration batches">
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Source</Th>
                <Th>Records</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} data-testid="batch-row">
                  <Td label="File">{b.filename}</Td>
                  <Td label="Source">{b.sourceSystem}</Td>
                  <Td label="Records">
                    {b.total} ({b.valid} ready, {b.exceptions} to review, {b.skipped} set aside, {b.loaded}{' '}
                    loaded)
                  </Td>
                  <Td label="Status">
                    <Badge tone={b.status === 'CUTOVER' ? 'success' : 'info'}>
                      {b.status === 'CUTOVER' ? 'Loaded' : 'Being reviewed'}
                    </Badge>
                  </Td>
                  <Td label="Open">
                    <Button
                      variant="secondary"
                      aria-label={`Open ${b.filename}`}
                      onClick={() => void run(async () => void (await reload(b.id)))}
                    >
                      Open
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      {open && (
        <section
          aria-labelledby="batch-h"
          className="flex min-w-0 flex-col gap-4"
          data-testid="batch-detail"
          data-status={open.status}
        >
          <h2 id="batch-h" className="font-heading text-xl font-bold">
            {open.filename}{' '}
            <span className="text-base font-normal text-text-muted">from {open.sourceSystem}</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label="Records" value={open.total} />
            <KpiCard label="Ready" value={open.valid} />
            <KpiCard label="Need review" value={open.exceptions} />
            <KpiCard label="Set aside" value={open.skipped} />
            <KpiCard label="Loaded" value={open.loaded} />
          </div>
          {open.reconciliation && (
            <p role="status" className="text-sm font-medium text-success" data-testid="reconciliation">
              Reconciled: {open.reconciliation.loaded} loaded + {open.reconciliation.skipped} set aside ={' '}
              {open.reconciliation.total} in the extract.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <a
                href={`/api/v1/migration/batches/${open.id}/exceptions.csv`}
                className="text-text no-underline"
              >
                Download the exceptions report
              </a>
            </Button>
            {canCutover && open.status === 'VALIDATED' && (
              <Button disabled={!open.canCutover} onClick={() => setConfirm(true)}>
                Cut over
              </Button>
            )}
          </div>
          {open.status === 'VALIDATED' && !open.canCutover && open.exceptions > 0 && (
            <p className="text-sm text-text-muted" data-testid="cutover-blocked">
              Cutover is blocked until every exception is corrected or set aside with a reason.
            </p>
          )}
          <Table caption="Records in this batch">
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Contract</Th>
                <Th>Supplier</Th>
                <Th>Status</Th>
                <Th>Problems</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {open.records?.map((r) => (
                <tr key={r.id} data-testid="record-row" data-status={r.status}>
                  <Td label="Row">{r.rowNo}</Td>
                  <Td label="Contract">
                    <span className="font-mono text-xs">{r.contractNumber}</span> {r.title}
                  </Td>
                  <Td label="Supplier">{r.supplier || '–'}</Td>
                  <Td label="Status">
                    <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  </Td>
                  <Td label="Problems" className="text-xs">
                    {r.issues.length === 0 && r.warnings.length === 0 && !r.reviewNote && '–'}
                    {r.issues.map((i, k) => (
                      <span key={k} className="block text-error">
                        {i.category}: {i.message}
                      </span>
                    ))}
                    {r.warnings.map((w, k) => (
                      <span key={k} className="block text-text-muted">
                        {w}
                      </span>
                    ))}
                    {r.extraction && (r.extraction.noticeDays || r.extraction.obligations > 0) && (
                      <span className="block text-text-muted">
                        From the text:{' '}
                        {r.extraction.noticeDays ? `${r.extraction.noticeDays}-day notice, ` : ''}
                        {r.extraction.obligations} obligation(s), {r.extraction.kpis} KPI(s),{' '}
                        {r.extraction.slas} service level(s)
                        {r.extraction.extensions.length
                          ? `, options ${r.extraction.extensions.join(' + ')} months`
                          : ''}
                      </span>
                    )}
                    {r.reviewNote && <span className="block text-text-muted">Review: {r.reviewNote}</span>}
                  </Td>
                  <Td label="Actions">
                    {open.status === 'VALIDATED' && r.status !== 'LOADED' && (
                      <span className="flex flex-wrap gap-1">
                        <Button
                          variant="secondary"
                          aria-label={`Correct row ${r.rowNo}`}
                          onClick={() => {
                            setFix(r);
                            setFields(Object.fromEntries(FIELDS.map((f) => [f, r.raw[f] ?? ''])));
                            setError(null);
                          }}
                        >
                          Correct
                        </Button>
                        {r.status !== 'SKIPPED' && (
                          <Button
                            variant="ghost"
                            aria-label={`Set aside row ${r.rowNo}`}
                            onClick={() => {
                              setSkip(r);
                              setReason('');
                              setError(null);
                            }}
                          >
                            Set aside
                          </Button>
                        )}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <Dialog
        open={fix !== null}
        onOpenChange={(o) => !o && setFix(null)}
        title={`Correct row ${fix?.rowNo ?? ''}`}
        description="Change the values and the record is checked again."
        footer={
          <>
            <Button variant="secondary" onClick={() => setFix(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/migration/records/${fix!.id}`, { method: 'PUT', csrf, body: { fields } });
                  await reload(open!.id);
                  setFix(null);
                })
              }
            >
              Save and check
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {FIELDS.map((f) => (
            <Field key={f} label={f.replace('_', ' ')}>
              <Input
                value={fields[f] ?? ''}
                onChange={(e) => setFields({ ...fields, [f]: e.target.value })}
              />
            </Field>
          ))}
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={skip !== null}
        onOpenChange={(o) => !o && setSkip(null)}
        title={`Set aside row ${skip?.rowNo ?? ''}`}
        description="The record will not be loaded. Say why; it stays in the report."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSkip(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() =>
                void run(async () => {
                  await api(`/migration/records/${skip!.id}/skip`, {
                    method: 'POST',
                    csrf,
                    body: { note: reason.trim() },
                  });
                  await reload(open!.id);
                  setSkip(null);
                })
              }
            >
              Set aside
            </Button>
          </>
        }
      >
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {error}
          </p>
        )}
      </Dialog>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cut over this batch?"
        description="Ready records become contracts marked as migrated, linked to their procurement, with alerts scheduled. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = await api<MigrationBatch>(`/migration/batches/${open!.id}/cutover`, {
                    method: 'POST',
                    csrf,
                  });
                  setOpen(r);
                  setBatches(await api<MigrationBatch[]>('/migration/batches'));
                  setConfirm(false);
                  setNote(`Loaded ${r.loaded} record(s).`);
                })
              }
            >
              Cut over
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {open?.valid} record(s) will be loaded and {open?.skipped} set aside.
        </p>
      </Dialog>
    </div>
  );
}
