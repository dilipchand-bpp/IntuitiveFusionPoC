/**
 * What to do next, decided from the observed state alone (design principle 3). Each stage returns the next action (with its repairs
 * and where it escalates), a set of gates where people must act, a wait, or done. Nothing here remembers a position: calling
 * decide() twice on the same state gives the same answer, and the engine never repeats a step it has already recorded.
 */
import { withSystem } from '../../db/client.js';
import { routeApproval } from '../evaluation/b3-service.js';
import { FIELD_BY_KEY } from '../intake/fields.js';
import { PLAN_FIELDS } from '../plan/fields.js';
import { classifyText, warningFor } from '../b11priv/classify.js';
import { parseRequestText } from './parse.js';
import {
  asString,
  failureOf,
  type Action,
  type ActionResult,
  type Ctx,
  type Decision,
  type Failure,
  type GateSpec,
  type Repair,
} from './types.js';

const L = {
  request: (id: string) => `/app/requests/${id}`,
  plan: (requestId: string) => `/app/plans/${requestId}`,
  tender: (id: string) => `/app/tenders/${id}`,
  evaluation: (id: string) => `/app/evaluations/${id}`,
  contract: (id: string) => `/app/contracts/${id}`,
};
const aud = (n: number) => `AUD ${Math.round(n).toLocaleString('en-AU')}`;
const DAY = 86_400_000;

/** Which stage the procurement is in, from its state (shown on the timeline). */
export function stageOf(
  o: Ctx['obs'],
): 'REQUEST' | 'PLAN' | 'TENDER' | 'EVALUATION' | 'AWARD' | 'CONTRACT' | 'DONE' {
  if (!o.request || o.request.status === 'DRAFT') return 'REQUEST';
  if (!o.plan || !o.plan.locked) return 'PLAN';
  if (!o.tender) return 'TENDER';
  if (!o.evaluation) return o.tender.status === 'CLOSED' ? 'EVALUATION' : 'TENDER';
  if (o.evaluation.status === 'REPORTED') return 'AWARD';
  if (o.evaluation.status !== 'APPROVED') return 'EVALUATION';
  return o.contract?.status === 'EXECUTED' ? 'DONE' : 'CONTRACT';
}

const ownerGate = (
  ctx: Ctx,
  g: Omit<GateSpec, 'kind' | 'agent' | 'rule' | 'roles' | 'userIds'> & Partial<GateSpec>,
): GateSpec => ({
  kind: 'NEEDS_HUMAN',
  agent: 'ORCHESTRATOR',
  rule: 'Self-repair gave up after 3 attempts, so a person decides',
  roles: [],
  userIds: [ctx.run.userId],
  ...g,
});

export async function decide(ctx: Ctx): Promise<Decision> {
  const o = ctx.obs;
  if (!o.request || o.request.status === 'DRAFT') return requestStage(ctx);
  if (!o.plan || !o.plan.locked) return planStage(ctx);
  if (!o.evaluation) return tenderStage(ctx);
  if (o.evaluation.status !== 'APPROVED') return evaluationStage(ctx);
  return contractStage(ctx);
}

// ================================================================================================ REQUEST
async function requestStage(ctx: Ctx): Promise<Decision> {
  const o = ctx.obs;
  if (!o.request) {
    if (!ctx.context.screened) return screenText(ctx);
    return createRequest(ctx);
  }
  if (o.request.missing.length > 0) return completeRequest(ctx);
  return submitRequest(ctx);
}

function screenText(_ctx: Ctx): Action {
  return {
    type: 'ACTION',
    key: 'compliance.screen_text',
    agent: 'COMPLIANCE',
    stage: 'REQUEST',
    title: 'Screened the request text for sensitive data',
    reason:
      'Text is checked before it is used, so personal or financial identifiers are not copied into records.',
    rule: 'Privacy and sensitive data: detectors for tax file number, card, bank account, licence, passport (rules-simulated-v1)',
    repairs: [],
    escalate: (c) =>
      ownerGate(c, {
        key: 'screen',
        stage: 'REQUEST',
        title: 'The text could not be screened',
        reason: 'Screening failed',
        link: '/app/copilot',
      }),
    async run(c) {
      const text = c.run.sourceText;
      const found = classifyText(text);
      const odd = found
        ? warningFor('request', 'the request text', found.detectors)
          ? found.detectors
          : []
        : [];
      let masked = text;
      if (odd.length > 0)
        masked = text
          .replace(/\b\d[\d -]{6,}\d\b/g, '[removed]')
          .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[removed]');
      await c.setContext({ screened: true, maskedText: masked, sensitive: odd });
      return {
        ok: true,
        result: {
          sensitiveClasses: odd,
          note:
            odd.length > 0
              ? 'Sensitive identifiers were removed from the text before it was used (values are not stored in this log)'
              : 'Nothing sensitive found',
        },
        tool: 'classify_text',
      };
    },
  };
}

interface DraftField {
  key: string;
  value: string;
}
function draftFields(json: unknown): DraftField[] {
  const f = (json as { fields?: unknown } | null)?.fields;
  const out: DraftField[] = [];
  const push = (key: string, v: unknown) => {
    const val = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v;
    if (val === null || val === undefined || val === '') return;
    out.push({ key, value: String(val) });
  };
  if (Array.isArray(f)) {
    for (const x of f)
      if (x && typeof x === 'object' && 'key' in x)
        push(String((x as { key: unknown }).key), (x as { value?: unknown }).value);
  } else if (f && typeof f === 'object') {
    for (const [k, v] of Object.entries(f)) push(k, v);
  }
  return out;
}

