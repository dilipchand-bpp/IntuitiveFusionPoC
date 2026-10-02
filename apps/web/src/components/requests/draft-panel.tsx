import { AlertTriangle, CheckCircle2, CircleDashed, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { AiBadge, Badge, cn } from '@if/ui';
import {
  BUDGET_LABEL,
  BUDGET_TONE,
  COMPLEXITY_LABEL,
  COMPLEXITY_TONE,
  MODE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  displayValue,
} from '@/lib/labels';
import type { FieldView, RequestView } from './types';

const FACTS = ['title', 'category', 'estimatedValue', 'termMonths', 'businessUnit', 'contractOwner'];
const NARRATIVE = ['background', 'deliverables', 'risk'];
const CONTEXT = ['dataSensitivity', 'supplyLocation'];
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const LEVEL_BAR: Record<string, string> = {
  LOW: 'bg-success',
  MEDIUM: 'bg-info',
  HIGH: 'bg-warning',
  CRITICAL: 'bg-error',
};

/** The value of a field, or why there is none: "Needed" (must be supplied) or "Not set" (optional). */
function Value({ f }: { f: FieldView }): ReactNode {
  if (f.value) return displayValue(f.key, f.value);
  if (f.missing)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-sm font-semibold text-warning">
        <AlertTriangle className="size-4" aria-hidden="true" />
        Needed
      </span>
    );
  return <span className="font-normal text-text-muted">Not set</span>;
}

function Tile({ f, big = false }: { f: FieldView; big?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-alt/60 p-3" data-field={f.key}>
      <dt className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-text-muted">
        <span>{f.label}</span>
        {f.aiDrafted && f.value && <AiBadge kind="drafted" />}
      </dt>
      <dd
        className={cn(
          'mt-1 min-w-0 break-words font-semibold text-text',
          big ? 'font-heading text-2xl' : 'text-base',
        )}
      >
        <Value f={f} />
      </dd>
    </div>
  );
}

/** Read-only summary of a request: key facts, narrative, context, complexity and the checks still ahead. */
export function DraftPanel({ view, hideHeader = false }: { view: RequestView; hideHeader?: boolean }) {
  const by = new Map(view.fields.map((f) => [f.key, f]));
  const pick = (keys: string[]) => keys.map((k) => by.get(k)).filter((f): f is FieldView => Boolean(f));
  const known = new Set([...FACTS, ...NARRATIVE, ...CONTEXT]);
  const facts = [...pick(FACTS), ...view.fields.filter((f) => !known.has(f.key))];
  const level = view.complexity ? LEVELS.indexOf(view.complexity as (typeof LEVELS)[number]) : -1;

  return (
    <div className="@container flex flex-col gap-6" data-testid="draft-panel">
      {!hideHeader && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-heading text-xl font-bold">
            <span className="mr-2 rounded-md bg-surface-alt px-2 py-0.5 font-mono text-sm font-semibold text-text-muted">
              {view.number}
            </span>
            {view.title}
          </h2>
          <Badge tone={STATUS_TONE[view.status] ?? 'neutral'}>
            {STATUS_LABEL[view.status] ?? view.status}
          </Badge>
        </header>
      )}

      <section aria-label="Key facts">
        <dl className="grid gap-3 @md:grid-cols-2">
          {facts.map((f) => (
            <Tile key={f.key} f={f} big={f.key === 'estimatedValue'} />
          ))}
        </dl>
      </section>

      {pick(NARRATIVE).length > 0 && (
        <section aria-label="Description" className="flex flex-col gap-3">
          <dl className="flex flex-col gap-3">
            {pick(NARRATIVE).map((f) => (
              <div key={f.key} className="min-w-0 rounded-lg border border-border p-4" data-field={f.key}>
                <dt className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-heading text-base font-bold">{f.label}</span>
                  {f.aiDrafted && f.value && <AiBadge kind="drafted" />}
                </dt>
                <dd className="mt-2 max-w-prose break-words leading-relaxed text-text">
                  {f.value ? displayValue(f.key, f.value) : <Value f={f} />}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {pick(CONTEXT).length > 0 && (
        <section aria-label="Context">
          <dl className="grid gap-3 @md:grid-cols-2">
            {pick(CONTEXT).map((f) => (
              <Tile key={f.key} f={f} />
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="gov-h" className="flex flex-col gap-4 rounded-lg bg-surface-alt/60 p-4">
        <h3 id="gov-h" className="flex items-center gap-2 font-heading text-lg font-bold">
          <ShieldCheck className="size-5 text-accent" aria-hidden="true" />
          Complexity and governance
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {view.complexity && (
            <Badge tone={COMPLEXITY_TONE[view.complexity] ?? 'neutral'}>
              Complexity: {COMPLEXITY_LABEL[view.complexity]}
            </Badge>
          )}
          <Badge tone="neutral">{MODE_LABEL[view.intakeMode] ?? view.intakeMode}</Badge>
          <Badge tone={BUDGET_TONE[view.budgetCheck] ?? 'neutral'}>
            {BUDGET_LABEL[view.budgetCheck] ?? view.budgetCheck}
          </Badge>
        </div>
        {level >= 0 && (
          <div aria-hidden="true" className="flex gap-1.5" data-testid="complexity-meter">
            {LEVELS.map((l, i) => (
              <span
                key={l}
                className={cn(
                  'h-2 flex-1 rounded-full',
                  i <= level ? LEVEL_BAR[view.complexity!] : 'bg-border',
                )}
              />
            ))}
          </div>
        )}
        {view.complexityReasons.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {view.complexityReasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-text-muted" />
                {r}
              </li>
            ))}
          </ul>
        )}
        {view.gates.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Required approvals and checks">
            {view.gates.map((g) => {
              const done = g.status === 'SATISFIED';
              return (
                <li
                  key={g.key}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  {done ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 text-sm">
                    <strong className="block text-base">{g.label}</strong>
                    <span className="text-text-muted">{g.reason}</span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold',
                      done ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning',
                    )}
                  >
                    {done ? 'Done' : 'Required'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No extra approvals are required for this request.</p>
        )}
      </section>
    </div>
  );
}
