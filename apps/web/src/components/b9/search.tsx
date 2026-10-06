'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input } from '@if/ui';
import { send, useRun } from '@/components/contract/b5-shared';

interface Group {
  kind: string;
  label: string;
  total: number;
  items: Array<{ id: string; title: string; subtitle: string; link: string | null }>;
}
interface External {
  enabled: boolean;
  asked: boolean;
  provider: string;
  sent: string | null;
  withheld: string[];
  hits: Array<{ title: string; snippet: string; source: string }>;
  simulated: boolean;
  note: string | null;
}
interface Result {
  model: string;
  query: string;
  groups: Group[];
  total: number;
  external: External;
}

export function SearchView({ csrf, initialQuery }: { csrf: string; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [outside, setOutside] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [asked, setAsked] = useState<{ query: string; outside: boolean } | null>(null);
  const r = useRun();
  const ranInitial = useRef(false);

  async function go(q: string, ext: boolean) {
    const text = q.trim();
    if (text.length < 3) return;
    await r.run('search', async () => {
      const out = await send<Result>(csrf, 'POST', '/search', { query: text, includeExternal: ext });
      setResult(out);
      setAsked({ query: text, outside: ext });
    });
  }

  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    if (initialQuery.trim().length >= 3) void go(initialQuery, false);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <form
        role="search"
        aria-label="Search the platform"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void go(query, outside);
        }}
      >
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <Field
            label="Search"
            hint="Procurements, contracts, suppliers, lessons learned and catalogue items you may see."
          >
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} />
          </Field>
          <Button
            type="submit"
            loading={r.busy === 'search'}
            disabled={query.trim().length < 3 || r.busy !== null}
          >
            Search
          </Button>
        </div>
        <Checkbox
          checked={outside}
          onChange={(e) => setOutside(e.target.checked)}
          label="Also ask an outside source (identifiers are withheld)"
        />
        <p className="max-w-prose text-xs text-text-muted">
          If you tick this, only the words of your question are sent. Reference numbers, ABNs, email
          addresses, dollar amounts and supplier names are taken out first, and every outside question is
          logged.
        </p>
        {r.messages}
      </form>

      {result && (
        <div className="flex flex-col gap-6" data-testid="search-results">
          <p role="status" className="text-sm text-text-muted">
            {result.total === 0
              ? `Nothing found in your own records for “${result.query}”.`
              : `${result.total} result${result.total === 1 ? '' : 's'} in your own records for “${result.query}”.`}{' '}
            <Badge tone="info">Simulated matching: {result.model}</Badge>
          </p>
          {result.groups.length === 0 && (
            <EmptyState
              title="No matches"
              body="Try fewer or different words. All your words must appear in a record."
            />
          )}
          {result.groups.map((g) => (
            <section key={g.kind} aria-labelledby={`g-${g.kind}`}>
              <h2 id={`g-${g.kind}`} className="text-lg font-bold">
                {g.label}{' '}
                <span className="text-sm font-normal text-text-muted">
                  ({g.total}
                  {g.total > g.items.length ? `, first ${g.items.length} shown` : ''})
                </span>
              </h2>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
                {g.items.map((i) => (
                  <li key={i.id} className="px-4 py-3">
                    {i.link ? (
                      <Link href={i.link} className="font-semibold">
                        {i.title}
                      </Link>
                    ) : (
                      <span className="font-semibold">{i.title}</span>
                    )}
                    <p className="text-sm text-text-muted">{i.subtitle}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {(asked?.outside || result.external.note) && <ExternalPanel ext={result.external} />}
        </div>
      )}
    </div>
  );
}

function ExternalPanel({ ext }: { ext: External }) {
  return (
    <section aria-labelledby="ext-h" data-testid="external-panel">
      <Card>
        <h2 id="ext-h" className="flex flex-wrap items-center gap-2 text-lg font-bold">
          Outside source
          {ext.simulated && <Badge tone="warning">SIMULATED</Badge>}
        </h2>
        {ext.note && (
          <p role="status" className="mt-2 text-sm">
            {ext.note}
          </p>
        )}
        {ext.asked && (
          <div className="mt-3 flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              Source: {ext.provider}. These results are made-up examples, not real market data.
            </p>
            <div>
              <h3 className="text-sm font-bold">Exactly what was sent</h3>
              <p className="mt-1 rounded-md bg-surface-alt p-3 font-mono text-sm break-words">{ext.sent}</p>
            </div>
            <div>
              <h3 className="text-sm font-bold">What was withheld</h3>
              {ext.withheld.length === 0 ? (
                <p className="mt-1 text-sm text-text-muted">Nothing needed to be withheld.</p>
              ) : (
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {ext.withheld.map((w, k) => (
                    <li key={`${w}-${k}`}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold">Results</h3>
              {ext.hits.length === 0 ? (
                <p className="mt-1 text-sm text-text-muted">The outside source had nothing on this.</p>
              ) : (
                <ul className="mt-1 divide-y divide-border">
                  {ext.hits.map((h) => (
                    <li key={h.source} className="py-3">
                      <p className="font-semibold">
                        {h.title} <Badge tone="warning">SIMULATED</Badge>
                      </p>
                      <p className="mt-1 text-sm">{h.snippet}</p>
                      <p className="mt-1 text-xs text-text-muted">{h.source}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
