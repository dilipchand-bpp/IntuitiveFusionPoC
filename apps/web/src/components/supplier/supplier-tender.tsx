'use client';
import { CheckCircle2, Clock, FileUp, Lock, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Accordion, Badge, Button, Card, Field, Select, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import {
  SUBMISSION_LABEL,
  SUBMISSION_TONE,
  TENDER_STATUS_LABEL,
  TENDER_STATUS_TONE,
  TENDER_TYPE_LABEL,
  formatDateTime,
} from '@/lib/labels';
import { DeviationsCard } from './deviations-card';
import type { BidFile, SupplierTenderView } from '@/components/tender/types';

const SECTION_LABEL = { TECHNICAL: 'Technical', COMMERCIAL: 'Commercial', OTHER: 'Other' } as const;
const MAX_BYTES = 10 * 1024 * 1024;

const problem = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

function remaining(ms: number): string {
  if (ms <= 0) return 'Closed';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'} ${h} h left`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s % 60)} left`;
}
const readBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(f);
  });
const size = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export function SupplierTender({ initial, csrf }: { initial: SupplierTenderView; csrf: string }) {
  const router = useRouter();
  const [t, setT] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.serverTime));
  const offset = useRef(Date.parse(initial.serverTime) - Date.now());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [section, setSection] = useState<'TECHNICAL' | 'COMMERCIAL' | 'OTHER'>('TECHNICAL');
  const [question, setQuestion] = useState('');
  const [lastReceipt, setLastReceipt] = useState<{
    receipt: string;
    submittedAt: string;
    files: Array<{ name: string; sha256?: string }>;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(
    async () => setT(await api<SupplierTenderView>(`/supplier/tenders/${t.id}`)),
    [t.id],
  );

  // Countdown on the server's clock, not the phone's. At zero the form locks and the page is refreshed from the server.
  const closes = t.closesAt ? Date.parse(t.closesAt) : null;
  const left = closes === null ? null : closes - now;
  // after the closing time a supplier with a late-submission permission can still bid until it runs out (FR-0205)
  const open = t.canBid && (t.lateAccess === true || left === null || left > 0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (t.canBid && !t.lateAccess && left !== null && left <= 0) void reload().then(() => router.refresh());
  }, [t.canBid, t.lateAccess, left, reload, router]);

  async function run(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (e) {
      setError(problem(e));
      if (e instanceof ApiError && e.problem.code === 'BID_CLOSED') await reload();
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 10 MB. Split it or compress it.');
      return;
    }
    await run(
      'upload',
      async () => {
        const dataBase64 = await readBase64(file);
        await api(`/supplier/tenders/${t.id}/submission/files`, {
          method: 'POST',
          csrf,
          body: { name: file.name, section, dataBase64 },
        });
        await reload();
      },
      `${file.name} added to your bid.`,
    );
    if (fileInput.current) fileInput.current.value = '';
  }

  const sub = t.submission;
  const submitted = sub.status === 'SUBMITTED';
  const published = t.questions.filter((q) => q.status === 'PUBLISHED');
  const need = (['TECHNICAL', 'COMMERCIAL'] as const).filter((s) => !sub.files.some((f) => f.section === s));

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="supplier-tender-page"
      data-open={open ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TENDER_STATUS_TONE[t.status] ?? 'neutral'}>
          {TENDER_STATUS_LABEL[t.status] ?? t.status}
        </Badge>
        <Badge tone="info">{TENDER_TYPE_LABEL[t.type] ?? t.type}</Badge>
        {(t.stage ?? 1) > 1 && <Badge tone="info">Stage {t.stage}</Badge>}
        <Badge tone={SUBMISSION_TONE[sub.status] ?? 'neutral'}>
          {SUBMISSION_LABEL[sub.status] ?? sub.status}
        </Badge>
      </div>

      <div
        role="status"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${open ? 'border-border bg-surface' : 'border-warning bg-warning-bg text-warning'}`}
        data-testid="closing-banner"
      >
        <p className="flex items-center gap-2 font-semibold">
          {open ? (
            <Clock className="size-5" aria-hidden="true" />
          ) : (
            <Lock className="size-5" aria-hidden="true" />
          )}
          {open && t.lateAccess
            ? 'The closing time has passed, but the buyer has given you extra time to submit.'
            : open
              ? `Open until ${formatDateTime(t.closesAt)}`
              : 'This tender is closed. Nothing can be uploaded or submitted.'}
        </p>
        {open && !t.lateAccess && left !== null && (
          <p className="font-mono text-lg font-bold" data-testid="countdown">
            {remaining(left)}
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
        >
          {notice}
        </p>
      )}

      {/* ------------------------------------------------------------ proposed contract changes */}
      <DeviationsCard tenderId={t.id} open={open} csrf={csrf} />

      {/* ------------------------------------------------------------ your bid */}
      <Card role="region" aria-labelledby="bid-h">
        <h2 id="bid-h" className="font-heading text-xl font-bold">
          Your bid
        </h2>

        {submitted && (
          <div className="mt-3 rounded-md border-2 border-success p-4 text-success" data-testid="receipt">
            <p className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="size-5" aria-hidden="true" /> Bid received
            </p>
            <p className="mt-1 text-sm">
              Receipt{' '}
              <span className="font-mono font-bold" data-testid="receipt-number">
                {sub.receipt}
              </span>{' '}
              · {formatDateTime(sub.submittedAt)}
            </p>
            <p className="text-sm">
              Keep this receipt. You can withdraw and resubmit until the closing time.
            </p>
          </div>
        )}

        <ul className="mt-3 flex flex-col gap-2" aria-label="Files in your bid">
          {sub.files.length === 0 && <li className="text-sm text-text-muted">No files yet.</li>}
          {sub.files.map((f: BidFile) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              data-testid="bid-file"
            >
              <span className="min-w-0">
                <span className="font-semibold break-all">{f.name}</span>{' '}
                <span className="text-text-muted">
                  · {SECTION_LABEL[f.section]} · {size(f.sizeBytes)}
                  {f.carriedForward ? ' · kept from your earlier stage' : ''}
                </span>
              </span>
              {open && !submitted && (
                <Button
                  variant="ghost"
                  aria-label={`Remove ${f.name}`}
                  loading={busy === `rm-${f.id}`}
                  onClick={() =>
                    void run(`rm-${f.id}`, async () => {
                      await api(`/supplier/tenders/${t.id}/submission/files/${f.id}`, {
                        method: 'DELETE',
                        csrf,
                      });
                      await reload();
                    })
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>

        {open && !submitted && (
          <div className="mt-4 flex flex-col gap-3 rounded-md bg-surface-alt p-4">
            <div className="grid gap-3 sm:grid-cols-[17rem_1fr] sm:items-end">
              <Field label="This file is">
                <Select value={section} onChange={(e) => setSection(e.target.value as typeof section)}>
                  <option value="TECHNICAL">Technical response</option>
                  <option value="COMMERCIAL">Commercial / pricing</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <div>
                <label htmlFor="bid-file" className="text-sm font-semibold">
                  Choose a file to upload
                </label>
                <p className="text-sm text-text-muted">
                  PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG or ZIP. Up to 10 MB each.
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <FileUp className="size-5 text-accent" aria-hidden="true" />
                  <input
                    id="bid-file"
                    ref={fileInput}
                    type="file"
                    disabled={busy === 'upload'}
                    onChange={(e) => void onFile(e.target.files?.[0])}
                    className="min-h-[44px] w-full text-sm file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-md file:border-0 file:bg-accent/10 file:px-4 file:font-semibold file:text-accent hover:file:bg-accent/20"
                  />
                </div>
              </div>
            </div>
            {need.length > 0 && sub.files.length > 0 && (
              <p className="text-sm text-text-muted">
                Still needed before you can submit: a {need.map((n) => n.toLowerCase()).join(' and a ')} file.
              </p>
            )}
            <div>
              <Button
                loading={busy === 'submit'}
                disabled={need.length > 0}
                onClick={() =>
                  void run(
                    'submit',
                    async () => {
                      const r = await api<{
                        receipt: string;
                        submittedAt: string;
                        files: Array<{ name: string; sha256?: string }>;
                      }>(`/supplier/tenders/${t.id}/submission`, { method: 'POST', csrf });
                      setLastReceipt(r);
                      await reload();
                    },
                    'Your bid was submitted.',
                  )
                }
              >
                Submit bid
              </Button>
            </div>
          </div>
        )}

        {open && submitted && (
          <div className="mt-3">
            <Button
              variant="secondary"
              loading={busy === 'withdraw'}
              onClick={() =>
                void run(
                  'withdraw',
                  async () => {
                    setT(
                      await api<SupplierTenderView>(`/supplier/tenders/${t.id}/submission/withdraw`, {
                        method: 'POST',
                        csrf,
                      }),
                    );
                    setLastReceipt(null);
                  },
                  'Your bid was withdrawn. Change your files and submit again before the closing time.',
                )
              }
            >
              Withdraw to change files
            </Button>
          </div>
        )}

        {lastReceipt && submitted && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">What was received</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {lastReceipt.files.map((f) => (
                <li key={f.name}>
                  {f.name}{' '}
                  <span className="font-mono text-xs text-text-muted">{f.sha256?.slice(0, 16)}…</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {/* ------------------------------------------------------------ pack */}
      <section aria-labelledby="pack-h" className="flex flex-col gap-3">
        <h2 id="pack-h" className="font-heading text-xl font-bold">
          Tender documents
        </h2>
        <Accordion
          items={t.fields.map((f) => ({
            q: f.label,
            a: (
              <div className="flex flex-col gap-2">
                {f.paragraphs.map((p, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {p}
                  </p>
                ))}
              </div>
            ),
          }))}
        />
      </section>

      {/* ------------------------------------------------------------ Q&A and addenda */}
      <Card role="region" aria-labelledby="qa-h">
        <h2 id="qa-h" className="font-heading text-xl font-bold">
          Questions and addenda
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Questions are answered for every supplier at once, without saying who asked.
        </p>
        <ul className="mt-3 flex flex-col gap-3" aria-label="Addenda">
          {t.addenda.map((a) => (
            <li key={a.id} className="rounded-md border border-border p-3 text-sm" data-testid="addendum">
              <p className="font-semibold">
                Addendum {a.number} · {formatDateTime(a.issuedAt)}
              </p>
              <p>{a.summary}</p>
              {a.newClosesAt && (
                <p className="font-semibold">New closing time: {formatDateTime(a.newClosesAt)}</p>
              )}
            </li>
          ))}
        </ul>
        <ul className="mt-3 flex flex-col gap-3" aria-label="Published questions and answers">
          {published.length === 0 && t.addenda.length === 0 && (
            <li className="text-sm text-text-muted">Nothing has been published yet.</li>
          )}
          {published.map((q) => (
            <li
              key={q.id}
              className="rounded-md border border-border p-3 text-sm"
              data-testid="published-question"
            >
              <p className="font-semibold">Q: {q.text}</p>
              <p>
                A: {q.answer}
                {q.audience === 'SINGLE' && (
                  <span className="ml-2 text-xs text-text-muted">(answered to you only)</span>
                )}
              </p>
            </li>
          ))}
        </ul>
        {open && (
          <form
            className="mt-4 flex flex-col gap-2"
            aria-label="Ask a question"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'ask',
                async () => {
                  await api(`/supplier/tenders/${t.id}/questions`, {
                    method: 'POST',
                    csrf,
                    body: { text: question },
                  });
                  setQuestion('');
                },
                'Your question was sent. The answer will be published to everyone.',
              );
            }}
          >
            <Field
              label="Ask the buyer a question"
              hint="Your company name is never shown with the question."
            >
              <Textarea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                minLength={5}
                maxLength={2000}
                required
              />
            </Field>
            <div>
              <Button type="submit" variant="secondary" loading={busy === 'ask'}>
                Send question
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
