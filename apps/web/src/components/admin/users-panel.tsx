'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Dialog, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  orgUnit: string | null;
  orgUnitId: string | null;
  active: boolean;
  roles: string[];
  awaitingActivation: boolean;
}
export interface OrgUnit {
  id: string;
  name: string;
}

const ROLES: Array<[string, string]> = [
  ['REQUESTER', 'Requester'],
  ['PROCUREMENT', 'Procurement lead'],
  ['DELEGATE', 'Delegate'],
  ['EVALUATOR', 'Evaluator'],
  ['CHAIR', 'Panel chair'],
  ['LEGAL', 'Legal'],
  ['CONTRACT_MGR', 'Contract manager'],
  ['PROBITY', 'Probity advisor'],
  ['FINANCE', 'Finance'],
  ['EXEC', 'Executive'],
  ['ADMIN', 'Administrator'],
];
const LABEL = Object.fromEntries(ROLES);
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** Administrator is exclusive: choosing it clears the others, and choosing any other clears it. */
function toggle(roles: string[], role: string): string[] {
  if (role === 'ADMIN') return roles.includes('ADMIN') ? [] : ['ADMIN'];
  const without = roles.filter((r) => r !== 'ADMIN');
  return without.includes(role) ? without.filter((r) => r !== role) : [...without, role];
}

