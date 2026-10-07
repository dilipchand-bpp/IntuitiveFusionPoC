/**
 * NFR-R05: ESG and socio-economic plan data with ceilings and ratios checked. The arithmetic, as pure functions.
 */
import { describe, expect, it } from 'vitest';
import {
  ESG_METRICS,
  METRIC_BY_KEY,
  actualsFromSpend,
  checkOverride,
  evaluateMetric,
  gateOf,
  pctOf,
  round2,
  slaveryRating,
  summaryLine,
  type SpendLine,
} from './esg-rules.js';

describe('NFR-R05 rounding and ratios', () => {
  it('rounds half away from zero to two places, including the cases a binary float gets wrong', () => {
    expect(round2(4.995)).toBe(5);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-2.675)).toBe(-2.68);
    expect(round2(0)).toBe(0);
    expect(round2(33.333333)).toBe(33.33);
    expect(round2(66.666666)).toBe(66.67);
  });
  it('a share of nothing is undefined, not zero and not infinite', () => {
    expect(pctOf(5, 0)).toBeNull();
    expect(pctOf(0, 0)).toBeNull();
    expect(pctOf(5, -10)).toBeNull();
    expect(pctOf(Number.NaN, 10)).toBeNull();
    expect(pctOf(0, 100)).toBe(0);
    expect(pctOf(4_800, 120_000)).toBe(4);
    expect(pctOf(1, 3)).toBe(33.33);
    expect(pctOf(2, 3)).toBe(66.67);
    expect(pctOf(150_000, 120_000)).toBe(125); // over 100 is allowed for a ratio; the caller decides what it means
  });
});

describe('NFR-R05 PASS, AT RISK and BREACH', () => {
  it('a target (floor) passes at or above it, is at risk within the band below it, and breaches under that', () => {
    expect(evaluateMetric('FLOOR', 5, 5, 10)).toMatchObject({ status: 'PASS', shortfall: 0 });
    expect(evaluateMetric('FLOOR', 5, 6.2, 10)).toMatchObject({ status: 'PASS' });
    expect(evaluateMetric('FLOOR', 5, 4.99, 10)).toMatchObject({ status: 'AT_RISK', shortfall: 0.01 });
    expect(evaluateMetric('FLOOR', 5, 4.5, 10)).toMatchObject({ status: 'AT_RISK', shortfall: 0.5 }); // exactly 10% below
    expect(evaluateMetric('FLOOR', 5, 4.49, 10)).toMatchObject({ status: 'BREACH', shortfall: 0.51 });
    expect(evaluateMetric('FLOOR', 5, 0, 10)).toMatchObject({ status: 'BREACH', shortfall: 5 });
  });
  it('a ceiling passes up to the band under it, is at risk from there to the ceiling, and breaches above it', () => {
    expect(evaluateMetric('CEILING', 120, 100, 10)).toMatchObject({ status: 'PASS' });
    expect(evaluateMetric('CEILING', 120, 108, 10)).toMatchObject({ status: 'PASS' }); // exactly 10% under
    expect(evaluateMetric('CEILING', 120, 108.01, 10)).toMatchObject({ status: 'AT_RISK' });
    expect(evaluateMetric('CEILING', 120, 120, 10)).toMatchObject({ status: 'AT_RISK' });
    expect(evaluateMetric('CEILING', 120, 120.01, 10)).toMatchObject({ status: 'BREACH', shortfall: 0.01 });
    expect(evaluateMetric('CEILING', 120, 150, 10)).toMatchObject({ status: 'BREACH', shortfall: 30 });
  });
  it('judges the figure as shown: a value that rounds onto the limit is on the limit', () => {
    expect(evaluateMetric('FLOOR', 5, 4.995, 10)).toMatchObject({ status: 'PASS', value: 5 });
    expect(evaluateMetric('CEILING', 60, 60.004, 0)).toMatchObject({ status: 'PASS', value: 60 });
    expect(evaluateMetric('CEILING', 60, 60.005, 0)).toMatchObject({ status: 'BREACH', value: 60.01 });
  });
  it('edge cases: no figure, a zero floor, a zero ceiling, no band', () => {
    expect(evaluateMetric('FLOOR', 5, null, 10)).toEqual({ status: 'NO_DATA', value: null, shortfall: 0 });
    expect(evaluateMetric('CEILING', 5, Number.NaN, 10).status).toBe('NO_DATA');
    expect(evaluateMetric('FLOOR', 0, 0, 10).status).toBe('PASS'); // nothing is required
    expect(evaluateMetric('CEILING', 0, 0, 10).status).toBe('PASS'); // nothing allowed, nothing used
    expect(evaluateMetric('CEILING', 0, 0.01, 10).status).toBe('BREACH');
    expect(evaluateMetric('FLOOR', 5, 4.99, 0).status).toBe('BREACH'); // no band: any miss is a breach
    expect(evaluateMetric('CEILING', 5, 5, 0).status).toBe('PASS'); // no band means no AT RISK: at the ceiling is allowed
  });
});

