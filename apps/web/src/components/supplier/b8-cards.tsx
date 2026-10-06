'use client';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import { aud } from '@/lib/labels';

// ------------------------------------------------------------------ insurance certificate (FR-0185)
interface CertResult {
  readable: boolean;
  message: string;
  reading: {
    insurer: string | null;
    policyNumber: string | null;
    coverAud: number | null;
    expiresOn: string | null;
    confidence: number;
    notes: string[];
  };
}

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result).split(',')[1] ?? '');
    rd.onerror = () => reject(rd.error);
    rd.readAsDataURL(f);
  });

/** Upload a certificate of currency; the limit and expiry are read from it and shown back, so the supplier can see what was understood. */
export function CertificateUploader({ csrf, onDone }: { csrf: string; onDone?: () => void }) {
  const [result, setResult] = useState<CertResult | null>(null);
  const r = useRun();
  return (
    <div data-testid="certificate">
      <Field
        label="Certificate of currency"
        hint="A PDF or Word document. We read the policy limit and expiry from it."
      >
        <Input
          type="file"
          accept=".pdf,.docx,.doc,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void r.run('up', async () => {
              const x = await send<CertResult>(csrf, 'PUT', '/supplier/profile/insurance-certificate', {
                name: f.name,
                dataBase64: await toBase64(f),
              });
              setResult(x);
              onDone?.();
            });
          }}
        />
      </Field>
      {r.busy === 'up' && <p className="mt-1 text-sm text-text-muted">Reading your certificate…</p>}
      {result && (
        <div
          role="status"
          className="mt-2 rounded-md border border-border p-3 text-sm"
          data-testid="certificate-result"
        >
          <p
            className={`flex items-center gap-2 font-semibold ${result.readable ? 'text-success' : 'text-warning'}`}
          >
            {result.readable ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <CircleAlert className="size-4" aria-hidden="true" />
            )}
            {result.message}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-1">
            <dt className="text-text-muted">Cover</dt>
            <dd>{result.reading.coverAud === null ? 'Not found' : aud.format(result.reading.coverAud)}</dd>
            <dt className="text-text-muted">Expires</dt>
            <dd>{result.reading.expiresOn ?? 'Not found'}</dd>
            <dt className="text-text-muted">Insurer</dt>
            <dd>{result.reading.insurer ?? 'Not found'}</dd>
            <dt className="text-text-muted">Policy number</dt>
            <dd>{result.reading.policyNumber ?? 'Not found'}</dd>
          </dl>
          <p className="mt-1 text-xs text-text-muted">
            Read by a rules-based stand-in for text recognition (rules-simulated-v1).
          </p>
        </div>
      )}
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ response form (FR-0130)
interface Item {
  key: string;
  label: string;
  section: string;
  kind: 'TEXT' | 'NUMBER' | 'CHOICE' | 'YESNO' | 'DATE';
  required: boolean;
  options: string[];
  unit: string | null;
  maxLength: number | null;
}
interface Form {
  items: Item[];
  answers: Record<string, string>;
  missing: string[];
  requiredCover: number | null;
  cover: { coverAud: number | null; expiresOn: string | null; ok: boolean; reason: string | null };
  submitted: boolean;
}

