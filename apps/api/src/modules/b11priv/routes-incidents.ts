/**
 * B11b routes, part 3: data breach assessment and notification (SEC-IR05). Anyone on the staff can report; the
 * administrator, probity, legal and executive roles manage. The rules are in breach.ts.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { breachIncident } from '../../db/schema.js';
import { DATA_CLASSES } from '../../db/schema-b11b.js';
import { AppError, parse } from '../../http/errors.js';
import { addDays, iso } from '../contract/dates.js';
import {
  ASSESSMENT_DAYS,
  BREACH_MODEL,
  DISCLAIMER,
  MANAGERS,
  NOTIFIABLE,
  NOT_NOTIFIABLE,
  QUESTIONS,
  assess,
  draftNotification,
  freshContainment,
  incidentView,
  namesOf,
  nextNumber,
  notifyRoles,
  runReminders,
  sendDraft,
  type Assessment,
  type Audience,
  type ContainmentItem,
  type IncidentRow,
  type NotificationDraft,
} from './breach.js';
import { STAFF, type B11Deps } from './routes-residency.js';

const uuid = z.string().uuid();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const reportBody = z
  .object({
    title: text(5, 150),
    description: text(10, 4000),
    discoveredAt: z.string().datetime().optional(),
    dataKinds: z.array(z.enum(DATA_CLASSES)).max(5).default([]),
    individuals: z.number().int().min(0).max(100_000_000).default(0),
  })
  .strict();
const assessBody = z
  .object({
    answers: z.record(z.string(), z.boolean()),
    reason: text(10, 1000).optional(),
  })
  .strict();
const audienceParam = z.object({ id: uuid, audience: z.enum(['REGULATOR', 'INDIVIDUALS']) });

export function registerIncidentRoutes(app: FastifyInstance, p: string, d: B11Deps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const now = () => d.clock.now();

  const load = async (tx: Tx, tenantId: string, id: string) => {
    const [r] = await tx
      .select()
      .from(breachIncident)
      .where(and(eq(breachIncident.id, id), eq(breachIncident.tenantId, tenantId)));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Incident not found');
    return r;
  };
  const detail = async (tx: Tx, r: IncidentRow) =>
    incidentView(r, await namesOf(tx, [r.reportedBy, r.closedBy]), now(), true);
  const notClosed = (r: IncidentRow) => {
    if (r.status === 'CLOSED') throw new AppError(409, 'INCIDENT_CLOSED', 'This incident is closed');
  };

  reg('POST', '/incidents/report');
  app.post(`${p}/incidents/report`, { preHandler: guard(d, [...STAFF]) }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(reportBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const discovered = b.discoveredAt ? new Date(b.discoveredAt) : now();
      if (discovered.getTime() > now().getTime() + 60_000)
        throw new AppError(422, 'VALIDATION_FAILED', 'The discovery time cannot be in the future', [
          { field: 'discoveredAt', message: 'Use the time you became aware of the incident' },
        ]);
      const [row] = await tx
        .insert(breachIncident)
        .values({
          tenantId: a.user.tenantId,
          number: await nextNumber(tx, a.user.tenantId),
          title: b.title,
          description: b.description,
          reportedBy: a.user.id,
          reportedAt: now(),
          discoveredAt: discovered,
          dataKinds: b.dataKinds,
          individualsCount: b.individuals,
          containment: freshContainment(),
          assessmentDue: addDays(iso(discovered), ASSESSMENT_DAYS),
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'breach.reported',
        entityType: 'breach_incident',
        entityId: row!.id,
        after: {
          number: row!.number,
          dataKinds: b.dataKinds,
          individuals: b.individuals,
          assessmentDue: row!.assessmentDue,
        },
      });
      await notifyRoles(
        tx,
        a.user.tenantId,
        MANAGERS,
        `Data breach reported: ${row!.number}`,
        `${b.title}. The 30-day assessment is due on ${row!.assessmentDue}.`,
      );
      return row!;
    });
    // a reporter who is not a manager sees only that it was received; they do not get the management view
    return reply.status(201).send({
      id: out.id,
      number: out.number,
      status: out.status,
      assessmentDue: out.assessmentDue,
      message: 'Your report was received. Legal, probity and the administrator have been told.',
    });
  });

  reg('GET', '/incidents/mine');
  app.get(`${p}/incidents/mine`, { preHandler: guard(d, [...STAFF]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(breachIncident)
        .where(and(eq(breachIncident.tenantId, a.user.tenantId), eq(breachIncident.reportedBy, a.user.id)))
        .orderBy(desc(breachIncident.reportedAt));
      return {
        items: rows.map((r) => ({
          id: r.id,
          number: r.number,
          title: r.title,
          status: r.status,
          reportedAt: r.reportedAt.toISOString(),
        })),
      };
    });
  });

  reg('GET', '/incidents/questions');
  app.get(`${p}/incidents/questions`, { preHandler: guard(d, [...MANAGERS]) }, async () => ({
    model: BREACH_MODEL,
    simulated: true,
    disclaimer: DISCLAIMER,
    threshold: 5,
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      help: q.help,
      kind: q.gate ? 'GATE' : 'WEIGHT',
      weight: q.weight ?? null,
      gateAnswerEndsAssessment: q.gate ? q.gate.when : null,
    })),
  }));

  reg('GET', '/incidents');
  app.get(`${p}/incidents`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(breachIncident)
        .where(eq(breachIncident.tenantId, a.user.tenantId))
        .orderBy(asc(breachIncident.assessmentDue), desc(breachIncident.reportedAt));
      const names = await namesOf(
        tx,
        rows.map((r) => r.reportedBy),
      );
      const items = rows.map((r) => incidentView(r, names, now(), false));
      return {
        model: BREACH_MODEL,
        disclaimer: DISCLAIMER,
        summary: {
          open: items.filter((i) => i.status !== 'CLOSED').length,
          overdue: items.filter((i) => i.overdue).length,
          notifiable: items.filter((i) => i.recommendation === NOTIFIABLE && i.status !== 'CLOSED').length,
        },
        items,
      };
    });
  });

  reg('POST', '/incidents/run-reminders');
  app.post(`${p}/incidents/run-reminders`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => runReminders(tx, a.user.tenantId, a.user.id));
  });

  reg('GET', '/incidents/{id}');
  app.get(`${p}/incidents/:id`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    return withContext(d.database, a.ctx, async (tx) => detail(tx, await load(tx, a.user.tenantId, id)));
  });

  reg('POST', '/incidents/{id}/assess');
  app.post(`${p}/incidents/:id/assess`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(assessBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await load(tx, a.user.tenantId, id);
      notClosed(r);
      const known = new Set(QUESTIONS.map((q) => q.id));
      const unknown = Object.keys(b.answers).filter((k) => !known.has(k));
      if (unknown.length)
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Some answers are not for a known question',
          unknown.map((k) => ({ field: `answers.${k}`, message: 'Not a question' })),
        );
      const missing = QUESTIONS.filter((q) => b.answers[q.id] === undefined);
      if (missing.length)
        throw new AppError(
          422,
          'VALIDATION_FAILED',
          'Answer every question',
          missing.map((q) => ({ field: `answers.${q.id}`, message: 'Answer yes or no' })),
        );
      const res = assess(b.answers, r.individualsCount);
      const assessment: Assessment = {
        model: BREACH_MODEL,
        answers: b.answers,
        individualsPoints: res.individualsPoints,
        score: res.score,
        threshold: res.threshold,
        recommendation: res.recommendation,
        because: res.because,
        reason: res.recommendation === NOT_NOTIFIABLE ? (b.reason ?? null) : null,
        assessedBy: a.user.id,
        assessedAt: now().toISOString(),
        disclaimer: DISCLAIMER,
      };
      const [row] = await tx
        .update(breachIncident)
        .set({
          assessment,
          status: r.status === 'OPEN' ? 'ASSESSING' : r.status,
          updatedAt: now(),
        })
        .where(eq(breachIncident.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'breach.assessed',
        entityType: 'breach_incident',
        entityId: id,
        before: { recommendation: (r.assessment as Assessment | null)?.recommendation ?? null },
        after: {
          recommendation: assessment.recommendation,
          score: assessment.score,
          reason: assessment.reason,
          late: iso(now()) > r.assessmentDue,
        },
      });
      return detail(tx, row!);
    });
  });

  reg('POST', '/incidents/{id}/containment');
  app.post(`${p}/incidents/:id/containment`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ key: z.string().min(1).max(40), done: z.boolean() }).strict(), req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await load(tx, a.user.tenantId, id);
      notClosed(r);
      const list = r.containment as ContainmentItem[];
      if (!list.some((c) => c.key === b.key))
        throw new AppError(404, 'NOT_FOUND', 'No such containment step');
      const next = list.map((c) =>
        c.key === b.key
          ? {
              ...c,
              done: b.done,
              doneAt: b.done ? now().toISOString() : null,
              doneBy: b.done ? a.user.name : null,
            }
          : c,
      );
      const [row] = await tx
        .update(breachIncident)
        .set({ containment: next, updatedAt: now() })
        .where(eq(breachIncident.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'breach.containment',
        entityType: 'breach_incident',
        entityId: id,
        after: { step: b.key, done: b.done },
      });
      return detail(tx, row!);
    });
  });

  reg('POST', '/incidents/{id}/notifications/{audience}/draft');
  app.post(
    `${p}/incidents/:id/notifications/:audience/draft`,
    { preHandler: guard(d, [...MANAGERS]) },
    async (req) => {
      const a = req.auth!;
      const { id, audience } = parse(audienceParam, req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const r = await load(tx, a.user.tenantId, id);
        notClosed(r);
        const assessment = r.assessment as Assessment | null;
        if (!assessment)
          throw new AppError(409, 'NOT_ASSESSED', 'Record the assessment before drafting notices');
        if (assessment.recommendation !== NOTIFIABLE)
          throw new AppError(
            409,
            'NOT_NOTIFIABLE',
            'The assessment recommends not notifying, so there is nothing to draft. Record the reason instead.',
          );
        const list = r.notifications as NotificationDraft[];
        const old = list.find((n) => n.audience === audience);
        if (old?.status === 'SENT_SIMULATED')
          throw new AppError(409, 'ALREADY_SENT', 'This notice was already sent');
        const draft = await draftNotification(tx, r, audience as Audience, {
          id: a.user.id,
          name: a.user.name,
          email: a.user.email,
        });
        const [row] = await tx
          .update(breachIncident)
          .set({ notifications: [...list.filter((n) => n.audience !== audience), draft], updatedAt: now() })
          .where(eq(breachIncident.id, id))
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'breach.notice_drafted',
          entityType: 'breach_incident',
          entityId: id,
          after: { audience, unfilled: draft.unfilled },
        });
        return detail(tx, row!);
      });
    },
  );

  reg('POST', '/incidents/{id}/notifications/{audience}/send');
  app.post(
    `${p}/incidents/:id/notifications/:audience/send`,
    { preHandler: guard(d, [...MANAGERS]) },
    async (req) => {
      const a = req.auth!;
      const { id, audience } = parse(audienceParam, req.params);
      const outcome = await withContext(d.database, a.ctx, async (tx) => {
        const r = await load(tx, a.user.tenantId, id);
        notClosed(r);
        const list = r.notifications as NotificationDraft[];
        const draft = list.find((n) => n.audience === audience);
        if (!draft) throw new AppError(409, 'NO_DRAFT', 'Draft the notice first');
        if (draft.status === 'SENT_SIMULATED')
          throw new AppError(409, 'ALREADY_SENT', 'This notice was already sent');
        if (draft.unfilled.length)
          throw new AppError(
            409,
            'MERGE_FIELDS_OPEN',
            `Fill in every merge field first. For each person, ${draft.unfilled.map((f) => `{{${f}}}`).join(', ')} is merged when the notice is sent; the regulator notice must have none open.`,
          );
        const sent = await sendDraft(tx, r, draft, { id: a.user.id });
        // a refusal is committed (its audit record and count) and the error raised after, never lost to a rollback
        if (!sent.ok) return { error: sent.error };
        const next = list.map((n) => (n.audience === audience ? sent.draft : n));
        const both = (['REGULATOR', 'INDIVIDUALS'] as const).every((x) =>
          next.some((n) => n.audience === x && n.status === 'SENT_SIMULATED'),
        );
        const [row] = await tx
          .update(breachIncident)
          .set({ notifications: next, status: both ? 'NOTIFIED' : r.status, updatedAt: now() })
          .where(eq(breachIncident.id, id))
          .returning();
        await d.audit.record(tx, a.ctx, {
          action: 'breach.notice_sent',
          entityType: 'breach_incident',
          entityId: id,
          after: { audience, simulated: true, reference: sent.draft.record?.reference, status: row!.status },
        });
        return { view: await detail(tx, row!) };
      });
      if ('error' in outcome) throw outcome.error;
      return outcome.view;
    },
  );

  reg('POST', '/incidents/{id}/close');
  app.post(`${p}/incidents/:id/close`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ lessons: text(10, 4000) }).strict(), req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await load(tx, a.user.tenantId, id);
      notClosed(r);
      const assessment = r.assessment as Assessment | null;
      if (!assessment) throw new AppError(409, 'NOT_ASSESSED', 'Record the assessment before closing');
      if (assessment.recommendation === NOTIFIABLE && r.status !== 'NOTIFIED')
        throw new AppError(
          409,
          'NOTIFICATION_PENDING',
          'The assessment recommends notifying: send the notice to the regulator and to the affected individuals first',
        );
      if (
        assessment.recommendation === NOT_NOTIFIABLE &&
        !(assessment.reason && assessment.reason.length >= 10)
      )
        throw new AppError(
          409,
          'REASON_REQUIRED',
          'Record the reason for not notifying (assess again with a reason) before closing',
        );
      const [row] = await tx
        .update(breachIncident)
        .set({ status: 'CLOSED', lessons: b.lessons, closedAt: now(), closedBy: a.user.id, updatedAt: now() })
        .where(eq(breachIncident.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'breach.closed',
        entityType: 'breach_incident',
        entityId: id,
        before: { status: r.status },
        after: { status: 'CLOSED', recommendation: assessment.recommendation },
      });
      return detail(tx, row!);
    });
  });

  return done;
}
