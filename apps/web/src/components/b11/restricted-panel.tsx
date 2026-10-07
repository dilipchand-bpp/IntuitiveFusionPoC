'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Select, Table, Td, Textarea, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface Project {
  requestId: string;
  number: string | null;
  title: string | null;
  reason: string;
  restrictedAt: string;
  restrictedBy: string | null;
  delegates: Array<{ userId: string; name: string }>;
}
interface Req {
  id: string;
  number: string;
  title: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

/** Restricted projects (FR-0865): the ones the caller belongs to, and the form to restrict another. */
export function RestrictedPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const list = useData<Project[]>('/security/restricted-projects');
  const reqs = useData<{ items: Req[] }>('/requests?limit=100');
  const canSet = has(roles, 'PROCUREMENT', 'EXEC');
  const run = useRun();
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  if (list.error && !list.data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {list.error}
      </p>
    );
  if (!list.data) return <p className="text-sm text-text-muted">Loading…</p>;
  const restricted = new Set(list.data.map((p) => p.requestId));
  const choices = (reqs.data?.items ?? []).filter((r) => !restricted.has(r.id));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <h2 className="font-heading text-xl font-bold">Projects in your sourcing group</h2>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Only the requester, the assigned procurement manager, the panel, the allocated probity adviser and
          named delegates can see that a restricted project exists. Everyone else gets “not found”, in lists,
          search, reports, notifications and the audit trail.
        </p>
        {list.data.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted" data-testid="restricted-empty">
            You belong to no restricted project.
          </p>
        ) : (
          <div className="mt-4">
            <Table caption="Restricted projects">
              <thead>
                <tr>
                  <Th>Procurement</Th>
                  <Th>Reason</Th>
                  <Th>Restricted</Th>
                  <Th>Delegates</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.requestId} data-testid="restricted-row">
                    <Td label="Procurement">
                      <Badge tone="warning">Restricted</Badge> {p.number} {p.title}
                    </Td>
                    <Td label="Reason">{p.reason}</Td>
                    <Td label="Restricted">
                      {when(p.restrictedAt)} by {p.restrictedBy ?? 'unknown'}
                    </Td>
                    <Td label="Delegates">{p.delegates.map((d) => d.name).join(', ') || 'none'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {canSet && (
        <Card>
          <h2 className="font-heading text-xl font-bold">Restrict a procurement</h2>
          <form
            className="mt-4 flex max-w-xl flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run.run(
                'restrict',
                async () => {
                  await send(csrf, 'POST', `/requests/${id}/restrict`, { reason });
                  setId('');
                  setReason('');
                  await list.reload();
                },
                'The procurement is now a restricted project and its text is encrypted.',
              );
            }}
          >
            <Field label="Procurement" required>
              <Select value={id} onChange={(e) => setId(e.target.value)}>
                <option value="">Choose a procurement</option>
                {choices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} {r.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" hint="At least 10 characters. It is kept in the audit trail." required>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button
              type="submit"
              loading={run.busy === 'restrict'}
              disabled={!id || reason.trim().length < 10 || run.busy !== null}
            >
              Restrict this project
            </Button>
            {run.messages}
          </form>
        </Card>
      )}
    </div>
  );
}
