'use client';
import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { Bar, has, send, useData, useRun } from '@/components/contract/b5-shared';
import { aud } from '@/lib/labels';
import type { TenderView } from './types';

interface Item {
  key: string;
  label: string;
  section: 'TECHNICAL' | 'COMMERCIAL';
  kind: 'TEXT' | 'NUMBER' | 'CHOICE' | 'YESNO' | 'DATE';
  required: boolean;
  options: string[];
  unit: string | null;
  maxLength: number | null;
}
interface Schedule {
  editable: boolean;
  items: Item[];
  requiredCover: number | null;
  dualWitness: boolean;
}
const KIND: Record<Item['kind'], string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  CHOICE: 'Choice',
  YESNO: 'Yes or no',
  DATE: 'Date',
};

const slug = (label: string, taken: Set<string>) => {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  if (!/^[a-z]/.test(base)) base = `q_${base}`;
  if (base.length < 2) base = 'question';
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  return k;
};

/** The form a supplier fills in instead of attaching documents (FR-0130), with the cover a bid must hold and witnessed opening (FR-0175, FR-0185). */
export function ResponseFormPanel({
  t,
  csrf,
  roles,
}: {
  t: TenderView;
  csrf: string;
  roles: readonly string[];
}) {
  const { data, error, reload } = useData<Schedule>(`/tenders/${t.id}/response-schedule`);
  const [items, setItems] = useState<Item[] | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [witness, setWitness] = useState<boolean | null>(null);
  const r = useRun();
  const canEdit = has(roles, 'PROCUREMENT') && data?.editable;
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const rows = items ?? data.items;
  const edit = (i: number, patch: Partial<Item>) =>
    setItems(rows.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const dirty = items !== null || cover !== null || witness !== null;
  return (
    <div className="flex flex-col gap-4" data-testid="response-form">
      <Card role="region" aria-labelledby="rf-h">
        <h2 id="rf-h" className="font-heading text-xl font-bold">
          Response form
        </h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          Instead of attaching documents, a supplier answers these questions in the portal. Their answers are
          checked as they type, and a bid with a required question blank cannot be submitted.
          {!data.editable && ' The form is locked now that the tender is published.'}
        </p>
        {rows.length === 0 && (
          <p className="mt-3 text-sm text-text-muted">No questions yet. Suppliers upload files only.</p>
        )}
        <ol className="mt-3 flex flex-col gap-3">
          {rows.map((q, i) => (
            <li key={q.key} className="rounded-md border border-border p-3" data-testid="schedule-item">
              {canEdit ? (
                <div className="grid gap-3 sm:grid-cols-6">
                  <div className="sm:col-span-3">
                    <Field label={`Question ${i + 1}`}>
                      <Input
                        value={q.label}
                        maxLength={300}
                        onChange={(e) => edit(i, { label: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Answer type">
                    <Select
                      value={q.kind}
                      onChange={(e) => edit(i, { kind: e.target.value as Item['kind'] })}
                    >
                      {Object.entries(KIND).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Part of the bid">
                    <Select
                      value={q.section}
                      onChange={(e) => edit(i, { section: e.target.value as Item['section'] })}
                    >
                      <option value="TECHNICAL">Technical</option>
                      <option value="COMMERCIAL">Commercial</option>
                    </Select>
                  </Field>
                  <label className="flex min-h-[44px] items-end gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => edit(i, { required: e.target.checked })}
                      className="size-4"
                    />
                    Required
                  </label>
                  {q.kind === 'CHOICE' && (
                    <div className="sm:col-span-4">
                      <Field label="Options, separated by commas">
                        <Input
                          value={q.options.join(', ')}
                          onChange={(e) =>
                            edit(i, {
                              options: e.target.value
                                .split(',')
                                .map((x) => x.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </Field>
                    </div>
                  )}
                  <div className="sm:col-span-6">
                    <Button
                      variant="ghost"
                      onClick={() => setItems(rows.filter((_, n) => n !== i))}
                      aria-label={`Remove question ${i + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm">
                  <span className="font-semibold">
                    {i + 1}. {q.label}
                  </span>{' '}
                  <Badge tone="neutral">{KIND[q.kind]}</Badge>{' '}
                  <Badge tone="neutral">{q.section.toLowerCase()}</Badge>{' '}
                  {q.required && <Badge tone="info">required</Badge>}
                  {q.kind === 'CHOICE' && <span className="text-text-muted"> · {q.options.join(', ')}</span>}
                </p>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setItems([
                  ...rows,
                  {
                    key: slug(`question ${rows.length + 1}`, new Set(rows.map((x) => x.key))),
                    label: '',
                    section: 'TECHNICAL',
                    kind: 'TEXT',
                    required: true,
                    options: [],
                    unit: null,
                    maxLength: null,
                  },
                ])
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a question
            </Button>
          </div>
        )}
      </Card>

      <Card role="region" aria-labelledby="req-h">
        <h2 id="req-h" className="font-heading text-xl font-bold">
          What a bidder must hold, and how the bids are opened
        </h2>
        {canEdit ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              label="Least insurance cover (AUD)"
              hint="A bid is refused if the supplier's certificate shows less, or has expired. Leave blank for none."
            >
              <Input
                type="number"
                min={0}
                value={cover ?? (data.requiredCover === null ? '' : String(data.requiredCover))}
                onChange={(e) => setCover(e.target.value)}
              />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={witness ?? data.dualWitness}
                onChange={(e) => setWitness(e.target.checked)}
              />
              Two independent witnesses must open the bids after close
            </label>
          </div>
        ) : (
          <ul className="mt-2 text-sm">
            <li>
              Least insurance cover:{' '}
              {data.requiredCover === null ? 'none required' : aud.format(data.requiredCover)}
            </li>
            <li>
              Opening the bids:{' '}
              {data.dualWitness ? 'two independent witnesses' : 'as soon as the tender closes'}
            </li>
          </ul>
        )}
        {canEdit && (
          <div className="mt-3">
            <Button
              loading={r.busy === 'save'}
              disabled={!dirty || rows.some((q) => q.label.trim().length < 3)}
              onClick={() =>
                void r.run(
                  'save',
                  async () => {
                    await send(csrf, 'PUT', `/tenders/${t.id}/response-schedule`, {
                      items: rows.map((q) => ({
                        ...q,
                        key: q.key,
                        label: q.label.trim(),
                        unit: q.unit,
                        maxLength: q.maxLength,
                      })),
                    });
                    await send(csrf, 'PUT', `/tenders/${t.id}/requirements`, {
                      requiredCover:
                        cover !== null ? (cover === '' ? null : Number(cover)) : data.requiredCover,
                      dualWitness: witness ?? data.dualWitness,
                    });
                    setItems(null);
                    setCover(null);
                    setWitness(null);
                    await reload();
                  },
                  'Saved.',
                )
              }
            >
              Save the form and requirements
            </Button>
            {r.messages}
          </div>
        )}
      </Card>
      <AnswersPanel t={t} />
    </div>
  );
}

interface Answers {
  suppliers: Array<{ supplierId: string; company: string }>;
  rows: Array<Item & { answers: Array<string | null>; lowest: number | null }>;
}
/** Every supplier's answers side by side, once the tender has closed and its bids are open. */
function AnswersPanel({ t }: { t: TenderView }) {
  const closed = !['DRAFT', 'STAGED', 'PUBLISHED'].includes(t.status);
  const sealed = t.dualWitness && !t.bidsOpenedAt;
  const { data, error } = useData<Answers>(closed && !sealed ? `/tenders/${t.id}/response-answers` : null);
  if (!closed) return null;
  if (sealed)
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <Lock className="size-4" aria-hidden="true" />
        The answers stay sealed until two witnesses open the bids.
      </p>
    );
  if (error) return <p className="text-sm text-text-muted">{error}</p>;
  if (!data || data.rows.length === 0) return null;
  return (
    <Card role="region" aria-labelledby="ans-h" data-testid="answers-matrix">
      <h2 id="ans-h" className="font-heading text-xl font-bold">
        Answers side by side
      </h2>
      <Table caption="Supplier answers to the response form" className="mt-2">
        <thead>
          <tr>
            <Th>Question</Th>
            {data.suppliers.map((s) => (
              <Th key={s.supplierId}>{s.company}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((q) => (
            <tr key={q.key}>
              <Td label="Question">{q.label}</Td>
              {data.suppliers.map((s, i) => {
                const v = q.answers[i];
                const best = q.kind === 'NUMBER' && v !== null && Number(v) === q.lowest;
                return (
                  <Td key={s.supplierId} label={s.company}>
                    {v === null ? (
                      <span className="text-text-muted">No answer</span>
                    ) : q.kind === 'NUMBER' ? (
                      aud.format(Number(v))
                    ) : (
                      v
                    )}
                    {best && data.suppliers.length > 1 && <Badge tone="success"> lowest</Badge>}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

interface Opening {
  required: boolean;
  opened: boolean;
  openedAt: string | null;
  windowMinutes: number;
  witnesses: Array<{ name: string; at: string }>;
  expiresAt: string | null;
  youHaveWitnessed: boolean;
}
const WITNESS = ['PROBITY', 'LEGAL', 'DELEGATE', 'EXEC', 'PROCUREMENT'];

/** Two different, independent people confirm, each by password, within the window, and the sealed bids open (FR-0175). */
export function OpeningPanel({
  t,
  csrf,
  roles,
  onDone,
}: {
  t: TenderView;
  csrf: string;
  roles: readonly string[];
  onDone: () => void;
}) {
  const closed = !['DRAFT', 'STAGED', 'PUBLISHED'].includes(t.status);
  const mayLoad = t.dualWitness && closed && has(roles, ...WITNESS);
  const { data, reload } = useData<Opening>(mayLoad ? `/tenders/${t.id}/opening` : null);
  const [password, setPassword] = useState('');
  const r = useRun();
  if (!t.dualWitness) return null;
  if (!closed)
    return (
      <p className="mb-3 flex items-center gap-2 text-sm text-text-muted" data-testid="opening-pending">
        <ShieldCheck className="size-4" aria-hidden="true" />
        These bids will stay sealed after close until two independent witnesses open them.
      </p>
    );
  if (!data) return null;
  return (
    <Card role="region" aria-labelledby="open-h" className="mb-4" data-testid="opening">
      <h2 id="open-h" className="font-heading text-xl font-bold">
        Opening the bids
      </h2>
      {data.opened ? (
        <p role="status" className="mt-2 text-sm font-medium text-success">
          Opened by two witnesses
          {data.openedAt ? ` on ${new Date(data.openedAt).toLocaleString('en-AU')}` : ''}.
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-prose text-sm text-text-muted">
            This tender is high value. Two different, independent people must each confirm with their password
            within {data.windowMinutes} minutes of each other. Neither may have raised the request or sit on
            the evaluation panel.
          </p>
          <Bar label={`${data.witnesses.length} of 2 witnesses`} pct={data.witnesses.length * 50} />
          {data.witnesses.map((w) => (
            <p key={w.name} className="mt-1 text-sm">
              <Badge tone="success">confirmed</Badge> {w.name} at {new Date(w.at).toLocaleTimeString('en-AU')}
            </p>
          ))}
          {data.expiresAt && (
            <p className="mt-1 text-xs text-text-muted">
              The first confirmation counts until {new Date(data.expiresAt).toLocaleTimeString('en-AU')}.
            </p>
          )}
          {!data.youHaveWitnessed && (
            <form
              className="mt-3 flex flex-wrap items-end gap-3"
              aria-label="Witness the opening"
              onSubmit={(e) => {
                e.preventDefault();
                void r.run('w', async () => {
                  await send(csrf, 'POST', `/tenders/${t.id}/opening/witness`, { password });
                  setPassword('');
                  await reload();
                  onDone();
                });
              }}
            >
              <Field label="Your password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-64"
                />
              </Field>
              <Button type="submit" loading={r.busy === 'w'} disabled={!password}>
                I witness the opening
              </Button>
            </form>
          )}
          {data.youHaveWitnessed && (
            <p className="mt-3 text-sm">
              You have confirmed. A second, different person must now do the same.
            </p>
          )}
          {r.messages}
        </>
      )}
    </Card>
  );
}
