import type { TermBar } from './types';

const DAY = 86_400_000;
const t = (s: string) => Date.parse(`${s}T00:00:00Z`);

/**
 * A timeline of terms: the initial term and each optional extension laid on one date axis. The text of every bar is
 * also on the page (label and dates), so the chart never carries information that cannot be read as words.
 */
export function Gantt({
  rows,
  today,
}: {
  rows: Array<{ id: string; label: string; bars: TermBar[] }>;
  today?: string;
}) {
  const all = rows.flatMap((r) => r.bars);
  if (all.length === 0) return null;
  const min = Math.min(...all.map((b) => t(b.start)));
  const max = Math.max(...all.map((b) => t(b.end)));
  const span = Math.max(max - min, DAY);
  const pct = (ms: number) => `${(((ms - min) / span) * 100).toFixed(2)}%`;
  const width = (a: string, b: string) => `${Math.max(((t(b) - t(a)) / span) * 100, 1).toFixed(2)}%`;
  const todayMs = today ? t(today) : null;
  return (
    <div className="mt-2 flex flex-col gap-3" data-testid="gantt">
      <p className="flex justify-between text-xs text-text-muted">
        <span>{new Date(min).toISOString().slice(0, 10)}</span>
        <span>{new Date(max).toISOString().slice(0, 10)}</span>
      </p>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-1">
          {rows.length > 1 && <p className="text-sm font-semibold">{r.label}</p>}
          <div className="relative h-7 rounded-md bg-surface-alt" aria-hidden="true">
            {r.bars.map((b) => (
              <span
                key={b.label}
                className={
                  b.optional
                    ? 'absolute top-1 h-5 rounded border border-dashed border-border-strong bg-surface'
                    : 'absolute top-1 h-5 rounded bg-brand-gradient'
                }
                style={{ left: pct(t(b.start)), width: width(b.start, b.end) }}
              />
            ))}
            {todayMs !== null && todayMs >= min && todayMs <= max && (
              <span
                className="absolute inset-y-0 w-0.5 bg-error"
                style={{ left: pct(todayMs) }}
                title="Today"
              />
            )}
          </div>
          <ul className="flex flex-wrap gap-x-4 text-xs text-text-muted" aria-label={`${r.label} terms`}>
            {r.bars.map((b) => (
              <li key={b.label}>
                {b.label}: {b.start} to {b.end}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
