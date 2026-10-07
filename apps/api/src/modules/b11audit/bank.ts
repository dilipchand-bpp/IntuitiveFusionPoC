/**
 * SEC-AC10: bank details are visible to finance only.
 *
 * Where bank details live: `supplier.bank` (BSB, account number, account name), written by the supplier (PUT /supplier/profile/bank),
 * read by the vendor pre-flight before a contract is signed (contract/b4-service.ts), compared by duplicate detection (b8/rules.ts)
 * and, with this module, shown on GET /suppliers/:id/bank. No other route, export, search result, notification, audit event or
 * Ask AI answer carries them; a test enumerates the supplier routes and checks that.
 *
 * Rules implemented here:
 *   - `maskBank(role, value)`: the BSB and account number are returned unmasked to FINANCE (and to the supplier on its own profile),
 *     and masked for every other role, ADMIN included: the BSB is hidden whole and only the last three digits of the account show.
 *   - every unmasked read by FINANCE is audited (`supplier.bank_read`), without the numbers.
 *   - a change needs finance confirmation. A change to details already in force is held PENDING and the old details stay in force
 *     until a DIFFERENT finance person confirms it. Details recorded for the first time (or while they are still unconfirmed)
 *     are put in force provisionally and flagged UNCONFIRMED for a finance person to confirm, so that onboarding and contract
 *     release keep working; finance can reject them, which puts the previous details back. Staff-initiated changes
 *     (POST /suppliers/:id/bank-change) are always PENDING.
 *   - duplicate detection compares fingerprints (SHA-256 of BSB and account digits), never the numbers themselves.
 *
 * Group A (field encryption): `openBank`/`sealBank` from b11enc/fields.ts are used for the copies this module keeps and when it
 * writes an approved change; a column still holding plaintext is read as it is.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { appUser, bankDetailChange, supplier } from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { openBank, sealBank, type Bank } from '../b11enc/fields.js';
import { bankFingerprint } from './bank-fp.js';
import { tell, usersWithRoles } from './util.js';

export { bankFingerprint };

export const BANK_VIEWERS = [
  'PROCUREMENT',
  'LEGAL',
  'FINANCE',
  'ADMIN',
  'EXEC',
  'PROBITY',
  'CONTRACT_MGR',
  'DELEGATE',
] as const;

export interface MaskedBank {
  bsb: string;
  account: string;
  accountName: string | null;
  masked: boolean;
}

/** Only a finance person (or the supplier looking at its own profile) sees the numbers; everyone else sees the last three digits. */
export function maskBank(
  role: string | readonly string[],
  value: Bank | null | undefined,
  opts: { self?: boolean } = {},
): MaskedBank | null {
  if (!value || (!value.bsb && !value.account)) return null;
  const roles = typeof role === 'string' ? [role] : role;
  const bsb = value.bsb ?? '';
  const account = value.account ?? '';
  if (opts.self || roles.includes('FINANCE'))
    return { bsb, account, accountName: value.accountName ?? null, masked: false };
  return {
    bsb: 'XXX-XXX',
    account: `${'*'.repeat(Math.max(account.length - 3, 0))}${account.slice(-3)}`,
    accountName: value.accountName ?? null,
    masked: true,
  };
}

const bankBody = z
  .object({
    bsb: z
      .string()
      .trim()
      .regex(/^\d{3}-?\d{3}$/, 'Six digits, for example 062-000'),
    account: z
      .string()
      .trim()
      .regex(/^\d{6,10}$/, 'Six to ten digits'),
    accountName: z.string().trim().min(2).max(200),
  })
  .strict();
export type BankBody = z.infer<typeof bankBody>;
type Auth = NonNullable<FastifyRequest['auth']>;

async function notifyFinance(
  tx: Tx,
  d: Pick<GuardDeps, 'clock'>,
  tenantId: string,
  except: string,
  title: string,
  body: string,
) {
  for (const u of await usersWithRoles(tx, tenantId, ['FINANCE'], d.clock.now()))
    if (u.id !== except) await tell(tx, tenantId, u.id, title, body, '/app/bank-changes', 'bank.change');
}

/**
 * The supplier's own submission (PUT /supplier/profile/bank). Returns what the caller should do with the column:
 *  APPLY: write the details now (and the row it should record afterwards is created here);
 *  HELD: do not touch the column; a PENDING change was recorded.
 */
