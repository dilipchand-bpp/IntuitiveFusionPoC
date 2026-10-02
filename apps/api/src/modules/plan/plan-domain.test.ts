import { describe, expect, it } from 'vitest';
import { MockAiProvider } from '../../adapters/ai-provider.js';
import { PLAN_FIELDS, joinParagraphs, splitParagraphs } from './fields.js';
import { draftPlan } from './generate.js';
import { applyIntent, findField, parseInstruction } from './instructions.js';
import { summarisePlan } from './summary.js';

const BG = joinParagraphs([
  'First paragraph.',
  'Second paragraph.',
  'Third paragraph.',
  'Fourth paragraph.',
  'Fifth paragraph.',
]);

describe('paragraph handling', () => {
  it('splits on blank lines, trims, and ignores empties', () => {
    expect(splitParagraphs('a\n\n\n b \n\n')).toEqual(['a', 'b']);
    expect(splitParagraphs(null)).toEqual([]);
    expect(joinParagraphs(['a', 'b'])).toBe('a\n\nb');
  });
});

describe('findField', () => {
  it('finds a field by its everyday names, preferring the longest match', () => {
    expect(findField('change the evaluation committee')?.key).toBe('evaluationCommittee');
    expect(findField('update the risks')?.key).toBe('risks');
    expect(findField('tweak the due diligence section')?.key).toBe('dueDiligence');
    expect(findField('something unrelated')).toBeNull();
  });
});

describe('parseInstruction', () => {
  it('"change paragraph 3 of the background to X" replaces exactly that paragraph', () => {
    const p = parseInstruction('change paragraph 3 of the background to cover transition risk');
    expect(p).toEqual({
      ok: true,
      intent: { op: 'replaceParagraph', key: 'background', n: 3, text: 'Cover transition risk' },
    });
  });
  it('accepts the field first, quotes, and "replace/rewrite" wording', () => {
    const p = parseInstruction(
      'In the risks section, replace paragraph 2 with "Insolvency of the incumbent"',
    );
    expect(p).toMatchObject({
      ok: true,
      intent: { op: 'replaceParagraph', key: 'risks', n: 2, text: 'Insolvency of the incumbent' },
    });
  });
  it('add, remove and replace-all', () => {
    expect(parseInstruction('add to the risks: supplier insolvency')).toMatchObject({
      ok: true,
      intent: { op: 'addParagraph', key: 'risks', text: 'Supplier insolvency' },
    });
    expect(parseInstruction('remove paragraph 2 of the deliverables')).toMatchObject({
      ok: true,
      intent: { op: 'removeParagraph', key: 'deliverables', n: 2 },
    });
    expect(parseInstruction('set the timeline to Award in March')).toMatchObject({
      ok: true,
      intent: { op: 'replaceAll', key: 'timeline', text: 'Award in March' },
    });
  });
  it('never guesses: a missing field, paragraph or wording yields a helpful hint', () => {
    expect(parseInstruction('change paragraph 2 to something')).toMatchObject({
      ok: false,
      hint: expect.stringContaining('Paragraph 2 of which section'),
    });
    expect(parseInstruction('remove the risks')).toMatchObject({
      ok: false,
      hint: expect.stringContaining('Which paragraph'),
    });
    expect(parseInstruction('change paragraph 2 of the risks')).toMatchObject({
      ok: false,
      hint: expect.stringContaining('What should paragraph 2 say'),
    });
    expect(parseInstruction('make it better')).toMatchObject({ ok: false });
    expect(parseInstruction('   ')).toMatchObject({ ok: false });
  });
});

describe('applyIntent', () => {
  it('replaces only the named paragraph and leaves the rest byte-identical', () => {
    const out = applyIntent({ op: 'replaceParagraph', key: 'background', n: 3, text: 'NEW' }, BG);
    expect(splitParagraphs(out)).toEqual([
      'First paragraph.',
      'Second paragraph.',
      'NEW',
      'Fourth paragraph.',
      'Fifth paragraph.',
    ]);
  });
  it('add appends; remove deletes; replace-all replaces', () => {
    expect(splitParagraphs(applyIntent({ op: 'addParagraph', key: 'x', text: 'Six' }, BG))).toHaveLength(6);
    expect(splitParagraphs(applyIntent({ op: 'removeParagraph', key: 'x', n: 1 }, BG))[0]).toBe(
      'Second paragraph.',
    );
    expect(applyIntent({ op: 'replaceAll', key: 'x', text: 'only' }, BG)).toBe('only');
  });
  it('a paragraph that does not exist is an error naming how many there are', () => {
    expect(() => applyIntent({ op: 'replaceParagraph', key: 'x', n: 9, text: 'a' }, BG)).toThrow(
      /no paragraph 9; this section has 5/,
    );
    expect(() => applyIntent({ op: 'removeParagraph', key: 'x', n: 0 }, BG)).toThrow(RangeError);
  });
});

