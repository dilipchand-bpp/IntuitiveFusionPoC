'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface Ev {
  id: string;
  eventId: string;
  type: string;
  direction: 'IN' | 'OUT';
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD_LETTER';
  attempts: number;
  lastError: string | null;
  at: string;
}
interface Matter {
  id: string;
  title: string;
  externalRef: string | null;
  lane: string;
  stage: string | null;
  closedAt: string | null;
  outcome: string | null;
  documents: Array<{ id: string; name: string; kind: string | null; attachedAt: string }>;
  events: Ev[];
}
interface View {
  connector: { provider: string; enabled: boolean; health: string } | null;
  matters: Matter[];
}
interface Sim {
  httpStatus: number;
  result: { accepted?: boolean; duplicate?: boolean; status?: string; error?: string };
}

const TONE = { PENDING: 'neutral', DELIVERED: 'success', FAILED: 'warning', DEAD_LETTER: 'error' } as const;
const TYPE_LABEL: Record<string, string> = {
  MATTER_STAGE_CHANGED: 'Stage changed',
  DOCUMENT_ATTACHED: 'Document attached',
  MATTER_CLOSED: 'Matter closed',
  MATTER_STATUS_UPDATE: 'Status sent',
  MATTER_INITIATED: 'Matter raised',
  LEGAL_WEBHOOK: 'Redlines received',
};

/** Where the customer's legal system says each matter on this contract stands, and the event history (NFR-C03). */
export function LegalSyncCard({
  contractId,
  csrf,
  roles,
}: {
  contractId: string;
  csrf: string;
  roles: readonly string[];
}) {
  const v = useData<View>(`/contracts/${contractId}/legal-sync`);
  const { busy, run, messages } = useRun();
  const [type, setType] = useState('MATTER_STAGE_CHANGED');
  const [stage, setStage] = useState('Legal review');
  const [sim, setSim] = useState<Sim | null>(null);
  if (!v.data || v.data.matters.length === 0) return null;
  const canSim = has([...roles], 'ADMIN', 'LEGAL');
  const canSend = has([...roles], 'ADMIN', 'LEGAL', 'PROCUREMENT');
  return (
    <Card role="region" aria-labelledby="ls-h" data-testid="legal-sync">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="ls-h" className="font-heading text-xl font-bold">
          Legal system status
        </h2>
        <Badge tone="info">SIMULATED</Badge>
        {v.data.connector && (
          <span className="text-sm text-text-muted">
            {v.data.connector.provider}:{' '}
            {v.data.connector.enabled ? v.data.connector.health.toLowerCase() : 'switched off'}
          </span>
        )}
      </div>
      {v.data.matters.map((m) => (
        <div key={m.id} className="mt-3 rounded-md border border-border p-3" data-testid="legal-sync-matter">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{m.title}</span>
            <span className="font-mono text-xs">{m.externalRef ?? 'not yet in the legal system'}</span>
            <Badge tone={m.closedAt ? 'success' : 'neutral'}>
              <span data-testid="legal-sync-stage">{m.stage ?? 'No stage reported'}</span>
            </Badge>
            {m.outcome && <span className="text-text-muted">Outcome: {m.outcome}</span>}
          </p>
          {m.documents.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm" data-testid="legal-sync-docs">
              {m.documents.map((d) => (
                <li key={d.id}>
                  {d.name} {d.kind ? <span className="text-text-muted">({d.kind.toLowerCase()})</span> : null}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-3 text-sm font-semibold">Event history</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm" data-testid="legal-sync-events">
            {m.events.length === 0 && <li className="text-text-muted">No events yet.</li>}
            {m.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[e.status]}>
                  {e.status === 'DEAD_LETTER' ? 'Dead letter' : e.status.toLowerCase()}
                </Badge>
                <span>
                  {e.direction === 'IN' ? 'From legal' : 'To legal'}: {TYPE_LABEL[e.type] ?? e.type}
                </span>
                {e.attempts > 1 && <span className="text-text-muted">{e.attempts} attempts</span>}
                {e.lastError && <span className="text-warning">{e.lastError}</span>}
                {canSim && e.direction === 'IN' && (e.status === 'FAILED' || e.status === 'DEAD_LETTER') && (
                  <Button
                    variant="secondary"
                    loading={busy === e.id}
                    onClick={() =>
                      void run(e.id, async () => {
                        await send(csrf, 'POST', `/integrations/legal/events/${e.id}/reprocess`);
                        await v.reload();
                      })
                    }
                  >
                    Reprocess
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canSend && (
            <div className="mt-3">
              <Button
                variant="secondary"
                loading={busy === `send-${m.id}`}
                onClick={() =>
                  void run(
                    `send-${m.id}`,
                    async () => {
                      await send(csrf, 'POST', `/legal-matters/${m.id}/sync-status`);
                      await v.reload();
                    },
                    'Status sent to the legal system.',
                  )
                }
              >
                Send our status to the legal system
              </Button>
            </div>
          )}
          {canSim && m.externalRef && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              aria-label="Simulate a legal system event"
              onSubmit={(e) => {
                e.preventDefault();
                void run(`sim-${m.id}`, async () => {
                  setSim(
                    await send<Sim>(csrf, 'POST', '/integrations/legal/simulate', {
                      matterId: m.id,
                      type,
                      ...(type === 'MATTER_STAGE_CHANGED' ? { stage } : {}),
                    }),
                  );
                  await v.reload();
                });
              }}
            >
              <Field label="Simulate a legal system event">
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="MATTER_STAGE_CHANGED">Stage changed</option>
                  <option value="DOCUMENT_ATTACHED">Document attached</option>
                  <option value="MATTER_CLOSED">Matter closed</option>
                </Select>
              </Field>
              {type === 'MATTER_STAGE_CHANGED' && (
                <Field label="Stage">
                  <Input value={stage} onChange={(e) => setStage(e.target.value)} maxLength={60} />
                </Field>
              )}
              <Button type="submit" loading={busy === `sim-${m.id}`}>
                Send signed event
              </Button>
            </form>
          )}
        </div>
      ))}
      {sim && (
        <p role="status" className="mt-2 text-sm" data-testid="legal-sim-result">
          Signed event sent: the receiver answered {sim.httpStatus}
          {sim.result.duplicate
            ? ' (already applied)'
            : sim.result.status
              ? ` (${sim.result.status.toLowerCase()})`
              : ''}
          .{sim.result.error ? ` ${sim.result.error}` : ''}
        </p>
      )}
      {messages}
    </Card>
  );
}
