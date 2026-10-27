import { aud } from '@/lib/labels';
import { Panel, SectionHeader } from '@if/ui';
import type { SpendReport } from './types';

const compact = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Spend by category as bars, with the same numbers as a table so the chart is never the only way to read them. */
export function SpendChart({ report }: { report: SpendReport }) {
  const max = Math.max(1, ...report.byCategory.map((c) => c.pipeline + c.committed));
  return (
    <Panel as="div" className="min-w-0" data-testid="spend-chart">
      <SectionHeader id="spend-h" title="Spend by category" />
      <p className="mt-1 text-sm text-text-muted">
        Pipeline is the estimated value of active requests; committed is the value of executed contracts.
      </p>
      {report.byCategory.length === 0 ? (
        <p className="mt-3 text-text-muted">No spend to show.</p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-3" aria-hidden="true">
            {report.byCategory.map((c) => (
              <li key={c.category}>
                <div className="flex min-w-0 justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{c.category}</span>
                  <strong className="shrink-0">{compact.format(c.pipeline + c.committed)}</strong>
                </div>
                <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-surface-alt">
                  <div className="h-2.5 bg-accent" style={{ width: `${(c.committed / max) * 100}%` }} />
                  <div className="h-2.5 bg-border-strong" style={{ width: `${(c.pipeline / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex gap-4 text-xs text-text-muted" aria-hidden="true">
            <span>
              <span className="mr-1 inline-block size-2 rounded-full bg-accent" />
              Committed
            </span>
            <span>
              <span className="mr-1 inline-block size-2 rounded-full bg-border-strong" />
              Pipeline
            </span>
          </p>
          <div className="sr-only">
            <table>
              <caption>Spend by category</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Pipeline</th>
                  <th scope="col">Committed</th>
                </tr>
              </thead>
              <tbody>
                {report.byCategory.map((c) => (
                  <tr key={c.category}>
                    <th scope="row">{c.category}</th>
                    <td>{aud.format(c.pipeline)}</td>
                    <td>{aud.format(c.committed)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Total</th>
                  <td>{aud.format(report.totalPipeline)}</td>
                  <td>{aud.format(report.totalCommitted)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
