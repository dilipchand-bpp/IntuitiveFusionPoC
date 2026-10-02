import {
  Bot,
  CheckCircle2,
  Clock,
  Info,
  Inbox,
  Sparkles,
  Stamp as StampIcon,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from 'react';
import { cn } from './cn';

// ---------------- Badge (status is never conveyed by colour alone: always icon + text) ----------------
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';
const badgeTone: Record<BadgeTone, { cls: string; Icon: typeof Info }> = {
  neutral: { cls: 'bg-surface-alt text-text border-border', Icon: Clock },
  success: { cls: 'bg-success-bg text-success border-success', Icon: CheckCircle2 },
  warning: { cls: 'bg-warning-bg text-warning border-warning', Icon: TriangleAlert },
  error: { cls: 'bg-error-bg text-error border-error', Icon: XCircle },
  info: { cls: 'bg-info-bg text-info border-info', Icon: Info },
};
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = badgeTone[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        cls,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

// ---------------- Card ----------------
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface p-6 text-text shadow-sm', className)}
      {...p}
    />
  );
}

// ---------------- Table (semantic; caption required for a name) ----------------
export function Table({
  caption,
  children,
  className,
  ...p
}: TableHTMLAttributes<HTMLTableElement> & { caption: string }) {
  return (
    <div
      className="w-full overflow-x-auto rounded-lg border border-border bg-surface shadow-sm"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table
        className={cn(
          'w-full border-collapse text-left text-sm [&_tbody_tr:hover]:bg-surface-alt/60',
          className,
        )}
        {...p}
      >
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const Th = ({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn(
      'bg-surface-alt px-4 py-3 text-xs font-bold uppercase tracking-wide text-text-muted',
      className,
    )}
    {...p}
  />
);
export const Td = ({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('border-t border-border px-4 py-3.5 text-text', className)} {...p} />
);

// ---------------- Stepper ----------------
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? 'complete' : i === current ? 'current' : 'upcoming';
        return (
          <li
            key={s}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex items-center gap-2 text-sm"
          >
            <span
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-full border text-xs font-bold',
                state === 'complete' && 'border-success bg-success-bg text-success',
                state === 'current' && 'border-accent bg-accent text-accent-fg',
                state === 'upcoming' && 'border-border-strong bg-surface text-text-muted',
              )}
            >
              {state === 'complete' ? <CheckCircle2 className="size-4" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn(state === 'current' ? 'font-semibold text-text' : 'text-text-muted')}>
              {s}
              <span className="sr-only"> ({state})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------- Stamp (approval / signature evidence) ----------------
export function Stamp({
  label,
  who,
  role,
  when,
}: {
  label: string;
  who: string;
  role: string;
  when: string;
}) {
  return (
    <figure
      className="inline-flex w-fit items-center gap-3 rounded-sm border-2 border-success px-3 py-2 text-success"
      aria-label={`${label} by ${who}`}
    >
      <StampIcon className="size-6" aria-hidden="true" />
      <figcaption className="text-sm leading-tight">
        <strong className="block uppercase tracking-wide">{label}</strong>
        {who} · {role}
        <br />
        <time>{when}</time>
      </figcaption>
    </figure>
  );
}

// ---------------- AI badge (R3: mock AI must never be mistaken for real) ----------------
export function AiBadge({ kind = 'simulated' }: { kind?: 'simulated' | 'drafted' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
      {kind === 'simulated' ? (
        <Bot className="size-3.5" aria-hidden="true" />
      ) : (
        <Sparkles className="size-3.5" aria-hidden="true" />
      )}
      {kind === 'simulated' ? (
        'Simulated AI'
      ) : (
        <>
          AI-drafted<span className="sr-only"> – review required</span>
        </>
      )}
    </span>
  );
}

// ---------------- ComingSoon (stubs are never blank) ----------------
export function ComingSoon({
  feature,
  requirementIds = [],
  note,
}: {
  feature: string;
  requirementIds?: string[];
  note?: string;
}) {
  return (
    <section
      aria-labelledby="cs-title"
      className="rounded-lg border border-dashed border-border-strong bg-surface p-10 text-center"
    >
      <span className="icon-tile mx-auto">
        <Clock className="size-6" aria-hidden="true" />
      </span>
      <h2 id="cs-title" className="mt-3 font-heading text-xl font-semibold text-text">
        {feature} – coming soon
      </h2>
      <p className="mx-auto mt-2 max-w-prose text-text-muted">
        {note ?? 'This capability is planned and designed but not part of the proof of concept build yet.'}
      </p>
      {requirementIds.length > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          Requirements: <span className="font-mono">{requirementIds.join(', ')}</span>
        </p>
      )}
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-10 text-center">
      <span className="icon-tile">
        <Inbox className="size-6" aria-hidden="true" />
      </span>
      <h3 className="font-heading text-lg font-semibold text-text">{title}</h3>
      {body && <p className="max-w-prose text-text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn('animate-pulse rounded-sm bg-surface-alt', className)}
    />
  );
}
