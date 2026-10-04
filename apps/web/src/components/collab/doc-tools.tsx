'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select } from '@if/ui';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/labels';
import { send, useData, useRun } from '@/components/contract/b5-shared';

type Part = { t: 'same' | 'add' | 'del'; text: string };
interface Change {
  key: string;
  label: string;
  by: string | null;
  at: string;
  diff: Part[];
}

/** Word-level changes: what was added is underlined, what was removed is struck through. */
export function Diff({ parts }: { parts: Part[] }) {
  return (
    <p className="whitespace-pre-wrap text-sm" data-testid="diff">
      {parts.map((p, i) =>
        p.t === 'add' ? (
          <ins key={i} className="bg-success-bg text-success underline">
            {p.text}
          </ins>
        ) : p.t === 'del' ? (
          <del key={i} className="bg-error-bg text-error">
            {p.text}
          </del>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

/** Who else is in the document, what changed since the last look, tracked changes, saved versions and comparison. */
export function DocumentTools({
  type,
  id,
  csrf,
  fieldKey,
}: {
  type: 'plan' | 'tender' | 'request';
  id: string;
  csrf: string;
  fieldKey?: string | null;
}) {
  const base = `/documents/${type}/${id}`;
  const [others, setOthers] = useState<Array<{ userId: string; name: string; fieldKey: string | null }>>([]);
  const digest = useData<{ summary: string; firstLook: boolean; changes: number }>(`${base}/summary`);
  const changes = useData<{ changes: Change[]; total: number }>(`${base}/changes`);
  const versions = useData<Array<{ number: number; label: string; by: string; at: string }>>(
    `${base}/versions`,
  );
  const [label, setLabel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('current');
  const [cmp, setCmp] = useState<{
    changed: number;
    fields: Array<{ key: string; label: string; status: string; diff?: Part[] }>;
  } | null>(null);
  const r = useRun();

  useEffect(() => {
    let live = true;
    const beat = async () => {
      try {
        const x = await send<{ others: typeof others }>(
          csrf,
          'POST',
          `${base}/presence`,
          fieldKey ? { fieldKey } : {},
        );
        if (live) setOthers(x.others);
      } catch {
        /* presence is a courtesy; editing never depends on it */
      }
    };
    void beat();
    const h = setInterval(() => void beat(), 20_000);
    return () => {
      live = false;
      clearInterval(h);
    };
  }, [base, csrf, fieldKey]);

  return (
    <Card aria-labelledby={`dt-${id}`} role="region" data-testid="document-tools">
      <h2 id={`dt-${id}`} className="font-heading text-xl font-bold">
        Working together
      </h2>
      <p className="mt-1 text-sm" data-testid="presence" role="status">
        {others.length === 0
          ? 'No one else is in this document right now.'
          : others.map((o) => `${o.name}${o.fieldKey ? ` is on ${o.fieldKey}` : ' is here'}`).join('; ') +
            '.'}
      </p>
      <p className="mt-1 text-xs text-text-muted">
        You can edit different sections at the same time. If someone saved the section you are editing, you
        are told what it says now instead of overwriting it.
      </p>

      <section className="mt-4" aria-labelledby={`dg-${id}`}>
        <h3 id={`dg-${id}`} className="font-heading font-semibold">
          Since you last looked
        </h3>
        <p className="mt-1 text-sm" data-testid="digest">
          {digest.data?.summary ?? 'Loading…'}
        </p>
        <Button
          variant="secondary"
          className="mt-2"
          loading={r.busy === 'seen'}
          onClick={() =>
            void r.run(
              'seen',
              async () => {
                await api(`${base}/summary?markSeen=true`);
                await digest.reload();
              },
              'Marked as seen.',
            )
          }
        >
          Mark as seen
        </Button>
        <p className="mt-1 text-xs text-text-muted">
          A short digest made by fixed rules that stand in for an AI summary.
        </p>
      </section>

      <section className="mt-4" aria-labelledby={`tc-${id}`}>
        <h3 id={`tc-${id}`} className="font-heading font-semibold">
          Tracked changes ({changes.data?.total ?? 0})
        </h3>
        <ul
          className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto"
          data-testid="tracked-changes"
          tabIndex={0}
          aria-label="Tracked changes"
        >
          {(changes.data?.changes ?? [])
            .slice(-15)
            .reverse()
            .map((c, i) => (
              <li key={`${c.key}-${c.at}-${i}`} className="rounded-md border border-border p-2">
                <p className="text-xs text-text-muted">
                  {c.label} · {c.by ?? 'the platform'} · {formatDateTime(c.at)}
                </p>
                <Diff parts={c.diff} />
              </li>
            ))}
        </ul>
      </section>

      <section className="mt-4" aria-labelledby={`vs-${id}`}>
        <h3 id={`vs-${id}`} className="font-heading font-semibold">
          Saved versions
        </h3>
        <form
          aria-label="Save a version"
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void r.run(
              'ver',
              async () => {
                await send(csrf, 'POST', `${base}/versions`, { label });
                setLabel('');
                await versions.reload();
              },
              'Version saved.',
            );
          }}
        >
          <Field label="Name this version">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-64"
              maxLength={120}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            loading={r.busy === 'ver'}
            disabled={label.trim().length < 2}
          >
            Keep this version
          </Button>
        </form>
        <ul className="mt-2 text-sm" aria-label="Versions" data-testid="versions">
          {(versions.data ?? []).map((v) => (
            <li key={v.number}>
              <Badge tone="info">v{v.number}</Badge> {v.label}{' '}
              <span className="text-text-muted">
                · {v.by} · {formatDateTime(v.at)}
              </span>
            </li>
          ))}
          {(versions.data ?? []).length === 0 && <li className="text-text-muted">No versions saved yet.</li>}
        </ul>
        {(versions.data ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Compare">
              <Select value={from} onChange={(e) => setFrom(e.target.value)} className="w-48">
                <option value="">Choose a version</option>
                {versions.data!.map((v) => (
                  <option key={v.number} value={v.number}>
                    v{v.number} {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="With">
              <Select value={to} onChange={(e) => setTo(e.target.value)} className="w-48">
                <option value="current">The text now</option>
                {versions.data!.map((v) => (
                  <option key={v.number} value={v.number}>
                    v{v.number} {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              disabled={!from}
              loading={r.busy === 'cmp'}
              onClick={() =>
                void r.run('cmp', async () => setCmp(await api(`${base}/compare?from=${from}&to=${to}`)))
              }
            >
              Compare
            </Button>
          </div>
        )}
        {cmp && (
          <div className="mt-3 flex flex-col gap-2" data-testid="comparison">
            <p className="text-sm font-semibold">{cmp.changed} section(s) differ.</p>
            {cmp.fields
              .filter((f) => f.status !== 'SAME')
              .map((f) => (
                <div key={f.key} className="rounded-md border border-border p-2">
                  <p className="text-xs text-text-muted">
                    {f.label} · {f.status.toLowerCase()}
                  </p>
                  {f.diff && <Diff parts={f.diff} />}
                </div>
              ))}
          </div>
        )}
      </section>
      {r.messages}
    </Card>
  );
}
