'use client';
import { useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { api } from '@/lib/api-client';
import { aud } from '@/lib/labels';
import { Bar, send, useData, useRun } from '@/components/contract/b5-shared';

const DAY = 86_400_000;
const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const PHASE_NAME: Record<string, string> = {
  INTAKE: 'Intake',
  PLAN: 'Plan',
  TENDER: 'Tender',
  EVALUATION: 'Evaluation',
  CONTRACT_AWARD: 'Contract award',
  CONTRACT_MGMT: 'Contract management',
  CLOSED: 'Closed',
};
const PHASE_FILL = ['bg-accent', 'bg-info', 'bg-warning', 'bg-success', 'bg-error'];

// ------------------------------------------------------------------ schedule (FR-0595)
interface Slot {
  phase: string;
  startDate: string;
  endDate: string;
}
interface ScheduleItem {
  requestId: string;
  number: string;
  title: string;
  manager: string | null;
  phase: string;
  slots: Slot[];
  late: boolean;
}
interface Schedule {
  today: string;
  items: ScheduleItem[];
  delegateCalendar: Array<{ date: string; what: string; number: string; requestId: string }>;
  canMove: boolean;
}

export function ScheduleGantt({ csrf }: { csrf: string }) {
  const { data, error, reload } = useData<Schedule>('/reports/schedule');
  const r = useRun();
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; phase: string; x: number; dx: number } | null>(null);
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  if (data.items.length === 0)
    return (
      <EmptyState
        title="No active procurements"
        body="Active procurements appear here as a chart of their phases."
      />
    );
  const all = data.items.flatMap((i) => i.slots.flatMap((s) => [ms(s.startDate), ms(s.endDate)]));
  const lo = Math.min(...all, ms(data.today)) - 3 * DAY;
  const hi = Math.max(...all, ms(data.today)) + 3 * DAY;
  const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const move = (id: string, phase: string, delta: number) =>
    r.run(
      `m-${id}-${phase}`,
      async () => {
        await send(csrf, 'POST', `/reports/schedule/${id}/move`, { phase, deltaDays: delta });
        await reload();
      },
      `Moved by ${delta} day(s); the phases after it and the delegate calendar were recalculated.`,
    );
  const dragDays = (dx: number) => {
    const w = (box.current?.getBoundingClientRect().width ?? 1) - 240;
    return Math.round((dx / w) * ((hi - lo) / DAY));
  };
  const months: Array<{ label: string; at: number }> = [];
  for (let t = new Date(lo); t.getTime() < hi;) {
    const first = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
    months.push({
      label: new Date(first).toLocaleDateString('en-AU', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      at: first,
    });
    t = new Date(first);
  }
  const todayAt = pct(ms(data.today));
  return (
    <div className="flex flex-col gap-6" data-testid="schedule">
      <ul className="flex flex-wrap gap-3 text-xs" aria-label="Phases">
        {data.items[0]!.slots.map((s, k) => (
          <li key={s.phase} className="flex items-center gap-1">
            <span
              className={`inline-block size-3 rounded-sm ${PHASE_FILL[k % PHASE_FILL.length]}`}
              aria-hidden="true"
            />
            {PHASE_NAME[s.phase]}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className="inline-block h-3 w-0.5 bg-error" aria-hidden="true" />
          Today ({data.today})
        </li>
      </ul>
      <div
        className="overflow-x-auto rounded-lg border border-border bg-surface"
        role="group"
        aria-label="Procurement schedule"
      >
        <div className="min-w-[56rem]">
          <div className="grid grid-cols-[15rem_1fr] border-b border-border bg-surface-alt text-xs font-semibold text-text-muted">
            <div className="px-3 py-2">Procurement</div>
            <div className="relative h-8">
              {months
                .filter((m) => pct(m.at) < 100)
                .map((m) => (
                  <span
                    key={m.at}
                    className="absolute top-2 -translate-x-0 border-l border-border pl-1"
                    style={{ left: `${pct(m.at)}%` }}
                  >
                    {m.label}
                  </span>
                ))}
            </div>
          </div>
          <div ref={box} className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-[15rem] right-0" aria-hidden="true">
              <div className="absolute inset-y-0 w-px bg-error" style={{ left: `${todayAt}%` }} />
            </div>
            <ul>
              {data.items.map((i) => (
                <li
                  key={i.requestId}
                  data-testid="schedule-row"
                  className="grid grid-cols-[15rem_1fr] items-center border-b border-border last:border-b-0"
                >
                  <div className="min-w-0 px-3 py-2">
                    <p className="truncate text-sm font-semibold" title={i.title}>
                      {i.title}
                    </p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
                      <span className="font-mono">{i.number}</span> · {PHASE_NAME[i.phase] ?? i.phase}
                      {i.late && <Badge tone="error">Behind</Badge>}
                    </p>
                  </div>
                  <div className="relative my-2 h-8" style={{ touchAction: 'none' }}>
                    {i.slots.map((s, k) => {
                      const dx =
                        drag &&
                        drag.id === i.requestId &&
                        (drag.phase === s.phase || i.slots.findIndex((q) => q.phase === drag.phase) < k)
                          ? drag.dx
                          : 0;
                      return (
                        <div
                          key={s.phase}
                          role="img"
                          aria-label={`${PHASE_NAME[s.phase]}: ${s.startDate} to ${s.endDate}`}
                          title={`${PHASE_NAME[s.phase]} ${s.startDate} to ${s.endDate}${data.canMove ? ' (drag to move)' : ''}`}
                          className={`absolute top-0 flex h-8 items-center overflow-hidden rounded-sm border border-surface text-[10px] font-semibold text-white ${PHASE_FILL[k % PHASE_FILL.length]} ${data.canMove ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          style={{
                            left: `${pct(ms(s.startDate))}%`,
                            width: `${Math.max(1, pct(ms(s.endDate)) - pct(ms(s.startDate)))}%`,
                            transform: `translateX(${dx}px)`,
                          }}
                          onPointerDown={(e) => {
                            if (!data.canMove) return;
                            (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            setDrag({ id: i.requestId, phase: s.phase, x: e.clientX, dx: 0 });
                          }}
                          onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x })}
                          onPointerUp={() => {
                            if (!drag) return;
                            const days = dragDays(drag.dx);
                            setDrag(null);
                            if (days !== 0) void move(drag.id, drag.phase, days);
                          }}
                        >
                          <span className="truncate px-1">{PHASE_NAME[s.phase]}</span>
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <p className="text-xs text-text-muted">
        {data.canMove
          ? 'Drag a bar to move that phase and everything after it.'
          : 'Read only: procurement moves phases.'}
      </p>
      {r.messages}

      {data.canMove && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer font-semibold">Move a phase without dragging</summary>
          <Table caption="Move a phase" className="mt-2">
            <thead>
              <tr>
                <Th>Procurement</Th>
                <Th>Phase</Th>
                <Th>Dates</Th>
                <Th>Move</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.flatMap((i) =>
                i.slots.map((s) => (
                  <tr key={`${i.requestId}${s.phase}`}>
                    <Td label="Procurement">{i.number}</Td>
                    <Td label="Phase">{PHASE_NAME[s.phase]}</Td>
                    <Td label="Dates" className="whitespace-nowrap">
                      {s.startDate} to {s.endDate}
                    </Td>
                    <Td label="Move">
                      <span className="flex gap-2">
                        <Button
                          variant="secondary"
                          aria-label={`Move ${PHASE_NAME[s.phase]} of ${i.number} 7 days earlier`}
                          onClick={() => void move(i.requestId, s.phase, -7)}
                        >
                          Earlier
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={`Move ${PHASE_NAME[s.phase]} of ${i.number} 7 days later`}
                          onClick={() => void move(i.requestId, s.phase, 7)}
                        >
                          Later
                        </Button>
                      </span>
                    </Td>
                  </tr>
                )),
              )}
            </tbody>
          </Table>
        </details>
      )}

      <section aria-labelledby="cal-h">
        <h2 id="cal-h" className="font-heading text-xl font-bold">
          Delegate calendar
        </h2>
        <Table caption="Dates a delegate is asked to act" className="mt-2" data-testid="delegate-calendar">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>What</Th>
              <Th>Procurement</Th>
            </tr>
          </thead>
          <tbody>
            {data.delegateCalendar.slice(0, 40).map((c, k) => (
              <tr key={k}>
                <Td label="Date" className="whitespace-nowrap">
                  {c.date}
                </Td>
                <Td label="What">{c.what}</Td>
                <Td label="Procurement">{c.number}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ dashboards by role (FR-0600)
interface Dash {
  view: string;
  title: string;
  visibility: string;
  note: string;
  kpis: Array<{ label: string; value: number | string; detail?: string }>;
  tables: Array<{ title: string; columns: string[]; rows: Array<Array<string | number>> }>;
}
export function Dashboards() {
  const list = useData<{ views: Array<{ view: string; title: string }>; visibility: string }>('/dashboards');
  const [view, setView] = useState<string | null>(null);
  const cur = view ?? list.data?.views[0]?.view ?? null;
  const d = useData<Dash>(cur ? `/dashboards/${cur}` : null);
  if (list.error)
    return (
      <p role="alert" className="text-sm text-error">
        {list.error}
      </p>
    );
  if (!list.data) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Dashboards" className="flex flex-wrap gap-2">
        {list.data.views.map((v) => (
          <button
            key={v.view}
            type="button"
            aria-pressed={cur === v.view}
            onClick={() => setView(v.view)}
            className={`min-h-[44px] rounded-full border px-4 text-sm font-semibold ${cur === v.view ? 'border-accent bg-accent/10 text-accent' : 'border-border-strong text-text'}`}
          >
            {v.title}
          </button>
        ))}
      </nav>
      {d.data && (
        <div className="flex flex-col gap-4" data-testid="dashboard">
          <p className="text-sm text-text-muted" data-testid="dashboard-scope">
            {d.data.note}
          </p>
          <dl className="grid gap-3 sm:grid-cols-3">
            {d.data.kpis.map((k) => (
              <Card key={k.label}>
                <dt className="text-sm text-text-muted">{k.label}</dt>
                <dd className="mt-1 text-2xl font-extrabold">
                  {typeof k.value === 'number' && /value|committed|invoiced/i.test(k.label)
                    ? aud.format(k.value)
                    : k.value}
                </dd>
                {k.detail && <dd className="text-xs text-text-muted">{k.detail}</dd>}
              </Card>
            ))}
          </dl>
          {d.data.tables.map((t) => (
            <Table key={t.title} caption={t.title}>
              <thead>
                <tr>
                  {t.columns.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <Td key={j} label={t.columns[j]!}>
                        {typeof cell === 'number' && /value|committed/i.test(t.columns[j]!)
                          ? aud.format(cell)
                          : cell}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ performance (FR-0605)
interface Perf {
  categorySpend: Array<{ category: string; committed: number; contracts: number }>;
  maverick: {
    invoicesOutsideContract: Array<{ number: string; contract: string; amount: number; reason: string }>;
    offContractPurchases: Array<{ number: string; title: string; value: number }>;
    total: number;
  };
  savings: {
    items: Array<{ number: string; title: string; estimate: number; awarded: number; saved: number }>;
    captured: number;
    overruns: number;
  };
  velocity: {
    phases: Array<{
      phase: string;
      completed: number;
      avgDays: number | null;
      waiting: number;
      longestWaitDays: number;
    }>;
    bottleneck: string | null;
  };
  note: string;
}
interface Drill {
  total: number;
  rows: Array<{ id: string; number: string; title: string; phase: string; status: string; value: number }>;
}
export function Performance() {
  const { data, error } = useData<Perf>('/reports/performance');
  const [drill, setDrill] = useState<{ label: string; data: Drill } | null>(null);
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const top = Math.max(1, ...data.categorySpend.map((c) => c.committed));
  const open = (by: string, key: string, label: string) =>
    r.run('drill', async () =>
      setDrill({ label, data: await api<Drill>(`/reports/drill?by=${by}&key=${encodeURIComponent(key)}`) }),
    );
  return (
    <div className="flex flex-col gap-6" data-testid="performance">
      <section aria-labelledby="cs-h">
        <h2 id="cs-h" className="font-heading text-xl font-bold">
          Category spend
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {data.categorySpend.map((c) => (
            <li key={c.category}>
              <Bar
                label={`${c.category}: ${aud.format(c.committed)} in ${c.contracts} contract(s)`}
                pct={(c.committed / top) * 100}
                limit={false}
              />
            </li>
          ))}
          {data.categorySpend.length === 0 && (
            <li className="text-sm text-text-muted">No executed contracts yet.</li>
          )}
        </ul>
      </section>
      <section aria-labelledby="mv-h">
        <h2 id="mv-h" className="font-heading text-xl font-bold">
          Maverick spend: {aud.format(data.maverick.total)}
        </h2>
        <p className="text-sm text-text-muted">
          Invoices released outside the contract match, and purchases that reached delivery with no executed
          contract.
        </p>
        <Table caption="Invoices outside the contract match" className="mt-2">
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Contract</Th>
              <Th className="text-right">Amount</Th>
              <Th>Why it was released</Th>
            </tr>
          </thead>
          <tbody>
            {data.maverick.invoicesOutsideContract.map((x) => (
              <tr key={x.number}>
                <Td label="Invoice">{x.number}</Td>
                <Td label="Contract">{x.contract}</Td>
                <Td label="Amount" className="text-right">
                  {aud.format(x.amount)}
                </Td>
                <Td label="Why it was released">{x.reason}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section aria-labelledby="sv-h">
        <h2 id="sv-h" className="font-heading text-xl font-bold">
          Captured savings: {aud.format(data.savings.captured)}
        </h2>
        <Table caption="Savings against the estimate" className="mt-2">
          <thead>
            <tr>
              <Th>Procurement</Th>
              <Th className="text-right">Estimate</Th>
              <Th className="text-right">Awarded</Th>
              <Th className="text-right">Saved</Th>
            </tr>
          </thead>
          <tbody>
            {data.savings.items.map((x) => (
              <tr key={x.number}>
                <Td label="Procurement">
                  {x.number} {x.title}
                </Td>
                <Td label="Estimate" className="text-right">
                  {aud.format(x.estimate)}
                </Td>
                <Td label="Awarded" className="text-right">
                  {aud.format(x.awarded)}
                </Td>
                <Td label="Saved" className="text-right">
                  {aud.format(x.saved)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section aria-labelledby="vl-h">
        <h2 id="vl-h" className="font-heading text-xl font-bold">
          Procurement velocity{' '}
          {data.velocity.bottleneck && (
            <Badge tone="warning">
              Bottleneck: {PHASE_NAME[data.velocity.bottleneck] ?? data.velocity.bottleneck}
            </Badge>
          )}
        </h2>
        <Table caption="Time in each phase" className="mt-2" data-testid="velocity">
          <thead>
            <tr>
              <Th>Phase</Th>
              <Th className="text-right">Finished</Th>
              <Th className="text-right">Average days</Th>
              <Th className="text-right">Waiting now</Th>
              <Th className="text-right">Longest wait</Th>
            </tr>
          </thead>
          <tbody>
            {data.velocity.phases.map((p) => (
              <tr key={p.phase}>
                <Td label="Phase">
                  <Button
                    variant="secondary"
                    aria-label={`Show procurements in ${PHASE_NAME[p.phase] ?? p.phase}`}
                    onClick={() =>
                      void open(
                        'phase',
                        p.phase === 'CONTRACT_AWARD' ? 'CONTRACT_AWARD' : p.phase,
                        PHASE_NAME[p.phase] ?? p.phase,
                      )
                    }
                  >
                    {PHASE_NAME[p.phase] ?? p.phase}
                  </Button>
                </Td>
                <Td label="Finished" className="text-right">
                  {p.completed}
                </Td>
                <Td label="Average days" className="text-right">
                  {p.avgDays ?? '–'}
                </Td>
                <Td label="Waiting now" className="text-right">
                  {p.waiting}
                </Td>
                <Td label="Longest wait" className="text-right">
                  {p.longestWaitDays}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
      {drill && (
        <Card aria-labelledby="dr-h" role="region" data-testid="drill">
          <h2 id="dr-h" className="font-heading text-lg font-bold">
            {drill.label}: {drill.data.total} procurement(s)
          </h2>
          <ul className="mt-2 text-sm">
            {drill.data.rows.map((x) => (
              <li key={x.id}>
                <a href={`/app/requests/${x.id}`}>
                  {x.number} {x.title}
                </a>{' '}
                · {aud.format(x.value)}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {r.messages}
      <p className="text-xs text-text-muted">{data.note}</p>
    </div>
  );
}

// ------------------------------------------------------------------ supplier risk map (FR-0610)
interface RiskItem {
  supplierId: string;
  company: string;
  location: { city: string; state: string; country: string; lat: number; lng: number } | null;
  committed: number;
  categories: string[];
  signals: Array<{ feed: string; level: string; detail: string }>;
  level: string;
}
interface RiskMap {
  items: RiskItem[];
  singlePoints: Array<{
    kind: string;
    category?: string;
    supplier?: string;
    region?: string;
    share?: number;
    reason: string;
  }>;
  note: string;
}
const LEVEL = { HIGH: 'error', MEDIUM: 'warning', LOW: 'success', UNKNOWN: 'neutral' } as const;
const SHAPE = { HIGH: '▲', MEDIUM: '◆', LOW: '●', UNKNOWN: '○' } as const;

export function SupplierRisk({ csrf, canEdit }: { csrf: string; canEdit: boolean }) {
  const { data, error, reload } = useData<RiskMap>('/reports/supplier-risk');
  const [f, setF] = useState({ supplierId: '', city: '', state: '', country: 'Australia', lat: '', lng: '' });
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const placed = data.items.filter((i) => i.location);
  const lats = placed.map((i) => i.location!.lat);
  const lngs = placed.map((i) => i.location!.lng);
  const minLat = Math.min(...lats, -44) - 3;
  const maxLat = Math.max(...lats, -10) + 3;
  const minLng = Math.min(...lngs, 112) - 3;
  const maxLng = Math.max(...lngs, 154) + 3;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * 100;
  const y = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * 60;
  return (
    <div className="flex flex-col gap-6" data-testid="supplier-risk">
      <svg
        viewBox="0 0 100 60"
        role="img"
        aria-label={`Map of ${placed.length} supplier location(s)`}
        className="w-full rounded-lg border border-border bg-surface-alt"
      >
        {placed.map((i) => (
          <g key={i.supplierId} transform={`translate(${x(i.location!.lng)} ${y(i.location!.lat)})`}>
            <text
              fontSize="3"
              textAnchor="middle"
              className={
                i.level === 'HIGH' ? 'fill-error' : i.level === 'MEDIUM' ? 'fill-warning' : 'fill-success'
              }
            >
              {SHAPE[i.level as keyof typeof SHAPE] ?? '○'}
            </text>
            <text y="4" fontSize="2" textAnchor="middle" className="fill-current">
              {i.company}
            </text>
          </g>
        ))}
        {placed.length === 0 && (
          <text x="50" y="30" textAnchor="middle" fontSize="3" className="fill-current">
            No supplier locations recorded yet
          </text>
        )}
      </svg>
      <Table caption="Suppliers and their risk signals" data-testid="risk-table">
        <thead>
          <tr>
            <Th>Supplier</Th>
            <Th>Where</Th>
            <Th>Overall</Th>
            <Th>Signals</Th>
            <Th className="text-right">Committed</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.supplierId}>
              <Td label="Supplier">{i.company}</Td>
              <Td label="Where">
                {i.location
                  ? `${i.location.city}, ${i.location.state}, ${i.location.country}`
                  : 'Not recorded'}
              </Td>
              <Td label="Overall">
                <Badge tone={LEVEL[i.level as keyof typeof LEVEL] ?? 'neutral'}>
                  {SHAPE[i.level as keyof typeof SHAPE]} {i.level.toLowerCase()}
                </Badge>
              </Td>
              <Td label="Signals">
                <ul className="text-xs">
                  {i.signals.map((s) => (
                    <li key={s.feed}>
                      {s.feed.toLowerCase()}: {s.level.toLowerCase()} — {s.detail}
                    </li>
                  ))}
                </ul>
              </Td>
              <Td label="Committed" className="text-right">
                {aud.format(i.committed)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <section aria-labelledby="sp-h">
        <h2 id="sp-h" className="font-heading text-xl font-bold">
          Single points of failure
        </h2>
        <ul className="mt-2 list-disc pl-5 text-sm" data-testid="single-points">
          {data.singlePoints.length === 0 && <li>None found.</li>}
          {data.singlePoints.map((s, k) => (
            <li key={k}>
              {s.kind === 'CATEGORY'
                ? `${s.category}: ${s.supplier}`
                : `${s.region} (${s.share}% of committed spend)`}{' '}
              — {s.reason}
            </li>
          ))}
        </ul>
      </section>
      {canEdit && (
        <Card aria-labelledby="loc-h" role="region">
          <h2 id="loc-h" className="font-heading text-xl font-bold">
            Record a supplier location
          </h2>
          <form
            aria-label="Record a supplier location"
            className="mt-2 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(
                'loc',
                async () => {
                  await send(csrf, 'PUT', `/suppliers/${f.supplierId}/location`, {
                    city: f.city,
                    state: f.state,
                    country: f.country,
                    lat: Number(f.lat),
                    lng: Number(f.lng),
                  });
                  await reload();
                },
                'Location saved.',
              );
            }}
          >
            <Field label="Supplier">
              <Select
                value={f.supplierId}
                onChange={(e) => setF({ ...f, supplierId: e.target.value })}
                className="w-56"
              >
                <option value="">Choose a supplier</option>
                {data.items.map((i) => (
                  <option key={i.supplierId} value={i.supplierId}>
                    {i.company}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="City">
              <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} className="w-36" />
            </Field>
            <Field label="State">
              <Input
                value={f.state}
                onChange={(e) => setF({ ...f, state: e.target.value })}
                className="w-24"
              />
            </Field>
            <Field label="Country">
              <Input
                value={f.country}
                onChange={(e) => setF({ ...f, country: e.target.value })}
                className="w-36"
              />
            </Field>
            <Field label="Latitude">
              <Input
                type="number"
                step="any"
                value={f.lat}
                onChange={(e) => setF({ ...f, lat: e.target.value })}
                className="w-28"
              />
            </Field>
            <Field label="Longitude">
              <Input
                type="number"
                step="any"
                value={f.lng}
                onChange={(e) => setF({ ...f, lng: e.target.value })}
                className="w-28"
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              loading={r.busy === 'loc'}
              disabled={!f.supplierId || !f.city || !f.state || !f.lat || !f.lng}
            >
              Save location
            </Button>
          </form>
          {r.messages}
        </Card>
      )}
      <p className="text-xs text-text-muted">{data.note}</p>
    </div>
  );
}

// ------------------------------------------------------------------ workload against capacity (FR-0620)
interface Capacity {
  capacityPerManager: number;
  managers: Array<{
    managerId: string;
    name: string;
    procurements: number;
    exposure: number;
    utilisation: number;
    overloaded: boolean;
    items: Array<{ id: string; number: string; title: string; value: number }>;
  }>;
  unassigned: Array<{ id: string; number: string; title: string; value: number }>;
  suggestion: string | null;
}
export function CapacityView({ csrf, canAssign }: { csrf: string; canAssign: boolean }) {
  const { data, error, reload } = useData<Capacity>('/reports/capacity');
  const [pick, setPick] = useState<Record<string, string>>({});
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const assign = (id: string, managerId: string | null) =>
    r.run(
      `a-${id}`,
      async () => {
        await send(csrf, 'PUT', `/requests/${id}/manager`, { managerId });
        await reload();
      },
      'Assigned.',
    );
  return (
    <div className="flex flex-col gap-5" data-testid="capacity">
      {data.suggestion && (
        <p
          role="status"
          className="rounded-md border border-warning bg-warning-bg p-3 text-sm font-semibold text-warning"
        >
          {data.suggestion}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {data.managers.map((m) => (
          <li key={m.managerId}>
            <Card data-testid={`manager-${m.name}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-bold">{m.name}</h2>
                {m.overloaded && <Badge tone="error">Over capacity</Badge>}
                <span className="ml-auto text-sm text-text-muted">{aud.format(m.exposure)} exposure</span>
              </div>
              <div className="mt-2">
                <Bar
                  label={`${m.procurements} of ${data.capacityPerManager} procurements`}
                  pct={m.utilisation}
                />
              </div>
              <ul className="mt-2 text-sm">
                {m.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {i.number} {i.title} ({aud.format(i.value)})
                    </span>
                    {canAssign && (
                      <>
                        <Select
                          aria-label={`Move ${i.number} to`}
                          value={pick[i.id] ?? ''}
                          onChange={(e) => setPick({ ...pick, [i.id]: e.target.value })}
                          className="w-44"
                        >
                          <option value="">Move to…</option>
                          {data.managers
                            .filter((x) => x.managerId !== m.managerId)
                            .map((x) => (
                              <option key={x.managerId} value={x.managerId}>
                                {x.name}
                              </option>
                            ))}
                        </Select>
                        <Button
                          variant="secondary"
                          aria-label={`Reassign ${i.number}`}
                          disabled={!pick[i.id]}
                          onClick={() => void assign(i.id, pick[i.id]!)}
                        >
                          Reassign
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
      {data.unassigned.length > 0 && (
        <section aria-labelledby="un-h">
          <h2 id="un-h" className="font-heading text-lg font-bold">
            Not yet assigned to a manager
          </h2>
          <ul className="mt-2 text-sm">
            {data.unassigned.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {i.number} {i.title}
                </span>
                {canAssign && (
                  <>
                    <Select
                      aria-label={`Assign ${i.number} to`}
                      value={pick[i.id] ?? ''}
                      onChange={(e) => setPick({ ...pick, [i.id]: e.target.value })}
                      className="w-44"
                    >
                      <option value="">Assign to…</option>
                      {data.managers.map((x) => (
                        <option key={x.managerId} value={x.managerId}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="secondary"
                      aria-label={`Assign ${i.number}`}
                      disabled={!pick[i.id]}
                      onClick={() => void assign(i.id, pick[i.id]!)}
                    >
                      Assign
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.messages}
    </div>
  );
}

// ------------------------------------------------------------------ spend by any dimension (FR-0645)
interface SpendBy {
  dimension: string;
  dimensions: string[];
  rows: Array<{ key: string; committed: number; invoiced: number; contracts: string[] }>;
  total: { committed: number; invoiced: number };
}
const DIM_LABEL: Record<string, string> = {
  SUPPLIER: 'Supplier',
  CONTRACT: 'Contract',
  MASTER: 'Master agreement',
  PROJECT: 'Project',
  BUSINESS_UNIT: 'Business unit',
  DIVISION: 'Division',
};
export function SpendBy() {
  const [dim, setDim] = useState('SUPPLIER');
  const { data, error } = useData<SpendBy>(`/reports/spend-by?dimension=${dim}`);
  return (
    <div className="flex flex-col gap-4" data-testid="spend-by">
      <Field label="Report spend by">
        <Select value={dim} onChange={(e) => setDim(e.target.value)} className="w-64">
          {Object.entries(DIM_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {data && (
        <Table caption={`Spend by ${DIM_LABEL[dim]?.toLowerCase()}`}>
          <thead>
            <tr>
              <Th>{DIM_LABEL[dim]}</Th>
              <Th className="text-right">Committed</Th>
              <Th className="text-right">Invoiced</Th>
              <Th>Contracts</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((x) => (
              <tr key={x.key}>
                <Td label={DIM_LABEL[dim]!}>{x.key}</Td>
                <Td label="Committed" className="text-right">
                  {aud.format(x.committed)}
                </Td>
                <Td label="Invoiced" className="text-right">
                  {aud.format(x.invoiced)}
                </Td>
                <Td label="Contracts" className="font-mono text-xs">
                  {x.contracts.join(', ')}
                </Td>
              </tr>
            ))}
            <tr>
              <Td label="Total" className="font-semibold">
                Total
              </Td>
              <Td label="Committed" className="text-right font-semibold">
                {aud.format(data.total.committed)}
              </Td>
              <Td label="Invoiced" className="text-right font-semibold">
                {aud.format(data.total.invoiced)}
              </Td>
              <Td label="Contracts">&nbsp;</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ask, and saved views (FR-0625)
interface Answer {
  question: string;
  interpretation: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
  total: number;
  model: string;
}
interface View {
  id: string;
  name: string;
  report: string;
  filters: Record<string, string | number | boolean>;
  shared: boolean;
  mine: boolean;
  owner?: string;
}
export function AskPanel({ csrf }: { csrf: string }) {
  const [q, setQ] = useState('');
  const [ans, setAns] = useState<Answer | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const views = useData<View[]>('/report-views');
  const r = useRun();
  const ask = (text: string) =>
    r.run('ask', async () => {
      setAns(await send<Answer>(csrf, 'POST', '/reports/ask', { question: text }));
    });
  return (
    <div className="flex flex-col gap-5" data-testid="ask">
      <form
        role="search"
        aria-label="Ask for a report"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <Field
          label="Ask for a report in plain language"
          hint='For example "all procurement risks in 2026", "contracts expiring in 90 days" or "blocked invoices".'
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={300}
            className="w-[28rem] max-w-full"
          />
        </Field>
        <Button type="submit" loading={r.busy === 'ask'} disabled={q.trim().length < 3}>
          Show me
        </Button>
      </form>
      {r.messages}
      {ans && (
        <section aria-labelledby="ans-h" data-testid="answer">
          <h2 id="ans-h" className="font-heading text-lg font-bold">
            {ans.total} result(s)
          </h2>
          <p className="text-sm text-text-muted" data-testid="interpretation">
            I read this as: {ans.interpretation}. ({ans.model})
          </p>
          <Table caption="Report" className="mt-2">
            <thead>
              <tr>
                {ans.columns.map((c) => (
                  <Th key={c.key}>{c.label}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ans.rows.map((row, i) => (
                <tr key={i}>
                  {ans.columns.map((c) => (
                    <Td key={c.key} label={c.label}>
                      {typeof row[c.key] === 'number' && /value|amount/i.test(c.key)
                        ? aud.format(row[c.key] as number)
                        : (row[c.key] ?? '–')}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          <form
            aria-label="Save this view"
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void r.run(
                'save',
                async () => {
                  await send(csrf, 'POST', '/report-views', {
                    name,
                    report: 'ask',
                    filters: { question: ans.question },
                    shared,
                  });
                  setName('');
                  await views.reload();
                },
                'View saved.',
              );
            }}
          >
            <Field label="Name this view">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="w-64" maxLength={80} />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              Share with everyone
            </label>
            <Button type="submit" variant="secondary" disabled={name.trim().length < 2}>
              Save view
            </Button>
          </form>
        </section>
      )}
      <section aria-labelledby="sv2-h">
        <h2 id="sv2-h" className="font-heading text-lg font-bold">
          Saved views
        </h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm" data-testid="saved-views">
          {(views.data ?? []).length === 0 && (
            <li className="text-text-muted">None yet. Ask a question and save it.</li>
          )}
          {(views.data ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <strong>{v.name}</strong>
              {v.shared && <Badge tone="info">Shared{v.mine ? '' : ` by ${v.owner}`}</Badge>}
              {typeof v.filters.question === 'string' && (
                <Button
                  variant="secondary"
                  aria-label={`Run ${v.name}`}
                  onClick={() => {
                    setQ(String(v.filters.question));
                    void ask(String(v.filters.question));
                  }}
                >
                  Run
                </Button>
              )}
              {v.mine && (
                <Button
                  variant="secondary"
                  aria-label={`Delete ${v.name}`}
                  onClick={() =>
                    void r.run('del', async () => {
                      await send(csrf, 'DELETE', `/report-views/${v.id}`);
                      await views.reload();
                    })
                  }
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
