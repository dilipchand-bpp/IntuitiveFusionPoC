'use client';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Field, Input, Select, Table, Td, Th, type BadgeTone } from '@if/ui';
import { ROLE_NAMES } from '@if/shared';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import type { ProcurementTable } from '@/components/reports/types';
import { formatDateTime } from '@/lib/labels';

interface Policy {
  id: string;
  name: string;
  effect: 'DENY' | 'ALLOW';
  subjectType: 'ROLE' | 'USER';
  subjectLabel: string;
  action: string;
  selector: Record<string, unknown>;
  conditions: Record<string, unknown>;
  reason: string;
  priority: number;
  status: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'DELETED';
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
}
interface Simulation {
  person: { name: string; roles: string[] };
  procurement: { number: string; title: string; tags: string[] };
  defaultAllowed: boolean;
  defaultNote: string;
  decision: 'ALLOW' | 'DENY';
  decidedBy: 'DEFAULT' | 'DENY_OVERRIDE' | 'ALLOW_GRANT';
  policy: { name: string; effect: string; reason: string } | null;
  evaluated: Array<{ id: string; name: string; effect: string; applies: boolean; why: string }>;
}
interface User {
  id: string;
  name: string;
  email: string;
}
interface Tag {
  id: string;
  requestId: string;
  tag: string;
  number: string;
  title: string;
}

const STATUS_TONE: Record<Policy['status'], BadgeTone> = {
  ACTIVE: 'success',
  DISABLED: 'neutral',
  EXPIRED: 'warning',
  DELETED: 'neutral',
};
const ACTIONS = ['view', 'edit', 'approve', 'export'] as const;
const STAFF = ROLE_NAMES.filter((r) => r !== 'SUPPLIER');
const describe = (p: Policy) => {
  const bits: string[] = [];
  const s = p.selector as { businessUnit?: string; minValue?: number; tag?: string; supplierId?: string };
  if (s.businessUnit) bits.push(`unit ${s.businessUnit}`);
  if (s.minValue !== undefined) bits.push(`value above AUD ${s.minValue.toLocaleString('en-AU')}`);
  if (s.tag) bits.push(`tagged ${s.tag}`);
  if (s.supplierId) bits.push('one supplier');
  const c = p.conditions as { timeWindow?: { startHour: number; endHour: number }; requiresMfa?: boolean };
  if (c.timeWindow) bits.push(`${c.timeWindow.startHour}:00 to ${c.timeWindow.endHour}:00`);
  if (c.requiresMfa) bits.push('MFA');
  return bits.length ? bits.join(', ') : 'every procurement';
};

