/**
 * Business-continuity alerts by SMS and email with response trackers (FR-0860). A continuity event (a supplier outage, a site
 * closure, a cyber incident) is raised against the suppliers and contracts it affects. The people to reach are worked out from
 * the data: each affected contract's owner, the contacts of each affected supplier, the executives, and any named contacts.
 * Everyone gets an SMS and an email through the SIMULATED gateway (the MESSAGING connector; nothing is ever sent) and a one-time
 * link on which they say "I am safe", "I am affected" or "I need help". Staff can record an answer taken by phone. A tracker
 * shows who has been reached and who has not answered; the people who have not answered can be messaged again, and a named
 * person is told if there are still silent recipients after N minutes.
 *
 * SMS text is built from a fixed template and a short note that is checked: it never carries a supplier name, a contract
 * number, a value or any other commercial detail. One-time links are kept only as a hash and are never written to a message log.
 *
 * SWAP POINT (docs/swap-points.md): `simulatedGateway` below stands for an SMS and email service (for example Amazon SNS or
 * Pinpoint for SMS and Amazon SES for email). It receives a batch and answers for each message; delivery receipts arrive later.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  appUser,
  contract,
  continuityEvent,
  continuityMessage,
  continuityResponse,
  manualTask,
  notification,
  roleAssignment,
  supplier,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { getConnector } from '../b10conn/connectors.js';
import { callProvider } from '../b10conn/resilience.js';

export const KINDS = {
  SUPPLIER_OUTAGE: 'Supplier outage',
  SITE_CLOSURE: 'Site closure',
  CYBER_INCIDENT: 'Cyber incident',
  OTHER: 'Other disruption',
} as const;
export type EventKind = keyof typeof KINDS;
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const RESPONSES = ['SAFE', 'AFFECTED', 'NEED_HELP'] as const;
export type Answer = (typeof RESPONSES)[number];
export const GROUPS = ['CONTRACT_OWNER', 'SUPPLIER_CONTACT', 'EXECUTIVE', 'NAMED'] as const;
export type GroupKey = (typeof GROUPS)[number];

/** A text message is kept short: one SMS segment. */
export const SMS_LIMIT = 160;
/** The reachable link host in a message. A real deployment uses the portal's own address. */
export const LINK_HOST = 'if.example';
export const SMS_RECEIPT_MINUTES = 1;
export const EMAIL_RECEIPT_MINUTES = 2;

export interface ContinuityDeps {
  clock: Clock;
  audit: AuditService;
  sleep?: (ms: number) => Promise<void>;
}
type EventRow = typeof continuityEvent.$inferSelect;
type ResponseRow = typeof continuityResponse.$inferSelect;
type MessageRow = typeof continuityMessage.$inferSelect;

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(16).toString('base64url');
const sys = (tenantId: string, userId: string | null = null): RequestContext => ({
  tenantId,
  userId,
  role: 'SYSTEM',
});
export const tokenHashOf = hash;

/** A made-up but stable mobile number for a person, derived from their email. Real numbers come from the HR system. */
export function syntheticPhone(email: string): string {
  const h = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const digits = h.replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10));
  return `+61 4${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)}`;
}
export const maskPhone = (p: string) => `${p.slice(0, 6)}•• •••${p.slice(-3)}`;

// ---------------------------------------------------------------------------------------------- the message text
/** The SMS: fixed words and a number. The note is checked first; see `checkSmsNote`. */
export function smsFor(i: {
  kind: EventKind;
  severity: string;
  number: string;
  note?: string | undefined;
}): string {
  const note = i.note ? ` ${i.note.trim().replace(/[.!?]*$/, '')}.` : '';
  const link = `${LINK_HOST}/respond/${'x'.repeat(22)}`;
  const text = `IF ALERT ${i.severity} ${KINDS[i.kind]} ${i.number}.${note} Tell us you are safe: ${link}`;
  return text;
}
export const smsWithLink = (template: string, token: string) =>
  template.replace(`/respond/${'x'.repeat(22)}`, `/respond/${token}`);
/** The text as it is kept in the message log: the link's token is masked, because the log is readable by staff. */
export const smsForLog = (template: string) =>
  template.replace(`/respond/${'x'.repeat(22)}`, '/respond/[one-time link]');

/** Words that are in many company names and say nothing about which supplier it is. */
const GENERIC_NAME_WORDS = new Set([
  'limited',
  'services',
  'solutions',
  'group',
  'australia',
  'australian',
  'holdings',
  'company',
  'trading',
  'cleaning',
  'security',
  'catering',
  'landscape',
  'landscaping',
  'uniforms',
  'paper',
  'supplies',
  'systems',
  'technology',
  'partners',
  'consulting',
]);

/**
 * A short note on the SMS may not carry anything commercial: a supplier name, a contract or request number, a dollar amount,
 * an ABN or a long number. Only plain characters, at most 40.
 */
