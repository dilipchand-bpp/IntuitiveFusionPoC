/**
 * The catalogue that turns "the Copilot is waiting" into "go here, do this" (rules-simulated-v1, no model).
 *
 * Every gate kind the agent can raise and every problem code it can hand to a person has an entry here, with where to go, the
 * numbered steps, who must do it and what happens next. The agent's own messages, the run page, the action items and Ask all
 * read from this one place. A unit test (guidance.test.ts) scans the agent's source and fails when a gate kind, a problem code
 * or a gate key has no entry, so a new kind cannot ship without guidance.
 */

export const GATE_KINDS = [
  'NEEDS_HUMAN',
  'ROLE_REQUIRED',
  'PLAN_SUBMIT',
  'PLAN_RISK_SIGNOFF',
  'PLAN_COI',
  'PLAN_CHECKS',
  'PLAN_APPROVAL',
  'TENDER_CREATE',
  'TENDER_PUBLISH_PERMISSION',
  'TENDER_PUBLISH',
  'TENDER_WITNESS',
  'EVALUATION_SETUP',
  'EVALUATION_HOLD',
  'PANEL_COI',
  'PANEL_CONFLICT_DECISION',
  'PANEL_SCORING',
  'CHAIR_OPEN_CONSENSUS',
  'CHAIR_LOCK_CONSENSUS',
  'REPORT_GENERATE',
  'AWARD_APPROVAL',
  'CONTRACT_DRAFT',
  'CONTRACT_LEGAL_REVIEW',
  'CONTRACT_SIGN',
] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export const PROBLEM_CODES = [
  'MISSING_FIELDS',
  'BUDGET_EXCEEDED',
  'STATUTORY_WINDOW',
  'NO_BIDS',
  'NO_PANEL',
  'NO_RECOMMENDED_SUPPLIER',
  'NO_REQUEST',
  'STEP_NO_EFFECT',
  'EXCEPTION',
  'PLAN_REJECTED',
  'FORBIDDEN',
  'GENERIC',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export interface Guide {
  /** The page the person goes to, in words. */
  where: string;
  steps: readonly string[];
  /** Who does it, when the gate does not already name people. */
  who: string;
  /** What happens once it is done. */
  next: string;
}

const ADVANCE =
  'Go back to the Copilot run and press "Advance now" (it also checks by itself every few seconds).';

export const GATE_GUIDANCE: Record<GateKind, Guide> = {
  NEEDS_HUMAN: {
    where: 'the page named in the card',
    steps: [
      'Read why the Copilot stopped and what it already tried (shown on the card and under Problems and repairs).',
      'Open the page named in the card and fix what it describes.',
      ADVANCE,
    ],
    who: 'the person who started the run, or the role named on the card',
    next: 'The Copilot looks at the record again and carries on from where it stopped.',
  },
  ROLE_REQUIRED: {
    where: 'the record named in the card',
    steps: [
      'Open the record named in the card.',
      'Do the step there. The person who started the run does not hold the role the step needs, so someone with that role must do it.',
      ADVANCE,
    ],
    who: 'someone holding the role named on the card',
    next: 'The Copilot sees the change and moves to the next stage.',
  },
  PLAN_SUBMIT: {
    where: 'the procurement plan',
    steps: [
      'Open the plan.',
      'Check every mandatory section is filled.',
      'Press "Submit for approval".',
      ADVANCE,
    ],
    who: 'a procurement officer',
    next: 'The plan goes to its checks (conflict declaration and risk sign-off) and then to a delegate.',
  },
  PLAN_RISK_SIGNOFF: {
    where: 'the procurement plan',
    steps: [
      'Open the plan.',
      'Read the risk assessment on the plan.',
      'Record the risk sign-off (a probity or risk officer, who must not have written the plan).',
      ADVANCE,
    ],
    who: 'the probity and risk officer',
    next: 'The plan is released to the delegate for approval.',
  },
  PLAN_COI: {
    where: 'the procurement plan',
    steps: [
      'Open the plan.',
      'Find the conflict-of-interest declaration.',
      'Choose whether you have a conflict and press "Submit declaration". A declaration is personal, so the Copilot cannot make it.',
      ADVANCE,
    ],
    who: 'a procurement officer',
    next: 'The plan can then go to the delegate.',
  },
  PLAN_CHECKS: {
    where: 'the procurement plan',
    steps: [
      'Open the plan and look at which checks are marked required.',
      'Complete each required check (a declaration, a sign-off).',
      ADVANCE,
    ],
    who: 'a procurement officer or the probity officer, depending on the check',
    next: 'When the checks are complete the plan goes to the delegate.',
  },
  PLAN_APPROVAL: {
    where: 'the procurement plan (or Approvals)',
    steps: [
      'Open the plan.',
      'Read the sections, the checks and the value.',
      'Press "Approve and lock". Your sourcing approval limit must cover the value, and you cannot approve a plan you wrote.',
      ADVANCE,
    ],
    who: 'a delegate (or executive) whose sourcing limit covers the value',
    next: 'The plan is locked and the tender pack is staged.',
  },
  TENDER_CREATE: {
    where: 'the approved plan',
    steps: [
      'Open the approved plan.',
      'Press "Create tender pack".',
      'Check the pack, then ask a delegate for permission to publish.',
      ADVANCE,
    ],
    who: 'a procurement officer',
    next: 'The tender is staged and waits for permission to publish.',
  },
  TENDER_PUBLISH_PERMISSION: {
    where: 'the tender',
    steps: [
      'Open the tender.',
      'Read the pack. You cannot grant permission for a pack you built.',
      'Press "Review and give permission", then "Give permission to publish". Your publish limit must cover the value.',
      ADVANCE,
    ],
    who: 'a delegate whose authority covers the value',
    next: 'A procurement officer can publish the tender.',
  },
  TENDER_PUBLISH: {
    where: 'the tender',
    steps: [
      'Open the tender (permission to publish has been given).',
      'Choose the closing time. It must meet the statutory minimum window.',
      'Press "Publish tender".',
      ADVANCE,
    ],
    who: 'a procurement officer',
    next: 'The tender is open to suppliers until the closing time.',
  },
  TENDER_WITNESS: {
    where: 'the tender (opening of sealed bids)',
    steps: [
      'Open the tender.',
      'Find "Open the bids" and confirm with your own password. Two different witnesses are needed.',
      'Neither witness may have raised the request or sit on the evaluation panel.',
      ADVANCE,
    ],
    who: 'two independent witnesses (probity, legal, a delegate, an executive or procurement)',
    next: 'The bids are unsealed and procurement sets up the evaluation.',
  },
  EVALUATION_SETUP: {
    where: 'the tender',
    steps: [
      'Open the tender that has closed.',
      'Press "Set up the evaluation" (or "Open evaluation") and name the panel: a technical and a commercial evaluator who are not the requester.',
      ADVANCE,
    ],
    who: 'a procurement officer',
    next: 'The panel declares conflicts of interest and then scores.',
  },
  EVALUATION_HOLD: {
    where: 'the evaluation',
    steps: [
      'Open the evaluation. It is on hold.',
      'Read the reason for the hold.',
      'The probity officer presses "Release the hold" once it is resolved.',
      ADVANCE,
    ],
    who: 'the probity officer',
    next: 'The evaluation carries on from where it was.',
  },
  PANEL_COI: {
    where: 'the evaluation',
    steps: [
      'Open the evaluation.',
      'Before you see any bid, declare whether you have a conflict of interest and press "Submit declaration".',
      ADVANCE,
    ],
    who: 'each panel member named on the card',
    next: 'When everyone has declared, scoring opens.',
  },
  PANEL_CONFLICT_DECISION: {
    where: 'the evaluation',
    steps: [
      'Open the evaluation and read the declared conflict.',
      'Decide: remove the member from the panel, or record that the conflict is minor and limit what they assess.',
      ADVANCE,
    ],
    who: 'a delegate, executive or probity officer',
    next: 'Scoring continues with the remaining panel.',
  },
  PANEL_SCORING: {
    where: 'the evaluation',
    steps: [
      'Open the evaluation.',
      'Score each bid on your own, against every criterion.',
      'Press "Mark my scoring complete". Scoring is a judgement, so the Copilot never scores.',
      ADVANCE,
    ],
    who: 'each panel member named on the card',
    next: 'When everyone has scored, the chair opens consensus.',
  },
  CHAIR_OPEN_CONSENSUS: {
    where: 'the evaluation',
    steps: ['Open the evaluation. Everyone has scored.', 'Press "Open consensus".', ADVANCE],
    who: 'the evaluation chair',
    next: 'The panel agrees consensus scores.',
  },
  CHAIR_LOCK_CONSENSUS: {
    where: 'the evaluation',
    steps: [
      'Open the evaluation.',
      'Agree the consensus scores with the panel and press "Save consensus".',
      'Press "Lock consensus".',
      ADVANCE,
    ],
    who: 'the evaluation chair',
    next: 'A procurement officer generates the evaluation report.',
  },
  REPORT_GENERATE: {
    where: 'the evaluation',
    steps: ['Open the evaluation. Consensus is locked.', 'Press "Generate report".', ADVANCE],
    who: 'a procurement officer',
    next: 'The report goes to the probity officer and then to a delegate for the award decision.',
  },
  AWARD_APPROVAL: {
    where: 'the evaluation report (or Approvals)',
    steps: [
      'Open the evaluation and read the report and the recommended supplier.',
      'Press "Approve report" to award. Your sourcing limit must cover the value, and probity must have released the result.',
      ADVANCE,
    ],
    who: 'a delegate (or executive) whose sourcing limit covers the value',
    next: 'Legal or procurement drafts the contract from the award.',
  },
  CONTRACT_DRAFT: {
    where: 'the evaluation (award)',
    steps: [
      'Open the approved evaluation.',
      'Press "Draft the contract with" the recommended supplier.',
      ADVANCE,
    ],
    who: 'legal or a procurement officer',
    next: 'The draft goes to legal review.',
  },
  CONTRACT_LEGAL_REVIEW: {
    where: 'the contract',
    steps: [
      'Open the contract.',
      'Review the clauses and fix any empty mandatory clause and the start and end dates.',
      'Press "Release for signing".',
      ADVANCE,
    ],
    who: 'legal',
    next: 'A delegate or executive signs.',
  },
  CONTRACT_SIGN: {
    where: 'the contract',
    steps: [
      'Open the contract.',
      'Read it, then press "Sign contract". You need a contract signing limit that covers the value (sourcing approval is a different grant).',
      ADVANCE,
    ],
    who: 'a delegate or executive with a signing limit that covers the value',
    next: 'The contract is executed and the Copilot reads its key dates and sets reminders.',
  },
};

export interface ProblemGuide extends Guide {
  /** Why the Copilot could not fix it by itself. */
  why: string;
}

export const PROBLEM_GUIDANCE: Record<ProblemCode, ProblemGuide> = {
  MISSING_FIELDS: {
    where: 'the request',
    why: 'The text did not give these fields and the Copilot may not assume them.',
    steps: [
      'Open the request.',
      'Fill in each field marked missing (they are named on the card).',
      'Press "Submit request" (or save and let the Copilot submit).',
      ADVANCE,
    ],
    who: 'the requester who started the run',
    next: 'The request is submitted and the plan is opened.',
  },
  BUDGET_EXCEEDED: {
    where: 'the request',
    why: 'The estimated value is above the budget available for the business unit. The Copilot cannot change a budget.',
    steps: [
      'Open the request and read the available budget in the message.',
      'Either reduce the estimated value to fit, or ask Finance to amend the budget for the business unit.',
      'Press "Submit request" again.',
      ADVANCE,
    ],
    who: 'the requester, or Finance to amend the budget',
    next: 'The request is submitted and goes to planning.',
  },
  STATUTORY_WINDOW: {
    where: 'the tender',
    why: 'The closing time was shorter than the minimum window the organisation requires. The Copilot moved it out to the minimum and it was still refused.',
    steps: [
      'Open the tender and read the minimum number of days in the message.',
      'Press "Publish tender" and choose a closing time at least that many days from now.',
      ADVANCE,
    ],
    who: 'a procurement officer',
    next: 'The tender is published and open to suppliers.',
  },
  NO_BIDS: {
    where: 'the tender',
    why: 'The tender closed with no submitted bids, so there is nothing to evaluate.',
    steps: [
      'Open the tender and check who was invited and whether the close date was too early.',
      'Decide: re-issue the tender with a later close date or a wider invitation, or change the approach.',
      'If you stop here, cancel the run on the Copilot page; if you re-issue, press "Advance now" when the new tender is published.',
    ],
    who: 'a procurement officer',
    next: 'A new tender is published, or the procurement is stopped.',
  },
  NO_PANEL: {
    where: 'Users and roles (administration)',
    why: 'The evaluation needs a technical and a commercial evaluator who are not the requester, and fewer than two were available.',
    steps: [
      'Ask an administrator to open Users and roles.',
      'Give at least two staff members the Evaluator role (not the requester).',
      'Open the tender and press "Set up the evaluation", or press "Advance now" on the run.',
    ],
    who: 'an administrator, then a procurement officer',
    next: 'The panel is named and declares conflicts of interest.',
  },
  NO_RECOMMENDED_SUPPLIER: {
    where: 'the evaluation',
    why: 'The approved report names no recommended supplier, so a contract cannot be drafted.',
    steps: [
      'Open the evaluation and read the report.',
      'Check the consensus scores and that the report recommends one supplier; regenerate the report if it does not.',
      'Press "Draft the contract with" the supplier you award.',
      ADVANCE,
    ],
    who: 'a procurement officer, with the chair',
    next: 'The contract is drafted.',
  },
  NO_REQUEST: {
    where: 'Procurement Copilot',
    why: 'The run has no request to work on.',
    steps: [
      'Open Procurement Copilot.',
      'Start a new run and describe the procurement, or open an existing request and start the run from it.',
    ],
    who: 'the person who started the run',
    next: 'A request is created and the run carries on.',
  },
  STEP_NO_EFFECT: {
    where: 'the record named in the card',
    why: 'The step ran but the record did not change as expected, so the Copilot stopped instead of repeating it.',
    steps: [
      'Open the record named in the card and compare it with the step described.',
      'Make the change by hand if it is missing, or correct what blocked it.',
      ADVANCE,
    ],
    who: 'the person who started the run',
    next: 'The Copilot looks at the record again.',
  },
  EXCEPTION: {
    where: 'the record named in the card',
    why: 'An unexpected error stopped the step and its repairs did not apply.',
    steps: [
      'Open the record named in the card and check its state.',
      'Press "Advance now" to try again.',
      'If it stops again, give the run number and the time to an administrator.',
    ],
    who: 'the person who started the run, then an administrator',
    next: 'The step is tried again.',
  },
  PLAN_REJECTED: {
    where: 'the procurement plan',
    why: 'An approver rejected the plan. The Copilot does not rewrite a plan an approver rejected.',
    steps: [
      'Open the plan and read the reason the approver gave.',
      'Reopen the plan, change the sections, and press "Submit for approval".',
      ADVANCE,
    ],
    who: 'a procurement officer',
    next: 'The plan goes to checks and approval again.',
  },
  FORBIDDEN: {
    where: 'the record named in the card',
    why: 'The application refused the step for this person (a role or an authority limit).',
    steps: [
      'Open the record named in the card.',
      'Ask someone who holds the role the step needs (or the limit that covers the value) to do it.',
      ADVANCE,
    ],
    who: 'someone with the right role or limit',
    next: 'The Copilot sees the change and moves on.',
  },
  GENERIC: {
    where: 'the record named in the card',
    why: 'The step failed in a way the Copilot has no repair for.',
    steps: [
      'Read the message on the card. It says what was refused and why.',
      'Open the record named in the card and fix what the message names.',
      ADVANCE,
    ],
    who: 'the person who started the run',
    next: 'The Copilot looks at the record again and carries on.',
  },
};

/**
 * Gate keys the agent can use (the part before the first colon), each tied to a gate kind or, for a problem handed to a person,
 * to a problem code. A scan test fails when a key in stages.ts is missing here.
 */
export const GATE_KEY_PREFIXES: Record<string, { kind?: GateKind; problem?: ProblemCode }> = {
  screen: { problem: 'EXCEPTION' },
  create_request: { problem: 'NO_REQUEST' },
  fields: { problem: 'MISSING_FIELDS' },
  budget: { problem: 'BUDGET_EXCEEDED' },
  submit: { problem: 'GENERIC' },
  'submit-role': { kind: 'ROLE_REQUIRED' },
  'plan-open': { problem: 'GENERIC' },
  'plan-open-role': { kind: 'ROLE_REQUIRED' },
  'plan-submit': { kind: 'PLAN_SUBMIT' },
  'plan-risk': { kind: 'PLAN_RISK_SIGNOFF' },
  'plan-coi': { kind: 'PLAN_COI' },
  'plan-checks': { kind: 'PLAN_CHECKS' },
  'plan-approve': { kind: 'PLAN_APPROVAL' },
  'plan-rejected': { problem: 'PLAN_REJECTED' },
  'plan-fill': { problem: 'GENERIC' },
  'tender-create': { kind: 'TENDER_CREATE' },
  'tender-permission': { kind: 'TENDER_PUBLISH_PERMISSION' },
  'tender-publish': { kind: 'TENDER_PUBLISH' },
  'tender-witness': { kind: 'TENDER_WITNESS' },
  'no-bids': { problem: 'NO_BIDS' },
  'eval-setup': { kind: 'EVALUATION_SETUP' },
  'eval-open': { problem: 'NO_PANEL' },
  'eval-hold': { kind: 'EVALUATION_HOLD' },
  'panel-coi': { kind: 'PANEL_COI' },
  'panel-coi-wait': { kind: 'PANEL_COI' },
  'panel-conflict': { kind: 'PANEL_CONFLICT_DECISION' },
  'panel-scoring': { kind: 'PANEL_SCORING' },
  'chair-open': { kind: 'CHAIR_OPEN_CONSENSUS' },
  'chair-lock': { kind: 'CHAIR_LOCK_CONSENSUS' },
  'report-generate': { kind: 'REPORT_GENERATE' },
  report: { problem: 'GENERIC' },
  'award-approve': { kind: 'AWARD_APPROVAL' },
  'contract-draft': { kind: 'CONTRACT_DRAFT' },
  'contract-legal': { kind: 'CONTRACT_LEGAL_REVIEW' },
  'contract-sign': { kind: 'CONTRACT_SIGN' },
  'contract-release': { problem: 'GENERIC' },
  'contract-snapshot': { problem: 'GENERIC' },
};

export interface GateLike {
  kind: string;
  key?: string;
  gateKey?: string;
  title: string;
  reason: string;
  link: string;
  roles: readonly string[];
  names?: readonly string[];
}

export const isGateKind = (k: string): k is GateKind => (GATE_KINDS as readonly string[]).includes(k);
export const isProblemCode = (k: string): k is ProblemCode =>
  (PROBLEM_CODES as readonly string[]).includes(k);

/** Which problem code a problem handed to a person belongs to: the stored code when there is one, else read from the gate key and message. */
export function problemCodeFor(gate: GateLike, storedCode?: string | null): ProblemCode {
  if (storedCode && isProblemCode(storedCode)) return storedCode;
  const prefix = (gate.key ?? gate.gateKey ?? '').split(':')[0] ?? '';
  const hit = GATE_KEY_PREFIXES[prefix]?.problem;
  const text = `${gate.title} ${gate.reason}`;
  if (/closing time|closing is \d+|after publication|requires at least \d+|statutory/i.test(text))
    return 'STATUTORY_WINDOW';
  if (/budget/i.test(text) && /amend|exceed|available/i.test(text)) return 'BUDGET_EXCEEDED';
  if (/evaluator\(s\) are available|technical and a commercial evaluator/i.test(text)) return 'NO_PANEL';
  if (/no recommended supplier|recommended supplier/i.test(text) && prefix === 'contract-draft')
    return 'NO_RECOMMENDED_SUPPLIER';
  if (/did not change as expected/i.test(text)) return 'STEP_NO_EFFECT';
  return hit ?? 'GENERIC';
}

export interface WhatToDo {
  /** One line for the agent's own messages: where, what, then what. */
  line: string;
  /** The same line without the link, for a card that already has a link beside it. */
  short: string;
  headline: string;
  where: { label: string; href: string };
  steps: string[];
  who: string;
  next: string;
  /** Present for a problem the Copilot could not repair: why it stopped. */
  why?: string;
  problemCode?: ProblemCode;
}

/** The step that says what to press or do: the first one naming a button, else the second step. */
const mainStep = (steps: readonly string[]) =>
  steps.find((x) => x.includes('"') && !x.startsWith('Go back')) ??
  steps[Math.min(1, steps.length - 1)] ??
  steps[0]!;

const sentence = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\.$/, '');

