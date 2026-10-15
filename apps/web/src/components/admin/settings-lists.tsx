'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Field, Input, Select } from '@if/ui';
import {
  BUILT_IN_REGISTERS,
  nextKey,
  parseWords,
  type CapacityOverride,
  type Func,
  type NotifyEvent,
  type Recipient,
  type Register,
  type ReviewRule,
  type RoutingRule,
  type WorkflowId,
} from './settings-list-rules';

/** The list editors behind the "Add ..." buttons of Settings. Each is controlled: rows in, rows out. */

export const EVENT_NAMES: Record<NotifyEvent, string> = {
  BUDGET_BREACH: 'A request breaks the budget',
  DELEGATE_ACTION: 'An approver is asked to act',
  APPROVAL_TIMEOUT: 'An approval waits too long',
};
export const ROLE_NAMES: Array<[string, string]> = [
  ['REQUESTER', 'Requester'],
  ['PROCUREMENT', 'Procurement'],
  ['DELEGATE', 'Delegate'],
  ['EVALUATOR', 'Evaluator'],
  ['CHAIR', 'Chair'],
  ['LEGAL', 'Legal'],
  ['CONTRACT_MGR', 'Contract manager'],
  ['PROBITY', 'Probity'],
  ['FINANCE', 'Finance'],
  ['EXEC', 'Executive'],
  ['ADMIN', 'Administrator'],
];
export const WORKFLOW_NAMES: Record<WorkflowId, string> = {
  'wf-simple': 'Simple purchase',
  'wf-intermediate': 'Intermediate sourcing',
  'wf-complex': 'Complex tender',
  'wf-board': 'High-value or high-risk governance',
};
const FUNCTION_NAMES: Func[] = ['IT', 'LEGAL', 'CYBER', 'FINANCE', 'RISK'];
const ROW = 'grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]';

/** New rows, so the panel's Add buttons and the tests share one definition. */
export const newReviewRule = (taken: readonly string[]): ReviewRule => ({
  id: nextKey('rule', taken),
  label: '',
  function: 'LEGAL',
  keywords: [],
});
export const newRoutingRule = (taken: readonly string[]): RoutingRule => ({
  id: nextKey('route', taken),
  label: '',
  words: [],
  workflow: 'wf-complex',
});

/** Keeps focus where the person is working: the first field of a row that was just added. */
function Rows({
  label,
  count,
  empty,
  children,
}: {
  label: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(count);
  useEffect(() => {
    if (count > previous.current) {
      const rows = root.current?.querySelectorAll('[data-row]');
      rows?.[rows.length - 1]?.querySelector<HTMLElement>('input:not([disabled]), select')?.focus();
    }
    previous.current = count;
  }, [count]);
  return (
    <div ref={root} role="group" aria-label={label} className="flex flex-col gap-3">
      {count === 0 && <p className="text-sm text-text-muted">{empty}</p>}
      {children}
    </div>
  );
}

/** A comma-separated list of words that can be typed freely: the raw text is kept while typing. */
export function WordsInput({
  label,
  words,
  onChange,
  hint,
}: {
  label: string;
  words: string[];
  onChange: (w: string[]) => void;
  hint?: string;
}) {
  const [text, setText] = useState(words.join(', '));
  useEffect(() => {
    setText((t) => (JSON.stringify(parseWords(t)) === JSON.stringify(words) ? t : words.join(', ')));
  }, [words]);
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseWords(e.target.value));
        }}
      />
    </Field>
  );
}

function OptionalNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Field label={label} hint="Leave empty for any value">
      <Input
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

function withoutValue<T extends { minValue?: number }>(row: T, minValue: number | undefined): T {
  const { minValue: _drop, ...rest } = row;
  void _drop;
  return (minValue === undefined ? rest : { ...rest, minValue }) as T;
}

