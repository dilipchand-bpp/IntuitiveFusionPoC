/**
 * "Simulate supplier responses" (design principle 5). Real supplier actions stay with suppliers; for a demonstration only, a person
 * presses a button and the seeded demo supplier contacts each submit a bid, labelled SIMULATED, through the supplier-portal routes
 * with their own sessions (so the supplier rules apply: invited or open tender, closing time, scanned files, one bid each).
 * It is never automatic: nothing in the tick calls this.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { withSystem } from '../../db/client.js';
import { appUser, roleAssignment, supplier, tender } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { observe } from './observe.js';
import { ACTOR_LABEL, ENGINE, ToolClient } from './tools.js';
import type { CopilotEngine } from './engine.js';
import type { RunRow } from './store.js';

const PDF = Buffer.from(
  '%PDF-1.7\nSIMULATED technical response written by the Procurement Copilot for a demonstration only.',
);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]);

export interface SimulatedBid {
  supplier: string;
  contact: string;
  outcome: 'SUBMITTED' | 'ALREADY_SUBMITTED' | 'NOT_INVITED' | 'REFUSED';
  receipt?: string;
  note: string;
}

export async function simulateSuppliers(
  engine: CopilotEngine,
  run: RunRow,
  by: { userId: string; role: string },
): Promise<{ label: string; simulated: true; bids: SimulatedBid[] }> {
  const { d, app } = engine;
  const store = engine.store;
  const obs = await observe(d.database, run.tenantId, run.requestId, d.clock.now());
  const t = obs.tender;
  if (!t || t.status !== 'PUBLISHED' || (t.closesAt && t.closesAt.getTime() <= d.clock.now().getTime()))
    throw new AppError(409, 'TENDER_NOT_OPEN', 'There is no open tender on this run to respond to');
  const contacts = await withSystem(d.database, (tx) =>
    tx
      .select({
        id: appUser.id,
        name: appUser.name,
        company: supplier.company,
        supplierId: appUser.supplierId,
      })
      .from(appUser)
      .innerJoin(
        roleAssignment,
        and(eq(roleAssignment.userId, appUser.id), eq(roleAssignment.role, 'SUPPLIER')),
      )
      .innerJoin(supplier, eq(supplier.id, appUser.supplierId))
      .where(
        and(eq(appUser.tenantId, run.tenantId), eq(appUser.active, true), isNotNull(appUser.supplierId)),
      ),
  );
  await d.audit.recordOutsideTx(
    d.database,
    {
      tenantId: run.tenantId,
      userId: by.userId,
      role: by.role as never,
      correlationId: `copilot-sim:${run.id}`,
    },
    {
      action: 'copilot.simulate_suppliers',
      entityType: 'cp_run',
      entityId: run.id,
      after: {
        actorLabel: ACTOR_LABEL,
        engine: ENGINE,
        simulated: true,
        tenderId: t.id,
        contacts: contacts.length,
      },
    },
  );
  await store.event(
    run,
    'NOTE',
    'WORKFLOW',
    'SIMULATED: supplier responses requested',
    `A person pressed the demonstration button. ${contacts.length} demo supplier contact(s) will respond through the supplier portal. These are not real bids.`,
  );
  const bids: SimulatedBid[] = [];
  for (const c of contacts) {
    const client = new ToolClient(
      app,
      d,
      { tenantId: run.tenantId, userId: c.id, role: 'SUPPLIER', runId: run.id },
      true,
    );
    const meta = { stepKey: `simulate:${c.supplierId}`, agent: 'WORKFLOW' };
    let bid: SimulatedBid;

    try {
      const list = await client.raw('GET', '/supplier/tenders', undefined, meta);
      const mine = list.ok
        ? (list.json as Array<{ id: string; submissionStatus: string; receipt: string | null }>).find(
            (x) => x.id === t.id,
          )
        : null;
      if (!mine)
        bid = {
          supplier: c.company,
          contact: c.name,
          outcome: 'NOT_INVITED',
          note: 'This supplier cannot see the tender (not invited), so it did not respond',
        };
      else if (mine.submissionStatus === 'SUBMITTED')
        bid = {
          supplier: c.company,
          contact: c.name,
          outcome: 'ALREADY_SUBMITTED',
          ...(mine.receipt ? { receipt: mine.receipt } : {}),
          note: 'Already submitted',
        };
      else {
        const up1 = await client.raw(
          'POST',
          `/supplier/tenders/${t.id}/submission/files`,
          {
            name: 'SIMULATED technical response.pdf',
            section: 'TECHNICAL',
            dataBase64: PDF.toString('base64'),
          },
          meta,
        );
        const up2 = up1.ok
          ? await client.raw(
              'POST',
              `/supplier/tenders/${t.id}/submission/files`,
              { name: 'SIMULATED pricing.xlsx', section: 'COMMERCIAL', dataBase64: ZIP.toString('base64') },
              meta,
            )
          : up1;
        if (!up2.ok)
          bid = {
            supplier: c.company,
            contact: c.name,
            outcome: 'REFUSED',
            note: `Upload refused: ${up2.title ?? up2.status}`,
          };
        else {
          const sub = await client.raw('POST', `/supplier/tenders/${t.id}/submission`, undefined, meta);
          bid = sub.ok
            ? {
                supplier: c.company,
                contact: c.name,
                outcome: 'SUBMITTED',
                receipt: (sub.json as { receipt?: string }).receipt ?? '',
                note: 'Submitted a SIMULATED bid',
              }
            : {
                supplier: c.company,
                contact: c.name,
                outcome: 'REFUSED',
                note: `Submission refused: ${sub.title ?? sub.status}${sub.errors[0] ? ` (${sub.errors[0].message})` : ''}`,
              };
        }
      }
    } finally {
      await client.close();
    }
    bids.push(bid);
    await store.addStep({
      tenantId: run.tenantId,
      runId: run.id,
      stepKey: `simulate:${c.supplierId}`,
      idemKey: `simulate:${t.id}:${c.supplierId}:${bid.outcome}:${d.clock.now().getTime()}`,
      agent: 'WORKFLOW',
      tool: 'supplier portal (SIMULATED)',
      stage: 'TENDER',
      status: bid.outcome === 'SUBMITTED' || bid.outcome === 'ALREADY_SUBMITTED' ? 'DONE' : 'SKIPPED',
      title: `SIMULATED: ${c.company} (${c.name}) ${bid.outcome === 'SUBMITTED' ? 'submitted a bid' : 'did not submit'}`,
      reason:
        'Demonstration only: a person pressed "Simulate supplier responses". The bid is labelled SIMULATED.',
      rule: 'Principle 5: real supplier actions stay with suppliers; simulated ones are manual, labelled and use the supplier portal routes',
      request: {},
      result: { outcome: bid.outcome, receipt: bid.receipt ?? null, note: bid.note, simulated: true },
      httpStatus: null,
      attempt: 1,
      startedAt: d.clock.now(),
      finishedAt: d.clock.now(),
      durationMs: 0,
      actorLabel: `${ACTOR_LABEL} (SIMULATED supplier response)`,
    });
    await store.event(
      run,
      'STEP',
      'WORKFLOW',
      `SIMULATED: ${c.company}: ${bid.note}`,
      bid.receipt ? `Receipt ${bid.receipt}` : '',
      { simulated: true, outcome: bid.outcome },
    );
  }
  return { label: 'SIMULATED', simulated: true, bids };
}

/**
 * "Simulate closing time" (demonstration only). The statutory minimum window (NFR-L01, 25 days by default) cannot pass on a real
 * clock during a demo, so a person can press a button that moves the closing time of the run's open tender to now. It is labelled
 * SIMULATED, audited, refused in production and refused when there are no bids to evaluate. Nothing in the tick calls this.
 */
