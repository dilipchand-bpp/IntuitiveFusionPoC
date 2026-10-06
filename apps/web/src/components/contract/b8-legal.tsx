'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@if/ui';
import { api } from '@/lib/api-client';
import { has, send, useData, useRun } from './b5-shared';
import type { ContractView } from './types';

interface Redline {
  id: string;
  clauseId: string;
  currentText: string;
  proposedText: string;
  source: string;
  author: string;
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED';
}
interface Links {
  id: string;
  name: string;
  email: string;
  party: string;
  expiresAt: string;
  active: boolean;
}
const SOURCE: Record<string, string> = {
  INTERNAL: 'Legal team',
  LEGAL_PLATFORM: 'Legal platform',
  EXTERNAL_COUNSEL: 'Outside counsel',
  SUPPLIER: 'Supplier legal team',
};
interface EditResult {
  applied: boolean;
  understood: boolean;
  explanation: string;
  hint?: string;
}

/** Plain-language redaction, redlining and clause insertion; the redlines that came back; and links for outside counsel (FR-0830, FR-0390). */
export function LegalToolsCard({
  c,
  csrf,
  roles,
  onChange,
}: {
  c: ContractView;
  csrf: string;
  roles: readonly string[];
  onChange: (c: ContractView) => void;
}) {
  const legal = has(roles, 'LEGAL');
  const open = c.status === 'DRAFT' || c.status === 'LEGAL_REVIEW';
  const reds = useData<{ redlines: Redline[]; editable: boolean }>(`/contracts/${c.id}/redlines`);
  const links = useData<Links[]>(legal ? `/contracts/${c.id}/counsel-links` : null);
  const [text, setText] = useState('');
  const [said, setSaid] = useState<EditResult | null>(null);
  const [lf, setLf] = useState({ name: '', email: '', party: 'EXTERNAL_COUNSEL' });
  const [fresh, setFresh] = useState<string | null>(null);
  const r = useRun();
  const reload = async () => {
    onChange(await api<ContractView>(`/contracts/${c.id}`));
    await reds.reload();
  };
  if (c.status === 'EXECUTED' && (reds.data?.redlines.length ?? 0) === 0) return null;
  const run = (apply: boolean) =>
    r.run('edit', async () => {
      const x = await send<EditResult>(csrf, 'POST', `/contracts/${c.id}/legal-edit`, {
        instruction: text,
        apply,
      });
      setSaid(x);
      if (x.applied) {
        setText('');
        await reload();
      }
    });
  return (
    <Card role="region" aria-labelledby="lt-h" data-testid="legal-tools">
      <h2 id="lt-h" className="font-heading text-xl font-bold">
        Legal edits and redlines
      </h2>
      {legal && open && (
        <form
          className="mt-2 flex flex-col gap-2"
          aria-label="Legal edit in plain language"
          onSubmit={(e) => {
            e.preventDefault();
            void run(true);
          }}
        >
          <Field
            label="Tell me what to change"
            hint='For example "redact the liability clause", "redline clause 4 to: ..." or "insert a clause titled Data breach after clause 6: ...".'
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={r.busy === 'edit'} disabled={text.trim().length < 3}>
              Do it
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={text.trim().length < 3}
              onClick={() => void run(false)}
            >
              Show me what it would do
            </Button>
          </div>
          {said && (
            <p
              role="status"
              data-testid="legal-edit-result"
              className={`text-sm font-medium ${said.applied ? 'text-success' : said.understood ? 'text-text' : 'text-warning'}`}
            >
              {said.explanation}
              {said.hint ? ` ${said.hint}` : ''}
            </p>
          )}
          <p className="text-xs text-text-muted">
            Understood by a rules-based stand-in for an AI model (rules-simulated-v1).
          </p>
        </form>
      )}
      <h3 className="mt-4 font-heading text-lg font-semibold">Proposed changes</h3>
      <ul className="mt-2 flex flex-col gap-3" data-testid="redlines">
        {(reds.data?.redlines ?? []).length === 0 && (
          <li className="text-sm text-text-muted">None proposed.</li>
        )}
        {(reds.data?.redlines ?? []).map((x) => (
          <li key={x.id} className="rounded-md border border-border p-3 text-sm">
            <p>
              <Badge
                tone={x.status === 'ACCEPTED' ? 'success' : x.status === 'REJECTED' ? 'error' : 'warning'}
              >
                {x.status.toLowerCase()}
              </Badge>{' '}
              <span className="font-semibold">{x.clauseId}</span> · {SOURCE[x.source] ?? x.source} ·{' '}
              {x.author}
            </p>
            <p className="mt-1 text-text-muted">
              <del>{x.currentText}</del>
            </p>
            <p className="mt-1">
              <ins className="no-underline">{x.proposedText}</ins>
            </p>
            {legal && x.status === 'PROPOSED' && open && (
              <div className="mt-2 flex gap-2">
                {(['ACCEPT', 'REJECT'] as const).map((d) => (
                  <Button
                    key={d}
                    variant="secondary"
                    aria-label={`${d === 'ACCEPT' ? 'Accept' : 'Reject'} the change to ${x.clauseId}`}
                    onClick={() =>
                      void r.run(`d-${x.id}`, async () => {
                        await send(csrf, 'POST', `/contracts/${c.id}/redlines/${x.id}/decision`, {
                          decision: d,
                        });
                        await reload();
                      })
                    }
                  >
                    {d === 'ACCEPT' ? 'Accept' : 'Reject'}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {legal && open && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="font-heading text-lg font-semibold">
            Outside counsel or the supplier&apos;s legal team
          </h3>
          <p className="mt-1 max-w-prose text-sm text-text-muted">
            Send a one-time link. They see the clauses (not the price or the bids), propose wording, and
            cannot change anything themselves. Once the contract is released for signature the version is
            final and the link becomes read-only.
          </p>
          <form
            className="mt-2 grid gap-3 sm:grid-cols-3"
            aria-label="Issue a counsel link"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run('link', async () => {
                const x = await send<{ path: string }>(csrf, 'POST', `/contracts/${c.id}/counsel-links`, lf);
                setFresh(`${window.location.origin}${x.path}`);
                setLf({ name: '', email: '', party: lf.party });
                await links.reload();
              });
            }}
          >
            <Field label="Name">
              <Input
                value={lf.name}
                onChange={(e) => setLf({ ...lf, name: e.target.value })}
                maxLength={120}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={lf.email}
                onChange={(e) => setLf({ ...lf, email: e.target.value })}
                maxLength={200}
              />
            </Field>
            <Field label="Who">
              <Select value={lf.party} onChange={(e) => setLf({ ...lf, party: e.target.value })}>
                <option value="EXTERNAL_COUNSEL">External law firm</option>
                <option value="SUPPLIER">Supplier&apos;s legal team</option>
              </Select>
            </Field>
            <div className="sm:col-span-3">
              <Button
                type="submit"
                variant="secondary"
                loading={r.busy === 'link'}
                disabled={lf.name.trim().length < 2 || !lf.email.includes('@')}
              >
                Create link
              </Button>
            </div>
          </form>
          {fresh && (
            <p
              role="status"
              className="mt-2 break-all rounded-md border border-success bg-success-bg p-2 text-sm"
              data-testid="fresh-link"
            >
              Copy this link now and send it. It is shown once: <span className="font-mono">{fresh}</span>
            </p>
          )}
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {(links.data ?? []).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {l.name} ({l.email}) · {l.party === 'SUPPLIER' ? 'supplier' : 'law firm'}
                </span>
                <Badge tone={l.active ? 'success' : 'neutral'}>{l.active ? 'active' : 'ended'}</Badge>
                {l.active && (
                  <Button
                    variant="ghost"
                    aria-label={`End the link for ${l.name}`}
                    onClick={() =>
                      void r.run(`rv-${l.id}`, async () => {
                        await send(csrf, 'DELETE', `/contracts/${c.id}/counsel-links/${l.id}`);
                        await links.reload();
                      })
                    }
                  >
                    End
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.messages}
    </Card>
  );
}
