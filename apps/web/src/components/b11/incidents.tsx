'use client';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Field, Input, Select, Table, Td, Textarea, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

const KINDS = [
  ['FINANCIAL', 'Financial (bank or card details)'],
  ['SENSITIVE_PERSONAL', 'Sensitive personal (health, TFN, identity)'],
  ['CONFIDENTIAL', 'Confidential (contact details, commercial)'],
  ['INTERNAL', 'Internal'],
] as const;

interface Item {
  id: string;
  number: string;
  title: string;
  status: 'OPEN' | 'ASSESSING' | 'NOTIFIED' | 'CLOSED';
  assessmentDue: string;
  daysLeft: number;
  overdue: boolean;
  assessed: boolean;
  recommendation: string | null;
  reportedBy: string | null;
  individuals: number;
}
interface RegisterView {
  disclaimer: string;
  summary: { open: number; overdue: number; notifiable: number };
  items: Item[];
}
interface Question {
  id: string;
  text: string;
  help: string;
  kind: 'GATE' | 'WEIGHT';
  weight: number | null;
}
interface Draft {
  audience: 'REGULATOR' | 'INDIVIDUALS';
  subject: string;
  body: string;
  unfilled: string[];
  status: 'DRAFT' | 'SENT_SIMULATED';
  record?: { connector: string; reference: string; recipients: number };
}
interface Detail extends Item {
  description: string;
  discoveredAt: string;
  dataKinds: string[];
  assessment: {
    score: number;
    threshold: number;
    recommendation: string;
    because: string[];
    reason: string | null;
    answers: Record<string, boolean>;
    disclaimer: string;
  } | null;
  containment: Array<{ key: string; label: string; done: boolean; doneBy: string | null }>;
  notifications: Draft[];
  reminders: Array<{ kind: string; at: string }>;
  lessons: string | null;
  disclaimer: string;
}
const TONE = { OPEN: 'warning', ASSESSING: 'info', NOTIFIED: 'success', CLOSED: 'neutral' } as const;
const dateOnly = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { dateStyle: 'medium', timeZone: 'UTC' });

