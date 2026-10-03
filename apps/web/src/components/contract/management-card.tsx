'use client';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, Field, Input, Select } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { ALERT_KIND, formatDateTime } from '@/lib/labels';
import { Gantt } from './gantt';
import type { ContractRecord, ContractView } from './types';

const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** The management record of an executed contract: owner, milestones, optional extensions, term chart and alerts. */
export function ManagementCard({
  record,
  contractId,
  csrf,
  editable,
  onChange,
}: {
  record: ContractRecord;
  contractId: string;
  csrf: string;
  editable: boolean;
  onChange: (c: ContractView) => void;
}) {
  const [dialog, setDialog] = useState<null | 'milestones' | 'extensions'>(null);
  const [rows, setRows] = useState<Array<{ title: string; dueDate: string }>>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [owner, setOwner] = useState(record.owner?.id ?? '');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<ContractView | void>, done?: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const v = await fn();
      onChange(v ?? (await api<ContractView>(`/contracts/${contractId}`)));
      if (done) setNote(done);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const put = (path: string, body: unknown) =>
    api<ContractView>(`/contracts/${contractId}/${path}`, { method: 'PUT', csrf, body });

  return (
    <Card aria-labelledby="mgmt-h" role="region" data-testid="management-card">
      <h2 id="mgmt-h" className="font-heading text-xl font-bold">
        Contract management
      </h2>
      {note && (
        <p role="status" className="mt-2 text-sm font-medium text-success">
          {note}
        </p>
      )}
      {error && !dialog && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">Contract owner</dt>
        <dd className="font-semibold" data-testid="owner">
          {record.owner?.name ?? 'Not assigned'}
        </dd>
      </dl>
      {editable && (record.ownerCandidates?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Change owner
            <Select
              aria-label="New contract owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-56"
            >
              {record.ownerCandidates!.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="secondary"
            loading={busy === 'owner'}
            disabled={!owner || owner === record.owner?.id}
            onClick={() => void run('owner', () => put('owner', { ownerId: owner }), 'Owner changed.')}
          >
            Save owner
          </Button>
        </div>
      )}

      <h3 className="mt-4 font-heading font-semibold">Term and optional extensions</h3>
      <Gantt rows={[{ id: 'this', label: 'This contract', bars: record.bars }]} />
      {editable && (
        <Button
          variant="secondary"
          className="mt-2"
          onClick={() => {
            setMonths(
              record.extensions.length
                ? record.extensions.map((e) => /\((\d+) months\)/.exec(e.label)?.[1] ?? '12')
                : [],
            );
            setError(null);
            setDialog('extensions');
          }}
        >
          Edit extensions
        </Button>
      )}

      <h3 className="mt-4 font-heading font-semibold">Milestones</h3>
      <ul className="mt-1 flex flex-col gap-1 text-sm" aria-label="Milestones">
        {record.milestones.length === 0 && <li className="text-text-muted">No milestones.</li>}
        {record.milestones.map((m) => (
          <li key={m.id} className="flex justify-between gap-3">
            <span>{m.title}</span>
            <span className="text-text-muted">{m.dueDate}</span>
          </li>
        ))}
      </ul>
      {editable && (
        <Button
          variant="secondary"
          className="mt-2"
          onClick={() => {
            setRows(record.milestones.map((m) => ({ title: m.title, dueDate: m.dueDate })));
            setError(null);
            setDialog('milestones');
          }}
        >
          Edit milestones
        </Button>
      )}

      <h3 className="mt-4 font-heading font-semibold">Alerts</h3>
      <ul className="mt-1 flex flex-col gap-2 text-sm" aria-label="Alerts" data-testid="alerts">
        {record.alerts.map((a) => (
          <li key={a.id} className="rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{ALERT_KIND[a.kind] ?? a.kind}</span>
              <Badge tone={a.status === 'SENT' ? 'success' : a.status === 'CANCELLED' ? 'neutral' : 'info'}>
                {a.status === 'SENT' ? 'Sent' : a.status === 'CANCELLED' ? 'Cancelled' : 'Scheduled'}
              </Badge>
              <span className="ml-auto text-text-muted">{a.triggerDate}</span>
            </div>
            {a.note && <p className="mt-1 text-xs text-text-muted">&ldquo;{a.note}&rdquo;</p>}
            {a.deliveries.length > 0 && (
              <p className="mt-1 text-xs text-text-muted">
                Delivered {formatDateTime(a.sentAt)} by{' '}
                {a.deliveries
                  .map((d) => (d.channel === 'IN_APP' ? 'in-app' : 'email (simulated)'))
                  .filter((v, i, all) => all.indexOf(v) === i)
                  .join(' and ')}
              </p>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="mt-3 flex flex-col gap-2"
          aria-label="Add your own alert"
          onSubmit={(e) => {
            e.preventDefault();
            void run('alert', async () => {
              const r = await api<{ summary: string }>(`/contracts/${contractId}/alerts`, {
                method: 'POST',
                csrf,
                body: { instruction },
              });
              setInstruction('');
              setNote(`Alert created: ${r.summary}.`);
            }).then(() => undefined);
          }}
        >
          <Field
            label="Add your own alert"
            hint='Write it the way you would say it, for example "alert me 1 year before expiry and include whoever is my manager then".'
          >
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="alert me 3 months before expiry"
              maxLength={500}
            />
          </Field>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={busy === 'alert'}
              disabled={instruction.trim().length < 5}
            >
              Add alert
            </Button>
          </div>
        </form>
      )}

      <Dialog
        open={dialog === 'milestones'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Edit milestones"
        description="Each milestone must fall inside the contract term. Reminders are rescheduled."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'milestones'}
              onClick={() =>
                void run(
                  'milestones',
                  () => put('milestones', { milestones: rows.filter((r) => r.title.trim() && r.dueDate) }),
                  'Milestones saved.',
                ).then((ok) => ok && setDialog(null))
              }
            >
              Save milestones
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label={`Milestone ${i + 1}`}>
                <Input
                  value={r.title}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label={`Date for milestone ${i + 1}`}>
                <Input
                  type="date"
                  value={r.dueDate}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))
                  }
                />
              </Field>
              <Button
                variant="ghost"
                aria-label={`Remove milestone ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button variant="secondary" onClick={() => setRows([...rows, { title: '', dueDate: '' }])}>
              Add a milestone
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'extensions'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Edit optional extensions"
        description="The extensions the customer may take up after the initial term, in months each."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'extensions'}
              onClick={() =>
                void run(
                  'extensions',
                  () => put('extensions', { extensions: months.filter(Boolean).map(Number) }),
                  'Extensions saved.',
                ).then((ok) => ok && setDialog(null))
              }
            >
              Save extensions
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {months.map((m, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label={`Extension ${i + 1} (months)`}>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={m}
                  onChange={(e) => setMonths(months.map((x, j) => (j === i ? e.target.value : x)))}
                  className="w-28"
                />
              </Field>
              <Button
                variant="ghost"
                aria-label={`Remove extension ${i + 1}`}
                onClick={() => setMonths(months.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              disabled={months.length >= 5}
              onClick={() => setMonths([...months, '12'])}
            >
              Add an extension
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </Card>
  );
}