function createRequest(_ctx: Ctx): Action {
  return {
    type: 'ACTION',
    key: 'intake.create_request',
    agent: 'INTAKE',
    stage: 'REQUEST',
    title: 'Created the request from the text',
    reason: 'There is no procurement yet, so the request is drafted from what was asked for.',
    rule: 'Same rules as a person: the request is made through the request routes as the user who started the run',
    repairs: [],
    escalate: (c, f) =>
      ownerGate(c, {
        key: 'create_request',
        stage: 'REQUEST',
        title: 'The request could not be created',
        reason: f.message,
        link: '/app/requests',
      }),
    async run(c) {
      const text = asString(c.context.maskedText) || c.run.sourceText;
      const cap = (c.context.capabilities ?? {}) as Record<string, boolean>;
      let drafted: DraftField[] = [];
      let via = 'the intake assistant (rules-simulated-v1)';
      let noted: string | null = null;
      if (cap.draft !== false && c.can('INTAKE', 'draft_request')) {
        const r = await c.tool.call('INTAKE', 'draft_request', {
          body: { kind: 'REQUEST', text, source: 'TEXT' },
          stepKey: c.stepKey,
        });
        if (r.notAvailable) {
          await c.setContext({ capabilities: { ...cap, draft: false } });
          noted = 'The drafting module is not available, so the intake assistant was used instead';
        } else if (r.ok) {
          drafted = draftFields(r.json);
          if (drafted.length > 0) via = 'the drafting module';
        } else
          noted = `The drafting module did not answer (${r.status}); the intake assistant was used instead`;
      }
      if (drafted.length > 0) {
        const body: Record<string, unknown> = {};
        const extra: Record<string, string> = {};
        for (const f of drafted) {
          if (f.key === 'title' || f.key === 'category' || f.key === 'businessUnit')
            body[f.key] = f.value.slice(0, 190);
          else if (f.key === 'estimatedValue') {
            const n = Number(f.value.replace(/[^0-9.]/g, ''));
            if (n > 0) body.estimatedValue = n;
          } else if (f.key === 'termMonths') {
            const n = Math.round(Number(f.value));
            if (n > 0 && n <= 360) body.termMonths = n;
          } else if (FIELD_BY_KEY.has(f.key)) extra[f.key] = f.value.slice(0, 3900);
        }
        if (Object.keys(extra).length) body.fields = extra;
        let r = await c.tool.call('INTAKE', 'create_request', { body, stepKey: c.stepKey });
        if (!r.ok && r.code === 'VALIDATION_FAILED' && body.fields) {
          // a drafted field the request does not accept: keep the core fields and let the repairs do the rest
          delete body.fields;
          r = await c.tool.call('INTAKE', 'create_request', { body, stepKey: c.stepKey });
        }
        if (r.ok) {
          const id = asString((r.json as { id?: unknown }).id);
          return {
            ok: true,
            result: { requestId: id, via, ...(noted ? { note: noted } : {}) },
            tool: 'create_request',
            patch: { requestId: id },
          };
        }
        if (r.status === 403) return { ok: false, ...failureOf(r) };
        noted = 'The drafted fields were not accepted, so the intake assistant was used instead';
        via = 'the intake assistant (rules-simulated-v1)';
      }
      const conv = await c.tool.call('INTAKE', 'assistant_start', {
        body: { purpose: 'INTAKE' },
        stepKey: c.stepKey,
      });
      if (!conv.ok) return { ok: false, ...failureOf(conv) };
      const cid = asString((conv.json as { id?: unknown }).id);
      const msg = await c.tool.call('INTAKE', 'assistant_message', {
        params: { id: cid },
        body: { text, channel: 'TEXT' },
        stepKey: c.stepKey,
      });
      if (!msg.ok) return { ok: false, ...failureOf(msg) };
      const m = msg.json as { requestId?: string; request?: { title?: string } };
      if (!m.requestId)
        return {
          ok: false,
          code: 'NO_REQUEST',
          message: 'The assistant did not create a request',
          http: msg.status,
          errors: [],
        };
      return {
        ok: true,
        result: { requestId: m.requestId, via, ...(noted ? { note: noted } : {}) },
        tool: 'assistant_message',
        patch: { requestId: m.requestId, ...(m.request?.title ? { title: m.request.title } : {}) },
      };
    },
  };
}

const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  category: 'category',
  estimatedValue: 'estimated value',
  termMonths: 'term',
  businessUnit: 'business unit',
  contractOwner: 'contract owner',
};

/** Fixed order of repairs for a request that is missing mandatory fields (each is tried once, in this order). */
function requestRepairs(): readonly Repair[] {
  const patch = async (ctx: Ctx, body: Record<string, unknown>) => {
    const r = await ctx.tool.call('INTAKE', 'patch_request', {
      params: { id: ctx.obs.request!.id },
      body,
      stepKey: ctx.stepKey,
    });
    return r;
  };
  return [
    {
      key: 'FILL_FROM_TEXT',
      label: 'Fill what is missing from the request text',
      agent: 'INTAKE',
      async apply(ctx) {
        const o = ctx.obs.request!;
        const p = parseRequestText(asString(ctx.context.maskedText) || ctx.run.sourceText);
        const body: Record<string, unknown> = {};
        if (o.missing.includes('title') && p.title) body.title = p.title;
        if (o.missing.includes('category') && p.category) body.category = p.category;
        if (o.missing.includes('estimatedValue') && p.estimatedValue) body.estimatedValue = p.estimatedValue;
        if (o.missing.includes('termMonths') && p.termMonths) body.termMonths = p.termMonths;
        if (Object.keys(body).length === 0)
          return { applied: false, note: 'The text does not give any of the missing values' };
        const r = await patch(ctx, body);
        return r.ok
          ? {
              applied: true,
              note: `Set ${Object.keys(body)
                .map((k) => FIELD_LABEL[k] ?? k)
                .join(', ')} from the text`,
            }
          : { applied: false, note: `The change was refused: ${r.title ?? r.status}` };
      },
    },
    {
      key: 'FILL_FROM_PROFILE',
      label: 'Fill from the profile of the person who started the run',
      agent: 'INTAKE',
      async apply(ctx) {
        const o = ctx.obs.request!;
        const body: Record<string, unknown> = {};
        if (o.missing.includes('businessUnit') && ctx.profile.unitName)
          body.businessUnit = ctx.profile.unitName;
        if (o.missing.includes('contractOwner')) body.fields = { contractOwner: ctx.profile.name };
        if (Object.keys(body).length === 0)
          return { applied: false, note: 'The profile does not help with what is still missing' };
        const r = await patch(ctx, body);
        return r.ok
          ? {
              applied: true,
              note: `Used the profile for ${[...(body.businessUnit ? ['business unit'] : []), ...(body.fields ? ['contract owner'] : [])].join(' and ')}`,
            }
          : { applied: false, note: `The change was refused: ${r.title ?? r.status}` };
      },
    },
    {
      key: 'ASSUME_DEFAULTS',
      label: 'Use a stated default and flag it as an assumption',
      agent: 'INTAKE',
      async apply(ctx) {
        const o = ctx.obs.request!;
        const body: Record<string, unknown> = {};
        const assumed: string[] = [];
        if (o.missing.includes('termMonths')) {
          body.termMonths = 12;
          assumed.push('term 12 months');
        }
        if (o.missing.includes('category')) {
          body.category = 'General goods and services';
          assumed.push('category General goods and services');
        }
        if (o.missing.includes('title')) {
          body.title = `Procurement requested by ${ctx.profile.name}`;
          assumed.push('a working title');
        }
        if (Object.keys(body).length === 0)
          return {
            applied: false,
            note: 'No default is allowed for what is missing (for example the value is never assumed)',
          };
        const r = await patch(ctx, body);
        if (!r.ok) return { applied: false, note: `The change was refused: ${r.title ?? r.status}` };
        const prev = (ctx.context.assumptions as string[] | undefined) ?? [];
        await ctx.setContext({ assumptions: [...prev, ...assumed] });
        return { applied: true, note: `Assumed ${assumed.join(', ')}; a person should confirm` };
      },
    },
  ];
}

function completeRequest(ctx: Ctx): Action {
  const o = ctx.obs.request!;
  return {
    type: 'ACTION',
    key: `intake.complete_request:${o.id}`,
    repeatable: true,
    agent: 'INTAKE',
    stage: 'REQUEST',
    title: 'Checked the request has every mandatory field',
    reason: `Missing: ${o.missing.map((k) => FIELD_LABEL[k] ?? k).join(', ')}. A request cannot be submitted without them.`,
    rule: 'Validator: all mandatory request fields present (intake field catalogue)',
    repairs: requestRepairs(),
    escalate: (c, f) =>
      ownerGate(c, {
        key: `fields:${c.obs.request!.id}`,
        stage: 'REQUEST',
        title: `Copilot needs from you: ${c.obs.request!.missing.map((k) => FIELD_LABEL[k] ?? k).join(', ')}`,
        reason: `${f.message} The text did not give it and it is not something the Copilot may assume.`,
        link: L.request(c.obs.request!.id),
      }),
    async run(c) {
      const r = await c.tool.call('INTAKE', 'get_request', {
        params: { id: c.obs.request!.id },
        stepKey: c.stepKey,
      });
      if (!r.ok) return { ok: false, ...failureOf(r) };
      const missing = ((r.json as { missingFields?: string[] }).missingFields ?? []) as string[];
      if (missing.length === 0) return { ok: true, result: { missing: [] }, tool: 'get_request' };
      return {
        ok: false,
        code: 'MISSING_FIELDS',
        message: `Mandatory fields missing: ${missing.map((k) => FIELD_LABEL[k] ?? k).join(', ')}`,
        http: 409,
        errors: missing.map((k) => ({ field: k, message: `${FIELD_LABEL[k] ?? k} is required` })),
      };
    },
  };
}

