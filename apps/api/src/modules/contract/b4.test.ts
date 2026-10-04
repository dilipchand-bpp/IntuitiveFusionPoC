import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { TENANT_ID, uid } from '../../db/seed.js';
import { BRIGHT, createEnv, type Json } from './test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
const call = (...a: Parameters<typeof env.call>) => env.call(...a);
beforeAll(async () => {
  env = await createEnv();
}, 120_000);

const setting = async (name: string, value: unknown) => {
  const r = await call('admin', 'PUT', '/admin/settings', { [name]: value });
  expect(r.statusCode, r.body).toBe(200);
};
const msgs = (r: { json(): unknown }) =>
  (((r.json() as Json).errors ?? []) as Array<{ message: string }>).map((e) => e.message).join(' | ');
const RULES = {
  requireBankDetails: false,
  requireRiskSummaryReview: false,
  endorsements: [] as string[],
  protectedClauses: [] as string[],
  negotiationLockDays: 30,
  signingReminderHours: 48,
};
const rules = (over: Partial<typeof RULES>) => setting('contractRules', { ...RULES, ...over });
const company = (name: string) =>
  env.withSystem(env.database, (tx) =>
    tx.update(s.supplier).set({ company: name }).where(eq(s.supplier.id, BRIGHT)),
  );
const audit = async (entityId: string) =>
  (
    await env.withSystem(env.database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, entityId)),
    )
  ).map((e) => e.action);
const execSigner = () =>
  env.extraUser('exec-signer', 'EXEC', [{ scope: 'CONTRACT_SIGNING', max: '20000000.00' }]);
const release = (id: string, body?: unknown) =>
  call('legal', 'POST', `/contracts/${id}/release-for-signing`, body);

describe('FR-0405 the tender cross-check', () => {
  it('compares the contract with what was tendered and holds the draft until a person has reviewed a failure', async () => {
    const d = await env.draft({ value: 120_000 });
    await env.withSystem(env.database, async (tx) => {
      const [sub] = await tx.select().from(s.submission).where(eq(s.submission.tenderId, d.tenderId));
      await tx
        .insert(s.bidPricing)
        .values({ tenantId: TENANT_ID, submissionId: sub!.id, basePrice: '100000', tco: '100000' });
    });
    expect((await call('evaluator-tech', 'POST', `/contracts/${d.id}/checks/run`)).statusCode).toBe(403);
    const run = (await call('legal', 'POST', `/contracts/${d.id}/checks/run`)).json() as {
      tender: Array<{ key: string; result: string; detail: string }>;
    };
    expect(run.tender.find((x) => x.key === 'PRICE')).toMatchObject({
      result: 'FAIL',
      detail: expect.stringMatching(/differs from the tendered total cost/),
    });
    expect(run.tender.find((x) => x.key === 'ESTIMATE')!.result).toBe('PASS');
    const blocked = await release(d.id);
    expect(blocked.statusCode).toBe(422);
    expect(msgs(blocked)).toMatch(/Tender check "Price against the tender" failed/);
    // a short reason is refused; a real one lets the draft go
    expect(
      (
        await call('legal', 'POST', `/contracts/${d.id}/checks/TENDER_CONSISTENCY/PRICE/review`, {
          note: 'ok',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('legal', 'POST', `/contracts/${d.id}/checks/TENDER_CONSISTENCY/PRICE/review`, {
          note: 'The contract includes the optional extension agreed in the tender clarification',
        })
      ).statusCode,
    ).toBe(200);
    expect((await release(d.id)).statusCode).toBe(200);
    expect(await audit(d.id)).toEqual(
      expect.arrayContaining(['contract.checks_run', 'contract.check_review']),
    );
    const checks = (await call('probity', 'GET', `/contracts/${d.id}/checks`)).json() as Json;
    expect(checks.tender.find((x: Json) => x.key === 'PRICE').result).toBe('REVIEWED');
  });

  it('flags terms the supplier proposed that are still to be negotiated, without blocking', async () => {
    const d = await env.draft();
    await env.withSystem(env.database, (tx) =>
      tx.insert(s.tenderDeviation).values({
        tenantId: TENANT_ID,
        tenderId: d.tenderId,
        supplierId: BRIGHT,
        clauseRef: '12.1 Liability',
        proposal: 'Cap at the annual fee',
        status: 'NEGOTIATE',
      }),
    );
    const run = (await call('legal', 'POST', `/contracts/${d.id}/checks/run`)).json() as Json;
    expect(run.tender.find((x: Json) => x.key === 'TERMS')).toMatchObject({
      result: 'WARN',
      detail: expect.stringMatching(/12\.1 Liability/),
    });
    expect((await release(d.id)).statusCode).toBe(200);
  });
});

describe('FR-0415 the vendor pre-flight before signature', () => {
  it('checks legal name, tax and banking; a failure holds release, and one found later holds signing until reviewed', async () => {
    await rules({ requireBankDetails: true });
    const d = await env.draft();
    // no banking details on record and the organisation requires them
    const early = await release(d.id);
    expect(early.statusCode).toBe(422);
    expect(msgs(early)).toMatch(/Banking details.*No banking details are recorded/);
    // the supplier gives an account in someone else's name, then the right one
    const wrong = await call('supplier', 'PUT', '/supplier/profile/bank', {
      bsb: '062-000',
      account: '12345678',
      accountName: 'Somebody Else Pty Ltd',
    });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.json().account).toBe('*****678'); // the account number is not echoed back in full
    await call('legal', 'POST', `/contracts/${d.id}/checks/run`);
    expect(
      ((await call('legal', 'GET', `/contracts/${d.id}/checks`)).json() as Json).vendor.find(
        (x: Json) => x.key === 'BANK',
      ).detail,
    ).toMatch(/in the name of "Somebody Else/);
    expect(
      (
        await call('supplier', 'PUT', '/supplier/profile/bank', {
          bsb: 'bad',
          account: '1',
          accountName: 'x',
        })
      ).statusCode,
    ).toBe(400);
    await call('supplier', 'PUT', '/supplier/profile/bank', {
      bsb: '062-000',
      account: '12345678',
      accountName: 'Brightwave Cleaning Pty Ltd',
    });
    const ok = await release(d.id);
    expect(ok.statusCode, ok.body).toBe(200);
    const trail = JSON.stringify(
      await env.withSystem(env.database, (tx) =>
        tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'supplier.bank_update')),
      ),
    );
    expect(trail).not.toContain('12345678');
    // the register stops recognising the company after release: signing is held until legal reviews it
    await company('Brightwave Dissolved Pty Ltd');
    await call('legal', 'POST', `/contracts/${d.id}/checks/run`);
    const sign = await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    expect(sign.statusCode).toBe(409);
    expect(sign.json().code).toBe('PREFLIGHT_FAILED');
    expect(((await call('delegate', 'GET', `/contracts/${d.id}`)).json() as Json).permissions.canSign).toBe(
      false,
    );
    for (const key of ['LEGAL_NAME', 'TAX', 'BANK'])
      await call('legal', 'POST', `/contracts/${d.id}/checks/VENDOR_PREFLIGHT/${key}/review`, {
        note: 'Legal confirmed the trading name change with the registry',
      });
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    await company('Brightwave Cleaning Pty Ltd');
    await rules({});
  });
});

