/**
 * Supplier directory for buyers (M12b): the profile with sanctions and insurance status (US-SUP-05), and adding a
 * contact to an existing supplier. Self-registration cannot join an existing company (anyone could attach themselves
 * to a public ABN), so the buyer adds the contact after checking them; the contact then sets their own password through
 * a one-time link (the buyer passes it on, since the proof of concept sends no email).
 */
import { randomBytes } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext, withSystem, type RequestContext } from '../../db/client.js';
import {
  appUser,
  contract,
  request,
  roleAssignment,
  submission,
  supplier,
  supplierActivation,
  tender,
  tenant,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings } from '../settings/settings.js';
import { hashToken } from './routes.js';
import type { SupplierDeps } from './supplier-routes.js';

const uuid = z.string().uuid();
const DAY = 86_400_000;
const ACTIVATION_DAYS = 7;
const contactBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
  })
  .strict();
const activateBody = z
  .object({ token: z.string().min(20).max(100), password: z.string().min(12).max(200) })
  .strict();
const READERS = ['PROCUREMENT', 'LEGAL', 'FINANCE', 'ADMIN'] as const;

export function registerSupplierDirectory(app: FastifyInstance, p: string, d: SupplierDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const publicLimit = {
    config: { rateLimit: { max: d.publicRateLimitMax ?? 20, timeWindow: '15 minutes' } },
  };
  const sid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;

  async function contactsOf(
    tx: Parameters<Parameters<typeof withContext>[2]>[0],
    supplierId: string,
    now: Date,
  ) {
    const users = await tx
      .select()
      .from(appUser)
      .where(eq(appUser.supplierId, supplierId))
      .orderBy(asc(appUser.createdAt));
    const pending = users.length
      ? await tx
          .select()
          .from(supplierActivation)
          .where(
            inArray(
              supplierActivation.userId,
              users.map((u) => u.id),
            ),
          )
      : [];
    return users.map((u) => {
      const open = pending.find((x) => x.userId === u.id && !x.usedAt && x.expiresAt > now);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        active: u.active,
        awaitingActivation: Boolean(open),
      };
    });
  }

  reg('GET', '/suppliers');
  app.get(`${p}/suppliers`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(supplier)
        .where(eq(supplier.tenantId, a.user.tenantId))
        .orderBy(asc(supplier.company));
      const users = await tx
        .select({ supplierId: appUser.supplierId })
        .from(appUser)
        .where(eq(appUser.tenantId, a.user.tenantId));
      return rows.map((s) => ({
        id: s.id,
        company: s.company,
        abn: s.abn,
        sanctionsStatus: s.sanctionsStatus,
        insuranceStatus: s.insuranceStatus,
        lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
        contacts: users.filter((u) => u.supplierId === s.id).length,
      }));
    });
  });

  reg('GET', '/suppliers/{id}');
  app.get(`${p}/suppliers/:id`, { preHandler: guard(d, [...READERS]) }, async (req) => {
    const a = req.auth!;
    const id = sid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx
        .select()
        .from(supplier)
        .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const subs = await tx.select().from(submission).where(eq(submission.supplierId, id));
      const tenders = subs.length
        ? await tx
            .select({ t: tender, number: request.number, title: request.title })
            .from(tender)
            .innerJoin(request, eq(request.id, tender.requestId))
            .where(
              inArray(
                tender.id,
                subs.map((x) => x.tenderId),
              ),
            )
        : [];
      const contracts = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.supplierId, id), eq(contract.tenantId, a.user.tenantId)));
      return {
        id: s.id,
        company: s.company,
        abn: s.abn,
        sanctionsStatus: s.sanctionsStatus,
        insuranceStatus: s.insuranceStatus,
        lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
        contacts: await contactsOf(tx, id, d.clock.now()),
        tenders: tenders.map((x) => ({
          tenderId: x.t.id,
          number: x.number,
          title: x.title,
          submission: subs.find((y) => y.tenderId === x.t.id)?.status ?? null,
        })),
        contracts: contracts
          .filter((c) => !c.deletedAt)
          .map((c) => ({ id: c.id, number: c.number, status: c.status, value: Number(c.value) })),
        canAddContact: a.user.roles.includes('PROCUREMENT'),
      };
    });
  });

  /** Adds a contact (an inactive-until-activated account for the supplier's own pool) and returns the one-time link. */
  async function addContact(
    tx: Parameters<Parameters<typeof withContext>[2]>[0],
    a: NonNullable<FastifyRequest['auth']>,
    id: string,
    body: z.infer<typeof contactBody>,
    token: string,
    placeholder: string,
  ) {
    const [s] = await tx
      .select()
      .from(supplier)
      .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
    if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
    const [taken] = await tx
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.tenantId, a.user.tenantId), eq(appUser.email, body.email)));
    if (taken)
      throw new AppError(409, 'EMAIL_IN_USE', 'That email address already has an account', [
        { field: 'email', message: 'Use a different email address' },
      ]);
    const now = d.clock.now();
    const [u] = await tx
      .insert(appUser)
      .values({
        tenantId: a.user.tenantId,
        email: body.email,
        name: body.name,
        passwordHash: placeholder,
        supplierId: id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(roleAssignment).values({ tenantId: a.user.tenantId, userId: u!.id, role: 'SUPPLIER' });
    const expiresAt = new Date(now.getTime() + ACTIVATION_DAYS * DAY);
    await tx.insert(supplierActivation).values({
      tenantId: a.user.tenantId,
      userId: u!.id,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy: a.user.id,
    });
    await d.audit.record(tx, a.ctx, {
      action: 'supplier.contact_add',
      entityType: 'supplier',
      entityId: id,
      after: { userId: u!.id, email: body.email, expiresAt: expiresAt.toISOString() },
    });
    return {
      contact: { id: u!.id, name: u!.name, email: u!.email, active: true, awaitingActivation: true },
      activationPath: `/supplier/activate?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  reg('POST', '/suppliers/{id}/contacts');
  app.post(`${p}/suppliers/:id/contacts`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req, reply) => {
    const a = req.auth!;
    const id = sid(req);
    const body = parse(contactBody, req.body);
    const token = randomBytes(32).toString('base64url');
    // an unusable password until the contact sets one through the link
    const placeholder = await argon2Hash(randomBytes(32).toString('hex'));
    const out = await withContext(d.database, a.ctx, (tx) => addContact(tx, a, id, body, token, placeholder));
    return reply.status(201).send(out);
  });

  /** Switches a contact off for good: no sign-in, no open link, every live session ended (SEC-A06). */
  async function deprovision(
    tx: Parameters<Parameters<typeof withContext>[2]>[0],
    a: NonNullable<FastifyRequest['auth']>,
    supplierId: string,
    userId: string,
    reason: string,
  ) {
    const [u] = await tx
      .select()
      .from(appUser)
      .where(
        and(
          eq(appUser.id, userId),
          eq(appUser.supplierId, supplierId),
          eq(appUser.tenantId, a.user.tenantId),
        ),
      );
    if (!u) throw new AppError(404, 'NOT_FOUND', 'Contact not found');
    if (!u.active) throw new AppError(409, 'ALREADY_INACTIVE', 'This contact already has no access');
    await tx.update(appUser).set({ active: false, updatedAt: d.clock.now() }).where(eq(appUser.id, userId));
    await tx
      .update(supplierActivation)
      .set({ usedAt: d.clock.now() })
      .where(and(eq(supplierActivation.userId, userId), isNull(supplierActivation.usedAt)));
    await d.audit.record(tx, a.ctx, {
      action: 'supplier.contact_deprovision',
      entityType: 'supplier',
      entityId: supplierId,
      before: { userId, email: u.email, active: true },
      after: { active: false, reason },
    });
    return u;
  }

  const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
  const reassignBody = contactBody.extend({ reason: z.string().trim().min(3).max(300) }).strict();

  reg('POST', '/suppliers/{id}/contacts/{userId}/deprovision');
  app.post(
    `${p}/suppliers/:id/contacts/:userId/deprovision`,
    { preHandler: guard(d, ['PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
      const body = parse(reasonBody, req.body);
      const u = await withContext(d.database, a.ctx, (tx) => deprovision(tx, a, id, userId, body.reason));
      await d.sessions.revokeAllFor(userId);
      return { id: u.id, name: u.name, email: u.email, active: false };
    },
  );

  // a contact leaves and someone else takes over: the old access ends and the new person gets their own link
  reg('POST', '/suppliers/{id}/contacts/{userId}/reassign');
  app.post(
    `${p}/suppliers/:id/contacts/:userId/reassign`,
    { preHandler: guard(d, ['PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
      const { reason, ...person } = parse(reassignBody, req.body);
      const token = randomBytes(32).toString('base64url');
      const placeholder = await argon2Hash(randomBytes(32).toString('hex'));
      const out = await withContext(d.database, a.ctx, async (tx) => {
        const left = await deprovision(tx, a, id, userId, `Reassigned: ${reason}`);
        const added = await addContact(tx, a, id, person, token, placeholder);
        return { ...added, replaced: { id: left.id, name: left.name } };
      });
      await d.sessions.revokeAllFor(userId);
      return reply.status(201).send(out);
    },
  );

  // ------------------------------------------------------------ one-time activation (public)
  reg('GET', '/supplier/activate/{token}');
  app.get(
    `${p}/supplier/activate/:token`,
    { preHandler: guard(d, 'public'), ...publicLimit },
    async (req) => {
      const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.params);
      return withSystem(d.database, async (tx) => {
        const [act] = await tx
          .select()
          .from(supplierActivation)
          .where(eq(supplierActivation.tokenHash, hashToken(token)));
        if (!act || act.usedAt || act.expiresAt <= d.clock.now())
          throw new AppError(
            404,
            'ACTIVATION_INVALID',
            'This link is not valid any more. Ask the buyer for a new one.',
          );
        const [u] = await tx.select().from(appUser).where(eq(appUser.id, act.userId));
        const [s] = u?.supplierId
          ? await tx.select().from(supplier).where(eq(supplier.id, u.supplierId))
          : [];
        const [org] = await tx.select().from(tenant).where(eq(tenant.id, act.tenantId));
        return {
          name: u?.name ?? '',
          email: u?.email ?? '',
          company: s?.company ?? '',
          organisation: org?.name ?? '',
          expiresAt: act.expiresAt.toISOString(),
        };
      });
    },
  );

  reg('POST', '/supplier/activate');
  app.post(`${p}/supplier/activate`, { preHandler: guard(d, 'public'), ...publicLimit }, async (req) => {
    const b = parse(activateBody, req.body);
    if (!/[A-Za-z]/.test(b.password) || !/\d/.test(b.password))
      throw new AppError(400, 'VALIDATION_FAILED', 'The password is too weak', [
        { field: 'password', message: 'Use at least 12 characters with letters and numbers' },
      ]);
    const passwordHash = await argon2Hash(b.password);
    return withSystem(d.database, async (tx) => {
      const now = d.clock.now();
      const [act] = await tx
        .select()
        .from(supplierActivation)
        .where(eq(supplierActivation.tokenHash, hashToken(b.token)));
      if (!act || act.usedAt || act.expiresAt <= now)
        throw new AppError(
          404,
          'ACTIVATION_INVALID',
          'This link is not valid any more. Ask the buyer for a new one.',
        );
      // staff accounts cannot be opened with a link when single sign-on is required (SEC-A04); suppliers are a separate pool
      const [person] = await tx.select().from(appUser).where(eq(appUser.id, act.userId));
      if (person && !person.supplierId && (await loadSettings(tx, act.tenantId)).security.enforceSso)
        throw new AppError(
          403,
          'SSO_REQUIRED',
          'Your organisation requires single sign-on, so a password cannot be set from a link.',
        );
      // single use: the first request to flip the row wins
      const won = await tx
        .update(supplierActivation)
        .set({ usedAt: now })
        .where(and(eq(supplierActivation.id, act.id), eq(supplierActivation.tokenHash, act.tokenHash)))
        .returning({ id: supplierActivation.id });
      if (won.length === 0) throw new AppError(404, 'ACTIVATION_INVALID', 'This link is not valid any more.');
      await tx.update(appUser).set({ passwordHash, updatedAt: now }).where(eq(appUser.id, act.userId));
      const sys: RequestContext = { tenantId: act.tenantId, userId: null, role: 'SYSTEM' };
      await d.audit.record(tx, sys, {
        action: 'supplier.contact_activate',
        entityType: 'user',
        entityId: act.userId,
        after: { activated: true },
      });
      return { activated: true };
    });
  });

  return done;
}