function submitRequest(ctx: Ctx): Action {
  const o = ctx.obs.request!;
  return {
    type: 'ACTION',
    key: `request.submit:${o.id}:v${o.version}`,
    agent: 'INTAKE',
    stage: 'REQUEST',
    title: `Submitted request ${o.number}`,
    reason:
      'The request is complete, so it moves to planning. The budget check and routing run exactly as for a person.',
    rule: 'Submit through POST /requests/{id}/submit as the user; the budget cap decides',
    repairs: requestRepairs(),
    escalate: (c, f) =>
      f.code === 'BUDGET_EXCEEDED'
        ? {
            kind: 'NEEDS_HUMAN',
            agent: 'COMPLIANCE',
            stage: 'REQUEST',
            key: `budget:${o.id}`,
            title: `Budget amendment needed for ${o.number}`,
            reason: `${f.message}. The Copilot cannot change a budget; finance can amend it, or the value can be reduced.`,
            rule: 'Hard budget cap: submission is blocked until the budget is amended',
            link: L.request(o.id),
            roles: ['FINANCE'],
            userIds: [c.run.userId],
          }
        : ownerGate(c, {
            key: `submit:${o.id}`,
            stage: 'REQUEST',
            title: `Request ${o.number} could not be submitted`,
            reason: f.message,
            link: L.request(o.id),
          }),
    async run(c) {
      const r = await c.tool.call('INTAKE', 'submit_request', { params: { id: o.id }, stepKey: c.stepKey });
      if (!r.ok) return { ok: false, ...failureOf(r) };
      return {
        ok: true,
        result: { status: (r.json as { status?: string }).status },
        tool: 'submit_request',
        http: r.status,
      };
    },
    // a person without the creator role cannot submit it
    onForbidden: {
      kind: 'ROLE_REQUIRED',
      agent: 'INTAKE',
      stage: 'REQUEST',
      key: `submit-role:${o.id}`,
      title: `Submit request ${o.number}`,
      reason:
        'The person who started this run may not submit requests, so a requester or procurement officer must',
      rule: 'Same rules as a person: the route refused the role',
      link: L.request(o.id),
      roles: ['REQUESTER', 'PROCUREMENT'],
    },
  };
}

// ================================================================================================ PLAN
async function planStage(ctx: Ctx): Promise<Decision> {
  const o = ctx.obs;
  const rq = o.request!;
  const p = o.plan;
  if (!p) {
    return {
      type: 'ACTION',
      key: `plan.open:${rq.id}`,
      agent: 'WORKFLOW',
      stage: 'PLAN',
      title: 'Opened the procurement plan',
      reason:
        'The request is submitted, so the plan is created from it with the sections drafted from the request.',
      rule: 'Plan is created from the submitted request (GET /requests/{id}/plan)',
      repairs: [],
      escalate: (c, f) =>
        ownerGate(c, {
          key: `plan-open:${rq.id}`,
          stage: 'PLAN',
          title: 'The plan could not be opened',
          reason: f.message,
          link: L.request(rq.id),
        }),
      async run(c) {
        const r = await c.tool.call('WORKFLOW', 'open_plan', { params: { id: rq.id }, stepKey: c.stepKey });
        if (!r.ok) return { ok: false, ...failureOf(r) };
        return {
          ok: true,
          result: { planId: (r.json as { id?: string }).id, status: (r.json as { status?: string }).status },
          tool: 'open_plan',
        };
      },
      onForbidden: {
        kind: 'ROLE_REQUIRED',
        agent: 'WORKFLOW',
        stage: 'PLAN',
        key: `plan-open-role:${rq.id}`,
        title: `Open the plan for ${rq.number}`,
        reason: 'The person who started this run may not open plans',
        rule: 'Same rules as a person: the route refused the role',
        link: L.plan(rq.id),
        roles: ['PROCUREMENT'],
      },
    };
  }
  if (p.status === 'DRAFT' || p.status === 'REOPENED') {
    if (p.missingSections.length > 0) return fillPlan(ctx);
    if (!ctx.can('WORKFLOW', 'submit_plan'))
      return {
        type: 'GATES',
        stage: 'PLAN',
        summary: 'The plan is ready; a procurement officer submits it for approval',
        gates: [
          {
            kind: 'PLAN_SUBMIT',
            agent: 'WORKFLOW',
            stage: 'PLAN',
            key: `plan-submit:${p.id}:v${p.version}`,
            title: `Submit the plan for ${rq.number} for approval`,
            reason:
              'Only a procurement officer can submit a plan for approval, and the person who started this run does not hold that role',
            rule: 'Same rules as a person: submit-for-approval is for PROCUREMENT',
            link: L.plan(rq.id),
            roles: ['PROCUREMENT'],
          },
        ],
      };
    return {
      type: 'ACTION',
      key: `plan.submit:${p.id}:v${p.version}`,
      agent: 'WORKFLOW',
      stage: 'PLAN',
      title: 'Submitted the plan for approval',
      reason: 'Every mandatory section is filled, so the plan goes to its checks and then to the delegate.',
      rule: 'Plan sections complete (validator), then POST /plans/{id}/submit-for-approval',
      repairs: [planFillRepair()],
      escalate: (c, f) =>
        ownerGate(c, {
          key: `plan-submit:${p.id}`,
          stage: 'PLAN',
          title: `The plan for ${rq.number} could not be submitted`,
          reason: f.message,
          link: L.plan(rq.id),
          roles: ['PROCUREMENT'],
        }),
      async run(c) {
        const r = await c.tool.call('WORKFLOW', 'submit_plan', { params: { id: p.id }, stepKey: c.stepKey });
        if (!r.ok) return { ok: false, ...failureOf(r) };
        return {
          ok: true,
          result: { status: (r.json as { status?: string }).status },
          tool: 'submit_plan',
          http: r.status,
        };
      },
    };
  }
  if (p.status === 'AWAITING_SIGNOFF') {
    const view = await ctx.tool.call('WORKFLOW', 'open_plan', {
      params: { id: rq.id },
      stepKey: ctx.stepKey || 'plan.gates',
    });
    const gates = view.ok
      ? (((view.json as { gates?: Array<{ key: string; label: string; reason: string; status: string }> })
          .gates ?? []) as Array<{ key: string; label: string; reason: string; status: string }>)
      : [];
    const required = gates.filter((g) => g.status === 'REQUIRED');
    const out: GateSpec[] = [];
    for (const g of required) {
      if (g.key === 'RISK_SIGNOFF')
        out.push({
          kind: 'PLAN_RISK_SIGNOFF',
          agent: 'COMPLIANCE',
          stage: 'PLAN',
          key: `plan-risk:${p.id}`,
          title: `Risk sign-off for ${rq.number}`,
          reason: g.reason || 'The independent risk officer must sign off this plan',
          rule: 'Plan gate RISK_SIGNOFF (independent risk officer, probity)',
          link: L.plan(rq.id),
          roles: ['PROBITY'],
        });
      else
        out.push({
          kind: 'PLAN_COI',
          agent: 'COMPLIANCE',
          stage: 'PLAN',
          key: `plan-coi:${p.id}`,
          title: `Declare conflicts of interest for ${rq.number}`,
          reason:
            g.reason ||
            'A procurement officer must declare any conflict before the plan goes to the delegate. A declaration is personal, so the Copilot never makes it',
          rule: `Plan gate ${g.key}`,
          link: L.plan(rq.id),
          roles: ['PROCUREMENT'],
        });
    }
    if (out.length === 0)
      out.push({
        kind: 'PLAN_CHECKS',
        agent: 'WORKFLOW',
        stage: 'PLAN',
        key: `plan-checks:${p.id}`,
        title: `Required checks on the plan for ${rq.number}`,
        reason: 'The plan is waiting for its required checks',
        rule: 'Plan state AWAITING_SIGNOFF',
        link: L.plan(rq.id),
        roles: ['PROCUREMENT', 'PROBITY'],
      });
    return {
      type: 'GATES',
      stage: 'PLAN',
      gates: out,
      summary: 'Required checks on the plan are with people',
    };
  }
  if (p.status === 'AWAITING_APPROVAL') {
    const route = await withSystem(ctx.d.database, (tx) =>
      routeApproval(tx, ctx.run.tenantId, rq.estimatedValue),
    );
    return {
      type: 'GATES',
      stage: 'PLAN',
      summary: 'The plan is with the approver',
      gates: [
        {
          kind: 'PLAN_APPROVAL',
          agent: 'WORKFLOW',
          stage: 'PLAN',
          key: `plan-approve:${p.id}`,
          title: `Approve the plan for ${rq.number}`,
          reason: `The plan (${aud(rq.estimatedValue)}) needs a delegate whose sourcing authority covers it. The Copilot never approves`,
          rule: 'Gate: plan approval is human (delegation of authority, segregation of duties)',
          link: L.plan(rq.id),
          roles: route.userIds.length ? [] : ['DELEGATE', 'EXEC'],
          userIds: route.userIds,
        },
      ],
    };
  }
  // REJECTED
  return {
    type: 'HUMAN',
    stage: 'PLAN',
    summary: 'The plan was rejected',
    gate: {
      kind: 'NEEDS_HUMAN',
      agent: 'ORCHESTRATOR',
      stage: 'PLAN',
      key: `plan-rejected:${p.id}`,
      title: `The plan for ${rq.number} was rejected`,
      reason:
        'An approver rejected the plan. A person revises it and submits it again; the Copilot does not rewrite a plan an approver rejected',
      rule: 'Rejection is a human decision',
      link: L.plan(rq.id),
      roles: ['PROCUREMENT'],
      userIds: [ctx.run.userId],
    },
  };
}

