/**
 * Attribute-based rules layered on top of the role guard (Technical Specification 5.2, "ABAC rules").
 * Pure functions over plain data so every rule is unit-testable and later reusable by SQL filters.
 */
import type { RoleName } from '@if/shared';

export interface Subject {
  userId: string;
  roles: readonly RoleName[];
  orgUnitId?: string | null;
  supplierId?: string | null;
}

// ---- (1) Stream isolation for bid content (FR-0260, SEC-AC07, SEC-AC13)
export type Stream = 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
export interface BidFile {
  section: Stream;
  supplierId: string;
}
export interface EvaluatorState {
  stream?: Stream;
  /** True once the evaluator has a clear COI declaration for this evaluation. */
  coiCleared: boolean;
}

export function canViewBidFile(s: Subject, file: BidFile, ev?: EvaluatorState): boolean {
  if (s.roles.includes('SUPPLIER')) return s.supplierId === file.supplierId; // suppliers: own bid only
  if (s.roles.some((r) => r === 'PROCUREMENT' || r === 'PROBITY' || r === 'LEGAL')) return true;
  if (s.roles.includes('CHAIR')) return ev?.coiCleared ?? false; // chair sees all streams, but only after COI
  if (s.roles.includes('EVALUATOR')) {
    if (!ev?.coiCleared) return false; // vendor identities/documents withheld until COI declared
    if (file.section === 'COMMERCIAL' && ev.stream === 'TECHNICAL') return false; // no pricing for technical stream
    return ev.stream === file.section || ev.stream === 'OTHER' || file.section === 'OTHER';
  }
  return false; // ADMIN, DELEGATE, FINANCE, EXEC, REQUESTER, CONTRACT_MGR: no bid content
}

// ---- (2) Project sensitivity restriction (SEC-AC02)
export interface Sensitivity {
  restrictedTo?: readonly string[] | null; // when set, only these users (plus override roles) may see the record
}
export function passesSensitivity(s: Subject, rec: Sensitivity): boolean {
  if (!rec.restrictedTo || rec.restrictedTo.length === 0) return true;
  return rec.restrictedTo.includes(s.userId) || s.roles.includes('PROBITY');
}

// ---- (3) Hierarchy (SEC-AC08): division heads see their division, team leads their team, requesters their own
export interface OrgNode {
  id: string;
  parentId: string | null;
}
export function descendants(units: readonly OrgNode[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units)
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
  }
  return out;
}

export interface Visible {
  ownerUserId: string;
  orgUnitId: string | null;
  participantUserIds?: readonly string[];
}
/** Portfolio-wide roles see everything in the tenant; others see own, assigned, or within their org subtree. */
const PORTFOLIO: readonly RoleName[] = ['PROCUREMENT', 'EXEC', 'PROBITY', 'FINANCE'];
export function canSeeRecord(
  s: Subject,
  rec: Visible,
  units: readonly OrgNode[],
  sens: Sensitivity = {},
): boolean {
  if (!passesSensitivity(s, sens)) return false;
  if (s.roles.includes('SUPPLIER')) return false;
  if (s.roles.some((r) => PORTFOLIO.includes(r))) return true;
  if (rec.ownerUserId === s.userId || rec.participantUserIds?.includes(s.userId)) return true;
  if (
    s.orgUnitId &&
    rec.orgUnitId &&
    s.roles.some((r) => r === 'DELEGATE' || r === 'CONTRACT_MGR' || r === 'LEGAL')
  ) {
    return descendants(units, s.orgUnitId).has(rec.orgUnitId);
  }
  return false;
}

// ---- (4) Evaluator scores: own only until consensus opens (mirrors the RLS policy; defence in depth)
export function canReadScore(s: Subject, score: { evaluatorId: string }, evaluationStatus: string): boolean {
  if (score.evaluatorId === s.userId) return true;
  const opened = !['COI_PENDING', 'SCORING'].includes(evaluationStatus);
  return opened && (s.roles.includes('CHAIR') || s.roles.includes('PROBITY'));
}
