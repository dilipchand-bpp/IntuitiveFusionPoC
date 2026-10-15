/**
 * Page-aware answers for Ask (rules-simulated-v1): what this page is, how do I do something, what a status or field means, the
 * facts of the record the person is looking at, and what to do about a Copilot run that is waiting. Everything here is a fixed
 * rule over the page guide, the how-to catalogue, the Copilot guidance catalogue and records read through the normal authorised
 * routes, so it can never say more than the pages it points to. Every answer names its source ("From: ...").
 */
import { guideFor, rolesOpening, type EntityType, type PageContext, type RoleName } from '@if/shared';
import { whatToDo, type WhatToDo } from '../cpagent/guidance.js';
import { matchHowTo, type HowTo } from './howto.js';
import { ROLE_LABEL } from './labels.js';
import { findMeaning } from './meanings.js';
import type { Action, Reply } from './rules.js';

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const labels = (roles: readonly string[]) =>
  roles
    .filter((r) => r !== 'SUPPLIER')
    .map((r) => ROLE_LABEL[r as RoleName] ?? r)
    .join(', ');
const hasAny = (mine: readonly string[], need: readonly string[]) => need.some((r) => mine.includes(r));
const humanise = (s: string) => s.replace(/_/g, ' ').toLowerCase();

const base = (topic: string, answer: string, extra: Partial<Reply> = {}): Reply => ({
  topic,
  answer,
  bullets: [],
  actions: [],
  followUps: [],
  ...extra,
});

// ------------------------------------------------------------------ what is this page

export function pageReply(ctx: PageContext | null, roles: readonly string[]): Reply {
  const g = guideFor(ctx?.path);
  if (!g)
    return base(
      'page',
      'I do not have a guide entry for this page. Ask about a specific page, for example "what is the approvals page?".',
      { from: 'From: page guide (no entry for this page)', followUps: ['What needs my attention?'] },
    );
  const open = rolesOpening(g.route);
  const can = g.can.map((c) => {
    if (!c.who) return c.text;
    return hasAny(roles, c.who)
      ? `${c.text} (you can)`
      : `${c.text} (${labels(c.who)} only; not available to your role)`;
  });
  const bullets = [
    ...can,
    ...(open ? [`Who can open this page: ${labels(open)}.`] : []),
    `Next step: ${g.next}`,
  ];
  return base('page', `${g.title}: ${g.purpose}`, {
    bullets,
    actions: g.links.map((l) => ({ label: l.label, href: l.href })),
    followUps: ['What can I do here?', 'What needs my attention?'],
    from: `From: page guide (${g.title})`,
  });
}

// ------------------------------------------------------------------ how do I ...

export function howToReply(h: HowTo, roles: readonly string[]): Reply {
  const mayDo = hasAny(roles, h.who);
  const steps = h.steps.map((s) => s.text);
  const actions: Action[] = h.steps
    .filter((s) => s.href)
    .map((s) => ({ label: s.text.replace(/\.$/, ''), href: s.href! }));
  if (!mayDo)
    return base(
      'howto',
      `${h.title} is done by ${labels(h.who)}. You hold ${labels(roles) || 'no staff role'}, so you cannot do it yourself. Ask one of them; these are the steps they follow.`,
      {
        steps,
        actions,
        allowed: false,
        from: 'From: how-to guide and the role rules',
        followUps: ['Who can approve a plan?', 'What can I do?'],
      },
    );
  return base('howto', `${h.title}. Follow these steps.`, {
    steps: [...steps, `Then: ${h.next}`],
    actions,
    allowed: true,
    from: 'From: how-to guide',
    followUps: ['What is this page?', 'Who can approve a plan?'],
  });
}

export const howToFor = (normalised: string) => matchHowTo(normalised);

// ------------------------------------------------------------------ what does this status or field mean

export function meaningReply(normalised: string): Reply | null {
  const hit = findMeaning(normalised);
  if (!hit) return null;
  return base('meaning', `${hit.term}: ${hit.text}`, {
    from: 'From: page guide (status and field meanings)',
    followUps: ['What is this page?', 'What can I do here?'],
  });
}