function synthesize(ctx: Ctx, key: string): string {
  const r = ctx.obs.request!;
  const def = PLAN_FIELDS.find((f) => f.key === key);
  const what = `${r.title}${r.category ? ` (${r.category})` : ''}, about ${aud(r.estimatedValue)}${r.termMonths ? ` over ${r.termMonths} months` : ''}`;
  return `${def?.label ?? key}: drafted by the Procurement Copilot (simulated, rules-simulated-v1) from the request for ${what}. The procurement lead reviews and completes this section.`;
}

async function writePlanSections(ctx: Ctx): Promise<ActionResult> {
  let version: number;
  const filled: string[] = [];
  const cap = (ctx.context.capabilities ?? {}) as Record<string, boolean>;
  if (cap.draft !== false && ctx.can('DOCFILL', 'draft_plan')) {
    const r = await ctx.tool.call('DOCFILL', 'draft_plan', {
      body: {
        kind: 'PLAN',
        text: asString(ctx.context.maskedText) || ctx.run.sourceText,
        procurementId: ctx.obs.request!.id,
        source: 'TEXT',
      },
      stepKey: ctx.stepKey,
    });
    if (r.notAvailable) await ctx.setContext({ capabilities: { ...cap, draft: false } });
    else if (r.ok) {
      const id = asString((r.json as { id?: unknown }).id);
      if (id) {
        const a = await ctx.tool.call('DOCFILL', 'apply_draft', {
          params: { id },
          body: {},
          stepKey: ctx.stepKey,
        });
        if (a.ok) filled.push('(applied from the drafting module)');
      }
    }
  }
  // whatever is still empty is filled from the request itself
  const cur = await ctx.tool.call('DOCFILL', 'get_plan', {
    params: { id: ctx.obs.request!.id },
    stepKey: ctx.stepKey,
  });
  if (!cur.ok) return { ok: false, ...failureOf(cur) };
  const view = cur.json as {
    id: string;
    version: number;
    fields: Array<{ key: string; paragraphs?: string[] }>;
  };
  version = view.version;
  const empty = PLAN_FIELDS.filter(
    (f) => f.mandatory && !(view.fields.find((x) => x.key === f.key)?.paragraphs ?? []).length,
  );
  for (const f of empty) {
    const w = await ctx.tool.call('DOCFILL', 'put_plan_field', {
      params: { id: view.id, key: f.key },
      body: { value: synthesize(ctx, f.key), expectedVersion: version },
      stepKey: ctx.stepKey,
    });
    if (!w.ok) return { ok: false, ...failureOf(w) };
    version = (w.json as { version?: number }).version ?? version;
    filled.push(f.key);
  }
  return { ok: true, result: { filledSections: filled }, tool: 'put_plan_field' };
}

function planFillRepair(): Repair {
  return {
    key: 'FILL_MISSING_SECTIONS',
    label: 'Fill the empty mandatory plan sections from the request',
    agent: 'DOCFILL',
    async apply(ctx) {
      const r = await writePlanSections(ctx);
      return r.ok
        ? { applied: true, note: `Filled ${(r.result.filledSections as string[]).length} section(s)` }
        : { applied: false, note: `Could not fill the sections: ${r.message}` };
    },
  };
}

function fillPlan(ctx: Ctx): Action {
  const rq = ctx.obs.request!;
  const p = ctx.obs.plan!;
  return {
    type: 'ACTION',
    key: `plan.fill:${p.id}:v${p.version}`,
    agent: 'DOCFILL',
    stage: 'PLAN',
    title: 'Filled the empty mandatory plan sections',
    reason: `These sections are empty: ${p.missingSections.join(', ')}. A plan cannot go to approval without them.`,
    rule: 'Validator: every mandatory plan section has text',
    repairs: [planFillRepair()],
    escalate: (c, f) =>
      ownerGate(c, {
        key: `plan-fill:${p.id}`,
        stage: 'PLAN',
        title: `The plan for ${rq.number} needs sections written`,
        reason: f.message,
        link: L.plan(rq.id),
        roles: ['PROCUREMENT'],
      }),
    run: (c) => writePlanSections(c),
  };
}

