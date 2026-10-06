'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface Handling {
  processedIn: string;
  retention: string;
  retained: boolean;
  usedForTraining: boolean;
  inCountry: boolean;
}
interface Approval {
  state: 'BUILT_IN' | 'NOT_REQUESTED' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  id?: string;
  requestedBy?: string | null;
  requestReason?: string | null;
  decidedBy?: string | null;
  reason?: string | null;
  decidedAt?: string | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
}
interface ModelRow {
  id: string;
  provider: string;
  label: string;
  simulated: boolean;
  builtIn: boolean;
  dataHandling: Handling;
  approval: Approval;
  active: boolean;
  canActivate: boolean;
}
interface Catalogue {
  activeModel: string;
  taskOverrides: Record<string, string>;
  models: ModelRow[];
}

const STATE: Record<
  Approval['state'],
  { text: string; tone: 'success' | 'warning' | 'neutral' | 'error' | 'info' }
> = {
  BUILT_IN: { text: 'Built in, always approved', tone: 'success' },
  NOT_REQUESTED: { text: 'Not approved', tone: 'neutral' },
  REQUESTED: { text: 'Waiting for a decision', tone: 'warning' },
  APPROVED: { text: 'Approved', tone: 'success' },
  REJECTED: { text: 'Rejected', tone: 'error' },
  REVOKED: { text: 'Approval revoked', tone: 'error' },
};
const yn = (b: boolean) => (b ? 'Yes' : 'No');

