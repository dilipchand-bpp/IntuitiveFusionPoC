import re

p = 'apps/api/src/modules/contract/extras.ts'
s = open(p, encoding='utf8').read()


def rep(old, new, count=1):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, count)


# ---- imports
rep("""import { isProtected } from './b4-rules.js';
import { parseAlert } from './alert-text.js';""", """import { isProtected } from './b4-rules.js';
import { measureVariation } from './b5-rules.js';
import { createLinkedRequest, raiseDisclosureIfDue } from './b5-service.js';
import { parseAlert } from './alert-text.js';""")
rep("""  roleAssignment,
} from '../../db/schema.js';""", """  roleAssignment,
  appUser,
  request,
} from '../../db/schema.js';""")

# ---- body schemas
rep("""const variationBody = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    value: z.number().min(0).max(1e10),
    endDate: isoDate.optional(),
  })
  .strict();""", """const variationBody = z
  .object({
    /** The business case for the change, logged with the variation (FR-0535). */
    reason: z.string().trim().min(10).max(1000),
    value: z.number().min(0).max(1e10),
    endDate: isoDate.optional(),
    /** A procurement started for this variation (FR-0570). */
    requestId: z.string().uuid().optional(),
  })
  .strict();""")
rep("""const alertBody = z.object({ instruction: z.string().trim().min(5).max(500) }).strict();""", """const alertBody = z
  .object({
    instruction: z.string().trim().min(5).max(500),
    /** Where the alert is delivered, and who it is assigned to besides its author (FR-0515). */
    channels: z
      .array(z.enum(['IN_APP', 'EMAIL', 'SMS', 'SLACK']))
      .min(1)
      .max(4)
      .optional(),
    ownerId: uuid.optional(),
  })
  .strict();""")

# ---- the creator, placed before registerContractExtras
creator = '''
/** Creates a draft variation of an executed contract: its business case, measures, disclosure task and linked procurement. */
export function makeVariationCreator(d: ContractDeps, x: Pick<ContractCtx, 'variationsOf' | 'notifyRoles'>) {
  return async function createVariation(
    tx: Tx,
    a: AuthContext,
    parent: ContractRow,
    body: { reason: string; value: number; endDate?: string | undefined; requestId?: string | undefined },
  ): Promise<ContractRow> {
    const start = iso(d.clock.now());
    const kids = await x.variationsOf(tx, parent);
    const open = kids.find((v) => v.status !== 'EXECUTED');
    if (open) throw new AppError(409, 'VARIATION_OPEN', `Variation ${open.number} is still being prepared`);
    const n = kids.length;
    const settings = await loadSettings(tx, a.user.tenantId);
    const parentEnd = (await effectiveEnd(tx, parent)) ?? parent.endDate!;
    const end = body.endDate ?? parentEnd;
    if (end < start)
      throw new AppError(400, 'VALIDATION_FAILED', 'The end date cannot be in the past', [
        { field: 'endDate', message: 'Choose a date from today' },
      ]);
    if (body.value === 0 && end <= parentEnd)
      throw new AppError(422, 'EMPTY_VARIATION', 'A variation must change the value or extend the end date', [
        { field: 'value', message: 'Enter an amount or a later end date' },
      ]);
    let linkedRequestId = body.requestId ?? null;
    if (linkedRequestId) {
      const [r] = await tx
        .select({ id: request.id, kind: request.linkKind, contractId: request.linkedContractId })
        .from(request)
        .where(and(eq(request.id, linkedRequestId), eq(request.tenantId, a.user.tenantId)));
      if (!r || r.contractId !== parent.id)
        throw new AppError(422, 'PROCUREMENT_NOT_LINKED', 'That procurement is not linked to this contract', [
          { field: 'requestId', message: 'Choose a procurement started from this contract' },
        ]);
    }
    const measure = measureVariation(settings.contractManagement.variationModel, {
      original: Number(parent.value),
      earlier: kids.filter((v) => v.status === 'EXECUTED').reduce((s, v) => s + Number(v.value), 0),
      value: body.value,
    });
    const [row] = await tx
      .insert(contract)
      .values({
        tenantId: a.user.tenantId,
        number: `${parent.number}-V${n + 1}`,
        parentId: parent.id,
        supplierId: parent.supplierId,
        status: 'DRAFT',
        value: body.value.toFixed(2),
        startDate: start,
        endDate: end,
        noticeDays: parent.noticeDays,
        businessCase: body.reason,
        variancePct: String(measure.variancePct),
        varianceModel: measure.model,
        linkedRequestId,
        createdAt: d.clock.now(),
        updatedAt: d.clock.now(),
      })
      .returning();
    if (!linkedRequestId && settings.contractManagement.variationNumbering === 'NEW_PROCUREMENT') {
      const r = await createLinkedRequest(tx, d, a.ctx, parent, 'VARY', {
        title: `Variation: ${parent.number}`,
        value: body.value,
        termMonths: undefined,
      });
      linkedRequestId = r.id;
      await tx.update(contract).set({ linkedRequestId }).where(eq(contract.id, row!.id));
    }
    const text = [
      `This variation amends ${parent.number}.`,
      body.value > 0
        ? `The contract value increases by ${aud.format(body.value)} to a total of ${aud.format(measure.cumulativeValue)}.`
        : 'The contract value does not change.',
      end > parentEnd ? `The end date is extended to ${end}.` : '',
      `Variance: ${measure.variancePct}% (${measure.model === 'CUMULATIVE' ? 'cumulative: all variations against the original value' : 'incremental: this change against the contract as it stood'}).`,
      `Business case: ${body.reason}`,
    ]
      .filter(Boolean)
      .join(' ');
    await tx.insert(clause).values({
      tenantId: a.user.tenantId,
      contractId: row!.id,
      clauseId: 'VARIATION',
      title: 'Variation',
      text,
      mandatory: true,
      changedFromTemplate: false,
    });
    const task = await raiseDisclosureIfDue(tx, d.audit, a.ctx, row!, measure.variancePct, settings, d.clock.now());
    await d.audit.record(tx, a.ctx, {
      action: 'contract.variation_create',
      entityType: 'contract',
      entityId: row!.id,
      after: {
        parentId: parent.id,
        number: row!.number,
        value: body.value,
        endDate: end,
        businessCase: body.reason,
        variancePct: measure.variancePct,
        model: measure.model,
        cumulativeValue: measure.cumulativeValue,
        disclosureTask: task?.id ?? null,
        requestId: linkedRequestId,
      },
    });
    await x.notifyRoles(
      tx,
      a.user.tenantId,
      ['LEGAL'],
      'Variation ready for review',
      `${row!.number} varies ${parent.number}`,
      `/app/contracts/${row!.id}`,
    );
    return row!;
  };
}
'''
rep("export function registerContractExtras(", creator + "\nexport function registerContractExtras(")

