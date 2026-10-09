import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { adjustDoc, ADJUST_PATTERNS, clausesOf } from './adjust.js';
import { generateDraft } from './generate.js';
import { diffDocs, renderContent } from './model.js';
import { normaliseSpoken } from './lang.js';

/** BCP module cpdraft: CP-04 (draft from voice or text, pre-populate) and CP-05 (plain-language adjustment, before/after, undo). */
const PRINT =
  'We need a managed print service for 40 sites, about $450k over 3 years, starting next March, must be hosted in Australia';
const CLEAN =
  'Facilities needs cleaning for 12 buildings, $90,000 a year for two years, contract owner Sofia Rossi, from 1 July 2027';
const TENDERISH =
  'We want a cloud HR platform for 800 staff, budget $1.2M over 5 years, ISO 27001 certified, 24x7 support, personal information is involved, incumbent supplier is being replaced';
const TODAY = new Date('2026-10-02T00:00:00Z');
const gen = (kind: Parameters<typeof generateDraft>[0]['kind'], text = PRINT) =>
  generateDraft({ kind, text, today: TODAY, organisation: 'Meridian' });
const adj = (g: ReturnType<typeof gen>, i: string) => adjustDoc(g.doc, g.sources, i, TODAY);

describe('CP-04 deterministic generation (engine)', () => {
  it('CP-04 extracts category, budget, term, start date, quantity and requirements from the managed print text', () => {
    const g = gen('REQUEST');
    expect(g.doc.fields).toMatchObject({
      title: 'Managed print service',
      category: 'Print and imaging services (UNSPSC 44100000)',
      estimatedValue: '450000',
      termMonths: '36',
      startDate: '2027-03-01',
      endDate: '2030-02-28',
      quantity: '40',
      quantityUnit: 'sites',
      supplyLocation: 'LOCAL',
    });
    const reqs = g.doc.sections
      .find((x) => x.key === 'requirements')!
      .items.map((i) => i.text)
      .join(' ');
    expect(reqs).toMatch(/hosted and stored in Australia/);
    // every field cites where it came from, with the text span for text-derived ones
    const src = (path: string) => g.sources.find((x) => x.path === path)!;
    expect(src('fields.estimatedValue')).toMatchObject({ kind: 'TEXT_SPAN', quote: '$450k' });
    expect(src('fields.termMonths')).toMatchObject({ kind: 'TEXT_SPAN', quote: '3 years' });
    expect(src('fields.startDate').quote).toBe('next March');
    expect(g.sources.some((x) => x.kind === 'TEMPLATE')).toBe(true);
    expect(g.sources.some((x) => x.kind === 'POLICY')).toBe(true);
    expect(g.missing).toEqual(['businessUnit', 'contractOwner']);
  });

  it('CP-04 reads a yearly figure over a term, a named owner and a dated start (cleaning text)', () => {
    const g = gen('REQUEST', CLEAN);
    expect(g.doc.fields).toMatchObject({
      estimatedValue: '180000',
      termMonths: '24',
      contractOwner: 'Sofia Rossi',
      startDate: '2027-07-01',
      endDate: '2029-06-30',
      quantity: '12',
      quantityUnit: 'buildings',
    });
    expect(g.doc.fields.businessUnit).toBe('Facilities');
  });

  it('CP-04 drafts every kind from the same text', () => {
    const kinds = ['REQUEST', 'PLAN', 'JOB_SPEC', 'TENDER_DOC', 'CONTRACT_DRAFT', 'EVAL_CRITERIA'] as const;
    for (const k of kinds) {
      const g = gen(k, TENDERISH);
      expect(g.doc.sections.length, k).toBeGreaterThan(1);
      expect(renderContent(g.doc), k).toContain(g.doc.fields.title!);
    }
    const spec = gen('JOB_SPEC', TENDERISH);
    expect(spec.doc.sections.map((x) => x.key)).toEqual([
      'background',
      'objectives',
      'scope',
      'requirements',
      'deliverables',
      'serviceLevels',
      'personnel',
      'timeline',
      'evaluationHints',
      'assumptions',
      'risks',
    ]);
    expect(spec.doc.fields).toMatchObject({
      estimatedValue: '1200000',
      termMonths: '60',
      quantity: '800',
      quantityUnit: 'staff',
    });
    const reqText = spec.doc.sections
      .find((x) => x.key === 'requirements')!
      .items.map((i) => i.text)
      .join(' ');
    expect(reqText).toMatch(/ISO\/IEC 27001/);
    expect(reqText).toMatch(/all hours/);
    expect(reqText).toMatch(/Privacy Act/);
    const plan = gen('PLAN', TENDERISH);
    expect(plan.doc.sections.map((x) => x.key)).toContain('approvalDelegate');
    const crit = gen('EVAL_CRITERIA', TENDERISH);
    const weights = crit.doc.sections.find((x) => x.key === 'criteria')!.items.map((i) => i.weight!);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('CP-04 a tender document never states the budget; a contract draft uses the clause library with mandatory clauses', () => {
    const t = gen('TENDER_DOC');
    expect(renderContent(t.doc)).not.toMatch(/450,000|\$450/);
    const c = gen('CONTRACT_DRAFT');
    const clauses = c.doc.sections.find((x) => x.key === 'clauses')!.items;
    expect(clauses.filter((x) => x.mandatory).map((x) => x.title)).toEqual(
      expect.arrayContaining(['Termination', 'Parties and purpose', 'Pricing and payment']),
    );
    expect(clauses.find((x) => x.title === 'Data sovereignty')).toBeTruthy();
    expect(clauses.find((x) => x.title === 'Pricing and payment')!.text).toContain('AUD 450,000');
    expect(c.warnings.join(' ')).toMatch(/placeholders/);
  });

  it('CP-04 spoken numbers read the same as typed ones', () => {
    expect(
      normaliseSpoken(
        'four hundred and fifty thousand dollars for forty sites over three years, sixty percent price',
      ),
    ).toBe('$450000 for 40 sites over 3 years, 60% price');
    const spoken = gen(
      'REQUEST',
      'We need a managed print service for forty sites, about four hundred and fifty thousand dollars over three years, starting next March, must be hosted in Australia',
    );
    expect(spoken.doc.fields.estimatedValue).toBe('450000');
    expect(spoken.doc.fields.quantity).toBe('40');
    expect(spoken.doc.fields.termMonths).toBe('36');
  });
});

describe('CP-05 adjustment patterns (engine): each gives a before/after diff', () => {
  const expectDiff = (g: ReturnType<typeof gen>, instruction: string, paths: RegExp) => {
    const r = adj(g, instruction);
    expect(r.ok, `${instruction}: ${r.ok ? '' : r.message}`).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    const diff = diffDocs(g.doc, r.doc);
    expect(
      diff.some((x) => paths.test(x.path)),
      `${instruction} -> ${diff.map((x) => x.path).join(',')}`,
    ).toBe(true);
    return { r, diff };
  };

  it('CP-05 weights: "make price 60% and quality 40%" sets the two and keeps the total at 100', () => {
    const g = gen('EVAL_CRITERIA');
    const { r, diff } = expectDiff(g, 'make price 60% and quality 40%', /\.weight$/);
    const items = r.ok ? r.doc.sections.find((x) => x.key === 'criteria')!.items : [];
    expect(items.find((i) => /Price/.test(i.title!))!.weight).toBe(60);
    expect(items.find((i) => /Quality/.test(i.title!))!.weight).toBe(40);
    expect(items.reduce((a, i) => a + (i.weight ?? 0), 0)).toBe(100);
    expect(diff.find((x) => /Price/.test(x.label) && /weight/.test(x.label))).toMatchObject({
      before: '30%',
      after: '60%',
    });
  });

  it('CP-05 weights: spoken order, relative change, equal weights, and refusals that say why', () => {
    const g = gen('EVAL_CRITERIA');
    const a = adj(g, '60% price and 40% quality');
    expect(a.ok).toBe(true);
    const rel = adj(g, 'increase the price weighting by 10 points');
    expect(rel.ok && rel.doc.sections[0]!.items.find((i) => /Price/.test(i.title!))!.weight).toBe(40);
    const eq = adj(g, 'weight all criteria equally');
    expect(eq.ok && eq.doc.sections[0]!.items.map((i) => i.weight)).toEqual([25, 25, 25, 25]);
    const over = adj(g, 'make price 70% and quality 40%');
    expect(over).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
    expect(!over.ok && over.message).toMatch(/110%/);
    const unknown = adj(g, 'make foo 50%');
    expect(!unknown.ok && unknown.message).toMatch(/could not find a criterion called “foo”/);
  });

  it('CP-05 criteria: add and remove a criterion rescales the others to 100', () => {
    const g = gen('EVAL_CRITERIA');
    const { r } = expectDiff(g, 'add a sustainability criterion at 10%', /criteria\./);
    const items = r.ok ? r.doc.sections[0]!.items : [];
    expect(items.map((i) => i.title)).toContain('Sustainability and social value');
    expect(items.reduce((a, i) => a + (i.weight ?? 0), 0)).toBe(100);
    const rem = adj(g, 'remove the experience criterion');
    expect(rem.ok && rem.doc.sections[0]!.items.reduce((a, i) => a + (i.weight ?? 0), 0)).toBe(100);
  });

  it('CP-05 requirements: add (standard and own wording), remove by number and by topic, replace', () => {
    const g = gen('JOB_SPEC', CLEAN);
    const n0 = g.doc.sections.find((x) => x.key === 'requirements')!.items.length;
    const added = expectDiff(g, 'add a data-sovereignty requirement', /sections\.requirements\./);
    expect(
      added.r.ok && added.r.doc.sections.find((x) => x.key === 'requirements')!.items.at(-1)!.text,
    ).toMatch(/hosted and stored in Australia/);
    const own = adj(g, 'add requirement: staff must wear a uniform');
    expect(own.ok && own.doc.sections.find((x) => x.key === 'requirements')!.items.at(-1)!.text).toBe(
      'Staff must wear a uniform.',
    );
    const g2 = gen('JOB_SPEC');
    const removedTopic = expectDiff(
      g2,
      'remove the data sovereignty requirement',
      /sections\.requirements\./,
    );
    expect(removedTopic.diff.some((x) => x.change === 'REMOVED')).toBe(true);
    const rn = adj(g, 'remove requirement 1');
    expect(rn.ok && rn.doc.sections.find((x) => x.key === 'requirements')!.items.length).toBe(n0 - 1);
    const rp = adj(g, 'replace requirement 2 with: the supplier must report monthly');
    expect(rp.ok && rp.doc.sections.find((x) => x.key === 'requirements')!.items[1]!.text).toBe(
      'The supplier must report monthly.',
    );
    expect(adj(g, 'remove requirement 99')).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
    expect(adj(g, 'add a frobnicator requirement')).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
  });

  it('CP-05 clauses: add from the library, mandatory clauses cannot be removed, replace wording', () => {
    const g = gen('CONTRACT_DRAFT');
    expectDiff(g, 'add a step-in rights clause', /sections\.clauses\./);
    const m = adj(g, 'remove the termination clause');
    expect(m).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
    expect(!m.ok && m.message).toMatch(/mandatory/);
    expectDiff(g, 'remove the IP clause', /sections\.clauses\./);
    const rp = adj(g, 'replace the termination clause with: either party may terminate on 60 days notice');
    expect(
      rp.ok &&
        rp.doc.sections.find((x) => x.key === 'clauses')!.items.find((i) => i.title === 'Termination')!.text,
    ).toBe('Either party may terminate on 60 days notice.');
    expectDiff(g, 'set the notice period to 60 days', /fields\.noticeDays/);
  });

  it('CP-05 budget, quantity and dates follow into every sentence that quotes them', () => {
    const g = gen('JOB_SPEC');
    const b = expectDiff(g, 'change the budget to 600k', /fields\.estimatedValue/);
    expect(renderContent(b.r.ok ? b.r.doc : g.doc)).toContain('AUD 600,000');
    expect(renderContent(b.r.ok ? b.r.doc : g.doc)).not.toContain('AUD 450,000');
    const pct = adj(g, 'increase the budget by 10%');
    expect(pct.ok && pct.doc.fields.estimatedValue).toBe('495000');
    const q = expectDiff(g, 'change the number of sites to 60', /fields\.quantity/);
    expect(renderContent(q.r.ok ? q.r.doc : g.doc)).toContain('60 sites');
    const d1 = expectDiff(g, 'start on 1 July 2027', /fields\.startDate/);
    expect(d1.r.ok && d1.r.doc.fields.endDate).toBe('2030-06-30');
    const d2 = adj(g, 'move the start date back two weeks');
    expect(d2.ok && d2.doc.fields.startDate).toBe('2027-03-15');
    const t = adj(g, 'set the term to 24 months');
    expect(t.ok && t.doc.fields.endDate).toBe('2029-02-28');
    expect(adj(g, 'set the closing date to 15 December 2026').ok).toBe(true);
    expect(adj(g, 'change the budget to lots')).toMatchObject({ ok: false });
    const tender = gen('TENDER_DOC');
    const refused = adj(tender, 'change the budget to 500k');
    expect(!refused.ok && refused.message).toMatch(/never states the budget/);
  });

  it('CP-05 shorten, expand, tone, reorder, text edits, risks and fields', () => {
    const g = gen('JOB_SPEC');
    expectDiff(g, 'shorten the background', /sections\.background\./);
    expectDiff(g, 'expand the scope', /sections\.scope\./);
    const exp1 = adj(g, 'expand the scope');
    const exp2 = exp1.ok ? adjustDoc(exp1.doc, exp1.sources, 'expand the scope', TODAY) : exp1;
    const exp3 = exp2.ok ? adjustDoc(exp2.doc, exp2.sources, 'expand the scope', TODAY) : exp2;
    expect(exp3).toMatchObject({ ok: false, reason: 'NO_CHANGE' });
    const formal = gen('CONTRACT_DRAFT');
    const plain = expectDiff(formal, 'make it plainer', /sections\.clauses\./);
    expect(plain.r.ok && plain.r.doc.tone).toBe('PLAIN');
    expect(renderContent(plain.r.ok ? plain.r.doc : formal.doc)).not.toMatch(/\bterminate\b/);
    const order = expectDiff(g, 'move the timeline before the scope', /doc\.sectionOrder/);
    expect(order.r.ok && order.r.doc.sections.findIndex((x) => x.key === 'timeline')).toBeLessThan(
      order.r.ok ? order.r.doc.sections.findIndex((x) => x.key === 'scope') : 0,
    );
    expectDiff(g, 'swap scope and deliverables', /doc\.sectionOrder/);
    expectDiff(g, 'put risks first', /doc\.sectionOrder/);
    expectDiff(g, 'move requirement 3 to the top', /requirements\.__order/);
    expectDiff(g, 'add to the scope: include after-hours cover', /sections\.scope\./);
    expectDiff(
      g,
      'replace paragraph 1 of the background with: A new view of the need',
      /sections\.background\./,
    );
    expectDiff(g, 'remove paragraph 2 of the scope', /sections\.scope\./);
    const risk = expectDiff(g, 'add a risk: key person dependency', /sections\.risks\./);
    expect(risk.r.ok && risk.r.doc.sections.find((x) => x.key === 'risks')!.items.at(-1)!.text).toMatch(
      /Level: Medium/,
    );
    const own = adj(g, 'add a risk: the building may not be ready');
    expect(own.ok && own.doc.sections.find((x) => x.key === 'risks')!.items.at(-1)!.text).toBe(
      'The building may not be ready. Level: to be assessed. Mitigation: to be agreed.',
    );
    expectDiff(g, 'remove risk 1', /sections\.risks\./);
    expectDiff(g, 'set the business unit to Facilities', /fields\.businessUnit/);
    expect(adj(g, 'set the business unit to Narnia')).toMatchObject({ ok: false });
  });

  it('CP-05 compound instructions apply in order and refuse as a whole when one part fails', () => {
    const g = gen('JOB_SPEC');
    expect(clausesOf('change the budget to 500k; start on 1 July 2027')).toHaveLength(2);
    const r = adj(g, 'change the budget to 500k; start on 1 July 2027');
    expect(r.ok && [r.doc.fields.estimatedValue, r.doc.fields.startDate]).toEqual(['500000', '2027-07-01']);
    const bad = adj(g, 'change the budget to 500k; paint it blue');
    expect(bad).toMatchObject({ ok: false, reason: 'NOT_UNDERSTOOD' });
  });

  it('CP-05 an instruction outside the documented patterns is "I could not apply that" with examples, never a guess', () => {
    const g = gen('REQUEST');
    for (const i of ['paint the office blue', 'make it better', 'do the needful']) {
      const r = adj(g, i);
      expect(r).toMatchObject({ ok: false, reason: 'NOT_UNDERSTOOD' });
      expect(!r.ok && r.message).toMatch(/^I could not apply that/);
      expect(!r.ok && r.message).toMatch(/make price 60% and quality 40%/);
    }
    expect(ADJUST_PATTERNS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('CP-04 CP-05 drafting routes', () => {
  let env: Awaited<ReturnType<typeof createEnv>>;
  const call = (...a: Parameters<typeof env.call>) => env.call(...a);
  beforeAll(async () => {
    env = await createEnv();
  }, 120_000);
  const draft = async (who: string, body: Json) => {
    const r = await call(who, 'POST', '/copilot/draft', body);
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as Json;
  };
  const auditActions = async () =>
    (
      await env.withSystem(env.database, (tx) => tx.select({ a: s.auditEvent.action }).from(s.auditEvent))
    ).map((x) => x.a);

  it('CP-04 POST /copilot/draft returns fields, content, sources, engine and revision 1 (SIMULATED rules-simulated-v1)', async () => {
    const d = await draft('requester', { kind: 'REQUEST', text: PRINT, source: 'TEXT' });
    expect(d).toMatchObject({ kind: 'REQUEST', engine: 'rules-simulated-v1', revision: 1, simulated: true });
    expect(d.fields).toMatchObject({ estimatedValue: '450000', termMonths: '36', startDate: '2027-03-01' });
    expect(d.content).toContain('# Procurement request');
    expect(d.sources.length).toBeGreaterThan(5);
    expect(d.adjustExamples.length).toBeGreaterThan(3);
    expect(d.missing).toEqual(['businessUnit', 'contractOwner']);
  });

  it('CP-04 voice-sourced text behaves identically to typed text', async () => {
    const t = await draft('requester', { kind: 'JOB_SPEC', text: PRINT, source: 'TEXT' });
    const v = await draft('requester', { kind: 'JOB_SPEC', text: PRINT, source: 'VOICE' });
    expect(v.source).toBe('VOICE');
    expect(v.fields).toEqual(t.fields);
    expect(v.content).toBe(t.content);
    const ta = (
      await call('requester', 'POST', `/copilot/draft/${t.id}/adjust`, {
        instruction: 'change the budget to 500k',
      })
    ).json();
    const va = (
      await call('requester', 'POST', `/copilot/draft/${v.id}/adjust`, {
        instruction: 'change the budget to 500k',
        source: 'VOICE',
      })
    ).json();
    expect(va.diff).toEqual(ta.diff);
    const actions = await env.withSystem(env.database, (tx) =>
      tx.select({ a: s.auditEvent.after, x: s.auditEvent.action }).from(s.auditEvent),
    );
    expect(actions.some((x) => x.x === 'copilot.draft_create' && (x.a as Json).source === 'VOICE')).toBe(
      true,
    );
  });

  it('CP-05 adjust returns a new revision with the field-level diff, GET shows it, undo restores the previous content', async () => {
    const d = await draft('requester', { kind: 'EVAL_CRITERIA', text: PRINT });
    const a = (
      await call('requester', 'POST', `/copilot/draft/${d.id}/adjust`, {
        instruction: 'make price 60% and quality 40%',
      })
    ).json();
    expect(a).toMatchObject({ applied: true, revision: 2 });
    expect(a.diff.find((x: Json) => /Price/.test(x.label) && /weight/.test(x.label))).toMatchObject({
      before: '30%',
      after: '60%',
      change: 'CHANGED',
    });
    expect(a.sources.some((x: Json) => x.kind === 'INSTRUCTION')).toBe(true);
    const b = (
      await call('requester', 'POST', `/copilot/draft/${d.id}/adjust`, {
        instruction: 'add a sustainability criterion at 10%',
      })
    ).json();
    expect(b.revision).toBe(3);
    const revs = (await call('requester', 'GET', `/copilot/draft/${d.id}/revisions`)).json();
    expect(revs.revisions.map((r: Json) => [r.revision, r.action])).toEqual([
      [3, 'ADJUST'],
      [2, 'ADJUST'],
      [1, 'GENERATE'],
    ]);
    expect(revs.revisions[0].instruction).toBe('add a sustainability criterion at 10%');
    const u = (await call('requester', 'POST', `/copilot/draft/${d.id}/undo`)).json();
    expect(u).toMatchObject({ applied: true, revision: 4 });
    expect(u.content).toBe(a.content);
    const u2 = (await call('requester', 'POST', `/copilot/draft/${d.id}/undo`)).json();
    expect(u2.content).toBe(d.content);
    const none = await call('requester', 'POST', `/copilot/draft/${d.id}/undo`);
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('NOTHING_TO_UNDO');
    const cur = (await call('requester', 'GET', `/copilot/draft/${d.id}`)).json();
    expect(cur.content).toBe(d.content);
    const old = (await call('requester', 'GET', `/copilot/draft/${d.id}?revision=2`)).json();
    expect(old.content).toBe(a.content);
  });

  it('CP-05 an unsupported instruction returns "I could not apply that" with examples and creates no revision', async () => {
    const d = await draft('requester', { kind: 'REQUEST', text: PRINT });
    const r = await call('requester', 'POST', `/copilot/draft/${d.id}/adjust`, {
      instruction: 'make the logo bigger',
    });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ applied: false, reason: 'NOT_UNDERSTOOD', revision: 1 });
    expect(j.message).toMatch(/^I could not apply that/);
    expect(j.examples.length).toBeGreaterThan(3);
    const revs = (await call('requester', 'GET', `/copilot/draft/${d.id}/revisions`)).json();
    expect(revs.revisions).toHaveLength(1);
  });

  it('CP-04 a draft belongs to its author and its tenant: another person gets 404, another tenant sees no rows (RLS)', async () => {
    const d = await draft('requester', { kind: 'REQUEST', text: PRINT });
    expect((await call('procurement', 'GET', `/copilot/draft/${d.id}`)).statusCode).toBe(404);
    expect(
      (
        await call('procurement', 'POST', `/copilot/draft/${d.id}/adjust`, {
          instruction: 'shorten the background',
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('procurement', 'POST', `/copilot/draft/${d.id}/apply`, {})).statusCode).toBe(404);
    const list = (await call('procurement', 'GET', '/copilot/draft')).json();
    expect(list.some((x: Json) => x.id === d.id)).toBe(false);
    const other = '00000000-0000-4000-8000-0000000000aa';
    const rows = await withContext(
      env.database,
      { tenantId: other, userId: null, role: null },
      async (tx) => [...(await tx.select().from(s.cpDraft)), ...(await tx.select().from(s.cpDraftRevision))],
    );
    expect(rows).toHaveLength(0);
    const mine = await withContext(
      env.database,
      {
        tenantId: s.cpDraft
          ? (
              await env.withSystem(env.database, (tx) =>
                tx.select({ t: s.cpDraft.tenantId }).from(s.cpDraft).limit(1),
              )
            )[0]!.t
          : other,
        userId: null,
        role: null,
      },
      (tx) => tx.select().from(s.cpDraft).where(eq(s.cpDraft.id, d.id)),
    );
    expect(mine).toHaveLength(1);
  });

  it('CP-04 roles: an evaluator cannot draft, and the routes need a signed-in user', async () => {
    expect(
      (await call('evaluator-tech', 'POST', '/copilot/draft', { kind: 'REQUEST', text: PRINT })).statusCode,
    ).toBe(403);
    expect(
      (await call('supplier', 'POST', '/copilot/draft', { kind: 'REQUEST', text: PRINT })).statusCode,
    ).toBe(403);
    const bad = await call('requester', 'POST', '/copilot/draft', { kind: 'NOPE', text: PRINT });
    expect(bad.statusCode).toBe(400);
  });

  it('CP-04 apply (REQUEST): creates a real request through the normal route, then updates it; a role the route refuses is refused', async () => {
    const d = await draft('requester', {
      kind: 'REQUEST',
      text: `${PRINT}, contract owner Sofia Rossi, for Facilities`,
    });
    const r = await call('requester', 'POST', `/copilot/draft/${d.id}/apply`, {});
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ applied: true, target: 'REQUEST', created: true });
    const rec = (await call('requester', 'GET', `/requests/${j.targetId}`)).json();
    expect(rec).toMatchObject({
      title: 'Managed print service',
      estimatedValue: 450000,
      termMonths: 36,
      businessUnit: 'Facilities',
      status: 'DRAFT',
    });
    expect(rec.fields.find((f: Json) => f.key === 'background').value).toContain('managed print service');
    expect(rec.fields.find((f: Json) => f.key === 'contractOwner').value).toBe('Sofia Rossi');
    expect(j.changes.map((c: Json) => c.field)).toEqual(
      expect.arrayContaining(['title', 'estimatedValue', 'background']),
    );
    // adjust, then apply to the same record
    await call('requester', 'POST', `/copilot/draft/${d.id}/adjust`, {
      instruction: 'change the budget to 500k',
    });
    const again = await call('requester', 'POST', `/copilot/draft/${d.id}/apply`, {
      procurementId: j.targetId,
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(
      again
        .json()
        .changes.map((c: Json) => c.field)
        .sort(),
    ).toEqual(['background', 'estimatedValue']);
    expect(again.json().changes.find((c: Json) => c.field === 'estimatedValue')).toEqual({
      field: 'estimatedValue',
      before: 450000,
      after: 500000,
    });
    // role refused: legal may draft but may not edit a request
    const ld = await draft('legal', { kind: 'REQUEST', text: PRINT, procurementId: j.targetId });
    const denied = await call('legal', 'POST', `/copilot/draft/${ld.id}/apply`, {});
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('FORBIDDEN');
    // wrong state: a submitted request can no longer be edited
    expect((await call('requester', 'POST', `/requests/${j.targetId}/submit`)).statusCode).toBe(200);
    const late = await call('requester', 'POST', `/copilot/draft/${d.id}/apply`, {
      procurementId: j.targetId,
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('REQUEST_NOT_EDITABLE');
    const acts = await auditActions();
    expect(acts).toEqual(
      expect.arrayContaining([
        'copilot.draft_apply',
        'copilot.draft_apply_refused',
        'copilot.draft_create',
        'copilot.draft_adjust',
      ]),
    );
  });

  async function submitted(title: string) {
    const c = await call('requester', 'POST', '/requests', {
      title,
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: 90_000,
      termMonths: 24,
      businessUnit: 'Facilities',
      fields: { contractOwner: 'Sofia Rossi', background: 'Existing arrangements end in six months.' },
    });
    expect(c.statusCode, c.body).toBe(201);
    expect((await call('requester', 'POST', `/requests/${c.json().id}/submit`)).statusCode).toBe(200);
    return c.json().id as string;
  }

  it('CP-04 apply (PLAN): writes plan sections through the plan routes; a role the route refuses and a locked plan are refused', async () => {
    const id = await submitted('Plan apply');
    const d = await draft('procurement', {
      kind: 'PLAN',
      text: 'Cleaning for 12 buildings, must be hosted in Australia, ISO 27001',
      procurementId: id,
    });
    expect(d.sections ?? d.doc.sections.map((x: Json) => x.key)).toContain('risks');
    await call('procurement', 'POST', `/copilot/draft/${d.id}/adjust`, {
      instruction: 'add a risk: supplier insolvency',
    });
    const r = await call('procurement', 'POST', `/copilot/draft/${d.id}/apply`, {
      sections: ['risks', 'requirements'],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(
      r
        .json()
        .changes.map((c: Json) => c.field)
        .sort(),
    ).toEqual(['requirements', 'risks']);
    const plan = (await call('procurement', 'GET', `/requests/${id}/plan`)).json();
    expect(plan.fields.find((f: Json) => f.key === 'risks').value).toContain('Supplier insolvency');
    expect(plan.fields.find((f: Json) => f.key === 'risks').source).toBe('USER');
    // role refused: legal can open the plan and draft, but not edit it
    const ld = await draft('legal', { kind: 'PLAN', text: 'Cleaning', procurementId: id });
    const denied = await call('legal', 'POST', `/copilot/draft/${ld.id}/apply`, {});
    expect(denied.statusCode).toBe(403);
    // wrong state: an approved, locked plan
    await env.withSystem(env.database, (tx) =>
      tx.update(s.plan).set({ status: 'APPROVED_LOCKED', locked: true }).where(eq(s.plan.requestId, id)),
    );
    await call('procurement', 'POST', `/copilot/draft/${d.id}/adjust`, { instruction: 'add a risk: fraud' });
    const locked = await call('procurement', 'POST', `/copilot/draft/${d.id}/apply`, { sections: ['risks'] });
    expect(locked.statusCode).toBe(423);
    expect(locked.json().code).toBe('PLAN_LOCKED');
  });

  it('CP-04 apply (REPOSITORY): files a Word document in the project site; a second apply is the next version; a role refused', async () => {
    const en = await call('admin', 'PUT', '/connectors/DOCREPO', {
      provider: 'SHAREPOINT',
      enabled: true,
      mode: 'UP',
    });
    expect(en.statusCode, en.body).toBe(200);
    const id = await submitted('Repository apply');
    const d = await draft('procurement', { kind: 'JOB_SPEC', text: PRINT, procurementId: id });
    const r1 = await call('procurement', 'POST', `/copilot/draft/${d.id}/apply`, {});
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json().file).toMatchObject({ folder: 'Tender', name: 'job-specification.docx', version: 1 });
    await call('procurement', 'POST', `/copilot/draft/${d.id}/adjust`, {
      instruction: 'change the budget to 500k',
    });
    const r2 = await call('procurement', 'POST', `/copilot/draft/${d.id}/apply`, {});
    expect(r2.json().file.version).toBe(2);
    const dl = await call(
      'procurement',
      'GET',
      `/repository/projects/${id}/files/Tender/job-specification.docx/download`,
    );
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.subarray(0, 2).toString()).toBe('PK');
    // an executive can draft but the repository does not let that role write
    const ed = await draft('exec', { kind: 'JOB_SPEC', text: PRINT, procurementId: id });
    const denied = await call('exec', 'POST', `/copilot/draft/${ed.id}/apply`, {});
    expect(denied.statusCode).toBe(403);
    // a draft that needs a record is refused without one
    const none = await call(
      'procurement',
      'POST',
      `/copilot/draft/${(await draft('procurement', { kind: 'JOB_SPEC', text: PRINT })).id}/apply`,
      {},
    );
    expect(none.statusCode).toBe(422);
  });

  it('CP-04 draft from a record: the record supplies the facts the text does not (cited as RECORD)', async () => {
    const id = await submitted('Record draft');
    const d = await draft('procurement', {
      kind: 'JOB_SPEC',
      text: 'Please prepare the scope of work',
      procurementId: id,
    });
    expect(d.fields).toMatchObject({
      category: 'Building cleaning (UNSPSC 76111500)',
      estimatedValue: '90000',
      termMonths: '24',
      businessUnit: 'Facilities',
      contractOwner: 'Sofia Rossi',
    });
    expect(d.sources.find((x: Json) => x.path === 'fields.estimatedValue').kind).toBe('RECORD');
    expect(
      (
        await call('requester', 'POST', '/copilot/draft', {
          kind: 'JOB_SPEC',
          text: PRINT,
          procurementId: '3f2b8c1e-0000-4000-8000-000000000001',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('CP-04 prepopulate suggests values with a reason and a source, and writes nothing', async () => {
    const c = await call('requester', 'POST', '/requests', { title: 'Untitled request' });
    const id = c.json().id as string;
    const p = await call('requester', 'POST', '/copilot/prepopulate', {
      procurementId: id,
      stage: 'REQUEST',
      text: CLEAN,
    });
    expect(p.statusCode, p.body).toBe(200);
    const j = p.json();
    const byField = (f: string) => j.suggestions.find((x: Json) => x.field === f);
    expect(byField('estimatedValue')).toMatchObject({
      value: '180000',
      confidence: 'HIGH',
      source: { kind: 'TEXT_SPAN' },
    });
    expect(byField('estimatedValue').reason).toMatch(/\$90,000/);
    expect(byField('termMonths').value).toBe('24');
    expect(byField('contractOwner').value).toBe('Sofia Rossi');
    expect(byField('background').source.kind).toBe('TEXT_SPAN');
    expect((await call('requester', 'GET', `/requests/${id}`)).json().estimatedValue).toBe(0);
    // in-house history: earlier requests in the same category suggest a term when the text gives none
    const hist = await call('requester', 'POST', '/copilot/prepopulate', {
      procurementId: id,
      stage: 'REQUEST',
      text: 'We need building cleaning',
    });
    const term = hist.json().suggestions.find((x: Json) => x.field === 'termMonths');
    expect(term).toMatchObject({ source: { kind: 'HISTORY' }, confidence: 'LOW' });
    expect(hist.json().history.count).toBeGreaterThan(0);
    const sub = await submitted('Prepopulate plan');
    const plan = await call('procurement', 'POST', '/copilot/prepopulate', {
      procurementId: sub,
      stage: 'PLAN',
      text: 'Cleaning, must be hosted in Australia, ISO 27001 certified',
    });
    expect(plan.statusCode, plan.body).toBe(200);
    const req = plan.json().suggestions.find((x: Json) => x.field === 'requirements');
    expect(req.reason).toMatch(/Raised by/);
    const tender = await call('procurement', 'POST', '/copilot/prepopulate', {
      procurementId: sub,
      stage: 'TENDER',
      text: 'Cleaning for 12 buildings',
    });
    expect(tender.statusCode).toBe(200);
    expect(tender.json().suggestions.length).toBeGreaterThan(3);
    expect(
      (
        await call('requester', 'POST', '/copilot/prepopulate', {
          procurementId: '3f2b8c1e-0000-4000-8000-000000000001',
          stage: 'REQUEST',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call('evaluator-tech', 'POST', '/copilot/prepopulate', { procurementId: id, stage: 'REQUEST' }))
        .statusCode,
    ).toBe(403);
  });

  it('CP-05 audit: every create, adjust, refused adjust, undo and apply is in the audit trail as the user, labelled Procurement Copilot', async () => {
    const acts = await env.withSystem(env.database, (tx) =>
      tx
        .select({ a: s.auditEvent.action, x: s.auditEvent.after, u: s.auditEvent.actorId })
        .from(s.auditEvent),
    );
    for (const k of [
      'copilot.draft_create',
      'copilot.draft_adjust',
      'copilot.draft_adjust_refused',
      'copilot.draft_undo',
      'copilot.draft_apply',
      'copilot.prepopulate',
    ])
      expect(
        acts.some((x) => x.a === k),
        k,
      ).toBe(true);
    expect(
      acts
        .filter((x) => x.a.startsWith('copilot.'))
        .every((x) => x.u && (x.x as Json).via === 'Procurement Copilot'),
    ).toBe(true);
    expect((await env.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
