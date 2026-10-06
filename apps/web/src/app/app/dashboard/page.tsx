import Link from 'next/link';
import { Activity, AlarmClock, Banknote, Check, Hourglass, ListChecks, Minus } from 'lucide-react';
import { Badge, EmptyState, KpiCard, Table, Td, Th, type BadgeTone } from '@if/ui';
import { Dashboards } from '@/components/reports/b6-reports';
import { SpendChart } from '@/components/reports/spend-chart';
import type { ProcurementTable, SpendReport } from '@/components/reports/types';
import { PHASE_LABEL, aud } from '@/lib/labels';
import { navFor } from '@/lib/nav';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Dashboard – Intuitive Fusion' };

interface Kpis {
  scope: 'PORTFOLIO' | 'PANEL' | 'OWN';
  activeProcurements: number;
  valueInFlight: number;
  avgCycleDays: number;
  alertsDue: number | null;
  pendingMyAction: number;
  byPhase: Array<{ phase: string; count: number }>;
}

const audCompact = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_PROGRESS: 'info',
  BLOCKED: 'error',
  COMPLETE: 'success',
};
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');
const SCOPE_TEXT: Record<Kpis['scope'], string> = {
  PORTFOLIO: 'Every procurement in the organisation.',
  PANEL: 'The procurements you evaluate and the ones you raised.',
  OWN: 'The requests you raised.',
};
const STEPS = [
  ['intake', 'Intake'],
  ['plan', 'Plan'],
  ['tender', 'Tender'],
  ['evaluation', 'Evaluation'],
  ['contract', 'Contract'],
] as const;
const PHASES = Object.keys(PHASE_LABEL);

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const phase = sp.phase && PHASES.includes(sp.phase) ? sp.phase : '';
  const q = (sp.q ?? '').slice(0, 100);
  const qs = new URLSearchParams({ ...(phase ? { phase } : {}), ...(q ? { q } : {}) }).toString();
  const user = await getSessionUser();
  // a request title links to the request only for people whose menu offers Requests (an administrator's does not)
  const canOpenRequests = navFor(user?.roles ?? []).some((n) => n.href === '/app/requests');
  const seesSpend = user?.roles.some((r) => ['EXEC', 'FINANCE', 'PROCUREMENT'].includes(r)) ?? false;
  const [k, table, spend] = await Promise.all([
    apiGet<Kpis>('/dashboard/kpis'),
    apiGet<ProcurementTable>(`/reports/procurements${qs ? `?${qs}` : ''}`),
    seesSpend ? apiGet<SpendReport>('/reports/spend') : Promise.resolve(null),
  ]);
  if (!k) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        body="The dashboard could not be loaded. Please refresh the page; if the problem continues, contact support."
      />
    );
  }
  const max = Math.max(1, ...k.byPhase.map((p) => p.count));
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-text-muted" data-testid="scope-text">
          {SCOPE_TEXT[k.scope]} Figures come from synthetic demo data.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/app/dashboard/my">Personalise my dashboard</Link>
        </p>
      </header>

      <section
        aria-label="Key figures"
        className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>:last-child:nth-child(odd)]:col-span-2 xl:[&>:last-child:nth-child(odd)]:col-span-1"
      >
        <KpiCard
          label="Active procurements"
          value={k.activeProcurements}
          icon={<Activity className="size-5" aria-hidden="true" />}
        />
        <KpiCard
          label="Value in flight"
          value={audCompact.format(k.valueInFlight)}
          hint={aud.format(k.valueInFlight)}
          icon={<Banknote className="size-5" aria-hidden="true" />}
        />
        <KpiCard
          label="Avg. cycle time"
          value={`${k.avgCycleDays} days`}
          hint="Completed requests"
          icon={<Hourglass className="size-5" aria-hidden="true" />}
        />
        <KpiCard
          label="Alerts due (30 days)"
          value={k.alertsDue ?? '–'}
          hint={k.alertsDue === null ? 'Contract management only' : undefined}
          icon={<AlarmClock className="size-5" aria-hidden="true" />}
        />
        <KpiCard
          label="Waiting for you"
          value={k.pendingMyAction}
          hint="Actions for your role"
          icon={<ListChecks className="size-5" aria-hidden="true" />}
        />
      </section>

      <section aria-labelledby="by-phase" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h2 id="by-phase" className="font-heading text-lg font-semibold">
            By phase
          </h2>
          {k.byPhase.length === 0 ? (
            <p className="mt-2 text-text-muted">No active procurements.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {k.byPhase.map((p) => (
                <li key={p.phase}>
                  <div className="flex justify-between text-sm">
                    <span>{PHASE_LABEL[p.phase] ?? p.phase}</span>
                    <strong>{p.count}</strong>
                  </div>
                  <div aria-hidden="true" className="mt-1.5 h-2.5 rounded-full bg-surface-alt">
                    <div
                      className="bg-brand-gradient h-2.5 rounded-full"
                      style={{ width: `${(p.count / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {spend && <SpendChart report={spend} />}
      </section>

      <section aria-labelledby="proc-h" className="flex min-w-0 flex-col gap-3">
        <h2 id="proc-h" className="font-heading text-xl font-bold">
          Procurements
        </h2>
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          role="search"
          aria-label="Filter procurements"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Search
            <input
              name="q"
              defaultValue={q}
              className="min-h-[44px] w-56 rounded-md border border-border-strong bg-surface px-3 font-normal"
              placeholder="Number, title or category"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Phase
            <select
              name="phase"
              defaultValue={phase}
              className="min-h-[44px] rounded-md border border-border-strong bg-surface px-3 font-normal"
            >
              <option value="">All phases</option>
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {PHASE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-md border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-alt"
          >
            Apply
          </button>
          {(phase || q) && (
            <Link href="/app/dashboard" className="min-h-[44px] py-3 text-sm">
              Clear
            </Link>
          )}
        </form>
        {!table ? (
          <EmptyState title="The table is unavailable" body="Please refresh the page." />
        ) : table.items.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body={phase || q ? 'Try clearing the filters.' : 'Procurements you can see will appear here.'}
          />
        ) : (
          <Table caption="Procurements">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Title</Th>
                <Th>Phase</Th>
                <Th>Status</Th>
                <Th className="text-right">Value</Th>
                {STEPS.map(([, name]) => (
                  <Th key={name} className="text-center">
                    {name}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.items.map((r) => (
                <tr key={r.id} data-testid="proc-row">
                  <Td label="Number" className="whitespace-nowrap font-mono text-xs">
                    {r.number}
                  </Td>
                  <Td label="Title">
                    {table.scope === 'PANEL' ? (
                      r.evaluationId ? (
                        <Link href={`/app/evaluations/${r.evaluationId}`}>{r.title}</Link>
                      ) : (
                        r.title
                      )
                    ) : canOpenRequests ? (
                      <Link href={`/app/requests/${r.id}`}>{r.title}</Link>
                    ) : (
                      r.title
                    )}
                  </Td>
                  <Td label="Phase">{PHASE_LABEL[r.phase] ?? r.phase}</Td>
                  <Td label="Status">
                    <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{label(r.status)}</Badge>
                  </Td>
                  <Td label="Value" className="text-right">
                    {aud.format(r.estimatedValue)}
                  </Td>
                  {STEPS.map(([key, name]) => (
                    <Td key={key} label={name} className="text-center">
                      {r.steps[key] ? (
                        <span className="relative inline-flex items-center gap-1 text-success">
                          <Check className="size-5" aria-hidden="true" />
                          <span className="sr-only">{name} complete</span>
                          <span className="text-xs font-semibold md:hidden" aria-hidden="true">
                            Complete
                          </span>
                        </span>
                      ) : (
                        <span className="relative inline-flex items-center gap-1 text-text-muted">
                          <Minus className="size-5" aria-hidden="true" />
                          <span className="sr-only">{name} not complete</span>
                          <span className="text-xs md:hidden" aria-hidden="true">
                            Not yet
                          </span>
                        </span>
                      )}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      {user?.roles.some((r) =>
        ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY', 'CONTRACT_MGR', 'ADMIN'].includes(
          r,
        ),
      ) && (
        <section aria-labelledby="role-views-h" className="flex flex-col gap-3">
          <h2 id="role-views-h" className="font-heading text-xl font-bold">
            Your role&apos;s view
          </h2>
          <Dashboards />
        </section>
      )}
    </div>
  );
}