export function checkSmsNote(note: string, secretNames: string[]): string | null {
  if (note.length > 40) return 'Keep the text message note to 40 characters';
  if (!/^[A-Za-z0-9 ,.'-]*$/.test(note))
    return 'Use plain letters, numbers and punctuation in the text message note';
  if (/\b[A-Za-z]{2,6}-[A-Za-z0-9-]*\d/.test(note) || /\d{5,}/.test(note) || /(\$|AUD|ABN)/i.test(note))
    return 'A text message must not carry contract or request numbers, amounts or identifiers';
  const lower = note.toLowerCase();
  // the whole name, or any distinctive word of it ("Brightwave" of "Brightwave Cleaning Pty Ltd")
  const words = (n: string) =>
    n
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w));
  for (const n of secretNames)
    if (
      (n.length > 2 && lower.includes(n.toLowerCase())) ||
      words(n).some((w) => new RegExp(`\\b${w}\\b`).test(lower))
    )
      return 'A text message must not name a supplier. Use the email for detail.';
  return null;
}

export function emailFor(i: {
  event: Pick<EventRow, 'title' | 'message' | 'number' | 'severity' | 'kind'>;
  recipient: { name: string; group: GroupKey; organisation: string | null };
  affected: { contracts: string[]; suppliers: string[] };
  kind: 'ALERT' | 'REMINDER';
}): { subject: string; body: string } {
  const lead =
    i.kind === 'REMINDER'
      ? `Reminder: we have not yet heard from you about ${i.event.number}.`
      : `A business-continuity alert has been raised (${i.event.number}).`;
  // a supplier contact is told about their own organisation only, never about other suppliers or contract numbers
  const scope =
    i.recipient.group === 'SUPPLIER_CONTACT'
      ? `Affected: ${i.recipient.organisation ?? 'your organisation'}.`
      : [
          i.affected.suppliers.length ? `Affected suppliers: ${i.affected.suppliers.join(', ')}.` : '',
          i.affected.contracts.length ? `Affected contracts: ${i.affected.contracts.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
  return {
    subject: `[${i.event.severity}] ${i.event.title} (${i.event.number})`,
    body: [
      `Hello ${i.recipient.name},`,
      lead,
      `${KINDS[i.event.kind as EventKind]}: ${i.event.message}`,
      scope,
      'Please tell us whether you are safe, affected or need help using the one-time response link sent with this message. It works once per person and you can change your answer until the event is closed.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

// ---------------------------------------------------------------------------------------------- the simulated gateway
interface GatewayItem {
  id: string;
  channel: 'SMS' | 'EMAIL';
  to: string;
  attempt: number;
}
interface GatewayResult {
  id: string;
  ok: boolean;
  gatewayId: string;
  failure: string | null;
}
/** The simulated gateway: accepts a batch and answers for each message. A number ending 0000 and a bounce.example mailbox fail. */
export function simulatedGateway(eventId: string, items: GatewayItem[]): GatewayResult[] {
  return items.map((m) => {
    const gatewayId = `${m.channel === 'SMS' ? 'SMS' : 'EML'}-${createHash('sha1')
      .update(`${eventId}|${m.id}|${m.attempt}`)
      .digest('hex')
      .slice(0, 10)
      .toUpperCase()}`;
    const bad =
      m.channel === 'SMS'
        ? /0000\s*$/.test(m.to)
          ? 'The number cannot be reached (simulated)'
          : null
        : /@bounce\.example$/i.test(m.to)
          ? 'The mailbox does not exist (simulated)'
          : null;
    return { id: m.id, ok: !bad, gatewayId, failure: bad };
  });
}

/**
 * Hands every queued message of an event to the gateway through the resilient layer. When the messaging connector is down,
 * switched off or has an open breaker, the messages stay QUEUED, one manual task asks a person to phone the recipients, and the
 * run is retried by the scheduled run (or the next resend).
 */
export async function dispatchQueued(tx: Tx, d: ContinuityDeps, tenantId: string, eventId: string) {
  const queued = await tx
    .select()
    .from(continuityMessage)
    .where(
      and(
        eq(continuityMessage.tenantId, tenantId),
        eq(continuityMessage.eventId, eventId),
        eq(continuityMessage.status, 'QUEUED'),
      ),
    );
  if (queued.length === 0) return { sent: 0, failed: 0, queued: 0 };
  const conn = await getConnector(tx, tenantId, 'MESSAGING');
  const now = d.clock.now();
  const out =
    conn && conn.enabled
      ? await callProvider(
          tx,
          { clock: d.clock, ...(d.sleep ? { sleep: d.sleep } : {}) },
          tenantId,
          'MESSAGING',
          async () =>
            simulatedGateway(
              eventId,
              queued.map((m) => ({ id: m.id, channel: m.channel, to: m.toAddress, attempt: m.attempt })),
            ),
          { fallback: () => null, retries: 1 },
        )
      : null;
  if (!out || !out.ok || !out.value) {
    const [ev] = await tx.select().from(continuityEvent).where(eq(continuityEvent.id, eventId));
    const open = (
      await tx
        .select()
        .from(manualTask)
        .where(
          and(
            eq(manualTask.tenantId, tenantId),
            eq(manualTask.connectorKind, 'MESSAGING'),
            eq(manualTask.status, 'OPEN'),
          ),
        )
    ).find((t) => (t.payloadSummary as { eventId?: string }).eventId === eventId);
    if (!open && ev)
      await tx.insert(manualTask).values({
        tenantId,
        connectorKind: 'MESSAGING',
        title: `Phone the people for continuity event ${ev.number}`,
        instructions: `The messaging gateway is not available, so ${queued.length} message(s) are waiting. Phone each person who has not answered, then record their answer on the tracker ("Record an answer taken by phone"). The messages are sent when the gateway is back.`,
        payloadSummary: { eventId, number: ev.number, queued: queued.length },
        createdAt: now,
      });
    return { sent: 0, failed: 0, queued: queued.length };
  }
  let sent = 0;
  let failed = 0;
  for (const r of out.value) {
    const ok = r.ok;
    await tx
      .update(continuityMessage)
      .set(
        ok
          ? { status: 'SENT', gatewayId: r.gatewayId, sentAt: now, failure: null }
          : { status: 'FAILED', gatewayId: r.gatewayId, sentAt: now, failure: r.failure },
      )
      .where(eq(continuityMessage.id, r.id));
    if (ok) sent += 1;
    else failed += 1;
  }
  // the gateway is back: a task asking for phone calls is no longer needed
  await tx
    .update(manualTask)
    .set({ status: 'SUPERSEDED', completedAt: now })
    .where(
      and(
        eq(manualTask.tenantId, tenantId),
        eq(manualTask.connectorKind, 'MESSAGING'),
        eq(manualTask.status, 'OPEN'),
        sql`${manualTask.payloadSummary}->>'eventId' = ${eventId}`,
      ),
    );
  return { sent, failed, queued: 0 };
}

/** Delivery receipts: a message the gateway accepted is reported delivered a little later (deterministic, by the clock). */
export async function applyReceipts(tx: Tx, d: ContinuityDeps, tenantId: string, eventId?: string) {
  const now = d.clock.now();
  const sent = await tx
    .select()
    .from(continuityMessage)
    .where(
      and(
        eq(continuityMessage.tenantId, tenantId),
        eq(continuityMessage.status, 'SENT'),
        ...(eventId ? [eq(continuityMessage.eventId, eventId)] : []),
      ),
    );
  let n = 0;
  for (const m of sent) {
    const wait = (m.channel === 'SMS' ? SMS_RECEIPT_MINUTES : EMAIL_RECEIPT_MINUTES) * 60_000;
    if (m.sentAt && now.getTime() - m.sentAt.getTime() >= wait) {
      await tx
        .update(continuityMessage)
        .set({ status: 'DELIVERED', deliveredAt: new Date(m.sentAt.getTime() + wait) })
        .where(eq(continuityMessage.id, m.id));
      n += 1;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------- raising an event
export interface RaiseInput {
  title: string;
  kind: EventKind;
  severity: (typeof SEVERITIES)[number];
  message: string;
  smsNote?: string | undefined;
  supplierIds: string[];
  contractIds: string[];
  groups: GroupKey[];
  namedContacts: Array<{ name: string; email: string; phone?: string | undefined }>;
  escalateAfterMinutes: number;
  escalateToUserId?: string | undefined;
  responseValidHours: number;
}

interface Person {
  userId: string | null;
  name: string;
  email: string;
  phone: string;
  group: GroupKey;
  organisation: string | null;
}

/** The people a continuity event reaches, worked out from the data. First group listed for a person wins. */
export async function recipientsFor(
  tx: Tx,
  tenantId: string,
  i: Pick<RaiseInput, 'groups' | 'namedContacts'>,
  affected: {
    contracts: Array<typeof contract.$inferSelect>;
    supplierIds: string[];
    suppliers: Map<string, string>;
  },
): Promise<Person[]> {
  const out: Person[] = [];
  const add = (p: Person) => {
    if (!out.some((x) => x.email.toLowerCase() === p.email.toLowerCase())) out.push(p);
  };
  if (i.groups.includes('CONTRACT_OWNER')) {
    const owners = [
      ...new Set(affected.contracts.map((c) => c.ownerId).filter((x): x is string => Boolean(x))),
    ];
    const users = owners.length
      ? await tx
          .select()
          .from(appUser)
          .where(and(eq(appUser.tenantId, tenantId), inArray(appUser.id, owners), eq(appUser.active, true)))
      : [];
    for (const u of users)
      add({
        userId: u.id,
        name: u.name,
        email: u.email,
        phone: syntheticPhone(u.email),
        group: 'CONTRACT_OWNER',
        organisation: null,
      });
  }
  if (i.groups.includes('SUPPLIER_CONTACT') && affected.supplierIds.length) {
    const users = await tx
      .select()
      .from(appUser)
      .where(
        and(
          eq(appUser.tenantId, tenantId),
          inArray(appUser.supplierId, affected.supplierIds),
          eq(appUser.active, true),
        ),
      );
    for (const u of users.sort((a, b) => a.email.localeCompare(b.email)))
      add({
        userId: u.id,
        name: u.name,
        email: u.email,
        phone: syntheticPhone(u.email),
        group: 'SUPPLIER_CONTACT',
        organisation: u.supplierId ? (affected.suppliers.get(u.supplierId) ?? null) : null,
      });
  }
  if (i.groups.includes('EXECUTIVE')) {
    const rows = await tx
      .select({ u: appUser })
      .from(roleAssignment)
      .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
      .where(
        and(eq(roleAssignment.tenantId, tenantId), eq(roleAssignment.role, 'EXEC'), eq(appUser.active, true)),
      );
    for (const { u } of rows.sort((a, b) => a.u.email.localeCompare(b.u.email)))
      add({
        userId: u.id,
        name: u.name,
        email: u.email,
        phone: syntheticPhone(u.email),
        group: 'EXECUTIVE',
        organisation: null,
      });
  }
  if (i.groups.includes('NAMED'))
    for (const n of i.namedContacts)
      add({
        userId: null,
        name: n.name,
        email: n.email.trim().toLowerCase(),
        phone: n.phone?.trim() || syntheticPhone(n.email),
        group: 'NAMED',
        organisation: null,
      });
  return out;
}

export async function nextNumber(tx: Tx, tenantId: string): Promise<string> {
  const rows = await tx
    .select({ n: continuityEvent.number })
    .from(continuityEvent)
    .where(eq(continuityEvent.tenantId, tenantId));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.n.replace(/\D/g, '')) || 0), 0);
  return `BC-${String(max + 1).padStart(4, '0')}`;
}

export interface Raised {
  event: EventRow;
  links: Array<{ responseId: string; name: string; path: string }>;
  recipients: number;
}

export async function raiseEvent(
  tx: Tx,
  d: ContinuityDeps,
  ctx: RequestContext,
  i: RaiseInput,
): Promise<Raised> {
  const now = d.clock.now();
  const tenantId = ctx.tenantId;
  const contracts = i.contractIds.length
    ? await tx
        .select()
        .from(contract)
        .where(and(eq(contract.tenantId, tenantId), inArray(contract.id, i.contractIds)))
    : [];
  if (contracts.length !== new Set(i.contractIds).size)
    throw new AppError(422, 'UNKNOWN_CONTRACT', 'One of the affected contracts was not found');
  const supplierIds = [...new Set([...i.supplierIds, ...contracts.map((c) => c.supplierId)])];
  const sups = supplierIds.length
    ? await tx
        .select()
        .from(supplier)
        .where(and(eq(supplier.tenantId, tenantId), inArray(supplier.id, supplierIds)))
    : [];
  if (sups.length !== supplierIds.length)
    throw new AppError(422, 'UNKNOWN_SUPPLIER', 'One of the affected suppliers was not found');
  if (supplierIds.length === 0 && i.kind === 'SUPPLIER_OUTAGE')
    throw new AppError(422, 'AFFECTED_REQUIRED', 'Pick the supplier or contract that is affected', [
      { field: 'supplierIds', message: 'Pick at least one affected supplier or contract' },
    ]);
  if (i.smsNote) {
    const bad = checkSmsNote(i.smsNote, [...sups.map((s) => s.company), ...contracts.map((c) => c.number)]);
    if (bad) throw new AppError(422, 'SMS_NOT_PLAIN', bad, [{ field: 'smsNote', message: bad }]);
  }
  if (i.escalateToUserId) {
    const [u] = await tx
      .select()
      .from(appUser)
      .where(
        and(eq(appUser.id, i.escalateToUserId), eq(appUser.tenantId, tenantId), eq(appUser.active, true)),
      );
    if (!u || u.supplierId)
      throw new AppError(422, 'UNKNOWN_USER', 'The person to escalate to was not found');
  }
  const people = await recipientsFor(tx, tenantId, i, {
    contracts,
    supplierIds,
    suppliers: new Map(sups.map((s) => [s.id, s.company])),
  });
  if (people.length === 0)
    throw new AppError(
      422,
      'NO_RECIPIENTS',
      'Nobody would be reached. Pick a group that has people in it, or add a named contact.',
      [{ field: 'groups', message: 'No recipients found for the chosen groups' }],
    );
  const number = await nextNumber(tx, tenantId);
  const smsText = smsFor({ kind: i.kind, severity: i.severity, number, note: i.smsNote });
  if (smsText.length > SMS_LIMIT)
    throw new AppError(
      422,
      'SMS_TOO_LONG',
      `The text message is ${smsText.length} characters; the limit is ${SMS_LIMIT}. Shorten the note.`,
      [{ field: 'smsNote', message: `Shorten the note so the message fits ${SMS_LIMIT} characters` }],
    );
  const [ev] = await tx
    .insert(continuityEvent)
    .values({
      tenantId,
      number,
      title: i.title,
      kind: i.kind,
      severity: i.severity,
      message: i.message,
      smsText,
      emailSubject: `[${i.severity}] ${i.title} (${number})`,
      affectedSupplierIds: supplierIds,
      affectedContractIds: contracts.map((c) => c.id),
      groups: i.groups,
      escalateAfterMinutes: i.escalateAfterMinutes,
      escalateToUserId: i.escalateToUserId ?? null,
      responseValidHours: i.responseValidHours,
      raisedBy: ctx.userId!,
      raisedAt: now,
    })
    .returning();
  const links: Raised['links'] = [];
  const affected = {
    contracts: contracts.map((c) => c.number),
    suppliers: sups.map((s) => s.company),
  };
  for (const p of people) {
    const token = newToken();
    const [r] = await tx
      .insert(continuityResponse)
      .values({
        tenantId,
        eventId: ev!.id,
        userId: p.userId,
        name: p.name,
        email: p.email,
        phone: p.phone,
        groupKey: p.group,
        organisation: p.organisation,
        tokenHash: hash(token),
        tokenExpiresAt: new Date(now.getTime() + i.responseValidHours * 3_600_000),
        createdAt: now,
      })
      .returning();
    links.push({ responseId: r!.id, name: p.name, path: `/respond/${token}` });
    if (p.userId)
      await tx.insert(notification).values({
        tenantId,
        userId: p.userId,
        title: `Continuity alert ${number}: please tell us you are safe`,
        body: `${KINDS[i.kind]}, ${i.severity.toLowerCase()}. This link works once per person and expires in ${i.responseValidHours} hours.`,
        link: `/respond/${token}`,
      });
    await queueMessages(tx, d, ev!, r!, affected, 'ALERT', 1);
  }
  await d.audit.record(tx, ctx, {
    action: 'continuity.raise',
    entityType: 'continuity_event',
    entityId: ev!.id,
    after: {
      number,
      kind: i.kind,
      severity: i.severity,
      suppliers: supplierIds.length,
      contracts: contracts.length,
      recipients: people.length,
      groups: i.groups,
    },
  });
  await dispatchQueued(tx, d, tenantId, ev!.id);
  return { event: ev!, links, recipients: people.length };
}

/** Puts the SMS and the email for one person in the gateway queue. The SMS text is the checked template, never free text. */
async function queueMessages(
  tx: Tx,
  d: ContinuityDeps,
  ev: EventRow,
  r: ResponseRow,
  affected: { contracts: string[]; suppliers: string[] },
  kind: 'ALERT' | 'REMINDER',
  attempt: number,
) {
  const mail = emailFor({
    event: ev,
    recipient: { name: r.name, group: r.groupKey, organisation: r.organisation },
    affected,
    kind,
  });
  const now = d.clock.now();
  await tx.insert(continuityMessage).values([
    {
      tenantId: ev.tenantId,
      eventId: ev.id,
      responseId: r.id,
      toName: r.name,
      channel: 'SMS',
      toAddress: r.phone,
      body: smsForLog(ev.smsText),
      kind,
      attempt,
      queuedAt: now,
    },
    {
      tenantId: ev.tenantId,
      eventId: ev.id,
      responseId: r.id,
      toName: r.name,
      channel: 'EMAIL',
      toAddress: r.email,
      subject: mail.subject,
      body: mail.body,
      kind,
      attempt,
      queuedAt: now,
    },
  ]);
}

/** Names and numbers of what an event affects, for the text of an email. */
export async function affectedOf(tx: Tx, ev: EventRow) {
  const cIds = ev.affectedContractIds as string[];
  const sIds = ev.affectedSupplierIds as string[];
  const cs = cIds.length ? await tx.select().from(contract).where(inArray(contract.id, cIds)) : [];
  const ss = sIds.length ? await tx.select().from(supplier).where(inArray(supplier.id, sIds)) : [];
  return {
    contracts: cs.map((c) => c.number),
    suppliers: ss.map((s) => s.company),
    contractRows: cs,
    supplierRows: ss,
  };
}

// ---------------------------------------------------------------------------------------------- answering
export type AnswerVia = 'WEB_LINK' | 'STAFF_PHONE';

export async function recordAnswer(
  tx: Tx,
  d: ContinuityDeps,
  ctx: RequestContext,
  ev: EventRow,
  r: ResponseRow,
  input: { response: Answer; note?: string | undefined; via: AnswerVia },
) {
  if (ev.status !== 'OPEN')
    throw new AppError(
      409,
      'EVENT_CLOSED',
      'This event has been closed, so answers can no longer be changed',
    );
  const now = d.clock.now();
  const history = [
    ...(r.history as Array<Record<string, unknown>>),
    { response: input.response, via: input.via, at: now.toISOString(), by: ctx.userId },
  ];
  const changed = r.response !== 'NONE' && r.response !== input.response;
  const [row] = await tx
    .update(continuityResponse)
    .set({
      response: input.response,
      note: input.note?.slice(0, 300) ?? null,
      via: input.via,
      respondedAt: now,
      recordedBy: input.via === 'STAFF_PHONE' ? ctx.userId : null,
      changeCount: r.changeCount + (changed ? 1 : 0),
      history,
    })
    .where(eq(continuityResponse.id, r.id))
    .returning();
  await d.audit.record(tx, ctx, {
    action: 'continuity.respond',
    entityType: 'continuity_event',
    entityId: ev.id,
    after: { group: r.groupKey, response: input.response, via: input.via, changed },
  });
  if (input.response === 'NEED_HELP')
    await tx.insert(notification).values({
      tenantId: ev.tenantId,
      userId: ev.raisedBy,
      title: `${ev.number}: ${r.name} needs help`,
      body: `${r.name} answered "I need help" (${input.via === 'WEB_LINK' ? 'from the link' : 'recorded by phone'}).`,
      link: '/app/continuity',
    });
  return row!;
}

/** A new link for each person who has not answered, and the SMS and email again. Old links stop working. */
export async function resendToNonResponders(tx: Tx, d: ContinuityDeps, ctx: RequestContext, ev: EventRow) {
  if (ev.status !== 'OPEN') throw new AppError(409, 'EVENT_CLOSED', 'This event has been closed');
  const now = d.clock.now();
  const rows = await tx
    .select()
    .from(continuityResponse)
    .where(and(eq(continuityResponse.eventId, ev.id), eq(continuityResponse.response, 'NONE')))
    .orderBy(asc(continuityResponse.name));
  const prior = await tx.select().from(continuityMessage).where(eq(continuityMessage.eventId, ev.id));
  const affected = await affectedOf(tx, ev);
  const links: Raised['links'] = [];
  for (const r of rows) {
    const token = newToken();
    await tx
      .update(continuityResponse)
      .set({
        tokenHash: hash(token),
        tokenExpiresAt: new Date(now.getTime() + ev.responseValidHours * 3_600_000),
      })
      .where(eq(continuityResponse.id, r.id));
    links.push({ responseId: r.id, name: r.name, path: `/respond/${token}` });
    if (r.userId)
      await tx.insert(notification).values({
        tenantId: ev.tenantId,
        userId: r.userId,
        title: `Reminder: continuity alert ${ev.number}`,
        body: 'We have not heard from you. Please say whether you are safe, affected or need help.',
        link: `/respond/${token}`,
      });
    const attempt = prior.filter((m) => m.responseId === r.id && m.channel === 'SMS').length + 1;
    await queueMessages(tx, d, ev, r, affected, 'REMINDER', attempt);
  }
  await d.audit.record(tx, ctx, {
    action: 'continuity.resend',
    entityType: 'continuity_event',
    entityId: ev.id,
    after: { nonResponders: rows.length },
  });
  const sent = await dispatchQueued(tx, d, ev.tenantId, ev.id);
  return { nonResponders: rows.length, links, ...sent };
}

/** Closes the event with a summary of who answered what and how many messages got through. */
export async function closeEvent(
  tx: Tx,
  d: ContinuityDeps,
  ctx: RequestContext,
  ev: EventRow,
  note?: string,
) {
  if (ev.status !== 'OPEN') throw new AppError(409, 'EVENT_CLOSED', 'This event is already closed');
  await applyReceipts(tx, d, ev.tenantId, ev.id);
  const now = d.clock.now();
  const rs = await tx.select().from(continuityResponse).where(eq(continuityResponse.eventId, ev.id));
  const ms = await tx.select().from(continuityMessage).where(eq(continuityMessage.eventId, ev.id));
  const count = (a: Answer | 'NONE') => rs.filter((r) => r.response === a).length;
  const minutes = Math.round((now.getTime() - ev.raisedAt.getTime()) / 60_000);
  const help = rs.filter((r) => r.response === 'NEED_HELP').map((r) => r.name);
  const silent = rs.filter((r) => r.response === 'NONE').map((r) => r.name);
  const summary = [
    `${ev.number} closed after ${minutes} minute(s). ${rs.length} recipient(s): ${count('SAFE')} safe, ${count('AFFECTED')} affected, ${count('NEED_HELP')} need help, ${count('NONE')} did not answer.`,
    `Messages: ${ms.length} in all, ${ms.filter((m) => m.status === 'DELIVERED').length} delivered, ${ms.filter((m) => m.status === 'SENT').length} sent, ${ms.filter((m) => m.status === 'QUEUED').length} still queued, ${ms.filter((m) => m.status === 'FAILED').length} failed.`,
    help.length ? `Asked for help: ${help.join(', ')}.` : '',
    silent.length ? `No answer from: ${silent.join(', ')}.` : '',
    ev.escalatedAt ? 'The named person was told when people had not answered in time.' : '',
    note ? `Note: ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const [row] = await tx
    .update(continuityEvent)
    .set({ status: 'CLOSED', closedBy: ctx.userId, closedAt: now, summary })
    .where(eq(continuityEvent.id, ev.id))
    .returning();
  // the links no longer accept answers; the manual task for phone calls is no longer needed
  await tx
    .update(manualTask)
    .set({ status: 'SUPERSEDED', completedAt: now })
    .where(
      and(
        eq(manualTask.tenantId, ev.tenantId),
        eq(manualTask.connectorKind, 'MESSAGING'),
        eq(manualTask.status, 'OPEN'),
        sql`${manualTask.payloadSummary}->>'eventId' = ${ev.id}`,
      ),
    );
  await d.audit.record(tx, ctx, {
    action: 'continuity.close',
    entityType: 'continuity_event',
    entityId: ev.id,
    after: {
      safe: count('SAFE'),
      affected: count('AFFECTED'),
      needHelp: count('NEED_HELP'),
      noAnswer: count('NONE'),
      minutes,
    },
  });
  return row!;
}

// ---------------------------------------------------------------------------------------------- escalation
/** If the event has been open for the set time and some people have still not answered, the named person is told, once. */
export async function escalateIfDue(tx: Tx, d: ContinuityDeps, ev: EventRow): Promise<boolean> {
  if (ev.status !== 'OPEN' || ev.escalatedAt || !ev.escalateToUserId) return false;
  const now = d.clock.now();
  if (now.getTime() < ev.raisedAt.getTime() + ev.escalateAfterMinutes * 60_000) return false;
  const silent = await tx
    .select()
    .from(continuityResponse)
    .where(and(eq(continuityResponse.eventId, ev.id), eq(continuityResponse.response, 'NONE')))
    .orderBy(asc(continuityResponse.name));
  if (silent.length === 0) return false;
  const [u] = await tx.select().from(appUser).where(eq(appUser.id, ev.escalateToUserId));
  if (!u) return false;
  const claimed = await tx
    .update(continuityEvent)
    .set({ escalatedAt: now })
    .where(and(eq(continuityEvent.id, ev.id), sql`${continuityEvent.escalatedAt} is null`))
    .returning({ id: continuityEvent.id });
  if (claimed.length === 0) return false;
  await tx.insert(notification).values({
    tenantId: ev.tenantId,
    userId: u.id,
    title: `Escalation: ${silent.length} people have not answered ${ev.number}`,
    body: `${ev.escalateAfterMinutes} minutes after the alert, ${silent.length} recipient(s) have not answered. Open the tracker.`,
    link: '/app/continuity',
  });
  const sms = `IF ALERT ${ev.severity} ${ev.number} escalation: ${silent.length} recipient(s) have not answered after ${ev.escalateAfterMinutes} min. Open the tracker in the portal.`;
  await tx.insert(continuityMessage).values([
    {
      tenantId: ev.tenantId,
      eventId: ev.id,
      responseId: null,
      toName: u.name,
      channel: 'SMS',
      toAddress: syntheticPhone(u.email),
      body: sms.slice(0, SMS_LIMIT),
      kind: 'ESCALATION',
      queuedAt: now,
    },
    {
      tenantId: ev.tenantId,
      eventId: ev.id,
      responseId: null,
      toName: u.name,
      channel: 'EMAIL',
      toAddress: u.email,
      subject: `Escalation: ${ev.number} has ${silent.length} recipient(s) who have not answered`,
      body: `Hello ${u.name},\n\n${ev.escalateAfterMinutes} minutes after ${ev.number} (${ev.title}) was raised, these people have not answered: ${silent.map((s) => s.name).join(', ')}.\n\nOpen the continuity tracker in the portal to message them again or to record an answer taken by phone.`,
      kind: 'ESCALATION',
      queuedAt: now,
    },
  ]);
  await d.audit.record(tx, sys(ev.tenantId), {
    action: 'continuity.escalate',
    entityType: 'continuity_event',
    entityId: ev.id,
    after: { to: u.name, nonResponders: silent.length, afterMinutes: ev.escalateAfterMinutes },
  });
  await dispatchQueued(tx, d, ev.tenantId, ev.id);
  return true;
}

/** What the scheduled run does for every open event: retry queued messages, record receipts, escalate if due. */
export async function housekeeping(tx: Tx, d: ContinuityDeps, ev: EventRow) {
  await dispatchQueued(tx, d, ev.tenantId, ev.id);
  await applyReceipts(tx, d, ev.tenantId, ev.id);
  await escalateIfDue(tx, d, ev);
}

// ---------------------------------------------------------------------------------------------- views
export async function trackerView(tx: Tx, ev: EventRow) {
  const rs = await tx
    .select()
    .from(continuityResponse)
    .where(eq(continuityResponse.eventId, ev.id))
    .orderBy(asc(continuityResponse.groupKey), asc(continuityResponse.name));
  const ms = await tx
    .select()
    .from(continuityMessage)
    .where(eq(continuityMessage.eventId, ev.id))
    .orderBy(asc(continuityMessage.queuedAt));
  const [raiser] = await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, ev.raisedBy));
  const [esc] = ev.escalateToUserId
    ? await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, ev.escalateToUserId))
    : [];
  const aff = await affectedOf(tx, ev);
  const channelsOf = (id: string) => {
    const mine = ms.filter((m) => m.responseId === id);
    const latest = (c: 'SMS' | 'EMAIL') =>
      mine
        .filter((m) => m.channel === c)
        .sort((a, b) => b.attempt - a.attempt || b.queuedAt.getTime() - a.queuedAt.getTime())[0];
    return (['SMS', 'EMAIL'] as const).flatMap((c) => {
      const m = latest(c);
      return m
        ? [
            {
              channel: c,
              status: m.status,
              gatewayId: m.gatewayId,
              failure: m.failure,
              attempts: mine.filter((x) => x.channel === c).length,
              sentAt: m.sentAt?.toISOString() ?? null,
              deliveredAt: m.deliveredAt?.toISOString() ?? null,
            },
          ]
        : [];
    });
  };
  const recipients = rs.map((r) => {
    const channels = channelsOf(r.id);
    const reached = channels.some((c) => c.status === 'SENT' || c.status === 'DELIVERED');
    return {
      id: r.id,
      name: r.name,
      group: r.groupKey,
      organisation: r.organisation,
      email: r.email,
      phone: maskPhone(r.phone),
      response: r.response,
      note: r.note,
      via: r.via,
      respondedAt: r.respondedAt?.toISOString() ?? null,
      changeCount: r.changeCount,
      linkExpiresAt: r.tokenExpiresAt.toISOString(),
      channels,
      reached,
    };
  });
  const count = (a: string) => rs.filter((r) => r.response === a).length;
  return {
    simulated: true as const,
    event: {
      id: ev.id,
      number: ev.number,
      title: ev.title,
      kind: ev.kind,
      kindLabel: KINDS[ev.kind],
      severity: ev.severity,
      status: ev.status,
      message: ev.message,
      smsText: smsForLog(ev.smsText),
      smsLength: ev.smsText.length,
      emailSubject: ev.emailSubject,
      groups: ev.groups as string[],
      affectedSuppliers: aff.suppliers,
      affectedContracts: aff.contracts,
      escalateAfterMinutes: ev.escalateAfterMinutes,
      escalateTo: esc?.name ?? null,
      escalatedAt: ev.escalatedAt?.toISOString() ?? null,
      responseValidHours: ev.responseValidHours,
      raisedBy: raiser?.name ?? '',
      raisedAt: ev.raisedAt.toISOString(),
      closedAt: ev.closedAt?.toISOString() ?? null,
      summary: ev.summary,
    },
    counts: {
      recipients: rs.length,
      safe: count('SAFE'),
      affected: count('AFFECTED'),
      needHelp: count('NEED_HELP'),
      noResponse: count('NONE'),
      reached: recipients.filter((r) => r.reached).length,
      notReached: recipients.filter((r) => !r.reached).length,
      messages: ms.length,
      queued: ms.filter((m) => m.status === 'QUEUED').length,
      failed: ms.filter((m) => m.status === 'FAILED').length,
    },
    recipients,
    log: ms.map((m) => ({
      id: m.id,
      channel: m.channel,
      kind: m.kind,
      to: m.channel === 'SMS' ? maskPhone(m.toAddress) : m.toAddress,
      toName: m.toName,
      status: m.status,
      gatewayId: m.gatewayId,
      failure: m.failure,
      body: m.body,
      queuedAt: m.queuedAt.toISOString(),
    })),
  };
}

export async function listEvents(tx: Tx, tenantId: string) {
  const evs = await tx
    .select()
    .from(continuityEvent)
    .where(eq(continuityEvent.tenantId, tenantId))
    .orderBy(desc(continuityEvent.raisedAt));
  const rs = evs.length
    ? await tx.select().from(continuityResponse).where(eq(continuityResponse.tenantId, tenantId))
    : [];
  return evs.map((e) => {
    const mine = rs.filter((r) => r.eventId === e.id);
    return {
      id: e.id,
      number: e.number,
      title: e.title,
      kind: e.kind,
      kindLabel: KINDS[e.kind],
      severity: e.severity,
      status: e.status,
      raisedAt: e.raisedAt.toISOString(),
      closedAt: e.closedAt?.toISOString() ?? null,
      recipients: mine.length,
      answered: mine.filter((r) => r.response !== 'NONE').length,
      needHelp: mine.filter((r) => r.response === 'NEED_HELP').length,
    };
  });
}

export type { EventRow, ResponseRow, MessageRow };
