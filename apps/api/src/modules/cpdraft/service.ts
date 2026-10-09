/**
 * Storage, context gathering and "apply" for Copilot drafts (CP-04, CP-05). Applying never writes to a record directly: it calls
 * the application's own routes through app.inject with the acting person's own session, so the role guards, states, probity
 * rules and audit trail of those routes apply unchanged. A draft can never do what its user cannot do.
 */
import { and, desc, eq, ilike, isNotNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthContext, GuardDeps } from '../../auth/guard.js';
import { withContext, type Tx } from '../../db/client.js';
import { catalogueItem, request, supplier, template, tenant } from '../../db/schema.js';
import { cpDraft, cpDraftApply, cpDraftRevision, type DraftKind } from '../../db/schema-cpb.js';
import { AppError } from '../../http/errors.js';
import { renderDocx } from '../../documents/docx.js';
import type { PdfBlock } from '../../documents/pdf.js';
import { ADJUST_EXAMPLES, ADJUST_PATTERNS } from './adjust.js';
import { median, type CatalogueHit, type HistoryInfo, type RecordInfo } from './generate.js';
import {
  ENGINE,
  aud,
  diffDocs,
  renderContent,
  type DiffEntry,
  type DraftDoc,
  type SourceRef,
} from './model.js';

export type DraftRow = typeof cpDraft.$inferSelect;
export type RevisionRow = typeof cpDraftRevision.$inferSelect;

// ------------------------------------------------------------------------------------------------ views
const NEEDS: Record<DraftKind, string[]> = {
  REQUEST: ['title', 'category', 'estimatedValue', 'termMonths', 'businessUnit', 'contractOwner'],
  PLAN: ['category', 'estimatedValue', 'termMonths'],
  JOB_SPEC: ['category', 'estimatedValue', 'termMonths', 'startDate'],
  TENDER_DOC: ['category', 'termMonths'],
  CONTRACT_DRAFT: ['estimatedValue', 'termMonths', 'startDate'],
  EVAL_CRITERIA: [],
};
export const missingOf = (kind: DraftKind, doc: DraftDoc) =>
  NEEDS[kind].filter((k) => !doc.fields[k] || doc.fields[k] === 'Untitled');

export const DEFAULT_TARGET: Record<DraftKind, 'REQUEST' | 'PLAN' | 'TENDER' | 'REPOSITORY'> = {
  REQUEST: 'REQUEST',
  PLAN: 'PLAN',
  JOB_SPEC: 'REPOSITORY',
  TENDER_DOC: 'TENDER',
  CONTRACT_DRAFT: 'REPOSITORY',
  EVAL_CRITERIA: 'TENDER',
};

export function viewOf(d: DraftRow, r: RevisionRow, extra: Record<string, unknown> = {}) {
  const doc = r.doc as DraftDoc;
  return {
    id: d.id,
    kind: d.kind,
    source: d.source,
    procurementId: d.procurementId,
    fields: doc.fields,
    title: doc.title,
    tone: doc.tone,
    doc,
    content: renderContent(doc),
    sources: r.sources as SourceRef[],
    engine: ENGINE,
    simulated: true,
    revision: r.revision,
    missing: missingOf(d.kind, doc),
    suggested: doc.suggested,
    warnings: doc.warnings,
    defaultTarget: DEFAULT_TARGET[d.kind],
    adjustExamples: ADJUST_EXAMPLES,
    adjustPatterns: ADJUST_PATTERNS,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    ...extra,
  };
}
export const revisionView = (r: RevisionRow) => ({
  revision: r.revision,
  parentRevision: r.parentRevision,
  action: r.action,
  instruction: r.instruction,
  summary: r.summary,
  diff: r.diff as DiffEntry[],
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy,
});

