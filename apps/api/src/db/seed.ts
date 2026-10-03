/**
 * Synthetic demo data for "Meridian Group (demo)". No real organisation, person or ABN is represented.
 * Deterministic ids (uuid derived from a name) so tests, e2e and docs can refer to fixed records.
 * Idempotent: running it twice leaves one tenant and the same counts.
 */
import { createHash } from 'node:crypto';
import { hash as argon2 } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import { AuditService } from '../audit/audit-service.js';
import { SERVICES_TEMPLATE, WORKS_TEMPLATE } from '../modules/contract/clauses.js';
import { createContractRecord } from '../modules/contract/record.js';
import { demoPricingSchedule, demoTechnicalResponse } from './demo-documents.js';
import { TENDER_FIELDS } from '../modules/tender/fields.js';
import { sha256, type SealedStore } from '../modules/tender/files.js';
import { buildTenderPack } from '../modules/tender/pack.js';
import { withSystem, type Database, type RequestContext, type Tx } from './client.js';
import * as s from './schema.js';
import type { Role } from './schema.js';

export const uid = (name: string): string => {
  const h = createHash('sha256').update(`if-seed:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Demo-only credential for the synthetic users; override with SEED_PASSWORD. Never use outside local/demo. */
export const DEFAULT_SEED_PASSWORD = 'Demo-Only-Passw0rd!2026';

export const TENANT_ID = uid('tenant:meridian');

/** Plain-language requirements the demo tender packs are built from (the seeded requests have no plan of their own). */
const DEMO_PLAN_TEXT: Record<string, Record<string, string>> = {
  cleaning: {
    objectives:
      'Secure building cleaning that meets the requirements below at best value for money over the full term.',
    requirements:
      'Cleaning of all nominated sites to the agreed schedule and standard, including washrooms, kitchens and common areas.\n\nCompliance with work health and safety obligations, including induction, equipment and chemical safety.\n\nUse of environmentally responsible products and waste practices.',
    deliverables:
      'Delivery of building cleaning to agreed service levels, with monthly performance reporting.\n\nTransition-in plan and a named account manager.',
  },
  itmsp: {
    objectives:
      'Engage a managed IT service provider to run the service desk, end-user devices and infrastructure monitoring.',
    requirements:
      'A 24x7 monitored service with a 15-minute response target for critical incidents.\n\nSecurity controls aligned to the ACSC Essential Eight, with evidence on request.\n\nData held and supported in Australia.',
    deliverables:
      'Service desk and incident management with a monthly service report.\n\nQuarterly service review and a continuous-improvement plan.\n\nTransition-in from the current provider over 90 days.',
  },
};

export const SEED_USERS: Array<{ key: string; name: string; role: Role; unit: string }> = [
  { key: 'requester', name: 'Riley Chen', role: 'REQUESTER', unit: 'Facilities' },
  { key: 'procurement', name: 'Priya Nair', role: 'PROCUREMENT', unit: 'Procurement' },
  { key: 'delegate', name: 'Dana Okafor', role: 'DELEGATE', unit: 'Executive' },
  { key: 'evaluator-tech', name: 'Tomas Silva', role: 'EVALUATOR', unit: 'IT' },
  { key: 'evaluator-comm', name: 'Mei Tanaka', role: 'EVALUATOR', unit: 'Finance' },
  { key: 'chair', name: 'Grace Mwangi', role: 'CHAIR', unit: 'Procurement' },
  { key: 'legal', name: 'Henry Albright', role: 'LEGAL', unit: 'Legal' },
  { key: 'contract-mgr', name: 'Sofia Rossi', role: 'CONTRACT_MGR', unit: 'Facilities' },
  { key: 'probity', name: 'Jonas Becker', role: 'PROBITY', unit: 'Risk' },
  { key: 'finance', name: 'Aisha Rahman', role: 'FINANCE', unit: 'Finance' },
  { key: 'admin', name: 'Noah Kim', role: 'ADMIN', unit: 'IT' },
  { key: 'exec', name: 'Elena Petrova', role: 'EXEC', unit: 'Executive' },
  { key: 'supplier', name: 'Sam Brightwave', role: 'SUPPLIER', unit: 'Supplier' },
];
export const emailFor = (key: string) => `${key}@meridian-demo.example`;

const SUPPLIERS = [
  {
    key: 'brightwave',
    company: 'Brightwave Cleaning Pty Ltd',
    abn: '51824753556',
    sanctions: 'CLEAR',
    insurance: 'CURRENT',
  },
  {
    key: 'evergreen',
    company: 'Evergreen Facility Services Pty Ltd',
    abn: '33102034591',
    sanctions: 'CLEAR',
    insurance: 'EXPIRING',
  },
  {
    key: 'northstar',
    company: 'Northstar Property Care Pty Ltd',
    abn: '12005357522',
    sanctions: 'CLEAR',
    insurance: 'CURRENT',
  },
  {
    key: 'summit',
    company: 'Summit Managed Services Pty Ltd',
    abn: '98765432109',
    sanctions: 'PENDING',
    insurance: 'UNKNOWN',
  },
] as const;

export interface SeedResult {
  seeded: boolean;
  counts: Record<string, number>;
}

export async function seedDatabase(
  database: Database,
  /** With a store the seeded bid files are really written (sealed) so they can be downloaded; without one only rows exist. */
  opts: { clock: Clock; password?: string; store?: SealedStore },
): Promise<SeedResult> {
  const { db } = database;
  const existing = await db
    .select({ id: s.tenant.id })
    .from(s.tenant)
    .where(eq(s.tenant.slug, 'meridian-demo'));
  if (existing.length > 0) return { seeded: false, counts: await counts(database) };

  const audit = new AuditService(opts.clock);
  const password = opts.password || process.env.SEED_PASSWORD?.trim() || DEFAULT_SEED_PASSWORD; // empty env value = unset
  if (password.length < 8)
    throw new Error('SEED_PASSWORD must be at least 8 characters (login requires 8+).');
  const passwordHash = await argon2(password);
  const now = opts.clock.now();
  const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
  const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
  const system: RequestContext = { tenantId: TENANT_ID, userId: null, role: 'SYSTEM', correlationId: 'seed' };

  await withSystem(database, async (tx: Tx) => {
    const log = (
      action: string,
      entityType: string,
      entityId: string,
      after: Record<string, unknown>,
      actor?: { id: string; role: Role },
    ) =>
      audit.record(tx, actor ? { ...system, userId: actor.id, role: actor.role } : system, {
        action,
        entityType,
        entityId,
        after,
      });

    await tx.insert(s.tenant).values({
      id: TENANT_ID,
      slug: 'meridian-demo',
      name: 'Meridian Group (demo)',
      sector: 'PUBLIC',
      config: {
        varianceLimitPct: 30,
        selfServiceThresholdAud: 50000,
        statutoryMinDays: 25,
        highValueAud: 1_000_000,
        // Mock ERP: available budget per business unit; an over-budget request is blocked (HARD) or escalated (SOFT).
        budgetCap: 'HARD',
        budgets: {
          Facilities: 2_000_000,
          IT: 6_000_000,
          Procurement: 500_000,
          Finance: 300_000,
          Legal: 400_000,
          Risk: 250_000,
          Executive: 1_000_000,
          Operations: 3_000_000,
        },
      },
    });
    await log('tenant.create', 'tenant', TENANT_ID, { name: 'Meridian Group (demo)', synthetic: true });

    const units = ['Facilities', 'IT', 'Procurement', 'Finance', 'Legal', 'Risk', 'Executive', 'Supplier'];
    for (const u of units)
      await tx.insert(s.orgUnit).values({ id: uid(`unit:${u}`), tenantId: TENANT_ID, name: u });

    // suppliers first (a supplier user references one)
    for (const sp of SUPPLIERS) {
      await tx.insert(s.supplier).values({
        id: uid(`supplier:${sp.key}`),
        tenantId: TENANT_ID,
        company: sp.company,
        abn: sp.abn,
        sanctionsStatus: sp.sanctions,
        insuranceStatus: sp.insurance,
        lastCheckedAt: day(-3),
      });
      await log('supplier.register', 'supplier', uid(`supplier:${sp.key}`), { company: sp.company });
    }

    const userId = (key: string) => uid(`user:${key}`);
    for (const u of SEED_USERS) {
      await tx.insert(s.appUser).values({
        id: userId(u.key),
        tenantId: TENANT_ID,
        email: emailFor(u.key),
        name: u.name,
        orgUnitId: uid(`unit:${u.unit}`),
        passwordHash,
        supplierId: u.role === 'SUPPLIER' ? uid('supplier:brightwave') : null,
      });
      await tx.insert(s.roleAssignment).values({ tenantId: TENANT_ID, userId: userId(u.key), role: u.role });
      await log('user.create', 'app_user', userId(u.key), {
        name: u.name,
        email: emailFor(u.key),
        role: u.role,
        passwordHash,
      });
    }

    // delegations of authority (separate sourcing vs signing authority: SEC-AC05)
    const delegations = [
      { scope: 'SOURCING_APPROVAL', max: '250000.00' },
      { scope: 'PUBLISH_PERMISSION', max: '5000000.00' },
      { scope: 'CONTRACT_SIGNING', max: '5000000.00' },
    ] as const;
    for (const d of delegations) {
      const id = uid(`delegation:${d.scope}`);
      await tx.insert(s.delegation).values({
        id,
        tenantId: TENANT_ID,
        scope: d.scope,
        role: 'DELEGATE',
        userId: userId('delegate'),
        maxValue: d.max,
      });
      await log('delegation.create', 'delegation', id, { scope: d.scope, maxValue: d.max });
    }
    // Exec holds a higher sourcing limit so high-value plans have an approver
    await tx.insert(s.delegation).values({
      id: uid('delegation:exec'),
      tenantId: TENANT_ID,
      scope: 'SOURCING_APPROVAL',
      role: 'EXEC',
      userId: userId('exec'),
      maxValue: '10000000.00',
    });
    await log('delegation.create', 'delegation', uid('delegation:exec'), {
      scope: 'SOURCING_APPROVAL',
      maxValue: '10000000.00',
    });

    // ---- requests
    type Req = {
      key: string;
      number: string;
      title: string;
      category: string;
      value: string;
      term: number;
      unit: string;
      phase: (typeof s.PHASES)[number];
      status: 'DRAFT' | 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETE';
      mode: 'SELF_SERVICE' | 'TEAM_LED';
      cx: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      requester: string;
    };
    const reqs: Req[] = [
      {
        key: 'cleaning',
        number: 'PR-2026-0001',
        title: 'Facilities cleaning services',
        category: 'Building cleaning (UNSPSC 76111500)',
        value: '1200000.00',
        term: 36,
        unit: 'Facilities',
        phase: 'EVALUATION',
        status: 'IN_PROGRESS',
        mode: 'TEAM_LED',
        cx: 'HIGH',
        requester: 'requester',
      },
      {
        key: 'itmsp',
        number: 'PR-2026-0002',
        title: 'Managed IT services',
        category: 'IT managed services (UNSPSC 81111800)',
        value: '4800000.00',
        term: 60,
        unit: 'IT',
        phase: 'TENDER',
        status: 'IN_PROGRESS',
        mode: 'TEAM_LED',
        cx: 'CRITICAL',
        requester: 'requester',
      },
      {
        key: 'paper',
        number: 'PR-2026-0003',
        title: 'Office paper (annual supply)',
        category: 'Paper products (UNSPSC 14111500)',
        value: '8000.00',
        term: 12,
        unit: 'Facilities',
        phase: 'INTAKE',
        status: 'DRAFT',
        mode: 'SELF_SERVICE',
        cx: 'LOW',
        requester: 'requester',
      },
      {
        key: 'security',
        number: 'PR-2026-0004',
        title: 'Security guard services',
        category: 'Security services (UNSPSC 92121500)',
        value: '640000.00',
        term: 24,
        unit: 'Facilities',
        phase: 'PLAN',
        status: 'IN_PROGRESS',
        mode: 'TEAM_LED',
        cx: 'MEDIUM',
        requester: 'requester',
      },
      {
        key: 'landscape',
        number: 'PR-2026-0005',
        title: 'Grounds and landscaping',
        category: 'Landscaping (UNSPSC 70171700)',
        value: '210000.00',
        term: 36,
        unit: 'Facilities',
        phase: 'CONTRACT_MGMT',
        status: 'COMPLETE',
        mode: 'TEAM_LED',
        cx: 'LOW',
        requester: 'requester',
      },
      {
        key: 'uniforms',
        number: 'PR-2026-0006',
        title: 'Staff uniforms supply',
        category: 'Apparel (UNSPSC 53100000)',
        value: '95000.00',
        term: 24,
        unit: 'Facilities',
        phase: 'CONTRACT_MGMT',
        status: 'COMPLETE',
        mode: 'TEAM_LED',
        cx: 'LOW',
        requester: 'requester',
      },
    ];
    for (const r of reqs) {
      const id = uid(`request:${r.key}`);
      await tx.insert(s.request).values({
        id,
        tenantId: TENANT_ID,
        number: r.number,
        title: r.title,
        category: r.category,
        estimatedValue: r.value,
        termMonths: r.term,
        businessUnit: r.unit,
        requesterId: userId(r.requester),
        phase: r.phase,
        status: r.status,
        intakeMode: r.mode,
        complexity: r.cx,
        budgetCheck: r.status === 'DRAFT' ? 'NOT_RUN' : 'CLEARED',
        createdAt: day(-60),
        updatedAt: day(-2),
      });
      const fields: Array<[string, string, string, boolean]> = [
        [
          'background',
          'Background',
          `Existing arrangements for ${r.title.toLowerCase()} are ending; a compliant market approach is required.`,
          true,
        ],
        [
          'deliverables',
          'Deliverables',
          'Service delivery to agreed SLAs across all sites; monthly reporting.',
          true,
        ],
        [
          'risk',
          'Key risks',
          r.cx === 'HIGH' || r.cx === 'CRITICAL'
            ? 'Supplier concentration; transition risk; data sensitivity.'
            : 'Low operational risk.',
          true,
        ],
      ];
      for (const [k, label, v, ai] of fields) {
        await tx.insert(s.fieldValue).values({
          tenantId: TENANT_ID,
          ownerType: 'REQUEST',
          ownerId: id,
          key: k,
          label,
          value: v,
          source: ai ? 'AI' : 'USER',
          aiDrafted: ai,
        });
      }
      await log(
        'request.create',
        'request',
        id,
        { number: r.number, title: r.title, estimatedValue: r.value },
        { id: userId(r.requester), role: 'REQUESTER' },
      );
      if (r.phase !== 'INTAKE') {
        const planId = uid(`plan:${r.key}`);
        const approved = !['PLAN'].includes(r.phase);
        await tx.insert(s.plan).values({
          id: planId,
          tenantId: TENANT_ID,
          requestId: id,
          status: approved ? 'APPROVED_LOCKED' : 'AWAITING_APPROVAL',
          locked: approved,
          summary: `${r.title}: ${r.term}-month engagement, estimated AUD ${Number(r.value).toLocaleString('en-AU')}.`,
        });
        await log(
          'plan.create',
          'plan',
          planId,
          { requestId: id, status: approved ? 'APPROVED_LOCKED' : 'AWAITING_APPROVAL' },
          { id: userId('procurement'), role: 'PROCUREMENT' },
        );
        if (approved) {
          await tx.insert(s.approval).values({
            tenantId: TENANT_ID,
            subjectType: 'PLAN',
            subjectId: planId,
            userId: userId(Number(r.value) > 250000 ? 'exec' : 'delegate'),
            role: Number(r.value) > 250000 ? 'EXEC' : 'DELEGATE',
            decision: 'APPROVED',
            stamp: `APPROVED · ${SEED_USERS.find((u) => u.key === (Number(r.value) > 250000 ? 'exec' : 'delegate'))!.name} · ${Number(r.value) > 250000 ? 'EXEC' : 'DELEGATE'} · ${dateOnly(day(-40))} 09:00 UTC`,
            decidedAt: day(-40),
          });
          await log(
            'plan.approve',
            'plan',
            planId,
            { status: 'APPROVED_LOCKED' },
            {
              id: userId(Number(r.value) > 250000 ? 'exec' : 'delegate'),
              role: Number(r.value) > 250000 ? 'EXEC' : 'DELEGATE',
            },
          );
        }
      }
    }

    // ---- tenders
    const t1 = uid('tender:cleaning'),
      t2 = uid('tender:itmsp');
    await tx.insert(s.tender).values({
      id: t1,
      tenantId: TENANT_ID,
      requestId: uid('request:cleaning'),
      type: 'RFT',
      access: 'CLOSED',
      status: 'EVALUATING',
      opensAt: day(-35),
      closesAt: day(-7),
    });
    await tx.insert(s.tender).values({
      id: t2,
      tenantId: TENANT_ID,
      requestId: uid('request:itmsp'),
      type: 'RFP',
      access: 'CLOSED',
      status: 'PUBLISHED',
      opensAt: day(-5),
      closesAt: day(28),
    });
    await log(
      'tender.publish',
      'tender',
      t1,
      { status: 'PUBLISHED' },
      { id: userId('procurement'), role: 'PROCUREMENT' },
    );
    await log(
      'tender.publish',
      'tender',
      t2,
      { status: 'PUBLISHED' },
      { id: userId('procurement'), role: 'PROCUREMENT' },
    );
    for (const [tenderId, requestKey, type] of [
      [t1, 'cleaning', 'RFT'],
      [t2, 'itmsp', 'RFP'],
    ] as const) {
      const [rq] = await tx
        .select()
        .from(s.request)
        .where(eq(s.request.id, uid(`request:${requestKey}`)));
      const pack = buildTenderPack({
        type,
        title: rq!.title,
        organisation: 'Meridian Group (demo)',
        plan: DEMO_PLAN_TEXT[requestKey] ?? {},
        request: {},
        contactEmail: 'procurement@meridian-demo.example',
        statutoryMinDays: 25,
      });
      for (const def of TENDER_FIELDS)
        await tx.insert(s.fieldValue).values({
          tenantId: TENANT_ID,
          ownerType: 'TENDER',
          ownerId: tenderId,
          key: def.key,
          label: def.label,
          value: pack[def.key] ?? '',
          source: 'SYSTEM',
        });
      const apId = uid(`approval:publish:${requestKey}`);
      await tx.insert(s.approval).values({
        id: apId,
        tenantId: TENANT_ID,
        subjectType: 'TENDER_PUBLISH',
        subjectId: tenderId,
        userId: userId('delegate'),
        role: 'DELEGATE',
        decision: 'APPROVED',
        stamp: 'PERMISSION TO PUBLISH · Dana Okafor · DELEGATE · 2026-09-01 09:00 UTC',
        decidedAt: day(-40),
      });
      await tx.update(s.tender).set({ publishPermissionId: apId }).where(eq(s.tender.id, tenderId));
    }
    for (const sp of SUPPLIERS) {
      for (const tenderId of [t1, t2]) {
        await tx.insert(s.invitation).values({
          tenantId: TENANT_ID,
          tenderId,
          email: `bids@${sp.key}.example`,
          company: sp.company,
          tokenHash: createHash('sha256').update(`seed-invite:${tenderId}:${sp.key}`).digest('hex'),
          expiresAt: day(30),
          usedAt: day(-6),
          supplierId: uid(`supplier:${sp.key}`),
        });
      }
      const subId = uid(`submission:${sp.key}`);
      await tx.insert(s.submission).values({
        id: subId,
        tenantId: TENANT_ID,
        tenderId: t1,
        supplierId: uid(`supplier:${sp.key}`),
        status: 'SUBMITTED',
        receipt: `RC-${sp.abn.slice(-4)}-${dateOnly(day(-8))}`,
        submittedAt: day(-8),
      });
      for (const [section, name] of [
        ['TECHNICAL', 'technical-response.pdf'],
        ['COMMERCIAL', 'pricing-schedule.xlsx'],
      ] as const) {
        const index = SUPPLIERS.findIndex((x) => x.key === sp.key);
        const bytes =
          section === 'TECHNICAL'
            ? demoTechnicalResponse(sp.company, index, 'Facilities cleaning services')
            : demoPricingSchedule(sp.company, index);
        const storageKey = `${TENANT_ID}/${subId}/${uid(`file:${sp.key}:${section}`)}`;
        if (opts.store) await opts.store.put(storageKey, bytes);
        await tx.insert(s.fileObject).values({
          tenantId: TENANT_ID,
          submissionId: subId,
          name,
          sizeBytes: bytes.length,
          contentType:
            section === 'TECHNICAL'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          storageKey,
          sha256: sha256(bytes),
          scan: 'CLEAN',
          section,
        });
      }
      await log(
        'submission.submit',
        'submission',
        subId,
        { supplierId: uid(`supplier:${sp.key}`), status: 'SUBMITTED' },
        { id: userId('supplier'), role: 'SUPPLIER' },
      );
    }
    await tx.insert(s.question).values({
      tenantId: TENANT_ID,
      tenderId: t2,
      text: 'Is a site visit mandatory before submitting?',
      answer: 'A site visit is recommended, not mandatory.',
      status: 'PUBLISHED',
      askedBySupplierId: uid('supplier:evergreen'),
    });

    // ---- evaluation at consensus with a flagged variance
    const ev = uid('evaluation:cleaning');
    await tx
      .insert(s.evaluation)
      .values({ id: ev, tenantId: TENANT_ID, tenderId: t1, status: 'CONSENSUS', varianceLimitPct: 30 });
    const crit = [
      ['Technical capability', '40', 'TECHNICAL'],
      ['Methodology and transition', '20', 'TECHNICAL'],
      ['Price', '30', 'COMMERCIAL'],
      ['Social and local benefit', '10', 'OTHER'],
    ] as const;
    for (const [i, [name, w, stream]] of crit.entries())
      await tx.insert(s.criterion).values({
        id: uid(`criterion:${i}`),
        tenantId: TENANT_ID,
        evaluationId: ev,
        name,
        weight: w,
        stream,
      });
    for (const [k, stream] of [
      ['evaluator-tech', 'TECHNICAL'],
      ['evaluator-comm', 'COMMERCIAL'],
      ['chair', 'OTHER'],
    ] as const) {
      await tx.insert(s.panelMember).values({
        tenantId: TENANT_ID,
        evaluationId: ev,
        userId: userId(k),
        stream,
        coiState: 'DECLARED_NONE',
        scoredAt: day(-3),
      });
      await log(
        'coi.declare',
        'evaluation',
        ev,
        { user: userId(k), none: true },
        { id: userId(k), role: k === 'chair' ? 'CHAIR' : 'EVALUATOR' },
      );
    }
    const base: Record<string, number[]> = {
      brightwave: [8.0, 7.5, 7.0, 6.0],
      evergreen: [7.0, 7.0, 8.0, 5.0],
      northstar: [6.5, 6.0, 9.0, 7.0],
      summit: [5.5, 5.0, 6.5, 4.0],
    };
    // Stream rules (same as the application): technical members score technical and "other" criteria only (never price),
    // commercial members score commercial and "other" only, the chair (stream OTHER) can score everything.
    const scorers = [
      ['evaluator-tech', 0, 'TECHNICAL'],
      ['evaluator-comm', -0.3, 'COMMERCIAL'],
      ['chair', 0.2, 'OTHER'],
    ] as const;
    const may = (stream: string, criterionStream: string) =>
      stream === 'OTHER' || criterionStream === 'OTHER' || stream === criterionStream;
    // engineered disagreement: the technical evaluator and the chair differ by 37.5% on Brightwave's technical capability
    const value = (key: string, ci: number, who: string, delta: number) =>
      key === 'brightwave' && ci === 0 && who === 'chair'
        ? 5.0
        : Math.max(0, Math.min(10, base[key]![ci]! + delta));
    for (const sp of SUPPLIERS) {
      for (const [ci, [, , cStream]] of crit.entries()) {
        for (const [who, delta, stream] of scorers) {
          if (!may(stream, cStream)) continue;
          await tx.insert(s.score).values({
            tenantId: TENANT_ID,
            evaluationId: ev,
            supplierId: uid(`supplier:${sp.key}`),
            criterionId: uid(`criterion:${ci}`),
            evaluatorId: userId(who),
            score: value(sp.key, ci, who, delta).toFixed(2),
          });
        }
      }
    }
    for (const sp of SUPPLIERS)
      for (const [ci, [, , cStream]] of crit.entries()) {
        const vals = scorers
          .filter(([, , stream]) => may(stream, cStream))
          .map(([who, delta]) => value(sp.key, ci, who, delta));
        const variance = ((Math.max(...vals) - Math.min(...vals)) / Math.max(...vals)) * 100;
        await tx.insert(s.consensusItem).values({
          tenantId: TENANT_ID,
          evaluationId: ev,
          supplierId: uid(`supplier:${sp.key}`),
          criterionId: uid(`criterion:${ci}`),
          variancePct: variance.toFixed(2),
          flagged: variance > 30,
        });
      }
    await log(
      'evaluation.consensus_open',
      'evaluation',
      ev,
      { status: 'CONSENSUS' },
      { id: userId('chair'), role: 'CHAIR' },
    );

    // ---- executed contracts (one ends in 74 days from the seed date)
    const contracts = [
      {
        key: 'landscape',
        number: 'CT-2026-0001',
        request: 'landscape',
        supplier: 'northstar',
        value: '210000.00',
        start: day(-1056),
        end: day(74),
        notice: 90,
      },
      {
        key: 'uniforms',
        number: 'CT-2026-0002',
        request: 'uniforms',
        supplier: 'evergreen',
        value: '95000.00',
        start: day(-300),
        end: day(430),
        notice: 60,
      },
    ];
    for (const c of contracts) {
      const id = uid(`contract:${c.key}`);
      await tx.insert(s.contract).values({
        id,
        tenantId: TENANT_ID,
        number: c.number,
        supplierId: uid(`supplier:${c.supplier}`),
        templateId: 'tpl-services-std',
        status: 'EXECUTED',
        value: c.value,
        startDate: dateOnly(c.start),
        endDate: dateOnly(c.end),
        noticeDays: c.notice,
        locked: false, // locked after the clauses are written (the database freezes clauses of a locked contract)
      });
      for (const [cid, title, mandatory] of [
        ['TERM', 'Term and extension', true],
        ['PRICE', 'Pricing and payment', true],
        ['TERMINATION', 'Termination', true],
        ['IP', 'Intellectual property', false],
      ] as const) {
        await tx.insert(s.clause).values({
          tenantId: TENANT_ID,
          contractId: id,
          clauseId: cid,
          title,
          text: `${title} (template wording, synthetic).`,
          mandatory,
        });
      }
      await tx.update(s.contract).set({ locked: true }).where(eq(s.contract.id, id));
      await tx.insert(s.approval).values({
        tenantId: TENANT_ID,
        subjectType: 'CONTRACT',
        subjectId: id,
        userId: userId('delegate'),
        role: 'DELEGATE',
        decision: 'APPROVED',
        stamp: `SIGNED · Dana Okafor · DELEGATE · ${dateOnly(c.start)} 09:00 UTC`,
        decidedAt: c.start,
      });
      const [row] = await tx.select().from(s.contract).where(eq(s.contract.id, id));
      await createContractRecord(tx, row!, {
        extensions: SERVICES_TEMPLATE.extensions ?? [],
        today: dateOnly(now),
        pastAsSent: true,
        ownerId: userId('contract-mgr'),
      });
      await log(
        'contract.sign',
        'contract',
        id,
        { number: c.number, status: 'EXECUTED', locked: true },
        { id: userId('delegate'), role: 'DELEGATE' },
      );
    }

    // ---- notifications, workflows, templates
    for (const [k, title, body] of [
      ['delegate', 'Plan awaiting your approval', 'PR-2026-0004 Security guard services'],
      ['chair', 'Flagged scores need rationale', 'PR-2026-0001: 1 item exceeds the 30% variance limit'],
      ['contract-mgr', 'Contract ends in 74 days', 'CT-2026-0001 Grounds and landscaping'],
      ['procurement', 'Tender closes in 28 days', 'PR-2026-0002 Managed IT services'],
      ['legal', 'Draft contract ready for review', 'PR-2026-0001'],
      ['requester', 'Your request was approved', 'PR-2026-0005'],
    ] as const)
      await tx.insert(s.notification).values({ tenantId: TENANT_ID, userId: userId(k), title, body });

    for (const w of [
      {
        id: 'wf-simple',
        name: 'Simple purchase',
        tier: 'SIMPLE',
        editable: true,
        steps: ['Request', 'Approve', 'Order'],
      },
      {
        id: 'wf-intermediate',
        name: 'Intermediate sourcing',
        tier: 'INTERMEDIATE',
        editable: false,
        steps: ['Request', 'Plan', 'Quotes', 'Approve', 'Contract'],
      },
      {
        id: 'wf-complex',
        name: 'Complex tender',
        tier: 'COMPLEX',
        editable: false,
        steps: ['Request', 'Plan', 'Tender', 'Evaluate', 'Award', 'Contract'],
      },
    ] as const)
      await tx.insert(s.workflow).values({
        id: w.id,
        tenantId: TENANT_ID,
        name: w.name,
        tier: w.tier,
        editable: w.editable,
        steps: w.steps.map((k) => ({ key: k.toLowerCase(), label: k, mandatory: true })),
      });
    for (const [id, type, name, body] of [
      ['tpl-services-std', 'CONTRACT', 'Services agreement (standard)', SERVICES_TEMPLATE],
      ['tpl-works-std', 'CONTRACT', 'Works and supply agreement (standard)', WORKS_TEMPLATE],
      ['tpl-rft', 'TENDER', 'Request for tender', {}],
      ['tpl-rfp', 'TENDER', 'Request for proposal', {}],
      ['tpl-plan', 'PLAN', 'Procurement plan', {}],
    ] as const)
      await tx.insert(s.template).values({ id, tenantId: TENANT_ID, type, name, version: '1.0', body });
  });

  return { seeded: true, counts: await counts(database) };
}

async function counts(database: Database): Promise<Record<string, number>> {
  const r = await database.pg.query<{ t: string; n: number }>(
    `select 'tenant' t, count(*)::int n from tenant union all select 'app_user', count(*)::int from app_user
     union all select 'request', count(*)::int from request union all select 'audit_event', count(*)::int from audit_event
     union all select 'contract', count(*)::int from contract union all select 'score', count(*)::int from score
     union all select 'notification', count(*)::int from notification union all select 'supplier', count(*)::int from supplier`,
  );
  return Object.fromEntries(r.rows.map((x) => [x.t, x.n]));
}