export async function simulateClose(
  engine: CopilotEngine,
  run: RunRow,
  by: { userId: string; role: string },
): Promise<{ label: string; simulated: true; closedAt: string }> {
  const { d } = engine;
  if (process.env.NODE_ENV === 'production')
    throw new AppError(403, 'DEMO_ONLY', 'Simulating the closing time is not available in production');
  const now = d.clock.now();
  const obs = await observe(d.database, run.tenantId, run.requestId, now);
  const t = obs.tender;
  if (!t || t.status !== 'PUBLISHED' || (t.closesAt && t.closesAt.getTime() <= now.getTime()))
    throw new AppError(409, 'TENDER_NOT_OPEN', 'There is no open tender on this run to close');
  if (t.bids === 0)
    throw new AppError(
      409,
      'NO_BIDS_TO_CLOSE',
      'There are no submitted bids yet. Use "Simulate supplier responses" first, or wait for real bids',
    );
  const closedAt = new Date(now.getTime() - 1000);
  await withSystem(d.database, (tx) =>
    tx.update(tender).set({ closesAt: closedAt, updatedAt: now }).where(eq(tender.id, t.id)),
  );
  await d.audit.recordOutsideTx(
    d.database,
    {
      tenantId: run.tenantId,
      userId: by.userId,
      role: by.role as never,
      correlationId: `copilot-sim-close:${run.id}`,
    },
    {
      action: 'copilot.simulate_close',
      entityType: 'cp_run',
      entityId: run.id,
      after: {
        actorLabel: ACTOR_LABEL,
        engine: ENGINE,
        simulated: true,
        tenderId: t.id,
        previousClosesAt: t.closesAt?.toISOString() ?? null,
        bids: t.bids,
      },
    },
  );
  await engine.store.event(
    run,
    'NOTE',
    'WORKFLOW',
    'SIMULATED: closing time brought forward',
    `A person pressed the demonstration button. The tender's closing time was moved from ${t.closesAt?.toISOString() ?? 'unset'} to now, skipping the statutory open period. This cannot be done in production.`,
    { simulated: true },
  );
  return { label: 'SIMULATED', simulated: true, closedAt: closedAt.toISOString() };
}