describe('NFR-R05 a plan may tighten a limit freely, loosen it only within bounds and with a reason', () => {
  const carbon = METRIC_BY_KEY.get('CARBON_INTENSITY_T_PER_M')!;
  const indigenous = METRIC_BY_KEY.get('INDIGENOUS_SPEND_PCT')!;
  const slavery = METRIC_BY_KEY.get('MODERN_SLAVERY_RISK')!;
  it('ceiling: lower or equal is fine; higher is a relaxation up to the allowed share; beyond that is refused', () => {
    expect(checkOverride(carbon, 120, 100, 50)).toMatchObject({ ok: true, relaxes: false });
    expect(checkOverride(carbon, 120, 120, 50)).toMatchObject({ ok: true, relaxes: false });
    expect(checkOverride(carbon, 120, 150, 50)).toMatchObject({ ok: true, relaxes: true, loosest: 180 });
    expect(checkOverride(carbon, 120, 180, 50)).toMatchObject({ ok: true, relaxes: true });
    const over = checkOverride(carbon, 120, 180.01, 50);
    expect(over).toMatchObject({ ok: false, relaxes: true });
    expect(over.error).toMatch(/180 at most/);
    expect(checkOverride(carbon, 120, 121, 0)).toMatchObject({ ok: false });
  });
  it('target: higher or equal is fine; lower is a relaxation down to the allowed share; beyond that is refused', () => {
    expect(checkOverride(indigenous, 3, 5, 50)).toMatchObject({ ok: true, relaxes: false });
    expect(checkOverride(indigenous, 3, 2, 50)).toMatchObject({ ok: true, relaxes: true, loosest: 1.5 });
    expect(checkOverride(indigenous, 3, 1.5, 50)).toMatchObject({ ok: true, relaxes: true });
    expect(checkOverride(indigenous, 3, 1.49, 50)).toMatchObject({ ok: false });
    expect(checkOverride(indigenous, 3, 0, 100)).toMatchObject({ ok: true, relaxes: true });
  });
  it('never leaves the metric range: no percent over 100, no rating over High, no negatives', () => {
    expect(checkOverride(indigenous, 3, 101, 50).ok).toBe(false);
    expect(checkOverride(indigenous, 3, -1, 50).ok).toBe(false);
    expect(checkOverride(slavery, 2, 3, 50)).toMatchObject({ ok: true, relaxes: true, loosest: 3 });
    expect(checkOverride(slavery, 2, 4, 100).ok).toBe(false);
    expect(checkOverride(slavery, 2, 0, 50).ok).toBe(false);
    expect(checkOverride(METRIC_BY_KEY.get('SINGLE_SUPPLIER_SHARE_PCT')!, 60, 100, 100)).toMatchObject({
      ok: true,
      relaxes: true,
      loosest: 100,
    });
  });
});

const line = (over: Partial<SpendLine> & Pick<SpendLine, 'company' | 'spend'>): SpendLine => ({
  supplierId: over.company,
  organisationSpend: over.spend,
  esg: {},
  ...over,
});

