import { describe, expect, it } from 'vitest';
import { parseAlert } from './alert-text.js';
import { leadsFrom, scheduleAlerts } from './dates.js';
import { deviationBlockers, needsDecision, proposeRisk } from './deviation.js';

describe('deviation risk (US-CON-02)', () => {
  const t = 'The Supplier holds public liability and professional indemnity insurance for the whole term.';
  it('proposes a rating from the kind of clause and the wording', () => {
    expect(
      proposeRisk({ mandatory: false, templateText: t, currentText: `${t} Certificates on request.` }),
    ).toBe('LOW');
    expect(
      proposeRisk({ mandatory: true, templateText: t, currentText: `${t} Certificates on request.` }),
    ).toBe('MEDIUM');
    expect(proposeRisk({ mandatory: true, templateText: t, currentText: 'Insurance as needed.' })).toBe(
      'HIGH',
    ); // cut by more than 30%
    expect(
      proposeRisk({
        mandatory: true,
        templateText: t,
        currentText: `${t} The Supplier excludes liability for loss.`,
      }),
    ).toBe('HIGH');
    expect(
      proposeRisk({ mandatory: false, templateText: t, currentText: `${t} Liability is unlimited.` }),
    ).toBe('MEDIUM');
    expect(proposeRisk({ mandatory: false, templateText: t, currentText: 'x' })).toBe('MEDIUM');
  });
  it('does not penalise risky words that the template already had', () => {
    const base = 'Liability is unlimited for gross negligence and the customer may terminate.';
    expect(
      proposeRisk({ mandatory: false, templateText: base, currentText: `${base} Notice by email.` }),
    ).toBe('LOW');
  });
  it('needs a decision for mandatory or high-risk deviations only', () => {
    expect(needsDecision({ mandatory: true, risk: 'LOW' })).toBe(true);
    expect(needsDecision({ mandatory: false, risk: 'HIGH' })).toBe(true);
    expect(needsDecision({ mandatory: false, risk: 'MEDIUM' })).toBe(false);
  });
  it('lists what still blocks release', () => {
    expect(
      deviationBlockers([
        { title: 'IP', mandatory: false, risk: 'LOW', decision: null },
        { title: 'Liability', mandatory: true, risk: 'HIGH', decision: null },
        { title: 'Term', mandatory: true, risk: 'MEDIUM', decision: 'REJECTED' },
        { title: 'Price', mandatory: true, risk: 'MEDIUM', decision: 'APPROVED' },
      ]),
    ).toEqual([
      'The change to "Liability" (high risk) needs a delegate\'s approval',
      'The change to "Term" was rejected; restore or reword it',
    ]);
  });
});

describe('plain-language alerts (US-CMG-03)', () => {
  const c = { startDate: '2026-11-01', endDate: '2028-10-31', noticeDays: 90 };
  const ok = (text: string, today = '2026-10-02') => {
    const r = parseAlert(text, c, today);
    if (!r.ok) throw new Error(r.message);
    return r.value;
  };
  it("understands the stakeholder's example", () => {
    const r = ok('alert me 1 year before expiry and include whoever is my manager then');
    expect(r.triggerDate).toBe('2027-10-31');
    expect(r.include).toEqual(['MANAGER']);
    expect(r.recipientRule).toBe('AUTHOR+MANAGER');
    expect(r.summary).toContain('1 year before expiry');
  });
  it('counts days, weeks, months and years from expiry, the notice deadline or the start', () => {
    expect(ok('remind me 30 days before expiry').triggerDate).toBe('2028-10-01');
    expect(ok('alert me 2 weeks before the notice deadline').triggerDate).toBe('2028-07-19'); // notice deadline is 2028-08-02
    expect(ok('alert me three months before the end').triggerDate).toBe('2028-07-31');
    expect(ok('alert me 6 months after commencement').triggerDate).toBe('2027-05-01');
    expect(ok('alert me a month before the start', '2026-09-01').triggerDate).toBe('2026-10-01');
  });
  it('clamps month ends: 6 months before 31 October is 30 April', () => {
    expect(ok('alert me 6 months before expiry').triggerDate).toBe('2028-04-30');
  });
  it('adds named roles and several recipients', () => {
    const r = ok('alert me 3 months before expiry and include legal and include the finance');
    expect(r.recipientRule).toBe('AUTHOR+ROLE:LEGAL+ROLE:FINANCE');
    expect(ok('alert me 3 months before expiry').recipientRule).toBe('AUTHOR');
    expect(ok('alert me 3 months before expiry and also notify the contract manager').include).toEqual([
      'ROLE:CONTRACT_MGR',
    ]);
  });
  it('explains what it could not understand, and refuses dates already past', () => {
    for (const bad of ['remind me sometime', 'alert me before expiry', 'alert me 0 days before expiry']) {
      const r = parseAlert(bad, c, '2026-10-02');
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message).toContain('Try:');
    }
    const past = parseAlert('alert me 2 years before expiry', c, '2027-01-01');
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.message).toContain('already passed');
  });
});

describe('configurable lead times', () => {
  it('reads valid whole days from the tenant config and ignores anything else', () => {
    expect(leadsFrom({ alertLeadDays: { expiry: 90, notice: 30 } })).toEqual({
      expiry: 90,
      notice: 30,
      extension: 30,
      milestone: 14,
    });
    expect(leadsFrom({ alertLeadDays: { expiry: 0, notice: 400, extension: 1.5, milestone: '9' } })).toEqual({
      expiry: 60,
      notice: 60,
      extension: 30,
      milestone: 14,
    });
    expect(leadsFrom(null)).toEqual({ expiry: 60, notice: 60, extension: 30, milestone: 14 });
  });
  it('moves the system alerts with them', () => {
    const base = { endDate: '2027-06-30', noticeDays: 90, milestones: [], extensions: [12] };
    const a = scheduleAlerts(base, '2026-10-01', { expiry: 90, notice: 30, extension: 10, milestone: 7 });
    expect(a.find((x) => x.kind === 'NOTICE')!.triggerDate).toBe('2027-02-30'.replace('02-30', '03-02'));
    expect(a.find((x) => x.kind === 'EXPIRY')!.triggerDate).toBe('2027-04-01');
    expect(a.find((x) => x.kind === 'EXTENSION')!.triggerDate).toBe('2027-03-22');
  });
});