export function ReviewRulesEditor({
  rules,
  onChange,
}: {
  rules: ReviewRule[];
  onChange: (r: ReviewRule[]) => void;
}) {
  const set = (i: number, row: ReviewRule) => onChange(rules.map((x, j) => (j === i ? row : x)));
  return (
    <Rows
      label="Review rules"
      count={rules.length}
      empty="No review rules: no request will ask for a secondary review. Use Add a review rule."
    >
      <h3 className="text-sm font-semibold">Reviews a request triggers</h3>
      {rules.map((r, i) => (
        <div key={r.id} className={ROW} data-row data-testid="engagement-rule">
          <Field label={`Rule ${i + 1}`}>
            <Input value={r.label} onChange={(e) => set(i, { ...r, label: e.target.value })} />
          </Field>
          <Field label={`Function ${i + 1}`}>
            <Select value={r.function} onChange={(e) => set(i, { ...r, function: e.target.value as Func })}>
              {FUNCTION_NAMES.map((f) => (
                <option key={f} value={f}>
                  {f.charAt(0) + f.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <WordsInput
            label={`Words ${i + 1} (comma separated)`}
            words={r.keywords}
            onChange={(keywords) => set(i, { ...r, keywords })}
          />
          <OptionalNumber
            label={`From value ${i + 1} (AUD)`}
            value={r.minValue}
            onChange={(v) => set(i, withoutValue(r, v))}
          />
          <Button
            variant="ghost"
            aria-label={`Remove rule ${i + 1}`}
            onClick={() => onChange(rules.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </Rows>
  );
}

export function RoutingRulesEditor({
  rules,
  onChange,
}: {
  rules: RoutingRule[];
  onChange: (r: RoutingRule[]) => void;
}) {
  const set = (i: number, row: RoutingRule) => onChange(rules.map((x, j) => (j === i ? row : x)));
  return (
    <Rows
      label="Routing rules"
      count={rules.length}
      empty="No routing rules: every request is routed by its value alone. Use Add a routing rule."
    >
      <h3 className="text-sm font-semibold">
        Routing rules, checked before the limits (the first match wins)
      </h3>
      {rules.map((r, i) => (
        <div key={r.id} className={ROW} data-row data-testid="routing-rule">
          <Field label={`Routing rule ${i + 1}`}>
            <Input value={r.label} onChange={(e) => set(i, { ...r, label: e.target.value })} />
          </Field>
          <WordsInput
            label={`Words in the title or category ${i + 1} (comma separated)`}
            words={r.words}
            onChange={(words) => set(i, { ...r, words })}
          />
          <OptionalNumber
            label={`From value ${i + 1} (AUD)`}
            value={r.minValue}
            onChange={(v) => set(i, withoutValue(r, v))}
          />
          <Field label={`Follows ${i + 1}`}>
            <Select
              value={r.workflow}
              onChange={(e) => set(i, { ...r, workflow: e.target.value as WorkflowId })}
            >
              {(Object.keys(WORKFLOW_NAMES) as WorkflowId[]).map((w) => (
                <option key={w} value={w}>
                  {WORKFLOW_NAMES[w]}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="ghost"
            aria-label={`Remove routing rule ${i + 1}`}
            onClick={() => onChange(rules.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </Rows>
  );
}

export function RecipientsEditor({
  rows,
  onChange,
}: {
  rows: Recipient[];
  onChange: (r: Recipient[]) => void;
}) {
  const set = (i: number, row: Recipient) => onChange(rows.map((x, j) => (j === i ? row : x)));
  return (
    <Rows
      label="Extra recipients"
      count={rows.length}
      empty="No extra recipients: only the people an event concerns are told. Use Add a recipient."
    >
      <h3 className="text-sm font-semibold">Also tell these roles</h3>
      {rows.map((r, i) => (
        <div key={i} className={ROW} data-row data-testid="extra-recipient">
          <Field label={`When ${i + 1}`}>
            <Select value={r.event} onChange={(e) => set(i, { ...r, event: e.target.value as NotifyEvent })}>
              {(Object.keys(EVENT_NAMES) as NotifyEvent[]).map((ev) => (
                <option key={ev} value={ev}>
                  {EVENT_NAMES[ev]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Also tell ${i + 1}`}>
            <Select value={r.role} onChange={(e) => set(i, { ...r, role: e.target.value })}>
              {ROLE_NAMES.map(([role, name]) => (
                <option key={role} value={role}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="ghost"
            aria-label={`Remove recipient ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </Rows>
  );
}

export function RegistersEditor({ rows, onChange }: { rows: Register[]; onChange: (r: Register[]) => void }) {
  // the registers that came with the product keep their fixed names; one the administrator adds is fully editable
  const builtIn = useRef(
    new Set(rows.map((r) => r.register).filter((n) => (BUILT_IN_REGISTERS as readonly string[]).includes(n))),
  );
  const set = (i: number, patch: Partial<Register>) =>
    onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Rows
      label="Registers"
      count={rows.length}
      empty="No registers: no tender is sent to a public register. Use Add a register."
    >
      {rows.map((r, i) => {
        const fixed = builtIn.current.has(r.register);
        const name = r.register.trim() || `register ${i + 1}`;
        return (
          <div key={i} className={ROW} data-row data-testid="register-row">
            <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={r.enabled}
                onChange={(e) => set(i, { enabled: e.target.checked })}
                aria-label={`Send to ${name}`}
              />
              {fixed ? r.register : 'Send to this register'}
            </label>
            {fixed ? (
              <span className="text-sm text-text-muted">{r.jurisdiction}</span>
            ) : (
              <>
                <Field label={`Register name ${i + 1}`} hint="2 to 40 characters">
                  <Input
                    maxLength={40}
                    value={r.register}
                    onChange={(e) => set(i, { register: e.target.value })}
                  />
                </Field>
                <Field label={`Jurisdiction ${i + 1}`}>
                  <Input
                    maxLength={60}
                    value={r.jurisdiction}
                    onChange={(e) => set(i, { jurisdiction: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label={`${name} from (AUD)`}>
              <Input
                type="number"
                min={0}
                value={r.minValueAud}
                onChange={(e) => set(i, { minValueAud: Number(e.target.value) })}
              />
            </Field>
            <Button
              variant="ghost"
              aria-label={`Remove register ${name}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </Rows>
  );
}

export function SpendAlertsEditor({
  points,
  onChange,
}: {
  points: number[];
  onChange: (p: number[]) => void;
}) {
  return (
    <Rows
      label="Extra spend alerts"
      count={points.length}
      empty="No extra spend alerts. Use Add a spend alert to be told at another point."
    >
      <h3 className="text-sm font-semibold">Extra spend alert points</h3>
      {points.map((p, i) => (
        <div key={i} className={ROW} data-row data-testid="extra-spend-alert">
          <Field
            label={`Extra alert point ${i + 1} (% of contract value)`}
            hint="1 to 99, not 80 or 90, which are fixed"
          >
            <Input
              type="number"
              min={1}
              max={99}
              value={Number.isNaN(p) ? '' : p}
              onChange={(e) => onChange(points.map((x, j) => (j === i ? Number(e.target.value) : x)))}
            />
          </Field>
          <Button
            variant="ghost"
            aria-label={`Remove extra alert point ${i + 1}`}
            onClick={() => onChange(points.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </Rows>
  );
}

export interface ManagerOption {
  id: string;
  name: string;
}

export function CapacityEditor({
  rows,
  managers,
  shared,
  onChange,
}: {
  rows: CapacityOverride[];
  managers: ManagerOption[];
  shared: number;
  onChange: (r: CapacityOverride[]) => void;
}) {
  const set = (i: number, patch: Partial<CapacityOverride>) =>
    onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Rows
      label="Capacity overrides"
      count={rows.length}
      empty={`No overrides: every manager is measured against ${shared}. Use Add a capacity override.`}
    >
      <h3 className="text-sm font-semibold">Managers with their own capacity</h3>
      {rows.map((o, i) => (
        <div key={i} className={ROW} data-row data-testid="capacity-override">
          <Field label={`Manager ${i + 1}`}>
            <Select value={o.userId} onChange={(e) => set(i, { userId: e.target.value })}>
              <option value="">Choose a manager</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Capacity ${i + 1}`} hint="Procurements this manager can carry">
            <Input
              type="number"
              min={1}
              max={200}
              value={Number.isNaN(o.capacity) ? '' : o.capacity}
              onChange={(e) => set(i, { capacity: Number(e.target.value) })}
            />
          </Field>
          <Button
            variant="ghost"
            aria-label={`Remove capacity override ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </Rows>
  );
}

export function ClausesEditor({ ids, onChange }: { ids: string[]; onChange: (c: string[]) => void }) {
  return (
    <Rows
      label="Non-negotiable clauses"
      count={ids.length}
      empty="No protected clauses. Use Add a protected clause."
    >
      <h3 className="text-sm font-semibold">Non-negotiable clauses</h3>
      {ids.map((c, i) => (
        <div key={i} className={ROW} data-row data-testid="protected-clause">
          <Field label={`Clause ${i + 1} id`} hint="For example LIABILITY or IP">
            <Input
              maxLength={60}
              value={c}
              onChange={(e) => onChange(ids.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
            />
          </Field>
          <Button
            variant="ghost"
            aria-label={`Remove clause ${i + 1}`}
            onClick={() => onChange(ids.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
    </Rows>
  );
}
