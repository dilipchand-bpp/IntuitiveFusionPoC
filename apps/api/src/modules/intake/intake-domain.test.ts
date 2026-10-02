import { describe, expect, it } from 'vitest';
import { gatesFor, intakeModeFor, scoreComplexity, valueBand } from './complexity.js';
import { extractFromText, parseBusinessUnit, parseMoney, parseTermMonths } from './extract.js';
import { missingMandatory, nextQuestions } from './fields.js';

describe('parseMoney', () => {
  it.each([
    ['about $1.2M', 1_200_000],
    ['$1,200,000', 1_200_000],
    ['AUD 640 thousand', 640_000],
    ['around 50k', 50_000],
    ['$8,000', 8_000],
    ['1.5 million', 1_500_000],
    ['budget of 250,000', 250_000],
    ['$2b', 2_000_000_000],
  ])('%s -> %d', (text, expected) => expect(parseMoney(text)).toBe(expected));
  it('returns null when there is no amount, and ignores small bare numbers like years', () => {
    expect(parseMoney('three year term')).toBeNull();
    expect(parseMoney('for 3 years')).toBeNull();
  });
});

describe('parseTermMonths', () => {
  it.each([
    ['three-year term', 36],
    ['36 months', 36],
    ['2 years', 24],
    ['18-month contract', 18],
    ['one year', 12],
    ['1.5 years', 18],
  ])('%s -> %d', (text, expected) => expect(parseTermMonths(text)).toBe(expected));
  it('returns null when absent and rejects absurd values', () => {
    expect(parseTermMonths('as soon as possible')).toBeNull();
    expect(parseTermMonths('500 years')).toBeNull();
  });
});

describe('parseBusinessUnit', () => {
  it('finds named units but does not mistake "IT services" for the IT unit', () => {
    expect(parseBusinessUnit('it is for Facilities')).toBe('Facilities');
    expect(parseBusinessUnit('owned by IT')).toBe('IT');
    expect(parseBusinessUnit('IT')).toBe('IT');
    expect(parseBusinessUnit('the IT team')).toBe('IT');
    expect(parseBusinessUnit('we need IT services')).toBeNull();
    expect(parseBusinessUnit('nothing relevant')).toBeNull();
  });
});

describe('extractFromText (the headline example from the deck)', () => {
  it('"Run an RFx for facilities cleaning - three-year term, about $1.2M" yields category, value and term', () => {
    const e = extractFromText('Run an RFx for facilities cleaning - three-year term, about $1.2M');
    expect(e.fields.category).toContain('Building cleaning');
    expect(e.fields.estimatedValue).toBe('1200000');
    expect(e.fields.termMonths).toBe('36');
    expect(e.fields.title).toBe('Facilities cleaning services');
    expect(e.mentioned).toEqual(expect.arrayContaining(['category', 'estimatedValue', 'termMonths']));
  });
  it('never invents facts: an unrelated sentence extracts nothing', () => {
    expect(extractFromText('hello there').mentioned).toEqual([]);
  });
  it('detects sensitivity and offshore supply', () => {
    const e = extractFromText('overseas supplier handling patient data');
    expect(e.fields.supplyLocation).toBe('OFFSHORE');
    expect(e.fields.dataSensitivity).toBe('SENSITIVE');
  });
});

describe('missing fields and questions', () => {
  it('lists missing mandatory fields and asks in a sensible order', () => {
    const missing = missingMandatory({ title: 'x', category: 'y' });
    expect(missing.sort()).toEqual(['businessUnit', 'contractOwner', 'estimatedValue', 'termMonths']);
    expect(nextQuestions(missing)).toEqual(['businessUnit', 'contractOwner', 'estimatedValue', 'termMonths']);
  });
  it('treats blank strings as missing', () => {
    expect(missingMandatory({ title: '  ' })).toContain('title');
  });
});

