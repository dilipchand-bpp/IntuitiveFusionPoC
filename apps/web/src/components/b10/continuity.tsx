'use client';
import { useState } from 'react';
import {
  AiBadge,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  type BadgeTone,
} from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Options {
  kinds: Array<{ key: string; label: string }>;
  severities: string[];
  groups: Array<{ key: string; label: string }>;
  smsLimit: number;
  suppliers: Array<{ id: string; company: string; contracts: number }>;
  contracts: Array<{ id: string; number: string; title: string; supplier: string; owner: string | null }>;
  escalationPeople: Array<{ id: string; name: string; role: string }>;
}
interface EventRow {
  id: string;
  number: string;
  title: string;
  kindLabel: string;
  severity: string;
  status: string;
  recipients: number;
  answered: number;
  needHelp: number;
}
interface Channel {
  channel: 'SMS' | 'EMAIL';
  status: string;
  gatewayId: string | null;
  failure: string | null;
}
interface Recipient {
  id: string;
  name: string;
  group: string;
  organisation: string | null;
  phone: string;
  email: string;
  response: string;
  note: string | null;
  via: string | null;
  channels: Channel[];
  reached: boolean;
}
interface Tracker {
  event: {
    id: string;
    number: string;
    title: string;
    severity: string;
    status: string;
    message: string;
    smsText: string;
    smsLength: number;
    escalateAfterMinutes: number;
    escalateTo: string | null;
    escalatedAt: string | null;
    summary: string | null;
  };
  counts: Record<string, number>;
  recipients: Recipient[];
  log: Array<{
    id: string;
    channel: string;
    kind: string;
    toName: string;
    to: string;
    status: string;
    body: string;
  }>;
  simulatedLinks?: Array<{ responseId: string; name: string; path: string }>;
}
const ANS: Record<string, { label: string; tone: BadgeTone }> = {
  NONE: { label: 'No answer', tone: 'neutral' },
  SAFE: { label: 'Safe', tone: 'success' },
  AFFECTED: { label: 'Affected', tone: 'warning' },
  NEED_HELP: { label: 'Needs help', tone: 'error' },
};
const MSG: Record<string, BadgeTone> = {
  QUEUED: 'neutral',
  SENT: 'info',
  DELIVERED: 'success',
  FAILED: 'error',
};

