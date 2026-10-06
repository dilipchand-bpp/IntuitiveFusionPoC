'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AiBadge, Badge, Button, Card, Select, type BadgeTone } from '@if/ui';
import { has, send, useData, useRun } from './b5-shared';

interface Signatory {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  order: number;
  status: string;
  declineReason: string | null;
  isMe: boolean;
}
interface EnvEvent {
  id: string;
  type: string;
  providerType: string | null;
  source: string;
  outcome: string;
  detail: string | null;
  signatory: string | null;
  at: string;
}
interface Card {
  envelope: {
    provider: string;
    providerLabel: string;
    externalId: string;
    status: string;
    signingMode: string;
    blind: boolean;
    closedReason: string | null;
    signatories: Signatory[];
    events: EnvEvent[];
  } | null;
  connector: { inUse: boolean; providerLabel: string | null };
  manualTasks: Array<{ id: string; title: string; instructions: string }>;
  permissions: { canSimulate: boolean; canCreate: boolean; canOpenSigning: boolean };
}
const TONE: Record<string, BadgeTone> = {
  SENT: 'neutral',
  CREATED: 'neutral',
  DELIVERED: 'info',
  VIEWED: 'info',
  SIGNED: 'success',
  COMPLETED: 'success',
  DECLINED: 'error',
  VOIDED: 'warning',
  EXPIRED: 'warning',
};
const KINDS = ['sent', 'delivered', 'viewed', 'signed', 'declined', 'voided', 'expired'];

/** The e-signature envelope on a contract: provider, status for each signatory and the event history (NFR-C04). */
export function EnvelopeCard({
  contractId,
  status,
  csrf,
  roles,
}: {
  contractId: string;
  status: string;
  csrf: string;
  roles: string[];
}) {
  const router = useRouter();
  const d = useData<Card>(`/contracts/${contractId}/envelope?s=${status}`);
  const { busy, run, messages } = useRun();
  const [kind, setKind] = useState('viewed');
  const [who, setWho] = useState('');
  const c = d.data;
  if (!c || (!c.envelope && !c.connector.inUse && c.manualTasks.length === 0)) return null;
  const e = c.envelope;
  return (
    <Card role="region" aria-labelledby="env-h" data-testid="envelope-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="env-h" className="font-heading text-xl font-bold">
          E-signature envelope
        </h2>
        <AiBadge kind="simulated" />
      </div>
      {!e && (
        <p className="mt-2 text-sm text-text-muted">
          No envelope has been created. The contract is signed in the platform as usual.
        </p>
      )}
      {c.manualTasks.map((t) => (
        <p
          key={t.id}
          role="status"
          className="mt-2 text-sm font-medium text-warning"
          data-testid="envelope-task"
        >
          {t.title}. {t.instructions}
        </p>
      ))}
      {e && (
        <>
          <p className="mt-1 text-sm text-text-muted">
            {e.providerLabel} envelope <code>{e.externalId}</code>{' '}
            <Badge tone={TONE[e.status] ?? 'neutral'}>{e.status}</Badge>
            {e.blind && ' (blind signing: you see only your own line)'}
          </p>
          {e.closedReason && <p className="text-sm text-text-muted">{e.closedReason}</p>}
          <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label="Signatories">
            {e.signatories.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2" data-testid="envelope-signatory">
                <strong>{s.name}</strong>
                <span className="text-text-muted">
                  {s.roleLabel}
                  {e.signingMode === 'STAGED' ? `, order ${s.order}` : ''}
                </span>
                <Badge tone={TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                {s.declineReason && <span className="text-text-muted">“{s.declineReason}”</span>}
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Event history ({e.events.length})
            </summary>
            <ol className="mt-2 flex flex-col gap-1 text-xs" data-testid="envelope-events">
              {e.events.map((x) => (
                <li key={x.id}>
                  {new Date(x.at).toLocaleString('en-AU')} · <strong>{x.type}</strong>
                  {x.signatory ? ` · ${x.signatory}` : ''} · {x.source.toLowerCase()} ·{' '}
                  {x.outcome.toLowerCase()}
                  {x.detail ? ` · ${x.detail}` : ''}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      {c.permissions.canOpenSigning && (
        <Button
          className="mt-3"
          loading={busy === 'link'}
          onClick={() =>
            void run('link', async () => {
              const r = await send<{ path: string }>(
                csrf,
                'POST',
                `/contracts/${contractId}/envelope/signing-link`,
              );
              router.push(r.path);
            })
          }
        >
          Open my signing page
        </Button>
      )}
      {c.permissions.canCreate && (
        <Button
          className="mt-3"
          variant="secondary"
          loading={busy === 'create'}
          onClick={() =>
            void run('create', async () => {
              await send(csrf, 'POST', `/contracts/${contractId}/envelope`);
              await d.reload();
            })
          }
        >
          Create the envelope now
        </Button>
      )}
      {c.permissions.canSimulate && e && has(roles, 'ADMIN', 'LEGAL', 'PROCUREMENT') && (
        <div className="mt-3 flex flex-wrap items-end gap-2" data-testid="envelope-simulate">
          <label className="text-xs">
            Simulate provider event
            <Select value={kind} onChange={(ev) => setKind(ev.target.value)} aria-label="Provider event">
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </label>
          <label className="text-xs">
            Signatory
            <Select value={who} onChange={(ev) => setWho(ev.target.value)} aria-label="Signatory">
              <option value="">First waiting</option>
              {e.signatories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="secondary"
            loading={busy === 'sim'}
            onClick={() =>
              void run(
                'sim',
                async () => {
                  const r = await send<{ outcome: string | null; detail: string | null }>(
                    csrf,
                    'POST',
                    `/contracts/${contractId}/envelope/simulate-event`,
                    {
                      type: kind,
                      ...(who ? { signatoryId: who } : {}),
                      ...(kind === 'declined' ? { reason: 'Declined in the simulated provider' } : {}),
                    },
                  );
                  await d.reload();
                  router.refresh();
                  if (r.outcome === 'REFUSED') throw new Error(r.detail ?? 'The platform refused it');
                },
                'The provider called back.',
              )
            }
          >
            Send callback
          </Button>
        </div>
      )}
      {messages}
    </Card>
  );
}
