'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { PHASE_LABEL, aud } from '@/lib/labels';
import { message, send, useData, useRun } from '@/components/contract/b5-shared';
import { ChartView, type ChartStyle, type Point } from './chart-kit';

type Size = 'S' | 'M' | 'L';
interface Placed {
  key: string;
  size: Size;
  style: ChartStyle;
}
interface Def {
  key: string;
  title: string;
  description: string;
  source: string;
  styles: ChartStyle[];
  defaultStyle: ChartStyle;
  defaultSize: Size;
}
interface View {
  custom: boolean;
  widgets: Placed[];
  catalogue: Def[];
  styles: ChartStyle[];
  sizes: Size[];
}

const STYLE_LABEL: Record<ChartStyle, string> = {
  CARDS: 'Cards',
  BAR: 'Bars (flat)',
  BAR3D: 'Bars (solid)',
  LINE: 'Line',
  DONUT: 'Donut',
  TABLE: 'Table',
};
const SIZE_LABEL: Record<Size, string> = { S: 'Small', M: 'Medium', L: 'Large' };
// static class names so Tailwind can see them
const SPAN: Record<Size, string> = {
  S: 'lg:col-span-2',
  M: 'md:col-span-1 lg:col-span-3',
  L: 'md:col-span-2 lg:col-span-6',
};
const MAX_WIDGETS = 12;
const compact = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const money = (n: number): Point['display'] => compact.format(n);

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Turns each report's reply into the plain series a chart takes. */
function toPoints(key: string, d: any): Point[] {
  const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
  switch (key) {
    case 'kpis':
      return [
        { label: 'Active procurements', value: d.activeProcurements },
        { label: 'Value in flight', value: d.valueInFlight, display: money(d.valueInFlight) },
        { label: 'Avg. cycle time', value: d.avgCycleDays, display: `${d.avgCycleDays} days` },
        ...(typeof d.alertsDue === 'number' ? [{ label: 'Alerts due (30 days)', value: d.alertsDue }] : []),
        { label: 'Waiting for you', value: d.pendingMyAction },
      ];
    case 'phases':
      return arr(d.byPhase).map((p) => ({ label: PHASE_LABEL[p.phase] ?? p.phase, value: p.count }));
    case 'spend':
      return arr(d.byCategory).map((c) => ({
        label: c.category,
        value: c.pipeline + c.committed,
        display: money(c.pipeline + c.committed),
      }));
    case 'savings':
      return arr(d.savings?.items)
        .slice(0, 8)
        .map((s) => ({ label: s.number, value: s.saved, display: money(s.saved) }));
    case 'velocity':
      return arr(d.velocity?.phases).map((p) => ({
        label: PHASE_LABEL[p.phase] ?? p.phase,
        value: p.avgDays ?? 0,
        display: p.avgDays === null ? 'no data' : `${p.avgDays} days`,
      }));
    case 'commitment':
      return arr(d.totals).map((t) => {
        const v = Math.max(t.committed, t.expected);
        return { label: t.label, value: v, display: money(v) };
      });
    case 'optimisation': {
      const s = d.summary ?? {};
      const rows: Array<[string, number]> = [
        ['Consolidation', s.consolidation],
        ['Rate cards', s.rateCards],
        ['Invoiced above rate', s.invoicedAboveContractRate],
        ['Overcharges stopped', s.overchargesStopped],
      ];
      return rows.map(([label, v]) => ({ label, value: v ?? 0, display: money(v ?? 0) }));
    }
    case 'esg':
      return [
        ...arr(d.groups).map((g) => ({
          label: String(g.group)
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/^./, (c) => c.toUpperCase()),
          value: g.committed,
          display: money(g.committed),
        })),
      ];
    case 'risk':
      return arr(d.items)
        .slice(0, 8)
        .map((s) => ({
          label: s.company,
          value: s.score,
          display: `${s.score} (${String(s.level).toLowerCase()})`,
        }));
    default:
      return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Cache = Map<string, Promise<unknown>>;

/** Loads one report, sharing the request between widgets that draw on the same one. */
function useSource(path: string, cache: Cache) {
  const [state, setState] = useState<{ data: unknown; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    let p = cache.get(path);
    if (!p) {
      p = api<unknown>(path);
      cache.set(path, p);
    }
    p.then(
      (data) => {
        if (live) setState({ data, error: null });
      },
      (e) => {
        cache.delete(path);
        if (live) setState({ data: null, error: message(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [path, cache]);
  return state;
}

function Widget({ def, placed, cache }: { def: Def; placed: Placed; cache: Cache }) {
  const { data, error } = useSource(def.source, cache);
  return (
    <section
      aria-label={def.title}
      data-testid={`widget-${def.key}`}
      className={`min-w-0 rounded-lg border border-border bg-surface p-5 shadow-sm ${SPAN[placed.size]}`}
    >
      <h2 className="font-heading text-lg font-semibold">{def.title}</h2>
      <p className="mb-3 mt-0.5 text-sm text-text-muted">{def.description}</p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      ) : !data ? (
        <p className="text-text-muted" role="status">
          Loading…
        </p>
      ) : (
        <ChartView style={placed.style} caption={def.title} points={toPoints(def.key, data)} />
      )}
    </section>
  );
}

const selectCls = 'min-h-[44px] rounded-md border border-border-strong bg-surface px-2 text-sm font-normal';
const btnCls =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50';

export function MyDashboard({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const { data, error } = useData<View>('/me/dashboard');
  const [saved, setSaved] = useState<View | null>(null);
  const view = saved ?? data;
  const [draft, setDraft] = useState<Placed[] | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [toAdd, setToAdd] = useState('');
  const { busy, run, messages } = useRun();
  const cache = useRef<Cache>(new Map()).current;

  if (error) {
    return (
      <p role="alert" className="font-medium text-error">
        {error}
      </p>
    );
  }
  if (!view) return <p className="text-text-muted">Loading your dashboard…</p>;

  const defs = new Map(view.catalogue.map((d) => [d.key, d]));
  const editing = draft !== null;
  const shown = draft ?? view.widgets;
  const available = view.catalogue.filter((d) => !shown.some((w) => w.key === d.key));

  const move = (from: number, to: number) => {
    if (!draft || to < 0 || to >= draft.length || from === to) return;
    const next = [...draft];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setDraft(next);
    setAnnounce(`${defs.get(item!.key)?.title ?? item!.key} moved to position ${to + 1} of ${next.length}.`);
  };
  const change = (i: number, patch: Partial<Placed>) =>
    setDraft((d) => (d ? d.map((w, n) => (n === i ? { ...w, ...patch } : w)) : d));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted" data-testid="dashboard-kind">
          {view.custom
            ? 'This is your own dashboard. Reset it to go back to the default for your role.'
            : 'This is the default dashboard for your role. Edit it to make it your own.'}{' '}
          Widgets offered depend on your role
          {roles.length ? ` (${roles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ')})` : ''}.
        </p>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnCls}
              onClick={() => setDraft(view.widgets.map((w) => ({ ...w })))}
            >
              Edit my dashboard
            </button>
            {view.custom && (
              <button
                type="button"
                className={btnCls}
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    'reset',
                    async () => setSaved(await send<View>(csrf, 'DELETE', '/me/dashboard')),
                    'Your dashboard is back to the default.',
                  )
                }
              >
                Reset to default
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <section aria-labelledby="edit-h" className="rounded-lg border border-border-strong bg-surface p-5">
          <h2 id="edit-h" className="font-heading text-lg font-semibold">
            Edit my dashboard
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Drag a widget by its handle, or use the Up and Down buttons, to change the order. Up to{' '}
            {MAX_WIDGETS} widgets.
          </p>
          <ol className="mt-4 flex flex-col gap-3">
            {draft.map((w, i) => {
              const def = defs.get(w.key);
              if (!def) return null;
              return (
                <li
                  key={w.key}
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', w.key);
                  }}
                  onDragOver={(e) => {
                    if (dragFrom !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null) move(dragFrom, i);
                    setDragFrom(null);
                  }}
                  onDragEnd={() => setDragFrom(null)}
                  className={`flex flex-wrap items-center gap-3 rounded-md border bg-surface-alt p-3 ${
                    dragFrom === i ? 'border-accent opacity-60' : 'border-border'
                  }`}
                  data-testid="edit-row"
                >
                  <GripVertical className="size-5 shrink-0 cursor-grab text-text-muted" aria-hidden="true" />
                  <span className="min-w-[10rem] flex-1 font-semibold">{def.title}</span>
                  <label className="flex flex-col gap-1 text-xs font-semibold">
                    Size
                    <select
                      className={selectCls}
                      value={w.size}
                      onChange={(e) => change(i, { size: e.target.value as Size })}
                    >
                      {view.sizes.map((s) => (
                        <option key={s} value={s}>
                          {SIZE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold">
                    Style
                    <select
                      className={selectCls}
                      value={w.style}
                      onChange={(e) => change(i, { style: e.target.value as ChartStyle })}
                    >
                      {def.styles.map((s) => (
                        <option key={s} value={s}>
                          {STYLE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={btnCls}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                      aria-label={`Move ${def.title} up`}
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                      Up
                    </button>
                    <button
                      type="button"
                      className={btnCls}
                      disabled={i === draft.length - 1}
                      onClick={() => move(i, i + 1)}
                      aria-label={`Move ${def.title} down`}
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                      Down
                    </button>
                    <button
                      type="button"
                      className={btnCls}
                      onClick={() => {
                        setDraft(draft.filter((_, n) => n !== i));
                        setAnnounce(`${def.title} removed.`);
                      }}
                      aria-label={`Remove ${def.title}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {draft.length === 0 && (
            <p className="mt-2 text-sm text-warning">Add at least one widget before saving.</p>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Add a widget
              <select
                className={`${selectCls} min-w-[16rem]`}
                value={toAdd}
                onChange={(e) => setToAdd(e.target.value)}
                disabled={available.length === 0}
              >
                <option value="">
                  {available.length ? 'Choose from the catalogue' : 'Everything is already added'}
                </option>
                {available.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={btnCls}
              disabled={!toAdd || draft.length >= MAX_WIDGETS}
              onClick={() => {
                const d = defs.get(toAdd);
                if (!d) return;
                setDraft([...draft, { key: d.key, size: d.defaultSize, style: d.defaultStyle }]);
                setAnnounce(`${d.title} added.`);
                setToAdd('');
              }}
            >
              Add
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="bg-brand-gradient min-h-[44px] rounded-md px-5 text-sm font-semibold text-gradient-fg disabled:opacity-50"
              disabled={busy !== null || draft.length === 0}
              onClick={() =>
                void run(
                  'save',
                  async () => {
                    setSaved(await send<View>(csrf, 'PUT', '/me/dashboard', { widgets: draft }));
                    setDraft(null);
                  },
                  'Your dashboard is saved.',
                )
              }
            >
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={btnCls} disabled={busy !== null} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={btnCls}
              disabled={busy !== null}
              onClick={() =>
                void run(
                  'reset',
                  async () => {
                    setSaved(await send<View>(csrf, 'DELETE', '/me/dashboard'));
                    setDraft(null);
                  },
                  'Your dashboard is back to the default.',
                )
              }
            >
              Reset to default
            </button>
          </div>
          <div aria-live="polite" className="sr-only">
            {announce}
          </div>
        </section>
      )}
      {messages}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6" data-testid="widget-grid">
        {shown.map((w) => {
          const def = defs.get(w.key);
          return def ? <Widget key={w.key} def={def} placed={w} cache={cache} /> : null;
        })}
      </div>
      {shown.length === 0 && <p className="text-text-muted">No widgets yet.</p>}
      <p className="text-xs text-text-muted">
        Figures come from synthetic demo data; amounts are in {aud.resolvedOptions().currency}.
      </p>
    </div>
  );
}
