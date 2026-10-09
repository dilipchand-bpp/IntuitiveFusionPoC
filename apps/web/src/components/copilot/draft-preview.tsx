'use client';
import { Badge } from '@if/ui';
import { FIELD_NAMES, SOURCE_NAME, type DiffEntry, type DraftSource, type DraftView } from './draft-types';

const valueText = (k: string, v: string) =>
  k === 'estimatedValue' && /^\d+$/.test(v) ? `AUD ${Number(v).toLocaleString('en-AU')}` : v;

/** Where one place in the draft came from, in a small disclosure. */
function Why({ sources, path }: { sources: DraftSource[]; path: string }) {
  const hits = sources.filter((s) => s.path === path);
  if (!hits.length) return null;
  return (
    <details className="mt-1 text-xs text-text-muted">
      <summary className="cursor-pointer font-medium">Where this came from</summary>
      <ul className="mt-1 flex flex-col gap-1">
        {hits.map((s, i) => (
          <li key={i}>
            <span className="font-semibold">{SOURCE_NAME[s.kind]}.</span> {s.label}
            {s.quote ? <q className="ml-1 italic">{s.quote}</q> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The rendered draft: the facts it found, then each section, every item with its source. */
export function DraftPreview({ view }: { view: DraftView }) {
  const facts = Object.entries(view.fields).filter(([k]) => FIELD_NAMES[k] && k !== 'quantityUnit');
  return (
    <div data-testid="draft-preview" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-xl font-bold">{view.title}</h3>
        <Badge tone="info">SIMULATED · {view.engine}</Badge>
        <Badge tone="neutral">Revision {view.revision}</Badge>
      </div>
      {view.missing.length > 0 && (
        <p role="status" className="rounded-sm border border-warning bg-warning-bg p-2 text-sm text-warning">
          Still to be given: {view.missing.map((m) => FIELD_NAMES[m] ?? m).join(', ')}.
        </p>
      )}
      {view.suggested.length > 0 && (
        <p className="text-sm text-text-muted">
          Filled from in-house history, please confirm:{' '}
          {view.suggested.map((m) => FIELD_NAMES[m] ?? m).join(', ')}.
        </p>
      )}
      {view.warnings.map((w) => (
        <p key={w} className="text-sm text-text-muted">
          {w}
        </p>
      ))}
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2" aria-label="What was found">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {FIELD_NAMES[k]}
            </dt>
            <dd className="break-words text-sm">
              {valueText(k, v)}
              {k === 'quantity' && view.fields.quantityUnit ? ` ${view.fields.quantityUnit}` : ''}
              <Why sources={view.sources} path={`fields.${k}`} />
            </dd>
          </div>
        ))}
      </dl>
      {view.doc.sections.map((s) => (
        <section key={s.key} aria-label={s.title} data-section={s.key}>
          <h4 className="font-heading text-base font-semibold">{s.title}</h4>
          {s.type === 'CRITERIA' && (
            <p className="text-xs text-text-muted">
              Total weight: {s.items.reduce((n, i) => n + (i.weight ?? 0), 0)}%
            </p>
          )}
          <ol
            className={
              s.type === 'TEXT' ? 'mt-1 flex flex-col gap-2' : 'mt-1 flex list-decimal flex-col gap-2 pl-5'
            }
          >
            {s.items.map((i) => (
              <li key={i.id} className={s.type === 'TEXT' ? 'list-none' : ''} data-item={i.id}>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {i.title ? <strong>{i.title}</strong> : null}
                  {s.type === 'CRITERIA' ? <strong> ({i.weight ?? 0}%)</strong> : null}
                  {i.title ? ': ' : ''}
                  {i.text}
                  {i.mandatory ? <span className="ml-1 text-xs text-text-muted">(mandatory)</span> : null}
                </p>
                <Why sources={view.sources} path={`sections.${s.key}.${i.id}`} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Field-level before and after. */
export function DiffList({ diff }: { diff: DiffEntry[] }) {
  if (!diff.length) return <p className="text-sm text-text-muted">No field changed.</p>;
  return (
    <ul data-testid="draft-diff" className="flex flex-col gap-2" aria-label="What changed">
      {diff.map((d) => (
        <li key={d.path} className="rounded-sm border border-border p-2 text-sm" data-change={d.change}>
          <p className="font-semibold">
            {d.label} <span className="text-xs font-medium text-text-muted">({d.change.toLowerCase()})</span>
          </p>
          {d.before !== undefined && (
            <p className="break-words">
              <span className="font-medium text-text-muted">Before: </span>
              <del>{d.before}</del>
            </p>
          )}
          {d.after !== undefined && (
            <p className="break-words">
              <span className="font-medium text-text-muted">After: </span>
              <ins className="no-underline">{d.after}</ins>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
