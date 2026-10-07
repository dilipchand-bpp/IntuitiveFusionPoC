'use client';
import { useState } from 'react';
import { Badge, Button, Card, Table, Td, Th, type BadgeTone } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

type State = 'CURRENT' | 'STALE' | 'FAILED' | 'NONE';
interface Pack {
  kind: string;
  label: string;
  use: string;
  state: State;
  version: number | null;
  latestAvailable: number;
  sourceName: string | null;
  sourceUrl: string | null;
  refreshedAt: string | null;
  validUntil: string | null;
  itemCount: number;
  checksum: string | null;
  lastDiff: { added: string[]; changed: string[]; removed: string[] } | null;
  lastError: string | null;
  fallbackNote: string | null;
}
interface Overview {
  packs: Pack[];
  settings: { refreshDays: number; validDays: number; useOutsideContent: boolean };
  latestAvailable: number;
  canRefresh: boolean;
  note: string;
}
interface Refreshed {
  results: Array<{
    kind: string;
    outcome: 'UPDATED' | 'UNCHANGED' | 'FAILED';
    fromVersion: number | null;
    toVersion: number | null;
    diff: { added: string[]; changed: string[]; removed: string[] };
    error?: string;
  }>;
}
interface Items {
  label: string;
  version: number | null;
  items: Array<{ key: string; label: string; data: Record<string, unknown> }>;
}

const TONE: Record<State, BadgeTone> = {
  CURRENT: 'success',
  STALE: 'warning',
  FAILED: 'error',
  NONE: 'neutral',
};
const NAME: Record<State, string> = {
  CURRENT: 'Current',
  STALE: 'Stale',
  FAILED: 'Failed',
  NONE: 'Not loaded',
};
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'never');
const SHOWN = ['code', 'reference', 'median', 'benchmark', 'appliesTo'];