function Report({ csrf, done }: { csrf: string; done: () => Promise<void> }) {
  const { busy, run, messages } = useRun();
  const [f, setF] = useState({
    title: '',
    description: '',
    discovered: '',
    individuals: '0',
    kinds: [] as string[],
  });
  return (
    <Card>
      <h2 className="font-heading text-xl font-bold">Report a suspected data breach</h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        Anyone can report. Legal, probity, the administrator and the executive are told at once, and the
        30-day assessment clock starts from when you became aware.
      </p>
      <form
        className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            'report',
            async () => {
              await send(csrf, 'POST', '/incidents/report', {
                title: f.title,
                description: f.description,
                individuals: Number(f.individuals) || 0,
                dataKinds: f.kinds,
                ...(f.discovered ? { discoveredAt: new Date(f.discovered).toISOString() } : {}),
              });
              setF({ title: '', description: '', discovered: '', individuals: '0', kinds: [] });
              await done();
            },
            'Your report was received. Legal, probity and the administrator have been told.',
          );
        }}
      >
        <div className="sm:col-span-2">
          <Field label="What happened, in a few words" required>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Description"
            hint="What was exposed, to whom, and how you found out (10 characters or more)."
            required
          >
            <Textarea
              rows={3}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
        </div>
        <Field label="When you became aware" hint="Leave empty for now.">
          <Input
            type="datetime-local"
            value={f.discovered}
            onChange={(e) => setF({ ...f, discovered: e.target.value })}
          />
        </Field>
        <Field label="People affected (best estimate)">
          <Input
            type="number"
            min={0}
            value={f.individuals}
            onChange={(e) => setF({ ...f, individuals: e.target.value })}
          />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold">Kinds of information involved</legend>
          <div className="flex flex-wrap gap-x-4">
            {KINDS.map(([k, label]) => (
              <Checkbox
                key={k}
                label={label}
                checked={f.kinds.includes(k)}
                onChange={(e) =>
                  setF({ ...f, kinds: e.target.checked ? [...f.kinds, k] : f.kinds.filter((x) => x !== k) })
                }
              />
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={busy === 'report'}
            disabled={f.title.trim().length < 5 || f.description.trim().length < 10 || busy !== null}
          >
            Send report
          </Button>
          {messages}
        </div>
      </form>
    </Card>
  );
}

function Manage({ id, csrf, reload }: { id: string; csrf: string; reload: () => Promise<void> }) {
  const d = useData<Detail>(`/incidents/${id}`);
  const qs = useData<{ questions: Question[] }>('/incidents/questions');
  const { busy, run, messages } = useRun();
  const [answers, setAnswers] = useState<Record<string, 'yes' | 'no'>>({});
  const [reason, setReason] = useState('');
  const [lessons, setLessons] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  if (!d.data || !qs.data) return <p className="text-sm text-text-muted">Loading…</p>;
  const x = d.data;
  const closed = x.status === 'CLOSED';
  const act = (name: string, path: string, body?: unknown, ok?: string) =>
    run(
      name,
      async () => {
        await send(csrf, 'POST', `/incidents/${id}/${path}`, body);
        await d.reload();
        await reload();
      },
      ok,
    );
  const allAnswered = qs.data.questions.every((q) => answers[q.id]);
  const a = x.assessment;
  return (
    <Card data-testid="incident-detail">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-lg font-bold">
          {x.number}: {x.title}
        </h3>
        <Badge tone={TONE[x.status]}>{x.status.toLowerCase()}</Badge>
        {x.overdue && <Badge tone="error">Assessment overdue</Badge>}
      </div>
      <p className="mt-2 text-sm">{x.description}</p>
      <p className="mt-1 text-sm text-text-muted">
        Reported by {x.reportedBy}; aware from {new Date(x.discoveredAt).toLocaleString('en-AU')};{' '}
        {x.individuals} people; kinds:{' '}
        {x.dataKinds.length ? x.dataKinds.join(', ').toLowerCase().replace(/_/g, ' ') : 'not stated'}.
        Assessment due <strong>{dateOnly(x.assessmentDue)}</strong> (
        {x.daysLeft >= 0 ? `${x.daysLeft} days left` : `${-x.daysLeft} days late`}).
      </p>

      <h4 className="mt-5 text-sm font-bold uppercase tracking-wide text-text-muted">
        Likelihood of serious harm
      </h4>
      <p className="mt-1 text-xs text-text-muted">{x.disclaimer}</p>
      {a && (
        <div
          className="mt-2 rounded-lg border border-border bg-surface-alt p-3 text-sm"
          data-testid="assessment"
        >
          <p>
            <Badge tone={a.recommendation === 'Notifiable' ? 'error' : 'success'}>{a.recommendation}</Badge>{' '}
            <span className="ml-2">
              Score {a.score} against a threshold of {a.threshold}.
            </span>
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {a.because.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {a.reason && <p className="mt-2 text-xs">Reason recorded: {a.reason}</p>}
        </div>
      )}
      {!closed && (
        <form
          className="mt-3 flex max-w-3xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              'assess',
              'assess',
              {
                answers: Object.fromEntries(qs.data!.questions.map((q) => [q.id, answers[q.id] === 'yes'])),
                ...(reason.trim().length >= 10 ? { reason } : {}),
              },
              'Assessment recorded.',
            );
          }}
        >
          {qs.data.questions.map((q) => (
            <Field key={q.id} label={q.text} hint={q.help}>
              <Select
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value as 'yes' | 'no' })}
              >
                <option value="">Choose</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
          ))}
          <Field
            label="Reason for not notifying"
            hint="Needed to close an incident that is assessed as not notifiable (10 characters or more)."
          >
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" loading={busy === 'assess'} disabled={!allAnswered || busy !== null}>
              {a ? 'Assess again' : 'Record assessment'}
            </Button>
          </div>
        </form>
      )}

      <h4 className="mt-5 text-sm font-bold uppercase tracking-wide text-text-muted">Containment</h4>
      <ul className="mt-1">
        {x.containment.map((c) => (
          <li key={c.key}>
            <Checkbox
              label={`${c.label}${c.done && c.doneBy ? ` (${c.doneBy})` : ''}`}
              checked={c.done}
              disabled={closed || busy !== null}
              onChange={(e) => void act('c', 'containment', { key: c.key, done: e.target.checked })}
            />
          </li>
        ))}
      </ul>

      {a?.recommendation === 'Notifiable' && (
        <>
          <h4 className="mt-5 text-sm font-bold uppercase tracking-wide text-text-muted">
            Notices (drafts; sending is simulated)
          </h4>
          <div className="mt-2 grid gap-4 lg:grid-cols-2">
            {(['REGULATOR', 'INDIVIDUALS'] as const).map((aud) => {
              const n = x.notifications.find((y) => y.audience === aud);
              const label = aud === 'REGULATOR' ? 'Regulator (OAIC)' : 'Affected individuals';
              return (
                <div key={aud} className="rounded-lg border border-border p-3">
                  <p className="font-semibold">
                    {label}{' '}
                    {n && (
                      <Badge tone={n.status === 'SENT_SIMULATED' ? 'success' : 'info'}>
                        {n.status === 'SENT_SIMULATED' ? 'Sent (simulated)' : 'Draft'}
                      </Badge>
                    )}
                  </p>
                  {n?.record && (
                    <p className="mt-1 text-xs text-text-muted">
                      {n.record.connector}: {n.record.reference}, {n.record.recipients} recipient(s). Nothing
                      was actually sent.
                    </p>
                  )}
                  {n && (
                    <>
                      <Button variant="ghost" onClick={() => setShown(shown === aud ? null : aud)}>
                        {shown === aud ? 'Hide text' : 'Show text'}
                      </Button>
                      {shown === aud && (
                        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-alt p-2 text-xs">
                          {n.subject}
                          {'\n\n'}
                          {n.body}
                        </pre>
                      )}
                    </>
                  )}
                  {!closed && n?.status !== 'SENT_SIMULATED' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(
                            'd',
                            `notifications/${aud}/draft`,
                            undefined,
                            'Draft created from the template.',
                          )
                        }
                      >
                        {n ? 'Redraft' : 'Draft notice'}
                      </Button>
                      {n && (
                        <Button
                          disabled={busy !== null}
                          onClick={() =>
                            void act(
                              's',
                              `notifications/${aud}/send`,
                              undefined,
                              'Recorded as sent through the messaging connector (simulated).',
                            )
                          }
                        >
                          Send (simulated)
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {x.lessons && (
        <p className="mt-4 text-sm">
          <strong>Lessons learned:</strong> {x.lessons}
        </p>
      )}
      {!closed && a && (
        <form
          className="mt-5 flex max-w-2xl flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('close', 'close', { lessons }, 'Incident closed.');
          }}
        >
          <Field label="Lessons learned" hint="Needed to close the incident (10 characters or more).">
            <Textarea rows={2} value={lessons} onChange={(e) => setLessons(e.target.value)} />
          </Field>
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={busy === 'close'}
              disabled={lessons.trim().length < 10 || busy !== null}
            >
              Close incident
            </Button>
          </div>
        </form>
      )}
      {messages}
    </Card>
  );
}

/** Report a suspected data breach (anyone); assess, contain, draft notices and close it (managers) (SEC-IR05). */
export function IncidentsPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const manager = has(roles, 'ADMIN', 'PROBITY', 'LEGAL', 'EXEC');
  const mine = useData<{
    items: Array<{ id: string; number: string; title: string; status: string; reportedAt: string }>;
  }>('/incidents/mine');
  const reg = useData<RegisterView>(manager ? '/incidents' : null);
  const rem = useRun();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const reload = async () => {
    await mine.reload();
    await reg.reload();
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Report csrf={csrf} done={reload} />
      {(mine.data?.items ?? []).length > 0 && (
        <Card>
          <h2 className="font-heading text-xl font-bold">Your reports</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {mine.data!.items.map((i) => (
              <li key={i.id}>
                {i.number}: {i.title} ({i.status.toLowerCase()})
              </li>
            ))}
          </ul>
        </Card>
      )}
      {manager && reg.data && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-xl font-bold">Incident register</h2>
            <Button
              variant="secondary"
              loading={rem.busy === 'rem'}
              disabled={rem.busy !== null}
              onClick={() =>
                void rem.run('rem', async () => {
                  const r = await send<{ reminded: number; escalated: number }>(
                    csrf,
                    'POST',
                    '/incidents/run-reminders',
                  );
                  setNote(`${r.reminded} reminded, ${r.escalated} escalated.`);
                  await reload();
                })
              }
            >
              Send deadline reminders
            </Button>
          </div>
          {rem.messages}
          {note && (
            <p role="status" className="mt-2 text-sm font-medium text-success">
              {note}
            </p>
          )}
          <p className="mt-2 text-sm" data-testid="incident-summary">
            {reg.data.summary.open} open, {reg.data.summary.overdue} past the 30-day assessment deadline,{' '}
            {reg.data.summary.notifiable} assessed as notifiable.
          </p>
          <p className="mt-1 max-w-prose text-xs text-text-muted">{reg.data.disclaimer}</p>
          {reg.data.items.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">No incidents have been reported.</p>
          ) : (
            <div className="mt-3">
              <Table caption="Data breach incidents, soonest assessment deadline first">
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Title</Th>
                    <Th>Status</Th>
                    <Th>Assessment due</Th>
                    <Th>Recommendation</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {reg.data.items.map((i) => (
                    <tr key={i.id}>
                      <Td label="Number">{i.number}</Td>
                      <Td label="Title">{i.title}</Td>
                      <Td label="Status">
                        <Badge tone={TONE[i.status]}>{i.status.toLowerCase()}</Badge>
                      </Td>
                      <Td label="Assessment due">
                        {dateOnly(i.assessmentDue)}
                        {i.overdue && <Badge tone="error">Overdue</Badge>}
                      </Td>
                      <Td label="Recommendation">{i.recommendation ?? 'Not assessed'}</Td>
                      <Td label="Action">
                        <Button
                          variant="secondary"
                          aria-label={`Open ${i.number}`}
                          onClick={() => setOpen(i.id)}
                        >
                          Open
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      )}
      {manager && open && <Manage key={open} id={open} csrf={csrf} reload={reload} />}
    </div>
  );
}
