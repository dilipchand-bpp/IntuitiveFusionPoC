import { describe, expect, it } from 'vitest';
import { evaluationCriteria } from '../tender/pack.js';
import { buildReport } from './report.js';
import {
  anonymousName,
  canScoreCriterion,
  canSeeFileSection,
  complies,
  isFlagged,
  rank,
  validScore,
  variancePct,
  weightedScore,
} from './scoring.js';

describe('variance (US-EVL-04)', () => {
  it('is the gap as a percentage of the highest score', () => {
    expect(variancePct([8, 5])).toBe(37.5);
    expect(variancePct([7, 7, 7])).toBe(0);
    expect(variancePct([10, 0])).toBe(100);
    expect(variancePct([6.5, 6.7, 6.5])).toBeCloseTo(2.99, 2);
  });
  it('needs two scorers; a single score has nothing to disagree with', () => {
    expect(variancePct([8])).toBeNull();
    expect(variancePct([])).toBeNull();
  });
  it('all zeroes is agreement, not a division by zero', () => {
    expect(variancePct([0, 0])).toBe(0);
  });
  it('flags only strictly above the limit (30% is not flagged, 30.01% is)', () => {
    expect(isFlagged(30, 30)).toBe(false);
    expect(isFlagged(30.01, 30)).toBe(true);
    expect(isFlagged(null, 30)).toBe(false);
    expect(variancePct([10, 7])).toBe(30);
  });
});

describe('weighted score and ranking', () => {
  const criteria = [
    { id: 'tech', weight: 40, passFail: false },
    { id: 'deliv', weight: 20, passFail: false },
    { id: 'price', weight: 30, passFail: false },
    { id: 'exp', weight: 10, passFail: false },
  ];
  it('is out of 100 from consensus scores out of 10', () => {
    expect(
      weightedScore(
        criteria,
        new Map([
          ['tech', 8],
          ['deliv', 7.5],
          ['price', 7],
          ['exp', 6],
        ]),
      ),
    ).toBe(74);
    expect(weightedScore(criteria, new Map(criteria.map((c) => [c.id, 10])))).toBe(100);
    expect(weightedScore(criteria, new Map())).toBe(0);
  });
  it('is normalised when weights do not add to 100, and ignores pass/fail criteria', () => {
    const half = [
      { id: 'a', weight: 1, passFail: false },
      { id: 'b', weight: 1, passFail: false },
      { id: 'gate', weight: 0, passFail: true },
    ];
    expect(
      weightedScore(
        half,
        new Map([
          ['a', 10],
          ['b', 5],
          ['gate', 0],
        ]),
      ),
    ).toBe(75);
  });
  it('a failed pass/fail criterion means not compliant, and non-compliant suppliers are not ranked', () => {
    const gate = [{ id: 'gate', weight: 0, passFail: true }, ...criteria];
    expect(complies(gate, new Map([['gate', 0]]))).toBe(false);
    expect(complies(gate, new Map([['gate', 10]]))).toBe(true);
    const r = rank([
      { supplierId: 'a', score: 80, compliant: true },
      { supplierId: 'b', score: 95, compliant: false },
      { supplierId: 'c', score: 80, compliant: true },
      { supplierId: 'd', score: 70, compliant: true },
    ]);
    expect(Object.fromEntries(r.map((x) => [x.supplierId, x.rank]))).toEqual({ a: 1, b: null, c: 1, d: 3 });
  });
});

describe('score validation', () => {
  it('accepts 0 to 10 in half points only', () => {
    for (const v of [0, 0.5, 7, 9.5, 10]) expect(validScore(v, false), String(v)).toBe(true);
    for (const v of [-0.5, 10.5, 7.25, NaN, Infinity]) expect(validScore(v, false), String(v)).toBe(false);
  });
  it('pass/fail accepts only 0 and 10', () => {
    expect(validScore(10, true)).toBe(true);
    expect(validScore(0, true)).toBe(true);
    expect(validScore(5, true)).toBe(false);
  });
});

describe('stream isolation (US-EVL-03 AC2)', () => {
  it('a technical member never scores price and never opens commercial or other files', () => {
    expect(canScoreCriterion('TECHNICAL', 'COMMERCIAL')).toBe(false);
    expect(canScoreCriterion('TECHNICAL', 'TECHNICAL')).toBe(true);
    expect(canScoreCriterion('TECHNICAL', 'OTHER')).toBe(true);
    expect(canSeeFileSection('TECHNICAL', 'COMMERCIAL')).toBe(false);
    expect(canSeeFileSection('TECHNICAL', 'OTHER')).toBe(false);
    expect(canSeeFileSection('TECHNICAL', 'TECHNICAL')).toBe(true);
  });
  it('a commercial member never scores technical criteria nor opens technical files', () => {
    expect(canScoreCriterion('COMMERCIAL', 'TECHNICAL')).toBe(false);
    expect(canSeeFileSection('COMMERCIAL', 'TECHNICAL')).toBe(false);
    expect(canSeeFileSection('COMMERCIAL', 'COMMERCIAL')).toBe(true);
  });
  it('the chair (OTHER) sees and may score everything', () => {
    for (const s of ['TECHNICAL', 'COMMERCIAL', 'OTHER'] as const) {
      expect(canScoreCriterion('OTHER', s)).toBe(true);
      expect(canSeeFileSection('OTHER', s)).toBe(true);
    }
  });
});