/** AI models for the organisation: the catalogue, the two-person approval workflow and the active model (NFR-C01, NFR-M06, SEC-TP07). */
export function AiModelsPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const { data, error, reload } = useData<Catalogue>('/ai/models');
  const { busy, run, messages } = useRun();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const canRequest = has(roles, 'ADMIN', 'PROCUREMENT');
  const canDecide = has(roles, 'PROBITY', 'EXEC');
  const canRevoke = has(roles, 'ADMIN', 'PROBITY', 'EXEC');
  const canSwitch = has(roles, 'ADMIN');

  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading models…</p>;
  const active = data.models.find((m) => m.active)!;
  const reason = (id: string) => (reasons[id] ?? '').trim();
  const act = (name: string, fn: () => Promise<unknown>, ok: string) =>
    run(
      name,
      async () => {
        await fn();
        await reload();
      },
      ok,
    );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Active model</h2>
          <Badge tone="info">{active.simulated ? 'Simulated' : 'Live'}</Badge>
        </div>
        <p className="mt-2 text-sm" data-testid="active-model">
          Answers and recommendations are produced by <strong>{active.id}</strong> ({active.label}).
        </p>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          A model from an outside provider can be switched on only after it has been approved for this
          organisation, by two different people: one asks (an administrator or procurement) and probity or an
          executive decides. Withdrawing an approval puts the organisation back on the built-in model at once.
          Switching is a setting, so it needs no release or restart. Every model here is simulated.
        </p>
        {Object.keys(data.taskOverrides).length > 0 && (
          <p className="mt-2 text-sm text-text-muted">
            Chosen for one task:{' '}
            {Object.entries(data.taskOverrides)
              .map(([k, v]) => `${k} uses ${v}`)
              .join('; ')}
            .
          </p>
        )}
        {messages}
      </Card>

      <ul className="grid gap-4 lg:grid-cols-3" aria-label="AI models">
        {data.models.map((m) => {
          const st = STATE[m.approval.state];
          const rid = m.approval.id ?? m.id;
          return (
            <li key={m.id} data-testid="ai-model-card" data-model={m.id}>
              <Card className="flex h-full flex-col gap-3">
                <div>
                  <h3 className="font-heading text-lg font-bold">{m.label}</h3>
                  <p className="font-mono text-xs text-text-muted">{m.id}</p>
                  <p className="text-sm text-text-muted">{m.provider}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={st.tone}>
                    <span data-testid="approval-state" data-state={m.approval.state}>
                      {st.text}
                    </span>
                  </Badge>
                  {m.active && <Badge tone="info">Active</Badge>}
                  {m.simulated && <Badge tone="neutral">Simulated</Badge>}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-text-muted">Processed in</dt>
                  <dd>{m.dataHandling.processedIn}</dd>
                  <dt className="text-text-muted">Retention</dt>
                  <dd>{m.dataHandling.retention}</dd>
                  <dt className="text-text-muted">Used to train</dt>
                  <dd>{yn(m.dataHandling.usedForTraining)}</dd>
                  <dt className="text-text-muted">In country</dt>
                  <dd>{yn(m.dataHandling.inCountry)}</dd>
                </dl>
                {m.approval.requestedBy && (
                  <p className="text-sm text-text-muted">
                    Requested by {m.approval.requestedBy}
                    {m.approval.requestReason ? `: “${m.approval.requestReason}”` : ''}.
                    {m.approval.decidedBy &&
                      ` ${m.approval.state === 'REJECTED' ? 'Rejected' : 'Approved'} by ${m.approval.decidedBy}${m.approval.reason ? `: “${m.approval.reason}”` : ''}.`}
                    {m.approval.revokedBy &&
                      ` Revoked by ${m.approval.revokedBy}${m.approval.revokeReason ? `: “${m.approval.revokeReason}”` : ''}.`}
                  </p>
                )}
                {!m.builtIn && (
                  <div className="mt-auto flex flex-col gap-2">
                    {(canRequest || canDecide || canRevoke) &&
                      ['NOT_REQUESTED', 'REJECTED', 'REVOKED', 'REQUESTED', 'APPROVED'].includes(
                        m.approval.state,
                      ) && (
                        <Field label="Reason" hint="At least three characters. Kept with the decision.">
                          <Input
                            value={reasons[m.id] ?? ''}
                            maxLength={500}
                            onChange={(e) => setReasons((x) => ({ ...x, [m.id]: e.target.value }))}
                          />
                        </Field>
                      )}
                    <div className="flex flex-wrap gap-2">
                      {canRequest && ['NOT_REQUESTED', 'REJECTED', 'REVOKED'].includes(m.approval.state) && (
                        <Button
                          variant="secondary"
                          loading={busy === `req-${m.id}`}
                          disabled={reason(m.id).length < 3 || busy !== null}
                          onClick={() =>
                            void act(
                              `req-${m.id}`,
                              () =>
                                send(csrf, 'POST', `/ai/models/${m.id}/request-approval`, {
                                  reason: reason(m.id),
                                }),
                              `Approval requested for ${m.label}. Probity or an executive now decides.`,
                            )
                          }
                        >
                          Request approval
                        </Button>
                      )}
                      {canDecide && m.approval.state === 'REQUESTED' && (
                        <>
                          <Button
                            loading={busy === `ok-${m.id}`}
                            disabled={reason(m.id).length < 3 || busy !== null}
                            onClick={() =>
                              void act(
                                `ok-${m.id}`,
                                () =>
                                  send(csrf, 'POST', `/ai/approvals/${rid}/decision`, {
                                    decision: 'APPROVE',
                                    reason: reason(m.id),
                                  }),
                                `${m.label} approved. An administrator can now switch it on.`,
                              )
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            loading={busy === `no-${m.id}`}
                            disabled={reason(m.id).length < 3 || busy !== null}
                            onClick={() =>
                              void act(
                                `no-${m.id}`,
                                () =>
                                  send(csrf, 'POST', `/ai/approvals/${rid}/decision`, {
                                    decision: 'REJECT',
                                    reason: reason(m.id),
                                  }),
                                `${m.label} rejected.`,
                              )
                            }
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {canRevoke && m.approval.state === 'APPROVED' && (
                        <Button
                          variant="danger"
                          loading={busy === `rev-${m.id}`}
                          disabled={reason(m.id).length < 3 || busy !== null}
                          onClick={() =>
                            void act(
                              `rev-${m.id}`,
                              () => send(csrf, 'POST', `/ai/models/${m.id}/revoke`, { reason: reason(m.id) }),
                              `Approval for ${m.label} revoked; the organisation is back on the built-in model.`,
                            )
                          }
                        >
                          Revoke approval
                        </Button>
                      )}
                    </div>
                    {m.approval.state === 'REQUESTED' && !canDecide && (
                      <p className="text-sm text-text-muted">Probity or an executive decides this request.</p>
                    )}
                  </div>
                )}
                {canSwitch && !m.active && (
                  <Button
                    className="mt-auto"
                    loading={busy === `use-${m.id}`}
                    disabled={!m.canActivate || busy !== null}
                    onClick={() =>
                      void act(
                        `use-${m.id}`,
                        () => send(csrf, 'PUT', '/ai/active-model', { activeModel: m.id }),
                        `${m.label} is now the active model.`,
                      )
                    }
                  >
                    {m.canActivate ? 'Make active' : 'Approve before switching on'}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
