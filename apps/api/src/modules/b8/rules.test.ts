import { describe, expect, it } from 'vitest';
import { canonical, sign } from './contract-b8.js';
import {
  checkAnswer,
  coverCheck,
  findDuplicates,
  insertedClauseId,
  levenshtein,
  missingAnswers,
  nameSimilarity,
  normaliseName,
  orderClauses,
  overallRating,
  parseLegalEdit,
  ratingBand,
  readCertificate,
  recallLessons,
  scoreSupplier,
  type RiskInputs,
  type ScheduleItem,
} from './rules.js';

const item = (over: Partial<ScheduleItem>): ScheduleItem => ({
  key: 'k',
  label: 'L',
  section: 'TECHNICAL',
  kind: 'TEXT',
  required: true,
  options: [],
  unit: null,
  maxLength: null,
  ...over,
});
const bytes = (s: string) => new TextEncoder().encode(s);

describe('FR-0130 answers to a response schedule', () => {
  it('checks each kind of answer and reports what is missing', () => {
    expect(checkAnswer(item({ kind: 'NUMBER' }), '$1,250.50')).toEqual({ ok: true, value: '1250.5' });
    expect(checkAnswer(item({ kind: 'NUMBER' }), '-4').ok).toBe(false);
    expect(checkAnswer(item({ kind: 'NUMBER' }), 'abc').ok).toBe(false);
    expect(checkAnswer(item({ kind: 'YESNO' }), ' YES ')).toEqual({ ok: true, value: 'yes' });
    expect(checkAnswer(item({ kind: 'YESNO' }), 'sure').ok).toBe(false);
    expect(checkAnswer(item({ kind: 'CHOICE', options: ['A', 'B'] }), 'B').ok).toBe(true);
    expect(checkAnswer(item({ kind: 'CHOICE', options: ['A', 'B'] }), 'C').ok).toBe(false);
    expect(checkAnswer(item({ kind: 'DATE' }), '2026-02-30').ok).toBe(false);
    expect(checkAnswer(item({ kind: 'DATE' }), '2026-12-31').ok).toBe(true);
    expect(checkAnswer(item({ maxLength: 10 }), 'this is too long').ok).toBe(false);
    expect(checkAnswer(item({}), '   ').ok).toBe(false);
    const items = [item({ key: 'a' }), item({ key: 'b', required: false }), item({ key: 'c' })];
    expect(missingAnswers(items, { a: 'x' }).map((i) => i.key)).toEqual(['c']);
    expect(missingAnswers(items, { a: 'x', c: '  ' }).map((i) => i.key)).toEqual(['c']);
  });
});

describe('FR-0185 reading an insurance certificate', () => {
  it('reads limit, expiry, insurer and policy in the common ways they are written', () => {
    const a = readCertificate(
      bytes(
        'Insurer: Harbour Mutual\nPolicy number: PL-1234\nPublic liability limit $20 million\nExpiry date: 31 Dec 2027',
      ),
    );
    expect(a).toMatchObject({
      coverAud: 20_000_000,
      expiresOn: '2027-12-31',
      insurer: 'Harbour Mutual',
      policyNumber: 'PL-1234',
      readable: true,
      confidence: 1,
    });
    expect(
      readCertificate(bytes('Professional indemnity cover $5,000,000. Expires on 2027-03-01')).coverAud,
    ).toBe(5_000_000);
    expect(readCertificate(bytes('Sum insured 750k\nvalid until 15/06/2028'))).toMatchObject({
      coverAud: 750_000,
      expiresOn: '2028-06-15',
    });
    const none = readCertificate(bytes('A photograph of a building'));
    expect(none).toMatchObject({ readable: false, coverAud: null, expiresOn: null, confidence: 0 });
    expect(none.notes).toHaveLength(2);
  });
  it('compares held cover with what is required, today', () => {
    expect(coverCheck(null, null, '2026-10-06').ok).toBe(true);
    expect(coverCheck(1_000_000, null, '2026-10-06').ok).toBe(false);
    expect(
      coverCheck(1_000_000, { coverAud: 2_000_000, expiresOn: '2026-10-06' }, '2026-10-06').reason,
    ).toMatch(/expired/);
    expect(coverCheck(1_000_000, { coverAud: 2_000_000, expiresOn: '2026-10-07' }, '2026-10-06').ok).toBe(
      true,
    );
    expect(
      coverCheck(5_000_000, { coverAud: 2_000_000, expiresOn: '2027-01-01' }, '2026-10-06').reason,
    ).toMatch(/below/);
  });
});