// ================================================================================================ TENDER
async function tenderStage(ctx: Ctx): Promise<Decision> {
  const o = ctx.obs;
  const rq = o.request!;
  const t = o.tender;
  if (!t) {
    if (!ctx.can('WORKFLOW', 'create_tender'))
      return {
        type: 'GATES',
        stage: 'TENDER',
        summary: 'The plan is approved; a procurement officer stages the tender',
        gates: [
          {
            kind: 'TENDER_CREATE',
            agent: 'WORKFLOW',
            stage: 'TENDER',
            key: `tender-create:${rq.id}`,
            title: `Stage the tender for ${rq.number}`,
            reason:
              'The plan is approved. Only a procurement officer can stage a tender, and the person who started this run does not hold that role',
            rule: 'Same rules as a person: POST /tenders is for PROCUREMENT',
            link: L.plan(rq.id),
            roles: ['PROCUREMENT'],
          },
        ],
      };
    const type = rq.estimatedValue > 0 && rq.estimatedValue <= 50_000 ? 'RFQ' : 'RFP';
    return {
      type: 'ACTION',
      key: `tender.create:${rq.id}`,
      agent: 'WORKFLOW',
      stage: 'TENDER',
      title: `Staged a ${type} tender pack from the approved plan`,
      reason: `The plan is approved and locked. A ${type} suits ${aud(rq.estimatedValue)}; open access lets any invited or registered supplier see it (for the demonstration).`,
      rule: 'Tender pack is built from the approved plan; the pack stays staged until a delegate gives permission to publish',
      repairs: [],
      escalate: (c, f) =>
        ownerGate(c, {
          key: `tender-create:${rq.id}`,
          stage: 'TENDER',
          title: `The tender for ${rq.number} could not be staged`,
          reason: f.message,
          link: L.plan(rq.id),
          roles: ['PROCUREMENT'],
        }),
      async run(c) {
        const r = await c.tool.call('WORKFLOW', 'create_tender', {
          body: { requestId: rq.id, type, access: 'OPEN' },
          stepKey: c.stepKey,
        });
        if (!r.ok) return { ok: false, ...failureOf(r) };
        return {
          ok: true,
          result: { tenderId: (r.json as { id?: string }).id, type },
          tool: 'create_tender',
          http: r.status,
        };
      },
    };
  }
  if (t.status === 'STAGED' || t.status === 'DRAFT') {
    if (!t.permissionGranted)
      return {
        type: 'GATES',
        stage: 'TENDER',
        summary: 'The tender is staged; a delegate gives permission to publish',
        gates: [
          {
            kind: 'TENDER_PUBLISH_PERMISSION',
            agent: 'WORKFLOW',
            stage: 'TENDER',
            key: `tender-permission:${t.id}`,
            title: `Give permission to publish the tender for ${rq.number}`,
            reason: `A delegate whose authority covers ${aud(rq.estimatedValue)} must allow publication. The Copilot never grants it`,
            rule: 'Gate: permission to publish is human (delegation of authority)',
            link: L.tender(t.id),
            roles: ['DELEGATE'],
          },
        ],
      };
    if (!ctx.can('WORKFLOW', 'publish_tender'))
      return {
        type: 'GATES',
        stage: 'TENDER',
        summary: 'Permission is given; a procurement officer publishes',
        gates: [
          {
            kind: 'TENDER_PUBLISH',
            agent: 'WORKFLOW',
            stage: 'TENDER',
            key: `tender-publish:${t.id}`,
            title: `Publish the tender for ${rq.number}`,
            reason:
              'Permission to publish is given. Only a procurement officer can publish, and the person who started this run does not hold that role',
            rule: 'Same rules as a person: publish is for PROCUREMENT',
            link: L.tender(t.id),
            roles: ['PROCUREMENT'],
          },
        ],
      };
    return {
      type: 'ACTION',
      key: `tender.publish:${t.id}:v${t.version}`,
      agent: 'WORKFLOW',
      stage: 'TENDER',
      title: 'Published the tender',
      reason:
        'Permission to publish is given and the plan is locked, so the tender goes out with a closing time.',
      rule: 'POST /tenders/{id}/publish; the statutory minimum window is checked by the route',
      repairs: [
        {
          key: 'EXTEND_TO_STATUTORY_WINDOW',
          label: 'Move the closing time out to the statutory minimum the check named',
          agent: 'COMPLIANCE',
          async apply(c, f) {
            const m =
              /at least (\d+)/i.exec(f.message) ??
              /at least (\d+)/i.exec(f.errors.map((e) => e.message).join(' '));
            const days = m ? Number(m[1]) : 0;
            if (!days) return { applied: false, note: 'The check did not say how many days are required' };
            await c.setContext({ tenderDaysOverride: days + 1 });
            return {
              applied: true,
              note: `Closing time moved to ${days + 1} days from now (the statutory minimum is ${days})`,
            };
          },
        },
      ],
      escalate: (c, f) =>
        ownerGate(c, {
          key: `tender-publish:${t.id}`,
          stage: 'TENDER',
          title: `The tender for ${rq.number} could not be published`,
          reason: f.message,
          link: L.tender(t.id),
          roles: ['PROCUREMENT'],
        }),
      async run(c) {
        const days = Number(c.context.tenderDaysOverride ?? c.tenderDays);
        const closesAt = new Date(c.now.getTime() + days * DAY).toISOString();
        const r = await c.tool.call('WORKFLOW', 'publish_tender', {
          params: { id: t.id },
          body: { closesAt },
          stepKey: c.stepKey,
        });
        if (!r.ok) return { ok: false, ...failureOf(r) };
        return { ok: true, result: { closesAt, days }, tool: 'publish_tender', http: r.status };
      },
    };
  }
  if (t.status === 'PUBLISHED') {
    return {
      type: 'WAIT',
      stage: 'TENDER',
      until: t.closesAt,
      summary: `The tender is open until ${t.closesAt?.toISOString().slice(0, 16).replace('T', ' ')} UTC with ${t.bids} bid(s). Suppliers respond on their own and the closing time is the statutory minimum; for a demonstration press "Simulate supplier responses", then "Simulate closing time".`,
    };
  }
  // CLOSED, no evaluation yet
  if (t.dualWitness && !t.openedAt)
    return {
      type: 'GATES',
      stage: 'EVALUATION',
      summary: 'The bids are sealed until two witnesses open them',
      gates: [
        {
          kind: 'TENDER_WITNESS',
          agent: 'COMPLIANCE',
          stage: 'EVALUATION',
          key: `tender-witness:${t.id}`,
          title: `Two witnesses must open the bids for ${rq.number}`,
          reason:
            'This tender is high value, so its bids stay sealed until two independent people open them. Each confirms with their own password, so the Copilot cannot do it',
          rule: 'Gate: dual-witness opening (probity)',
          link: L.tender(t.id),
          roles: ['PROBITY', 'LEGAL', 'DELEGATE', 'EXEC', 'PROCUREMENT'],
        },
      ],
    };
  if (t.bids === 0)
    return {
      type: 'HUMAN',
      stage: 'EVALUATION',
      summary: 'The tender closed without bids',
      gate: ownerGate(ctx, {
        key: `no-bids:${t.id}`,
        stage: 'EVALUATION',
        title: `No bids were received for ${rq.number}`,
        reason:
          'The tender has closed with no submitted bids, so there is nothing to evaluate. A person decides whether to re-issue the tender or change the approach',
        link: L.tender(t.id),
        roles: ['PROCUREMENT'],
        rule: 'Nothing to evaluate; the route refuses an evaluation without bids',
      }),
    };
  if (!ctx.can('WORKFLOW', 'open_evaluation'))
    return {
      type: 'GATES',
      stage: 'EVALUATION',
      summary: 'The tender closed; a procurement officer sets up the evaluation',
      gates: [
        {
          kind: 'EVALUATION_SETUP',
          agent: 'WORKFLOW',
          stage: 'EVALUATION',
          key: `eval-setup:${t.id}`,
          title: `Set up the evaluation for ${rq.number}`,
          reason: `The tender closed with ${t.bids} bid(s). Only a procurement officer can open an evaluation and name the panel`,
          rule: 'Same rules as a person: opening an evaluation is for PROCUREMENT',
          link: L.tender(t.id),
          roles: ['PROCUREMENT'],
        },
      ],
    };
  return {
    type: 'ACTION',
    key: `evaluation.open:${t.id}`,
    agent: 'WORKFLOW',
    stage: 'EVALUATION',
    title: 'Opened the evaluation with a panel',
    reason: `The tender closed with ${t.bids} bid(s). A panel of evaluators who hold the evaluator role is named; the panel then declares conflicts and scores.`,
    rule: 'Panel members must be evaluators, not the requester, and segregated from the bidders (checked by the route)',
    repairs: [rotatePanel(), rotatePanel()],
    escalate: (c, f) =>
      ownerGate(c, {
        key: `eval-open:${t.id}`,
        stage: 'EVALUATION',
        title: `The evaluation for ${rq.number} could not be opened`,
        reason: f.message,
        link: L.tender(t.id),
        roles: ['PROCUREMENT'],
      }),
    async run(c) {
      const list = await c.tool.call('WORKFLOW', 'list_evaluators', { stepKey: c.stepKey });
      if (!list.ok) return { ok: false, ...failureOf(list) };
      const evs = (
        (list.json as { evaluators?: Array<{ id: string; name: string }> }).evaluators ?? []
      ).filter((e) => e.id !== rq.requesterId);
      if (evs.length < 2)
        return {
          ok: false,
          code: 'NO_PANEL',
          message: `Only ${evs.length} evaluator(s) are available; a technical and a commercial evaluator are needed`,
          http: 409,
          errors: [],
        };
      const off = Number(c.context.panelOffset ?? 0);
      const tech = evs[off % evs.length]!;
      const comm = evs[(off + 1) % evs.length]!;
      const r = await c.tool.call('WORKFLOW', 'open_evaluation', {
        params: { id: t.id },
        body: {
          panel: [
            { userId: tech.id, stream: 'TECHNICAL' },
            { userId: comm.id, stream: 'COMMERCIAL' },
          ],
        },
        stepKey: c.stepKey,
      });
      if (!r.ok) return { ok: false, ...failureOf(r) };
      return {
        ok: true,
        result: {
          evaluationId: (r.json as { id?: string }).id,
          panel: [`${tech.name} (technical)`, `${comm.name} (commercial)`],
        },
        tool: 'open_evaluation',
        http: r.status,
      };
    },
  };
}

