import os
os.chdir(r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\evaluation')


def rd(p):
    return open(p, encoding='utf8').read()


def sub(t, a, b):
    assert a in t, a[:70]
    return t.replace(a, b, 1)


t = rd('service.ts')
t = sub(t, "    return {\n      id: l.ev.id,\n      tenderId: l.tender.id,", """    const probity = await this.probityOf(tx, l);
    return {
      id: l.ev.id,
      tenderId: l.tender.id,""")
t = sub(t, "      permissions: this.permissions(l, a, me, chair, proc, items, rep),\n    };\n  }", """      probity,
      permissions: {
        ...this.permissions(l, a, me, chair, proc, items, rep),
        canSetVarianceLimit: chair && (l.ev.status === 'COI_PENDING' || l.ev.status === 'SCORING'),
        canProbitySignOff:
          a.user.roles.includes('PROBITY') && atLeast(l.ev.status, 'LOCKED') && probity === null,
      },
    };
  }

  /** The probity advisor's sign-off that the process was followed (recorded, not a gate on the award). */
  async probityOf(tx: Tx, l: Loaded) {
    const [row] = await tx
      .select({ a: approval, name: appUser.name })
      .from(approval)
      .innerJoin(appUser, eq(appUser.id, approval.userId))
      .where(
        and(
          eq(approval.subjectType, 'EVAL_PROBITY'),
          eq(approval.subjectId, l.ev.id),
          eq(approval.decision, 'APPROVED'),
        ),
      );
    return row
      ? { by: row.name, stamp: row.a.stamp ?? '', at: row.a.decidedAt.toISOString(), comment: row.a.comment ?? null }
      : null;
  }""")
open('service.ts', 'w', encoding='utf8').write(t)

t = rd('report-pdf.ts')
t = sub(t, "  decision?: { stamp: string } | undefined;\n}", "  decision?: { stamp: string } | undefined;\n  probity?: { stamp: string } | null | undefined;\n}")
t = sub(t, "    ...(i.decision ? ([{ type: 'kv', label: 'Approval', value: i.decision.stamp }] as PdfBlock[]) : []),",
        "    ...(i.decision ? ([{ type: 'kv', label: 'Approval', value: i.decision.stamp }] as PdfBlock[]) : []),\n    ...(i.probity ? ([{ type: 'kv', label: 'Probity sign-off', value: i.probity.stamp }] as PdfBlock[]) : []),")
open('report-pdf.ts', 'w', encoding='utf8').write(t)

t = rd('routes.ts')
t = sub(t, "        decision: out.v.report!.decision ? { stamp: out.v.report!.decision.stamp } : undefined,\n      });",
        "        decision: out.v.report!.decision ? { stamp: out.v.report!.decision.stamp } : undefined,\n        probity: out.v.probity,\n      });")
t = sub(t, "const reopenBody = ", """const varianceBody = z.object({ limitPct: z.number().int().min(5).max(60) }).strict();
const signoffBody = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
const reopenBody = """)
t = sub(t, "  reg('POST', '/evaluations/{id}/consensus/open');", """  // ---------------------------------------------------------------- variance limit per evaluation (US-EVL-04)
  reg('PUT', '/evaluations/{id}/variance-limit');
  app.put(`${p}/evaluations/:id/variance-limit`, { preHandler: guard(d, ['CHAIR']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(varianceBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      chairOnly(l, a);
      if (l.ev.status !== 'COI_PENDING' && l.ev.status !== 'SCORING')
        throw new AppError(409, 'INVALID_STATE', 'The limit can only change before consensus opens');
      await tx
        .update(evaluation)
        .set({ varianceLimitPct: body.limitPct, updatedAt: d.clock.now(), version: l.ev.version + 1 })
        .where(eq(evaluation.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.variance_limit',
        entityType: 'evaluation',
        entityId: id,
        before: { limitPct: l.ev.varianceLimitPct },
        after: { limitPct: body.limitPct },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'PROBITY'],
        'Variance limit changed',
        `${l.req.number}: flagged at ${body.limitPct}% instead of ${l.ev.varianceLimitPct}%`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  // ---------------------------------------------------------------- probity sign-off (US-EVL-06/07)
  reg('POST', '/evaluations/{id}/probity-signoff');
  app.post(`${p}/evaluations/:id/probity-signoff`, { preHandler: guard(d, ['PROBITY']) }, async (req) => {
    const a = req.auth!;
    const id = eid(req);
    const body = parse(signoffBody, req.body);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a, id);
      if (!atLeast(l.ev.status, 'LOCKED'))
        throw new AppError(409, 'INVALID_STATE', 'The process can be signed off once consensus is locked');
      if (await svc.probityOf(tx, l)) throw new AppError(409, 'ALREADY_SIGNED_OFF', 'The process is already signed off');
      const now = d.clock.now();
      await tx.insert(approval).values({
        tenantId: a.user.tenantId,
        subjectType: 'EVAL_PROBITY',
        subjectId: id,
        userId: a.user.id,
        role: a.user.role,
        decision: 'APPROVED',
        comment: body.comment ?? null,
        stamp: `PROBITY SIGN-OFF · ${a.user.name} · ${a.user.role.replace('_', ' ')} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        decidedAt: now,
      });
      await d.audit.record(tx, a.ctx, {
        action: 'evaluation.probity_signoff',
        entityType: 'evaluation',
        entityId: id,
        after: { comment: body.comment },
      });
      await svc.notifyRoles(
        tx,
        a.user.tenantId,
        ['PROCUREMENT', 'DELEGATE'],
        'Probity sign-off recorded',
        `${l.req.number} ${l.req.title}`,
        `/app/evaluations/${id}`,
      );
      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);
    });
  });

  reg('POST', '/evaluations/{id}/consensus/open');""")
open('routes.ts', 'w', encoding='utf8').write(t)
print('ok')