/** The questions a supplier answers instead of attaching documents, and the cover the tender requires. */
export function ResponseFormCard({
  tenderId,
  open,
  csrf,
  onChange,
}: {
  tenderId: string;
  open: boolean;
  csrf: string;
  onChange: () => void;
}) {
  const { data, error, reload } = useData<Form>(`/supplier/tenders/${tenderId}/response`);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const r = useRun();
  if (error) return null;
  if (!data) return null;
  if (data.items.length === 0 && data.requiredCover === null) return null;
  const val = (k: string) => draft[k] ?? data.answers[k] ?? '';
  const locked = !open || data.submitted;
  return (
    <Card role="region" aria-labelledby="rf-h" data-testid="response-form-card">
      <h2 id="rf-h" className="font-heading text-xl font-bold">
        Your response
      </h2>
      {data.requiredCover !== null && (
        <div className="mt-2 rounded-md border border-border p-3 text-sm" data-testid="cover-status">
          <p
            className={`flex items-center gap-2 font-semibold ${data.cover.ok ? 'text-success' : 'text-warning'}`}
          >
            {data.cover.ok ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <CircleAlert className="size-4" aria-hidden="true" />
            )}
            This tender needs at least {aud.format(data.requiredCover)} of insurance cover.{' '}
            {data.cover.ok ? 'Yours is enough.' : (data.cover.reason ?? '')}
          </p>
          {!locked && !data.cover.ok && <CertificateUploader csrf={csrf} onDone={() => void reload()} />}
        </div>
      )}
      {data.items.length > 0 && (
        <form
          className="mt-3 flex flex-col gap-3"
          aria-label="Response form"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'save',
              async () => {
                await send(csrf, 'PUT', `/supplier/tenders/${tenderId}/response`, { answers: draft });
                setDraft({});
                await reload();
                onChange();
              },
              'Your answers were saved.',
            );
          }}
        >
          {data.items.map((q) => (
            <Field
              key={q.key}
              label={`${q.label}${q.unit ? ` (${q.unit})` : ''}${q.required ? '' : ' (optional)'}`}
            >
              {q.kind === 'CHOICE' ? (
                <Select
                  disabled={locked}
                  value={val(q.key)}
                  onChange={(e) => setDraft({ ...draft, [q.key]: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {q.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              ) : q.kind === 'YESNO' ? (
                <Select
                  disabled={locked}
                  value={val(q.key)}
                  onChange={(e) => setDraft({ ...draft, [q.key]: e.target.value })}
                >
                  <option value="">Choose…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              ) : (
                <Input
                  disabled={locked}
                  type={q.kind === 'DATE' ? 'date' : 'text'}
                  inputMode={q.kind === 'NUMBER' ? 'decimal' : undefined}
                  value={val(q.key)}
                  maxLength={q.maxLength ?? 10000}
                  onChange={(e) => setDraft({ ...draft, [q.key]: e.target.value })}
                />
              )}
            </Field>
          ))}
          {!locked && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={r.busy === 'save'} disabled={Object.keys(draft).length === 0}>
                Save my answers
              </Button>
              {data.missing.length > 0 ? (
                <Badge tone="warning">{data.missing.length} required question(s) still to answer</Badge>
              ) : (
                <Badge tone="success">All required questions answered</Badge>
              )}
            </div>
          )}
          {r.messages}
        </form>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ ESG and ratings (FR-0800, FR-0790)
interface Esg {
  esg: {
    carbonTonnesCo2e?: number | null;
    renewablePct?: number | null;
    diversityOwned?: string | null;
    modernSlaveryStatement?: boolean | null;
  };
}
export function EsgCard({ csrf }: { csrf: string }) {
  const { data, reload } = useData<Esg>('/supplier/profile/esg');
  const [f, setF] = useState<Record<string, string | boolean> | null>(null);
  const r = useRun();
  if (!data) return null;
  const e = data.esg;
  const cur = {
    carbon: f?.carbon ?? (e.carbonTonnesCo2e ?? '').toString(),
    renewable: f?.renewable ?? (e.renewablePct ?? '').toString(),
    diversity: f?.diversity ?? e.diversityOwned ?? 'NONE',
    statement: f?.statement ?? Boolean(e.modernSlaveryStatement),
  };
  const set = (k: string, v: string | boolean) => setF({ ...(f ?? {}), [k]: v });
  return (
    <Card role="region" aria-labelledby="esg-h" data-testid="esg-card">
      <h2 id="esg-h" className="font-heading text-xl font-bold">
        Sustainability and ownership
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        Your customer asks for this to look after the environment, to report on diverse suppliers and to check
        for modern slavery.
      </p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        aria-label="Sustainability and ownership"
        onSubmit={(ev) => {
          ev.preventDefault();
          void r.run(
            'esg',
            async () => {
              await send(csrf, 'PUT', '/supplier/profile/esg', {
                carbonTonnesCo2e: cur.carbon === '' ? null : Number(cur.carbon),
                renewablePct: cur.renewable === '' ? null : Number(cur.renewable),
                diversityOwned: cur.diversity,
                modernSlaveryStatement: cur.statement,
              });
              setF(null);
              await reload();
            },
            'Saved.',
          );
        }}
      >
        <Field label="Yearly emissions (tonnes of CO2e)">
          <Input
            type="number"
            min={0}
            value={String(cur.carbon)}
            onChange={(x) => set('carbon', x.target.value)}
          />
        </Field>
        <Field label="Share of energy from renewables (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={String(cur.renewable)}
            onChange={(x) => set('renewable', x.target.value)}
          />
        </Field>
        <Field label="Is your business owned by">
          <Select value={String(cur.diversity)} onChange={(x) => set('diversity', x.target.value)}>
            <option value="NONE">None of these</option>
            <option value="INDIGENOUS">Indigenous owners</option>
            <option value="WOMEN">Women</option>
            <option value="DISABILITY">People with disability</option>
            <option value="SOCIAL_ENTERPRISE">A social enterprise</option>
          </Select>
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={Boolean(cur.statement)}
            onChange={(x) => set('statement', x.target.checked)}
          />
          We have published a modern slavery statement
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" loading={r.busy === 'esg'} disabled={f === null}>
            Save
          </Button>
          {r.messages}
        </div>
      </form>
    </Card>
  );
}

interface Own {
  dimensions: string[];
  visible: boolean;
  received: { count: number; average: number | null; band: string | null } | null;
  contracts: Array<{ id: string; number: string; title: string | null; rated: boolean }>;
}
export function RateEnterpriseCard({ csrf }: { csrf: string }) {
  const { data, reload } = useData<Own>('/supplier/ratings');
  const [pick, setPick] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const r = useRun();
  if (!data) return null;
  const todo = data.contracts.filter((c) => !c.rated);
  return (
    <Card role="region" aria-labelledby="rate-h" data-testid="rate-card">
      <h2 id="rate-h" className="font-heading text-xl font-bold">
        Ratings
      </h2>
      {data.received ? (
        <p className="mt-2 text-sm">
          How your customer rated you: <strong>{data.received.average ?? 'no ratings yet'}</strong> out of 5
          from {data.received.count} rating(s).
        </p>
      ) : (
        <p className="mt-2 text-sm text-text-muted">
          Your customer has chosen not to show you the ratings they give.
        </p>
      )}
      {todo.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No signed contracts waiting for your rating.</p>
      ) : (
        <form
          className="mt-3 flex flex-col gap-3"
          aria-label="Rate your customer"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'rate',
              async () => {
                await send(csrf, 'POST', '/supplier/ratings', {
                  contractId: pick,
                  scores,
                  ...(comment ? { comment } : {}),
                });
                setPick('');
                setScores({});
                setComment('');
                await reload();
              },
              'Thank you. Your rating was recorded.',
            );
          }}
        >
          <Field label="Contract to rate">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {todo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number} {c.title ?? ''}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.dimensions.map((d) => (
              <Field key={d} label={`${d[0]!.toUpperCase()}${d.slice(1)} (1 poor to 5 excellent)`}>
                <Select
                  value={scores[d] ? String(scores[d]) : ''}
                  onChange={(e) => setScores({ ...scores, [d]: Number(e.target.value) })}
                >
                  <option value="">Choose…</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
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
              disabled={!pick || data.dimensions.some((d) => !scores[d])}
            >
              Send rating
            </Button>
          </div>
          {r.messages}
        </form>
      )}
    </Card>
  );
}