function rotatePanel(): Repair {
  return {
    key: 'CHOOSE_DIFFERENT_PANEL',
    label: 'Choose a different pair of evaluators',
    agent: 'WORKFLOW',
    async apply(ctx) {
      const next = Number(ctx.context.panelOffset ?? 0) + 1;
      await ctx.setContext({ panelOffset: next });
      return { applied: true, note: 'Tried a different technical and commercial evaluator' };
    },
  };
}

// ================================================================================================ EVALUATION
async function evaluationStage(ctx: Ctx): Promise<Decision> {
  const rq = ctx.obs.request!;
  const e = ctx.obs.evaluation!;
  const link = L.evaluation(e.id);
  const g = (
    kind: string,
    key: string,
    title: string,
    reason: string,
    rule: string,
    extra: Partial<GateSpec>,
  ): GateSpec => ({
    kind,
    agent: 'WORKFLOW',
    stage: e.status === 'REPORTED' ? 'AWARD' : 'EVALUATION',
    key: `${key}:${e.id}`,
    title,
    reason,
    rule,
    link,
    roles: [],
    ...extra,
  });
  if (e.held)
    return {
      type: 'GATES',
      stage: 'EVALUATION',
      summary: 'The evaluation is on hold',
      gates: [
        g(
          'EVALUATION_HOLD',
          'eval-hold',
          `The evaluation for ${rq.number} is on hold`,
          'A probity officer placed it on hold and releases it',
          'Probity hold',
          { roles: ['PROBITY'], agent: 'COMPLIANCE' },
        ),
      ],
    };
  const active = e.panel.filter((m) => m.coiState !== 'REMOVED');
  if (e.status === 'COI_PENDING') {
    const undeclared = active.filter((m) => m.coiState === 'NOT_DECLARED');
    const conflicts = active.filter((m) => m.coiState === 'DECLARED_CONFLICT');
    const gates: GateSpec[] = [];
    if (undeclared.length)
      gates.push(
        g(
          'PANEL_COI',
          'panel-coi',
          `Declare any conflict of interest for ${rq.number}`,
          'Each panel member declares before seeing any bid. A declaration is personal, so the Copilot never makes it',
          'Gate: conflict declarations are personal',
          { userIds: undeclared.map((m) => m.userId), agent: 'COMPLIANCE' },
        ),
      );
    if (conflicts.length)
      gates.push(
        g(
          'PANEL_CONFLICT_DECISION',
          'panel-conflict',
          `Decide a declared conflict for ${rq.number}`,
          'A panel member declared a conflict; a delegate decides what happens',
          'Gate: conflict decisions are human',
          { roles: ['DELEGATE', 'EXEC', 'PROBITY'], agent: 'COMPLIANCE' },
        ),
      );
    if (gates.length === 0)
      gates.push(
        g(
          'PANEL_COI',
          'panel-coi-wait',
          `Panel conflict declarations for ${rq.number}`,
          'Waiting for the declarations to be recorded',
          'Evaluation state COI_PENDING',
          { userIds: active.map((m) => m.userId) },
        ),
      );
    return { type: 'GATES', stage: 'EVALUATION', gates, summary: 'The panel declares conflicts of interest' };
  }
  if (e.status === 'SCORING') {
    const conflicts = active.filter((m) => m.coiState === 'DECLARED_CONFLICT');
    const waiting = active.filter((m) => m.coiState === 'DECLARED_NONE' && !m.scored);
    const gates: GateSpec[] = [];
    if (conflicts.length)
      gates.push(
        g(
          'PANEL_CONFLICT_DECISION',
          'panel-conflict',
          `Decide a declared conflict for ${rq.number}`,
          'A panel member declared a conflict; a delegate decides what happens',
          'Gate: conflict decisions are human',
          { roles: ['DELEGATE', 'EXEC', 'PROBITY'], agent: 'COMPLIANCE' },
        ),
      );
    if (waiting.length)
      gates.push(
        g(
          'PANEL_SCORING',
          'panel-scoring',
          `Score the bids for ${rq.number}`,
          'Panel members score independently. Scoring is a judgement, so the Copilot never scores',
          'Gate: panel scoring is human',
          { userIds: waiting.map((m) => m.userId) },
        ),
      );
    if (!waiting.length && !conflicts.length)
      gates.push(
        g(
          'CHAIR_OPEN_CONSENSUS',
          'chair-open',
          `Open consensus for ${rq.number}`,
          'Everyone has scored; the panel chair opens the consensus meeting',
          'Gate: the chair runs consensus',
          { userIds: e.chairIds, roles: e.chairIds.length ? [] : ['CHAIR'] },
        ),
      );
    return { type: 'GATES', stage: 'EVALUATION', gates, summary: 'The panel scores the bids' };
  }
  if (e.status === 'CONSENSUS')
    return {
      type: 'GATES',
      stage: 'EVALUATION',
      summary: 'The chair agrees consensus scores',
      gates: [
        g(
          'CHAIR_LOCK_CONSENSUS',
          'chair-lock',
          `Agree and lock consensus for ${rq.number}`,
          'The chair records the consensus scores and locks them',
          'Gate: the chair locks consensus',
          { userIds: e.chairIds, roles: e.chairIds.length ? [] : ['CHAIR'] },
        ),
      ],
    };
  if (e.status === 'LOCKED') {
    if (!ctx.can('WORKFLOW', 'generate_report'))
      return {
        type: 'GATES',
        stage: 'EVALUATION',
        summary: 'Consensus is locked; a procurement officer generates the report',
        gates: [
          g(
            'REPORT_GENERATE',
            'report-generate',
            `Generate the evaluation report for ${rq.number}`,
            'Consensus is locked. Only a procurement officer generates the report, and the person who started this run does not hold that role',
            'Same rules as a person: report generation is for PROCUREMENT',
            { roles: ['PROCUREMENT'] },
          ),
        ],
      };
    return {
      type: 'ACTION',
      key: `evaluation.report:${e.id}:v${e.version}`,
      agent: 'WORKFLOW',
      stage: 'EVALUATION',
      title: 'Generated the evaluation report and sent it for approval',
      reason:
        'Consensus is locked, so the report is composed from the agreed scores and routed to the delegate whose authority covers the value.',
      rule: 'POST /evaluations/{id}/report once consensus is locked',
      repairs: [],
      escalate: (c, f) =>
        ownerGate(c, {
          key: `report:${e.id}`,
          stage: 'EVALUATION',
          title: `The report for ${rq.number} could not be generated`,
          reason: f.message,
          link,
          roles: ['PROCUREMENT'],
        }),
      async run(c) {
        const r = await c.tool.call('WORKFLOW', 'generate_report', {
          params: { id: e.id },
          stepKey: c.stepKey,
        });
        if (!r.ok) return { ok: false, ...failureOf(r) };
        return {
          ok: true,
          result: { status: (r.json as { status?: string }).status },
          tool: 'generate_report',
          http: r.status,
        };
      },
    };
  }
  // REPORTED: the award decision
  const route = await withSystem(ctx.d.database, (tx) =>
    routeApproval(tx, ctx.run.tenantId, rq.estimatedValue),
  );
  return {
    type: 'GATES',
    stage: 'AWARD',
    summary: 'The award is with the approver',
    gates: [
      g(
        'AWARD_APPROVAL',
        'award-approve',
        `Approve the award for ${rq.number}`,
        `The evaluation report (${aud(rq.estimatedValue)}) needs the delegate whose authority covers it. The Copilot never approves an award`,
        'Gate: award approval is human (delegation of authority, segregation of duties)',
        {
          userIds: route.userIds,
          roles: route.userIds.length ? [] : ['DELEGATE', 'EXEC'],
        },
      ),
    ],
  };
}

