/**
 * Batch B11a routes: customer-managed keys and envelope encryption (SEC-D02, SEC-D04), sealed bids (SEC-D03), upload malware
 * scanning and quarantine (SEC-AP04), restricted projects (FR-0865), the encryption and transport evidence (SEC-D01) and the
 * tenant-isolation evidence (NFR-R01, SEC-D10).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '@if/shared';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext, withSystem } from '../../db/client.js';
import {
  appUser,
  fileObject,
  KEY_PURPOSES,
  quarantineItem,
  request,
  responseAnswer,
  restrictedDelegate,
  restrictedProject,
  submission,
  supplier,
} from '../../db/schema.js';
import { AppError, parse } from '../../http/errors.js';
import { TenderService } from '../tender/service.js';
import type { SealedStore } from '../tender/files.js';
import { auditDecrypt, bidRewrappers, bidSeal, encryptExistingBids, sealedError } from './bids.js';
import { collectEvidence, isolationCheck } from './evidence.js';
import { dataRewrappers, encryptExistingFields, fileRewrapper } from './fields.js';
import {
  blobEnvelope,
  configureKeyService,
  isEnvelopeBlob,
  keyView,
  listKeys,
  rewrapAll,
  rotateKey,
  setKeyDisabled,
  type Rewrapper,
} from './keys.js';
import { addDelegate, projectRewrappers, restrictProject } from './projects.js';
import { rescanHeld } from './upload-gate.js';
import { SCANNER_ENGINE, EICAR_SIGNATURE, SYNTHETIC_SIGNATURE } from './malware.js';

export interface B11aDeps extends GuardDeps {
  store: SealedStore;
  config: AppConfig;
  keyMaterial: string;
}

const uuid = z.string().uuid();
const purposeParam = z.object({ purpose: z.enum(KEY_PURPOSES) }).strict();
const restrictBody = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
const delegateBody = z.object({ userId: uuid }).strict();

export const KEY_READERS = ['ADMIN', 'PROBITY', 'EXEC'] as const;
/** Roles that may decrypt a bid file through the bid box once the tender is open (the evaluation routes serve panel members). */
const BID_READERS = ['PROCUREMENT', 'PROBITY', 'LEGAL'] as const;

