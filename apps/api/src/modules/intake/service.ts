import { and, eq, like, desc, inArray, sql } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { fieldValue, notification, request, roleAssignment, tenant, workflow } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import {
  WORKFLOW_NAMES,
  classifyCategory,
  requiredEngagements,
  routeWorkflow,
  selectSubWorkflow,
  stepStates,
  type Engagement,
  type ProcessStep,
  type ProcessStepView,
} from './classify.js';
import { gatesFor, intakeModeFor, scoreComplexity, type Complexity } from './complexity.js';
import {
  DEFAULTS,
  formatNumber,
  labelFor,
  loadSettings,
  numberStem,
  sequenceOf,
  type Settings,
} from '../settings/settings.js';
import { FIELDS, FIELD_BY_KEY, missingMandatory, type FieldMap } from './fields.js';

type RequestRow = typeof request.$inferSelect;
type FieldRow = typeof fieldValue.$inferSelect;
type Source = 'USER' | 'AI' | 'SYSTEM';

export interface FieldView {
  key: string;
  label: string;
  value?: string;
  source: Source | 'MIGRATED';
  aiDrafted: boolean;
  missing: boolean;
  /** An administrator-defined field (FR-0710) rather than a built-in one. */
  custom?: boolean;
  type?: 'TEXT' | 'FLAG' | 'NUMBER';
  updatedAt?: string;
  updatedBy?: string;
}
export interface GateView {
  key: string;
  label: string;
  reason: string;
  status: 'REQUIRED' | 'SATISFIED';
}
export interface RequestView {
  id: string;
  number: string;
  title: string;
  category?: string;
  /** Always in the base currency (AUD), so every total and every approval limit uses one currency. */
  estimatedValue: number;
  currency: string;
  /** When the amount was typed in a foreign currency: that amount and the rate used to convert it (FR-0810). */
  originalAmount?: number;
  fxRate?: number;
  termMonths?: number;
  businessUnit?: string;
  requesterId: string;
  phase: RequestRow['phase'];
  status: RequestRow['status'];
  intakeMode: RequestRow['intakeMode'];
  complexity?: Complexity;
  complexityReasons: string[];
  budgetCheck: RequestRow['budgetCheck'];
  /** The system a migrated record came from; absent for records created here (FR-0670). */
  sourceSystem?: string;
  /** Preliminary classification in the tenant's scheme, confirmed or amended by a person (FR-0015). */
  taxonomy?: { scheme: string; code: string; confirmed: boolean };
  /** The workflow this request follows and where it stands (FR-0705). */
  workflow?: { id: string; name: string; subWorkflow: string; steps: ProcessStepView[] };
  /** Secondary reviews the request needs, with the reason for each (FR-0030). */
  engagements: Engagement[];
  fields: FieldView[];
  gates: GateView[];
  missingFields: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const CORE_VALUE = (r: RequestRow): FieldMap => ({
  title: r.title,
  category: r.category ?? undefined,
  estimatedValue: r.estimatedValue ?? undefined,
  termMonths: r.termMonths?.toString(),
  businessUnit: r.businessUnit ?? undefined,
});

/** Merged value map: the request's own columns, overlaid with stored field values. */
export function valuesOf(r: RequestRow, rows: FieldRow[]): FieldMap {
  const out: FieldMap = { ...CORE_VALUE(r) };
  for (const f of rows) if (!f.key.startsWith('gate.') && f.value !== null) out[f.key] = f.value;
  return out;
}

export function toView(r: RequestRow, rows: FieldRow[], settings: Settings = DEFAULTS): RequestView {
  const values = valuesOf(r, rows);
  const byKey = new Map(rows.map((f) => [f.key, f]));
  const value = Number(values.estimatedValue ?? 0);
  const score = scoreComplexity({
    estimatedValue: value,
    category: values.category,
    supplyLocation: values.supplyLocation,
    dataSensitivity: values.dataSensitivity,
  });
  const gates = gatesFor(score.level, values.category, value, r.budgetCheck).map<GateView>((g) => ({
    ...g,
    status: byKey.get(`gate.${g.key}`)?.value === 'SATISFIED' ? 'SATISFIED' : 'REQUIRED',
  }));
  const missing = [
    ...missingMandatory(values),
    ...settings.customFields.filter((c) => c.mandatory && !values[c.key]?.trim()).map((c) => c.key),
  ];
  const fields: FieldView[] = FIELDS.map((def) => {
    const row = byKey.get(def.key);
    const v = values[def.key];
    return {
      key: def.key,
      label: labelFor(settings, def.key, def.label),
      ...(v !== undefined && v !== '' ? { value: v } : {}),
      source: (row?.source as FieldView['source']) ?? 'USER',
      aiDrafted: row?.aiDrafted ?? false,
      missing: def.mandatory && missing.includes(def.key),
      ...(row
        ? { updatedAt: row.updatedAt.toISOString(), ...(row.updatedBy ? { updatedBy: row.updatedBy } : {}) }
        : {}),
    };
  });
  for (const c of settings.customFields) {
    const row = byKey.get(c.key);
    const v = values[c.key];
    fields.push({
      key: c.key,
      label: c.label,
      ...(v !== undefined && v !== '' ? { value: v } : {}),
      source: (row?.source as FieldView['source']) ?? 'USER',
      aiDrafted: false,
      missing: c.mandatory && missing.includes(c.key),
      custom: true,
      type: c.type,
      ...(row ? { updatedAt: row.updatedAt.toISOString() } : {}),
    });
  }
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    ...(r.category ? { category: r.category } : {}),
    estimatedValue: value,
    currency: r.currency,
    ...(r.originalAmount !== null ? { originalAmount: Number(r.originalAmount) } : {}),
    ...(r.fxRate !== null ? { fxRate: Number(r.fxRate) } : {}),
    ...(r.termMonths !== null ? { termMonths: r.termMonths } : {}),
    ...(r.businessUnit ? { businessUnit: r.businessUnit } : {}),
    requesterId: r.requesterId,
    phase: r.phase,
    status: r.status,
    intakeMode: r.intakeMode,
    complexity: score.level,
    complexityReasons: score.reasons,
    budgetCheck: r.budgetCheck,
    ...(r.sourceSystem ? { sourceSystem: r.sourceSystem } : {}),
    ...(r.taxonomyCode
      ? { taxonomy: { scheme: r.taxonomyScheme ?? '', code: r.taxonomyCode, confirmed: r.taxonomyConfirmed } }
      : {}),
    ...(r.workflowId
      ? {
          workflow: {
            id: r.workflowId,
            name: WORKFLOW_NAMES[r.workflowId] ?? r.workflowId,
            subWorkflow: r.subWorkflow ?? 'general',
            steps: stepStates(r.processSteps as ProcessStep[], r.phase, r.status === 'COMPLETE'),
          },
        }
      : {}),
    engagements: (r.engagements as Engagement[]) ?? [],
    fields,
    gates,
    missingFields: missing,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function loadRequest(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{ row: RequestRow; fields: FieldRow[] } | null> {
  const [row] = await tx
    .select()
    .from(request)
    .where(and(eq(request.id, id), eq(request.tenantId, tenantId)));
  if (!row) return null;
  const fields = await tx
    .select()
    .from(fieldValue)
    .where(and(eq(fieldValue.ownerType, 'REQUEST'), eq(fieldValue.ownerId, id)));
  return { row, fields };
}

export class IntakeService {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /**
   * Next procurement number in the tenant's configured format (FR-0695), sequential per tenant and period. The tenant
   * row lock (taken by the audit service too) serialises numbering. Default format: PR-YYYY-NNNN.
   */
  private async nextNumber(tx: Tx, tenantId: string): Promise<string> {
    await tx.execute(sql`select 1 from ${tenant} where ${tenant.id} = ${tenantId} for update`);
    const cfg = (await loadSettings(tx, tenantId)).numbering;
    const now = this.clock.now();
    const stem = numberStem(cfg, now);
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
    const exact = new RegExp(`^${escaped}\\d+$`);
    const rows = await tx
      .select({ number: request.number })
      .from(request)
      .where(and(eq(request.tenantId, tenantId), like(request.number, `${stem}%`)))
      .orderBy(desc(request.number))
      .limit(200);
    const last = Math.max(0, ...rows.filter((r) => exact.test(r.number)).map((r) => sequenceOf(r.number)));
    return formatNumber(cfg, now, last + 1);
  }

  async createDraft(tx: Tx, ctx: RequestContext): Promise<RequestRow> {
    const number = await this.nextNumber(tx, ctx.tenantId);
    const now = this.clock.now();
    const [row] = await tx
      .insert(request)
      .values({
        tenantId: ctx.tenantId,
        number,
        title: 'Untitled request',
        requesterId: ctx.userId!,
        phase: 'INTAKE',
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.audit.record(tx, ctx, {
      action: 'request.create',
      entityType: 'request',
      entityId: row!.id,
      after: { number, status: 'DRAFT' },
    });
    return row!;
  }

  /**
   * Applies field changes (from a person or from the AI), mirrors the core ones into columns, recomputes complexity and
   * intake mode, and writes one field-level audit event. AI changes are stored as "AI-drafted" (NFR-AV05).
   */
  async applyChanges(
    tx: Tx,
    ctx: RequestContext,
    requestId: string,
    changes: Array<{ key: string; value: string }>,
    source: Source,
    tenantConfig: { selfServiceThresholdAud?: number },
    auditAction = 'request.update',
  ): Promise<RequestView> {
    const loaded = await loadRequest(tx, ctx.tenantId, requestId);
    if (!loaded) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    const settings = await loadSettings(tx, ctx.tenantId);
    const customByKey = new Map(settings.customFields.map((c) => [c.key, c]));
    const { row, fields } = loaded;
    if (row.status !== 'DRAFT')
      throw new AppError(409, 'REQUEST_NOT_EDITABLE', 'A submitted request can no longer be edited here');

    const before = valuesOf(row, fields);
    const now = this.clock.now();
    const cols: Partial<typeof request.$inferInsert> = { updatedAt: now, version: row.version + 1 };
    for (const c of changes) {
      const custom = customByKey.get(c.key);
      const def =
        FIELD_BY_KEY.get(c.key) ??
        (custom ? { key: c.key, label: custom.label, column: undefined } : undefined);
      if (!def)
        throw new AppError(400, 'VALIDATION_FAILED', 'Unknown field', [
          { field: c.key, message: 'Not a request field' },
        ]);
      const value = c.value.trim();
      if (custom?.type === 'NUMBER' && value !== '' && !Number.isFinite(Number(value)))
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid value', [
          { field: c.key, message: `${custom.label} must be a number` },
        ]);
      if (custom?.type === 'FLAG' && !['true', 'false'].includes(value))
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid value', [
          { field: c.key, message: `${custom.label} must be yes or no` },
        ]);
      if (value.length > 4000)
        throw new AppError(400, 'VALIDATION_FAILED', 'Value too long', [
          { field: c.key, message: 'Maximum 4000 characters' },
        ]);
      if (c.key === 'estimatedValue' && !(Number(value) >= 0))
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid value', [
          { field: c.key, message: 'Enter an amount of zero or more' },
        ]);
      if (
        c.key === 'termMonths' &&
        !(Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 360)
      )
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid term', [
          { field: c.key, message: 'Enter a whole number of months, 1 to 360' },
        ]);
      const existing = fields.find((f) => f.key === c.key);
      const set = {
        value,
        source,
        aiDrafted: source === 'AI',
        missing: false,
        previousValue: existing?.value ?? before[c.key] ?? null,
        updatedBy: source === 'AI' ? null : ctx.userId,
        updatedAt: now,
      };
      await tx
        .insert(fieldValue)
        .values({
          tenantId: ctx.tenantId,
          ownerType: 'REQUEST',
          ownerId: requestId,
          key: c.key,
          label: def.label,
          ...set,
        })
        .onConflictDoUpdate({ target: [fieldValue.ownerType, fieldValue.ownerId, fieldValue.key], set });
      if (def.column === 'title') cols.title = value;
      if (def.column === 'category') cols.category = value;
      if (def.column === 'estimatedValue') cols.estimatedValue = Number(value).toFixed(2);
      if (def.column === 'termMonths') cols.termMonths = Number(value);
      if (def.column === 'businessUnit') cols.businessUnit = value;
    }
    const merged = { ...before, ...Object.fromEntries(changes.map((c) => [c.key, c.value.trim()])) };
    const value = Number(merged.estimatedValue ?? 0);
    cols.complexity = scoreComplexity({
      estimatedValue: value,
      category: merged.category,
      supplyLocation: merged.supplyLocation,
      dataSensitivity: merged.dataSensitivity,
    }).level;
    cols.intakeMode = intakeModeFor(value, settings.intake.selfServiceThresholdAud);
    // classification, workflow routing and required engagements follow whatever the request now says (FR-0015, FR-0705, FR-0030)
    const taxonomy = classifyCategory(merged.category, settings.intake.taxonomy);
    if (taxonomy && !row.taxonomyConfirmed) {
      cols.taxonomyScheme = taxonomy.scheme;
      cols.taxonomyCode = taxonomy.code;
    }
    const sub = selectSubWorkflow(merged.category, merged.title);
    cols.subWorkflow = sub.key;
    const varied = (row.processVariations as unknown[]).length > 0;
    if (!varied) {
      const routed = routeWorkflow(settings.workflowRouting, value, cols.complexity);
      cols.workflowId = routed.workflowId;
      const [wf] = await tx.select().from(workflow).where(eq(workflow.id, routed.workflowId));
      cols.processSteps = ((wf?.steps ?? []) as ProcessStep[]).map((x) => ({
        key: x.key,
        label: x.label,
        mandatory: x.mandatory,
      }));
    }
    cols.engagements = requiredEngagements(settings.intake.engagementRules, {
      title: merged.title,
      category: merged.category,
      background: merged.background,
      dataSensitivity: merged.dataSensitivity,
      estimatedValue: value,
      complexity: cols.complexity,
    });
    await tx.update(request).set(cols).where(eq(request.id, requestId));

    await this.audit.record(tx, ctx, {
      action: auditAction,
      entityType: 'request',
      entityId: requestId,
      before: Object.fromEntries(changes.map((c) => [c.key, before[c.key] ?? null])),
      after: { ...Object.fromEntries(changes.map((c) => [c.key, c.value.trim()])), _source: source },
    });
    const reloaded = (await loadRequest(tx, ctx.tenantId, requestId))!;
    return toView(reloaded.row, reloaded.fields, settings);
  }

  /** Tell every procurement-team member a request is waiting for them. */
  async notifyProcurement(
    tx: Tx,
    ctx: RequestContext,
    requestNumber: string,
    title: string,
  ): Promise<number> {
    const team = await tx
      .select({ userId: roleAssignment.userId })
      .from(roleAssignment)
      .where(and(eq(roleAssignment.tenantId, ctx.tenantId), inArray(roleAssignment.role, ['PROCUREMENT'])));
    for (const t of team) {
      await tx.insert(notification).values({
        tenantId: ctx.tenantId,
        userId: t.userId,
        title: `New request ${requestNumber}`,
        body: title,
        link: '/app/requests',
      });
    }
    return team.length;
  }
}