// ================================================================================================ CONTRACT
async function contractStage(ctx: Ctx): Promise<Decision> {
  const rq = ctx.obs.request!;
  const e = ctx.obs.evaluation!;
  const c0 = ctx.obs.contract;
  if (!c0) {
    if (!ctx.can('WORKFLOW', 'draft_contract'))
      return {
        type: 'GATES',
        stage: 'CONTRACT',
        summary: 'The award is approved; legal or procurement drafts the contract',
        gates: [
          {
            kind: 'CONTRACT_DRAFT',
            agent: 'WORKFLOW',
            stage: 'CONTRACT',
            key: `contract-draft:${e.id}`,
            title: `Draft the contract for ${rq.number}`,
            reason:
              'The award is approved. Only legal or a procurement officer can draft a contract, and the person who started this run does not hold either role',
            rule: 'Same rules as a person: POST /contracts is for LEGAL and PROCUREMENT',
            link: L.evaluation(e.id),
            roles: ['LEGAL', 'PROCUREMENT'],
          },
        ],
      };
    return {
      type: 'ACTION',
      key: `contract.draft:${e.id}`,
      agent: 'WORKFLOW',
      stage: 'CONTRACT',
      title: 'Drafted the contract from the approved award',
      reason:
        'The award is approved, so the contract is drafted for the top-ranked compliant supplier from the standard template.',
      rule: 'POST /contracts for the recommended supplier of the approved evaluation',
      repairs: [],
      escalate: (c, f) =>
        ownerGate(c, {
          key: `contract-draft:${e.id}`,
          stage: 'CONTRACT',
          title: `The contract for ${rq.number} could not be drafted`,
          reason: f.message,
          link: L.evaluation(e.id),
          roles: ['LEGAL', 'PROCUREMENT'],
        }),
      async run(c) {
        const aw = await c.tool.call('WORKFLOW', 'list_awards', { stepKey: c.stepKey });
        if (!aw.ok) return { ok: false, ...failureOf(aw) };
        const mine = (
          aw.json as Array<{
            evaluationId: string;
            recommended: Array<{ supplierId: string; company: string }>;
          }>
        ).find((x) => x.evaluationId === e.id);
        const top = mine?.recommended?.[0];
        if (!top)
          return {
            ok: false,
            code: 'NO_RECOMMENDED_SUPPLIER',
            message: 'The approved evaluation has no top-ranked supplier that passes compliance',
            http: 409,
            errors: [],
          };
        const r = await c.tool.call('WORKFLOW', 'draft_contract', {
          body: { evaluationId: e.id, supplierId: top.supplierId },
          stepKey: c.stepKey,
        });
        if (!r.ok) return { ok: false, ...failureOf(r) };
        return {
          ok: true,
          result: { contractId: (r.json as { id?: string }).id, supplier: top.company },
          tool: 'draft_contract',
          http: r.status,
        };
      },
    };
  }
  if (c0.status === 'EXECUTED') return contractSnapshot(ctx);
  if (c0.status === 'DRAFT' || c0.status === 'LEGAL_REVIEW') {
    const isLegal = ctx.roles.includes('LEGAL');
    if (c0.status === 'DRAFT' && !isLegal)
      return {
        type: 'GATES',
        stage: 'CONTRACT',
        summary: 'The contract draft is with legal',
        gates: [
          {
            kind: 'CONTRACT_LEGAL_REVIEW',
            agent: 'COMPLIANCE',
            stage: 'CONTRACT',
            key: `contract-legal:${c0.id}`,
            title: `Legal review of contract ${c0.number}`,
            reason:
              'Legal must review the draft before it is released for signature. The Copilot does not review contract wording for legal effect',
            rule: 'Gate: legal review is human',
            link: L.contract(c0.id),
            roles: ['LEGAL'],
          },
        ],
      };
    return releaseContract(ctx);
  }
  // AWAITING_SIGNATURE or PARTIALLY_SIGNED
  return {
    type: 'GATES',
    stage: 'CONTRACT',
    summary: 'The contract is with its signatories',
    gates: [
      {
        kind: 'CONTRACT_SIGN',
        agent: 'WORKFLOW',
        stage: 'CONTRACT',
        key: `contract-sign:${c0.id}:${c0.status}`,
        title: `Sign contract ${c0.number}`,
        reason: `The contract (${aud(c0.value)}) is released for signature. Signing is a personal legal act, so the Copilot never signs`,
        rule: 'Gate: contract signature is human (delegation of authority, signature level)',
        link: L.contract(c0.id),
        roles: ['DELEGATE', 'EXEC'],
      },
    ],
  };
}