describe('complexity score (FR-0060)', () => {
  it.each([
    [8_000, 'LOW'],
    [249_999, 'LOW'],
    [250_000, 'MEDIUM'],
    [999_999, 'MEDIUM'],
    [1_000_000, 'HIGH'],
    [4_999_999, 'HIGH'],
    [5_000_000, 'CRITICAL'],
  ])('value %d -> base %s (boundary values)', (v, level) => expect(valueBand(v)).toBe(level));

  it('matches the seeded scenarios: cleaning 1.2M is HIGH, managed IT 4.8M is CRITICAL, security 640k is MEDIUM', () => {
    expect(
      scoreComplexity({ estimatedValue: 1_200_000, category: 'Building cleaning (UNSPSC 76111500)' }).level,
    ).toBe('HIGH');
    expect(
      scoreComplexity({ estimatedValue: 4_800_000, category: 'IT managed services (UNSPSC 81111800)' }).level,
    ).toBe('CRITICAL');
    expect(
      scoreComplexity({ estimatedValue: 640_000, category: 'Security services (UNSPSC 92121500)' }).level,
    ).toBe('MEDIUM');
    expect(
      scoreComplexity({ estimatedValue: 8_000, category: 'Paper products (UNSPSC 14111500)' }).level,
    ).toBe('LOW');
  });
  it('offshore supply and sensitive data each raise the level by one, capped at CRITICAL', () => {
    expect(scoreComplexity({ estimatedValue: 300_000, supplyLocation: 'OFFSHORE' }).level).toBe('HIGH');
    expect(
      scoreComplexity({ estimatedValue: 300_000, supplyLocation: 'OFFSHORE', dataSensitivity: 'SENSITIVE' })
        .level,
    ).toBe('CRITICAL');
    expect(
      scoreComplexity({ estimatedValue: 9_000_000, supplyLocation: 'OFFSHORE', dataSensitivity: 'SENSITIVE' })
        .level,
    ).toBe('CRITICAL');
  });
  it('explains itself in plain language', () => {
    const r = scoreComplexity({
      estimatedValue: 1_200_000,
      category: 'IT managed services (UNSPSC 81111800)',
    });
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
    expect(r.reasons.join(' ')).toMatch(/critical category/);
  });
  it('a missing value is treated as zero (low) rather than crashing', () => {
    expect(scoreComplexity({ estimatedValue: null }).level).toBe('LOW');
  });
});

describe('governance gates', () => {
  it('HIGH and CRITICAL add independent risk sign-off and upfront COI; MEDIUM and LOW do not', () => {
    for (const level of ['HIGH', 'CRITICAL'] as const) {
      expect(gatesFor(level, null, 1_200_000, 'CLEARED').map((g) => g.key)).toEqual(
        expect.arrayContaining(['RISK_SIGNOFF', 'UPFRONT_COI']),
      );
    }
    expect(gatesFor('MEDIUM', null, 300_000, 'CLEARED').map((g) => g.key)).not.toContain('RISK_SIGNOFF');
    expect(gatesFor('LOW', null, 8_000, 'CLEARED')).toEqual([]);
  });
  it('IT category adds endorsement; value over 250k adds legal review; budget problems add their own gates', () => {
    const keys = gatesFor('CRITICAL', 'IT managed services (UNSPSC 81111800)', 4_800_000, 'UNAVAILABLE').map(
      (g) => g.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining(['IT_ENDORSEMENT', 'LEGAL_REVIEW', 'MANUAL_BUDGET_CONFIRMATION']),
    );
    expect(gatesFor('LOW', null, 1000, 'EXCEEDED').map((g) => g.key)).toContain('BUDGET_ESCALATION');
  });
  it('self-service below the threshold, team-led at or above it (FR-0040)', () => {
    expect(intakeModeFor(49_999, 50_000)).toBe('SELF_SERVICE');
    expect(intakeModeFor(50_000, 50_000)).toBe('TEAM_LED');
  });
});