function RolePicker({
  value,
  onChange,
  name,
}: {
  value: string[];
  onChange: (r: string[]) => void;
  name: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold">Roles</legend>
      <p className="text-sm text-text-muted">
        The administrator role cannot be combined with any other: it never reads bids or approves.
      </p>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {ROLES.map(([k, v]) => (
          <label key={k} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={value.includes(k)}
              onChange={() => onChange(toggle(value, k))}
              aria-label={`${v} (${name})`}
            />
            {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** People and what they may do. A change of roles or a switch-off ends the person's sessions at once. */
export function UsersPanel({
  initial,
  units,
  csrf,
  meId,
}: {
  initial: AdminUser[];
  units: OrgUnit[];
  csrf: string;
  meId: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initial);
  const [dialog, setDialog] = useState<null | 'add' | 'edit'>(null);
  const [form, setForm] = useState({
    id: '',
    name: '',
    email: '',
    roles: [] as string[],
    orgUnitId: '',
    active: true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const reload = async () => setUsers(await api<AdminUser[]>('/admin/users'));
  const fullLink = (path: string) => `${window.location.origin}${path}`;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      await reload();
      router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  function close(o: boolean) {
    if (!o) {
      setDialog(null);
      setLink(null);
      setError(null);
    }
  }

  return (
    <section aria-labelledby="users-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="users-h" className="font-heading text-xl font-bold">
          People
        </h2>
        <Button
          className="ml-auto"
          onClick={() => {
            setForm({ id: '', name: '', email: '', roles: ['REQUESTER'], orgUnitId: '', active: true });
            setError(null);
            setLink(null);
            setDialog('add');
          }}
        >
          Add a person
        </Button>
      </div>
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
          data-testid="users-note"
        >
          {note}
        </p>
      )}
      {error && !dialog && (
        <p
          role="alert"
          className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          {error}
        </p>
      )}
      <Table caption="Staff users">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Roles</Th>
            <Th>Unit</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} data-testid="user-row">
              <Td label="Name" className="font-semibold">
                {u.name}
                {u.id === meId && <span className="ml-2 text-xs font-normal text-text-muted">(you)</span>}
              </Td>
              <Td label="Email" className="break-all text-xs">
                {u.email}
              </Td>
              <Td label="Roles">{u.roles.map((r) => LABEL[r] ?? r).join(', ')}</Td>
              <Td label="Unit">{u.orgUnit ?? '–'}</Td>
              <Td label="Status">
                {!u.active ? (
                  <Badge tone="neutral">Switched off</Badge>
                ) : u.awaitingActivation ? (
                  <Badge tone="warning">Waiting to activate</Badge>
                ) : (
                  <Badge tone="success">Active</Badge>
                )}
              </Td>
              <Td label="Actions">
                <Button
                  variant="secondary"
                  aria-label={`Edit ${u.name}`}
                  onClick={() => {
                    setForm({
                      id: u.id,
                      name: u.name,
                      email: u.email,
                      roles: u.roles,
                      orgUnitId: u.orgUnitId ?? '',
                      active: u.active,
                    });
                    setError(null);
                    setLink(null);
                    setDialog('edit');
                  }}
                >
                  Edit
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Dialog
        open={dialog === 'add'}
        onOpenChange={close}
        title="Add a person"
        description="They set their own password with a one-time link that lasts 7 days. The link is shown once."
        footer={
          link ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                loading={busy === 'add'}
                disabled={form.name.trim().length < 2 || !form.email.includes('@') || form.roles.length === 0}
                onClick={() =>
                  void run('add', async () => {
                    const r = await api<{ activationPath: string }>('/admin/users', {
                      method: 'POST',
                      csrf,
                      body: {
                        name: form.name,
                        email: form.email,
                        roles: form.roles,
                        ...(form.orgUnitId ? { orgUnitId: form.orgUnitId } : {}),
                      },
                    });
                    setLink(fullLink(r.activationPath));
                  })
                }
              >
                Add person
              </Button>
            </>
          )
        }
      >
        {link ? (
          <div className="flex flex-col gap-2" data-testid="user-link">
            <p className="text-sm font-semibold">Send this link to {form.name}. It is shown only now.</p>
            <input
              readOnly
              aria-label="Activation link"
              value={link}
              className="w-full rounded-md border border-border-strong bg-surface-alt p-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="text-xs text-text-muted">
              The proof of concept sends no email, so pass the link on yourself.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Work email" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Organisation unit">
              <Select
                value={form.orgUnitId}
                onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
              >
                <option value="">None</option>
                {units.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <RolePicker
              name="new person"
              value={form.roles}
              onChange={(roles) => setForm({ ...form, roles })}
            />
            {error && (
              <p role="alert" className="text-sm font-medium text-error">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={dialog === 'edit'}
        onOpenChange={close}
        title={`Edit ${form.name}`}
        description={
          form.id === meId
            ? 'You cannot change your own roles or switch yourself off.'
            : 'A change of roles or a switch-off ends their sessions at once.'
        }
        footer={
          link ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                loading={busy === 'edit'}
                disabled={form.name.trim().length < 2 || form.roles.length === 0}
                onClick={() =>
                  void run('edit', async () => {
                    const self = form.id === meId;
                    await api(`/admin/users/${form.id}`, {
                      method: 'PUT',
                      csrf,
                      body: {
                        name: form.name,
                        orgUnitId: form.orgUnitId || null,
                        ...(self ? {} : { roles: form.roles, active: form.active }),
                      },
                    });
                    setNote(`${form.name} was updated.`);
                    setDialog(null);
                  })
                }
              >
                Save changes
              </Button>
            </>
          )
        }
      >
        {link ? (
          <div className="flex flex-col gap-2" data-testid="user-link">
            <p className="text-sm font-semibold">
              New link for {form.name}. Earlier links no longer work. It is shown only now.
            </p>
            <input
              readOnly
              aria-label="Activation link"
              value={link}
              className="w-full rounded-md border border-border-strong bg-surface-alt p-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <p className="text-sm text-text-muted">{form.email}</p>
            <Field label="Organisation unit">
              <Select
                value={form.orgUnitId}
                onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
              >
                <option value="">None</option>
                {units.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            {form.id !== meId && (
              <>
                <RolePicker
                  name={form.name}
                  value={form.roles}
                  onChange={(roles) => setForm({ ...form, roles })}
                />
                <label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--if-color-accent)]"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                  Can sign in
                </label>
              </>
            )}
            <div>
              <Button
                variant="ghost"
                loading={busy === 'link'}
                onClick={() =>
                  void run('link', async () => {
                    const r = await api<{ activationPath: string }>(
                      `/admin/users/${form.id}/activation-link`,
                      { method: 'POST', csrf },
                    );
                    setLink(fullLink(r.activationPath));
                  })
                }
              >
                Issue a new activation link
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-error">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </section>
  );
}
