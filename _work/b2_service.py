root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender'


def edit(name, pairs):
    p = f'{root}\\{name}'
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (name, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)


edit('serialisers.ts', [
    ("  askedAt: q.askedAt.toISOString(),\n  ...(q.answer ? { answer: q.answer } : {}),\n});",
     "  askedAt: q.askedAt.toISOString(),\n  /** SINGLE: the answer goes only to the supplier who asked (FR-0195). The asker is never named. */\n  audience: q.audience,\n  ...(q.answer ? { answer: q.answer } : {}),\n});"),
])

edit('service.ts', [
    ("import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';", "import { and, asc, desc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';"),
    ("  invitation,\n  notification,", "  invitation,\n  latePermission,\n  notification,"),
    ("""  async questionRows(tx: Tx, tenderId: string, onlyPublished: boolean) {
    const rows = await tx
      .select()
      .from(question)
      .where(eq(question.tenderId, tenderId))
      .orderBy(asc(question.askedAt));
    return rows.filter((q) => !onlyPublished || q.status === 'PUBLISHED').map(questionView);
  }""",
     """  /**
   * Staff see every question. A supplier sees the answers published to everyone, and the answers given to them alone
   * (FR-0195); never another supplier's single answer.
   */
  async questionRows(tx: Tx, tenderId: string, onlyPublished: boolean, forSupplierId?: string | null) {
    const rows = await tx
      .select()
      .from(question)
      .where(eq(question.tenderId, tenderId))
      .orderBy(asc(question.askedAt));
    return rows
      .filter((q) => !onlyPublished || q.status === 'PUBLISHED')
      .filter((q) => !onlyPublished || q.audience === 'ALL' || (forSupplierId && q.targetSupplierId === forSupplierId))
      .map(questionView);
  }

  /**
   * May this supplier still bid? Yes while the tender is open, and after it closed only while a late-submission
   * permission granted to them (with a reason) is live, before evaluation has begun (FR-0205).
   */
  async canBid(tx: Tx, t: TenderRow, supplierId: string | null): Promise<boolean> {
    if (this.isOpen(t)) return true;
    if (!supplierId || this.status(t) !== 'CLOSED') return false;
    const [p] = await tx
      .select({ id: latePermission.id })
      .from(latePermission)
      .where(
        and(
          eq(latePermission.tenderId, t.id),
          eq(latePermission.supplierId, supplierId),
          isNull(latePermission.revokedAt),
          gt(latePermission.expiresAt, this.clock.now()),
        ),
      );
    return Boolean(p);
  }"""),
    ("      questions: await this.questionRows(tx, t.id, true),\n      addenda: await this.addenda(tx, t.id),\n      submission: {", "      questions: await this.questionRows(tx, t.id, true, sid),\n      addenda: await this.addenda(tx, t.id),\n      stage: t.stage,\n      submission: {"),
    ("      canBid: this.isOpen(t),\n    };\n  }\n\n  /** Tenders a supplier may see", "      canBid: await this.canBid(tx, t, sid ?? null),\n      lateAccess: !this.isOpen(t) && (await this.canBid(tx, t, sid ?? null)),\n    };\n  }\n\n  /** Tenders a supplier may see"),
])

# routes.ts (staff): supplier-side question list uses the supplier's id
edit('routes.ts', [
    ("? { ok: true as const, rows: await svc.questionRows(tx, l.tender.id, true) }", "? { ok: true as const, rows: await svc.questionRows(tx, l.tender.id, true, a.user.supplierId) }"),
])

# supplier-routes: canBid for upload, delete, submit, withdraw; reset a late-rejected draft when permitted
edit('supplier-routes.ts', [
    ("        if (!svc.isOpen(l.tender)) {\n          late = true;\n          return null;\n        }\n        if (!chk.ok) {", "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null))) {\n          late = true;\n          return null;\n        }\n        if (!chk.ok) {"),
    ("        if (!svc.isOpen(l.tender)) throw new AppError(409, 'BID_CLOSED', 'The tender is closed');", "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null)))\n          throw new AppError(409, 'BID_CLOSED', 'The tender is closed');"),
    ("        if (!svc.isOpen(l.tender)) {\n          late = true;\n          return null;\n        }\n        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);\n        if (sub.status === 'SUBMITTED')", "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null))) {\n          late = true;\n          return null;\n        }\n        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);\n        if (sub.status === 'SUBMITTED')"),
    ("        if (!svc.isOpen(l.tender))\n          throw new AppError(\n            409,\n            'BID_CLOSED',\n            'The tender is closed, so a bid can no longer be changed',", "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null)))\n          throw new AppError(\n            409,\n            'BID_CLOSED',\n            'The tender is closed, so a bid can no longer be changed',"),
    ("    if (!s)\n      [s] = await tx\n        .insert(submission)\n        .values({ tenantId, tenderId, supplierId, status: 'DRAFT', createdAt: d.clock.now() })\n        .returning();\n    return s!;",
     "    if (!s)\n      [s] = await tx\n        .insert(submission)\n        .values({ tenantId, tenderId, supplierId, status: 'DRAFT', createdAt: d.clock.now() })\n        .returning();\n    // a bid discarded as late is started afresh when the buyer has since permitted a late submission (FR-0205)\n    else if (s.status === 'REJECTED_LATE')\n      [s] = await tx.update(submission).set({ status: 'DRAFT' }).where(eq(submission.id, s.id)).returning();\n    return s!;"),
])
print('ok')