function releaseContract(ctx: Ctx): Action {
  const rq = ctx.obs.request!;
  const c0 = ctx.obs.contract!;
  const blockerText = (f: Failure) => f.errors.map((e) => e.message).join(' | ');
  return {
    type: 'ACTION',
    key: `contract.release:${c0.id}:v${c0.version}`,
    agent: 'WORKFLOW',
    stage: 'CONTRACT',
    title: 'Released the contract for signature',
    reason:
      'Legal has reviewed the draft, so the contract is released to its signatories once the release checks pass.',
    rule: 'POST /contracts/{id}/release-for-signing; the route lists any blockers',
    repairs: [
      {
        key: 'FILL_DATES',
        label: 'Set the start and end dates from the request term',
        agent: 'COMPLIANCE',
        async apply(c, f) {
          if (!/date/i.test(blockerText(f)))
            return { applied: false, note: 'The blockers are not about dates' };
          const months = rq.termMonths ?? 12;
          const start = new Date(c.now.getTime() + 14 * DAY);
          const end = new Date(start.getTime());
          end.setUTCMonth(end.getUTCMonth() + months);
          const r = await c.tool.call('COMPLIANCE', 'patch_contract_terms', {
            params: { id: c0.id },
            body: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) },
            stepKey: c.stepKey,
          });
          return r.ok
            ? {
                applied: true,
                note: `Start ${start.toISOString().slice(0, 10)}, end ${end.toISOString().slice(0, 10)} (${months} months from the request)`,
              }
            : { applied: false, note: `Refused: ${r.title ?? r.status}` };
        },
      },
      {
        key: 'FILL_EMPTY_MANDATORY_CLAUSE',
        label: 'Add standard wording to an empty mandatory clause',
        agent: 'COMPLIANCE',
        async apply(c, f) {
          const titles = [
            ...blockerText(f).matchAll(
              /Mandatory clause "([^"]+)" is empty|Clause "([^"]+)" still has an unfilled placeholder/g,
            ),
          ].map((m) => m[1] ?? m[2]!);
          if (titles.length === 0) return { applied: false, note: 'No empty mandatory clause is named' };
          const v = await c.tool.call('COMPLIANCE', 'get_contract', {
            params: { id: c0.id },
            stepKey: c.stepKey,
          });
          if (!v.ok) return { applied: false, note: `Could not read the contract: ${v.title ?? v.status}` };
          const clauses = ((v.json as { clauses?: Array<{ clauseId: string; title: string; text: string }> })
            .clauses ?? []) as Array<{ clauseId: string; title: string; text: string }>;
          let done = 0;
          for (const t of titles) {
            const k = clauses.find((x) => x.title === t);
            if (!k) continue;
            const text = `${k.text.replace(/\{\{[A-Z_]+\}\}/g, '[to be confirmed by Legal]').trim() || `The parties comply with the standard terms for ${t}.`} (Standard wording added by the Procurement Copilot, simulated; Legal confirms.)`;
            const r = await c.tool.call('COMPLIANCE', 'put_contract_clause', {
              params: { id: c0.id, clauseId: k.clauseId },
              body: { text },
              stepKey: c.stepKey,
            });
            if (r.ok) done += 1;
          }
          return done > 0
            ? {
                applied: true,
                note: `Added standard wording to ${done} clause(s); a changed clause still needs a deviation decision`,
              }
            : { applied: false, note: 'The clause could not be changed' };
        },
      },
    ],
    escalate: (c, f) =>
      ownerGate(c, {
        key: `contract-release:${c0.id}`,
        stage: 'CONTRACT',
        title: `Contract ${c0.number} cannot be released yet`,
        reason: `${f.message}${f.errors.length ? `: ${f.errors.map((e) => e.message).join('; ')}` : ''}`,
        link: L.contract(c0.id),
        roles: ['LEGAL'],
      }),
    async run(c) {
      const r = await c.tool.call('WORKFLOW', 'release_contract', {
        params: { id: c0.id },
        body: {},
        stepKey: c.stepKey,
      });
      if (!r.ok) return { ok: false, ...failureOf(r) };
      return {
        ok: true,
        result: { status: (r.json as { status?: string }).status },
        tool: 'release_contract',
        http: r.status,
      };
    },
  };
}

/** The last step: the contract data agent reads the executed contract and notes its key dates and reminders. */
function contractSnapshot(ctx: Ctx): Decision {
  const c0 = ctx.obs.contract!;
  if (ctx.context.snapshotDone === c0.id)
    return { type: 'DONE', summary: `Contract ${c0.number} is executed` };
  return {
    type: 'ACTION',
    key: `contract.snapshot:${c0.id}`,
    agent: 'CONTRACT_DATA',
    stage: 'CONTRACT',
    title: 'Read the executed contract: key dates, value and reminders',
    reason:
      'The contract is signed, so its key dates and reminders are read so they are in view for contract management.',
    rule: 'Contract data agent reads the record; reminders are scheduled by contract management from the key dates',
    repairs: [],
    escalate: (c, f) =>
      ownerGate(c, {
        key: `contract-snapshot:${c0.id}`,
        stage: 'CONTRACT',
        title: 'The contract data could not be read',
        reason: f.message,
        link: L.contract(c0.id),
        roles: ['CONTRACT_MGR'],
      }),
    async run(c) {
      const v = await c.tool.call('CONTRACT_DATA', 'get_contract', {
        params: { id: c0.id },
        stepKey: c.stepKey,
      });
      if (!v.ok) return { ok: false, ...failureOf(v) };
      const j = v.json as {
        number?: string;
        value?: number;
        startDate?: string;
        endDate?: string;
        noticeDays?: number;
        supplierName?: string;
      };
      const alerts = await c.tool.call('CONTRACT_DATA', 'contract_alerts', {
        params: { id: c0.id },
        stepKey: c.stepKey,
      });
      const ingest = await c.tool.call('CONTRACT_DATA', 'ingest_batches', { stepKey: c.stepKey });
      await c.setContext({ snapshotDone: c0.id });
      return {
        ok: true,
        tool: 'get_contract',
        result: {
          number: j.number,
          value: j.value,
          startDate: j.startDate,
          endDate: j.endDate,
          noticeDays: j.noticeDays,
          remindersScheduled:
            alerts.ok && Array.isArray(alerts.json) ? (alerts.json as unknown[]).length : null,
          contractIngestion: ingest.notAvailable
            ? 'not available in this build'
            : ingest.ok
              ? 'available'
              : `not readable (${ingest.status})`,
        },
      };
    },
  };
}
