/**
 * The rules behind the "Add ..." buttons in Settings: limits (the same as the API's), new-row defaults, and the
 * messages shown before a save is attempted. Pure, so they are tested without a browser. The API checks everything
 * again; these only turn the common mistakes into plain sentences first.
 */

export const LIST_LIMITS = {
  reviewRules: 30,
  routingRules: 10,
  recipients: 20,
  registers: 8,
  spendAlerts: 5,
  overrides: 30,
  clauses: 20,
  customFields: 20,
  questions: 15,
  mappings: 50,
  tiers: 6,
} as const;

export const BUILT_IN_REGISTERS = ['AusTender', 'SAM.gov', 'TED'] as const;
export const FIXED_SPEND_POINTS = [80, 90, 100] as const;

export type Func = 'IT' | 'LEGAL' | 'CYBER' | 'FINANCE' | 'RISK';
export interface ReviewRule {
  id: string;
  label: string;
  function: Func;
  keywords: string[];
  minValue?: number;
}
export type WorkflowId = 'wf-simple' | 'wf-intermediate' | 'wf-complex' | 'wf-board';
export interface RoutingRule {
  id: string;
  label: string;
  words: string[];
  minValue?: number;
  workflow: WorkflowId;
}
export type NotifyEvent = 'BUDGET_BREACH' | 'DELEGATE_ACTION' | 'APPROVAL_TIMEOUT';
export interface Recipient {
  event: NotifyEvent;
  role: string;
}
export interface Register {
  register: string;
  jurisdiction: string;
  minValueAud: number;
  enabled: boolean;
}
export interface CapacityOverride {
  userId: string;
  capacity: number;
}

/** A key the API accepts (a lower-case letter then letters and digits) that no other row uses. */
export function nextKey(prefix: string, taken: readonly string[]): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** "a, b ,C" becomes ["a", "b", "c"]: words are matched without regard to case. */
export const parseWords = (text: string): string[] =>
  text
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

export function checkReviewRules(rules: readonly ReviewRule[]): string[] {
  const out: string[] = [];
  rules.forEach((r, i) => {
    if (!r.label.trim()) out.push(`Review rule ${i + 1} needs a name.`);
    if (r.keywords.length === 0 && r.minValue === undefined)
      out.push(`Review rule ${i + 1} needs at least one word or a value, or it would never apply.`);
    if (r.keywords.some((k) => k.length < 2))
      out.push(`Review rule ${i + 1}: each word needs at least two letters.`);
    if (r.minValue !== undefined && !(r.minValue >= 0))
      out.push(`Review rule ${i + 1}: the value cannot be negative.`);
  });
  if (rules.length > LIST_LIMITS.reviewRules) out.push(`At most ${LIST_LIMITS.reviewRules} review rules.`);
  return out;
}

export function checkRoutingRules(rules: readonly RoutingRule[]): string[] {
  const out: string[] = [];
  rules.forEach((r, i) => {
    if (!r.label.trim()) out.push(`Routing rule ${i + 1} needs a name.`);
    if (r.words.length === 0) out.push(`Routing rule ${i + 1} needs at least one word to look for.`);
    if (r.words.some((w) => w.length < 2))
      out.push(`Routing rule ${i + 1}: each word needs at least two letters.`);
    if (r.minValue !== undefined && !(r.minValue >= 0))
      out.push(`Routing rule ${i + 1}: the value cannot be negative.`);
  });
  if (rules.length > LIST_LIMITS.routingRules) out.push(`At most ${LIST_LIMITS.routingRules} routing rules.`);
  return out;
}

export function checkRecipients(rows: readonly Recipient[]): string[] {
  const out: string[] = [];
  if (!unique(rows.map((r) => `${r.event}:${r.role}`))) out.push('Each role can be added once for an event.');
  if (rows.length > LIST_LIMITS.recipients) out.push(`At most ${LIST_LIMITS.recipients} extra recipients.`);
  return out;
}

export function checkRegisters(rows: readonly Register[]): string[] {
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (r.register.trim().length < 2) out.push(`Register ${i + 1} needs a name of at least two letters.`);
    if (r.jurisdiction.trim().length < 2) out.push(`Register ${i + 1} needs a jurisdiction.`);
    if (!(r.minValueAud >= 0)) out.push(`Register ${i + 1}: the value cannot be negative.`);
  });
  if (!unique(rows.map((r) => r.register.trim().toLowerCase()))) out.push('Each register can appear once.');
  if (rows.length > LIST_LIMITS.registers) out.push(`At most ${LIST_LIMITS.registers} registers.`);
  return out;
}

export function checkSpendAlerts(points: readonly number[], main: number): string[] {
  const out: string[] = [];
  points.forEach((p, i) => {
    if (!Number.isInteger(p) || p < 1 || p > 99)
      out.push(`Extra alert point ${i + 1} must be a whole number from 1 to 99.`);
    else if ((FIXED_SPEND_POINTS as readonly number[]).includes(p))
      out.push(`Extra alert point ${i + 1}: the fixed notices at 80, 90 and 100 per cent already exist.`);
    else if (p === main) out.push(`Extra alert point ${i + 1} is the same as the main spend alert.`);
  });
  if (new Set(points).size !== points.length) out.push('Each alert point can appear once.');
  if (points.length > LIST_LIMITS.spendAlerts)
    out.push(`At most ${LIST_LIMITS.spendAlerts} extra alert points.`);
  return out;
}

export function checkOverrides(rows: readonly CapacityOverride[]): string[] {
  const out: string[] = [];
  rows.forEach((o, i) => {
    if (!o.userId) out.push(`Capacity override ${i + 1}: choose a manager.`);
    if (!Number.isInteger(o.capacity) || o.capacity < 1 || o.capacity > 200)
      out.push(`Capacity override ${i + 1}: use a whole number from 1 to 200.`);
  });
  if (!unique(rows.map((o) => o.userId))) out.push('Each manager can appear once.');
  if (rows.length > LIST_LIMITS.overrides) out.push(`At most ${LIST_LIMITS.overrides} overrides.`);
  return out;
}

export function checkClauses(ids: readonly string[]): string[] {
  const out: string[] = [];
  ids.forEach((c, i) => {
    if (!c.trim()) out.push(`Protected clause ${i + 1} is empty.`);
    if (c.length > 60) out.push(`Protected clause ${i + 1} is longer than 60 characters.`);
  });
  if (!unique(ids.map((c) => c.trim().toUpperCase()))) out.push('Each clause can appear once.');
  if (ids.length > LIST_LIMITS.clauses) out.push(`At most ${LIST_LIMITS.clauses} protected clauses.`);
  return out;
}
