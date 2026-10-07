'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';
import { formatDateTime } from '@/lib/labels';

interface Masked {
  bsb: string;
  account: string;
  accountName: string | null;
  masked: boolean;
}
interface Change {
  id: string;
  supplierId: string;
  company: string;
  status: string;
  requestedBy: string | null;
  requestedByRole: string;
  requestedAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
  newBank: Masked | null;
  canConfirm: boolean;
}
interface SupplierBank {
  company: string;
  bank: Masked | null;
  change: Change | null;
}
interface SupplierRow {
  id: string;
  company: string;
}

const LABEL: Record<string, string> = {
  PENDING: 'Waiting for finance; the old details stay in force',
  UNCONFIRMED: 'In force, not yet confirmed by finance',
};

/** Bank details are masked for everyone but finance; a change waits for a different finance person to confirm it (SEC-AC10). */
export function BankChangesPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const changes = useData<{ items: Change[] }>('/bank-changes');
  const suppliers = useData<SupplierRow[]>('/suppliers');
  const [supplierId, setSupplierId] = useState('');
  const bank = useData<SupplierBank>(supplierId ? `/suppliers/${supplierId}/bank` : null);
  const { busy, run, messages } = useRun();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [f, setF] = useState({ bsb: '', account: '', accountName: '' });
  const isFinance = has(roles, 'FINANCE');
  const canAsk = has(roles, 'FINANCE', 'PROCUREMENT');
  const after = async () => {
    await Promise.all([changes.reload(), bank.reload()]);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card role="region" aria-labelledby="bank-h">
        <h2 id="bank-h" className="font-heading text-xl font-bold">
          Who sees bank details
        </h2>
        <p className="mt-2 max-w-prose text-sm text-text-muted" data-testid="bank-rule">
          Only finance sees a supplier&apos;s BSB and account number in full (and the supplier on its own
          profile). Everyone else, administrators included, sees the BSB hidden and only the last three digits
          of the account. Every full view by finance is recorded. A change to details already in force waits:
          the old details stay in force until a different finance person confirms the new ones. Details
          recorded for the first time are in force straight away and wait for a finance person to confirm
          them.
        </p>
        {isFinance ? null : <p className="mt-2 text-sm font-medium">You see the masked form only.</p>}
      </Card>

      <section aria-labelledby="wait-h" className="flex flex-col gap-3">
        <h2 id="wait-h" className="font-heading text-xl font-bold">
          Waiting for finance
        </h2>
        {changes.error && (
          <p role="alert" className="text-sm font-medium text-error">
            {changes.error}
          </p>
        )}
        {changes.data && changes.data.items.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
            Nothing is waiting.
          </p>
        )}
        {changes.data && changes.data.items.length > 0 && (
          <Table caption="Bank detail changes waiting for finance">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>New details</Th>
                <Th>Status</Th>
                <Th>Decision</Th>
              </tr>
            </thead>
            <tbody>
              {changes.data.items.map((c) => (
                <tr key={c.id} data-testid="bank-change-row" data-status={c.status}>
                  <Td label="Supplier">
                    <strong>{c.company}</strong>
                    <span className="block text-xs text-text-muted">
                      Asked by {c.requestedBy} ({c.requestedByRole.toLowerCase()}),{' '}
                      {formatDateTime(c.requestedAt)}
                    </span>
                  </Td>
                  <Td label="New details" className="font-mono text-xs">
                    {c.newBank ? `${c.newBank.bsb} ${c.newBank.account}` : 'none'}
                    {c.newBank?.accountName && (
                      <span className="block font-sans">{c.newBank.accountName}</span>
                    )}
                  </Td>
                  <Td label="Status">
                    <Badge tone="warning">{LABEL[c.status] ?? c.status}</Badge>
                  </Td>
                  <Td label="Decision">
                    {c.canConfirm ? (
                      <div className="flex flex-col gap-2 text-left">
                        <Field label="Note" hint="Five characters to reject.">
                          <Input
                            value={notes[c.id] ?? ''}
                            maxLength={500}
                            onChange={(e) => setNotes((x) => ({ ...x, [c.id]: e.target.value }))}
                          />
                        </Field>
                        <div className="flex gap-2">
                          <Button
                            loading={busy === `ok-${c.id}`}
                            disabled={busy !== null}
                            onClick={() =>
                              void run(
                                `ok-${c.id}`,
                                async () => {
                                  await send(
                                    csrf,
                                    'POST',
                                    `/bank-changes/${c.id}/confirm`,
                                    (notes[c.id] ?? '').trim() ? { note: notes[c.id]!.trim() } : {},
                                  );
                                  await after();
                                },
                                'Confirmed.',
                              )
                            }
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="danger"
                            loading={busy === `no-${c.id}`}
                            disabled={(notes[c.id] ?? '').trim().length < 5 || busy !== null}
                            onClick={() =>
                              void run(
                                `no-${c.id}`,
                                async () => {
                                  await send(csrf, 'POST', `/bank-changes/${c.id}/reject`, {
                                    note: notes[c.id]!.trim(),
                                  });
                                  await after();
                                },
                                'Rejected.',
                              )
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {isFinance ? 'A different finance person must decide this one.' : 'Finance decides.'}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {messages}
      </section>

      <Card role="region" aria-labelledby="look-h">
        <h2 id="look-h" className="font-heading text-xl font-bold">
          A supplier&apos;s details
        </h2>
        <div className="mt-3 max-w-md">
          <Field label="Supplier">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {bank.data && (
          <div className="mt-4" data-testid="bank-view" data-masked={String(bank.data.bank?.masked ?? true)}>
            {bank.data.bank ? (
              <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-text-muted">BSB</dt>
                <dd className="font-mono">{bank.data.bank.bsb}</dd>
                <dt className="text-text-muted">Account</dt>
                <dd className="font-mono">{bank.data.bank.account}</dd>
                <dt className="text-text-muted">Account name</dt>
                <dd>{bank.data.bank.accountName}</dd>
              </dl>
            ) : (
              <p className="text-sm text-text-muted">No bank details are on record.</p>
            )}
            {bank.data.bank?.masked && (
              <p className="mt-2 text-xs text-text-muted">Masked: only finance sees these in full.</p>
            )}
            {bank.data.change && (
              <p className="mt-2 text-sm">
                A change is waiting: {LABEL[bank.data.change.status] ?? bank.data.change.status}.
              </p>
            )}
          </div>
        )}
        {canAsk && supplierId && (
          <form
            className="mt-5 grid gap-4 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'ask',
                async () => {
                  await send(csrf, 'POST', `/suppliers/${supplierId}/bank-change`, f);
                  setF({ bsb: '', account: '', accountName: '' });
                  await after();
                },
                'The change is waiting for a different finance person to confirm it.',
              );
            }}
          >
            <Field label="New BSB" hint="For example 062-000">
              <Input value={f.bsb} onChange={(e) => setF({ ...f, bsb: e.target.value })} />
            </Field>
            <Field label="New account number" hint="Six to ten digits">
              <Input
                value={f.account}
                onChange={(e) => setF({ ...f, account: e.target.value })}
                inputMode="numeric"
              />
            </Field>
            <Field label="Account name">
              <Input value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} />
            </Field>
            <div className="md:col-span-3">
              <Button
                type="submit"
                variant="secondary"
                loading={busy === 'ask'}
                disabled={!f.bsb || !f.account || f.accountName.length < 2 || busy !== null}
              >
                Ask for a change
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
