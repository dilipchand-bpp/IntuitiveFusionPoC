'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Dialog, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { aud } from '@/lib/labels';

export interface DelegationRow {
  id: string;
  scope: 'SOURCING_APPROVAL' | 'CONTRACT_SIGNING' | 'PUBLISH_PERMISSION';
  role: string;
  userId: string | null;
  userName: string | null;
  maxValue: number;
  active: boolean;
}
export interface StaffUser {
  id: string;
  name: string;
  roles: string[];
}
export interface AlertSettings {
  expiry: number;
  notice: number;
  extension: number;
  milestone: number;
}

const SCOPE: Record<DelegationRow['scope'], string> = {
  SOURCING_APPROVAL: 'Sourcing approval',
  CONTRACT_SIGNING: 'Contract signing',
  PUBLISH_PERMISSION: 'Permission to publish',
};
const without = (o: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** Limits of authority. A change applies to the very next approval or signature; each one is audited. */
export function DelegationsPanel({
  initial,
  users,
  csrf,
}: {
  initial: DelegationRow[];
  users: StaffUser[];
  csrf: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ scope: 'CONTRACT_SIGNING', userId: '', maxValue: '' });

  async function save(r: DelegationRow, patch: { maxValue?: number; active?: boolean }) {
    setBusy(r.id);
    setError(null);
    setNote(null);
    try {
      const next = await api<DelegationRow>(`/admin/delegations/${r.id}`, {
        method: 'PUT',
        csrf,
        body: { maxValue: patch.maxValue ?? r.maxValue, active: patch.active ?? r.active },
      });
      setRows(rows.map((x) => (x.id === r.id ? next : x)));
      setEdit((e) => without(e, r.id));
      setNote(
        `${r.userName ?? r.role}: ${SCOPE[r.scope].toLowerCase()} limit is now ${next.active ? aud.format(next.maxValue) : 'off'}.`,
      );
      router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  async function create() {
    setBusy('new');
    setError(null);
    try {
      const made = await api<DelegationRow>('/admin/delegations', {
        method: 'POST',
        csrf,
        body: { scope: form.scope, userId: form.userId, maxValue: Number(form.maxValue) },
      });
      setRows([...rows, made]);
      setOpen(false);
      setNote(
        `${made.userName}: ${SCOPE[made.scope].toLowerCase()} limit is now ${aud.format(made.maxValue)}.`,
      );
      router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="del-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="del-h" className="font-heading text-xl font-bold">
          Limits of authority
        </h2>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => {
            setForm({ scope: 'CONTRACT_SIGNING', userId: users[0]?.id ?? '', maxValue: '' });
            setError(null);
            setOpen(true);
          }}
        >
          Add a limit
        </Button>
      </div>
      <p className="max-w-prose text-sm text-text-muted">
        Signing authority is separate from sourcing approval: holding one never gives the other. A change
        applies to the next approval or signature, and the person is told.
      </p>
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
          data-testid="delegation-note"
        >
          {note}
        </p>
      )}
      {error && !open && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      <Table caption="Delegations of authority">
        <thead>
          <tr>
            <Th>Authority</Th>
            <Th>Person</Th>
            <Th>Role</Th>
            <Th className="text-right">Limit (AUD)</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const who = r.userName ?? `Anyone with the ${r.role.toLowerCase()} role`;
            const editing = r.id in edit;
            return (
              <tr key={r.id} data-testid="delegation-row">
                <Td label="Authority">{SCOPE[r.scope]}</Td>
                <Td label="Person">{who}</Td>
                <Td label="Role">{r.role}</Td>
                <Td label="Limit" className="text-right">
                  {editing ? (
                    <Input
                      type="number"
                      min={0}
                      aria-label={`New limit for ${who}, ${SCOPE[r.scope]}`}
                      value={edit[r.id]}
                      onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })}
                      className="ml-auto w-40 text-right"
                    />
                  ) : (
                    aud.format(r.maxValue)
                  )}
                </Td>
                <Td label="Status">
                  <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Active' : 'Off'}</Badge>
                </Td>
                <Td label="Actions">
                  <div className="flex flex-wrap gap-2">
                    {editing ? (
                      <>
                        <Button
                          loading={busy === r.id}
                          aria-label={`Save the limit for ${who}, ${SCOPE[r.scope]}`}
                          onClick={() => void save(r, { maxValue: Number(edit[r.id]) })}
                        >
                          Save
                        </Button>
                        <Button variant="secondary" onClick={() => setEdit((e) => without(e, r.id))}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          aria-label={`Change the limit for ${who}, ${SCOPE[r.scope]}`}
                          onClick={() => setEdit({ ...edit, [r.id]: String(r.maxValue) })}
                        >
                          Change
                        </Button>
                        <Button
                          variant="ghost"
                          loading={busy === r.id}
                          aria-label={`${r.active ? 'Switch off' : 'Switch on'} ${SCOPE[r.scope]} for ${who}`}
                          onClick={() => void save(r, { active: !r.active })}
                        >
                          {r.active ? 'Switch off' : 'Switch on'}
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a limit of authority"
        description="Choose the kind of authority, the person and the most they may approve or sign."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'new'}
              disabled={!form.userId || form.maxValue === ''}
              onClick={() => void create()}
            >
              Add limit
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Authority">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              {Object.entries(SCOPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Person">
            <Select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.roles.join(', ').toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Limit (AUD)">
            <Input
              type="number"
              min={0}
              value={form.maxValue}
              onChange={(e) => setForm({ ...form, maxValue: e.target.value })}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </section>
  );
}

/** How far ahead contract alerts go out. Saving moves the scheduled alerts of every executed contract. */
export function AlertSettingsForm({ initial, csrf }: { initial: AlertSettings; csrf: string }) {
  const [v, setV] = useState({
    expiry: String(initial.expiry),
    notice: String(initial.notice),
    extension: String(initial.extension),
    milestone: String(initial.milestone),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const field = (k: keyof AlertSettings, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={1}
        max={365}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
        className="w-28"
      />
    </Field>
  );
  return (
    <section aria-labelledby="alert-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="alert-h" className="font-heading text-xl font-bold">
        Contract alert timing
      </h2>
      <form
        className="grid max-w-3xl gap-4 sm:grid-cols-2"
        aria-label="Contract alert timing"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setNote(null);
          api('/admin/alert-settings', {
            method: 'PUT',
            csrf,
            body: {
              expiry: Number(v.expiry),
              notice: Number(v.notice),
              extension: Number(v.extension),
              milestone: Number(v.milestone),
            },
          })
            .then(() => setNote('Saved. Scheduled alerts have been moved.'))
            .catch((x) => setError(message(x)))
            .finally(() => setBusy(false));
        }}
      >
        {field(
          'notice',
          'Notice alert (days before the notice deadline)',
          'With 90 days notice and 60 here, the alert goes out 150 days before the end.',
        )}
        {field('expiry', 'Expiry alert (days before the end)', 'A last warning before the contract ends.')}
        {field(
          'extension',
          'Extension decision (days before the notice deadline)',
          'When to decide whether to take up an option.',
        )}
        {field('milestone', 'Milestone reminder (days before)', 'Ahead of each milestone date.')}
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy}>
            Save timing
          </Button>
        </div>
        {note && (
          <p
            role="status"
            className="text-sm font-medium text-success sm:col-span-2"
            data-testid="alert-settings-note"
          >
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-error sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
