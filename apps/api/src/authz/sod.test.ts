import { describe, expect, it } from 'vitest';
import { checkSod } from './sod.js';

describe('segregation of duties', () => {
  it('a tender administrator or ADMIN cannot join the evaluation panel (FR-0190)', () => {
    expect(
      checkSod('JOIN_EVALUATION_PANEL', { roles: ['PROCUREMENT'], isTenderAdministrator: true }),
    ).toMatchObject({
      ok: false,
      code: 'ROLE_SOD_VIOLATION',
      rule: 'FR-0190',
    });
    expect(checkSod('JOIN_EVALUATION_PANEL', { roles: ['ADMIN'] })).toMatchObject({ ok: false });
    expect(checkSod('JOIN_EVALUATION_PANEL', { roles: ['EVALUATOR'] })).toEqual({ ok: true });
  });
  it('supplier users can never evaluate', () => {
    expect(checkSod('JOIN_EVALUATION_PANEL', { roles: ['SUPPLIER'], isSupplierUser: true })).toMatchObject({
      ok: false,
      rule: 'SEC-A03',
    });
  });
  it('panel members cannot administer the tender', () => {
    expect(checkSod('ADMINISTER_TENDER', { roles: ['EVALUATOR'], isPanelMember: true })).toMatchObject({
      ok: false,
    });
    expect(checkSod('ADMINISTER_TENDER', { roles: ['PROCUREMENT'] })).toEqual({ ok: true });
  });
  it('maker-checker: you cannot approve what you authored', () => {
    expect(checkSod('APPROVE_OWN_SUBJECT', { roles: ['DELEGATE'], isAuthorOfSubject: true })).toMatchObject({
      ok: false,
      rule: 'SEC-AC06',
    });
    expect(checkSod('APPROVE_OWN_SUBJECT', { roles: ['DELEGATE'] })).toEqual({ ok: true });
  });
  it('sourcing approval does NOT confer signing authority (SEC-AC05)', () => {
    const r = checkSod('SIGN_CONTRACT', {
      roles: ['DELEGATE'],
      approvedSourcing: true,
      hasSigningDelegation: false,
    });
    expect(r).toMatchObject({ ok: false, rule: 'SEC-AC05' });
    expect((r as { message: string }).message).toMatch(/Sourcing approval does not confer/);
    expect(checkSod('SIGN_CONTRACT', { roles: ['DELEGATE'], hasSigningDelegation: true })).toEqual({
      ok: true,
    });
  });
  it('an ADMIN-only user has no path to bid content; ADMIN who is also procurement is judged on that role', () => {
    expect(checkSod('ACCESS_BID_CONTENT', { roles: ['ADMIN'] })).toMatchObject({
      ok: false,
      rule: 'SEC-AC13',
    });
    expect(checkSod('ACCESS_BID_CONTENT', { roles: ['ADMIN', 'PROCUREMENT'] })).toEqual({ ok: true });
  });
  it('the pack author cannot grant their own permission to publish', () => {
    expect(checkSod('PUBLISH_PERMISSION', { roles: ['DELEGATE'], isAuthorOfSubject: true })).toMatchObject({
      ok: false,
    });
  });
});
