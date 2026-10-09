'use client';
import { useState } from 'react';
import { AiBadge, Badge, Button, Card, Checkbox, Field, Input, KpiCard, Select, Stepper } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { HistHistory } from './hist-history';
import { HistMappingStep } from './hist-mapping-step';
import { HistResults } from './hist-results';
import type { HistBatch, HistBatchListItem, HistEntityDef, HistSample } from './hist-types';

const STEPS = ['Choose file', 'Map columns', 'Dry run', 'Load', 'History'];
const FILE_ENTITY = 'CONTRACT_FILES';
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

async function toBase64(buf: ArrayBuffer): Promise<string> {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The stepped import wizard (CP-07): choose entity and file, map columns, dry run, load, roll back. */
export function HistWizard({
  entities,
  samples,
  initialBatches,
  csrf,
  canLoad,
}: {
  entities: HistEntityDef[];
  samples: HistSample[];
  initialBatches: HistBatchListItem[];
  csrf: string;
  canLoad: boolean;
}) {
  const [step, setStep] = useState(0);
  const [entity, setEntity] = useState<string>('CONTRACTS');
  const [source, setSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<HistBatch | null>(null);
  const [batches, setBatches] = useState(initialBatches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const run = async (fn: () => Promise<void>) => {
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
  };
  const refreshList = async () => setBatches(await api<HistBatchListItem[]>('/history-import/batches'));
  const open = async (id: string, to?: number) => {
    const b = await api<HistBatch>(`/history-import/batches/${id}?rows=problems&limit=200`);
    setBatch(b);
    if (to !== undefined) setStep(to);
    return b;
  };
  const send = async (name: string, bytes: ArrayBuffer, system: string, ent = entity) => {
    const b = await api<HistBatch>('/history-import/uploads', {
      method: 'POST',
      csrf,
      body: { entity: ent, filename: name, sourceSystem: system, contentBase64: await toBase64(bytes) },
    });
    setBatch(b);
    await refreshList();
    if (ent === FILE_ENTITY) {
      setNote(
        b.ocr?.available === false
          ? (b.ocr.message ?? 'OCR capability not available.')
          : 'The contract files were handed to contract ingestion. Their results are in the history.',
      );
      setStep(4);
    } else setStep(1);
  };
  const useSample = (s: HistSample, kind: 'xlsx' | 'csv') =>
    run(async () => {
      const res = await fetch(`/api/v1/history-import/samples/${s.key}.${kind}`);
      if (!res.ok) throw new Error('sample');
      setEntity(s.entity);
      setSource(s.sourceSystem);
      await send(`${s.key}.${kind}`, await res.arrayBuffer(), s.sourceSystem, s.entity);
    });

  const def = entities.find((e) => e.entity === entity);
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="hist-wizard">
      <Stepper steps={STEPS} current={step} />
      <p className="flex items-center gap-2 text-xs text-text-muted">
        <AiBadge kind="simulated" /> Column suggestions and checks are rules-based (rules-simulated-v1). You
        always have the last word on the mapping.
      </p>
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
          data-testid="hist-note"
        >
          {note}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
          data-testid="hist-error"
        >
          {error}
        </p>
      )}

      {step === 0 && (
        <Card role="region" aria-labelledby="hist-s0">
          <h2 id="hist-s0" className="font-heading text-xl font-bold">
            1. Choose what to import and the file
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="What are you importing?">
              <Select value={entity} onChange={(e) => setEntity(e.target.value)} data-testid="hist-entity">
                {entities.map((e) => (
                  <option key={e.entity} value={e.entity}>
                    {e.label}
                  </option>
                ))}
                <option value={FILE_ENTITY}>Contract files (a zip of PDFs, read by OCR)</option>
              </Select>
            </Field>
            <Field
              label="Source system"
              hint="Where the file came from. Saved column mappings are kept per source system."
            >
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Legacy contract register"
                data-testid="hist-source"
              />
            </Field>
            <Field
              label={entity === FILE_ENTITY ? 'Zip file' : 'Spreadsheet (.xlsx or .csv)'}
              hint="Values only: formulas are not calculated and macros are ignored."
            >
              <input
                type="file"
                accept={entity === FILE_ENTITY ? '.zip' : '.xlsx,.xlsm,.csv'}
                className="min-h-[44px] w-full text-sm"
                data-testid="hist-file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          </div>
          {def && (
            <p className="mt-2 text-sm text-text-muted">
              Fields: {def.fields.map((f) => `${f.label}${f.required ? ' *' : ''}`).join(', ')}.{' '}
              <a className="underline" href={`/api/v1/history-import/templates/${def.entity}?format=xlsx`}>
                Template (xlsx)
              </a>{' '}
              <a className="underline" href={`/api/v1/history-import/templates/${def.entity}?format=csv`}>
                Template (csv)
              </a>
            </p>
          )}
          <div className="mt-3">
            <Button
              loading={busy}
              disabled={!file || source.trim().length < 2}
              data-testid="hist-upload"
              onClick={() =>
                void run(async () => {
                  await send(file!.name, await file!.arrayBuffer(), source.trim());
                })
              }
            >
              Upload and suggest a mapping
            </Button>
          </div>
          <h3 className="mt-6 font-heading text-base font-bold">Or try a sample</h3>
          <p className="text-sm text-text-muted">
            Invented data with realistic mess: mixed date formats, supplier name variants, bad ABNs and gaps.
            Load the supplier extract before the catalogue prices.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {samples.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2 text-sm" data-testid="hist-sample">
                <span className="min-w-48 font-semibold">
                  {s.label}{' '}
                  <span className="font-normal text-text-muted">
                    ({s.rows} rows, {s.sourceSystem})
                  </span>
                </span>
                {s.files.map((f) => (
                  <Button key={f} asChild variant="ghost">
                    <a href={`/api/v1/history-import/samples/${f}`} download>
                      Download {f.split('.')[1]}
                    </a>
                  </Button>
                ))}
                <Button
                  variant="secondary"
                  loading={busy}
                  data-testid={`hist-use-${s.key}`}
                  onClick={() => void useSample(s, 'xlsx')}
                >
                  Use this sample
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {step === 1 && batch && (
        <HistMappingStep
          batch={batch}
          def={entities.find((e) => e.entity === batch.entity)!}
          busy={busy}
          onBack={() => setStep(0)}
          onSave={(mapping, rule, save) =>
            run(async () => {
              const b = await api<HistBatch>(`/history-import/batches/${batch.id}/mapping`, {
                method: 'PUT',
                csrf,
                body: { mapping, duplicateRule: rule, saveForSource: save },
              });
              setBatch({ ...batch, ...b });
              const d = await api<HistBatch>(
                `/history-import/batches/${batch.id}/dry-run?rows=problems&limit=200`,
                { method: 'POST', csrf, body: {} },
              );
              setBatch(d);
              await refreshList();
              setStep(2);
            })
          }
        />
      )}

      {step === 2 && batch && batch.summary && (
        <HistResults
          batch={batch}
          busy={busy}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
          onRule={(rule) =>
            run(async () => {
              setBatch(
                await api<HistBatch>(`/history-import/batches/${batch.id}/dry-run?rows=problems&limit=200`, {
                  method: 'POST',
                  csrf,
                  body: { duplicateRule: rule },
                }),
              );
            })
          }
        />
      )}

      {step === 3 && batch && (
        <Card role="region" aria-labelledby="hist-s3">
          <h2 id="hist-s3" className="font-heading text-xl font-bold">
            4. Load
          </h2>
          {batch.status === 'COMMITTED' && batch.commitSummary ? (
            <div className="mt-2 flex flex-col gap-3" data-testid="hist-committed">
              <p role="status" className="text-sm font-medium text-success">
                Loaded. {batch.commitSummary.loaded} loaded, {batch.commitSummary.merged} merged,{' '}
                {batch.commitSummary.skippedDuplicates} duplicates skipped,{' '}
                {batch.commitSummary.skippedErrors} with errors left out (total {batch.commitSummary.total}
                {batch.commitSummary.reconciles ? ', reconciled' : ''}).
              </p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {batch.commitSummary.contractsCreated > 0 && (
                  <KpiCard label="Contracts" value={batch.commitSummary.contractsCreated} />
                )}
                {batch.commitSummary.contractsCreated > 0 && (
                  <KpiCard label="Reminders" value={batch.commitSummary.remindersCreated} />
                )}
                {batch.commitSummary.suppliersCreated > 0 && (
                  <KpiCard label="Suppliers created" value={batch.commitSummary.suppliersCreated} />
                )}
                {batch.commitSummary.catalogueCreated + batch.commitSummary.catalogueUpdated > 0 && (
                  <KpiCard
                    label="Catalogue items"
                    value={batch.commitSummary.catalogueCreated + batch.commitSummary.catalogueUpdated}
                  />
                )}
                {batch.commitSummary.spendLines > 0 && (
                  <KpiCard label="Spend lines" value={batch.commitSummary.spendLines} />
                )}
              </div>
              <Button variant="secondary" onClick={() => setStep(4)}>
                Go to history
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-1 max-w-prose text-sm text-text-muted">
                {batch.summary?.wouldLoad ?? 0} row(s) will be loaded and {batch.summary?.wouldSkip ?? 0} left
                out (errors and duplicates). Everything the load creates is recorded so the whole batch can be
                rolled back.
                {!canLoad && ' Only an administrator can load a batch.'}
              </p>
              <Checkbox
                data-testid="hist-confirm"
                disabled={!canLoad}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                label="I have checked the dry run and want to load the valid rows."
              />
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  loading={busy}
                  disabled={!canLoad || !confirmed}
                  data-testid="hist-commit"
                  onClick={() =>
                    void run(async () => {
                      setBatch(
                        await api<HistBatch>(`/history-import/batches/${batch.id}/commit`, {
                          method: 'POST',
                          csrf,
                          body: { confirm: true },
                        }),
                      );
                      await refreshList();
                    })
                  }
                >
                  Load valid rows
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {step === 4 && (
        <HistHistory
          batches={batches}
          selected={batch}
          canLoad={canLoad}
          busy={busy}
          onOpen={(id) => void run(async () => void (await open(id)))}
          onNew={() => {
            setBatch(null);
            setFile(null);
            setStep(0);
          }}
          onRollback={(id, reason) =>
            run(async () => {
              setBatch(
                await api<HistBatch>(`/history-import/batches/${id}/rollback`, {
                  method: 'POST',
                  csrf,
                  body: { reason },
                }),
              );
              await refreshList();
              setNote(
                'Rolled back. What the batch created has been removed; contracts are kept as logically deleted records.',
              );
            })
          }
        />
      )}
      <Badge tone="neutral">CP-07 historical import</Badge>
    </div>
  );
}