# ---- the route
start = s.index("      const out = await withContext(d.database, a.ctx, async (tx) => {\n        const parent = await recordTarget(tx, a, id);")
end = s.index("      return reply.status(201).send(out);", start)
s = s[:start] + """      const out = await withContext(d.database, a.ctx, async (tx) => {
        const parent = await recordTarget(tx, a, id);
        const row = await createVariation(tx, a, parent, body);
        return x.view(tx, a, await x.load(tx, a, row.id));
      });
""" + s[end:]
rep("""  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const today = () => iso(d.clock.now());
""", """  const cid = (req: { params: unknown }) => parse(z.object({ id: uuid }), req.params).id;
  const today = () => iso(d.clock.now());
  const createVariation = makeVariationCreator(d, x);
""")

# ---- custom alert channels and owner
rep("""            note: body.instruction,
            createdBy: a.user.id,
          })
          .returning();""", """            note: body.instruction,
            createdBy: a.user.id,
            channels: body.channels ?? ['IN_APP', 'EMAIL'],
            ownerId: body.ownerId ?? null,
          })
          .returning();""")
rep("""        if (!parsed.ok)
          throw new AppError(422, 'ALERT_NOT_UNDERSTOOD', parsed.message, [
            { field: 'instruction', message: parsed.message },
          ]);""", """        if (!parsed.ok)
          throw new AppError(422, 'ALERT_NOT_UNDERSTOOD', parsed.message, [
            { field: 'instruction', message: parsed.message },
          ]);
        if (body.ownerId) {
          const [o] = await tx
            .select({ id: appUser.id })
            .from(appUser)
            .where(and(eq(appUser.id, body.ownerId), eq(appUser.tenantId, a.user.tenantId)));
          if (!o)
            throw new AppError(422, 'OWNER_NOT_FOUND', 'The person you assigned this alert to was not found', [
              { field: 'ownerId', message: 'Choose someone in the organisation' },
            ]);
        }""")
rep("""            instruction: body.instruction,
            triggerDate: parsed.value.triggerDate,
            recipientRule: parsed.value.recipientRule,
          },""", """            instruction: body.instruction,
            triggerDate: parsed.value.triggerDate,
            recipientRule: parsed.value.recipientRule,
            channels: body.channels ?? ['IN_APP', 'EMAIL'],
            ownerId: body.ownerId ?? null,
          },""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
