/**
 * Suggested values for mandatory custom request fields the organisation has added (settings, "custom fields"). The Copilot only
 * suggests what a rule can justify from the request itself, and says why; anything else stays with the person. A suggestion is
 * recorded as an assumption on the run so it can be reviewed (CP-02).
 */
import { HIGH_RISK_CATEGORIES } from '../b8/rules.js';

export interface CustomFieldDef {
  key: string;
  label: string;
  type?: 'TEXT' | 'FLAG' | 'NUMBER' | undefined;
}

export interface RequestFacts {
  title: string;
  category: string | null;
  sourceText: string;
}

export interface Suggestion {
  value: string;
  reason: string;
}

const SLAVERY = /slavery|supply.?chain (labour|labor)|forced labou?r/i;

/** The modern slavery screen on a request: the category (or the wording) places it in a higher-risk area, or it does not. */
function modernSlavery(def: CustomFieldDef, f: RequestFacts): Suggestion {
  const hay = `${f.category ?? ''} ${f.title} ${f.sourceText}`;
  const higher = HIGH_RISK_CATEGORIES.test(hay);
  const what = f.category?.trim() || f.title.trim() || 'this purchase';
  if (def.type === 'FLAG')
    return {
      value: higher ? 'true' : 'false',
      reason: higher
        ? `${what} is in a category with a higher modern slavery risk (cleaning, security, construction, catering and similar)`
        : `${what} is not in a category treated as higher risk for modern slavery`,
    };
  return {
    value: higher
      ? `Higher: ${what} is a higher-risk category for modern slavery. Require a modern slavery statement with the bid, supply chain audit rights and termination for breach, and check suppliers before award.`
      : `Lower: ${what} is not in a category treated as higher risk for modern slavery. The standard supplier modern slavery check still applies.`,
    reason: higher
      ? 'Same category list the supplier modern slavery screen uses'
      : 'Not on the higher-risk category list the supplier screen uses',
  };
}

/** A suggestion for one missing mandatory custom field, or null when no rule can justify one (the person is asked instead). */
export function suggestCustomField(def: CustomFieldDef, facts: RequestFacts): Suggestion | null {
  if (def.type === 'NUMBER') return null;
  if (SLAVERY.test(def.label) || SLAVERY.test(def.key)) return modernSlavery(def, facts);
  return null;
}
