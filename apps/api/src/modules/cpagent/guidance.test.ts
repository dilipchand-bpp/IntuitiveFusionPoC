/**
 * Every gate kind and every problem code the Procurement Copilot defines has guidance (where, numbered steps, who, what next).
 * The test reads the agent's own source, so a new kind, code or gate key without an entry fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GATE_GUIDANCE,
  GATE_KEY_PREFIXES,
  GATE_KINDS,
  PROBLEM_CODES,
  PROBLEM_GUIDANCE,
  problemCodeFor,
  whatToDo,
  whatToDoForProblem,
} from './guidance.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(here, f), 'utf8');
const SOURCES = ['stages.ts', 'engine.ts', 'agents.ts', 'tools.ts', 'observe.ts', 'simulate.ts']
  .map(src)
  .join('\n');
const STAGES = src('stages.ts');

const all = (re: RegExp, text: string) => [...text.matchAll(re)].map((m) => m[1]!);

describe('Copilot guidance catalogue', () => {
  it('every gate kind used in the agent has guidance with steps, who and what happens next', () => {
    const used = new Set([
      ...all(/kind: '([A-Z_]+)'/g, STAGES),
      // gates built through the g(kind, key, ...) helper in the evaluation stage
      ...all(/\bg\(\s*'([A-Z_]+)'\s*,/g, STAGES),
      'NEEDS_HUMAN',
    ]);
    // kinds of other things in the same file (a document kind, a draft kind) are not gate kinds
    for (const notGate of ['REQUEST', 'PLAN']) used.delete(notGate);
    expect(used.size).toBeGreaterThan(15);
    for (const k of used) {
      expect(GATE_KINDS as readonly string[], `gate kind ${k} is not in GATE_KINDS`).toContain(k);
    }
    for (const k of GATE_KINDS) {
      const g = GATE_GUIDANCE[k];
      expect(g, k).toBeDefined();
      expect(g.steps.length, k).toBeGreaterThanOrEqual(2);
      expect(g.who.length, k).toBeGreaterThan(3);
      expect(g.next.length, k).toBeGreaterThan(10);
      expect(g.where.length, k).toBeGreaterThan(3);
    }
  });

  it('every problem code the agent raises has guidance with why it stopped, steps, who and what next', () => {
    const used = new Set(all(/code: '([A-Z_]+)'/g, SOURCES));
    // codes that stages and the engine raise, plus the codes of the application routes the agent escalates by name
    for (const c of ['BUDGET_EXCEEDED', 'STATUTORY_WINDOW', 'NO_BIDS']) used.add(c);
    expect(used.size).toBeGreaterThan(5);
    for (const c of used) expect(PROBLEM_CODES as readonly string[], `problem code ${c}`).toContain(c);
    for (const c of PROBLEM_CODES) {
      const g = PROBLEM_GUIDANCE[c];
      expect(g.why.length, c).toBeGreaterThan(10);
      expect(g.steps.length, c).toBeGreaterThanOrEqual(2);
      expect(g.who.length, c).toBeGreaterThan(3);
      expect(g.next.length, c).toBeGreaterThan(10);
    }
  });

  it('every gate key the agent builds is in the key table, tied to a kind or a problem', () => {
    const keys = new Set<string>();
    for (const m of STAGES.matchAll(/key: `([a-z]+(?:[-_][a-z]+)*):\$\{/g)) keys.add(m[1]!);
    // the helper in the evaluation stage names its keys as plain strings
    for (const m of STAGES.matchAll(/\bg\(\s*'[A-Z_]+'\s*,\s*'([a-z-]+)'/g)) keys.add(m[1]!);
    // the problem gates built with ownerGate use plain keys
    for (const m of STAGES.matchAll(/key: '([a-z_]+)',\s*\n\s*stage:/g)) keys.add(m[1]!);
    expect(keys.size).toBeGreaterThan(25);
    const missing = [...keys].filter((k) => !(k in GATE_KEY_PREFIXES));
    expect(missing, `gate keys without guidance: ${missing.join(', ')}`).toEqual([]);
    for (const [k, v] of Object.entries(GATE_KEY_PREFIXES)) {
      expect(v.kind || v.problem, k).toBeTruthy();
      if (v.kind) expect(GATE_KINDS as readonly string[], k).toContain(v.kind);
      if (v.problem) expect(PROBLEM_CODES as readonly string[], k).toContain(v.problem);
    }
  });

  it('a gate becomes numbered steps with a link, who, what next and a one-line What to do', () => {
    const w = whatToDo({
      kind: 'PLAN_APPROVAL',
      gateKey: 'plan-approve:1',
      title: 'Approve the plan for R-1',
      reason: 'needs a delegate',
      link: '/app/plans/abc',
      roles: [],
      names: ['Dana Okafor'],
    });
    expect(w.steps[0]).toMatch(/Open the plan/);
    expect(w.steps.join(' ')).toMatch(/Approve and lock/);
    expect(w.who).toBe('Dana Okafor');
    expect(w.where.href).toBe('/app/plans/abc');
    expect(w.line).toMatch(/^What to do: .*Open \/app\/plans\/abc$/);
    expect(w.next).toMatch(/locked/);
  });

  it('a problem is mapped to its code from the stored code, the gate key or the message', () => {
    const gate = (key: string, reason: string) => ({
      kind: 'NEEDS_HUMAN',
      gateKey: key,
      title: 'x',
      reason,
      link: '/app/requests/1',
      roles: [] as string[],
    });
    expect(problemCodeFor(gate('fields:1', 'Mandatory fields missing'))).toBe('MISSING_FIELDS');
    expect(problemCodeFor(gate('budget:1', 'exceeds the budget'))).toBe('BUDGET_EXCEEDED');
    expect(problemCodeFor(gate('no-bids:1', 'closed with no bids'))).toBe('NO_BIDS');
    expect(problemCodeFor(gate('eval-open:1', 'Only 1 evaluator(s) are available'))).toBe('NO_PANEL');
    expect(
      problemCodeFor(gate('tender-publish:1', 'Closing is 3 day(s) after publication; requires at least 14')),
    ).toBe('STATUTORY_WINDOW');
    expect(problemCodeFor(gate('submit:1', 'something odd'), 'STEP_NO_EFFECT')).toBe('STEP_NO_EFFECT');
    expect(problemCodeFor(gate('zzz:1', 'something odd'))).toBe('GENERIC');
    const p = whatToDoForProblem({ code: 'NO_PANEL', title: 't', detail: 'd' }, '/admin/users');
    expect(p.steps.join(' ')).toMatch(/Evaluator role/);
    expect(p.why).toMatch(/evaluator/i);
    const unknown = whatToDoForProblem({ code: 'HTTP_422', title: 't', detail: 'd' }, '/app/requests/1');
    expect(unknown.problemCode).toBe('GENERIC');
  });

  it('a problem handed to a person shows the specific fix, not the generic one', () => {
    const w = whatToDo({
      kind: 'NEEDS_HUMAN',
      gateKey: 'fields:abc',
      title: 'Copilot needs from you: Estimated value',
      reason: 'Mandatory fields missing: Estimated value',
      link: '/app/requests/abc',
      roles: [],
      names: ['Priya Nair'],
    });
    expect(w.problemCode).toBe('MISSING_FIELDS');
    expect(w.steps.join(' ')).toMatch(/Submit request/);
    expect(w.why).toMatch(/may not assume/);
  });
});
