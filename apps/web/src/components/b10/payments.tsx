'use client';
import { useRef, useState } from 'react';
import { Badge, Button, Checkbox, Field, Input } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

export interface PaymentView {
  id: string;
  ref: string;
  invoiceId: string;
  amount: number;
  status: 'PROPOSED' | 'APPROVED' | 'SENT' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  financeRef: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  failureReason: string | null;
  attempts: number;
  waiting: { reason: string | null; manualTaskId: string | null } | null;
  trail: Array<{ at: string; status: string; by: string | null; note: string }>;
}
interface List {
  connector: { provider: string; enabled: boolean; mode: string; health: string } | null;
  payments: PaymentView[];
}

const TONE = {
  PROPOSED: 'neutral',
  APPROVED: 'warning',
  SENT: 'info',
  CONFIRMED: 'success',
  FAILED: 'error',
  CANCELLED: 'neutral',
} as const;
const aud = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export const usePayments = () => useData<List>('/payments');

/** Pay a matched invoice through the simulated finance system: propose, a second person approves, status trail (FR-0875). */
export function InvoicePayments({
  invoice,
  csrf,
  roles,
  data,
  reload,
  onPaid,
}: {
  invoice: { id: string; number: string; amount: number; status: string; paidAmount: number };
  csrf: string;
  roles: readonly string[];
  data: List | null;
  reload: () => Promise<void>;
  onPaid: () => Promise<void> | void;
}) {
  const mine = (data?.payments ?? []).filter((p) => p.invoiceId === invoice.id);
  const { busy, run, messages } = useRun();
  const [amount, setAmount] = useState('');
  const [fail, setFail] = useState(false);
  const key = useRef<string>(crypto.randomUUID());
  const canPay = has([...roles], 'FINANCE');
  const canDecide = has([...roles], 'FINANCE', 'EXEC');
  const open = mine
    .filter((p) => ['PROPOSED', 'APPROVED', 'SENT'].includes(p.status))
    .reduce((s, p) => s + p.amount, 0);
  const remaining = Math.round((invoice.amount - invoice.paidAmount - open) * 100) / 100;
  if (mine.length === 0 && !(canPay && invoice.status === 'MATCHED')) return null;
  const after = async () => {
    await reload();
    await onPaid();
  };
  const act = (p: PaymentView, what: 'approve' | 'retry' | 'cancel', ok: string) =>
    run(
      `${what}-${p.id}`,
      async () => {
        await send(csrf, 'POST', `/payments/${p.id}/${what}`);
        await after();
      },
      ok,
    );
  return (
    <div
      className="mt-3 rounded-md border border-border p-3"
      data-testid="payments"
      data-invoice={invoice.number}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Payment run</h3>
        <Badge tone="info">SIMULATED finance system</Badge>
        {invoice.paidAmount > 0 && invoice.status !== 'PAID' && (
          <span className="text-sm text-text-muted">
            {aud(invoice.paidAmount)} paid, {aud(remaining)} left to pay
          </span>
        )}
      </div>
      {canPay && invoice.status === 'MATCHED' && remaining > 0 && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              `propose-${invoice.id}`,
              async () => {
                await send(csrf, 'POST', `/invoices/${invoice.id}/payments`, {
                  ...(amount ? { amount: Number(amount) } : {}),
                  idempotencyKey: key.current,
                  ...(fail ? { simulateFailure: true } : {}),
                });
                key.current = crypto.randomUUID();
                setAmount('');
                setFail(false);
                await after();
              },
              'Payment proposed. A different person must approve it.',
            );
          }}
        >
          <Field
            label={`Amount for ${invoice.number}`}
            hint={`Up to ${aud(remaining)}; leave empty for all of it`}
          >
            <Input
              type="number"
              min={0.01}
              step={0.01}
              max={remaining}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-40"
            />
          </Field>
          <Checkbox
            label="Simulate a failure on the first send"
            checked={fail}
            onChange={(e) => setFail(e.target.checked)}
          />
          <Button
            type="submit"
            aria-label={`Pay ${invoice.number}`}
            loading={busy === `propose-${invoice.id}`}
          >
            Pay
          </Button>
        </form>
      )}
      <ul className="mt-2 flex flex-col gap-2" data-testid="payment-list">
        {mine.map((p) => (
          <li key={p.id} className="rounded-md bg-surface-alt/60 p-2 text-sm" data-payment-status={p.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{p.ref}</span>
              <Badge tone={TONE[p.status]}>{p.status.toLowerCase()}</Badge>
              <span>{aud(p.amount)}</span>
              {p.financeRef && <span className="text-text-muted">finance ref {p.financeRef}</span>}
              {p.waiting && (
                <Badge tone="warning">Waiting for the finance system; a manual task was queued</Badge>
              )}
              {p.status === 'FAILED' && p.failureReason && (
                <span className="text-error">{p.failureReason}</span>
              )}
              {canDecide && p.status === 'PROPOSED' && (
                <Button
                  aria-label={`Approve ${p.ref}`}
                  loading={busy === `approve-${p.id}`}
                  onClick={() => void act(p, 'approve', 'Approved and sent.')}
                >
                  Approve and send
                </Button>
              )}
              {canDecide && (p.status === 'FAILED' || p.waiting) && (
                <Button
                  variant="secondary"
                  aria-label={`Retry ${p.ref}`}
                  loading={busy === `retry-${p.id}`}
                  onClick={() => void act(p, 'retry', 'Tried again.')}
                >
                  Retry
                </Button>
              )}
              {canDecide && (p.status === 'PROPOSED' || p.status === 'FAILED') && (
                <Button
                  variant="secondary"
                  aria-label={`Cancel ${p.ref}`}
                  loading={busy === `cancel-${p.id}`}
                  onClick={() => void act(p, 'cancel', 'Cancelled.')}
                >
                  Cancel
                </Button>
              )}
            </div>
            <ol
              className="mt-1 list-decimal pl-5 text-xs text-text-muted"
              aria-label={`Status trail for ${p.ref}`}
            >
              {p.trail.map((t, i) => (
                <li key={i}>
                  {t.status.toLowerCase()}
                  {t.by ? ` by ${t.by}` : ''}: {t.note}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
      {messages}
    </div>
  );
}
