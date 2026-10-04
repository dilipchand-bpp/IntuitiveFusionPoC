p = 'apps/api/src/modules/tender/routes.ts'
s = open(p, encoding='utf8', newline='').read()


def rep(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)


rep("const fieldBody = z.object({ value: z.string().max(10_000), expectedVersion: z.number().int() }).strict();",
    """const fieldBody = z
  .object({
    value: z.string().max(10_000),
    /** The whole pack as you loaded it, or only this section's revision so others can edit other sections meanwhile (FR-0735). */
    expectedVersion: z.number().int().optional(),
    expectedRev: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((b) => b.expectedVersion !== undefined || b.expectedRev !== undefined, {
    message: 'Say which version or revision you edited from',
  });
const templateChangeBody = z.object({ instruction: z.string().trim().min(3).max(300) }).strict();""")
rep("import { AppError, parse } from '../../http/errors.js';", "import { AppError, parse } from '../../http/errors.js';\nimport { fieldConflict } from '../collab/routes.js';\nimport { parseTemplateChange, B6_MODEL } from '../reporting/b6-rules.js';")

# revision check in the field PUT
rep("""      if (body.expectedVersion !== l.tender.version)
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The tender changed while you were editing; reload and try again',
        );
      if (!TENDER_FIELD_BY_KEY.has(key))
        throw new AppError(400, 'VALIDATION_FAILED', 'Unknown tender section', [
          { field: key, message: 'Not a tender section' },
        ]);
      const [row] = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, id), eq(fieldValue.key, key)));""",
    """      if (!TENDER_FIELD_BY_KEY.has(key))
        throw new AppError(400, 'VALIDATION_FAILED', 'Unknown tender section', [
          { field: key, message: 'Not a tender section' },
        ]);
      const [row] = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, id), eq(fieldValue.key, key)));
      if (body.expectedRev !== undefined) {
        if ((row?.rev ?? 0) !== body.expectedRev) throw await fieldConflict(tx, key, row);
      } else if (body.expectedVersion !== l.tender.version)
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The tender changed while you were editing; reload and try again',
        );""")

# template change route, placed before the publish-permission route
route = """  // ---------------------------------------------------------------- change the template in plain language (FR-0750)
  reg('POST', '/tenders/{id}/template-change');
  app.post(`${p}/tenders/:id/template-change`, { preHandler: guard(d, ['PROCUREMENT']) }, async (req) => {
    const a = req.auth!;
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(templateChangeBody, req.body);
    const parsed = parseTemplateChange(body.instruction);
    if ('error' in parsed)
      throw new AppError(422, 'INSTRUCTION_NOT_UNDERSTOOD', parsed.error, [
        { field: 'instruction', message: parsed.error },
      ]);
    return withContext(d.database, a.ctx, async (tx) => {
      const l = await visible(tx, a.user.tenantId, id);
      if (svc.status(l.tender) !== 'STAGED')
        throw new AppError(423, 'TENDER_LOCKED', 'A published tender cannot change template. Issue an addendum instead.');
      if (l.tender.type === parsed.type)
        return { id, from: l.tender.type, to: parsed.type, changed: false, message: `It already uses the ${parsed.type} template.` };
      const [r] = await tx.select().from(request).where(eq(request.id, l.tender.requestId));
      const [pl] = await tx.select().from(plan).where(eq(plan.requestId, l.tender.requestId));
      const [org] = await tx.select().from(tenant).where(eq(tenant.id, a.user.tenantId));
      const reqFields = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'REQUEST'), eq(fieldValue.ownerId, r!.id)));
      const planFields = pl
        ? await tx
            .select()
            .from(fieldValue)
            .where(and(eq(fieldValue.ownerType, 'PLAN'), eq(fieldValue.ownerId, pl.id)))
        : [];
      const cfg = (org?.config ?? {}) as { statutoryMinDays?: number };
      const values = valuesOf(r!, reqFields);
      const pack = buildTenderPack({
        type: parsed.type,
        title: r!.title,
        organisation: org?.name ?? 'The organisation',
        category: values.category,
        termMonths: values.termMonths,
        businessUnit: values.businessUnit,
        plan: Object.fromEntries(planFields.map((f) => [f.key, f.value ?? undefined])),
        request: values,
        contactEmail: d.contactEmail,
        categoryRequirements:
          SUB_WORKFLOWS.find((x) => x.key === r!.subWorkflow)
            ?.planSections.map((x) => `${x.title}. ${x.text}`)
            .join(String.fromCharCode(10, 10)) || undefined,
        esg: esgText(esgFrom(planFields)) || undefined,
        ...(org?.sector === 'PUBLIC' && cfg.statutoryMinDays ? { statutoryMinDays: cfg.statutoryMinDays } : {}),
      });
      const now = d.clock.now();
      // sections a person has edited by hand are kept; the rest are filled in again for the new template
      const mine = await tx
        .select()
        .from(fieldValue)
        .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, id)));
      const repopulated: string[] = [];
      const kept: string[] = [];
      for (const def of TENDER_FIELDS) {
        const cur = mine.find((f) => f.key === def.key);
        if (cur && cur.source === 'USER') {
          kept.push(def.label);
          continue;
        }
        await tx
          .update(fieldValue)
          .set({ value: pack[def.key] ?? '', source: 'SYSTEM', updatedBy: a.user.id, updatedAt: now })
          .where(and(eq(fieldValue.ownerType, 'TENDER'), eq(fieldValue.ownerId, id), eq(fieldValue.key, def.key)));
        repopulated.push(def.label);
      }
      await tx.update(tender).set({ type: parsed.type, updatedAt: now, version: l.tender.version + 1 }).where(eq(tender.id, id));
      await d.audit.record(tx, a.ctx, {
        action: 'tender.template_change',
        entityType: 'tender',
        entityId: id,
        before: { type: l.tender.type },
        after: { type: parsed.type, instruction: body.instruction, repopulated, kept, model: B6_MODEL },
      });
      return {
        id,
        from: l.tender.type,
        to: parsed.type,
        changed: true,
        repopulated,
        kept,
        message: `Changed to the ${parsed.type} template; ${repopulated.length} section(s) were filled in again and ${kept.length} you had written yourself were kept.`,
      };
    });
  });

"""
rep("  // ---------------------------------------------------------------- permission to publish (US-TND-02 AC2)", route + "  // ---------------------------------------------------------------- permission to publish (US-TND-02 AC2)")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
