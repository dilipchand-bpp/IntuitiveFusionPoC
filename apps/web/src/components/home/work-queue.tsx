'use client';
import { Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Input, ListRow, RowList, SectionHeader, Select } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';
import { actionRow, matchesQuery, type ActionItem, type QueueRow } from '@/lib/home';

export type QueueScope = 'mine' | 'team' | 'all';

/**
 * The work queue: what is waiting for you (GET /action-items) and, where the role may see them,
 * the team's and everyone's procurements.
 */
export function WorkQueue({
  scopes,
  procurements,
}: {
  /** Views this role may pick, in order; the first is the default. */
  scopes: Array<{ value: QueueScope; label: string }>;
  /** The procurement rows for the Team and All views, prepared on the server. */
  procurements: { team: QueueRow[]; all: QueueRow[] };
}) {
  const { data, error } = useData<{ count: number; items: ActionItem[] }>('/action-items');
  const [scope, setScope] = useState<QueueScope>(scopes[0]?.value ?? 'mine');
  const [q, setQ] = useState('');
  const selectId = useId();
  const searchId = useId();
  const rows = useMemo<QueueRow[] | null>(() => {
    if (scope === 'mine') return data ? data.items.map(actionRow) : null;
    return scope === 'team' ? procurements.team : procurements.all;
  }, [scope, data, procurements]);
  const shown = rows?.filter((r) => matchesQuery(r, q)) ?? null;
  return (
    <section aria-labelledby="queue-h" className="min-w-0" data-testid="work-queue">
      <SectionHeader
        id="queue-h"
        eyebrow="Attention & action"
        title="Your work queue"
        actions={
          <>
            <label htmlFor={selectId} className="sr-only">
              Show
            </label>
            <Select
              id={selectId}
              value={scope}
              onChange={(e) => setScope(e.target.value as QueueScope)}
              className="min-h-[36px] w-auto py-1 text-xs"
            >
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="relative mt-4">
        <label htmlFor={searchId} className="sr-only">
          Find a task or procurement
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <Input
          id={searchId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a task or procurement…"
          className="pl-9"
        />
      </div>
      <div className="mt-2" aria-live="polite">
        {error && scope === 'mine' ? (
          <p role="alert" className="py-6 text-sm text-error">
            {error}
          </p>
        ) : !shown ? (
          <p className="py-6 text-sm text-text-muted">Loading your queue…</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-sm text-text-muted" data-testid="queue-empty">
            {q
              ? 'Nothing matches that search.'
              : scope === 'mine'
                ? 'Nothing is waiting for you right now.'
                : 'There are no procurements to show.'}
          </p>
        ) : (
          <RowList className="border-b-0" aria-label="Your work queue" data-testid="queue-list">
            {shown.slice(0, 12).map((r) => (
              <ListRow
                key={r.key}
                href={r.href || undefined}
                accent={r.accent}
                caption={r.caption}
                title={r.title}
                subtitle={r.subtitle}
                tag={r.tag}
              />
            ))}
          </RowList>
        )}
      </div>
    </section>
  );
}