// ------------------------------------------------------------------ the record the person is looking at

export interface RecordCtx {
  type: EntityType;
  id: string;
}
export interface RecordRead {
  /** The route answered 2xx for this person, with this body. */
  json: unknown;
  /** A second read that adds to the first (the progress route, the plans list), when it answered. */
  extra?: unknown;
}

type Json = Record<string, unknown>;
const o = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const PLAN_WAIT: Record<string, string> = {
  DRAFT: 'a procurement officer to finish the plan and press "Submit for approval"',
  REOPENED: 'a procurement officer to change the plan and submit it again',
  AWAITING_SIGNOFF:
    'the required checks: the conflict declaration (procurement) and the risk sign-off (probity officer)',
  AWAITING_APPROVAL:
    'a delegate (or executive) whose sourcing limit covers the value to press "Approve and lock"',
  APPROVED_LOCKED: 'nobody; the plan is approved and locked. Procurement creates the tender pack next',
  REJECTED: 'a procurement officer to revise the plan after the rejection and submit it again',
  NOT_STARTED: 'procurement to open the plan from the submitted request',
};
const REQUEST_WAIT: Record<string, string> = {
  DRAFT: 'the requester to fill in the missing fields and press "Submit request"',
  SUBMITTED: 'procurement to take the request and assign a manager',
  IN_PROGRESS: 'the next step in its lifecycle (see the progress below)',
  BLOCKED: 'someone to clear what is holding it',
  COMPLETE: 'nobody; it has finished',
};

function requestFacts(read: RecordRead): { lines: string[]; waiting: string; next: string } | null {
  const v = o(read.json);
  if (!s(v.number)) return null;
  const lines: string[] = [];
  lines.push(
    `${s(v.number)} "${s(v.title)}" is ${humanise(s(v.status))}, in the ${humanise(s(v.phase))} phase, estimated at ${aud.format(Number(v.estimatedValue ?? 0))}.`,
  );
  const missing = arr(v.fields)
    .filter((f) => f.missing === true)
    .map((f) => s(f.label));
  lines.push(missing.length ? `Missing: ${missing.join(', ')}.` : 'Nothing mandatory is missing.');
  const required = arr(v.gates)
    .filter((g) => g.status === 'REQUIRED')
    .map((g) => s(g.label));
  if (required.length) lines.push(`Gates still required: ${required.join(', ')}.`);
  if (s(v.budgetCheck) && s(v.budgetCheck) !== 'OK' && s(v.budgetCheck) !== 'PASSED')
    lines.push(`Budget check: ${humanise(s(v.budgetCheck))}.`);
  const prog = o(read.extra);
  const cur = arr(prog.milestones).find((m) => m.current === true);
  if (cur) lines.push(`Progress: ${s(prog.percent)}% done; the next milestone is "${s(cur.label)}".`);
  const MILESTONE_WAIT: Record<string, string> = {
    raised: 'the requester to submit it',
    plan: 'the plan to be approved (open the plan to see whether it waits for procurement, the probity officer or a delegate)',
    published: 'the tender to get permission from a delegate and be published by procurement',
    bids: 'suppliers to respond before the closing time, then the bids to be opened',
    evaluated: 'the evaluation panel and then a delegate to approve the award',
    signed: 'the contract to be reviewed by legal and signed within a signing limit',
    closed: 'the procurement to be closed with lessons recorded',
  };
  const stat = s(v.status);
  const wait =
    stat === 'DRAFT' || stat === 'SUBMITTED' || stat === 'BLOCKED' || stat === 'COMPLETE'
      ? REQUEST_WAIT[stat]!
      : cur
        ? (MILESTONE_WAIT[s(cur.key)] ?? '')
        : '';
  return {
    lines,
    waiting: wait || REQUEST_WAIT[stat] || 'the next step in its lifecycle',
    next: cur ? s(cur.label) : 'it is complete',
  };
}