describe('NFR-R05 figures worked out from awards and declared ESG data', () => {
  it('shares of contract value by declared ownership, with the sums shown', () => {
    const a = actualsFromSpend(
      [
        line({ company: 'Koori Cleaning', spend: 4_800, esg: { diversityOwned: 'INDIGENOUS' } }),
        line({ company: 'Big Clean', spend: 115_200, esg: { diversityOwned: 'NONE' } }),
      ],
      1_000_000,
    );
    expect(a.INDIGENOUS_SPEND_PCT).toEqual({
      value: 4,
      arithmetic: 'Indigenous-owned spend $4,800 of $120,000 contract value = 4%',
    });
    expect(a.SOCIAL_ENTERPRISE_SPEND_PCT?.value).toBe(0);
    expect(a.DISABILITY_EMPLOYMENT_SPEND_PCT?.value).toBe(0);
    expect(a.SUPPLIER_DIVERSITY_PCT?.value).toBe(4);
  });
  it('a zero contract value gives no ratio, with the reason, and never divides by zero', () => {
    const a = actualsFromSpend(
      [line({ company: 'Free Co', spend: 0, esg: { diversityOwned: 'INDIGENOUS' } })],
      0,
    );
    expect(a.INDIGENOUS_SPEND_PCT).toEqual({
      value: null,
      arithmetic: 'The contract value is zero, so a share cannot be worked out',
    });
    expect(a.SINGLE_SUPPLIER_SHARE_PCT).toBeUndefined();
    expect(actualsFromSpend([], 100)).toEqual({});
  });
  it('carbon intensity uses only suppliers that reported, per million dollars, rounded', () => {
    const a = actualsFromSpend(
      [
        line({ company: 'A', spend: 600_000, esg: { carbonTonnesCo2e: 90 } }),
        line({ company: 'B', spend: 400_000, esg: {} }), // did not report: not in the sum or the base
      ],
      1_000_000,
    );
    expect(a.CARBON_INTENSITY_T_PER_M).toEqual({
      value: 150,
      arithmetic: 'Reported emissions 90 t CO2e over $600,000 contract value = 150 t per $m',
    });
    const none = actualsFromSpend([line({ company: 'A', spend: 10, esg: {} })], 10);
    expect(none.CARBON_INTENSITY_T_PER_M?.value).toBeNull();
    const odd = actualsFromSpend([line({ company: 'A', spend: 7_000, esg: { carbonTonnesCo2e: 1 } })], 7_000);
    expect(odd.CARBON_INTENSITY_T_PER_M?.value).toBe(142.86); // 1 / 0.007
  });
  it('modern slavery: the worst rating among the suppliers, and no rating is no data', () => {
    expect(slaveryRating({ modernSlaveryResult: 'REVIEW' })).toBe(3);
    expect(slaveryRating({ modernSlaveryStatement: true })).toBe(1);
    expect(slaveryRating({ modernSlaveryResult: 'CLEAR' })).toBe(2);
    expect(slaveryRating({})).toBeNull();
    const a = actualsFromSpend(
      [
        line({ company: 'Good', spend: 10, esg: { modernSlaveryStatement: true } }),
        line({ company: 'Flagged', spend: 10, esg: { modernSlaveryResult: 'REVIEW' } }),
      ],
      20,
    );
    expect(a.MODERN_SLAVERY_RISK).toEqual({
      value: 3,
      arithmetic: 'Highest rating is High (3), for Flagged',
    });
    expect(actualsFromSpend([line({ company: 'x', spend: 1 })], 1).MODERN_SLAVERY_RISK?.value).toBeNull();
  });
  it('concentration: the largest supplier share of all the organisation contract spend', () => {
    const a = actualsFromSpend(
      [
        line({ company: 'Alpha', spend: 100_000, organisationSpend: 450_000 }),
        line({ company: 'Beta', spend: 50_000, organisationSpend: 90_000 }),
      ],
      900_000,
    );
    expect(a.SINGLE_SUPPLIER_SHARE_PCT).toEqual({
      value: 50,
      arithmetic: 'Alpha holds $450,000 of $900,000 contract spend = 50%',
    });
  });
});

describe('NFR-R05 the plan gate and the sentence', () => {
  it('is required while any breach has no acknowledged exception, and satisfied otherwise', () => {
    expect(gateOf([{ key: 'LOCAL_CONTENT_PCT', status: 'PASS', excepted: false }])).toBe('SATISFIED');
    expect(gateOf([{ key: 'LOCAL_CONTENT_PCT', status: 'AT_RISK', excepted: false }])).toBe('SATISFIED');
    expect(gateOf([{ key: 'LOCAL_CONTENT_PCT', status: 'NO_DATA', excepted: false }])).toBe('SATISFIED');
    expect(gateOf([{ key: 'LOCAL_CONTENT_PCT', status: 'BREACH', excepted: false }])).toBe('REQUIRED');
    expect(gateOf([{ key: 'LOCAL_CONTENT_PCT', status: 'BREACH', excepted: true }])).toBe('SATISFIED');
    expect(
      gateOf([
        { key: 'LOCAL_CONTENT_PCT', status: 'BREACH', excepted: true },
        { key: 'SME_PANEL_PCT', status: 'BREACH', excepted: false },
      ]),
    ).toBe('REQUIRED');
    expect(gateOf([])).toBe('SATISFIED');
  });
  it('states each result in one line a reader can check', () => {
    expect(summaryLine(METRIC_BY_KEY.get('INDIGENOUS_SPEND_PCT')!, 4, 5)).toBe(
      'Indigenous-owned spend 4% of contract value vs target 5%',
    );
    expect(summaryLine(METRIC_BY_KEY.get('CARBON_INTENSITY_T_PER_M')!, 150, 120)).toBe(
      'Carbon intensity 150 t per $m vs ceiling 120 t per $m',
    );
    expect(summaryLine(METRIC_BY_KEY.get('MODERN_SLAVERY_RISK')!, 3, 2)).toBe(
      'Highest modern slavery risk rating High (3) vs ceiling Medium (2)',
    );
    expect(summaryLine(METRIC_BY_KEY.get('LOCAL_CONTENT_PCT')!, null, 20)).toBe(
      'Local content has no figure yet vs target 20%',
    );
  });
  it('defines the nine metrics with a limit range each', () => {
    expect(ESG_METRICS).toHaveLength(9);
    expect(
      ESG_METRICS.filter((m) => m.kind === 'CEILING')
        .map((m) => m.key)
        .sort(),
    ).toEqual(['CARBON_INTENSITY_T_PER_M', 'MODERN_SLAVERY_RISK', 'SINGLE_SUPPLIER_SHARE_PCT']);
  });
});
