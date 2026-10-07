/**
 * SEC-IR05: data breach assessment and notification workflow, following the logic of the Australian Notifiable Data
 * Breaches (NDB) scheme in Part IIIC of the Privacy Act 1988.
 *
 * The rule set below is DECISION SUPPORT, not legal advice, and is labelled rules-simulated-v1. An eligible data breach is
 * unauthorised access to, disclosure of or loss of personal information that is likely to result in serious harm to
 * any of the individuals, where remedial action has not prevented that likelihood. The entity has 30 days from becoming
 * aware to complete a reasonable assessment. If it is an eligible data breach the entity notifies the regulator (the
 * Office of the Australian Information Commissioner) and the affected individuals.
 *
 * The gates (personal information? unauthorised? remedial action taken?) decide "not notifiable" on their own. Past the
 * gates the answers add weights to a score; 5 or more recommends "Notifiable", less recommends "Not notifiable", and that
 * outcome needs the reason recorded before the incident can be closed.
 *
 * Notifications are drafts from templates with merge fields. Sending is SIMULATED through the MESSAGING connector: a
 * record is kept, nothing is sent (swap point: docs/swap-points.md, "Messaging").
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { appUser, breachIncident, notification, roleAssignment, tenant } from '../../db/schema.js';
import { DATA_CLASSES } from '../../db/schema-b11b.js';
import { AppError } from '../../http/errors.js';
import { callProvider } from '../b10conn/resilience.js';
import { addDays, iso } from '../contract/dates.js';
import { outboundClock } from './outbound.js';

export const BREACH_MODEL = 'rules-simulated-v1';
export const NOTIFIABLE = 'Notifiable';
export const NOT_NOTIFIABLE = 'Not notifiable (record the reason)';
export const ASSESSMENT_DAYS = 30;
export const REMINDER_LEAD_DAYS = 7;
export const MANAGERS = ['ADMIN', 'PROBITY', 'LEGAL', 'EXEC'] as const;
export const NOTIFIABLE_THRESHOLD = 5;

export type IncidentRow = typeof breachIncident.$inferSelect;

export interface Question {
  id: string;
  text: string;
  /** A gate answered the wrong way ends the assessment as not notifiable. */
  gate?: { when: boolean; reason: string };
  weight?: number;
  help: string;
}

export const QUESTIONS: readonly Question[] = [
  {
    id: 'personalInfo',
    text: 'Does the incident involve personal information about individuals?',
    gate: { when: false, reason: 'No personal information is involved, so the NDB scheme does not apply.' },
    help: 'Information about an identified or reasonably identifiable person.',
  },
  {
    id: 'unauthorised',
    text: 'Was the information accessed, disclosed or lost without authorisation?',
    gate: { when: false, reason: 'There was no unauthorised access, disclosure or loss.' },
    help: 'Includes a lost device, a wrong recipient and an intruder.',
  },
  {
    id: 'remediated',
    text: 'Has remedial action already been taken that makes serious harm unlikely for everyone affected?',
    gate: {
      when: true,
      reason:
        'Remedial action taken before any serious harm has made serious harm unlikely (exception in section 26WF).',
    },
    help: 'For example the data was recovered unread, or the recipient confirmed deletion.',
  },
  {
    id: 'sensitive',
    text: 'Is sensitive information involved (health, tax file numbers, government identifiers)?',
    weight: 3,
    help: 'Health information and government identifiers cause the most harm when exposed.',
  },
  {
    id: 'financial',
    text: 'Is financial information involved that could be used for fraud (bank or card details)?',
    weight: 3,
    help: 'Bank account and BSB, card numbers, payment credentials.',
  },
  {
    id: 'credentials',
    text: 'Are credentials or identity documents involved?',
    weight: 2,
    help: 'Passwords, licences, passports.',
  },
  {
    id: 'malicious',
    text: 'Has the information been, or could it be, obtained by someone with malicious intent, or been published?',
    weight: 3,
    help: 'An attacker, a public website, a wrong recipient who has not confirmed deletion.',
  },
  {
    id: 'vulnerable',
    text: 'Are vulnerable people affected (children, people at risk of harm)?',
    weight: 2,
    help: 'Serious harm is more likely for these people.',
  },
  {
    id: 'protected',
    text: 'Was the information protected so it cannot be read (strong encryption with the key not exposed)?',
    weight: -3,
    help: 'Encrypted data whose key was not lost is unlikely to cause harm.',
  },
];

