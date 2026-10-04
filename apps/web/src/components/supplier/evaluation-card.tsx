'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';

interface Request {
  id: string;
  tenderId: string;
  kind: 'COMPLIANCE' | 'CLARIFICATION' | 'NEGOTIATION';
  subject: string;
  question: string;
  dueAt: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  overdue: boolean;
  response: string | null;
}
interface Offer {
  id: string;
  revision: number;
  tco: number;
  note: string | null;
  submittedAt: string;
}
interface Round {
  id: string;
  tenderId: string;
  round: number;
  status: 'OPEN' | 'CLOSED';
  note: string;
  closesAt: string;
  offers: Offer[];
}
interface Pricing {
  basePrice: number;
  implementation: number;
  annualRunning: number;
  years: number;
  tco: number;
}
const aud = (v: number) => `AUD ${Math.round(v).toLocaleString('en-AU')}`;
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/**
 * What a supplier does after bidding: enter pricing so total cost can be compared, answer the buyer's clarification and
 * compliance requests before their deadline, and make best and final offers (FR-0265, FR-0280, FR-0290).
 */
export function SupplierEvaluationCard({
  tenderId,
  open,
  csrf,
}: {
  tenderId: string;
  open: boolean;
  csrf: string;
}) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [form, setForm] = useState({ basePrice: '', implementation: '0', annualRunning: '0', years: '1' });
  const [requests, setRequests] = useState<Request[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [offer, setOffer] = useState<
    Record<string, { base: string; impl: string; run: string; years: string; note: string }>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = await api<{ pricing: Pricing | null }>(`/supplier/tenders/${tenderId}/pricing`).catch(
      () => null,
    );
    if (p?.pricing) {
      setPricing(p.pricing);
      setForm({
        basePrice: String(p.pricing.basePrice),
        implementation: String(p.pricing.implementation),
        annualRunning: String(p.pricing.annualRunning),
        years: String(p.pricing.years),
      });
    }
    const c = await api<{ clarifications: Request[] }>('/supplier/clarifications').catch(() => ({
      clarifications: [],
    }));
    setRequests(c.clarifications.filter((x) => x.tenderId === tenderId));
    const b = await api<{ rounds: Round[] }>('/supplier/bafo').catch(() => ({ rounds: [] }));
    setRounds(b.rounds.filter((x) => x.tenderId === tenderId));
  }, [tenderId]);
  useEffect(() => void load(), [load]);

  async function go(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
      if (ok) setNote(ok);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  const nums = (x: { basePrice: string; implementation: string; annualRunning: string; years: string }) => ({
    basePrice: Number(x.basePrice),
    implementation: Number(x.implementation || 0),
    annualRunning: Number(x.annualRunning || 0),
    years: Number(x.years || 1),
  });

  const showPricing = open || pricing !== null;
  if (!showPricing && requests.length === 0 && rounds.length === 0) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="supplier-evaluation">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
        >
          {note}
        </p>
      )}

      {requests.length > 0 && (
        <Card role="region" aria-labelledby="req-h" data-testid="supplier-requests">
          <h2 id="req-h" className="font-heading text-xl font-bold">
            Requests from the buyer
          </h2>
          <ul className="mt-3 flex flex-col gap-3" aria-label="Requests">
            {requests.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-border p-3 text-sm"
                data-status={r.status}
                data-kind={r.kind}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{r.subject}</strong>
                  <Badge tone={r.status === 'ANSWERED' ? 'success' : r.overdue ? 'error' : 'warning'}>
                    {r.status === 'ANSWERED'
                      ? 'Answered'
                      : r.status === 'CLOSED'
                        ? 'Closed'
                        : r.overdue
                          ? 'Overdue'
                          : 'Please answer'}
                  </Badge>
                  <span className="text-xs text-text-muted">Answer by {formatDateTime(r.dueAt)}</span>
                </div>
                <p className="mt-1 max-w-prose">{r.question}</p>
                {r.response && (
                  <p className="mt-1 max-w-prose rounded bg-surface-alt p-2">Your answer: {r.response}</p>
                )}
                {r.status === 'OPEN' && !r.overdue && (
                  <div className="mt-2 flex flex-col gap-2">
                    <Field label={`Your answer to: ${r.subject}`}>
                      <Textarea
                        rows={3}
                        maxLength={8000}
                        value={answers[r.id] ?? ''}
                        onChange={(e) => setAnswers({ ...answers, [r.id]: e.target.value })}
                      />
                    </Field>
                    <div>
                      <Button
                        loading={busy === `ans-${r.id}`}
                        disabled={(answers[r.id] ?? '').trim().length < 2}
                        aria-label={`Send your answer to: ${r.subject}`}
                        onClick={() =>
                          void go(
                            `ans-${r.id}`,
                            async () => {
                              await api(`/supplier/clarifications/${r.id}/response`, {
                                method: 'POST',
                                csrf,
                                body: { response: answers[r.id] },
                              });
                              setAnswers({ ...answers, [r.id]: '' });
                            },
                            'Your answer was sent.',
                          )
                        }
                      >
                        Send answer
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rounds.length > 0 && (
        <Card role="region" aria-labelledby="bafo-h" data-testid="supplier-bafo">
          <h2 id="bafo-h" className="font-heading text-xl font-bold">
            Best and final offer
          </h2>
          <ul className="mt-3 flex flex-col gap-3" aria-label="Rounds">
            {rounds.map((r) => {
              const f = offer[r.id] ?? { base: '', impl: '0', run: '0', years: '1', note: '' };
              return (
                <li key={r.id} className="rounded-md border border-border p-3 text-sm" data-status={r.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>Round {r.round}</strong>
                    <Badge tone={r.status === 'OPEN' ? 'warning' : 'neutral'}>
                      {r.status === 'OPEN' ? 'Open' : 'Closed'}
                    </Badge>
                    <span className="text-xs text-text-muted">Closes {formatDateTime(r.closesAt)}</span>
                  </div>
                  <p className="mt-1 max-w-prose">{r.note}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    Your original bid stays on record. Each offer you make is kept as a new revision.
                  </p>
                  {r.offers.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1" aria-label="Your offers">
                      {r.offers.map((o) => (
                        <li key={o.id}>
                          Revision {o.revision}: <strong className="font-mono">{aud(o.tco)}</strong> total
                          cost{o.note ? `, ${o.note}` : ''} ({formatDateTime(o.submittedAt)})
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.status === 'OPEN' && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Price (AUD)">
                        <Input
                          type="number"
                          min={0}
                          value={f.base}
                          onChange={(e) => setOffer({ ...offer, [r.id]: { ...f, base: e.target.value } })}
                        />
                      </Field>
                      <Field label="Implementation (AUD)">
                        <Input
                          type="number"
                          min={0}
                          value={f.impl}
                          onChange={(e) => setOffer({ ...offer, [r.id]: { ...f, impl: e.target.value } })}
                        />
                      </Field>
                      <Field label="Running cost per year (AUD)">
                        <Input
                          type="number"
                          min={0}
                          value={f.run}
                          onChange={(e) => setOffer({ ...offer, [r.id]: { ...f, run: e.target.value } })}
                        />
                      </Field>
                      <Field label="Years">
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          value={f.years}
                          onChange={(e) => setOffer({ ...offer, [r.id]: { ...f, years: e.target.value } })}
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Note (optional)">
                          <Input
                            value={f.note}
                            onChange={(e) => setOffer({ ...offer, [r.id]: { ...f, note: e.target.value } })}
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Button
                          loading={busy === `offer-${r.id}`}
                          disabled={!f.base}
                          aria-label={`Submit an offer for round ${r.round}`}
                          onClick={() =>
                            void go(
                              `offer-${r.id}`,
                              async () => {
                                await api(`/supplier/bafo/${r.id}/offer`, {
                                  method: 'PUT',
                                  csrf,
                                  body: {
                                    ...nums({
                                      basePrice: f.base,
                                      implementation: f.impl,
                                      annualRunning: f.run,
                                      years: f.years,
                                    }),
                                    ...(f.note ? { note: f.note } : {}),
                                  },
                                });
                              },
                              'Your offer was recorded.',
                            )
                          }
                        >
                          Submit offer
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {showPricing && (
        <Card role="region" aria-labelledby="pricing-h" data-testid="supplier-pricing">
          <h2 id="pricing-h" className="font-heading text-xl font-bold">
            Your pricing
          </h2>
          <p className="mt-1 max-w-prose text-sm text-text-muted">
            Enter your price and the costs over the term, so the buyer can compare total cost of ownership.
            This is in addition to your pricing files, and stays sealed until the tender closes.
          </p>
          {pricing && (
            <p className="mt-2 text-sm" data-testid="pricing-tco">
              Total cost over {pricing.years} year(s):{' '}
              <strong className="font-mono">{aud(pricing.tco)}</strong>
            </p>
          )}
          {open && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Price (AUD)">
                <Input
                  type="number"
                  min={0}
                  value={form.basePrice}
                  onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                />
              </Field>
              <Field label="Implementation (AUD)">
                <Input
                  type="number"
                  min={0}
                  value={form.implementation}
                  onChange={(e) => setForm({ ...form, implementation: e.target.value })}
                />
              </Field>
              <Field label="Running cost per year (AUD)">
                <Input
                  type="number"
                  min={0}
                  value={form.annualRunning}
                  onChange={(e) => setForm({ ...form, annualRunning: e.target.value })}
                />
              </Field>
              <Field label="Years of running cost">
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={form.years}
                  onChange={(e) => setForm({ ...form, years: e.target.value })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  variant="secondary"
                  loading={busy === 'pricing'}
                  disabled={!form.basePrice}
                  onClick={() =>
                    void go(
                      'pricing',
                      async () => {
                        await api(`/supplier/tenders/${tenderId}/pricing`, {
                          method: 'PUT',
                          csrf,
                          body: nums(form),
                        });
                      },
                      'Your pricing was saved.',
                    )
                  }
                >
                  Save pricing
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