/** Raise a continuity event, reach people by SMS and email through the simulated gateway, and track the answers (FR-0860). */
export function ContinuityPage({ csrf, canRaise }: { csrf: string; canRaise: boolean }) {
  const list = useData<{ events: EventRow[] }>('/continuity/events');
  const [sel, setSel] = useState<string | null>(null);
  const [links, setLinks] = useState<Tracker['simulatedLinks']>([]);
  const tr = useData<Tracker>(sel ? `/continuity/events/${sel}` : null);
  const opts = useData<Options>(canRaise ? '/continuity/options' : null);
  const { busy, run, messages } = useRun();
  const [note, setNote] = useState('');
  const refresh = async () => {
    await Promise.all([list.reload(), tr.reload()]);
  };
  const t = tr.data;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Simulated SMS and email gateways</h2>
          <AiBadge kind="simulated" />
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Messages are recorded, never sent. A text message carries no supplier name, contract number or
          amount. Each person gets a one-time link to say whether they are safe.
        </p>
      </Card>
      {messages}
      {canRaise && opts.data && (
        <RaiseForm
          opts={opts.data}
          csrf={csrf}
          busy={busy}
          run={run}
          onRaised={async (out) => {
            setSel(out.event.id);
            setLinks(out.simulatedLinks ?? []);
            await list.reload();
          }}
        />
      )}
      <section aria-labelledby="ev-h" className="flex flex-col gap-3">
        <h2 id="ev-h" className="font-heading text-xl font-bold">
          Events
        </h2>
        <Table caption="Continuity events">
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Event</Th>
              <Th>Severity</Th>
              <Th>Status</Th>
              <Th className="text-right">Answered</Th>
              <Th>Open</Th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.events ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-text-muted">
                  No continuity events yet.
                </td>
              </tr>
            )}
            {(list.data?.events ?? []).map((e) => (
              <tr key={e.id} data-testid="cb-event">
                <Td label="Number">{e.number}</Td>
                <Td label="Event">
                  {e.title} <span className="text-xs text-text-muted">{e.kindLabel}</span>
                </Td>
                <Td label="Severity">{e.severity.toLowerCase()}</Td>
                <Td label="Status">
                  <Badge tone={e.status === 'OPEN' ? 'warning' : 'neutral'}>{e.status.toLowerCase()}</Badge>
                </Td>
                <Td label="Answered" className="text-right">
                  {e.answered} of {e.recipients}
                  {e.needHelp > 0 && <Badge tone="error"> {e.needHelp} need help</Badge>}
                </Td>
                <Td label="Open">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSel(e.id);
                      setLinks([]);
                    }}
                    data-testid={`cb-open-${e.number}`}
                  >
                    Tracker
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {t && (
        <section aria-labelledby="tr-h" className="flex flex-col gap-4" data-testid="cb-tracker">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="tr-h" className="font-heading text-xl font-bold">
              {t.event.number}: {t.event.title}
            </h2>
            <Badge tone={t.event.status === 'OPEN' ? 'warning' : 'neutral'}>
              {t.event.status.toLowerCase()}
            </Badge>
          </div>
          <p className="max-w-prose text-sm">{t.event.message}</p>
          <p className="text-sm text-text-muted">
            Text message ({t.event.smsLength} of 160 characters): <code>{t.event.smsText}</code>
          </p>
          <div className="flex flex-wrap gap-3 text-sm" data-testid="cb-counts">
            <Badge tone="success">{t.counts.safe} safe</Badge>
            <Badge tone="warning">{t.counts.affected} affected</Badge>
            <Badge tone="error">{t.counts.needHelp} need help</Badge>
            <Badge tone="neutral">{t.counts.noResponse} not answered</Badge>
            <Badge tone="info">
              {t.counts.reached} of {t.counts.recipients} reached
            </Badge>
            {(t.counts.queued ?? 0) > 0 && <Badge tone="warning">{t.counts.queued} queued</Badge>}
            {(t.counts.failed ?? 0) > 0 && <Badge tone="error">{t.counts.failed} failed</Badge>}
          </div>
          {t.event.escalateTo && (
            <p className="text-sm text-text-muted">
              {t.event.escalatedAt
                ? `${t.event.escalateTo} was told at ${new Date(t.event.escalatedAt).toLocaleString('en-AU')}.`
                : `${t.event.escalateTo} is told if people have not answered after ${t.event.escalateAfterMinutes} minutes.`}
            </p>
          )}
          {canRaise && t.event.status === 'OPEN' && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={busy === 'resend'}
                data-testid="cb-resend"
                onClick={() =>
                  void run(
                    'resend',
                    async () => {
                      const r = await send<Tracker & { resent: number }>(
                        csrf,
                        'POST',
                        `/continuity/events/${t.event.id}/resend`,
                      );
                      setLinks(r.simulatedLinks ?? []);
                      await refresh();
                    },
                    'Messaged again the people who have not answered.',
                  )
                }
              >
                Resend to non-responders
              </Button>
            </div>
          )}
          {links && links.length > 0 && (
            <Card data-testid="cb-links">
              <h3 className="font-heading text-lg font-bold">One-time links (demonstration only)</h3>
              <p className="text-sm text-text-muted">
                A real gateway puts each link in the person&apos;s message. They are shown once, here.
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {links.map((l) => (
                  <li key={l.responseId}>
                    {l.name}:{' '}
                    <a className="underline" href={l.path}>
                      {l.path}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Table caption="Recipients">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Group</Th>
                <Th>Messages</Th>
                <Th>Answer</Th>
                {canRaise && <Th>Record by phone</Th>}
              </tr>
            </thead>
            <tbody>
              {t.recipients.map((r) => (
                <tr key={r.id} data-testid="cb-recipient">
                  <Td label="Person">
                    <strong>{r.name}</strong>
                    <div className="text-xs text-text-muted">
                      {r.phone} · {r.email}
                    </div>
                  </Td>
                  <Td label="Group">
                    {r.group.toLowerCase().replace('_', ' ')}
                    {r.organisation ? ` (${r.organisation})` : ''}
                  </Td>
                  <Td label="Messages">
                    {r.channels.map((c) => (
                      <div key={c.channel} className="text-xs">
                        {c.channel} <Badge tone={MSG[c.status] ?? 'neutral'}>{c.status.toLowerCase()}</Badge>
                        {c.failure ? ` ${c.failure}` : ''}
                      </div>
                    ))}
                  </Td>
                  <Td label="Answer">
                    <Badge tone={ANS[r.response]!.tone}>{ANS[r.response]!.label}</Badge>
                    {r.via && (
                      <span className="ml-1 text-xs text-text-muted">
                        {r.via === 'WEB_LINK' ? 'by link' : 'by phone'}
                      </span>
                    )}
                    {r.note && <div className="text-xs text-text-muted">{r.note}</div>}
                  </Td>
                  {canRaise && (
                    <Td label="Record by phone">
                      {t.event.status === 'OPEN' ? (
                        <Select
                          aria-label={`Answer taken by phone from ${r.name}`}
                          value=""
                          onChange={(e) => {
                            const response = e.target.value;
                            if (!response) return;
                            void run(
                              `ans-${r.id}`,
                              async () => {
                                await send(
                                  csrf,
                                  'POST',
                                  `/continuity/events/${t.event.id}/responses/${r.id}`,
                                  { response },
                                );
                                await refresh();
                              },
                              `Recorded for ${r.name}.`,
                            );
                          }}
                        >
                          <option value="">Choose…</option>
                          <option value="SAFE">Safe</option>
                          <option value="AFFECTED">Affected</option>
                          <option value="NEED_HELP">Needs help</option>
                        </Select>
                      ) : (
                        '-'
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          {canRaise && t.event.status === 'OPEN' && (
            <Card>
              <h3 className="font-heading text-lg font-bold">Close the event</h3>
              <div className="mt-2 max-w-lg">
                <Field label="Closing note (optional)">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
              <Button
                className="mt-2"
                loading={busy === 'close'}
                data-testid="cb-close"
                onClick={() =>
                  void run(
                    'close',
                    async () => {
                      await send(
                        csrf,
                        'POST',
                        `/continuity/events/${t.event.id}/close`,
                        note.trim() ? { note: note.trim() } : {},
                      );
                      await refresh();
                    },
                    'The event is closed.',
                  )
                }
              >
                Close with a summary
              </Button>
            </Card>
          )}
          {t.event.summary && (
            <Card data-testid="cb-summary">
              <h3 className="font-heading text-lg font-bold">Summary</h3>
              <p className="mt-2 whitespace-pre-line text-sm">{t.event.summary}</p>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function RaiseForm({
  opts,
  csrf,
  busy,
  run,
  onRaised,
}: {
  opts: Options;
  csrf: string;
  busy: string | null;
  run: (name: string, fn: () => Promise<void>, ok?: string) => Promise<boolean>;
  onRaised: (t: Tracker) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('SUPPLIER_OUTAGE');
  const [severity, setSeverity] = useState('HIGH');
  const [msg, setMsg] = useState('');
  const [sms, setSms] = useState('');
  const [sup, setSup] = useState<string[]>([]);
  const [con, setCon] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>(['CONTRACT_OWNER', 'SUPPLIER_CONTACT', 'EXECUTIVE']);
  const [nName, setNName] = useState('');
  const [nEmail, setNEmail] = useState('');
  const [mins, setMins] = useState(30);
  const [esc, setEsc] = useState('');
  const toggle = (set: string[], id: string, f: (x: string[]) => void) =>
    f(set.includes(id) ? set.filter((x) => x !== id) : [...set, id]);
  const named = nName.trim() && nEmail.trim() ? [{ name: nName.trim(), email: nEmail.trim() }] : [];
  return (
    <Card aria-labelledby="rz-h" role="region">
      <h2 id="rz-h" className="font-heading text-xl font-bold">
        Raise an event
      </h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="cb-title" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {opts.kinds.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {opts.severities.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Message (sent by email)" required>
          <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="cb-message" />
        </Field>
        <Field label="Text message note (optional, 40 characters, no names or numbers)">
          <Input value={sms} maxLength={40} onChange={(e) => setSms(e.target.value)} />
        </Field>
      </div>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Affected suppliers</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {opts.suppliers.map((s) => (
            <Checkbox
              key={s.id}
              label={s.company}
              checked={sup.includes(s.id)}
              onChange={() => toggle(sup, s.id, setSup)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Affected contracts</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {opts.contracts.length === 0 && (
            <span className="text-sm text-text-muted">No executed contracts.</span>
          )}
          {opts.contracts.map((c) => (
            <Checkbox
              key={c.id}
              label={`${c.number} ${c.supplier}`}
              checked={con.includes(c.id)}
              onChange={() => toggle(con, c.id, setCon)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Who to reach</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {opts.groups.map((g) => (
            <Checkbox
              key={g.key}
              label={g.label}
              checked={groups.includes(g.key)}
              onChange={() => toggle(groups, g.key, setGroups)}
            />
          ))}
        </div>
      </fieldset>
      <div className="mt-3 grid gap-4 md:grid-cols-4">
        <Field label="Named contact">
          <Input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Name" />
        </Field>
        <Field label="Their email">
          <Input value={nEmail} onChange={(e) => setNEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Escalate after (minutes)">
          <Input
            type="number"
            min={5}
            max={1440}
            value={mins}
            onChange={(e) => setMins(Number(e.target.value))}
          />
        </Field>
        <Field label="Escalate to">
          <Select value={esc} onChange={(e) => setEsc(e.target.value)}>
            <option value="">Nobody</option>
            {opts.escalationPeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button
        className="mt-4"
        loading={busy === 'raise'}
        disabled={!title.trim() || msg.trim().length < 10}
        data-testid="cb-raise"
        onClick={() =>
          void run(
            'raise',
            async () => {
              const out = await send<Tracker>(csrf, 'POST', '/continuity/events', {
                title: title.trim(),
                kind,
                severity,
                message: msg.trim(),
                ...(sms.trim() ? { smsNote: sms.trim() } : {}),
                supplierIds: sup,
                contractIds: con,
                groups: named.length && !groups.includes('NAMED') ? [...groups, 'NAMED'] : groups,
                namedContacts: named,
                escalateAfterMinutes: mins,
                ...(esc ? { escalateToUserId: esc } : {}),
              });
              await onRaised(out);
              setTitle('');
              setMsg('');
            },
            'The alert was sent through the simulated gateways.',
          )
        }
      >
        Raise and send
      </Button>
    </Card>
  );
}