describe('criteria templates and anonymous names', () => {
  it('tender and proposal weights add to 100, price is commercial, and RFI/EOI are not scored for award', () => {
    for (const t of ['RFT', 'RFP'] as const) {
      const c = evaluationCriteria(t)!;
      expect(c.reduce((s, x) => s + x.weight, 0)).toBe(100);
      expect(c.filter((x) => x.stream === 'COMMERCIAL')).toHaveLength(1);
    }
    expect(evaluationCriteria('RFQ')!.find((c) => c.passFail)).toBeTruthy();
    expect(evaluationCriteria('RFI')).toBeNull();
    expect(evaluationCriteria('EOI')).toBeNull();
  });
  it('anonymous names are stable and never contain a company name', () => {
    expect([0, 1, 2].map(anonymousName)).toEqual(['Supplier A', 'Supplier B', 'Supplier C']);
    expect(anonymousName(26)).toBe('Supplier A1');
  });
});

describe('report (US-EVL-05)', () => {
  const base = {
    title: 'Facilities cleaning services',
    number: 'PR-2026-0001',
    type: 'RFT',
    generatedAt: new Date('2026-10-02T03:04:05Z'),
    varianceLimitPct: 30,
    panel: [
      { name: 'Tomas Silva', stream: 'TECHNICAL', outcome: 'NO_CONFLICT' as const },
      { name: 'Mei Tanaka', stream: 'COMMERCIAL', outcome: 'NO_CONFLICT' as const },
      { name: 'Ola Removed', stream: 'TECHNICAL', outcome: 'CONFLICT_REMOVED' as const },
    ],
    criteria: [
      { id: 't', name: 'Technical capability', weight: 70, stream: 'TECHNICAL', passFail: false },
      { id: 'p', name: 'Price', weight: 30, stream: 'COMMERCIAL', passFail: false },
    ],
    suppliers: [
      {
        name: 'Brightwave',
        score: 80,
        rank: 1,
        compliant: true,
        comments: ['Strong methodology'],
        items: [
          {
            criterionId: 't',
            consensus: 8,
            flagged: true,
            variance: 37.5,
            rationale: 'Chair weighted the site plan',
          },
          { criterionId: 'p', consensus: 8, flagged: false, variance: 0, rationale: null },
        ],
      },
      {
        name: 'Summit',
        score: 55,
        rank: 2,
        compliant: true,
        comments: [],
        items: [
          { criterionId: 't', consensus: 5, flagged: false, variance: null, rationale: null },
          { criterionId: 'p', consensus: 6.5, flagged: false, variance: null, rationale: null },
        ],
      },
    ],
  };
  it('populates scores, ranking, process and a timestamp', () => {
    const r = buildReport(base);
    expect(r.summary).toContain('Brightwave ranked first');
    expect(r.summary).toContain('2026-10-02 03:04 UTC');
    expect(r.ranking).toContain('1. Brightwave: 80.0 out of 100');
    expect(r.ranking).toContain('2. Summit: 55.0 out of 100');
    expect(r.commentary).toContain('Technical capability: 8.0 out of 10');
    expect(r.commentary).toContain('Strong methodology');
    expect(r.recommendation).toContain('Brightwave');
  });
  it('states the process: declarations, a removed member, isolation, and each flagged score with its rationale', () => {
    const r = buildReport(base);
    expect(r.process).toContain('2 panel member(s) declared');
    expect(r.process).toContain('1 member(s) declared a conflict');
    expect(r.process).toContain('did not have access to pricing');
    expect(r.process).toContain('Flagged: Brightwave, Technical capability (37.5% difference)');
    expect(r.process).toContain('Chair weighted the site plan');
  });
  it('with no compliant supplier it makes no recommendation', () => {
    const r = buildReport({
      ...base,
      suppliers: base.suppliers.map((s) => ({ ...s, rank: null, compliant: false })),
    });
    expect(r.recommendation).toContain('no award recommendation');
    expect(r.ranking).toContain('Not ranked: Brightwave');
  });
  it('is deterministic', () => {
    expect(buildReport(base)).toEqual(buildReport(base));
  });
});
