/** What a status or a field means, in words (rules-simulated-v1). Used by Ask for "what does this mean". */
export interface Meaning {
  re: RegExp;
  term: string;
  text: string;
}
const MEANINGS: readonly Meaning[] = [
  {
    re: /\bdraft\b/,
    term: 'DRAFT',
    text: 'Started but not yet submitted. Only its owner and the people who may edit it see it as work in progress.',
  },
  {
    re: /\bsubmitted\b/,
    term: 'SUBMITTED',
    text: 'A request that has been submitted and is waiting for procurement to take it and assign a manager.',
  },
  {
    re: /in.?progress/,
    term: 'IN PROGRESS',
    text: 'A procurement that has been taken by a manager and is moving through plan, tender, evaluation and contract.',
  },
  {
    re: /\bblocked\b/,
    term: 'BLOCKED',
    text: 'Something is holding it: a request marked blocked, or an invoice that failed the three-way match. Open it to see the reason.',
  },
  { re: /\bcomplete(d)?\b/, term: 'COMPLETE', text: 'The procurement has finished.' },
  {
    re: /awaiting.?signoff|awaiting sign.?off/,
    term: 'AWAITING SIGNOFF',
    text: 'A plan waiting for its required checks: a conflict declaration and the risk sign-off by the probity officer.',
  },
  {
    re: /awaiting.?approval/,
    term: 'AWAITING APPROVAL',
    text: 'Waiting for a delegate (or executive) whose sourcing approval limit covers the value.',
  },
  {
    re: /approved.?locked|\blocked plan\b/,
    term: 'APPROVED LOCKED',
    text: 'The plan is approved and can no longer be edited unless it is reopened.',
  },
  {
    re: /reopened/,
    term: 'REOPENED',
    text: 'An approved plan that was reopened for changes. It must be submitted and approved again.',
  },
  {
    re: /\bstaged\b/,
    term: 'STAGED',
    text: 'A tender pack that is built but not visible to suppliers until a delegate gives permission and procurement publishes it.',
  },
  { re: /\bpublished\b/, term: 'PUBLISHED', text: 'The tender is open to suppliers until its closing time.' },
  {
    re: /coi.?pending/,
    term: 'COI PENDING',
    text: 'An evaluation where panel members have not all declared a conflict of interest yet. Nobody can score until they have.',
  },
  {
    re: /\bscoring\b/,
    term: 'SCORING',
    text: 'Panel members are scoring on their own. Scores stay hidden from each other until consensus.',
  },
  {
    re: /\bconsensus\b/,
    term: 'CONSENSUS',
    text: 'The chair has opened consensus: scores are compared, variances flagged and agreed scores recorded.',
  },
  {
    re: /\breported\b/,
    term: 'REPORTED',
    text: 'The evaluation report has been generated and waits for approval of the award.',
  },
  {
    re: /legal.?review/,
    term: 'LEGAL REVIEW',
    text: 'A contract being checked by legal before it is released for signing.',
  },
  {
    re: /awaiting.?signature|partially.?signed/,
    term: 'AWAITING SIGNATURE',
    text: 'Released for signing; each required signer signs within their contract signing limit.',
  },
  {
    re: /executed/,
    term: 'EXECUTED',
    text: 'Signed by everyone required. The contract is now managed through obligations, alerts and invoices.',
  },
  {
    re: /waiting.?gate|waiting for a person/,
    term: 'WAITING GATE',
    text: 'A Copilot run stopped at an approval or step only a person may do. Open the run and press "What do I do?".',
  },
  {
    re: /needs.?human|needs a person/,
    term: 'NEEDS HUMAN',
    text: 'The Copilot tried to repair a problem three times and could not. A named person must fix it; the card says what it tried.',
  },
  {
    re: /\bsimulated\b/,
    term: 'SIMULATED',
    text: 'The feature is a fixed set of rules or a stand-in service, not a real model or outside system. It is labelled so on every screen.',
  },
  {
    re: /rules.?simulated.?v1/,
    term: 'rules-simulated-v1',
    text: 'The name of the rules engine that stands in for an AI model. A real model replaces it at the documented swap point.',
  },
  {
    re: /complexity/,
    term: 'Complexity',
    text: 'A score worked out from value, category, supply location and data sensitivity. It decides which gates a request needs.',
  },
  {
    re: /budget check|budget cap/,
    term: 'Budget check',
    text: 'On submit the estimated value is compared with the budget available to the business unit. Over the limit, submission is blocked until the budget is amended or the value falls.',
  },
  {
    re: /estimated value|\bvalue\b/,
    term: 'Estimated value',
    text: 'The expected total cost in Australian dollars. It decides who may approve (sourcing limit), whether the tender is sealed, and who signs.',
  },
  {
    re: /\bterm\b|term months/,
    term: 'Term',
    text: 'The length of the contract in months. The contract start and end dates are worked from it.',
  },
  {
    re: /business unit/,
    term: 'Business unit',
    text: 'The part of the organisation that owns the budget for this procurement.',
  },
  {
    re: /\bcategory\b/,
    term: 'Category',
    text: 'The kind of goods or services. It decides the gates and the classification code.',
  },
  {
    re: /matched/,
    term: 'MATCHED',
    text: 'The invoice agrees with the purchase order and what was received.',
  },
  { re: /exception/, term: 'EXCEPTION', text: 'An invoice mismatch that needs a decision from finance.' },
  {
    re: /migrated/,
    term: 'Migrated',
    text: 'The record came from a legacy system through data migration, not from a request raised here.',
  },
  {
    re: /confidence/,
    term: 'Confidence',
    text: 'How sure the (simulated) reader is of a value it extracted from a scanned contract. Low confidence means check it by hand.',
  },
];

export const ASKS_MEANING =
  /\bwhat (does|do) (.+) mean\b|\bmeaning of\b|\bwhat is (the |a |an )?(.+) (status|field|state)\b|\bwhat does the status\b|\bwhat does this (status|field)/;

export const findMeaning = (normalised: string): Meaning | null =>
  ASKS_MEANING.test(normalised) ? (MEANINGS.find((m) => m.re.test(normalised)) ?? null) : null;