export function recordReply(ctx: RecordCtx, read: RecordRead | null, roles: readonly string[]): Reply {
  const noRead = base(
    'record',
    'I cannot read that record with your role, so I can only describe the page, not the record. Ask the page owner, or open the record from your list.',
    { from: 'From: page guide (the record is not visible to you)', followUps: ['What is this page?'] },
  );
  if (!read) return noRead;
  const v = o(read.json);
  const bullets: string[] = [];
  let answer: string;
  let waiting: string;
  let from: string;
  const actions: Action[] = [];
  switch (ctx.type) {
    case 'request':
    case 'plan': {
      if (ctx.type === 'plan') {
        const rows = arr(read.extra);
        const pl = rows.find((r) => s(r.requestId) === ctx.id);
        const status = pl ? s(pl.status) : '';
        if (!pl) return noRead;
        answer = `Plan for ${s(pl.requestNumber)} "${s(pl.title)}": ${humanise(status)}, estimated at ${aud.format(Number(pl.estimatedValue ?? 0))}.`;
        waiting = PLAN_WAIT[status] ?? 'the next step in the plan';
        bullets.push(`Waiting for: ${waiting}.`);
        if (status === 'AWAITING_APPROVAL')
          bullets.push(
            hasAny(roles, ['DELEGATE', 'EXEC'])
              ? 'You can approve it if your sourcing limit covers the value and you did not write it.'
              : 'You cannot approve it: only a delegate or executive can.',
          );
        from = 'From: this plan (read as you)';
        actions.push({ label: 'Open the request', href: `/app/requests/${ctx.id}` });
        break;
      }
      const f = requestFacts(read);
      if (!f) return noRead;
      answer = f.lines[0]!;
      bullets.push(...f.lines.slice(1));
      waiting = f.waiting;
      bullets.push(`Waiting for: ${waiting}.`);
      from = 'From: this request (read as you)';
      actions.push({ label: 'Open the plan', href: `/app/plans/${ctx.id}` });
      break;
    }
    case 'tender': {
      if (!s(v.requestNumber) && !s(v.status)) return noRead;
      const granted = o(v.permission).granted === true;
      answer = `Tender for ${s(v.requestNumber)} "${s(v.title)}": ${humanise(s(v.status))}${v.closesAt ? `, closes ${s(v.closesAt).slice(0, 16).replace('T', ' ')} UTC` : ''}.`;
      const st = s(v.status);
      waiting =
        st === 'STAGED' || st === 'DRAFT'
          ? granted
            ? 'a procurement officer to press "Publish tender"'
            : 'a delegate to give permission to publish (not the person who built the pack)'
          : st === 'PUBLISHED'
            ? 'suppliers to respond before the closing time'
            : st === 'CLOSED'
              ? 'the bids to be opened (two witnesses if it is high value) and the evaluation to be set up'
              : 'the evaluation and award';
      bullets.push(`Permission to publish: ${granted ? 'given' : 'not yet given'}.`);
      bullets.push(`Invitations sent: ${arr(v.invitations).length}.`);
      bullets.push(`Waiting for: ${waiting}.`);
      from = 'From: this tender (read as you)';
      break;
    }
    case 'evaluation': {
      if (!s(v.status)) return noRead;
      const panel = arr(v.panel);
      const undeclared = panel.filter((m) => s(m.coiState) === 'NOT_DECLARED').length;
      const conflicts = panel.filter((m) => s(m.coiState) === 'DECLARED_CONFLICT').length;
      const scored = panel.filter((m) => m.scoringComplete === true).length;
      answer = `Evaluation for ${s(v.requestNumber)} "${s(v.title)}": ${humanise(s(v.status))}${v.held ? ' (ON HOLD)' : ''}.`;
      const st = s(v.status);
      waiting = v.held
        ? 'the probity officer to release the hold'
        : st === 'COI_PENDING'
          ? `${undeclared} panel member(s) to declare conflicts${conflicts ? ` and a decision on ${conflicts} declared conflict(s)` : ''}`
          : st === 'SCORING'
            ? `${panel.length - scored} panel member(s) to finish scoring`
            : st === 'CONSENSUS'
              ? 'the chair to agree and lock consensus'
              : st === 'LOCKED'
                ? 'a procurement officer to generate the report'
                : st === 'REPORTED'
                  ? 'a delegate to approve the award'
                  : 'nobody; the award is approved and a contract follows';
      bullets.push(`Waiting for: ${waiting}.`);
      const me = o(v.me);
      if (Object.keys(me).length)
        bullets.push(
          `For you: declaration ${humanise(s(me.coiState))}; scoring ${me.scoringComplete === true ? 'complete' : `${s(me.done)} of ${s(me.required)} scores entered`}.`,
        );
      const perms = o(v.permissions);
      const can = Object.entries(perms)
        .filter(([, x]) => x === true)
        .map(([k]) => humanise(k.replace(/^can/, '')).trim());
      bullets.push(
        can.length ? `You may: ${can.join(', ')}.` : 'You have no action on this evaluation right now.',
      );
      const rep = o(v.report);
      if (s(rep.status))
        bullets.push(
          `Report: ${humanise(s(rep.status))}${arr(rep.routedTo).length || Array.isArray(rep.routedTo) ? `, routed to ${(rep.routedTo as string[]).join(', ')}` : ''}.`,
        );
      from = 'From: this evaluation (read as you, so it shows only what your role may see)';
      break;
    }
    case 'contract': {
      if (!s(v.status)) return noRead;
      const unsigned = arr(v.invitations)
        .filter((i) => i.signed !== true && i.external !== true)
        .map((i) => `${s(i.name)} (${s(i.role)})`);
      answer = `Contract: ${humanise(s(v.status))}; ${s(v.signed)} of ${s(v.required)} required signatures.`;
      const st = s(v.status);
      waiting =
        st === 'DRAFT'
          ? 'legal to review and release for signing'
          : st === 'LEGAL_REVIEW'
            ? 'legal to finish the review'
            : st === 'EXECUTED'
              ? 'nobody; it is signed and now managed by the contract manager'
              : unsigned.length
                ? `signature from ${unsigned.join(', ')}`
                : 'the remaining signers';
      bullets.push(`Waiting for: ${waiting}.`);
      from = 'From: this contract (read as you)';
      break;
    }
    case 'supplier': {
      if (!s(v.name) && !s(v.id)) return noRead;
      answer = `Supplier ${s(v.name) || ''}`.trim();
      for (const k of ['onboardingStatus', 'insuranceStatus', 'sanctionsStatus'] as const)
        if (s(v[k])) bullets.push(`${humanise(k.replace(/Status$/, ' status'))}: ${humanise(s(v[k]))}.`);
      waiting =
        'nobody unless a status above is expired, expiring or a sanctions match; then procurement requests an updated certificate';
      bullets.push(`Waiting for: ${waiting}.`);
      from = 'From: this supplier (read as you)';
      break;
    }
    default:
      return noRead;
  }
  return base('record', answer, {
    bullets,
    actions,
    from,
    followUps: ['What can I do here?', 'What is this page?'],
  });
}