describe('draftPlan (simulated drafting)', () => {
  const values = {
    title: 'Facilities cleaning services',
    category: 'Building cleaning (UNSPSC 76111500)',
    estimatedValue: '1200000',
    termMonths: '36',
    businessUnit: 'Facilities',
    contractOwner: 'Sofia Rossi',
    background: 'Existing arrangements end in six months.',
  };
  const draft = draftPlan({
    values,
    complexity: 'HIGH',
    gateKeys: ['RISK_SIGNOFF', 'UPFRONT_COI', 'LEGAL_REVIEW'],
    today: new Date('2026-10-02T00:00:00Z'),
  });
  it('fills every section and keeps what the requester wrote', () => {
    for (const f of PLAN_FIELDS) expect(draft[f.key], f.key).toBeTruthy();
    expect(splitParagraphs(draft.background)[0]).toBe('Existing arrangements end in six months.');
    expect(draft.background).toContain('AUD 1,200,000');
  });
  it('dates are laid out from the creation date and the approver follows the value', () => {
    expect(draft.milestones).toContain('Tender closes: 13 November 2026');
    expect(draft.approvalDelegate).toContain('Executive');
    expect(
      draftPlan({
        values: { ...values, estimatedValue: '90000' },
        complexity: 'LOW',
        gateKeys: [],
        today: new Date('2026-10-02T00:00:00Z'),
      }).approvalDelegate,
    ).toContain('Delegate');
  });
  it('high complexity adds a steering committee and risk sign-off consultation; low does not', () => {
    expect(draft.steeringCommittee).toContain('Executive sponsor');
    expect(draft.consultations).toContain('risk-officer sign-off');
    const low = draftPlan({
      values,
      complexity: 'LOW',
      gateKeys: [],
      today: new Date('2026-10-02T00:00:00Z'),
    });
    expect(low.steeringCommittee).toMatch(/Not required/);
    expect(low.consultations).toMatch(/No additional consultation/);
  });
  it('is deterministic', () => {
    expect(
      draftPlan({
        values,
        complexity: 'HIGH',
        gateKeys: ['RISK_SIGNOFF'],
        today: new Date('2026-10-02T00:00:00Z'),
      }),
    ).toEqual(
      draftPlan({
        values,
        complexity: 'HIGH',
        gateKeys: ['RISK_SIGNOFF'],
        today: new Date('2026-10-02T00:00:00Z'),
      }),
    );
  });
});

describe('MockAiProvider.interpretPlanInstruction', () => {
  const ai = new MockAiProvider();
  it('returns the edited whole-field text plus a plain explanation', async () => {
    const r = await ai.interpretPlanInstruction('change paragraph 2 of the background to Replacement', {
      background: BG,
    });
    expect(r).toMatchObject({
      ok: true,
      key: 'background',
      explanation: expect.stringContaining('paragraph 2'),
    });
    if (r.ok) expect(splitParagraphs(r.newValue)[1]).toBe('Replacement');
  });
  it('turns an out-of-range paragraph into a hint instead of an exception', async () => {
    expect(
      await ai.interpretPlanInstruction('change paragraph 9 of the background to X', { background: BG }),
    ).toMatchObject({ ok: false, hint: expect.stringContaining('this section has 5') });
  });
});

describe('summarisePlan', () => {
  const base = {
    title: 'Facilities cleaning',
    requestNumber: 'PR-2026-0001',
    estimatedValue: 1_200_000,
    termMonths: 36,
    businessUnit: 'Facilities',
    complexity: 'HIGH',
    budgetCheck: 'CLEARED',
  };
  it('states value, complexity, outstanding checks and conflicts on one screen', () => {
    const pts = summarisePlan({
      ...base,
      gates: [
        { label: 'Independent risk-officer sign-off', status: 'REQUIRED' },
        { label: 'Upfront conflict-of-interest declaration', status: 'SATISFIED' },
      ],
      conflicts: [{ none: true, disposition: 'IMMATERIAL' }],
    });
    expect(pts[0]).toContain('$1,200,000');
    expect(pts[0]).toContain('36 months');
    expect(pts.join(' ')).toContain('Still outstanding: independent risk-officer sign-off');
    expect(pts.join(' ')).toContain('none disclosed');
  });
  it('says so when everything is complete and when a conflict was disclosed', () => {
    const done = summarisePlan({
      ...base,
      gates: [{ label: 'x', status: 'SATISFIED' }],
      conflicts: [{ none: false, disposition: 'MANAGEABLE' }],
      topRisk: 'Supplier concentration.',
    });
    expect(done.join(' ')).toContain('All required checks are complete');
    expect(done.join(' ')).toContain('1 conflict disclosed (manageable)');
    expect(done.join(' ')).toContain('Main risk: Supplier concentration.');
  });
});
