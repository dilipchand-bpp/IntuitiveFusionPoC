import re
root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'


def patch(path, pairs):
    p = root + '\\' + path
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, s.count(a), a[:80])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)


patch(r'modules\notify\email.ts', [("    | 'CLARIFICATION'\n    | 'BAFO';", "    | 'CLARIFICATION'\n    | 'BAFO'\n    | 'SIGNING_INVITATION'\n    | 'SIGNING_REMINDER';")])

patch(r'modules\contract\routes.ts', [
    # imports and deps
    ("import { AppError, parse } from '../../http/errors.js';\nimport { loadSettings }", """import { AppError, parse } from '../../http/errors.js';
import { MockSanctionsScreening, type SanctionsScreening } from '../../adapters/sanctions.js';
import { MockVendorRegistry, type VendorRegistry } from '../../adapters/vendor-registry.js';
import type { SealedStore } from '../tender/files.js';
import { isProtected } from './b4-rules.js';
import { releaseExtra, registerContractB4 } from './b4-routes.js';
import {
  inviteSigners,
  lockState,
  releaseGate,
  signBlock,
  endorsementState,
  checkRows,
  sweepSigningReminders,
} from './b4-service.js';
import { loadSettings }"""),
    ("  schedulerMinutes?: number | undefined;\n}", "  schedulerMinutes?: number | undefined;\n  store: SealedStore;\n  registry?: VendorRegistry;\n  sanctions?: SanctionsScreening;\n}"),
    # summary
    ("      parentId: c.parentId,\n      signaturesRequired:", "      parentId: c.parentId,\n      docType: c.docType,\n      signingMode: c.signingMode,\n      signaturesRequired:"),
    ("      title: req?.title ?? null,\n      requestNumber", "      title: req?.title ?? c.title ?? null,\n      requestNumber"),
    # view: blind mode, sign block, protected, extras
    ("""    const roles = a.user.roles;
    const editable = !c.locked && ['DRAFT', 'LEGAL_REVIEW'].includes(c.status);
    const nextSigner""", """    const roles = a.user.roles;
    const settings = await loadSettings(tx, a.user.tenantId);
    // in blind signing a signatory sees no other signature or identity until the contract is executed (FR-0425)
    const blind =
      c.signingMode === 'BLIND' &&
      c.status !== 'EXECUTED' &&
      !roles.some((r) => ['LEGAL', 'PROCUREMENT', 'PROBITY'].includes(r));
    const editable = !c.locked && ['DRAFT', 'LEGAL_REVIEW'].includes(c.status);
    const nextSigner"""),
    ("""        canSign = del.allowed;
        if (!del.allowed)""", """        canSign = del.allowed;
        const blk = await signBlock(tx, c, chain, nextSigner.role, d.clock.now());
        if (canSign && blk) {
          canSign = false;
          signBlocked = blk.message;
        } else if (!del.allowed)"""),
    ("""        decision: decisions.get(k.id) ?? null,
        templateText:""", """        decision: decisions.get(k.id) ?? null,
        protected: isProtected(k.clauseId, settings.contractRules.protectedClauses),
        templateText:"""),
    ("""    const kids = c.parentId ? [] : await variationsOf(tx, c);""", """    const acceptances = ordered.length
      ? await tx
          .select({ a: approval, name: appUser.name })
          .from(approval)
          .innerJoin(appUser, eq(appUser.id, approval.userId))
          .where(
            and(
              eq(approval.subjectType, 'CONTRACT_RISK_ACCEPTANCE'),
              inArray(
                approval.subjectId,
                ordered.map((k) => k.id),
              ),
            ),
          )
      : [];
    const endorse = await endorsementState(tx, c);
    const allChecks = await checkRows(tx, c.id);
    const lock = await lockState(tx, c, d.clock.now());
    const kids = c.parentId ? [] : await variationsOf(tx, c);"""),
    ("""      deviations: devRows.map(({ id: _id, ...x }) => ({
        ...x,
        decision: x.decision?.decision ?? null,
        decidedBy: x.decision?.by ?? null,
        stamp: x.decision?.stamp ?? null,
      })),
      signatures,
      chain,""", """      deviations: devRows.map(({ id: kid, ...x }) => ({
        ...x,
        decision: x.decision?.decision ?? null,
        decidedBy: x.decision?.by ?? null,
        stamp: x.decision?.stamp ?? null,
        acceptances: acceptances
          .filter((y) => y.a.subjectId === kid)
          .map((y) => ({ by: y.name, stamp: y.a.stamp, statement: y.a.comment })),
      })),
      signatures: blind ? signatures.filter((s) => s.userId === a.user.id) : signatures,
      chain: blind ? chain.map((s) => ({ ...s, signedBy: null, stamp: null })) : chain,
      title: base.title,
      endorsements: endorse,
      checks: {
        tender: allChecks.filter((r) => r.kind === 'TENDER_CONSISTENCY'),
        vendor: allChecks.filter((r) => r.kind === 'VENDOR_PREFLIGHT'),
        recheck: allChecks.filter((r) => r.kind === 'RECHECK'),
      },
      negotiation: { locked: lock.locked, lockAt: lock.lockAt.toISOString(), daysOpen: lock.daysOpen, limitDays: lock.limitDays },
      blind,"""),
    ("""        canEditRecord,
      },
    };
  }""", """        canEditRecord,
        canEndorse:
          editable &&
          endorse.missing.some((r) => roles.includes(r as RoleName)),
        canRunChecks: !c.locked && roles.some((r) => ['LEGAL', 'PROCUREMENT'].includes(r)),
        canComment: roles.some((r) => ['LEGAL', 'PROCUREMENT', 'CONTRACT_MGR', 'FINANCE'].includes(r)),
        canAskQuestion: !c.locked && roles.some((r) => ['DELEGATE', 'EXEC', 'LEGAL', 'PROCUREMENT'].includes(r)),
      },
    };
  }"""),
    # GET contract: viewed marker; list: sweep reminders
    ("""    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => view(tx, a, await load(tx, a, id)));
  });""", """    const id = cid(req);
    return withContext(d.database, a.ctx, async (tx) => {
      // a signatory who opens the contract has seen it (FR-0445)
      await tx
        .update(signingInvitation)
        .set({ viewedAt: d.clock.now() })
        .where(
          and(
            eq(signingInvitation.contractId, id),
            eq(signingInvitation.userId, a.user.id),
            isNull(signingInvitation.viewedAt),
          ),
        );
      return view(tx, a, await load(tx, a, id));
    });
  });"""),
    ("  app.get(`${p}/contracts`, { preHandler: guard(d, READERS) }, async (req) => {\n    const a = req.auth!;", "  app.get(`${p}/contracts`, { preHandler: guard(d, READERS) }, async (req) => {\n    const a = req.auth!;\n    await sweepSigningReminders(d.database, d.clock.now()).catch(() => undefined);"),
    # clause edit: who and when, protected notice
    (".set({ text: body.text.trim(), title, changedFromTemplate: changed, risk })", ".set({\n          text: body.text.trim(),\n          title,\n          changedFromTemplate: changed,\n          risk,\n          editedBy: a.user.id,\n          editedAt: d.clock.now(),\n        })"),
    ("""      if (c.status === 'DRAFT')
        await tx
          .update(contract)
          .set({ status: 'LEGAL_REVIEW',""", """      // a change to a non-negotiable clause goes to General Counsel and the risk delegate at once (FR-0400)
      if (changed && isProtected(clauseId, (await loadSettings(tx, a.user.tenantId)).contractRules.protectedClauses)) {
        await notifyRoles(
          tx,
          a.user.tenantId,
          ['EXEC', 'PROBITY'],
          'A non-negotiable clause was changed',
          `${c.number}: ${k.title}. Signature routing is blocked until General Counsel or the risk delegate approves.`,
          `/app/contracts/${id}`,
        );
        await d.audit.record(tx, a.ctx, {
          action: 'contract.protected_clause_changed',
          entityType: 'contract',
          entityId: id,
          after: { clauseId, risk },
        });
      }
      if (c.status === 'DRAFT')
        await tx
          .update(contract)
          .set({ status: 'LEGAL_REVIEW',"""),
    # release
    ("""        const blockers = [
          ...releaseBlockers({ value: Number(c.value), startDate: c.startDate, endDate: c.endDate }, clauses),""", """        const extra = releaseExtra.safeParse(req.body ?? {});
        if (!extra.success)
          throw new AppError(400, 'VALIDATION_FAILED', 'Invalid request', [
            { field: 'signingMode', message: 'Use STANDARD, BLIND or STAGED' },
          ]);
        const now0 = d.clock.now();
        const gate = await releaseGate(tx, c, now0, registry);
        const lockNow = await lockState(tx, c, now0);
        const blockers = [
          ...releaseBlockers({ value: Number(c.value), startDate: c.startDate, endDate: c.endDate }, clauses).filter(
            (m) => c.docType === 'CONTRACT' || !/value is missing|dates are required/.test(m),
          ),
          ...gate,
          ...(lockNow.locked
            ? [`Negotiation has run past ${lockNow.limitDays} days: run the sanctions and financial risk checks again first`]
            : []),"""),
    ("""          .set({ status: 'AWAITING_SIGNATURE', updatedAt: now, version: c.version + 1 })
          .where(eq(contract.id, id));
        await d.audit.record(tx, a.ctx, {
          action: 'contract.release',""", """          .set({
            status: 'AWAITING_SIGNATURE',
            releasedAt: now,
            ...(extra.data.signingMode ? { signingMode: extra.data.signingMode } : {}),
            updatedAt: now,
            version: c.version + 1,
          })
          .where(eq(contract.id, id));
        await inviteSigners(
          tx,
          c,
          requiredSigners(await authorityValue(tx, c)).map((s) => s.role),
          `${c.number}`,
          now,
        );
        await d.audit.record(tx, a.ctx, {
          action: 'contract.release',"""),
    # sign: blocks
    ("""      const now = d.clock.now();
      const stamp = (verb: string) =>
        `${verb} · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

      if (body.decision === 'REJECT') {""", """      const now = d.clock.now();
      const stamp = (verb: string) =>
        `${verb} · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

      if (body.decision === 'APPROVE') {
        const blocked = await signBlock(
          tx,
          c,
          chain.map((s) => ({ role: s.role, signedBy: sigs.find((x2) => x2.role === s.role)?.userName ?? null })),
          slot.role,
          now,
        );
        if (blocked) return { blocked };
      }

      if (body.decision === 'REJECT') {"""),
    ("""    if ('denied' in out) {""", """    if ('blocked' in out)
      throw new AppError(409, out.blocked.code, out.blocked.message);
    if ('denied' in out) {"""),
    # progress notification on each signature
    ("""      const complete = chain.every((s) => s.role === slot.role || sigs.some((x) => x.role === s.role));""", """      await notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'LEGAL'],
        'Signing progress',
        `${c.number}: signed by ${a.user.name} (${sigs.length + 1} of ${chain.length})`,
        `/app/contracts/${id}`,
      );
      const complete = chain.every((s) => s.role === slot.role || sigs.some((x) => x.role === s.role));"""),
    ("""  registerContractExtras(app, p, d, reg, {""", """  const registry = d.registry ?? new MockVendorRegistry();
  registerContractB4(app, p, d, reg, {
    load,
    view,
    notifyRoles,
    signaturesOf,
    authorityValue,
    templateClauses,
    store: d.store,
    registry,
    sanctions: d.sanctions ?? new MockSanctionsScreening(),
  });
  registerContractExtras(app, p, d, reg, {"""),
])
print('ok')
