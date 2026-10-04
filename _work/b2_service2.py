p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\supplier-routes.ts'
s = open(p, encoding='utf8').read()


def sub(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


sub("        if (!svc.isOpen(l.tender)) {\n          late = true;\n          return null;\n        }\n        if (!chk.ok) {",
    "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null))) {\n          late = true;\n          return null;\n        }\n        if (!chk.ok) {")
sub("        if (!svc.isOpen(l.tender)) throw new AppError(409, 'BID_CLOSED', 'The tender is closed');",
    "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null)))\n          throw new AppError(409, 'BID_CLOSED', 'The tender is closed');")
sub("        if (!svc.isOpen(l.tender)) {\n          late = true;\n          return null;\n        }\n        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);\n        if (sub.status === 'SUBMITTED')",
    "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null))) {\n          late = true;\n          return null;\n        }\n        const sub = await ensureSubmission(tx, a.user.tenantId, id, a.user.supplierId!);\n        if (sub.status === 'SUBMITTED')")
sub("        if (!svc.isOpen(l.tender))\n          throw new AppError(409, 'BID_CLOSED', 'The tender is closed, so a bid can no longer be changed');",
    "        if (!(await svc.canBid(tx, l.tender, a.user.supplierId ?? null)))\n          throw new AppError(409, 'BID_CLOSED', 'The tender is closed, so a bid can no longer be changed');")
sub("    if (!s)\n      [s] = await tx\n        .insert(submission)\n        .values({ tenantId, tenderId, supplierId, status: 'DRAFT', createdAt: d.clock.now() })\n        .returning();\n    return s!;",
    "    if (!s)\n      [s] = await tx\n        .insert(submission)\n        .values({ tenantId, tenderId, supplierId, status: 'DRAFT', createdAt: d.clock.now() })\n        .returning();\n    // a bid discarded as late is started afresh when the buyer has since permitted a late submission (FR-0205)\n    else if (s.status === 'REJECTED_LATE')\n      [s] = await tx.update(submission).set({ status: 'DRAFT' }).where(eq(submission.id, s.id)).returning();\n    return s!;")
open(p, 'w', encoding='utf8').write(s)
print('ok')
