import { describe, expect, it } from 'vitest';
import {
  canReadScore,
  canSeeRecord,
  canViewBidFile,
  descendants,
  passesSensitivity,
  type OrgNode,
  type Subject,
} from './abac.js';

const sub = (roles: Subject['roles'], extra: Partial<Subject> = {}): Subject => ({
  userId: 'u1',
  roles,
  ...extra,
});
const tech = { stream: 'TECHNICAL' as const, coiCleared: true };
const comm = { stream: 'COMMERCIAL' as const, coiCleared: true };

describe('bid file visibility (stream isolation)', () => {
  const pricing = { section: 'COMMERCIAL' as const, supplierId: 's1' };
  const technical = { section: 'TECHNICAL' as const, supplierId: 's1' };
  it('technical evaluators can never see pricing, with or without COI', () => {
    expect(canViewBidFile(sub(['EVALUATOR']), pricing, tech)).toBe(false);
    expect(canViewBidFile(sub(['EVALUATOR']), technical, tech)).toBe(true);
  });
  it('commercial evaluators see pricing but not technical response', () => {
    expect(canViewBidFile(sub(['EVALUATOR']), pricing, comm)).toBe(true);
    expect(canViewBidFile(sub(['EVALUATOR']), technical, comm)).toBe(false);
  });
  it('nobody on the panel sees anything before the COI declaration', () => {
    expect(canViewBidFile(sub(['EVALUATOR']), technical, { stream: 'TECHNICAL', coiCleared: false })).toBe(
      false,
    );
    expect(canViewBidFile(sub(['CHAIR']), technical, { coiCleared: false })).toBe(false);
    expect(canViewBidFile(sub(['EVALUATOR']), technical)).toBe(false);
  });
  it('ADMIN, DELEGATE, FINANCE, EXEC, REQUESTER, CONTRACT_MGR have no bid access', () => {
    for (const r of ['ADMIN', 'DELEGATE', 'FINANCE', 'EXEC', 'REQUESTER', 'CONTRACT_MGR'] as const) {
      expect(canViewBidFile(sub([r]), pricing, tech)).toBe(false);
      expect(canViewBidFile(sub([r]), technical, comm)).toBe(false);
    }
  });
  it('procurement, legal and probity can read; suppliers only their own bid', () => {
    for (const r of ['PROCUREMENT', 'LEGAL', 'PROBITY'] as const)
      expect(canViewBidFile(sub([r]), pricing)).toBe(true);
    expect(canViewBidFile(sub(['SUPPLIER'], { supplierId: 's1' }), pricing)).toBe(true);
    expect(canViewBidFile(sub(['SUPPLIER'], { supplierId: 's2' }), pricing)).toBe(false);
  });
});

describe('sensitivity', () => {
  it('restricted records are visible only to listed users (and probity)', () => {
    expect(passesSensitivity(sub(['PROCUREMENT']), { restrictedTo: ['x'] })).toBe(false);
    expect(passesSensitivity(sub(['PROCUREMENT'], { userId: 'x' }), { restrictedTo: ['x'] })).toBe(true);
    expect(passesSensitivity(sub(['PROBITY']), { restrictedTo: ['x'] })).toBe(true);
    expect(passesSensitivity(sub(['PROCUREMENT']), {})).toBe(true);
  });
});

describe('hierarchy', () => {
  const units: OrgNode[] = [
    { id: 'corp', parentId: null },
    { id: 'ops', parentId: 'corp' },
    { id: 'fac', parentId: 'ops' },
    { id: 'it', parentId: 'corp' },
  ];
  it('descendants includes self and all children, not siblings or parents', () => {
    expect([...descendants(units, 'ops')].sort()).toEqual(['fac', 'ops']);
  });
  it('a division head sees their subtree only', () => {
    const head = sub(['DELEGATE'], { orgUnitId: 'ops' });
    expect(canSeeRecord(head, { ownerUserId: 'z', orgUnitId: 'fac' }, units)).toBe(true);
    expect(canSeeRecord(head, { ownerUserId: 'z', orgUnitId: 'it' }, units)).toBe(false);
  });
  it('a requester sees only their own or ones they participate in', () => {
    const r = sub(['REQUESTER'], { orgUnitId: 'fac' });
    expect(canSeeRecord(r, { ownerUserId: 'u1', orgUnitId: 'fac' }, units)).toBe(true);
    expect(canSeeRecord(r, { ownerUserId: 'other', orgUnitId: 'fac' }, units)).toBe(false);
    expect(
      canSeeRecord(r, { ownerUserId: 'other', orgUnitId: 'fac', participantUserIds: ['u1'] }, units),
    ).toBe(true);
  });
  it('portfolio roles see all but a sensitivity restriction still applies; suppliers see none', () => {
    expect(canSeeRecord(sub(['EXEC']), { ownerUserId: 'z', orgUnitId: 'it' }, units)).toBe(true);
    expect(
      canSeeRecord(sub(['EXEC']), { ownerUserId: 'z', orgUnitId: 'it' }, units, { restrictedTo: ['q'] }),
    ).toBe(false);
    expect(canSeeRecord(sub(['SUPPLIER']), { ownerUserId: 'u1', orgUnitId: 'it' }, units)).toBe(false);
  });
});

describe('score visibility mirrors the database policy', () => {
  it('own always; chair/probity only once consensus opens', () => {
    expect(canReadScore(sub(['EVALUATOR']), { evaluatorId: 'u1' }, 'SCORING')).toBe(true);
    expect(canReadScore(sub(['EVALUATOR']), { evaluatorId: 'x' }, 'CONSENSUS')).toBe(false);
    expect(canReadScore(sub(['CHAIR']), { evaluatorId: 'x' }, 'SCORING')).toBe(false);
    expect(canReadScore(sub(['CHAIR']), { evaluatorId: 'x' }, 'CONSENSUS')).toBe(true);
    expect(canReadScore(sub(['PROBITY']), { evaluatorId: 'x' }, 'LOCKED')).toBe(true);
  });
});
