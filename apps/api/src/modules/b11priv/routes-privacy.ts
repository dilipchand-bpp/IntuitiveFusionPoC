/**
 * B11b routes, part 2: collection notices and Privacy Act requests (SEC-D08), the sensitive-data classification scan
 * (SEC-D07) and the prompt-injection flags (SEC-AP08).
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { guard } from '../../auth/guard.js';
import { withContext, withSystem, type Tx } from '../../db/client.js';
import {
  appUser,
  contentFlag,
  dataClassification,
  fieldValue,
  privacyNoticeAck,
  privacyRequest,
  tenant,
} from '../../db/schema.js';
import { DATA_CLASSES, NOTICE_CONTEXTS } from '../../db/schema-b11b.js';
import { AppError, parse } from '../../http/errors.js';
import { loadSettings, saveSettings } from '../settings/settings.js';
import { CLASSIFIER_MODEL, DETECTORS, classRank, type DetectorId } from './classify.js';
import { runScan } from './classification.js';
import { CONTENT_MODEL, FLAG_MARKER, injectionSignals, neutralise } from './content-safety.js';
import {
  MANAGERS,
  acknowledgeNotice,
  applyCorrection,
  buildExport,
  escalateOverdue,
  lodgeRequest,
  namesOf,
  requestView,
} from './privacy.js';
import { STAFF, type B11Deps } from './routes-residency.js';

export interface PrivacyDeps extends B11Deps {
  defaultTenantSlug: string;
}

const uuid = z.string().uuid();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const lodgeBody = z
  .object({
    kind: z.enum(['ACCESS', 'CORRECTION']),
    details: text(5, 2000),
    correctionField: z.enum(['name', 'email']).optional(),
    correctionValue: text(1, 200).optional(),
  })
  .strict();
const logBody = z
  .object({
    requesterName: text(2, 120),
    requesterEmail: z.string().trim().email().max(200),
    kind: z.enum(['ACCESS', 'CORRECTION']),
    details: text(5, 2000),
    correctionField: z.enum(['name', 'email']).optional(),
    correctionValue: text(1, 200).optional(),
    verificationMethod: text(5, 300).optional(),
  })
  .strict();
const privacySettingsBody = z
  .object({
    noticeVersion: text(1, 30),
    noticeText: text(20, 4000),
    officerRole: z.enum(['ADMIN', 'LEGAL', 'PROBITY']),
    responseDays: z.number().int().min(1).max(90),
  })
  .strict();
const reviewBody = z.object({ decision: z.enum(['CONFIRM', 'DISMISS']), reason: text(5, 500) }).strict();

const COLLECTED_FOR: Record<(typeof NOTICE_CONTEXTS)[number], string> = {
  SUPPLIER_REGISTRATION:
    'Collected when a supplier contact registers, to run tender invitations, responses and contracts.',
  USER_ACTIVATION: 'Collected when an account is activated, to sign you in and record what you do for audit.',
  REQUEST_INTAKE: 'Collected when you raise a procurement request, to assess, approve and audit it.',
  PRIVACY_PAGE: 'Shown on the Privacy page where you can ask to see or correct your information.',
};

const LOCATION: Record<string, string> = {
  request: 'Request',
  field_value: 'Record field',
  lesson: 'Lesson',
  review_note: 'Review note',
  clause: 'Contract clause',
  clarification: 'Clarification',
  question: 'Tender question',
  contract_question: 'Contract question',
  contract_comment: 'Contract comment',
  chat_message: 'Intake chat',
  probity_document: 'Probity document',
};

export function registerPrivacyRoutes(app: FastifyInstance, p: string, d: PrivacyDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const now = () => d.clock.now();

  // ---------------------------------------------------------------- collection notice (SEC-D08)
  reg('GET', '/privacy/notice');
  app.get(`${p}/privacy/notice`, { preHandler: guard(d, 'public') }, async (req) => {
    const q = parse(z.object({ context: z.enum(NOTICE_CONTEXTS).default('PRIVACY_PAGE') }), req.query);
    const s = await withSystem(d.database, async (tx) => {
      const [t] = await tx.select().from(tenant).where(eq(tenant.slug, d.defaultTenantSlug));
      return loadSettings(tx, t!.id);
    });
    return {
      context: q.context,
      version: s.privacy.noticeVersion,
      text: s.privacy.noticeText,
      collectedFor: COLLECTED_FOR[q.context],
    };
  });

  reg('GET', '/privacy/notice/status');
  app.get(`${p}/privacy/notice/status`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const acks = await tx
        .select()
        .from(privacyNoticeAck)
        .where(
          and(eq(privacyNoticeAck.userId, a.user.id), eq(privacyNoticeAck.version, s.privacy.noticeVersion)),
        );
      return {
        version: s.privacy.noticeVersion,
        text: s.privacy.noticeText,
        acknowledged: Object.fromEntries(
          NOTICE_CONTEXTS.map((c) => [
            c,
            acks.find((x) => x.context === c)?.acknowledgedAt.toISOString() ?? null,
          ]),
        ),
      };
    });
  });

  reg('POST', '/privacy/notice/ack');
  app.post(`${p}/privacy/notice/ack`, { preHandler: guard(d, 'any') }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(z.object({ context: z.enum(NOTICE_CONTEXTS) }).strict(), req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const r = await acknowledgeNotice(tx, a.user.tenantId, a.user.id, b.context);
      if (!r.already)
        await d.audit.record(tx, a.ctx, {
          action: 'privacy.notice_acknowledged',
          entityType: 'app_user',
          entityId: a.user.id,
          after: { context: b.context, version: r.version },
        });
      return r;
    });
    return reply.status(out.already ? 200 : 201).send(out);
  });

  reg('GET', '/privacy/settings');
  app.get(`${p}/privacy/settings`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => (await loadSettings(tx, a.user.tenantId)).privacy);
  });

  reg('PUT', '/privacy/settings');
  app.put(`${p}/privacy/settings`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const b = parse(privacySettingsBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const { before, after } = await saveSettings(tx, a.user.tenantId, { privacy: b });
      if (JSON.stringify(before.privacy) !== JSON.stringify(after.privacy))
        await d.audit.record(tx, a.ctx, {
          action: 'settings.privacy',
          entityType: 'tenant',
          entityId: a.user.tenantId,
          before: { privacy: before.privacy },
          after: { privacy: after.privacy },
        });
      return after.privacy;
    });
  });

  // ---------------------------------------------------------------- Privacy Act requests (SEC-D08)
  const loadRequest = async (tx: Tx, tenantId: string, id: string) => {
    const [r] = await tx
      .select()
      .from(privacyRequest)
      .where(and(eq(privacyRequest.id, id), eq(privacyRequest.tenantId, tenantId)));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    return r;
  };
  const viewOf = async (tx: Tx, r: typeof privacyRequest.$inferSelect) =>
    requestView(r, await namesOf(tx, [r.assignedTo, r.verifiedBy]), now());

  reg('POST', '/privacy/requests');
  app.post(`${p}/privacy/requests`, { preHandler: guard(d, 'any') }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(lodgeBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const row = await lodgeRequest(tx, a.ctx, {
        kind: b.kind,
        details: b.details,
        correctionField: b.correctionField,
        correctionValue: b.correctionValue,
        channel: 'SELF',
        requesterUserId: a.user.id,
        requesterName: a.user.name,
        requesterEmail: a.user.email,
        lodgedBy: a.user.id,
      });
      return viewOf(tx, row);
    });
    return reply.status(201).send(out);
  });

  reg('GET', '/privacy/requests/mine');
  app.get(`${p}/privacy/requests/mine`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(privacyRequest)
        .where(
          and(eq(privacyRequest.tenantId, a.user.tenantId), eq(privacyRequest.requesterUserId, a.user.id)),
        )
        .orderBy(desc(privacyRequest.createdAt));
      const names = await namesOf(
        tx,
        rows.flatMap((r) => [r.assignedTo, r.verifiedBy]),
      );
      return { items: rows.map((r) => requestView(r, names, now())) };
    });
  });

  reg('GET', '/privacy/requests');
  app.get(`${p}/privacy/requests`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const q = parse(
      z.object({ status: z.enum(['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED']).optional() }),
      req.query,
    );
    return withContext(d.database, a.ctx, async (tx) => {
      const s = await loadSettings(tx, a.user.tenantId);
      const rows = await tx
        .select()
        .from(privacyRequest)
        .where(
          and(
            eq(privacyRequest.tenantId, a.user.tenantId),
            q.status ? eq(privacyRequest.status, q.status) : undefined,
          ),
        )
        .orderBy(asc(privacyRequest.dueDate), asc(privacyRequest.createdAt));
      const names = await namesOf(
        tx,
        rows.flatMap((r) => [r.assignedTo, r.verifiedBy]),
      );
      const items = rows.map((r) => requestView(r, names, now()));
      return {
        responseDays: s.privacy.responseDays,
        officerRole: s.privacy.officerRole,
        summary: {
          open: items.filter((i) => i.status === 'RECEIVED' || i.status === 'IN_PROGRESS').length,
          overdue: items.filter((i) => i.overdue).length,
          completed: items.filter((i) => i.status === 'COMPLETED').length,
          refused: items.filter((i) => i.status === 'REFUSED').length,
        },
        items,
      };
    });
  });

  reg('POST', '/privacy/requests/log');
  app.post(`${p}/privacy/requests/log`, { preHandler: guard(d, [...MANAGERS]) }, async (req, reply) => {
    const a = req.auth!;
    const b = parse(logBody, req.body);
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const [known] = await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(and(eq(appUser.tenantId, a.user.tenantId), eq(appUser.email, b.requesterEmail.toLowerCase())));
      const row = await lodgeRequest(tx, a.ctx, {
        kind: b.kind,
        details: b.details,
        correctionField: b.correctionField,
        correctionValue: b.correctionValue,
        channel: 'STAFF_LOGGED',
        requesterUserId: known?.id ?? null,
        requesterName: b.requesterName,
        requesterEmail: b.requesterEmail,
        lodgedBy: a.user.id,
        verificationMethod: b.verificationMethod,
      });
      return viewOf(tx, row);
    });
    return reply.status(201).send(out);
  });

  const idParam = z.object({ id: uuid });
  const open = (r: typeof privacyRequest.$inferSelect) => {
    if (r.status === 'COMPLETED' || r.status === 'REFUSED')
      throw new AppError(409, 'REQUEST_CLOSED', `This request is already ${r.status.toLowerCase()}`);
  };

  reg('POST', '/privacy/requests/{id}/assign');
  app.post(`${p}/privacy/requests/:id/assign`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ assignedTo: uuid.optional() }).strict(), req.body ?? {});
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await loadRequest(tx, a.user.tenantId, id);
      open(r);
      const to = b.assignedTo ?? a.user.id;
      const [owner] = await tx
        .select({ id: appUser.id })
        .from(appUser)
        .where(and(eq(appUser.id, to), eq(appUser.tenantId, a.user.tenantId)));
      if (!owner) throw new AppError(404, 'NOT_FOUND', 'That person was not found');
      const [row] = await tx
        .update(privacyRequest)
        .set({ assignedTo: to, status: 'IN_PROGRESS', updatedAt: now() })
        .where(eq(privacyRequest.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'privacy.request_assigned',
        entityType: 'privacy_request',
        entityId: id,
        before: { assignedTo: r.assignedTo, status: r.status },
        after: { assignedTo: to, status: 'IN_PROGRESS' },
      });
      return viewOf(tx, row!);
    });
  });

  reg('POST', '/privacy/requests/{id}/verify');
  app.post(`${p}/privacy/requests/:id/verify`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ method: text(5, 300) }).strict(), req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await loadRequest(tx, a.user.tenantId, id);
      open(r);
      const [row] = await tx
        .update(privacyRequest)
        .set({
          identityVerified: true,
          verificationMethod: b.method,
          verifiedBy: a.user.id,
          verifiedAt: now(),
          updatedAt: now(),
        })
        .where(eq(privacyRequest.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'privacy.identity_verified',
        entityType: 'privacy_request',
        entityId: id,
        after: { method: b.method },
      });
      return viewOf(tx, row!);
    });
  });

  reg('POST', '/privacy/requests/{id}/apply-correction');
  app.post(
    `${p}/privacy/requests/:id/apply-correction`,
    { preHandler: guard(d, [...MANAGERS]) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      return withContext(d.database, a.ctx, async (tx) => {
        const r = await loadRequest(tx, a.user.tenantId, id);
        open(r);
        await applyCorrection(tx, a.ctx, r);
        return viewOf(tx, await loadRequest(tx, a.user.tenantId, id));
      });
    },
  );

  reg('POST', '/privacy/requests/{id}/complete');
  app.post(`${p}/privacy/requests/:id/complete`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ summary: text(5, 2000) }).strict(), req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await loadRequest(tx, a.user.tenantId, id);
      open(r);
      if (!r.identityVerified)
        throw new AppError(
          409,
          'IDENTITY_NOT_VERIFIED',
          'Verify the requester’s identity before completing the request',
        );
      if (r.kind === 'CORRECTION' && !r.correctionApplied)
        throw new AppError(
          409,
          'CORRECTION_NOT_APPLIED',
          'Apply the correction before completing the request',
        );
      if (r.kind === 'ACCESS' && !r.exportGeneratedAt)
        throw new AppError(
          409,
          'EXPORT_NOT_GENERATED',
          'Generate the data export before completing an access request',
        );
      const [row] = await tx
        .update(privacyRequest)
        .set({ status: 'COMPLETED', responseSummary: b.summary, completedAt: now(), updatedAt: now() })
        .where(eq(privacyRequest.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'privacy.request_completed',
        entityType: 'privacy_request',
        entityId: id,
        before: { status: r.status },
        after: { status: 'COMPLETED', number: r.number },
      });
      return viewOf(tx, row!);
    });
  });

  reg('POST', '/privacy/requests/{id}/refuse');
  app.post(`${p}/privacy/requests/:id/refuse`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ reason: text(10, 1000) }).strict(), req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const r = await loadRequest(tx, a.user.tenantId, id);
      open(r);
      const [row] = await tx
        .update(privacyRequest)
        .set({ status: 'REFUSED', refusalReason: b.reason, completedAt: now(), updatedAt: now() })
        .where(eq(privacyRequest.id, id))
        .returning();
      await d.audit.record(tx, a.ctx, {
        action: 'privacy.request_refused',
        entityType: 'privacy_request',
        entityId: id,
        before: { status: r.status },
        after: { status: 'REFUSED', reason: b.reason },
      });
      return viewOf(tx, row!);
    });
  });

  reg('GET', '/privacy/requests/{id}/export');
  app.get(`${p}/privacy/requests/:id/export`, { preHandler: guard(d, 'any') }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    const manager = a.user.roles.some((r) => (MANAGERS as readonly string[]).includes(r));
    const out = await withContext(d.database, a.ctx, async (tx) => {
      const r = await loadRequest(tx, a.user.tenantId, id);
      const own = r.requesterUserId === a.user.id;
      // anyone else gets the same answer as for a request that does not exist
      if (!manager && !own) throw new AppError(404, 'NOT_FOUND', 'Request not found');
      if (r.kind !== 'ACCESS')
        throw new AppError(409, 'NOT_AN_ACCESS_REQUEST', 'Only an access request has an export');
      if (!r.identityVerified)
        throw new AppError(
          409,
          'IDENTITY_NOT_VERIFIED',
          'The requester’s identity has not been verified yet',
        );
      // the person receives the file once the officer has completed the request; the officer can build it earlier to check it
      if (!manager && r.status !== 'COMPLETED')
        throw new AppError(
          409,
          'NOT_READY',
          'Your export is released when the privacy officer completes your request',
        );
      if (r.status === 'REFUSED') throw new AppError(409, 'REQUEST_REFUSED', 'This request was refused');
      const file = await buildExport(tx, a.user.tenantId, r);
      await tx
        .update(privacyRequest)
        .set({ exportGeneratedAt: now(), updatedAt: now() })
        .where(eq(privacyRequest.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'privacy.export_generated',
        entityType: 'privacy_request',
        entityId: id,
        after: { number: r.number, by: manager ? 'OFFICER' : 'REQUESTER' },
      });
      return { number: r.number, file };
    });
    reply.header('content-disposition', `attachment; filename="privacy-access-${out.number}.json"`);
    return out.file;
  });

  reg('POST', '/privacy/requests/run-overdue');
  app.post(`${p}/privacy/requests/run-overdue`, { preHandler: guard(d, [...MANAGERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => ({
      escalated: await escalateOverdue(tx, a.user.tenantId, a.user.id),
    }));
  });

  // ---------------------------------------------------------------- classification (SEC-D07)
  reg('POST', '/privacy/classification/run');
  app.post(`${p}/privacy/classification/run`, { preHandler: guard(d, ['ADMIN', 'PROBITY']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, (tx) => runScan(tx, a.user.tenantId, a.user.id, 'MANUAL'));
  });

  reg('GET', '/privacy/classification');
  app.get(
    `${p}/privacy/classification`,
    { preHandler: guard(d, ['PROBITY', 'ADMIN', 'LEGAL', 'EXEC']) },
    async (req) => {
      const a = req.auth!;
      const q = parse(
        z.object({
          status: z.enum(['OPEN', 'CONFIRMED', 'DISMISSED']).optional(),
          class: z.enum(DATA_CLASSES).optional(),
          warningsOnly: z.enum(['true', 'false']).optional(),
        }),
        req.query,
      );
      return withContext(d.database, a.ctx, async (tx) => {
        const all = await tx
          .select()
          .from(dataClassification)
          .where(eq(dataClassification.tenantId, a.user.tenantId))
          .orderBy(desc(dataClassification.scannedAt));
        const rows = all
          .filter((r) => !q.status || r.status === q.status)
          .filter((r) => !q.class || r.class === q.class)
          .filter((r) => q.warningsOnly !== 'true' || r.warning !== null)
          .sort(
            (x, y) => classRank(y.class) - classRank(x.class) || x.entityType.localeCompare(y.entityType),
          );
        const fvIds = rows.filter((r) => r.entityType === 'field_value').map((r) => r.entityId);
        const owners = fvIds.length
          ? await tx
              .select({ id: fieldValue.id, ownerType: fieldValue.ownerType, ownerId: fieldValue.ownerId })
              .from(fieldValue)
              .where(inArray(fieldValue.id, fvIds))
          : [];
        const names = await namesOf(
          tx,
          rows.map((r) => r.reviewedBy),
        );
        // only offer a link to a screen this person may open (an administrator may not open requests)
        const mayOpenRequests = (a.user.roles as readonly string[]).some((x) =>
          [
            'REQUESTER',
            'PROCUREMENT',
            'DELEGATE',
            'LEGAL',
            'CONTRACT_MGR',
            'PROBITY',
            'FINANCE',
            'EXEC',
          ].includes(x),
        );
        const linkOf = (r: (typeof rows)[number]) => {
          if (!mayOpenRequests) return null;
          if (r.entityType === 'request') return `/app/requests/${r.entityId}`;
          if (r.entityType === 'field_value') {
            const o = owners.find((x) => x.id === r.entityId);
            return o?.ownerType === 'REQUEST' ? `/app/requests/${o.ownerId}` : null;
          }
          return null;
        };
        const count = <K extends string>(f: (r: (typeof all)[number]) => K) => {
          const m = new Map<K, number>();
          for (const r of all) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
          return m;
        };
        const byClass = count((r) => r.class);
        const byLoc = count((r) => r.entityType);
        return {
          model: CLASSIFIER_MODEL,
          simulated: true,
          scope:
            'Text fields of requests, plans, lessons, review notes, contract clauses, clarifications, tender and contract messages, intake chat and probity documents. Uploaded files are held sealed and are not read.',
          summary: {
            total: all.length,
            open: all.filter((r) => r.status === 'OPEN').length,
            confirmed: all.filter((r) => r.status === 'CONFIRMED').length,
            dismissed: all.filter((r) => r.status === 'DISMISSED').length,
            warnings: all.filter((r) => r.warning !== null && r.status === 'OPEN').length,
            lastScanAt: all[0]?.scannedAt.toISOString() ?? null,
            byClass: DATA_CLASSES.map((c) => ({ class: c, count: byClass.get(c) ?? 0 })),
            byLocation: [...byLoc.entries()].map(([k, n]) => ({
              entityType: k,
              label: LOCATION[k] ?? k,
              count: n,
            })),
          },
          findings: rows.map((r) => ({
            id: r.id,
            class: r.class,
            detectors: (r.detectors as DetectorId[]).map((id) => ({ id, label: DETECTORS[id]?.label ?? id })),
            maskedSample: r.maskedSample,
            location: { type: LOCATION[r.entityType] ?? r.entityType, field: r.field },
            link: linkOf(r),
            warning: r.warning,
            status: r.status,
            reviewedBy: r.reviewedBy ? (names.get(r.reviewedBy) ?? null) : null,
            reviewedAt: r.reviewedAt?.toISOString() ?? null,
            reviewReason: r.reviewReason,
            firstSeenAt: r.firstSeenAt.toISOString(),
            scannedAt: r.scannedAt.toISOString(),
          })),
        };
      });
    },
  );

  reg('POST', '/privacy/classification/{id}/review');
  app.post(
    `${p}/privacy/classification/:id/review`,
    { preHandler: guard(d, ['ADMIN', 'PROBITY', 'LEGAL']) },
    async (req) => {
      const a = req.auth!;
      const { id } = parse(idParam, req.params);
      const b = parse(reviewBody, req.body);
      return withContext(d.database, a.ctx, async (tx) => {
        const [r] = await tx
          .select()
          .from(dataClassification)
          .where(and(eq(dataClassification.id, id), eq(dataClassification.tenantId, a.user.tenantId)));
        if (!r) throw new AppError(404, 'NOT_FOUND', 'Finding not found');
        const status = b.decision === 'CONFIRM' ? 'CONFIRMED' : 'DISMISSED';
        await tx
          .update(dataClassification)
          .set({ status, reviewedBy: a.user.id, reviewedAt: now(), reviewReason: b.reason })
          .where(eq(dataClassification.id, id));
        await d.audit.record(tx, a.ctx, {
          action: `classification.${b.decision.toLowerCase()}`,
          entityType: 'data_classification',
          entityId: id,
          before: { status: r.status },
          after: { status, reason: b.reason, class: r.class, location: `${r.entityType}: ${r.field}` },
        });
        return { id, status };
      });
    },
  );

  // ---------------------------------------------------------------- prompt-injection flags (SEC-AP08)
  const SAFETY = ['ADMIN', 'PROBITY', 'PROCUREMENT'] as const;
  reg('GET', '/content-safety/flags');
  app.get(`${p}/content-safety/flags`, { preHandler: guard(d, [...SAFETY]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(contentFlag)
        .where(eq(contentFlag.tenantId, a.user.tenantId))
        .orderBy(desc(contentFlag.createdAt))
        .limit(200);
      const names = await namesOf(
        tx,
        rows.flatMap((r) => [r.actorId, r.reviewedBy]),
      );
      const bySource = new Map<string, number>();
      for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
      return {
        model: CONTENT_MODEL,
        simulated: true,
        marker: FLAG_MARKER,
        rule: 'Supplier and uploaded text is treated as data. It is neutralised, wrapped as data and flagged here when it reads like instructions. No score, compliance result, route or rule is ever computed from free text.',
        total: rows.length,
        open: rows.filter((r) => r.status === 'OPEN').length,
        bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })),
        flags: rows.map((r) => ({
          id: r.id,
          source: r.source,
          entityType: r.entityType,
          entityId: r.entityId,
          signals: r.signals as Array<{ code: string; label: string }>,
          excerpt: r.excerpt,
          by: r.actorId ? (names.get(r.actorId) ?? null) : null,
          status: r.status,
          reviewedBy: r.reviewedBy ? (names.get(r.reviewedBy) ?? null) : null,
          at: r.createdAt.toISOString(),
        })),
      };
    });
  });

  reg('POST', '/content-safety/flags/{id}/review');
  app.post(`${p}/content-safety/flags/:id/review`, { preHandler: guard(d, [...SAFETY]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(idParam, req.params);
    return withContext(d.database, a.ctx, async (tx) => {
      const [r] = await tx
        .select()
        .from(contentFlag)
        .where(and(eq(contentFlag.id, id), eq(contentFlag.tenantId, a.user.tenantId)));
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Flag not found');
      await tx
        .update(contentFlag)
        .set({ status: 'REVIEWED', reviewedBy: a.user.id, reviewedAt: now() })
        .where(eq(contentFlag.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'content.flag_reviewed',
        entityType: 'content_flag',
        entityId: id,
        before: { status: r.status },
        after: { status: 'REVIEWED' },
      });
      return { id, status: 'REVIEWED' };
    });
  });

  reg('POST', '/content-safety/inspect');
  app.post(`${p}/content-safety/inspect`, { preHandler: guard(d, [...SAFETY]) }, async (req) => {
    const b = parse(z.object({ text: text(1, 4000) }).strict(), req.body);
    const n = neutralise(b.text, 'inspected text');
    return {
      model: CONTENT_MODEL,
      flagged: n.flagged,
      marker: n.flagged ? FLAG_MARKER : null,
      signals: injectionSignals(b.text),
      hiddenCharactersRemoved: n.hiddenRemoved,
      neutralised: n.wrapped,
    };
  });

  void STAFF;
  void sql;
  return done;
}
