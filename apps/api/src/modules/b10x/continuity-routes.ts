/**
 * Business-continuity endpoints (FR-0860): raise an event and reach people by SMS and email through the simulated gateway, the
 * tracker, answers by one-time link (public, no sign-in) or recorded by staff from a phone call, messaging non-responders again,
 * escalation and closing with a summary.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem, type Tx } from '../../db/client.js';
import {
  appUser,
  contract,
  continuityEvent,
  continuityResponse,
  roleAssignment,
  supplier,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import {
  GROUPS,
  KINDS,
  RESPONSES,
  SEVERITIES,
  SMS_LIMIT,
  closeEvent,
  housekeeping,
  listEvents,
  raiseEvent,
  recordAnswer,
  resendToNonResponders,
  tokenHashOf,
  trackerView,
  type ContinuityDeps,
  type EventKind,
} from './continuity.js';

export interface ContinuityRouteDeps extends GuardDeps {
  schedulerMinutes?: number | undefined;
}

const RAISERS = ['PROCUREMENT', 'CONTRACT_MGR', 'EXEC'] as const;
const VIEWERS = ['PROCUREMENT', 'CONTRACT_MGR', 'EXEC', 'LEGAL'] as const;
const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{8,16}$/, 'Use a phone number like +61 400 123 456');
const raiseBody = z
  .object({
    title: z.string().trim().min(3).max(120),
    kind: z.enum(Object.keys(KINDS) as [EventKind, ...EventKind[]]),
    severity: z.enum(SEVERITIES),
    message: z.string().trim().min(10).max(2000),
    smsNote: z.string().trim().max(40).optional(),
    supplierIds: z.array(uuid).max(50).default([]),
    contractIds: z.array(uuid).max(100).default([]),
    groups: z.array(z.enum(GROUPS)).min(1).max(4),
    namedContacts: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(80),
            email: z.string().trim().email().max(160),
            phone: phone.optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    escalateAfterMinutes: z.number().int().min(5).max(1440).default(30),
    escalateToUserId: uuid.optional(),
    responseValidHours: z.number().int().min(1).max(168).default(48),
  })
  .strict()
  .refine((b) => !b.groups.includes('NAMED') || b.namedContacts.length > 0, {
    message: 'Add at least one named contact, or remove that group',
    path: ['namedContacts'],
  });
const answerBody = z
  .object({ response: z.enum(RESPONSES), note: z.string().trim().max(300).optional() })
  .strict();
const closeBody = z.object({ note: z.string().trim().max(1000).optional() }).strict();
const tokenParam = z.object({ token: z.string().min(20).max(80) });
const idParam = z.object({ id: uuid });

export function registerContinuity(app: FastifyInstance, p: string, d: ContinuityRouteDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const cd: ContinuityDeps = { clock: d.clock, audit: d.audit };
  const publicLimit = { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } } };

  if (d.schedulerMinutes) {
    const h = setInterval(
      () =>
        void withSystem(d.database, async (tx) => {
          const open = await tx.select().from(continuityEvent).where(eq(continuityEvent.status, 'OPEN'));
          for (const ev of open) await housekeeping(tx, cd, ev);
        }).catch(() => undefined),
      d.schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }

  const load = async (tx: Tx, tenantId: string, id: string) => {
    const [ev] = await tx
      .select()
      .from(continuityEvent)
      .where(and(eq(continuityEvent.id, id), eq(continuityEvent.tenantId, tenantId)));
    if (!ev) throw new AppError(404, 'NOT_FOUND', 'Event not found');
    return ev;
  };

  // ------------------------------------------------------------ what can be picked when raising
  reg('GET', '/continuity/options');
  app.get(`${p}/continuity/options`, { preHandler: guard(d, [...RAISERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const t = a.user.tenantId;
      const contracts = (await tx.select().from(contract).where(eq(contract.tenantId, t))).filter(
        (c) => !c.deletedAt && c.status === 'EXECUTED',
      );
      const sIds = [...new Set(contracts.map((c) => c.supplierId))];
      const suppliers = await tx.select().from(supplier).where(eq(supplier.tenantId, t));
      const ownerIds = [...new Set(contracts.map((c) => c.ownerId).filter((x): x is string => Boolean(x)))];
      const owners = ownerIds.length
        ? await tx.select().from(appUser).where(inArray(appUser.id, ownerIds))
        : [];
      const people = await tx
        .select({ id: appUser.id, name: appUser.name, role: roleAssignment.role })
        .from(roleAssignment)
        .innerJoin(appUser, eq(appUser.id, roleAssignment.userId))
        .where(
          and(
            eq(roleAssignment.tenantId, t),
            inArray(roleAssignment.role, ['PROCUREMENT', 'CONTRACT_MGR', 'EXEC']),
            eq(appUser.active, true),
          ),
        );
      return {
        simulated: true,
        kinds: Object.entries(KINDS).map(([key, label]) => ({ key, label })),
        severities: SEVERITIES,
        groups: [
          { key: 'CONTRACT_OWNER', label: 'Owners of the affected contracts' },
          { key: 'SUPPLIER_CONTACT', label: 'Contacts at the affected suppliers' },
          { key: 'EXECUTIVE', label: 'Executives' },
          { key: 'NAMED', label: 'Named contacts' },
        ],
        smsLimit: SMS_LIMIT,
        defaults: { escalateAfterMinutes: 30, responseValidHours: 48 },
        suppliers: suppliers
          .map((s) => ({
            id: s.id,
            company: s.company,
            contracts: contracts.filter((c) => c.supplierId === s.id).length,
            hasContract: sIds.includes(s.id),
          }))
          .sort((x, y) => x.company.localeCompare(y.company)),
        contracts: contracts
          .map((c) => ({
            id: c.id,
            number: c.number,
            title: c.title ?? c.number,
            supplierId: c.supplierId,
            supplier: suppliers.find((s) => s.id === c.supplierId)?.company ?? '',
            owner: owners.find((o) => o.id === c.ownerId)?.name ?? null,
          }))
          .sort((x, y) => x.number.localeCompare(y.number)),
        escalationPeople: [...new Map(people.map((x) => [x.id, x])).values()].sort((x, y) =>
          x.name.localeCompare(y.name),
        ),
      };
    });
  });

  // ------------------------------------------------------------ raise, list, tracker
  reg('POST', '/continuity/events');
  app.post(`${p}/continuity/events`, { preHandler: guard(d, [...RAISERS]) }, async (req, reply) => {
    const a = req.auth!;
    const body = parse(raiseBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const r = await raiseEvent(tx, cd, a.ctx, body);
      return { r, view: await trackerView(tx, r.event) };
    });
    return reply.status(201).send({
      ...out.view,
      // shown once, to the person who raised the event, so the demonstration can follow a link; a real gateway puts it in the message
      simulatedLinks: out.r.links,
    });
  });

  reg('GET', '/continuity/events');
  app.get(`${p}/continuity/events`, { preHandler: guard(d, [...VIEWERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => ({
      simulated: true,
      events: await listEvents(tx, a.user.tenantId),
    }));
  });

  reg('GET', '/continuity/events/{id}');
  app.get(`${p}/continuity/events/:id`, { preHandler: guard(d, [...VIEWERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const ev = await load(tx, a.user.tenantId, id);
      // reading the tracker also catches up: queued messages, delivery receipts and an escalation that has come due
      await housekeeping(tx, cd, ev);
      return trackerView(tx, await load(tx, a.user.tenantId, id));
    });
  });

  reg('POST', '/continuity/events/{id}/resend');
  app.post(`${p}/continuity/events/:id/resend`, { preHandler: guard(d, [...RAISERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const ev = await load(tx, a.user.tenantId, id);
      const r = await resendToNonResponders(tx, cd, a.ctx, ev);
      return { r, view: await trackerView(tx, ev) };
    });
    return { ...out.view, resent: out.r.nonResponders, simulatedLinks: out.r.links };
  });

  reg('POST', '/continuity/events/{id}/responses/{responseId}');
  app.post(
    `${p}/continuity/events/:id/responses/:responseId`,
    { preHandler: guard(d, [...RAISERS]) },
    async (req) => {
      const a = req.auth!;
      const { id, responseId } = parse(z.object({ id: uuid, responseId: uuid }), req.params);
      const body = parse(answerBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const ev = await load(tx, a.user.tenantId, id);
        const [r] = await tx
          .select()
          .from(continuityResponse)
          .where(and(eq(continuityResponse.id, responseId), eq(continuityResponse.eventId, id)));
        if (!r) throw new AppError(404, 'NOT_FOUND', 'Recipient not found');
        await recordAnswer(tx, cd, a.ctx, ev, r, { ...body, via: 'STAFF_PHONE' });
        return trackerView(tx, ev);
      });
    },
  );

  reg('POST', '/continuity/events/{id}/close');
  app.post(`${p}/continuity/events/:id/close`, { preHandler: guard(d, [...RAISERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const body = parse(closeBody, req.body ?? {});
    return withContext(d.database, a.ctx, async (tx) => {
      const ev = await load(tx, a.user.tenantId, id);
      await closeEvent(tx, cd, a.ctx, ev, body.note);
      return trackerView(tx, await load(tx, a.user.tenantId, id));
    });
  });

  // ------------------------------------------------------------ the one-time response link (public, no sign-in)
  async function findLink(token: string) {
    return withSystem(d.database, async (tx) => {
      const [r] = await tx
        .select()
        .from(continuityResponse)
        .where(eq(continuityResponse.tokenHash, tokenHashOf(token)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'This link is not valid. Ask for a new one.');
      if (r.tokenExpiresAt <= d.clock.now())
        throw new AppError(
          410,
          'LINK_EXPIRED',
          'This link has expired. Ask the sender to message you again.',
        );
      const [ev] = await tx.select().from(continuityEvent).where(eq(continuityEvent.id, r.eventId));
      const [t] = await tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, r.tenantId));
      return { r, ev: ev!, org: t?.name ?? '' };
    });
  }
  const linkView = (x: Awaited<ReturnType<typeof findLink>>) => ({
    simulated: true,
    organisation: x.org,
    number: x.ev.number,
    title: x.ev.title,
    kind: x.ev.kind,
    kindLabel: KINDS[x.ev.kind],
    severity: x.ev.severity,
    message: x.ev.message,
    recipient: x.r.name,
    closed: x.ev.status === 'CLOSED',
    response: x.r.response === 'NONE' ? null : x.r.response,
    note: x.r.note,
    respondedAt: x.r.respondedAt?.toISOString() ?? null,
    changeCount: x.r.changeCount,
    expiresAt: x.r.tokenExpiresAt.toISOString(),
    options: RESPONSES,
  });

  reg('GET', '/respond-links/{token}');
  app.get(`${p}/respond-links/:token`, { preHandler: guard(d, 'public'), ...publicLimit }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    return linkView(await findLink(token));
  });

  reg('POST', '/respond-links/{token}');
  app.post(`${p}/respond-links/:token`, { preHandler: guard(d, 'public'), ...publicLimit }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    const body = parse(answerBody, req.body);
    const x = await findLink(token);
    await withSystem(d.database, async (tx) => {
      const [fresh] = await tx.select().from(continuityResponse).where(eq(continuityResponse.id, x.r.id));
      await recordAnswer(
        tx,
        cd,
        { tenantId: x.r.tenantId, userId: x.r.userId, role: 'SYSTEM' },
        x.ev,
        fresh!,
        {
          ...body,
          via: 'WEB_LINK',
        },
      );
    });
    return linkView(await findLink(token));
  });

  return done;
}
