import { Activity, AlarmClock, Banknote, Hourglass, ListChecks } from 'lucide-react';
import { Badge, EmptyState, KpiCard, Table, Td, Th, type BadgeTone } from '@if/ui';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Dashboard – Intuitive Fusion' };

interface Kpis {
  activeProcurements: number;
  valueInFlight: number;
  avgCycleDays: number;
  alertsDue: number;
  pendingMyAction: number;
  byPhase: Array<{ phase: string; count: number }>;
  recent: Array<{
    id: string;
    number: string;
    title: string;
    phase: string;
    status: string;
    estimatedValue: number;
    updatedAt: string;
  }>;
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const audCompact = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
const PHASE_LABEL: Record<string, string> = {
  INTAKE: 'Intake',
  PLAN: 'Plan',
  TENDER: 'Tender',
  EVALUATION: 'Evaluation',
  CONTRACT_AWARD: 'Contract award',
  CONTRACT_MGMT: 'Contract management',
  CLOSED: 'Closed',
};
const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_PROGRESS: 'info',
  BLOCKED: 'error',
  COMPLETE: 'success',
};
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');

// TODO(M12): role-based layouts, drill-down charts, completeness ticks (FR-0600, FR-0625, FR-0650).
export default async function Dashboard() {
  const k = await apiGet<Kpis>('/dashboard/kpis');
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
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-text-muted">
          Live overview of the procurements you can see. Figures come from synthetic demo data.
        </p>
      </header>

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
          value={k.alertsDue}
          icon={<AlarmClock className="size-5" aria-hidden="true" />}
        />
        <KpiCard
          label="Waiting for you"
          value={k.pendingMyAction}
          hint="Actions for your role"
          icon={<ListChecks className="size-5" aria-hidden="true" />}
        />
      </section>

      <section aria-labelledby="by-phase" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
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

        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Recent procurements</h2>
          {k.recent.length === 0 ? (
            <EmptyState title="Nothing here yet" body="Procurements you can see will appear here." />
          ) : (
            <Table caption="Recent procurements">
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Title</Th>
                  <Th>Phase</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Value</Th>
                </tr>
              </thead>
              <tbody>
                {k.recent.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-mono text-xs">{r.number}</Td>
                    <Td>{r.title}</Td>
                    <Td>{PHASE_LABEL[r.phase] ?? r.phase}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{label(r.status)}</Badge>
                    </Td>
                    <Td className="text-right">{aud.format(r.estimatedValue)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