export async function submitSupplierBank(
  tx: Tx,
  d: Pick<GuardDeps, 'audit' | 'clock'>,
  a: Auth,
  body: BankBody,
): Promise<{ mode: 'APPLY' | 'HELD'; changeId: string }> {
  const supplierId = a.user.supplierId!;
  const now = d.clock.now();
  const [s] = await tx.select().from(supplier).where(eq(supplier.id, supplierId));
  const current = await openBank(tx, a.user.tenantId, supplierId, s?.bank);
  const [open] = await tx
    .select()
    .from(bankDetailChange)
    .where(
      and(
        eq(bankDetailChange.supplierId, supplierId),
        inArray(bankDetailChange.status, ['PENDING', 'UNCONFIRMED']),
      ),
    );
  const sealedNew = await sealBank(
    tx,
    a.user.tenantId,
    supplierId,
    { ...body, recordedAt: now.toISOString() },
    now,
  );
  const inForceConfirmed = Boolean(current) && !(open && open.status === 'UNCONFIRMED');
  if (open)
    await tx
      .update(bankDetailChange)
      .set({
        status: open.status === 'PENDING' ? 'WITHDRAWN' : 'SUPERSEDED',
        decisionNote: 'Replaced by a newer submission',
        decidedAt: now,
      })
      .where(eq(bankDetailChange.id, open.id));
  const previous =
    open?.status === 'UNCONFIRMED'
      ? open.previousBank
      : current
        ? await sealBank(tx, a.user.tenantId, supplierId, current, now)
        : null;
  const [row] = await tx
    .insert(bankDetailChange)
    .values({
      tenantId: a.user.tenantId,
      supplierId,
      requestedBy: a.user.id,
      requestedByRole: a.user.role,
      requestedAt: now,
      newBank: sealedNew,
      previousBank: previous,
      status: inForceConfirmed ? 'PENDING' : 'UNCONFIRMED',
    })
    .returning({ id: bankDetailChange.id });
  await notifyFinance(
    tx,
    d,
    a.user.tenantId,
    a.user.id,
    inForceConfirmed
      ? 'A supplier bank detail change needs confirmation'
      : 'New supplier bank details need confirmation',
    inForceConfirmed
      ? `${s?.company ?? 'A supplier'} asked to change its bank details. The current details stay in force until a finance person confirms.`
      : `${s?.company ?? 'A supplier'} recorded bank details. Please confirm them.`,
  );
  await d.audit.record(tx, a.ctx, {
    action: inForceConfirmed ? 'bank_change.request' : 'bank_change.first_record',
    entityType: 'supplier',
    entityId: supplierId,
    after: {
      changeId: row!.id,
      status: inForceConfirmed ? 'PENDING' : 'UNCONFIRMED',
      accountName: body.accountName,
    },
  });
  return { mode: inForceConfirmed ? 'HELD' : 'APPLY', changeId: row!.id };
}

/** Writes details into the supplier record on approval. Sealed by the field-encryption layer. */
async function writeBank(tx: Tx, tenantId: string, supplierId: string, bank: Bank, now: Date) {
  await tx
    .update(supplier)
    .set({ bank: await sealBank(tx, tenantId, supplierId, bank, now) })
    .where(eq(supplier.id, supplierId));
}