/** Access policies that override the default hierarchy, the what-can-this-person-see simulator, and the tags policies select on (SEC-AC09). */
export function AccessPoliciesPanel({ csrf }: { csrf: string }) {
  const [inactive, setInactive] = useState(false);
  const policies = useData<{ items: Policy[] }>(`/access/policies?includeInactive=${inactive}`);
  const users = useData<User[]>('/admin/users');
  const procs = useData<ProcurementTable>('/reports/procurements');
  const tags = useData<{ items: Tag[] }>('/access/tags');
  const { busy, run, messages } = useRun();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [f, setF] = useState({
    name: '',
    effect: 'DENY',
    subjectType: 'ROLE',
    subject: 'EXEC',
    action: 'view',
    businessUnit: '',
    minValue: '',
    tag: '',
    startHour: '',
    endHour: '',
    requiresMfa: false,
    reason: '',
    priority: '100',
    expiresAt: '',
  });
  const [sim, setSim] = useState({ userId: '', requestId: '', action: 'view', mfa: false });
  const [result, setResult] = useState<Simulation | null>(null);
  const [tagForm, setTagForm] = useState({ requestId: '', tag: '' });
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });

  const create = () =>
    run(
      'create',
      async () => {
        const selector: Record<string, unknown> = {};
        if (f.businessUnit.trim()) selector.businessUnit = f.businessUnit.trim();
        if (f.minValue.trim()) selector.minValue = Number(f.minValue);
        if (f.tag.trim()) selector.tag = f.tag.trim();
        const conditions: Record<string, unknown> = {};
        if (f.startHour !== '' && f.endHour !== '')
          conditions.timeWindow = { startHour: Number(f.startHour), endHour: Number(f.endHour) };
        if (f.requiresMfa) conditions.requiresMfa = true;
        await send(csrf, 'POST', '/access/policies', {
          name: f.name.trim(),
          effect: f.effect,
          subjectType: f.subjectType,
          subject: f.subject,
          action: f.action,
          selector,
          conditions,
          reason: f.reason.trim(),
          priority: Number(f.priority),
          ...(f.expiresAt ? { expiresAt: new Date(f.expiresAt).toISOString() } : {}),
        });
        await policies.reload();
      },
      'Policy created and audited.',
    );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card role="region" aria-labelledby="pol-h">
        <h2 id="pol-h" className="font-heading text-xl font-bold">
          How policies work
        </h2>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          The role rules decide who sees what by default. A policy is checked as well. A denial always wins:
          it hides a procurement from someone the role rules would show it to, and nothing overrides it. A
          grant lets a named person or role see what the role rules hide, and it never beats a denial.
          Policies can narrow to a business unit, a value, a tag, a time window or MFA, and can expire. Every
          decision that changes an outcome is in the audit trail. Grants widen the lists and reports built
          from the role rules (procurement table, spend, search, progress, repository, assistant); they do not
          open each record&apos;s own page, which still follows the role rules. Denials also apply to a
          record&apos;s own page and to exports.
        </p>
      </Card>

      <section aria-labelledby="list-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="list-h" className="font-heading text-xl font-bold">
            Policies
          </h2>
          <Checkbox
            label="Show disabled, expired and deleted"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
        </div>
        {policies.error && (
          <p role="alert" className="text-sm font-medium text-error">
            {policies.error}
          </p>
        )}
        <Table caption="Access policies">
          <thead>
            <tr>
              <Th>Policy</Th>
              <Th>Who and what</Th>
              <Th>Status</Th>
              <Th>Change</Th>
            </tr>
          </thead>
          <tbody>
            {(policies.data?.items ?? []).map((p) => (
              <tr key={p.id} data-testid="policy-row" data-status={p.status}>
                <Td label="Policy">
                  <strong>{p.name}</strong>
                  <span className="block text-xs text-text-muted">Why: {p.reason}</span>
                  <span className="block text-xs text-text-muted">
                    By {p.createdBy ?? 'unknown'}, {formatDateTime(p.createdAt)}
                  </span>
                </Td>
                <Td label="Who and what">
                  <Badge tone={p.effect === 'DENY' ? 'error' : 'info'}>
                    {p.effect === 'DENY' ? 'Deny' : 'Allow'}
                  </Badge>{' '}
                  {p.subjectLabel} to {p.action}: {describe(p)}
                  {p.expiresAt && (
                    <span className="block text-xs text-text-muted">
                      Expires {formatDateTime(p.expiresAt)}
                    </span>
                  )}
                </Td>
                <Td label="Status">
                  <Badge tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Badge>
                </Td>
                <Td label="Change">
                  {p.status === 'ACTIVE' ? (
                    <div className="flex flex-col gap-2 text-left">
                      <Field label="Reason">
                        <Input
                          value={reasons[p.id] ?? ''}
                          maxLength={500}
                          onChange={(e) => setReasons((x) => ({ ...x, [p.id]: e.target.value }))}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          disabled={(reasons[p.id] ?? '').trim().length < 5 || busy !== null}
                          loading={busy === `dis-${p.id}`}
                          onClick={() =>
                            void run(`dis-${p.id}`, async () => {
                              await send(csrf, 'POST', `/access/policies/${p.id}/disable`, {
                                reason: reasons[p.id]!.trim(),
                              });
                              await policies.reload();
                            })
                          }
                        >
                          Disable
                        </Button>
                        <Button
                          variant="danger"
                          disabled={(reasons[p.id] ?? '').trim().length < 5 || busy !== null}
                          loading={busy === `del-${p.id}`}
                          onClick={() =>
                            void run(`del-${p.id}`, async () => {
                              await send(csrf, 'DELETE', `/access/policies/${p.id}`, {
                                reason: reasons[p.id]!.trim(),
                              });
                              await policies.reload();
                            })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    '–'
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <Card role="region" aria-labelledby="new-h">
        <h2 id="new-h" className="font-heading text-xl font-bold">
          New policy
        </h2>
        <form
          className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label="Name" required>
            <Input value={f.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Effect">
            <Select value={f.effect} onChange={(e) => set('effect', e.target.value)}>
              <option value="DENY">Deny (always wins)</option>
              <option value="ALLOW">Allow (a named grant)</option>
            </Select>
          </Field>
          <Field label="Action">
            <Select value={f.action} onChange={(e) => set('action', e.target.value)}>
              {ACTIONS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
          </Field>
          <Field label="Applies to">
            <Select
              value={f.subjectType}
              onChange={(e) =>
                setF({
                  ...f,
                  subjectType: e.target.value,
                  subject: e.target.value === 'ROLE' ? 'EXEC' : (users.data?.[0]?.id ?? ''),
                })
              }
            >
              <option value="ROLE">A role</option>
              <option value="USER">One person</option>
            </Select>
          </Field>
          <Field label={f.subjectType === 'ROLE' ? 'Role' : 'Person'}>
            <Select value={f.subject} onChange={(e) => set('subject', e.target.value)}>
              {f.subjectType === 'ROLE'
                ? STAFF.map((r) => <option key={r}>{r}</option>)
                : (users.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
            </Select>
          </Field>
          <Field label="Priority" hint="Lower is checked first (1 to 1000).">
            <Input type="number" value={f.priority} onChange={(e) => set('priority', e.target.value)} />
          </Field>
          <Field label="Business unit" hint="Leave empty for any.">
            <Input value={f.businessUnit} onChange={(e) => set('businessUnit', e.target.value)} />
          </Field>
          <Field label="Value above (AUD)">
            <Input type="number" value={f.minValue} onChange={(e) => set('minValue', e.target.value)} />
          </Field>
          <Field label="Tag" hint="For example hr-sensitive.">
            <Input value={f.tag} onChange={(e) => set('tag', e.target.value)} />
          </Field>
          <Field label="In force from hour" hint="0 to 23, Sydney time. Leave both empty for always.">
            <Input type="number" value={f.startHour} onChange={(e) => set('startHour', e.target.value)} />
          </Field>
          <Field label="…until hour" hint="1 to 24.">
            <Input type="number" value={f.endHour} onChange={(e) => set('endHour', e.target.value)} />
          </Field>
          <Field label="Expires" hint="Optional.">
            <Input
              type="datetime-local"
              value={f.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Checkbox
              label="Needs MFA (a denial lifts, a grant needs it)"
              checked={f.requiresMfa}
              onChange={(e) => set('requiresMfa', e.target.checked)}
            />
          </div>
          <div className="md:col-span-2">
            <Field label="Reason" required hint="At least five characters. Kept with the policy.">
              <Input value={f.reason} maxLength={500} onChange={(e) => set('reason', e.target.value)} />
            </Field>
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              loading={busy === 'create'}
              disabled={f.name.trim().length < 3 || f.reason.trim().length < 5 || busy !== null}
            >
              Create policy
            </Button>
          </div>
        </form>
        {messages}
      </Card>

      <Card role="region" aria-labelledby="sim-h">
        <h2 id="sim-h" className="font-heading text-xl font-bold">
          What can this person see?
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <Field label="Person">
            <Select value={sim.userId} onChange={(e) => setSim({ ...sim, userId: e.target.value })}>
              <option value="">Choose…</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Procurement">
            <Select value={sim.requestId} onChange={(e) => setSim({ ...sim, requestId: e.target.value })}>
              <option value="">Choose…</option>
              {(procs.data?.items ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} {r.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action">
            <Select value={sim.action} onChange={(e) => setSim({ ...sim, action: e.target.value })}>
              {ACTIONS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Checkbox
              label="Session verified with MFA"
              checked={sim.mfa}
              onChange={(e) => setSim({ ...sim, mfa: e.target.checked })}
            />
          </div>
        </div>
        <Button
          className="mt-3"
          variant="secondary"
          loading={busy === 'sim'}
          disabled={!sim.userId || !sim.requestId || busy !== null}
          onClick={() =>
            void run('sim', async () => {
              setResult(
                await send<Simulation>(csrf, 'POST', '/access/policies/simulate', {
                  userId: sim.userId,
                  requestId: sim.requestId,
                  action: sim.action,
                  mfaVerified: sim.mfa,
                }),
              );
            })
          }
        >
          Simulate
        </Button>
        {result && (
          <div
            className="mt-4 flex flex-col gap-2"
            role="status"
            data-testid="sim-result"
            data-decision={result.decision}
          >
            <p className="text-sm">
              <Badge tone={result.decision === 'ALLOW' ? 'success' : 'error'}>
                {result.decision === 'ALLOW' ? 'Allowed' : 'Denied'}
              </Badge>{' '}
              {result.person.name} ({result.person.roles.join(', ')}) and {result.procurement.number}{' '}
              {result.procurement.title}:{' '}
              {result.decidedBy === 'DEFAULT'
                ? 'the role rules decide; no policy changes the outcome.'
                : result.decidedBy === 'DENY_OVERRIDE'
                  ? `the policy "${result.policy?.name}" denies it.`
                  : `the policy "${result.policy?.name}" grants it.`}
            </p>
            <p className="text-xs text-text-muted">
              {result.defaultNote} Role rules alone: {result.defaultAllowed ? 'allowed' : 'not allowed'}.
            </p>
            <ul className="list-disc pl-6 text-sm">
              {result.evaluated.map((e) => (
                <li key={e.id}>
                  {e.name} ({e.effect.toLowerCase()}): {e.applies ? 'applies' : 'does not apply'}. {e.why}.
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card role="region" aria-labelledby="tag-h">
        <h2 id="tag-h" className="font-heading text-xl font-bold">
          Tags
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          A tag labels a procurement so a policy can select it, for example hr-sensitive.
        </p>
        <ul className="mt-3 flex flex-col gap-2" aria-label="Tagged procurements">
          {(tags.data?.items ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="info">{t.tag}</Badge>
              {t.number} {t.title}
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  void run(`rm-${t.id}`, async () => {
                    await send(csrf, 'DELETE', `/access/tags/${t.id}`);
                    await tags.reload();
                  })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <Field label="Procurement">
            <Select
              value={tagForm.requestId}
              onChange={(e) => setTagForm({ ...tagForm, requestId: e.target.value })}
            >
              <option value="">Choose…</option>
              {(procs.data?.items ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} {r.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tag" hint="Lower-case letters, digits and dashes.">
            <Input value={tagForm.tag} onChange={(e) => setTagForm({ ...tagForm, tag: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              loading={busy === 'tag'}
              disabled={!tagForm.requestId || tagForm.tag.length < 2 || busy !== null}
              onClick={() =>
                void run(
                  'tag',
                  async () => {
                    await send(csrf, 'POST', '/access/tags', tagForm);
                    setTagForm({ requestId: '', tag: '' });
                    await tags.reload();
                  },
                  'Tag added.',
                )
              }
            >
              Add tag
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