function ItemsView({ kind }: { kind: string }) {
  const d = useData<Items>(`/content/${kind}/items`);
  if (!d.data) return <p className="text-sm text-text-muted">Loading items…</p>;
  if (d.data.items.length === 0)
    return <p className="text-sm text-text-muted">This pack holds no items yet.</p>;
  return (
    <div data-testid="pack-items">
      <p className="text-sm font-semibold">
        {d.data.label}, version {d.data.version}: {d.data.items.length} items
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {d.data.items.map((i) => (
          <li key={i.key}>
            <span className="font-medium">{i.label}</span>{' '}
            <span className="text-xs text-text-muted">
              {Object.entries(i.data)
                .filter(([k]) => SHOWN.includes(k))
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The outside content packs: what is held, how fresh it is, what the last refresh changed, and a refresh (NFR-R03). */
export function ContentPacks({ csrf }: { csrf: string }) {
  const d = useData<Overview>('/content');
  const { busy, run, messages } = useRun();
  const [open, setOpen] = useState<string | null>(null);
  const [last, setLast] = useState<Refreshed['results'] | null>(null);
  if (d.error && !d.data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {d.error}
      </p>
    );
  const o = d.data;
  if (!o) return <p className="text-sm text-text-muted">Loading content packs…</p>;
  const refresh = (kind?: string) =>
    run(
      kind ?? 'all',
      async () => {
        const r = await send<Refreshed>(csrf, 'POST', '/content/refresh', kind ? { kind } : {});
        setLast(r.results);
        await d.reload();
      },
      kind ? 'Refresh finished.' : 'All packs refreshed.',
    );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-xl font-bold">Packs</h2>
          <Badge tone="neutral">Simulated outside source</Badge>
          {!o.settings.useOutsideContent && <Badge tone="warning">Switched off in settings</Badge>}
        </div>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          {o.note} Packs refresh every {o.settings.refreshDays} days and stay usable for{' '}
          {o.settings.validDays} days. A pack that is past that, or whose first load failed, is not used: the
          field is filled from in-house data alone and says so.
        </p>
        {o.canRefresh && (
          <div className="mt-3">
            <Button
              loading={busy === 'all'}
              disabled={busy !== null}
              onClick={() => void refresh()}
              data-testid="refresh-all"
            >
              Refresh all packs now
            </Button>
          </div>
        )}
        {messages}
        {last && (
          <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="refresh-result">
            {last.map((r) => (
              <li key={r.kind}>
                <span className="font-semibold">{o.packs.find((p) => p.kind === r.kind)?.label}:</span>{' '}
                {r.outcome === 'FAILED'
                  ? `failed, kept version ${r.fromVersion ?? 'none'} (${r.error})`
                  : r.outcome === 'UNCHANGED'
                    ? `already at the latest version ${r.toVersion}, nothing changed`
                    : `version ${r.fromVersion ?? 'none'} to ${r.toVersion}: ${r.diff.added.length} added, ${r.diff.changed.length} changed, ${r.diff.removed.length} removed`}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <Table caption="Outside content packs">
          <thead>
            <tr>
              <Th>Pack</Th>
              <Th>State</Th>
              <Th>Version</Th>
              <Th>Source</Th>
              <Th>Refreshed</Th>
              <Th>Valid until</Th>
              <Th>Items</Th>
              <Th>Last change</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {o.packs.map((p) => (
              <tr key={p.kind} data-testid={`pack-${p.kind}`}>
                <Td label="Pack">
                  <span className="font-semibold">{p.label}</span>
                  <span className="block text-xs text-text-muted">{p.use}</span>
                </Td>
                <Td label="State">
                  <Badge tone={TONE[p.state]}>
                    <span data-testid={`pack-state-${p.kind}`}>{NAME[p.state]}</span>
                  </Badge>
                </Td>
                <Td label="Version">{p.version ? `v${p.version} of ${p.latestAvailable}` : 'none'}</Td>
                <Td label="Source">
                  {p.sourceName ? (
                    <>
                      {p.sourceName}
                      <span className="block break-all text-xs text-text-muted">{p.sourceUrl}</span>
                    </>
                  ) : (
                    'none'
                  )}
                </Td>
                <Td label="Refreshed">{day(p.refreshedAt)}</Td>
                <Td label="Valid until">{day(p.validUntil)}</Td>
                <Td label="Items">
                  {p.itemCount}
                  {p.checksum && (
                    <span className="block font-mono text-xs text-text-muted">{p.checksum.slice(0, 8)}</span>
                  )}
                </Td>
                <Td label="Last change">
                  {p.lastDiff
                    ? `+${p.lastDiff.added.length} ~${p.lastDiff.changed.length} -${p.lastDiff.removed.length}`
                    : 'none'}
                </Td>
                <Td label="Actions">
                  <div className="flex flex-wrap gap-2">
                    {o.canRefresh && (
                      <Button
                        variant="secondary"
                        loading={busy === p.kind}
                        disabled={busy !== null}
                        onClick={() => void refresh(p.kind)}
                      >
                        Refresh<span className="sr-only"> {p.label}</span>
                      </Button>
                    )}
                    {p.version && (
                      <Button
                        variant="ghost"
                        onClick={() => setOpen(open === p.kind ? null : p.kind)}
                        aria-expanded={open === p.kind}
                      >
                        {open === p.kind ? 'Hide items' : 'View items'}
                        <span className="sr-only"> of {p.label}</span>
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {o.settings.useOutsideContent && o.packs.some((p) => p.fallbackNote) && (
          <ul className="mt-3 list-disc pl-5 text-sm text-warning" data-testid="fallback-notes">
            {o.packs
              .filter((p) => p.fallbackNote)
              .map((p) => (
                <li key={p.kind}>{p.fallbackNote}</li>
              ))}
          </ul>
        )}
        {open && (
          <div className="mt-4 border-t border-border pt-3">
            <ItemsView kind={open} />
          </div>
        )}
      </Card>
    </div>
  );
}
