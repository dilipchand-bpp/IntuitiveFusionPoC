import { describe, expect, it } from 'vitest';
import {
  EXEC_COSIGN_ABOVE,
  SERVICES_TEMPLATE,
  WORKS_TEMPLATE,
  assembleClauses,
  fill,
  nextNumber,
  pickTemplate,
  releaseBlockers,
  requiredSigners,
  type ContractFacts,
} from './clauses.js';

const facts: ContractFacts = {
  customer: 'Meridian Group',
  supplier: 'Brightwave Cleaning Pty Ltd',
  abn: '51 824 753 556',
  title: 'Facilities cleaning',
  requestNumber: 'PR-2026-0001',
  value: 90_000,
  startDate: '2026-11-01',
  endDate: '2028-10-31',
  noticeDays: 90,
  serviceLevels: 'respond to critical incidents within 15 minutes.',
};

describe('clause assembly (US-CON-01)', () => {
  it('fills the supplier, price, dates and service levels into every clause', () => {
    const out = assembleClauses(SERVICES_TEMPLATE, facts);
    const text = out.map((c) => c.text).join('\n');
    expect(text).toContain('Brightwave Cleaning Pty Ltd');
    expect(text).toContain('$90,000');
    expect(text).toContain('1 November 2026');
    expect(text).toContain('31 October 2028');
    expect(text).toContain('15 minutes');
    expect(text).not.toMatch(/\{\{/);
  });

  it('keeps every mandatory clause of the library, in library order, none marked as changed', () => {
    for (const tpl of [SERVICES_TEMPLATE, WORKS_TEMPLATE]) {
      const out = assembleClauses(tpl, facts);
      expect(out.map((c) => c.clauseId)).toEqual(tpl.clauses.map((c) => c.id));
      const mandatory = tpl.clauses.filter((c) => c.mandatory).map((c) => c.id);
      expect(mandatory.length).toBeGreaterThanOrEqual(5);
      expect(out.filter((c) => c.mandatory).map((c) => c.clauseId)).toEqual(mandatory);
      expect(out.every((c) => !c.changedFromTemplate)).toBe(true);
    }
  });

  it('leaves an unknown placeholder visible so a reviewer can see it', () => {
    expect(fill('Hello {{NOPE}} {{SUPPLIER}}', facts)).toBe('Hello {{NOPE}} Brightwave Cleaning Pty Ltd');
  });
});

describe('template selection', () => {
  const templates = [
    { id: 'tpl-services-std', body: SERVICES_TEMPLATE },
    { id: 'tpl-works-std', body: WORKS_TEMPLATE },
    { id: 'tpl-rft', body: {} },
  ];
  it('matches the template to the tender route', () => {
    expect(pickTemplate(templates, 'RFT')?.id).toBe('tpl-works-std');
    expect(pickTemplate(templates, 'RFP')?.id).toBe('tpl-services-std');
    expect(pickTemplate(templates, 'RFQ')?.id).toBe('tpl-services-std');
    expect(pickTemplate(templates, 'RFI')).toBeNull();
  });
});

describe('release rules', () => {
  const ok = { value: 1, startDate: '2026-01-01', endDate: '2027-01-01' };
  it('blocks an emptied mandatory clause, a leftover placeholder, and bad dates or value', () => {
    expect(releaseBlockers(ok, [{ title: 'Term', text: 'A real clause wording.', mandatory: true }])).toEqual(
      [],
    );
    expect(releaseBlockers(ok, [{ title: 'Term', text: ' ', mandatory: true }])).toEqual([
      'Mandatory clause "Term" is empty',
    ]);
    expect(
      releaseBlockers(ok, [{ title: 'IP', text: 'Owned by {{SUPPLIER}} always', mandatory: false }]),
    ).toEqual(['Clause "IP" still has an unfilled placeholder']);
    expect(releaseBlockers({ ...ok, value: 0 }, [])).toContain('The contract value is missing');
    expect(releaseBlockers({ ...ok, endDate: '2026-01-01' }, [])).toContain(
      'The end date must be after the start date',
    );
    expect(releaseBlockers({ ...ok, startDate: null }, [])).toContain('Start and end dates are required');
  });
});

describe('signing chain and numbering', () => {
  it('needs the executive too above the co-sign threshold, exactly at it only the delegate', () => {
    expect(requiredSigners(EXEC_COSIGN_ABOVE).map((s) => s.role)).toEqual(['DELEGATE']);
    expect(requiredSigners(EXEC_COSIGN_ABOVE + 1).map((s) => s.role)).toEqual(['DELEGATE', 'EXEC']);
  });
  it('numbers contracts in sequence within the year', () => {
    expect(nextNumber(2026, [])).toBe('CT-2026-0001');
    expect(nextNumber(2026, ['CT-2026-0001', 'CT-2026-0007', 'CT-2025-0099'])).toBe('CT-2026-0008');
    expect(nextNumber(2027, ['CT-2026-0007'])).toBe('CT-2027-0001');
  });
});
