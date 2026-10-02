def sub(p, a, b):
    t = open(p, encoding='utf8', newline='').read()
    assert a in t, (p, a[:70])
    open(p, 'w', encoding='utf8', newline='').write(t.replace(a, b, 1))


R = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps'
svc = R + r'\api\src\modules\plan\service.ts'
sub(svc, "    const undo = await this.readUndo(tx, planId);\n    return {\n      id: l.plan.id,",
    """    const undo = await this.readUndo(tx, planId);
    // Approver names come from the user records, not from parsing the printed stamp.
    const approverIds = [...new Set(approvals.map((a) => a.userId))];
    const approverRows = approverIds.length
      ? await tx.select({ id: appUser.id, name: appUser.name }).from(appUser).where(inArray(appUser.id, approverIds))
      : [];
    const approverName = new Map(approverRows.map((r) => [r.id, r.name]));
    return {
      id: l.plan.id,""")
sub(svc, "        userId: a.userId,\n        role: a.role,\n        decision: a.decision,",
    "        userId: a.userId,\n        userName: approverName.get(a.userId) ?? '',\n        role: a.role,\n        decision: a.decision,")

seed = R + r'\api\src\db\seed.ts'
sub(seed, "            stamp: `APPROVED ${dateOnly(day(-40))}`,",
    """            stamp: `APPROVED · ${SEED_USERS.find((u) => u.key === (Number(r.value) > 250000 ? 'exec' : 'delegate'))!.name} · ${Number(r.value) > 250000 ? 'EXEC' : 'DELEGATE'} · ${dateOnly(day(-40))} 09:00 UTC`,""")

sub(R + r'\web\src\components\plan\types.ts', "  role: string;\n  decision: 'APPROVED'", "  userName?: string;\n  role: string;\n  decision: 'APPROVED'")
print('ok')