export interface Assessment {
  model: string;
  answers: Record<string, boolean>;
  individualsPoints: number;
  score: number;
  threshold: number;
  recommendation: typeof NOTIFIABLE | typeof NOT_NOTIFIABLE;
  /** The rule that decided, in words. */
  because: string[];
  /** The person's reason for not notifying; required to close a not-notifiable incident. */
  reason: string | null;
  assessedBy: string;
  assessedAt: string;
  disclaimer: string;
}

export const DISCLAIMER =
  'Decision support from fixed rules (rules-simulated-v1) that follow the logic of the Notifiable Data Breaches scheme. It is not legal advice; Legal makes the decision.';

export const individualsPoints = (n: number) => (n >= 1000 ? 3 : n >= 100 ? 2 : n >= 10 ? 1 : 0);

export function assess(
  answers: Record<string, boolean>,
  individuals: number,
): Pick<Assessment, 'score' | 'recommendation' | 'because' | 'individualsPoints' | 'threshold'> {
  const because: string[] = [];
  for (const q of QUESTIONS)
    if (q.gate && answers[q.id] === q.gate.when) {
      because.push(q.gate.reason);
      return {
        score: 0,
        recommendation: NOT_NOTIFIABLE,
        because,
        individualsPoints: 0,
        threshold: NOTIFIABLE_THRESHOLD,
      };
    }
  let score = 0;
  for (const q of QUESTIONS) {
    if (!q.weight || answers[q.id] !== true) continue;
    score += q.weight;
    because.push(`${q.weight > 0 ? '+' : ''}${q.weight}: ${q.text}`);
  }
  const ip = individualsPoints(individuals);
  if (ip) {
    score += ip;
    because.push(`+${ip}: ${individuals.toLocaleString('en-AU')} individuals affected`);
  }
  const notifiable = score >= NOTIFIABLE_THRESHOLD;
  because.push(
    `Score ${score} against a threshold of ${NOTIFIABLE_THRESHOLD}: ${notifiable ? 'serious harm is likely' : 'serious harm is not likely on these answers'}.`,
  );
  return {
    score,
    recommendation: notifiable ? NOTIFIABLE : NOT_NOTIFIABLE,
    because,
    individualsPoints: ip,
    threshold: NOTIFIABLE_THRESHOLD,
  };
}

export const CONTAINMENT_STEPS = [
  { key: 'stop', label: 'Stop the unauthorised access or disclosure' },
  { key: 'recover', label: 'Recover or delete the information where possible' },
  { key: 'credentials', label: 'Reset affected credentials and revoke sessions' },
  { key: 'evidence', label: 'Preserve evidence and logs' },
  { key: 'individuals', label: 'Identify the individuals affected' },
  { key: 'owners', label: 'Tell the security owner and Legal' },
] as const;
export interface ContainmentItem {
  key: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
}
export const freshContainment = (): ContainmentItem[] =>
  CONTAINMENT_STEPS.map((s) => ({ ...s, done: false, doneAt: null, doneBy: null }));

export const TEMPLATES = {
  REGULATOR: {
    subject: 'Notifiable data breach statement: {{organisation}} ({{incidentNumber}})',
    body:
      'To the Office of the Australian Information Commissioner,\n\n' +
      '{{organisation}} gives notice of an eligible data breach under Part IIIC of the Privacy Act 1988.\n\n' +
      'Incident reference: {{incidentNumber}}\nBecame aware: {{discoveredAt}}\n\n' +
      'What happened: {{description}}\n\nKinds of information involved: {{dataKinds}}\n' +
      'Number of individuals at risk of serious harm: {{individuals}}\n\n' +
      'Steps taken so far: {{stepsTaken}}\nRecommended steps for individuals: change passwords where relevant, watch for suspicious contact and contact {{contact}} with questions.\n\n' +
      'Contact: {{contact}}\n',
  },
  INDIVIDUALS: {
    subject: 'Important notice about your personal information',
    body:
      'Dear {{individualName}},\n\n' +
      '{{organisation}} is writing to tell you about a data breach that may affect you (reference {{incidentNumber}}).\n\n' +
      'What happened: {{description}}\n\nWhat information was involved: {{dataKinds}}\n\n' +
      'What we have done: {{stepsTaken}}\n\n' +
      'What you can do: be alert to unexpected calls, emails or messages, change any passwords you think were affected and contact {{contact}} if you need help.\n\n' +
      'We are sorry this happened.\n{{organisation}}\n',
  },
} as const;
export type Audience = keyof typeof TEMPLATES;

/** Fills `{{field}}` placeholders. Fields not given stay in place and are listed so a person fills them before sending. */
export function merge(
  template: string,
  values: Record<string, string>,
): { text: string; unfilled: string[] } {
  const unfilled = new Set<string>();
  const text = template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    if (k in values) return values[k]!;
    unfilled.add(k);
    return m;
  });
  return { text, unfilled: [...unfilled] };
}