/** The guidance for one open gate: where to go, the numbered steps, who, and what happens next. */
export function whatToDo(gate: GateLike, opts: { problemCode?: string | null } = {}): WhatToDo {
  const isHuman = gate.kind === 'NEEDS_HUMAN';
  const prefixKind = GATE_KEY_PREFIXES[(gate.key ?? gate.gateKey ?? '').split(':')[0] ?? '']?.kind;
  const code = isHuman ? problemCodeFor(gate, opts.problemCode) : undefined;
  // a problem handed to a person: the specific problem guide when the cause is known, else the guide of the step that failed
  const specific = code !== undefined && code !== 'GENERIC';
  const kind: GateKind =
    isGateKind(gate.kind) && gate.kind !== 'NEEDS_HUMAN' ? gate.kind : (prefixKind ?? 'NEEDS_HUMAN');
  const g: Guide = specific
    ? PROBLEM_GUIDANCE[code]
    : isHuman && !prefixKind
      ? PROBLEM_GUIDANCE.GENERIC
      : GATE_GUIDANCE[kind];
  const who = gate.names?.length
    ? gate.names.slice(0, 4).join(', ')
    : gate.roles.length
      ? gate.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(' or ')
      : g.who;
  const where = { label: `Open ${g.where}`, href: gate.link };
  const steps = g.steps.map((s) => s);
  const short = `What to do: ${sentence(mainStep(steps))} (${who}). Then ${sentence(
    g.next.charAt(0).toLowerCase() + g.next.slice(1),
  )}.`;
  return {
    line: `${short} Open ${gate.link}`,
    short,
    headline: gate.title,
    where,
    steps,
    who,
    next: g.next,
    ...(code ? { why: PROBLEM_GUIDANCE[code].why, problemCode: code } : {}),
  };
}

/** The guidance for a problem by code alone (the problems panel). */
export function whatToDoForProblem(
  p: { code: string; title: string; detail: string },
  link: string,
): WhatToDo {
  const code: ProblemCode = isProblemCode(p.code)
    ? p.code
    : problemCodeFor({ kind: 'NEEDS_HUMAN', title: p.title, reason: p.detail, link, roles: [] });
  const g = PROBLEM_GUIDANCE[code];
  return {
    line: `What to do: ${sentence(mainStep(g.steps))}. Open ${link}`,
    short: `What to do: ${sentence(mainStep(g.steps))}.`,
    headline: p.title,
    where: { label: `Open ${g.where}`, href: link },
    steps: [...g.steps],
    who: g.who,
    next: g.next,
    why: g.why,
    problemCode: code,
  };
}