// ------------------------------------------------------------------ the Copilot is waiting: where, what, who, then what

export interface RunDetail {
  run: { id: string; title: string; status: string; stage: string; currentAction?: string | null };
  gates: Array<{
    id: string;
    kind: string;
    title: string;
    reason: string;
    link: string;
    roles: string[];
    names: string[];
    status: string;
    whatToDo?: WhatToDo;
  }>;
  problems: Array<{
    status: string;
    code: string;
    title: string;
    detail: string;
    attempts: Array<{ n: number; label: string; outcome: string; note: string }>;
  }>;
}

export function copilotReply(
  d: RunDetail | null,
  who: { roles: readonly string[]; name: string },
  gateId?: string | null,
): Reply {
  if (!d)
    return base(
      'copilot',
      'I cannot read that Copilot run with your role. A run is visible to the person who started it and to the managers who oversee runs.',
      { from: 'From: Copilot guidance (the run is not visible to you)', followUps: ['What is this page?'] },
    );
  const runLink: Action = { label: 'Back to the Copilot run', href: `/app/copilot/${d.run.id}` };
  const open = d.gates.filter((g) => g.status === 'OPEN');
  if (open.length === 0) {
    const done = ['COMPLETED', 'CANCELLED', 'FAILED'].includes(d.run.status);
    return base(
      'copilot',
      done
        ? `This run has finished (${humanise(d.run.status)}). Nothing is waiting for anyone.`
        : `Nothing is waiting for a person. The Copilot is ${d.run.currentAction ? `working on: ${d.run.currentAction}` : 'moving on its own'}. If it looks stuck, press "Advance now".`,
      { from: 'From: this run (read as you)', actions: [runLink], followUps: ['What is this page?'] },
    );
  }
  const g = (gateId ? open.find((x) => x.id === gateId) : undefined) ?? open[0]!;
  const w = g.whatToDo ?? whatToDo({ ...g, key: undefined });
  const mine = g.names.includes(who.name) || g.roles.some((r) => who.roles.includes(r));
  const problem = g.kind === 'NEEDS_HUMAN' ? d.problems.find((p) => p.status === 'ESCALATED') : undefined;
  const steps = w.steps.map((x) => x);
  const bullets: string[] = [];
  bullets.push(
    `Who must do it: ${w.who}${mine ? ' (that includes you)' : ' (not you; ask them, or ask a colleague who holds that role)'}.`,
  );
  bullets.push(`What happens next: ${w.next}`);
  if (problem) {
    bullets.push(`Why it stopped: ${w.why ?? problem.detail}`);
    bullets.push(
      problem.attempts.length
        ? `What the Copilot tried: ${problem.attempts.map((a) => `${a.n}. ${a.label} (${a.outcome === 'NOT_APPLICABLE' ? 'not applicable: ' : ''}${a.note})`).join('; ')}.`
        : 'What the Copilot tried: nothing; it has no automatic repair for this.',
    );
  } else if (w.why) bullets.push(`Why it stopped: ${w.why}`);
  if (open.length > 1)
    bullets.push(
      `There are ${open.length} waiting cards on this run; this answer covers "${g.title}". Ask again about another card from its "What do I do?" button.`,
    );
  const actions: Action[] = [{ label: w.where.label, href: g.link }, runLink];
  return base('copilot', `${g.title}. Here is exactly where to go and what to do.`, {
    steps: steps.map((x) => x),
    bullets,
    actions,
    allowed: mine,
    from: 'From: Copilot guidance catalogue and this run (read as you)',
    followUps: ['What happens next?', 'What is this page?'],
  });
}

/** Where the person's open Copilot gates are, when they ask "what is the Copilot waiting for me to do?" without being on a run. */
export function myGatesReply(items: Array<{ title: string; whatToDo: WhatToDo; runId: string }>): Reply {
  if (items.length === 0)
    return base('copilot', 'The Copilot is not waiting for you to do anything right now.', {
      from: 'From: your Copilot action items',
      followUps: ['What needs my attention?'],
    });
  const first = items[0]!;
  return base(
    'copilot',
    `The Copilot is waiting for you on ${items.length} item${items.length === 1 ? '' : 's'}. First: ${first.title}.`,
    {
      steps: first.whatToDo.steps,
      bullets: [
        `Who must do it: ${first.whatToDo.who}.`,
        `What happens next: ${first.whatToDo.next}`,
        ...items.slice(1, 5).map((i) => `Also waiting: ${i.title}`),
      ],
      actions: [
        { label: first.whatToDo.where.label, href: first.whatToDo.where.href },
        { label: 'Open the Copilot run', href: `/app/copilot/${first.runId}` },
      ],
      from: 'From: your Copilot action items and the guidance catalogue',
      followUps: ['What is this page?'],
    },
  );
}