export function registerBank(app: FastifyInstance, p: string, d: GuardDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const idParam = z.object({ id: z.string().uuid() });

  const names = async (tx: Tx, tenantId: string) =>
    new Map(
      (
        await tx
          .select({ id: appUser.id, name: appUser.name })
          .from(appUser)
          .where(eq(appUser.tenantId, tenantId))
      ).map((u) => [u.id, u.name] as const),
    );

  async function changeView(
    tx: Tx,
    a: Auth,
    r: typeof bankDetailChange.$inferSelect,
    who: Map<string, string>,
    company: string,
  ) {
    const nb = await openBank(tx, a.user.tenantId, r.supplierId, r.newBank);
    return {
      id: r.id,
      supplierId: r.supplierId,
      company,
      status: r.status,
      requestedBy: who.get(r.requestedBy) ?? null,
      requestedByRole: r.requestedByRole,
      requestedAt: r.requestedAt.toISOString(),
      decidedBy: r.decidedBy ? (who.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      newBank: maskBank(a.user.roles, nb),
      canConfirm:
        a.user.roles.includes('FINANCE') &&
        ['PENDING', 'UNCONFIRMED'].includes(r.status) &&
        r.requestedBy !== a.user.id,
    };
  }

  reg('GET', '/suppliers/{id}/bank');
  app.get(`${p}/suppliers/:id/bank`, { preHandler: guard(d, [...BANK_VIEWERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx
        .select()
        .from(supplier)
        .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
      const bank = await openBank(tx, a.user.tenantId, id, s.bank);
      const shown = maskBank(a.user.roles, bank);
      if (shown && !shown.masked)
        await d.audit.record(tx, a.ctx, {
          action: 'supplier.bank_read',
          entityType: 'supplier',
          entityId: id,
          after: { unmasked: true },
        });
      const open = await tx
        .select()
        .from(bankDetailChange)
        .where(
          and(
            eq(bankDetailChange.supplierId, id),
            inArray(bankDetailChange.status, ['PENDING', 'UNCONFIRMED']),
          ),
        );
      const who = await names(tx, a.user.tenantId);
      return {
        supplierId: id,
        company: s.company,
        bank: shown,
        fingerprint: bankFingerprint(bank)?.slice(0, 8) ?? null,
        change: open[0] ? await changeView(tx, a, open[0], who, s.company) : null,
      };
    });
  });

  reg('GET', '/supplier/profile/bank');
  app.get(`${p}/supplier/profile/bank`, { preHandler: guard(d, ['SUPPLIER']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const [s] = await tx.select().from(supplier).where(eq(supplier.id, a.user.supplierId!));
      const bank = await openBank(tx, a.user.tenantId, a.user.supplierId!, s?.bank);
      const [open] = await tx
        .select()
        .from(bankDetailChange)
        .where(
          and(
            eq(bankDetailChange.supplierId, a.user.supplierId!),
            inArray(bankDetailChange.status, ['PENDING', 'UNCONFIRMED']),
          ),
        );
      return {
        bank: maskBank(a.user.roles, bank, { self: true }),
        pending: open?.status === 'PENDING',
        status: open?.status ?? 'CONFIRMED',
      };
    });
  });

  reg('POST', '/suppliers/{id}/bank-change');
  app.post(
    `${p}/suppliers/:id/bank-change`,
    { preHandler: guard(d, ['FINANCE', 'PROCUREMENT']) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const body = parse(bankBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const [s] = await tx
          .select()
          .from(supplier)
          .where(and(eq(supplier.id, id), eq(supplier.tenantId, a.user.tenantId)));
        if (!s) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
        const now = d.clock.now();
        const current = await openBank(tx, a.user.tenantId, id, s.bank);
        const [open] = await tx
          .select()
          .from(bankDetailChange)
          .where(
            and(
              eq(bankDetailChange.supplierId, id),
              inArray(bankDetailChange.status, ['PENDING', 'UNCONFIRMED']),
            ),
          );
        if (open)
          await tx
            .update(bankDetailChange)
            .set({
              status: open.status === 'PENDING' ? 'WITHDRAWN' : 'SUPERSEDED',
              decisionNote: 'Replaced by a newer request',
              decidedAt: now,
            })
            .where(eq(bankDetailChange.id, open.id));
        const [row] = await tx
          .insert(bankDetailChange)
          .values({
            tenantId: a.user.tenantId,
            supplierId: id,
            requestedBy: a.user.id,
            requestedByRole: a.user.role,
            requestedAt: now,
            newBank: await sealBank(tx, a.user.tenantId, id, { ...body, recordedAt: now.toISOString() }, now),
            previousBank:
              open?.status === 'UNCONFIRMED'
                ? open.previousBank
                : current
                  ? await sealBank(tx, a.user.tenantId, id, current, now)
                  : null,
            status: 'PENDING',
          })
          .returning();
        await notifyFinance(
          tx,
          d,
          a.user.tenantId,
          a.user.id,
          'A supplier bank detail change needs confirmation',
          `${s.company}: a change was requested by ${a.user.name}. The current details stay in force until a different finance person confirms.`,
        );
        await d.audit.record(tx, a.ctx, {
          action: 'bank_change.request',
          entityType: 'supplier',
          entityId: id,
          after: { changeId: row!.id, status: 'PENDING', accountName: body.accountName },
        });
        reply.status(201);
        return changeView(tx, a, row!, await names(tx, a.user.tenantId), s.company);
      });
    },
  );

  reg('GET', '/bank-changes');
  app.get(
    `${p}/bank-changes`,
    { preHandler: guard(d, ['FINANCE', 'PROCUREMENT', 'ADMIN', 'EXEC', 'PROBITY']) },
    async (req) => {
      const a = req.auth!;
      const q = parse(
        z
          .object({
            status: z.enum(['PENDING', 'UNCONFIRMED', 'CONFIRMED', 'REJECTED', 'OPEN']).default('OPEN'),
          })
          .strict(),
        req.query,
      );
      return withContext(d.database, a.ctx, async (tx) => {
        const conds = [eq(bankDetailChange.tenantId, a.user.tenantId)];
        conds.push(
          q.status === 'OPEN'
            ? inArray(bankDetailChange.status, ['PENDING', 'UNCONFIRMED'])
            : eq(bankDetailChange.status, q.status),
        );
        const rows = await tx
          .select()
          .from(bankDetailChange)
          .where(and(...conds))
          .orderBy(desc(bankDetailChange.requestedAt))
          .limit(100);
        const who = await names(tx, a.user.tenantId);
        const companies = new Map(
          (
            await tx
              .select({ id: supplier.id, company: supplier.company })
              .from(supplier)
              .where(eq(supplier.tenantId, a.user.tenantId))
          ).map((s) => [s.id, s.company] as const),
        );
        const items = [];
        for (const r of rows)
          items.push(await changeView(tx, a, r, who, companies.get(r.supplierId) ?? r.supplierId));
        if (a.user.roles.includes('FINANCE') && items.some((i) => i.newBank && !i.newBank.masked))
          await d.audit.record(tx, a.ctx, {
            action: 'supplier.bank_read',
            entityType: 'bank_detail_change',
            after: { unmasked: true, changes: items.length },
          });
        return { items };
      });
    },
  );

  async function decide(a: Auth, id: string, outcome: 'CONFIRM' | 'REJECT', note: string | undefined) {
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(bankDetailChange)
        .where(and(eq(bankDetailChange.id, id), eq(bankDetailChange.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Change not found');
      if (!['PENDING', 'UNCONFIRMED'].includes(r.status))
        throw new AppError(409, 'INVALID_STATE', 'That change has already been decided');
      if (r.requestedBy === a.user.id)
        throw new AppError(
          403,
          'SECOND_PERSON',
          'A different finance person must confirm a change you asked for',
        );
      const now = d.clock.now();
      const [s] = await tx.select().from(supplier).where(eq(supplier.id, r.supplierId));
      if (outcome === 'CONFIRM') {
        if (r.status === 'PENDING') {
          const nb = (await openBank(tx, a.user.tenantId, r.supplierId, r.newBank))!;
          await writeBank(tx, a.user.tenantId, r.supplierId, nb, now);
        }
      } else if (r.status === 'UNCONFIRMED') {
        // the provisional details come out and what was in force before goes back
        const prev = r.previousBank
          ? await openBank(tx, a.user.tenantId, r.supplierId, r.previousBank)
          : null;
        if (prev) await writeBank(tx, a.user.tenantId, r.supplierId, prev, now);
        else await tx.update(supplier).set({ bank: null }).where(eq(supplier.id, r.supplierId));
      }
      await tx
        .update(bankDetailChange)
        .set({
          status: outcome === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
          decidedBy: a.user.id,
          decidedAt: now,
          decisionNote: note ?? null,
        })
        .where(eq(bankDetailChange.id, id));
      await d.audit.record(tx, a.ctx, {
        action: outcome === 'CONFIRM' ? 'bank_change.confirm' : 'bank_change.reject',
        entityType: 'supplier',
        entityId: r.supplierId,
        after: { changeId: id, wasStatus: r.status, note: note ?? null },
      });
      const [fresh] = await tx.select().from(bankDetailChange).where(eq(bankDetailChange.id, id));
      return changeView(tx, a, fresh!, await names(tx, a.user.tenantId), s?.company ?? '');
    });
  }

  reg('POST', '/bank-changes/{id}/confirm');
  app.post(`${p}/bank-changes/:id/confirm`, { preHandler: guard(d, ['FINANCE']) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ note: z.string().trim().max(500).optional() }).strict(), req.body ?? {});
    return decide(req.auth!, id, 'CONFIRM', b.note);
  });
  reg('POST', '/bank-changes/{id}/reject');
  app.post(`${p}/bank-changes/:id/reject`, { preHandler: guard(d, ['FINANCE']) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ note: z.string().trim().min(5).max(500) }).strict(), req.body);
    return decide(req.auth!, id, 'REJECT', b.note);
  });

  return done;
}
