import type { RoleName } from '@if/shared';

export const ROLE_LABEL: Record<RoleName, string> = {
  REQUESTER: 'Requester',
  PROCUREMENT: 'Procurement team',
  DELEGATE: 'Delegate (approver)',
  EVALUATOR: 'Evaluator',
  CHAIR: 'Evaluation chair',
  LEGAL: 'Legal',
  CONTRACT_MGR: 'Contract manager',
  PROBITY: 'Probity and risk officer',
  FINANCE: 'Finance',
  ADMIN: 'Administrator',
  EXEC: 'Executive',
  SUPPLIER: 'Supplier',
};
