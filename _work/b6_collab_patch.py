import re


def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:70])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


base = 'apps/api/src/modules/'

# ---------------------------------------------------------------- plan: field-level revision check and layout
rw(base + 'plan/routes.ts', [
    ("""const fieldBody = z
  .object({
    value: z.string().max(8000),
    paragraph: z.number().int().min(1).optional(),
    expectedVersion: z.number().int(),
  })
  .strict();""", """const fieldBody = z
  .object({
    value: z.string().max(8000),
    paragraph: z.number().int().min(1).optional(),
    /** The whole plan as you loaded it, or only this section's revision so others can edit other sections meanwhile (FR-0735). */
    expectedVersion: z.number().int().optional(),
    expectedRev: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((b) => b.expectedVersion !== undefined || b.expectedRev !== undefined, {
    message: 'Say which version or revision you edited from',
  });"""),
    ("""      if (body.expectedVersion !== l.plan.version)
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The plan changed while you were editing; reload and try again',
        );
      if (!PLAN_FIELD_BY_KEY.has(key))""", """      const cur = l.planFields.find((f) => f.key === key);
      if (body.expectedRev !== undefined) {
        if ((cur?.rev ?? 0) !== body.expectedRev) throw await fieldConflict(tx, key, cur);
      } else if (body.expectedVersion !== l.plan.version)
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The plan changed while you were editing; reload and try again',
        );
      if (!PLAN_FIELD_BY_KEY.has(key))"""),
])
s = open(base + 'plan/routes.ts', encoding='utf8', newline='').read()
s = s.replace("import { AppError, parse } from '../../http/errors.js';", "import { AppError, parse } from '../../http/errors.js';\nimport { fieldConflict } from '../collab/routes.js';", 1)
open(base + 'plan/routes.ts', 'w', encoding='utf8', newline='').write(s)

rw(base + 'plan/service.ts', [
    ("""    const fields = PLAN_FIELDS.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,""", """    const layout = await loadLayout(tx, auth.user.tenantId, 'PLAN');
    const designed = layout ? applyLayout([...PLAN_FIELDS], layout) : PLAN_FIELDS;
    const fields = designed.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        rev: row?.rev ?? 0,"""),
    ("import { PLAN_FIELDS, PLAN_FIELD_BY_KEY, splitParagraphs } from './fields.js';", "import { applyLayout, loadLayout } from '../collab/routes.js';\nimport { PLAN_FIELDS, PLAN_FIELD_BY_KEY, splitParagraphs } from './fields.js';"),
])

# ---------------------------------------------------------------- tender: revision check, layout, template change
rw(base + 'tender/service.ts', [
    ("""    return TENDER_FIELDS.map((def) => {
      const r = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,""", """    const [owner] = await tx.select({ t: tender.tenantId }).from(tender).where(eq(tender.id, tenderId));
    const layout = owner ? await loadLayout(tx, owner.t, 'RFX') : null;
    return (layout ? applyLayout([...TENDER_FIELDS], layout) : TENDER_FIELDS).map((def) => {
      const r = byKey.get(def.key);
      return {
        key: def.key,
        label: def.label,
        rev: r?.rev ?? 0,"""),
    ("import { TENDER_FIELDS } from './fields.js';", "import { applyLayout, loadLayout } from '../collab/routes.js';\nimport { TENDER_FIELDS } from './fields.js';"),
])

open('_work/_ok', 'w').write('ok')
print('ok')
