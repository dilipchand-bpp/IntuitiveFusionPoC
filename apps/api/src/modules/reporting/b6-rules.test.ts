import { describe, expect, it } from 'vitest';
import {
  applyLayout,
  candidateRisks,
  catalog,
  defaultLayout,
  defaultSchedule,
  delegateCalendar,
  generateReference,
  matchPeople,
  overallLevel,
  parseAdvance,
  parseCommittee,
  parseQuestion,
  parseTemplateChange,
  riskRating,
  shiftSchedule,
  summariseChanges,
  supplierSignals,
  validateLayout,
  velocity,
  wordDiff,
} from './b6-rules.js';

describe('FR-0085 FR-0115 FR-0365 layout templates', () => {
  it('has a system default for each document, and mandatory sections cannot be dropped', () => {
    for (const k of ['PLAN', 'RFX', 'REPORT'] as const) {
      expect(defaultLayout(k).length).toBe(catalog(k).length);
      expect(validateLayout(k, defaultLayout(k))).toEqual([]);
    }
    const noOverview = defaultLayout('RFX').filter((e) => e.key !== 'overview');
    expect(validateLayout('RFX', noOverview)[0]).toMatch(/Overview" is required/);
    const off = defaultLayout('REPORT').map((e) => (e.key === 'ranking' ? { ...e, enabled: false } : e));
    expect(validateLayout('REPORT', off)[0]).toMatch(/Ranking" is required/);
    expect(validateLayout('PLAN', [...defaultLayout('PLAN'), { key: 'nope', enabled: true }])[0]).toMatch(
      /not a section/,
    );
    expect(
      validateLayout('PLAN', [...defaultLayout('PLAN'), { key: 'background', enabled: true }])[0],
    ).toMatch(/more than once/);
  });

  it('orders and filters a document by its layout', () => {
    const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    expect(applyLayout(items, null)).toBe(items);
    expect(
      applyLayout(items, [
        { key: 'c', enabled: true },
        { key: 'a', enabled: true },
        { key: 'b', enabled: false },
      ]).map((i) => i.key),
    ).toEqual(['c', 'a']);
    expect(applyLayout(items, [{ key: 'b', enabled: true }]).map((i) => i.key)).toEqual(['b']); // not listed means left out
  });
});

describe('FR-0595 the schedule and moving a phase', () => {
  const s0 = defaultSchedule('2026-10-01');
  it('follows each phase with the next', () => {
    expect(s0.map((s) => s.phase)).toEqual(['INTAKE', 'PLAN', 'TENDER', 'EVALUATION', 'CONTRACT_AWARD']);
    expect(s0[1]!.startDate).toBe(s0[0]!.endDate);
  });
  it('moving a phase moves everything after it by the same, and the delegate calendar follows', () => {
    const r = shiftSchedule(s0, 'TENDER', 7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slots[0]).toEqual(s0[0]);
    expect(r.slots[1]).toEqual(s0[1]);
    expect(r.slots[2]!.startDate).toBe('2026-10-29');
    expect(r.slots[4]!.endDate).not.toBe(s0[4]!.endDate);
    const before = delegateCalendar(s0).find((c) => c.phase === 'CONTRACT_AWARD')!.date;
    const after = delegateCalendar(r.slots).find((c) => c.phase === 'CONTRACT_AWARD')!.date;
    expect(after > before).toBe(true);
  });
  it('refuses a move that would start a phase before the one before it ends', () => {
    const r = shiftSchedule(s0, 'TENDER', -3);
    expect(r.ok).toBe(false);
    expect(shiftSchedule(s0, 'PLAN', -3).ok).toBe(false);
  });
});

describe('FR-0605 velocity', () => {
  it('averages finished phases, counts the wait of open ones and names the bottleneck', () => {
    const v = velocity([
      { phase: 'PLAN', days: 10, open: false },
      { phase: 'PLAN', days: 20, open: false },
      { phase: 'TENDER', days: 5, open: false },
      { phase: 'EVALUATION', days: 40, open: true },
    ]);
    expect(v.phases.find((p) => p.phase === 'PLAN')!.avgDays).toBe(15);
    expect(v.phases.find((p) => p.phase === 'EVALUATION')).toMatchObject({ waiting: 1, longestWaitDays: 40 });
    expect(v.bottleneck).toBe('EVALUATION');
    expect(velocity([]).bottleneck).toBeNull();
  });
});

describe('FR-0625 questions in plain language', () => {
  it('reads "all procurement risks in 2026" and other questions', () => {
    expect(parseQuestion('all procurement risks in 2026')).toMatchObject({ entity: 'risks', year: 2026 });
    expect(parseQuestion('high risks in 2026')).toMatchObject({ entity: 'risks', level: 'HIGH' });
    expect(parseQuestion('contracts expiring in 3 months')).toMatchObject({
      entity: 'contracts',
      expiringDays: 90,
    });
    expect(parseQuestion('blocked invoices')).toMatchObject({ entity: 'invoices', status: 'BLOCKED' });
    expect(parseQuestion('tenders in evaluation over $500k')).toMatchObject({
      entity: 'procurements',
      phase: 'EVALUATION',
      minValue: 500_000,
    });
    expect(parseQuestion('suppliers about cleaning')).toMatchObject({
      entity: 'suppliers',
      text: 'cleaning',
    });
    expect(parseQuestion('what is the weather')).toHaveProperty('error');
  });
});

describe('FR-0770 FR-0775 FR-0750 instructions', () => {
  it('moves on to a named or the next phase', () => {
    expect(parseAdvance('move to tender', 'PLAN')).toEqual({ target: 'TENDER' });
    expect(parseAdvance('go to the next phase', 'PLAN')).toEqual({ target: 'TENDER' });
    expect(parseAdvance('we are ready for evaluation', 'TENDER')).toEqual({ target: 'EVALUATION' });
    expect(parseAdvance('hmm', 'PLAN')).toHaveProperty('error');
    expect(parseAdvance('next', 'CLOSED')).toHaveProperty('error');
  });
  it('adds and removes committee members by name, listing the matches', () => {
    expect(parseCommittee('add Tomas to the committee')).toEqual({ action: 'ADD', name: 'Tomas' });
    expect(parseCommittee('Remove Mei Tanaka')).toEqual({ action: 'REMOVE', name: 'Mei Tanaka' });
    expect(parseCommittee('shuffle everyone')).toHaveProperty('error');
    const ppl = [{ name: 'Nia Okoro' }, { name: 'Nia Otieno' }, { name: 'Tomas Silva' }];
    expect(matchPeople('nia', ppl)).toHaveLength(2);
    expect(matchPeople('nia okoro', ppl)).toHaveLength(1);
    expect(matchPeople('xx', ppl)).toHaveLength(0);
  });
  it('names the template wanted', () => {
    expect(parseTemplateChange('use the request for quotation template')).toEqual({ type: 'RFQ' });
    expect(parseTemplateChange('this should be a proposal')).toEqual({ type: 'RFP' });
    expect(parseTemplateChange('make it an RFI')).toEqual({ type: 'RFI' });
    expect(parseTemplateChange('something else')).toHaveProperty('error');
  });
});

describe('FR-0755 candidate risks', () => {
  const f = {
    category: 'IT managed services',
    value: 200_000,
    termMonths: 24,
    complexity: 'LOW',
    workflow: null,
    text: 'cloud software',
  };
  it('proposes risks fitted to the procurement, each with treatments to choose from', () => {
    const base = candidateRisks(f);
    expect(base.map((r) => r.key)).toEqual(
      expect.arrayContaining(['delivery', 'price', 'supplier', 'probity', 'cyber']),
    );
    expect(base.every((r) => r.options.length >= 2)).toBe(true);
    const big = candidateRisks({ ...f, value: 2_000_000, termMonths: 48, complexity: 'HIGH' }).map(
      (r) => r.key,
    );
    expect(big).toEqual(expect.arrayContaining(['exposure', 'lockin', 'complexity']));
    expect(candidateRisks({ ...f, category: 'Building cleaning', text: '' }).map((r) => r.key)).toContain(
      'whs',
    );
  });
  it('rates likelihood times impact', () => {
    expect(riskRating(2, 3)).toEqual({ score: 6, level: 'LOW' });
    expect(riskRating(3, 3)).toEqual({ score: 9, level: 'MEDIUM' });
    expect(riskRating(4, 5)).toEqual({ score: 20, level: 'HIGH' });
    expect(riskRating(null, 5)).toBeNull();
  });
});

describe('FR-0740 comparing versions', () => {
  it('shows what was added and removed word by word', () => {
    const d = wordDiff('The supplier delivers in June', 'The supplier delivers by July 2027');
    const words = (t: string) =>
      d.filter((x) => x.t === t).flatMap((x) => x.text.split(/\s+/).filter(Boolean));
    expect(words('del')).toEqual(['in', 'June']);
    expect(words('add')).toEqual(['by', 'July', '2027']);
    expect(wordDiff('same', 'same')).toEqual([{ t: 'same', text: 'same' }]);
  });
  it('summarises what changed since someone last looked', () => {
    expect(summariseChanges([])).toMatch(/Nothing has changed/);
    const s = summariseChanges([
      {
        key: 'background',
        label: 'Background',
        before: 'a',
        after: 'a much longer background text that is expanded a lot',
        by: 'Priya Nair',
        at: '2026-10-03T00:00:00Z',
      },
      {
        key: 'risks',
        label: 'Risks',
        before: '',
        after: 'New risk',
        by: 'Dana Okafor',
        at: '2026-10-03T01:00:00Z',
      },
    ]);
    expect(s).toContain('2 change(s) to 2 field(s)');
    expect(s).toContain('Background was expanded by Priya Nair');
    expect(s).toContain('Risks was written by Dana Okafor');
  });
});

describe('FR-0610 supplier signals', () => {
  const qld = { city: 'Cairns', state: 'QLD', country: 'Australia', lat: -16.9, lng: 145.8 };
  it('reads weather by state and season, financial distress and a watchlist', () => {
    const fin = { level: 'LOW' as const, reason: 'No adverse indicators' };
    expect(supplierSignals(qld, 12, fin).find((s) => s.feed === 'WEATHER')!.level).toBe('HIGH');
    expect(supplierSignals(qld, 7, fin).find((s) => s.feed === 'WEATHER')!.level).toBe('LOW');
    expect(overallLevel(supplierSignals({ ...qld, country: 'Myanmar' }, 7, fin))).toBe('HIGH');
    expect(overallLevel(supplierSignals(qld, 7, { level: 'MEDIUM', reason: 'x' }))).toBe('MEDIUM');
  });
});

describe('FR-0765 reference content', () => {
  it('makes variants across kinds, categories, sectors and levels for a generation', () => {
    const x = generateReference(['IT', 'Cleaning'], 3);
    expect(x).toHaveLength(4 * 2 * 2 * 3);
    expect(x[0]!.body).toContain('generation 3');
    expect(new Set(x.map((i) => i.level))).toEqual(new Set(['Junior', 'Intermediate', 'Senior']));
  });
});