export interface NotificationDraft {
  audience: Audience;
  subject: string;
  body: string;
  unfilled: string[];
  status: 'DRAFT' | 'SENT_SIMULATED';
  draftedAt: string;
  draftedBy: string;
  sentAt?: string;
  sentBy?: string;
  record?: { connector: string; reference: string; recipients: number; simulated: true };
}

export async function nextNumber(tx: Tx, tenantId: string): Promise<string> {
  const rows = await tx
    .select({ id: breachIncident.id })
    .from(breachIncident)
    .where(eq(breachIncident.tenantId, tenantId));
  return `INC-${String(rows.length + 1).padStart(4, '0')}`;
}

export const dataKindsOk = (kinds: string[]) =>
  kinds.every((k) => (DATA_CLASSES as readonly string[]).includes(k));

export interface Names {
  get(id: string): string | undefined;
}
export async function namesOf(tx: Tx, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!uniq.length) return new Map();
  const rows = await tx
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(inArray(appUser.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function incidentView(r: IncidentRow, names: Map<string, string>, now: Date, detail: boolean) {
  const today = iso(now);
  const assessed = r.assessment !== null;
  const base = {
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    reportedBy: names.get(r.reportedBy) ?? null,
    reportedAt: r.reportedAt.toISOString(),
    discoveredAt: r.discoveredAt.toISOString(),
    dataKinds: r.dataKinds as string[],
    individuals: r.individualsCount,
    assessmentDue: r.assessmentDue,
    assessed,
    overdue: !assessed && r.status !== 'CLOSED' && r.assessmentDue < today,
    daysLeft: Math.round(
      (new Date(`${r.assessmentDue}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
    recommendation: (r.assessment as Assessment | null)?.recommendation ?? null,
    escalatedAt: r.escalatedAt?.toISOString() ?? null,
  };
  if (!detail) return base;
  return {
    ...base,
    description: r.description,
    assessment: r.assessment as Assessment | null,
    containment: r.containment as ContainmentItem[],
    notifications: r.notifications as NotificationDraft[],
    reminders: r.reminders as Array<{ kind: string; at: string }>,
    lessons: r.lessons,
    closedAt: r.closedAt?.toISOString() ?? null,
    closedBy: r.closedBy ? (names.get(r.closedBy) ?? null) : null,
    model: BREACH_MODEL,
    disclaimer: DISCLAIMER,
  };
}

export async function notifyRoles(
  tx: Tx,
  tenantId: string,
  roles: readonly string[],
  title: string,
  body: string,
) {
  const users = await tx
    .select({ userId: roleAssignment.userId })
    .from(roleAssignment)
    .where(and(eq(roleAssignment.tenantId, tenantId), inArray(roleAssignment.role, roles as never)));
  for (const u of [...new Set(users.map((x) => x.userId))])
    await tx.insert(notification).values({
      tenantId,
      userId: u,
      title,
      body,
      link: '/app/incidents',
      event: 'BREACH_DEADLINE',
      read: false,
    });
}

/**
 * Reminds, then escalates, incidents whose 30-day assessment has not been done. A reminder goes out
 * REMINDER_LEAD_DAYS before the due date and an escalation to the executive the day after it. Each goes once.
 */
export async function runReminders(
  tx: Tx,
  tenantId: string,
  actorId: string | null,
): Promise<{ reminded: number; escalated: number }> {
  const clock = outboundClock();
  const now = clock.now();
  const today = iso(now);
  const rows = await tx
    .select()
    .from(breachIncident)
    .where(
      and(
        eq(breachIncident.tenantId, tenantId),
        eq(breachIncident.status, 'OPEN'),
        isNull(breachIncident.assessment),
      ),
    );
  const ctx: RequestContext = { tenantId, userId: actorId, role: actorId ? null : 'SYSTEM' };
  const audit = new AuditService(clock);
  let reminded = 0;
  let escalated = 0;
  for (const r of rows) {
    const done = r.reminders as Array<{ kind: string; at: string }>;
    if (r.assessmentDue < today && !done.some((x) => x.kind === 'ESCALATION')) {
      await tx
        .update(breachIncident)
        .set({
          reminders: [...done, { kind: 'ESCALATION', at: now.toISOString() }],
          escalatedAt: now,
          updatedAt: now,
        })
        .where(eq(breachIncident.id, r.id));
      await notifyRoles(
        tx,
        tenantId,
        ['EXEC', 'ADMIN', 'LEGAL', 'PROBITY'],
        `Breach ${r.number} has missed its assessment deadline`,
        `The 30-day assessment was due on ${r.assessmentDue} and has not been recorded.`,
      );
      await audit.record(tx, ctx, {
        action: 'breach.escalated',
        entityType: 'breach_incident',
        entityId: r.id,
        after: { number: r.number, assessmentDue: r.assessmentDue },
      });
      escalated += 1;
    } else if (
      addDays(r.assessmentDue, -REMINDER_LEAD_DAYS) <= today &&
      r.assessmentDue >= today &&
      !done.some((x) => x.kind === 'REMINDER')
    ) {
      await tx
        .update(breachIncident)
        .set({ reminders: [...done, { kind: 'REMINDER', at: now.toISOString() }], updatedAt: now })
        .where(eq(breachIncident.id, r.id));
      await notifyRoles(
        tx,
        tenantId,
        MANAGERS,
        `Breach ${r.number}: assessment due ${r.assessmentDue}`,
        `Record the assessment before ${r.assessmentDue}.`,
      );
      await audit.record(tx, ctx, {
        action: 'breach.reminder',
        entityType: 'breach_incident',
        entityId: r.id,
        after: { number: r.number, assessmentDue: r.assessmentDue },
      });
      reminded += 1;
    }
  }
  return { reminded, escalated };
}

/** Builds the draft for an audience from the template, with the incident's own values merged in. */
export async function draftNotification(
  tx: Tx,
  r: IncidentRow,
  audience: Audience,
  by: { id: string; name: string; email: string },
): Promise<NotificationDraft> {
  const [t] = await tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, r.tenantId));
  const steps = (r.containment as ContainmentItem[]).filter((c) => c.done).map((c) => c.label.toLowerCase());
  const values: Record<string, string> = {
    organisation: t?.name ?? 'The organisation',
    incidentNumber: r.number,
    discoveredAt: r.discoveredAt.toISOString().slice(0, 10),
    description: r.description,
    dataKinds: (r.dataKinds as string[]).length
      ? (r.dataKinds as string[]).map((k) => k.toLowerCase().replace(/_/g, ' ')).join(', ')
      : 'to be confirmed',
    individuals: String(r.individualsCount),
    stepsTaken: steps.length ? `${steps.join('; ')}.` : 'Containment steps are under way.',
    contact: `${by.name} (${by.email})`,
    // merged per person when the notice is sent, so it is not an open field
    individualName: '{{individualName}}',
  };
  const subject = merge(TEMPLATES[audience].subject, values);
  const body = merge(TEMPLATES[audience].body, values);
  return {
    audience,
    subject: subject.text,
    body: body.text,
    unfilled: [...new Set([...subject.unfilled, ...body.unfilled])],
    status: 'DRAFT',
    draftedAt: outboundClock().now().toISOString(),
    draftedBy: by.id,
  };
}

/**
 * Sends a draft. SIMULATED: goes through the MESSAGING connector (so a disabled, down or out-of-region gateway stops it)
 * and a record is kept; nothing is sent.
 */
export async function sendDraft(
  tx: Tx,
  r: IncidentRow,
  d: NotificationDraft,
  by: { id: string },
): Promise<{ ok: true; draft: NotificationDraft } | { ok: false; error: AppError }> {
  const clock = outboundClock();
  const recipients = d.audience === 'REGULATOR' ? 1 : Math.max(r.individualsCount, 1);
  const out = await callProvider(
    tx,
    { clock },
    r.tenantId,
    'MESSAGING',
    async () => ({
      reference: `SIM-MSG-${createHash('sha256').update(`${r.id}:${d.audience}:${d.draftedAt}`).digest('hex').slice(0, 10).toUpperCase()}`,
    }),
    { fallback: () => null },
  );
  if (!out.ok || !out.value) {
    const blocked = !out.ok && (out.reason === 'RESIDENCY_VIOLATION' || out.reason === 'EGRESS_BLOCKED');
    return {
      ok: false,
      error: new AppError(
        blocked ? 422 : 502,
        blocked && !out.ok ? out.reason : 'SEND_FAILED',
        out.ok ? 'The messaging gateway did not accept the notice' : `The notice was not sent: ${out.error}`,
      ),
    };
  }
  return {
    ok: true,
    draft: {
      ...d,
      status: 'SENT_SIMULATED',
      sentAt: clock.now().toISOString(),
      sentBy: by.id,
      record: {
        connector: 'MESSAGING (simulated)',
        reference: out.value.reference,
        recipients,
        simulated: true,
      },
    },
  };
}
