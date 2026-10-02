import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { AiBadge, Badge } from '@if/ui';
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
import type { RequestView } from './types';

/** Read-only summary of a request: fields (with AI-drafted markers), complexity, governance gates, budget. */
export function DraftPanel({ view }: { view: RequestView }) {
  return (
    <div className="flex flex-col gap-5" data-testid="draft-panel">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-lg font-semibold">
          <span className="font-mono text-sm text-text-muted">{view.number}</span> {view.title}
        </h2>
        <Badge tone={STATUS_TONE[view.status] ?? 'neutral'}>{STATUS_LABEL[view.status] ?? view.status}</Badge>
      </header>

      <dl className="grid gap-2 text-sm">
        {view.fields.map((f) => (
          <div
            key={f.key}
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 border-b border-border pb-2"
            data-field={f.key}
          >
            <dt className="font-semibold text-text">{f.label}</dt>
            <dd className="min-w-0 break-words text-text">
              {f.value ? (
                displayValue(f.key, f.value)
              ) : f.missing ? (
                <span className="inline-flex items-center gap-1 font-medium text-warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  Needed
                </span>
              ) : (
                <span className="text-text-muted">Not set</span>
              )}
              {f.aiDrafted && f.value && (
                <span className="ml-2 align-middle">
                  <AiBadge kind="drafted" />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="gov-h" className="flex flex-col gap-2">
        <h3 id="gov-h" className="font-heading text-base font-semibold">
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
        <ul className="list-disc pl-5 text-sm text-text-muted">
          {view.complexityReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {view.gates.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm" aria-label="Required approvals and checks">
            {view.gates.map((g) => (
              <li key={g.key} className="flex items-start gap-2">
                {g.status === 'SATISFIED' ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                )}
                <span>
                  <strong>{g.label}</strong>{' '}
                  <span className="text-text-muted">
                    ({g.status === 'SATISFIED' ? 'done' : 'required'}) – {g.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No extra approvals are required for this request.</p>
        )}
      </section>
    </div>
  );
}