describe('FR-0795 duplicate suppliers', () => {
  it('ignores company suffixes and punctuation, and scores near names', () => {
    expect(normaliseName('The Brightwave Cleaning Pty. Ltd.')).toBe('brightwave cleaning');
    expect(nameSimilarity('Brightwave Cleaning Pty Ltd', 'BRIGHTWAVE CLEANING PROPRIETARY LIMITED')).toBe(1);
    expect(nameSimilarity('Brightwave Cleaning', 'Brightwave Cleaners')).toBeGreaterThan(0.8);
    expect(nameSimilarity('Brightwave Cleaning', 'Northstar Property Care')).toBeLessThan(0.4);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
  it('pairs shared ABN, shared bank and similar names, and skips dismissed pairs', () => {
    const l = [
      { id: 'a', company: 'Acme Cleaning Pty Ltd', abn: '11 222 333 444' },
      { id: 'b', company: 'ACME Cleaning', abn: '11222333444' },
      { id: 'c', company: 'Zed Security', abn: '5', bank: { bsb: '062-000', account: '123456' } },
      { id: 'd', company: 'Quite Different', abn: '6', bank: { bsb: '062000', account: '123456' } },
      { id: 'e', company: 'Acme Cleaners', abn: '7', location: { city: 'Perth', state: 'WA' } },
      { id: 'f', company: 'Acme Cleaner Services', abn: '8', location: { city: 'Perth', state: 'WA' } },
    ];
    const r = findDuplicates(l, new Set());
    expect(r[0]!.reasons).toContain('Same ABN');
    expect(r.find((p) => p.a.id === 'c' && p.b.id === 'd')!.reasons).toEqual(['Same bank account']);
    expect(r.some((p) => p.a.id === 'e' && p.b.id === 'f')).toBe(true);
    expect(findDuplicates(l, new Set(['a|b'])).some((p) => p.a.id === 'a' && p.b.id === 'b')).toBe(false);
  });
});

describe('FR-0790 ratings', () => {
  it('averages the scores and names a band', () => {
    expect(overallRating({ a: 5, b: 4 })).toBe(4.5);
    expect(overallRating({})).toBe(0);
    expect([4.5, 3.6, 2.6, 1.5].map(ratingBand)).toEqual(['EXCELLENT', 'GOOD', 'FAIR', 'POOR']);
  });
});

describe('FR-0800 supplier scoring', () => {
  const base: RiskInputs = {
    ratingAvg: 4.5,
    ratingCount: 3,
    sanctions: 'CLEAR',
    insurance: 'CURRENT',
    signals: [
      { kind: 'FINANCIAL', level: 'LOW', note: 'ok' },
      { kind: 'WEATHER', level: 'LOW', note: 'ok' },
      { kind: 'GEOPOLITICAL', level: 'LOW', note: 'ok' },
    ],
    flaggedOnboarding: 0,
    esg: {
      modernSlaveryStatement: true,
      renewablePct: 80,
      carbonTonnesCo2e: 10,
      lastModernSlaveryCheck: '2026-09-01',
      modernSlaveryResult: 'CLEAR',
    },
    spendShare: 0.1,
    hasCyberAnswer: true,
    today: '2026-10-06',
  };
  it('weights sum to one; a healthy supplier is low risk and a troubled one high, with reasons', () => {
    const good = scoreSupplier(base);
    expect(good.factors.reduce((n, f) => n + f.weight, 0)).toBeCloseTo(1, 5);
    expect(good.level).toBe('LOW');
    expect(good.recommendations).toEqual([]);
    const bad = scoreSupplier({
      ...base,
      ratingAvg: 2,
      sanctions: 'MATCH',
      insurance: 'EXPIRED',
      spendShare: 0.5,
      hasCyberAnswer: false,
      signals: [
        { kind: 'FINANCIAL', level: 'HIGH', note: 'distress' },
        { kind: 'WEATHER', level: 'HIGH', note: 'cyclone' },
        { kind: 'GEOPOLITICAL', level: 'HIGH', note: 'watch' },
      ],
      esg: { modernSlaveryResult: 'REVIEW' },
    });
    expect(bad.level).toBe('HIGH');
    expect(bad.score).toBeLessThan(good.score);
    expect(bad.recommendations.join(' ')).toMatch(/Sanctions match/);
    expect(bad.recommendations.join(' ')).toMatch(/insurance certificate/);
    expect(bad.recommendations.join(' ')).toMatch(/alternative/);
    expect(bad.recommendations.join(' ')).toMatch(/Financial distress/);
  });
  it('asks for a fresh modern slavery check when the last is old or never done', () => {
    expect(
      scoreSupplier({
        ...base,
        esg: { ...base.esg, lastModernSlaveryCheck: '2025-01-01' },
      }).recommendations.join(' '),
    ).toMatch(/check again/);
    expect(
      scoreSupplier({ ...base, esg: { modernSlaveryStatement: true } }).recommendations.join(' '),
    ).toMatch(/check again/);
  });
});

describe('FR-0805 recalling lessons', () => {
  const lessons = [
    {
      id: '1',
      requestId: 'r1',
      category: 'Cleaning',
      value: 100_000,
      text: 'Ask for rosters before award',
      kind: 'TIP',
      phase: 'CONTRACT_MGMT',
    },
    {
      id: '2',
      requestId: 'r2',
      category: 'Legal',
      value: 9_000_000,
      text: 'Panel arrangements need a conflicts check',
      kind: 'RISK',
      phase: 'EVALUATION',
    },
    {
      id: '3',
      requestId: 'r3',
      category: null,
      value: null,
      text: 'Cleaning rosters were late and the depot transition slipped',
      kind: 'TO_IMPROVE',
      phase: 'CONTRACT_MGMT',
    },
  ];
  it('ranks by category, size, shared words and phase, and leaves out what is not alike', () => {
    const r = recallLessons(
      {
        category: 'cleaning',
        value: 150_000,
        title: 'Cleaning rosters for the depot',
        phase: 'CONTRACT_MGMT',
      },
      lessons,
    );
    expect(r.map((x) => x.id)).toEqual(['1', '3']);
    // one shared word is not enough to count as alike
    expect(
      recallLessons({ category: null, value: null, title: 'Rosters', phase: 'CONTRACT_MGMT' }, lessons),
    ).toEqual([]);
    expect(r[0]!.why).toEqual(expect.arrayContaining(['same category', 'similar size']));
    expect(
      recallLessons({ category: 'Landscaping', value: 5_000, title: 'Grounds', phase: 'PLAN' }, lessons),
    ).toEqual([]);
  });
});

describe('FR-0830 legal edits', () => {
  const clauses = [
    { clauseId: 'PARTIES', title: 'Parties and purpose' },
    { clauseId: 'LIABILITY', title: 'Liability and insurance' },
    { clauseId: 'IP', title: 'Intellectual property' },
  ];
  it('understands redact, redline and insert, naming a clause by number, id or title', () => {
    expect(parseLegalEdit('redact the liability clause', clauses)).toEqual({
      ok: true,
      intent: { kind: 'REDACT', clauseId: 'LIABILITY' },
    });
    expect(parseLegalEdit('Redact clause 3', clauses)).toEqual({
      ok: true,
      intent: { kind: 'REDACT', clauseId: 'IP' },
    });
    expect(parseLegalEdit('unredact IP', clauses)).toEqual({
      ok: true,
      intent: { kind: 'UNREDACT', clauseId: 'IP' },
    });
    expect(
      parseLegalEdit('redline liability to: The supplier holds ten million dollars of cover.', clauses),
    ).toEqual({
      ok: true,
      intent: {
        kind: 'REDLINE',
        clauseId: 'LIABILITY',
        text: 'The supplier holds ten million dollars of cover.',
      },
    });
    expect(
      parseLegalEdit(
        'insert a clause titled "Data breach" after clause 2: Tell us within 24 hours of any breach.',
        clauses,
      ),
    ).toEqual({
      ok: true,
      intent: {
        kind: 'INSERT',
        afterClauseId: 'LIABILITY',
        title: 'Data breach',
        text: 'Tell us within 24 hours of any breach.',
      },
    });
  });
  it('says what it could not do and how to ask', () => {
    for (const t of [
      'make it shorter',
      'redact clause 9',
      'redact the weather clause',
      'redline liability to: short',
    ]) {
      const r = parseLegalEdit(t, clauses);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.hint).toMatch(/Try:/);
    }
  });
  it('orders inserted clauses after the one they follow, in the order they were inserted, with a stable id', () => {
    const rows = [
      { clauseId: 'IP', afterClauseId: null },
      { clauseId: 'PARTIES', afterClauseId: null },
      { clauseId: 'X-first', afterClauseId: 'PARTIES' },
      { clauseId: 'X-second', afterClauseId: 'PARTIES' },
      { clauseId: 'X-orphan', afterClauseId: 'GONE' },
    ];
    expect(orderClauses(rows, ['PARTIES', 'LIABILITY', 'IP']).map((r) => r.clauseId)).toEqual([
      'PARTIES',
      'X-first',
      'X-second',
      'IP',
      'X-orphan',
    ]);
    expect(insertedClauseId('Data breach notice!', [])).toBe('X-data-breach-notice');
    expect(insertedClauseId('Data breach notice!', ['X-data-breach-notice'])).toBe('X-data-breach-notice-2');
  });
});

describe('FR-0390 signing what the legal platform sends', () => {
  it('signs the same message the same way however its keys are ordered, and differently with another secret or content', () => {
    const a = { b: 1, a: [{ y: 2, x: 1 }], c: 'text' };
    const b = { c: 'text', a: [{ x: 1, y: 2 }], b: 1 };
    expect(canonical(a)).toBe(canonical(b));
    expect(sign('s', a)).toBe(sign('s', b));
    expect(sign('s', a)).not.toBe(sign('t', a));
    expect(sign('s', a)).not.toBe(sign('s', { ...a, b: 2 }));
    expect(sign('s', a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