export async function loadDraft(tx: Tx, a: AuthContext, id: string) {
  const [d] = await tx
    .select()
    .from(cpDraft)
    .where(and(eq(cpDraft.id, id), eq(cpDraft.tenantId, a.user.tenantId), eq(cpDraft.userId, a.user.id)));
  if (!d) throw new AppError(404, 'NOT_FOUND', 'Draft not found');
  return d;
}
export async function loadRevision(tx: Tx, d: DraftRow, n?: number) {
  const [r] = await tx
    .select()
    .from(cpDraftRevision)
    .where(and(eq(cpDraftRevision.draftId, d.id), eq(cpDraftRevision.revision, n ?? d.currentRevision)));
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Revision not found');
  return r;
}

// ------------------------------------------------------------------------------------------------ gathering context
export async function gatherContext(tx: Tx, tenantId: string, text: string, record?: RecordInfo) {
  const [t] = await tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, tenantId));
  const sup = await tx
    .select({ c: supplier.company })
    .from(supplier)
    .where(eq(supplier.tenantId, tenantId))
    .limit(300);
  const templates = await tx
    .select({ id: template.id, body: template.body })
    .from(template)
    .where(
      and(eq(template.tenantId, tenantId), eq(template.type, 'CONTRACT'), eq(template.status, 'ACTIVE')),
    );
  return {
    organisation: t?.name ?? 'The organisation',
    knownSuppliers: sup.map((s) => s.c),
    templates,
    text,
    record,
  };
}

/** What this organisation has asked for before in the same category. */
export async function historyFor(
  tx: Tx,
  tenantId: string,
  category: string | undefined,
  excludeId?: string,
): Promise<HistoryInfo | undefined> {
  if (!category) return undefined;
  const rows = await tx
    .select({ v: request.estimatedValue, t: request.termMonths, u: request.businessUnit })
    .from(request)
    .where(
      and(
        eq(request.tenantId, tenantId),
        isNotNull(request.estimatedValue),
        sql`lower(${request.category}) = ${category.toLowerCase()}`,
        ...(excludeId ? [ne(request.id, excludeId)] : []),
      ),
    )
    .orderBy(desc(request.createdAt))
    .limit(50);
  if (!rows.length) return undefined;
  const values = rows.map((r) => Number(r.v)).filter((n) => n > 0);
  const terms = rows.map((r) => r.t).filter((n): n is number => !!n);
  const units = rows.map((r) => r.u).filter((x): x is string => !!x);
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u, (counts.get(u) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { count: rows.length, medianValue: median(values), medianTerm: median(terms), commonUnit: common };
}

/** Catalogue lines that match the category or a word of the subject (information only, never written into a draft). */
export async function catalogueFor(
  tx: Tx,
  tenantId: string,
  category: string | undefined,
  text: string,
): Promise<CatalogueHit[]> {
  const words = (text.toLowerCase().match(/[a-z]{5,}/g) ?? [])
    .filter((w) => !['service', 'services', 'about', 'years', 'starting', 'hosted', 'australia'].includes(w))
    .slice(0, 6);
  const plain = (category ?? '').replace(/\s*\(UNSPSC[^)]*\)/, '');
  const conds = [
    ...(plain ? [ilike(catalogueItem.category, `%${plain.replace(/[%_]/g, '')}%`)] : []),
    ...words.map((w) => ilike(catalogueItem.name, `%${w}%`)),
  ];
  if (!conds.length) return [];
  const rows = await tx
    .select({ i: catalogueItem, s: supplier.company })
    .from(catalogueItem)
    .leftJoin(supplier, eq(supplier.id, catalogueItem.supplierId))
    .where(
      and(
        eq(catalogueItem.tenantId, tenantId),
        eq(catalogueItem.active, true),
        sql`(${sql.join(conds, sql` or `)})`,
      ),
    )
    .limit(3);
  return rows.map(({ i, s }) => ({
    sku: i.sku,
    name: i.name,
    supplier: s ?? 'a supplier',
    unitPrice: Number(i.unitPrice),
    unit: i.unit,
  }));
}

