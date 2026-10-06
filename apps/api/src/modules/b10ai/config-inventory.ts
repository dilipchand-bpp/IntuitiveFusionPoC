/**
 * Configuration inventory (NFR-M05): every tenant setting, what it is for, and the screen where an authorised person changes it.
 *
 * `SECTION_EDITORS` is typed `Record<SectionName, ...>`, so a new section in settings.ts without an entry here does not
 * compile, and a test checks the same thing at run time. That is the guarantee behind "all tenant configuration is
 * changeable without a release": nothing can be added that has no screen.
 */
import {
  ZodArray,
  ZodDefault,
  ZodEffects,
  ZodEnum,
  ZodLiteral,
  ZodObject,
  ZodOptional,
  ZodRecord,
  type ZodTypeAny,
} from 'zod';
import { SECTIONS, type SectionName } from '../settings/settings.js';

export interface SectionEditor {
  /** The page where the section is edited. */
  screen: string;
  /** The panel or heading on that page. */
  panel: string;
  /** Who may edit it. Every tenant setting is an administrator's, except where a screen says otherwise. */
  roles: readonly string[];
}

const S = '/admin/settings';
const ADMIN = ['ADMIN'] as const;

export const SECTION_EDITORS: Record<SectionName, SectionEditor> = {
  numbering: { screen: S, panel: 'Procurement numbers', roles: ADMIN },
  fieldLabels: { screen: S, panel: 'Field labels', roles: ADMIN },
  customFields: { screen: S, panel: 'Custom fields', roles: ADMIN },
  checkpoints: { screen: S, panel: 'Mandatory checkpoints', roles: ADMIN },
  intake: { screen: S, panel: 'Intake rules', roles: ADMIN },
  notifications: { screen: S, panel: 'Notifications', roles: ADMIN },
  onboardingQuestions: { screen: S, panel: 'Supplier onboarding questions', roles: ADMIN },
  publicRegisters: { screen: S, panel: 'Public registers', roles: ADMIN },
  criteriaLibrary: { screen: S, panel: 'Criteria library', roles: ADMIN },
  evaluationRules: { screen: S, panel: 'Evaluation rules', roles: ADMIN },
  contractRules: { screen: S, panel: 'Contract rules', roles: ADMIN },
  contractManagement: { screen: S, panel: 'Contract management', roles: ADMIN },
  dashboards: { screen: S, panel: 'Dashboards and workload', roles: ADMIN },
  tenderRules: { screen: S, panel: 'Opening high-value bids', roles: ADMIN },
  ratings: { screen: S, panel: 'Supplier ratings', roles: ADMIN },
  legalPlatform: { screen: S, panel: 'Legal platform', roles: ADMIN },
  approvalLinks: { screen: S, panel: 'Approve from a link', roles: ADMIN },
  currency: { screen: S, panel: 'Currency and exchange rates', roles: ADMIN },
  artefacts: { screen: S, panel: 'Reports and plans following changes', roles: ADMIN },
  buying: { screen: S, panel: 'Buying assistant', roles: ADMIN },
  externalSearch: { screen: S, panel: 'Outside AI search', roles: ADMIN },
  branding: { screen: S, panel: 'Branding', roles: ADMIN },
  analytics: { screen: S, panel: 'Analytics', roles: ADMIN },
  security: { screen: S, panel: 'Sign-in security', roles: ADMIN },
  erpFieldMap: { screen: S, panel: 'ERP field names', roles: ADMIN },
  workflowRouting: { screen: S, panel: 'Workflow routing', roles: ADMIN },
  ai: { screen: '/admin/ai-models', panel: 'Active model and approvals', roles: ADMIN },
  performance: { screen: '/admin/performance', panel: 'Budget check target', roles: ADMIN },
};

export interface FieldInfo {
  name: string;
  kind: string;
}

function kindOf(z: ZodTypeAny): string {
  let t: ZodTypeAny = z;
  for (;;) {
    if (t instanceof ZodEffects) t = t.innerType();
    else if (t instanceof ZodOptional || t instanceof ZodDefault)
      t = (t._def as { innerType: ZodTypeAny }).innerType;
    else break;
  }
  if (t instanceof ZodEnum) return `one of ${(t.options as string[]).join(' | ')}`;
  if (t instanceof ZodLiteral) return `fixed ${JSON.stringify(t.value)}`;
  if (t instanceof ZodArray) return 'list';
  if (t instanceof ZodRecord) return 'map';
  if (t instanceof ZodObject) return 'group';
  const n = String(t._def.typeName ?? 'value')
    .replace('Zod', '')
    .toLowerCase();
  return n === 'string' ? 'text' : n;
}

/** The fields of a section, read from its schema so the inventory can never drift from what is validated. */
export function fieldsOf(name: SectionName): FieldInfo[] {
  let t: ZodTypeAny = SECTIONS[name];
  while (t instanceof ZodEffects) t = t.innerType();
  if (t instanceof ZodObject)
    return Object.entries(t.shape as Record<string, ZodTypeAny>).map(([k, v]) => ({
      name: k,
      kind: kindOf(v),
    }));
  return [{ name: '(whole section)', kind: kindOf(t) }];
}
