/**
 * Segregation of duties (SEC-AC05, SEC-AC06, FR-0190, FR-0410). Pure functions: given who the actor is and what
 * they already do on the same procurement, say whether the action is allowed and why not.
 */
import type { RoleName } from '@if/shared';

export type SodViolation = { code: 'ROLE_SOD_VIOLATION'; rule: string; message: string };
export type SodResult = { ok: true } | ({ ok: false } & SodViolation);

const deny = (rule: string, message: string): SodResult => ({
  ok: false,
  code: 'ROLE_SOD_VIOLATION',
  rule,
  message,
});

export interface ProcurementInvolvement {
  /** Roles the actor holds in the whole tenant. */
  roles: readonly RoleName[];
  /** Did the actor administer / run this tender (Procurement or Tender Administrator)? */
  isTenderAdministrator?: boolean;
  /** Is the actor the person who raised or authored the thing being approved? */
  isAuthorOfSubject?: boolean;
  /** Has the actor already approved the sourcing decision for this procurement? */
  approvedSourcing?: boolean;
  /** Does the actor hold a CONTRACT_SIGNING delegation covering the contract value? */
  hasSigningDelegation?: boolean;
  /** Is the actor a member of the evaluation panel for this tender? */
  isPanelMember?: boolean;
  /** Is the actor a supplier-side user? */
  isSupplierUser?: boolean;
}

export type SodAction =
  | 'JOIN_EVALUATION_PANEL' // FR-0190: tender administrators may not evaluate
  | 'ADMINISTER_TENDER' // converse: panel members may not administer
  | 'APPROVE_OWN_SUBJECT' // maker-checker
  | 'SIGN_CONTRACT' // signing authority is separate from sourcing authority
  | 'ACCESS_BID_CONTENT' // ADMIN never reads bids (SEC-AC13)
  | 'PUBLISH_PERMISSION'; // the person who built the pack cannot also grant permission to publish

export function checkSod(action: SodAction, a: ProcurementInvolvement): SodResult {
  switch (action) {
    case 'JOIN_EVALUATION_PANEL':
      if (a.isTenderAdministrator || a.roles.includes('ADMIN')) {
        return deny('FR-0190', 'Tender administrators cannot be evaluators on the same tender.');
      }
      if (a.isSupplierUser) return deny('SEC-A03', 'Supplier users cannot join an evaluation panel.');
      return { ok: true };
    case 'ADMINISTER_TENDER':
      if (a.isPanelMember)
        return deny('FR-0190', 'Evaluation panel members cannot administer the same tender.');
      return { ok: true };
    case 'APPROVE_OWN_SUBJECT':
      if (a.isAuthorOfSubject)
        return deny('SEC-AC06', 'You cannot approve something you authored (maker-checker).');
      return { ok: true };
    case 'SIGN_CONTRACT':
      // Having approved the sourcing decision grants NO signing authority; a separate delegation is mandatory.
      if (!a.hasSigningDelegation) {
        return deny(
          'SEC-AC05',
          a.approvedSourcing
            ? 'Sourcing approval does not confer contract signing authority.'
            : 'No signing delegation covers this contract value.',
        );
      }
      return { ok: true };
    case 'ACCESS_BID_CONTENT':
      if (a.roles.includes('ADMIN') && a.roles.every((r) => r === 'ADMIN')) {
        return deny('SEC-AC13', 'Administrators have no access path to bid content.');
      }
      return { ok: true };
    case 'PUBLISH_PERMISSION':
      if (a.isTenderAdministrator || a.isAuthorOfSubject)
        return deny('SEC-AC06', 'Permission to publish must come from someone other than the pack author.');
      return { ok: true };
  }
}