export function registerB11a(app: FastifyInstance, p: string, d: B11aDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  configureKeyService(d.keyMaterial);
  const now = () => d.clock.now();
  const svc = new TenderService(d.clock, d.audit, d.store);
  const rewrappers = (purpose: (typeof KEY_PURPOSES)[number]): Rewrapper[] =>
    purpose === 'BIDS'
      ? bidRewrappers(d.store)
      : purpose === 'DATA'
        ? dataRewrappers(d.store)
        : [...projectRewrappers(), fileRewrapper(d.store, 'PROJECT')];

  // ---------------------------------------------------------------- keys (SEC-D02, SEC-D04)
  reg('GET', '/security/keys');
  app.get(`${p}/security/keys`, { preHandler: guard(d, [...KEY_READERS]) }, async (req) => {
    const a = req.auth!;
    // creating the first key of each purpose is a write, so this runs as the system for the caller's tenant
    const rows = await withSystem(d.database, (tx) => listKeys(tx, a.user.tenantId, now()));
    const evidence = await collectEvidence(
      { database: d.database, store: d.store, app, config: d.config, now: now() },
      a.user.tenantId,
    );
    return {
      simulated: true,
      label: evidence.keyService.label,
      rootKeySource: evidence.keyService.rootKeySource,
      keys: rows.map((k) => ({
        ...keyView(k),
        usedBy: evidence.keys.find((x) => x.purpose === k.purpose && x.version === k.version)?.usedBy ?? 0,
      })),
      purposes: KEY_PURPOSES.map((x) => ({
        purpose: x,
        meaning:
          x === 'BIDS'
            ? 'Bid documents and response answers'
            : x === 'PROJECT'
              ? 'Restricted projects (per-project keys are wrapped by this key)'
              : 'Other sensitive fields and documents (supplier bank details, contract files)',
      })),
    };
  });

  reg('POST', '/security/keys/{purpose}/rotate');
  app.post(`${p}/security/keys/:purpose/rotate`, { preHandler: guard(d, ['ADMIN']) }, async (req, reply) => {
    const a = req.auth!;
    const { purpose } = parse(purposeParam, req.params);
    const row = await withContext(d.database, a.ctx, (tx) =>
      rotateKey(tx, { audit: d.audit, now: now() }, a.ctx, purpose),
    );
    return reply.status(201).send(keyView(row));
  });

  reg('POST', '/security/keys/{purpose}/rewrap');
  app.post(`${p}/security/keys/:purpose/rewrap`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { purpose } = parse(purposeParam, req.params);
    // bid files are hidden from everyone by row level security before close, so the job runs as the system
    return withSystem(d.database, (tx) =>
      rewrapAll(tx, { audit: d.audit, now: now() }, a.ctx, purpose, rewrappers(purpose)),
    );
  });

  for (const action of ['disable', 'enable'] as const) {
    reg('POST', `/security/keys/{id}/${action}`);
    app.post(`${p}/security/keys/:ref/${action}`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
      const a = req.auth!;
      const { ref } = parse(z.object({ ref: uuid }), req.params);
      const row = await withContext(d.database, a.ctx, (tx) =>
        setKeyDisabled(tx, { audit: d.audit, now: now() }, a.ctx, ref, action === 'disable'),
      );
      return keyView(row);
    });
  }

  // ---------------------------------------------------------------- sealed bids (SEC-D03)
  const BOX_ROLES = ['ADMIN', 'PROCUREMENT', 'PROBITY', 'EXEC', 'LEGAL'] as const;
  reg('GET', '/tenders/{id}/bid-box');
  app.get(`${p}/tenders/:id/bid-box`, { preHandler: guard(d, [...BOX_ROLES]) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    await svc.closeDue(d.database);
    const l = await withContext(d.database, a.ctx, (tx) => svc.load(tx, a.user.tenantId, id));
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
    const status = svc.status(l.tender);
    const seal = bidSeal(status, l.tender);
    // row level security hides bid files from everyone inside the organisation before close, so the metadata is read as the system
    return withSystem(d.database, async (tx) => {
      const subs = await tx
        .select({
          id: submission.id,
          supplierId: submission.supplierId,
          status: submission.status,
          submittedAt: submission.submittedAt,
          company: supplier.company,
        })
        .from(submission)
        .innerJoin(supplier, eq(supplier.id, submission.supplierId))
        .where(and(eq(submission.tenderId, id), eq(submission.tenantId, a.user.tenantId)));
      const bids = [];
      for (const s of subs) {
        const files = await tx.select().from(fileObject).where(eq(fileObject.submissionId, s.id));
        const answers = await tx
          .select({ v: responseAnswer.value })
          .from(responseAnswer)
          .where(eq(responseAnswer.submissionId, s.id));
        const fileViews = [];
        for (const f of files) {
          let keyVersion: number | null = null;
          let encrypted = false;
          try {
            const raw = await d.store.rawBytes(f.storageKey);
            if (isEnvelopeBlob(raw)) {
              encrypted = true;
              keyVersion = blobEnvelope(raw).kv;
            }
          } catch {
            /* missing on disk */
          }
          fileViews.push({
            id: f.id,
            // the name and section can say what the bid contains, so they stay sealed with the content
            name: seal.readable ? f.name : null,
            section: seal.readable ? f.section : null,
            sizeBytes: f.sizeBytes,
            sha256: f.sha256,
            uploadedAt: f.createdAt.toISOString(),
            encrypted,
            keyVersion,
          });
        }
        bids.push({
          submissionId: s.id,
          bidder: seal.readable ? s.company : null,
          status: s.status,
          submittedAt: s.submittedAt?.toISOString() ?? null,
          files: fileViews,
          answers: {
            count: answers.length,
            encrypted: answers.filter((x) => x.v.startsWith('ife1.')).length,
            sizeBytes: answers.reduce((n, x) => n + x.v.length, 0),
          },
        });
      }
      return {
        tenderId: id,
        status,
        dualWitness: l.tender.dualWitness,
        opened: l.tender.openedAt !== null,
        seal,
        bidCount: bids.length,
        bids,
        note: seal.readable
          ? 'The bids are open. Reading a file decrypts it and is audited.'
          : 'Only metadata is shown: that a bid exists, its size, time and hash. Content, names and bidders stay encrypted.',
      };
    });
  });

  reg('GET', '/tenders/{id}/bid-box/files/{fileId}');
  app.get(
    `${p}/tenders/:id/bid-box/files/:fileId`,
    { preHandler: guard(d, [...BOX_ROLES]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id, fileId } = parse(z.object({ id: uuid, fileId: uuid }), req.params);
      await svc.closeDue(d.database);
      const l = await withContext(d.database, a.ctx, (tx) => svc.load(tx, a.user.tenantId, id));
      if (!l) throw new AppError(404, 'NOT_FOUND', 'Tender not found');
      const seal = bidSeal(svc.status(l.tender), l.tender);
      if (!seal.readable) {
        // refused, and the attempt is on the record: a late read is itself evidence
        await d.audit.recordOutsideTx(d.database, a.ctx, {
          action: 'bid.read_refused',
          entityType: 'tender',
          entityId: id,
          after: { reason: seal.code, fileId },
          result: 'DENIED',
        });
        throw sealedError(seal);
      }
      if (!a.user.roles.some((r) => (BID_READERS as readonly string[]).includes(r)))
        throw new AppError(
          403,
          'BID_READ_NOT_PERMITTED',
          'Your role is not entitled to read bid content. Evaluation panel members read bids through the evaluation.',
        );
      const f = await withSystem(d.database, async (tx) => {
        const [sub] = await tx
          .select({ id: submission.id })
          .from(submission)
          .innerJoin(fileObject, eq(fileObject.submissionId, submission.id))
          .where(
            and(
              eq(submission.tenderId, id),
              eq(fileObject.id, fileId),
              eq(submission.tenantId, a.user.tenantId),
            ),
          );
        if (!sub) throw new AppError(404, 'NOT_FOUND', 'File not found');
        const [row] = await tx.select().from(fileObject).where(eq(fileObject.id, fileId));
        await auditDecrypt(d.audit, tx, a.ctx, id, { kind: 'FILE', fileId });
        return row!;
      });
      const bytes = await d.store.get(f.storageKey).catch((e: unknown) => {
        if (e instanceof AppError) throw e;
        return null;
      });
      if (!bytes) throw new AppError(404, 'FILE_UNAVAILABLE', 'This file is not available');
      return reply
        .header('content-type', f.contentType)
        .header('content-disposition', `attachment; filename="${f.name.replace(/[^\w. -]/g, '_')}"`)
        .send(bytes);
    },
  );

  // ---------------------------------------------------------------- quarantine and the scanner (SEC-AP04)
  const QUARANTINE_READERS = ['ADMIN', 'PROBITY'] as const;
  reg('GET', '/security/quarantine');
  app.get(`${p}/security/quarantine`, { preHandler: guard(d, [...QUARANTINE_READERS]) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({
          id: quarantineItem.id,
          source: quarantineItem.source,
          name: quarantineItem.name,
          sizeBytes: quarantineItem.sizeBytes,
          sha256: quarantineItem.sha256,
          signature: quarantineItem.signature,
          status: quarantineItem.status,
          createdAt: quarantineItem.createdAt,
          scannedAt: quarantineItem.scannedAt,
          user: appUser.name,
        })
        .from(quarantineItem)
        .leftJoin(appUser, eq(appUser.id, quarantineItem.userId))
        .where(eq(quarantineItem.tenantId, a.user.tenantId))
        .orderBy(desc(quarantineItem.createdAt))
        .limit(200);
      const { loadSettings } = await import('../settings/settings.js');
      const s = await loadSettings(tx, a.user.tenantId);
      return {
        simulated: true,
        scanner: {
          engine: SCANNER_ENGINE,
          mode: s.uploadScanning.scannerMode,
          testSignatures: [EICAR_SIGNATURE, SYNTHETIC_SIGNATURE],
          failClosed:
            'While the scanner is DOWN every upload is held as PENDING_SCAN and is not available until it has been scanned.',
        },
        items: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          scannedAt: r.scannedAt?.toISOString() ?? null,
        })),
      };
    });
  });

  reg('POST', '/security/quarantine/{id}/rescan');
  app.post(`${p}/security/quarantine/:id/rescan`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const row = await withContext(d.database, a.ctx, (tx) =>
      rescanHeld(tx, { database: d.database, audit: d.audit, clock: d.clock }, a.ctx, id),
    );
    return {
      id: row.id,
      status: row.status,
      signature: row.signature,
      scannedAt: row.scannedAt?.toISOString() ?? null,
    };
  });

  // ---------------------------------------------------------------- evidence (SEC-D01) and isolation (NFR-R01, SEC-D10)
  reg('GET', '/security/evidence');
  app.get(`${p}/security/evidence`, { preHandler: guard(d, [...KEY_READERS]) }, async (req) => {
    const a = req.auth!;
    await withSystem(d.database, (tx) => listKeys(tx, a.user.tenantId, now()));
    return collectEvidence(
      { database: d.database, store: d.store, app, config: d.config, now: now() },
      a.user.tenantId,
    );
  });

  reg('POST', '/security/isolation-check');
  app.post(`${p}/security/isolation-check`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    const out = await isolationCheck(d.database, a.ctx, now());
    await withContext(d.database, a.ctx, (tx) =>
      d.audit.record(tx, a.ctx, {
        action: 'security.isolation_check',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        after: { ok: out.ok, rls: out.withRowLevelSecurity, tables: out.tablesWithTenantId },
      }),
    );
    return out;
  });

  reg('POST', '/security/encrypt-existing');
  app.post(`${p}/security/encrypt-existing`, { preHandler: guard(d, ['ADMIN']) }, async (req) => {
    const a = req.auth!;
    return withSystem(d.database, async (tx) => {
      const bids = await encryptExistingBids(tx, d.store, now(), a.user.tenantId);
      const fields = await encryptExistingFields(tx, { audit: d.audit, now: now() }, a.ctx);
      await d.audit.record(tx, a.ctx, {
        action: 'security.encrypt_existing',
        entityType: 'tenant',
        entityId: a.user.tenantId,
        after: { ...bids, ...fields },
      });
      return { bids, fields };
    });
  });

  // ---------------------------------------------------------------- restricted projects (FR-0865)
  const SETTERS = ['PROCUREMENT', 'EXEC'] as const;
  reg('POST', '/requests/{id}/restrict');
  app.post(`${p}/requests/:id/restrict`, { preHandler: guard(d, [...SETTERS]) }, async (req, reply) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { reason } = parse(restrictBody, req.body);
    const out = await withContext(d.database, a.ctx, (tx) =>
      restrictProject(tx, { audit: d.audit, now: now(), store: d.store }, a.ctx, id, reason),
    );
    return reply.status(201).send(out);
  });

  const viewOf = async (
    tx: Parameters<Parameters<typeof withContext>[2]>[0],
    tenantId: string,
    requestId: string,
  ) => {
    const [rp] = await tx.select().from(restrictedProject).where(eq(restrictedProject.requestId, requestId));
    if (!rp) return null;
    const [r] = await tx.select().from(request).where(eq(request.id, requestId));
    const dels = await tx
      .select({ userId: restrictedDelegate.userId, name: appUser.name })
      .from(restrictedDelegate)
      .innerJoin(appUser, eq(appUser.id, restrictedDelegate.userId))
      .where(eq(restrictedDelegate.requestId, requestId));
    const [by] = await tx.select({ name: appUser.name }).from(appUser).where(eq(appUser.id, rp.setBy));
    return {
      requestId,
      number: r?.number ?? null,
      title: r?.title ?? null,
      reason: rp.reason,
      restrictedAt: rp.setAt.toISOString(),
      restrictedBy: by?.name ?? null,
      keyVersion: rp.keyVersion,
      delegates: dels,
    };
  };

  reg('GET', '/requests/{id}/restriction');
  app.get(`${p}/requests/:id/restriction`, { preHandler: guard(d, 'any') }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const v = await withContext(d.database, a.ctx, (tx) => viewOf(tx, a.user.tenantId, id));
    if (!v) throw new AppError(404, 'NOT_FOUND', 'Not found'); // not restricted, or not yours to know about: the same answer
    return v;
  });

  reg('POST', '/requests/{id}/restriction/delegates');
  app.post(
    `${p}/requests/:id/restriction/delegates`,
    { preHandler: guard(d, [...SETTERS]) },
    async (req, reply) => {
      const a = req.auth!;
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { userId } = parse(delegateBody, req.body);
      await withContext(d.database, a.ctx, async (tx) => {
        const [u] = await tx
          .select({ id: appUser.id })
          .from(appUser)
          .where(and(eq(appUser.id, userId), eq(appUser.tenantId, a.user.tenantId)));
        if (!u) throw new AppError(422, 'VALIDATION_FAILED', 'That person is not in this organisation');
        await addDelegate(tx, { audit: d.audit, now: now() }, a.ctx, id, userId);
      });
      return reply.status(201).send({ requestId: id, userId });
    },
  );

  reg('GET', '/security/restricted-projects');
  app.get(
    `${p}/security/restricted-projects`,
    { preHandler: guard(d, [...KEY_READERS, 'PROCUREMENT']) },
    async (req) => {
      const a = req.auth!;
      return withContext(d.database, a.ctx, async (tx) => {
        // row level security returns only the projects whose group the caller is in
        const rows = await tx
          .select({ id: restrictedProject.requestId })
          .from(restrictedProject)
          .where(eq(restrictedProject.tenantId, a.user.tenantId));
        const out = [];
        for (const r of rows) {
          const v = await viewOf(tx, a.user.tenantId, r.id);
          if (v) out.push(v);
        }
        return out;
      });
    },
  );

  return done;
}