// ------------------------------------------------------------------------------------------------ calling the real routes
export interface Caller {
  app: FastifyInstance;
  prefix: string;
  req: FastifyRequest;
}
export interface RouteResult {
  status: number;
  json: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
/** A call to the application's own route, as the person who is signed in. */
export async function callAs(
  c: Caller,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<RouteResult> {
  const res = await c.app.inject({
    method,
    url: `${c.prefix}${path}`,
    headers: {
      cookie: String(c.req.headers.cookie ?? ''),
      'x-csrf-token': String(c.req.headers['x-csrf-token'] ?? ''),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
  let json: Record<string, unknown> = {};
  try {
    json = res.json() as Record<string, unknown>;
  } catch {
    /* not json */
  }
  return { status: res.statusCode, json };
}
export class RouteRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly errors: Array<{ field: string; message: string }>,
  ) {
    super(title);
  }
}
/** Passes the route's own refusal on unchanged ("the usual error"). */
export function ok(r: RouteResult, okStatuses: number[] = [200, 201]): RouteResult {
  if (okStatuses.includes(r.status)) return r;
  throw new RouteRefusal(
    r.status,
    String(r.json.code ?? 'ERROR'),
    String(r.json.title ?? 'The request was refused'),
    (r.json.errors as Array<{ field: string; message: string }>) ?? [],
  );
}
export const toAppError = (e: RouteRefusal) => new AppError(e.status, e.code, e.message, e.errors);

export async function recordFromView(c: Caller, id: string): Promise<RecordInfo> {
  const r = ok(await callAs(c, 'GET', `/requests/${id}`));
  const v = r.json;
  const fields: Record<string, string> = {};
  for (const f of (v.fields as Array<{ key: string; value?: string }>) ?? [])
    if (f.value) fields[f.key] = f.value;
  return {
    id: String(v.id),
    number: String(v.number),
    title: String(v.title),
    category: v.category as string | undefined,
    estimatedValue: typeof v.estimatedValue === 'number' ? v.estimatedValue : undefined,
    termMonths: v.termMonths as number | undefined,
    businessUnit: v.businessUnit as string | undefined,
    status: String(v.status),
    fields,
  };
}

// ------------------------------------------------------------------------------------------------ apply
const joinItems = (doc: DraftDoc, key: string, bullets = false) => {
  const s = doc.sections.find((x) => x.key === key);
  if (!s) return '';
  return s.items.map((i, n) => (bullets ? `${n + 1}. ${i.text}` : i.text)).join('\n\n');
};
const list = (doc: DraftDoc, key: string) => {
  const s = doc.sections.find((x) => x.key === key);
  return s ? s.items.map((i, n) => `${n + 1}. ${i.text}`).join('\n') : '';
};

/** The request fields a REQUEST draft writes: only the ones the request has. */
export function requestPayload(doc: DraftDoc, only?: string[]) {
  const f = doc.fields;
  const fields: Record<string, string> = {};
  const want = (k: string) => !only || only.includes(k);
  for (const k of ['contractOwner', 'dataSensitivity', 'supplyLocation'])
    if (f[k] && f[k] !== 'NONE') fields[k] = f[k]!;
  const background = joinItems(doc, 'background');
  if (background && want('background')) fields.background = background.slice(0, 4000);
  const deliverables = [
    joinItems(doc, 'deliverables'),
    list(doc, 'requirements') && `Requirements:\n${list(doc, 'requirements')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  if (deliverables && (want('deliverables') || want('requirements')))
    fields.deliverables = deliverables.slice(0, 4000);
  const risk = joinItems(doc, 'risks');
  if (risk && want('risks')) fields.risk = risk.slice(0, 4000);
  return {
    ...(f.title && f.title !== 'Untitled' ? { title: f.title.slice(0, 200) } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.estimatedValue ? { estimatedValue: Number(f.estimatedValue) } : {}),
    ...(f.termMonths ? { termMonths: Number(f.termMonths) } : {}),
    ...(f.businessUnit ? { businessUnit: f.businessUnit } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  };
}

export const criteriaText = (doc: DraftDoc, key: string) => {
  const s = doc.sections.find((x) => x.key === key);
  if (!s) return '';
  const lines = s.items
    .filter((i) => (i.weight ?? 0) > 0 || !i.mandatory)
    .map((i) => ((i.weight ?? 0) > 0 ? `${i.title}: ${i.weight}%. ${i.text}` : `${i.title}. ${i.text}`));
  return [...lines, 'Responses are scored independently by each evaluator, then agreed by the panel.'].join(
    '\n\n',
  );
};

/** Plain section text for a plan or tender field: items as paragraphs, or numbered when they are a list. */
export function sectionText(doc: DraftDoc, key: string): string {
  const s = doc.sections.find((x) => x.key === key);
  if (!s) return '';
  if (s.type === 'CRITERIA') return criteriaText(doc, key);
  if (s.type === 'CLAUSES') return s.items.map((i) => `${i.title}: ${i.text}`).join('\n\n');
  return s.items.map((i) => i.text).join('\n\n');
}

export function docxFor(d: DraftRow, doc: DraftDoc, revision: number, now: Date): Buffer {
  const blocks: PdfBlock[] = [
    { type: 'title', text: doc.title },
    {
      type: 'subtitle',
      text: `Drafted by the Procurement Copilot (SIMULATED, ${ENGINE}), revision ${revision}. Review before use.`,
    },
  ];
  const kv: Array<[string, string | undefined]> = [
    ['Category', doc.fields.category],
    ...(doc.kind !== 'TENDER_DOC'
      ? ([
          ['Budget', doc.fields.estimatedValue ? aud(Number(doc.fields.estimatedValue)) : undefined],
        ] as Array<[string, string | undefined]>)
      : []),
    ['Term', doc.fields.termMonths ? `${doc.fields.termMonths} months` : undefined],
    ['Start', doc.fields.startDate],
    ['End', doc.fields.endDate],
  ];
  for (const [label, value] of kv) if (value) blocks.push({ type: 'kv', label, value });
  for (const s of doc.sections) {
    blocks.push({ type: 'h2', text: s.title });
    if (s.type === 'CRITERIA')
      blocks.push({
        type: 'table',
        columns: [
          { label: 'Criterion', width: 0.35 },
          { label: 'Weight', width: 0.12, align: 'right' },
          { label: 'What is scored', width: 0.53 },
        ],
        rows: s.items.map((i) => [i.title ?? '', `${i.weight ?? 0}%`, i.text]),
      });
    else
      for (const i of s.items)
        blocks.push(
          s.type === 'TEXT'
            ? { type: 'p', text: i.text }
            : { type: 'bullet', text: s.type === 'CLAUSES' ? `${i.title}: ${i.text}` : i.text },
        );
  }
  return renderDocx({
    title: doc.title,
    footer: `Copilot draft ${d.id.slice(0, 8)} revision ${revision}`,
    created: now,
    blocks,
  });
}

export async function recordApply(
  deps: GuardDeps,
  a: AuthContext,
  d: DraftRow,
  revision: number,
  target: 'REQUEST' | 'PLAN' | 'TENDER' | 'REPOSITORY',
  targetId: string | null,
  changes: unknown[],
  extra: Record<string, unknown> = {},
) {
  await withContext(deps.database, a.ctx, async (tx) => {
    await tx.insert(cpDraftApply).values({
      tenantId: a.user.tenantId,
      draftId: d.id,
      revision,
      target,
      targetId,
      changes,
      appliedBy: a.user.id,
      appliedAt: deps.clock.now(),
    });
    await deps.audit.record(tx, a.ctx, {
      action: 'copilot.draft_apply',
      entityType: target === 'TENDER' ? 'tender' : 'request',
      entityId: targetId,
      after: {
        draftId: d.id,
        kind: d.kind,
        revision,
        target,
        changedCount: changes.length,
        source: d.source,
        via: 'Procurement Copilot',
        engine: ENGINE,
        ...extra,
      },
    });
  });
}

export { diffDocs };