describe('FR-0440 negotiation beyond the limit', () => {
  it('locks signature blocks after 30 days until sanctions and financial risk are checked again', async () => {
    const d = await env.draft();
    env.clock.advanceDays(31);
    const v = (await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json;
    expect(v.negotiation).toMatchObject({ locked: true, limitDays: 30 });
    const stopped = await release(d.id);
    expect(stopped.statusCode).toBe(422);
    expect(msgs(stopped)).toMatch(/Negotiation has run past 30 days/);
    // a re-check that finds a watchlist match keeps it locked
    await company('Blocked Holdings Pty Ltd');
    const bad = (await call('legal', 'POST', `/contracts/${d.id}/recheck`)).json() as Json;
    expect(bad.checks.recheck.find((x: Json) => x.key === 'SANCTIONS').result).toBe('FAIL');
    expect(bad.negotiation.locked).toBe(true);
    await company('Brightwave Cleaning Pty Ltd');
    expect((await call('evaluator-tech', 'POST', `/contracts/${d.id}/recheck`)).statusCode).toBe(403);
    const good = (await call('legal', 'POST', `/contracts/${d.id}/recheck`)).json() as Json;
    expect(good.negotiation.locked).toBe(false);
    expect(good.checks.recheck.map((x: Json) => x.result)).toEqual(['PASS', 'PASS', 'PASS']);
    expect((await release(d.id)).statusCode).toBe(200);
    // the clock runs again from the re-check: another 31 days locks signing, and a fresh check opens it
    env.clock.advanceDays(31);
    const sign = await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    expect(sign.statusCode).toBe(409);
    expect(sign.json().code).toBe('NEGOTIATION_LOCKED');
    expect(
      ((await call('delegate', 'GET', `/contracts/${d.id}`)).json() as Json).permissions.signBlocked,
    ).toMatch(/locked until sanctions/);
    await call('legal', 'POST', `/contracts/${d.id}/recheck`);
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    expect(await audit(d.id)).toContain('contract.recheck');
  });
});

describe('FR-0425 blind signing, staged endorsement and signature blocks', () => {
  async function bigDraft(mode: 'BLIND' | 'STAGED') {
    const d = await env.draft({ value: 2_000_000 });
    expect(
      (await call('legal', 'PUT', `/contracts/${d.id}/signing-mode`, { signingMode: mode })).statusCode,
    ).toBe(200);
    expect((await release(d.id)).statusCode).toBe(200);
    return d;
  }
  it('staged: signatures are collected in order; the executive cannot sign before the delegate', async () => {
    const exec = await execSigner();
    const d = await bigDraft('STAGED');
    const early = await call(exec.email, 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('SIGNING_ORDER');
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    expect(
      (await call(exec.email, 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).json().status,
    ).toBe('EXECUTED');
  });
  it('blind: a signatory sees no other signature or identity until the contract is executed', async () => {
    const exec = await execSigner();
    const d = await bigDraft('BLIND');
    await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' });
    const seen = (await call(exec.email, 'GET', `/contracts/${d.id}`)).json() as Json;
    expect(seen.blind).toBe(true);
    expect(seen.signatures).toEqual([]);
    expect(seen.chain.every((c: Json) => c.signedBy === null)).toBe(true);
    // the people who run the process still see who signed
    expect(((await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json).signatures).toHaveLength(1);
    const done = (
      await call(exec.email, 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })
    ).json() as Json;
    expect(done.status).toBe('EXECUTED');
    expect(done.signatures).toHaveLength(2); // after execution nothing is hidden
    expect(
      (await call('delegate', 'PUT', `/contracts/${d.id}/signing-mode`, { signingMode: 'STANDARD' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('legal', 'PUT', `/contracts/${d.id}/signing-mode`, { signingMode: 'STANDARD' })).statusCode,
    ).toBe(409);
  });
  it('shows where each signature block sits, from the template when it sets them', async () => {
    const d = await env.draft();
    const v = (await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json;
    expect(v.signatureBlocks).toEqual([
      expect.objectContaining({ role: 'DELEGATE', position: 'bottom-left' }),
    ]);
    await env.withSystem(env.database, async (tx) => {
      const [c] = await tx.select().from(s.contract).where(eq(s.contract.id, d.id));
      const [t] = await tx.select().from(s.template).where(eq(s.template.id, c!.templateId!));
      await tx
        .update(s.template)
        .set({
          body: {
            ...(t!.body as object),
            signatureBlocks: [{ role: 'DELEGATE', label: 'For the Customer', position: 'page-2-top' }],
          },
        })
        .where(eq(s.template.id, t!.id));
    });
    expect(
      ((await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json).signatureBlocks[0],
    ).toMatchObject({ label: 'For the Customer', position: 'page-2-top' });
  });
});

describe('FR-0430 signing other documents', () => {
  it('an NDA is drafted, reviewed, released and signed like a contract, and exports as PDF and Word', async () => {
    expect(
      (
        await call('requester', 'POST', '/contracts/documents', {
          docType: 'NDA',
          supplierId: BRIGHT,
          title: 'NDA',
          text: 'x'.repeat(30),
        })
      ).statusCode,
    ).toBe(403);
    const made = await call('legal', 'POST', '/contracts/documents', {
      docType: 'NDA',
      supplierId: BRIGHT,
      title: 'Mutual non-disclosure agreement',
      text: 'Each party keeps the other party confidential information secret and uses it only for the project.',
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;
    expect(made.json()).toMatchObject({
      docType: 'NDA',
      title: 'Mutual non-disclosure agreement',
      status: 'DRAFT',
    });
    const rel = await release(id);
    expect(rel.statusCode, rel.body).toBe(200);
    const signed = await call('delegate', 'POST', `/contracts/${id}/sign`, { decision: 'APPROVE' });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(signed.json()).toMatchObject({ status: 'EXECUTED', locked: true, docType: 'NDA' });
    const pdf = await call('legal', 'GET', `/contracts/${id}/export.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.toString('latin1')).toMatch(/Non-disclosure agreement/);
    expect((await call('legal', 'GET', `/contracts/${id}/export.docx`)).statusCode).toBe(200);
    expect((await call('requester', 'GET', `/contracts/${id}/export.pdf`)).statusCode).toBe(403);
    expect(await audit(id)).toEqual(
      expect.arrayContaining(['contract.document_create', 'contract.export', 'contract.sign']),
    );
  });
});

describe('FR-0400 non-negotiable clauses', () => {
  it('a change to a protected clause tells General Counsel and the risk delegate and blocks release until one of them approves', async () => {
    await rules({ protectedClauses: ['LIABILITY'] });
    const d = await env.draft();
    const edit = await call('legal', 'PUT', `/contracts/${d.id}/clauses/LIABILITY`, {
      text: 'The Supplier is not liable for any loss, and its liability is unlimited for the Customer.',
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const told = async (user: string) =>
      (
        await env.withSystem(env.database, (tx) =>
          tx
            .select()
            .from(s.notification)
            .where(eq(s.notification.userId, uid(`user:${user}`))),
        )
      ).map((n) => n.title);
    expect(await told('exec')).toContain('A non-negotiable clause was changed');
    expect(await told('probity')).toContain('A non-negotiable clause was changed');
    expect(await audit(d.id)).toContain('contract.protected_clause_changed');
    // an ordinary delegate cannot clear it
    const refused = await call('delegate', 'POST', `/contracts/${d.id}/deviations/LIABILITY/decision`, {
      decision: 'APPROVE',
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('PROTECTED_CLAUSE');
    const blocked = await release(d.id);
    expect(blocked.statusCode).toBe(422);
    expect(msgs(blocked)).toMatch(
      /non-negotiable clause: the change needs approval from General Counsel or the risk delegate/,
    );
    // the risk delegate (probity) can; the executive could too
    expect(
      (
        await call('probity', 'POST', `/contracts/${d.id}/deviations/LIABILITY/decision`, {
          decision: 'APPROVE',
          comment: 'Reviewed with General Counsel',
        })
      ).statusCode,
    ).toBe(200);
    expect((await release(d.id)).statusCode).toBe(200);
    // and probity cannot decide an ordinary clause
    const d2 = await env.draft();
    await call('legal', 'PUT', `/contracts/${d2.id}/clauses/CONFIDENTIALITY`, {
      text: 'Each party keeps information confidential, except as it sees fit.',
    });
    expect(
      (
        await call('probity', 'POST', `/contracts/${d2.id}/deviations/CONFIDENTIALITY/decision`, {
          decision: 'APPROVE',
        })
      ).statusCode,
    ).toBe(403);
    await rules({});
  });
});

describe('FR-0480 endorsements before release', () => {
  it('can require legal and another business unit to endorse; release waits for both', async () => {
    await rules({ endorsements: ['LEGAL', 'FINANCE'] });
    const d = await env.draft();
    const early = await release(d.id);
    expect(early.statusCode).toBe(422);
    expect(msgs(early)).toMatch(/legal endorsement is required.*finance endorsement is required/);
    expect((await call('procurement', 'POST', `/contracts/${d.id}/endorse`, {})).statusCode).toBe(403);
    expect(
      (await call('legal', 'POST', `/contracts/${d.id}/endorse`, { comment: 'Reviewed the draft' }))
        .statusCode,
    ).toBe(200);
    expect((await call('legal', 'POST', `/contracts/${d.id}/endorse`, {})).statusCode).toBe(409);
    expect(((await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json).endorsements.missing).toEqual([
      'FINANCE',
    ]);
    expect(
      (await call('finance', 'POST', `/contracts/${d.id}/endorse`, { comment: 'Budget confirmed' }))
        .statusCode,
    ).toBe(200);
    expect((await release(d.id)).statusCode).toBe(200);
    await rules({ endorsements: ['LEGAL'] });
    const d2 = await env.draft();
    expect((await call('finance', 'POST', `/contracts/${d2.id}/endorse`, {})).json().code).toBe(
      'NOT_REQUIRED',
    );
    await rules({});
    // with no requirement, release is as before
    expect((await release((await env.draft()).id)).statusCode).toBe(200);
    expect(await audit(d.id)).toContain('contract.endorse');
  });
});

describe('FR-0445 invitations, reminders, questions and progress', () => {
  it('invites each signatory and the supplier, notes who has seen it, reminds on a schedule, answers questions, and tells stakeholders as it is signed', async () => {
    const d = await env.draft();
    expect((await release(d.id)).statusCode).toBe(200);
    const mails = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.outboundEmail).where(eq(s.outboundEmail.kind, 'SIGNING_INVITATION')),
    );
    expect(mails.some((m) => m.toEmail === 'delegate@meridian-demo.example')).toBe(true);
    expect(mails.some((m) => m.toEmail === 'supplier@meridian-demo.example')).toBe(true);
    const before = (await call('legal', 'GET', `/contracts/${d.id}/signing`)).json() as Json;
    expect(before.invitations.find((i: Json) => i.name === 'Dana Okafor')).toMatchObject({
      role: 'DELEGATE',
      external: false,
      viewedAt: null,
      signed: false,
    });
    expect(before.invitations.find((i: Json) => i.external).role).toBe('SUPPLIER');
    // opening the contract marks it seen
    await call('delegate', 'GET', `/contracts/${d.id}`);
    expect(
      ((await call('legal', 'GET', `/contracts/${d.id}/signing`)).json() as Json).invitations.find(
        (i: Json) => i.name === 'Dana Okafor',
      ).viewedAt,
    ).not.toBeNull();
    // a reminder on request, and one from the schedule after 48 hours
    const manual = (await call('legal', 'POST', `/contracts/${d.id}/signing/remind`)).json() as Json;
    expect(manual.reminded).toEqual(['Dana Okafor']);
    env.clock.advanceMs(49 * 3_600_000);
    await call('legal', 'GET', '/contracts');
    const after = (await call('legal', 'GET', `/contracts/${d.id}/signing`)).json() as Json;
    expect(after.invitations.find((i: Json) => i.name === 'Dana Okafor').reminders).toBe(2);
    expect(
      (
        await env.withSystem(env.database, (tx) =>
          tx.select().from(s.outboundEmail).where(eq(s.outboundEmail.kind, 'SIGNING_REMINDER')),
        )
      ).length,
    ).toBeGreaterThanOrEqual(2);
    // questions before signing: from the delegate, and from the supplier in their own portal
    expect(
      (
        await call('requester', 'POST', `/contracts/${d.id}/questions`, {
          question: 'Not allowed to ask this',
        })
      ).statusCode,
    ).toBe(403);
    const q = await call('delegate', 'POST', `/contracts/${d.id}/questions`, {
      question: 'Does the term include the extension?',
      clauseId: 'TERM',
    });
    expect(q.statusCode, q.body).toBe(201);
    expect(
      (
        await call('legal', 'POST', `/contract-questions/${q.json().id}/answer`, {
          answer: 'No, the extension is a separate option.',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call('legal', 'POST', `/contract-questions/${q.json().id}/answer`, {
          answer: 'Answering twice',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await env.withSystem(env.database, (tx) =>
          tx
            .select()
            .from(s.notification)
            .where(eq(s.notification.userId, uid('user:delegate'))),
        )
      ).some((n) => n.title === 'Your question about a contract was answered'),
    ).toBe(true);
    const list = (await call('supplier', 'GET', '/supplier/contracts')).json() as Json;
    expect(list.contracts.map((c: Json) => c.id)).toContain(d.id);
    const sv = (await call('supplier', 'GET', `/supplier/contracts/${d.id}`)).json() as Json;
    expect(sv.clauses.length).toBeGreaterThan(5);
    expect(JSON.stringify(sv)).not.toContain('Dana Okafor');
    const sq = await call('supplier', 'POST', `/supplier/contracts/${d.id}/questions`, {
      question: 'Can invoices be paid in 14 days?',
    });
    expect(sq.statusCode).toBe(201);
    expect(
      ((await call('legal', 'GET', `/contracts/${d.id}/questions`)).json() as Json).questions.map(
        (x: Json) => x.side,
      ),
    ).toEqual(['INTERNAL', 'SUPPLIER']);
    expect((await call('legal', 'GET', `/contracts/${d.id}/signing`)).statusCode).toBe(200);
    // signing tells procurement and legal, and the reminders stop
    expect(
      (await call('delegate', 'POST', `/contracts/${d.id}/sign`, { decision: 'APPROVE' })).statusCode,
    ).toBe(200);
    expect(
      (
        await env.withSystem(env.database, (tx) =>
          tx
            .select()
            .from(s.notification)
            .where(eq(s.notification.userId, uid('user:procurement'))),
        )
      ).some((n) => n.title === 'Signing progress'),
    ).toBe(true);
    expect(
      ((await call('legal', 'POST', `/contracts/${d.id}/signing/remind`)).json() as Json).reminded,
    ).toEqual([]);
    // a contract the supplier is not party to does not exist for them
    const other = await env.draft();
    expect((await call('supplier', 'GET', `/supplier/contracts/${other.id}`)).statusCode).toBe(404);
  });
});

describe('FR-0450 the risk summary for the delegate', () => {
  it('is auto-populated, edited and reviewed by legal, and can be required before release', async () => {
    const d = await env.draft();
    await call('legal', 'PUT', `/contracts/${d.id}/clauses/IP`, {
      text: 'The Supplier waives nothing and owns all intellectual property created, without limit.',
    });
    expect((await call('evaluator-tech', 'GET', `/contracts/${d.id}/risk-summary`)).statusCode).toBe(403);
    const sum = (await call('delegate', 'GET', `/contracts/${d.id}/risk-summary`)).json() as Json;
    expect(sum.generated.model).toBe('rules-simulated-v1');
    expect(sum.generated.points.join(' ')).toMatch(/Intellectual property: changed from the template/);
    expect(sum.reviewedAt).toBeNull();
    expect((await call('delegate', 'GET', `/contracts/${d.id}/risk-summary?refresh=true`)).statusCode).toBe(
      403,
    );
    await rules({ requireRiskSummaryReview: true });
    await call('delegate', 'POST', `/contracts/${d.id}/deviations/IP/decision`, { decision: 'APPROVE' });
    const held = await release(d.id);
    expect(held.statusCode).toBe(422);
    expect(msgs(held)).toMatch(/Legal must review the contract risk summary/);
    expect(
      (
        await call('legal', 'PUT', `/contracts/${d.id}/risk-summary`, {
          text: 'Legal view: acceptable because the supplier owns only pre-existing property.',
        })
      ).json().edited,
    ).toMatch(/Legal view/);
    expect((await call('legal', 'POST', `/contracts/${d.id}/risk-summary/review`)).json().reviewedBy).toBe(
      'Henry Albright',
    );
    expect((await release(d.id)).statusCode).toBe(200);
    expect(await audit(d.id)).toEqual(
      expect.arrayContaining(['contract.risk_summary_edit', 'contract.risk_summary_review']),
    );
    await rules({});
  });
});

describe('FR-0460 variations are linked to their parent', () => {
  it('shows the parent, its variations and the cumulative value from either end', async () => {
    const parent = await env.executed({ value: 100_000 });
    const v = await call('legal', 'POST', `/contracts/${parent.id}/variations`, {
      reason: 'Add the second floor to the cleaning scope',
      value: 20_000,
    });
    expect(v.statusCode, v.body).toBe(201);
    const vid = v.json().id as string;
    const fromVariation = (await call('probity', 'GET', `/contracts/${vid}/lineage`)).json() as Json;
    expect(fromVariation.current).toMatchObject({ isVariation: true, parentNumber: parent.view.number });
    expect(fromVariation.root.id).toBe(parent.id);
    expect(fromVariation.cumulativeValue).toBe(100_000); // not yet executed
    await call('legal', 'POST', `/contracts/${vid}/release-for-signing`);
    await call('delegate', 'POST', `/contracts/${vid}/sign`, { decision: 'APPROVE' });
    const fromParent = (await call('legal', 'GET', `/contracts/${parent.id}/lineage`)).json() as Json;
    expect(fromParent.variations).toEqual([
      expect.objectContaining({ id: vid, status: 'EXECUTED', value: 20_000 }),
    ]);
    expect(fromParent.cumulativeValue).toBe(120_000);
    expect(fromParent.current.isVariation).toBe(false);
    expect((await call('requester', 'GET', `/contracts/${vid}/lineage`)).statusCode).toBe(403);
  });
});

describe('FR-0465 working on the draft together, and amended drafts', () => {
  it('legal edits live and procurement comments; the draft downloads, and an amended draft is uploaded as a numbered version', async () => {
    const d = await env.draft();
    expect(
      (await call('requester', 'POST', `/contracts/${d.id}/comments`, { body: 'Not for me to say' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', `/contracts/${d.id}/comments`, {
          body: 'Can we shorten the notice period?',
          clauseId: 'TERM',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call('legal', 'POST', `/contracts/${d.id}/comments`, { body: 'Yes, to 60 days.' })).statusCode,
    ).toBe(201);
    const edit = await call('legal', 'PUT', `/contracts/${d.id}/clauses/SLA`, {
      text: 'Response within 10 minutes for critical incidents.',
    });
    expect(edit.statusCode).toBe(200); // no generate-edit-regenerate cycle: the change is in the draft at once
    const comments = (await call('finance', 'GET', `/contracts/${d.id}/comments`)).json() as Json;
    expect(comments.comments.map((c: Json) => c.by)).toEqual(['Priya Nair', 'Henry Albright']);
    expect(
      (await call('legal', 'GET', `/contracts/${d.id}/export.docx`)).headers['content-disposition'],
    ).toMatch(/CT-\d{4}-\d{4}-v\d+\.docx/);
    expect(
      (await call('legal', 'GET', `/contracts/${d.id}/export.pdf`)).rawPayload.toString('latin1'),
    ).toMatch(/Response within 10 minutes/);
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('AMENDED-DRAFT-MARKER')]);
    expect(
      (
        await call('procurement', 'POST', `/contracts/${d.id}/drafts`, {
          fileName: 'amended.docx',
          contentBase64: docx.toString('base64'),
        })
      ).statusCode,
    ).toBe(403);
    const up = await call('legal', 'POST', `/contracts/${d.id}/drafts`, {
      fileName: 'amended.docx',
      contentBase64: docx.toString('base64'),
      note: 'Counterparty redline accepted',
    });
    expect(up.statusCode, up.body).toBe(201);
    const up2 = await call('legal', 'POST', `/contracts/${d.id}/drafts`, {
      fileName: 'amended-v2.docx',
      contentBase64: docx.toString('base64'),
    });
    expect(up2.json().version).toBe(2);
    expect(
      (
        await call('legal', 'POST', `/contracts/${d.id}/drafts`, {
          fileName: 'bad.docx',
          contentBase64: Buffer.from('not a docx').toString('base64'),
        })
      ).statusCode,
    ).toBe(400);
    const list = (await call('probity', 'GET', `/contracts/${d.id}/drafts`)).json() as Json;
    expect(list.drafts.map((x: Json) => x.version)).toEqual([2, 1]);
    const dl = await call('delegate', 'GET', `/contracts/${d.id}/drafts/${up.json().id}`);
    expect(dl.rawPayload.equals(docx)).toBe(true);
    expect(await audit(d.id)).toEqual(
      expect.arrayContaining(['contract.comment', 'contract.draft_upload', 'contract.draft_download']),
    );
    // an executed contract takes no more drafts
    const ex = await env.executed();
    expect(
      (
        await call('legal', 'POST', `/contracts/${ex.id}/drafts`, {
          fileName: 'late.docx',
          contentBase64: docx.toString('base64'),
        })
      ).statusCode,
    ).toBe(423);
  });
});

describe('FR-0470 and FR-0385 the legal knowledge base', () => {
  it('legal keeps policies, advice, corporate fallback positions and boilerplate; only legal and procurement read them', async () => {
    expect((await call('requester', 'GET', '/legal-knowledge')).statusCode).toBe(403);
    expect(
      (
        await call('procurement', 'POST', '/legal-knowledge', {
          kind: 'POLICY',
          title: 'Policy',
          body: 'x'.repeat(20),
        })
      ).statusCode,
    ).toBe(403);
    const fb = await call('legal', 'POST', '/legal-knowledge', {
      kind: 'FALLBACK',
      title: 'Liability cap fallback',
      body: 'Cap liability at twice the annual fees, and never below the insurance cover.',
      clauseId: 'LIABILITY',
      tags: 'liability cap indemnity',
    });
    expect(fb.statusCode, fb.body).toBe(201);
    await call('legal', 'POST', '/legal-knowledge', {
      kind: 'BOILERPLATE',
      title: 'Governing law',
      body: 'This agreement is governed by the laws of New South Wales.',
    });
    await call('legal', 'POST', '/legal-knowledge', {
      kind: 'ADVICE',
      title: 'Historical advice on uncapped indemnities',
      body: 'Past advice: never accept uncapped indemnities for data loss.',
      tags: 'indemnity uncapped',
    });
    const all = (await call('procurement', 'GET', '/legal-knowledge')).json() as Json;
    expect(all.items.map((i: Json) => i.kind).sort()).toEqual(['ADVICE', 'BOILERPLATE', 'FALLBACK']);
    expect(
      ((await call('legal', 'GET', '/legal-knowledge?kind=FALLBACK')).json() as Json).items,
    ).toHaveLength(1);
    const gone = await call('legal', 'POST', '/legal-knowledge', {
      kind: 'POLICY',
      title: 'Temporary',
      body: 'y'.repeat(20),
    });
    expect((await call('legal', 'DELETE', `/legal-knowledge/${gone.json().id}`)).statusCode).toBe(204);
    expect((await call('legal', 'DELETE', `/legal-knowledge/${gone.json().id}`)).statusCode).toBe(404);
  });
});

describe('FR-0475 deviations explained, rated in words and accepted', () => {
  it('explains what a deviation means with the fallback position, takes a rating in plain language, and records a formal acceptance of the risk', async () => {
    const d = await env.draft();
    await call('legal', 'PUT', `/contracts/${d.id}/clauses/LIABILITY`, {
      text: 'The Supplier is not liable for loss and its indemnity is unlimited in the Customer favour.',
    });
    const ex = (
      await call('delegate', 'POST', `/contracts/${d.id}/deviations/LIABILITY/explain`)
    ).json() as Json;
    expect(ex.model).toBe('rules-simulated-v1');
    expect(ex.whyItMatters.join(' ')).toMatch(/mandatory clause/);
    expect(ex.whyItMatters.join(' ')).toMatch(/gives up a right|limits the supplier/);
    expect(ex.suggestion).toMatch(/corporate fallback position is: Cap liability at twice the annual fees/);
    expect(ex.basedOn.join(' ')).toMatch(/fallback: Liability cap fallback/);
    expect(
      (await call('requester', 'POST', `/contracts/${d.id}/deviations/LIABILITY/explain`)).statusCode,
    ).toBe(403);
    expect((await call('legal', 'POST', `/contracts/${d.id}/deviations/PARTIES/explain`)).statusCode).toBe(
      404,
    );
    // legal amends the rating in words: read back first, applied on request
    const peek = (
      await call('legal', 'POST', `/contracts/${d.id}/deviations/LIABILITY/risk/plain`, {
        text: 'This is a minor point, acceptable to us',
      })
    ).json() as Json;
    expect(peek).toMatchObject({ applied: false, rating: 'LOW' });
    expect(((await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json).deviations[0].risk).not.toBe(
      'LOW',
    );
    await call('legal', 'POST', `/contracts/${d.id}/deviations/LIABILITY/risk/plain`, {
      text: 'On reflection this is serious',
      apply: true,
    });
    expect(((await call('legal', 'GET', `/contracts/${d.id}`)).json() as Json).deviations[0].risk).toBe(
      'HIGH',
    );
    expect(
      (
        await call('legal', 'POST', `/contracts/${d.id}/deviations/LIABILITY/risk/plain`, {
          text: 'Hmm, not sure',
          apply: true,
        })
      ).json().code,
    ).toBe('NOTHING_UNDERSTOOD');
    // the business or a delegate formally accepts the identified risk
    expect(
      (
        await call('legal', 'POST', `/contracts/${d.id}/deviations/LIABILITY/accept-risk`, {
          statement: 'We accept the risk',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('delegate', 'POST', `/contracts/${d.id}/deviations/LIABILITY/accept-risk`, {
          statement: 'ok',
        })
      ).statusCode,
    ).toBe(400);
    const acc = await call('contract-mgr', 'POST', `/contracts/${d.id}/deviations/LIABILITY/accept-risk`, {
      statement: 'The business accepts the residual risk for this contract',
    });
    expect(acc.statusCode, acc.body).toBe(200);
    const dev = (acc.json() as Json).deviations[0];
    expect(dev.acceptances).toEqual([
      expect.objectContaining({ by: 'Sofia Rossi', stamp: expect.stringMatching(/^RISK ACCEPTED/) }),
    ]);
    expect(dev.decision).toBeNull(); // an acceptance does not replace the delegate's decision on a high-risk change
    expect(await audit(d.id)).toContain('contract.risk_accepted');
  });
});

describe('FR-0485 the negotiation strategy', () => {
  it('gives framing, techniques, four graduated positions and levers, drawing on rival bids and the knowledge base', async () => {
    const d = await env.draft({ value: 120_000 });
    await env.withSystem(env.database, async (tx) => {
      const [sub] = await tx.select().from(s.submission).where(eq(s.submission.tenderId, d.tenderId));
      await tx
        .insert(s.bidPricing)
        .values({ tenantId: TENANT_ID, submissionId: sub!.id, basePrice: '120000', tco: '120000' });
      const [rival] = await tx
        .insert(s.submission)
        .values({
          tenantId: TENANT_ID,
          tenderId: d.tenderId,
          supplierId: uid('supplier:evergreen'),
          status: 'SUBMITTED',
          submittedAt: env.clock.now(),
        })
        .returning();
      await tx
        .insert(s.bidPricing)
        .values({ tenantId: TENANT_ID, submissionId: rival!.id, basePrice: '100000', tco: '100000' });
    });
    expect((await call('finance', 'GET', `/contracts/${d.id}/negotiation-strategy`)).statusCode).toBe(403);
    const r = (await call('legal', 'GET', `/contracts/${d.id}/negotiation-strategy`)).json() as Json;
    expect(r.model).toBe('rules-simulated-v1');
    expect(r.positions.map((p: Json) => p.level)).toEqual([
      'Minimum expected result',
      'Expected outcome',
      'Very good outcome',
      'Stretch target',
    ]);
    const prices = r.positions.map((p: Json) => p.price);
    expect(prices[0]).toBe(120_000);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => b - a)); // each position is a better result for the buyer
    expect(prices[3]).toBeLessThanOrEqual(100_000); // the stretch matches the best rival
    expect(r.techniques.join(' ')).toMatch(/rival bid was AUD 100,000/);
    expect(r.levers.map((l: Json) => l.lever)).toEqual([
      'Price',
      'Payment terms',
      'Limitation of liability',
      'Indemnities',
    ]);
    expect(r.framing).toMatch(/partnership|fixed-scope/);
    expect(await audit(d.id)).toContain('contract.negotiation_strategy');
  });
});

describe('FR-0385 native legal matters with review hours', () => {
  it('a kanban board of matters, moved between lanes, with review hours logged and totalled', async () => {
    const d = await env.draft();
    expect((await call('requester', 'GET', '/legal/matters')).statusCode).toBe(403);
    expect(
      (await call('procurement', 'POST', '/legal/matters', { title: 'Review the cleaning contract' }))
        .statusCode,
    ).toBe(403);
    const m = await call('legal', 'POST', '/legal/matters', {
      title: 'Review the cleaning contract',
      contractId: d.id,
      priority: 'HIGH',
      dueOn: '2026-12-01',
    });
    expect(m.statusCode, m.body).toBe(201);
    const id = m.json().id as string;
    const board = (await call('procurement', 'GET', '/legal/matters')).json() as Json;
    expect(board.lanes.map((l: Json) => l.lane)).toEqual(['NEW', 'IN_REVIEW', 'WAITING', 'DONE']);
    expect(board.lanes[0].matters[0]).toMatchObject({
      title: 'Review the cleaning contract',
      contractNumber: d.view.number,
      hours: 0,
      priority: 'HIGH',
    });
    const moved = (
      await call('legal', 'PATCH', `/legal/matters/${id}`, {
        lane: 'IN_REVIEW',
        assigneeId: uid('user:legal'),
      })
    ).json() as Json;
    expect(moved.lanes[1].matters[0]).toMatchObject({ assignee: 'Henry Albright' });
    expect((await call('legal', 'PATCH', `/legal/matters/${id}`, {})).statusCode).toBe(400);
    expect(
      (await call('legal', 'POST', `/legal/matters/${id}/time`, { hours: 0, workDate: '2026-10-05' }))
        .statusCode,
    ).toBe(400);
    await call('legal', 'POST', `/legal/matters/${id}/time`, {
      hours: 2.5,
      workDate: '2026-10-05',
      note: 'First read',
    });
    await call('legal', 'POST', `/legal/matters/${id}/time`, {
      hours: 1.25,
      workDate: '2026-10-06',
      note: 'Markup',
    });
    const time = (await call('procurement', 'GET', `/legal/matters/${id}/time`)).json() as Json;
    expect(time.totalHours).toBe(3.75);
    expect(time.entries.map((e: Json) => e.note).sort()).toEqual(['First read', 'Markup']);
    const after = (await call('legal', 'GET', '/legal/matters')).json() as Json;
    expect(after.lanes[1].matters[0].hours).toBe(3.75);
    expect(after.totalHours).toBeGreaterThanOrEqual(3.75);
    await call('legal', 'PATCH', `/legal/matters/${id}`, { lane: 'DONE' });
    expect(((await call('legal', 'GET', '/legal/matters')).json() as Json).lanes[3].matters).toHaveLength(1);
    expect(await audit(id)).toEqual(
      expect.arrayContaining(['legal.matter_create', 'legal.matter_update', 'legal.time_log']),
    );
  });
});

describe('FR-0435 time-bound access grants', () => {
  it('a grant opens one project’s documents and ends at its date or a set time after signing, with no job needed', async () => {
    const ex = await env.executed();
    // before any grant the requester sees no project
    expect(((await call('requester', 'GET', '/shared/projects')).json() as Json).projects).toEqual([]);
    expect((await call('requester', 'GET', `/shared/projects/${ex.tenderId}/contract.pdf`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await call('evaluator-tech', 'POST', '/access-grants', {
          userId: uid('user:requester'),
          tenderId: ex.tenderId,
          label: 'AUDITOR',
          event: 'CONTRACT_SIGNED',
          eventDays: 30,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('procurement', 'POST', '/access-grants', {
          userId: uid('user:requester'),
          tenderId: ex.tenderId,
          label: 'AUDITOR',
        })
      ).statusCode,
    ).toBe(400); // an end is required
    expect(
      (
        await call('procurement', 'POST', '/access-grants', {
          userId: uid('user:supplier'),
          tenderId: ex.tenderId,
          label: 'AUDITOR',
          event: 'CONTRACT_SIGNED',
        })
      ).statusCode,
    ).toBe(400);
    const g = await call('procurement', 'POST', '/access-grants', {
      userId: uid('user:requester'),
      tenderId: ex.tenderId,
      label: 'AUDITOR',
      event: 'CONTRACT_SIGNED',
      eventDays: 30,
    });
    expect(g.statusCode, g.body).toBe(201);
    const mine = ((await call('requester', 'GET', '/shared/projects')).json() as Json).projects;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      label: 'AUDITOR',
      live: true,
      documents: [expect.objectContaining({ kind: 'CONTRACT' })],
    });
    const pdf = await call('requester', 'GET', `/shared/projects/${ex.tenderId}/contract.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.toString('latin1')).toMatch(/Contract/);
    // only this project's documents, and never bid files
    expect(
      (await call('requester', 'GET', `/shared/projects/${uid('tender:other')}/contract.pdf`)).statusCode,
    ).toBe(404);
    expect((await call('requester', 'GET', `/contracts/${ex.id}`)).statusCode).toBe(403);
    // 29 days after signature it is still open; 31 days after, it has ended on its own and the end is audited
    env.clock.advanceDays(29);
    expect((await call('requester', 'GET', `/shared/projects/${ex.tenderId}/contract.pdf`)).statusCode).toBe(
      200,
    );
    env.clock.advanceDays(2);
    const ended = await call('requester', 'GET', `/shared/projects/${ex.tenderId}/contract.pdf`);
    expect(ended.statusCode).toBe(404);
    expect(ended.json().code).toBe('ACCESS_ENDED');
    const list = ((await call('procurement', 'GET', `/access-grants?tenderId=${ex.tenderId}`)).json() as Json)
      .grants;
    expect(list[0]).toMatchObject({
      live: false,
      revokedReason: expect.stringMatching(/event it waited on passed/),
    });
    expect(await audit(g.json().id)).toEqual(
      expect.arrayContaining(['access.grant', 'access.grant_expired']),
    );
    expect(
      ((await call('requester', 'GET', '/shared/projects')).json() as Json).projects[0].documents,
    ).toEqual([]);
  });

  it('can end on a date, be withdrawn by hand with a reason, and wait for the report to be approved', async () => {
    const ex = await env.executed();
    const tomorrow = new Date(env.clock.now().getTime() + 86_400_000).toISOString().slice(0, 10);
    const g = (
      await call('admin', 'POST', '/access-grants', {
        userId: uid('user:finance'),
        tenderId: ex.tenderId,
        label: 'COMMITTEE',
        expiresOn: tomorrow,
      })
    ).json();
    expect(((await call('finance', 'GET', '/shared/projects')).json() as Json).projects[0].live).toBe(true);
    env.clock.advanceDays(3);
    expect(((await call('finance', 'GET', '/shared/projects')).json() as Json).projects[0].live).toBe(false);
    expect(
      (await call('procurement', 'DELETE', `/access-grants/${g.id}`, { reason: 'Already ended by date' }))
        .statusCode,
    ).toBe(409);
    const open = (
      await call('procurement', 'POST', '/access-grants', {
        userId: uid('user:legal'),
        tenderId: ex.tenderId,
        label: 'ADVISOR',
        event: 'REPORT_APPROVED',
        eventDays: 0,
      })
    ).json();
    expect(((await call('legal', 'GET', '/shared/projects')).json() as Json).projects[0].live).toBe(true); // the report has not been approved yet
    expect(
      (await call('procurement', 'DELETE', `/access-grants/${open.id}`, { reason: 'x' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call('procurement', 'DELETE', `/access-grants/${open.id}`, {
          reason: 'The advisor finished early',
        })
      ).statusCode,
    ).toBe(204);
    expect(((await call('legal', 'GET', '/shared/projects')).json() as Json).projects[0].live).toBe(false);
    expect(await audit(open.id)).toContain('access.revoke');
    expect((await call('probity', 'GET', '/access-grants')).statusCode).toBe(200);
    expect(
      await env.withSystem(env.database, (tx) =>
        tx
          .select()
          .from(s.accessGrant)
          .where(and(eq(s.accessGrant.id, open.id))),
      ),
    ).toHaveLength(1);
  });
});
