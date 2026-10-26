import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import {
  ActivityRow,
  Badge,
  Button,
  EmptyState,
  KpiCell,
  KpiStrip,
  Panel,
  RowList,
  SectionHeader,
  Table,
  Td,
  Th,
  padNumber,
  type BadgeTone,
} from '@if/ui';
import type { CopilotSummary } from '@/components/copilot/copilot';
import { HomeHeader } from '@/components/home/home-header';
import { SinceLastHere } from '@/components/home/since-last-here';
import { WorkQueue, type QueueScope } from '@/components/home/work-queue';
import { Dashboards } from '@/components/reports/b6-reports';
import { SpendChart } from '@/components/reports/spend-chart';
import type { AuditPage, ProcurementTable, SpendReport } from '@/components/reports/types';
import { allowedRolesForPath } from '@/lib/access';
import { auditLines, procurementLines, procurementRow, type ActivityLine } from '@/lib/home';
import { PHASE_LABEL, aud } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Your work – Intuitive Fusion' };

interface Kpis {
  scope: 'PORTFOLIO' | 'PANEL' | 'OWN';
  activeProcurements: number;
  valueInFlight: number;
  avgCycleDays: number;
  alertsDue: number | null;
  pendingMyAction: number;
  byPhase: Array<{ phase: string; count: number }>;
  recent: Array<{
    id: string;
    number: string;
    title: string;
    phase: string;
    status: string;
    updatedAt: string;
  }>;
}
interface ContractLite {
  status: string;
  parentId: string | null;
}

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
const phaseLabel = (p: string) => PHASE_LABEL[p] ?? p;
const AUDIT_READERS = ['PROBITY', 'ADMIN', 'EXEC', 'PROCUREMENT'];

export default async function YourWork({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const phase = sp.phase && PHASES.includes(sp.phase) ? sp.phase : '';
  const q = (sp.q ?? '').slice(0, 100);
  const qs = new URLSearchParams({ ...(phase ? { phase } : {}), ...(q ? { q } : {}) }).toString();
  const user = await getSessionUser();
  const roles = user?.roles ?? [];
  // a link is offered only to someone who can open where it goes
  const canOpen = (path: string) => (allowedRolesForPath(path) ?? []).some((r) => roles.includes(r));
  const canOpenRequests = canOpen('/app/requests');
  const seesSpend = roles.some((r) => ['EXEC', 'FINANCE', 'PROCUREMENT'].includes(r));
  const seesContracts = canOpen('/app/contracts');
  const seesExpiring = canOpen('/app/contracts/expiring');
  const seesAudit = roles.some((r) => AUDIT_READERS.includes(r));
  const [k, table, spend, copilot, contracts, expiring, audit] = await Promise.all([
    apiGet<Kpis>('/dashboard/kpis'),
    apiGet<ProcurementTable>(`/reports/procurements${qs ? `?${qs}` : ''}`),
    seesSpend ? apiGet<SpendReport>('/reports/spend') : Promise.resolve(null),
    apiGet<CopilotSummary>('/copilot/summary'),
    seesContracts ? apiGet<ContractLite[]>('/contracts?status=EXECUTED') : Promise.resolve(null),
    seesExpiring ? apiGet<unknown[]>('/reports/expiring-contracts?days=90') : Promise.resolve(null),
    seesAudit ? apiGet<AuditPage>('/audit-events?limit=25') : Promise.resolve(null),
  ]);
  if (!k) {
    return (
      <EmptyState
        title="Your work is unavailable"
        body="This page could not be loaded. Please refresh; if the problem continues, contact support."
      />
    );
  }

  const requestHref = (id: string) => (canOpenRequests ? `/app/requests/${id}` : undefined);
  // Recent activity: the audit trail for those who may read it, otherwise the procurements they can see
  const fromAudit: ActivityLine[] = audit ? auditLines(audit.items, 25) : [];
  const fromProcurements = procurementLines(k.recent, phaseLabel, requestHref, 8);
  const feed = (fromAudit.length > 0 ? fromAudit : fromProcurements).slice(0, 6);
  const sinceSource = fromAudit.length > 0 ? fromAudit : fromProcurements;

  const rows = table?.items ?? [];
  const portfolio = k.scope === 'PORTFOLIO';
  const scopes: Array<{ value: QueueScope; label: string }> = portfolio
    ? [
        { value: 'mine', label: 'My work' },
        { value: 'team', label: 'Team' },
        { value: 'all', label: 'All' },
      ]
    : [
        { value: 'mine', label: 'My work' },
        { value: 'team', label: 'My procurements' },
      ];
  const toRow = (p: (typeof rows)[number]) => procurementRow(p, phaseLabel, requestHref(p.id) ?? null);
  const queueProcurements = {
    team: rows.filter((r) => r.status !== 'COMPLETE').map(toRow),
    all: rows.map(toRow),
  };

  const active = contracts ? contracts.filter((c) => !c.parentId).length : null;
  const max = Math.max(1, ...k.byPhase.map((p) => p.count));

  return (
    <div className="flex min-w-0 flex-col gap-12">
      <HomeHeader
        workspace={user?.tenantName ?? 'Your organisation'}
        name={user?.name ?? ''}
        serverNow={new Date().toISOString()}
        subtitle={`${SCOPE_TEXT[k.scope]} Figures come from synthetic demo data.`}
        newRequestHref={canOpenRequests ? '/app/requests/new' : undefined}
        personaliseHref="/app/dashboard/my"
      />

      <KpiStrip label="Key figures">
        <KpiCell
          label="Active procurements"
          value={padNumber(k.activeProcurements)}
          caption={`${aud.format(k.valueInFlight)} in pipeline`}
          href={canOpenRequests ? '/app/requests' : undefined}
          linkLabel="Active procurements: open the requests"
        />
        <KpiCell
          label="Awaiting decisions"
          value={padNumber(k.pendingMyAction)}
          caption={`${k.pendingMyAction} assigned to you`}
          href="/app/actions"
          linkLabel={`Awaiting decisions: ${k.pendingMyAction} assigned to you. Open the list of actions`}
        />
        <KpiCell
          label="Active agreements"
          value={padNumber(active)}
          caption="Contract register"
          href={seesContracts ? '/app/contracts' : undefined}
        />
        <KpiCell
          label="Expiring within 90 days"
          value={padNumber(expiring ? expiring.length : null)}
          caption="Renewal planning"
          href={seesExpiring ? '/app/contracts/expiring' : undefined}
        />
      </KpiStrip>

      <SinceLastHere activity={sinceSource} />

      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <WorkQueue scopes={scopes} procurements={queueProcurements} />
        <section
          aria-labelledby="activity-h"
          className="min-w-0 lg:border-l lg:border-border lg:pl-8"
          data-testid="recent-activity"
        >
          <SectionHeader id="activity-h" eyebrow="Across the business" title="Recent activity" />
          {feed.length === 0 ? (
            <p className="py-6 text-sm text-text-muted">Nothing has happened yet that you can see.</p>
          ) : (
            <RowList className="mt-3 border-b-0" aria-label="Recent activity">
              {feed.map((l) => (
                <ActivityRow key={l.key} who={l.who} text={l.text} meta={l.meta} href={l.href} />
              ))}
            </RowList>
          )}
        </section>
      </div>

      {copilot && (
        <Panel aria-labelledby="copilot-card" data-testid="copilot-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="copilot-card" className="flex items-center gap-3 font-heading text-xl font-medium">
              <Link href="/app/copilot" className="text-text no-underline hover:underline">
                Procurement Copilot
              </Link>
              <Badge tone="info">SIMULATED</Badge>
            </h2>
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
              {(
                [
                  ['Runs active', copilot.active],
                  ['Waiting for a person', copilot.waitingForPerson],
                  ['Problems repaired', copilot.repaired],
                  ['Completed', copilot.completed],
                ] as const
              ).map(([l, v]) => (
                <div key={l}>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{l}</dt>
                  <dd className="font-heading text-2xl font-medium">{padNumber(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>
      )}

      <section aria-labelledby="proc-h" className="flex min-w-0 flex-col gap-4">
        <SectionHeader id="proc-h" eyebrow="Portfolio" title="Procurements" />
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          role="search"
          aria-label="Filter procurements"
        >
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Search
            <input
              name="q"
              defaultValue={q}
              className="min-h-[36px] w-56 rounded-md border border-border-strong bg-surface px-3 text-sm text-text"
              placeholder="Number, title or category"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Phase
            <select
              name="phase"
              defaultValue={phase}
              className="min-h-[36px] rounded-md border border-border-strong bg-surface px-3 text-sm text-text"
            >
              <option value="">All phases</option>
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {PHASE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
          {(phase || q) && (
            <Link href="/app/dashboard" className="min-h-[36px] py-2 text-sm">
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
                          <span className="text-xs font-medium md:hidden" aria-hidden="true">
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

      <section aria-labelledby="by-phase" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel as="div" className="min-w-0">
          <h2 id="by-phase" className="font-heading text-xl font-medium">
            By phase
          </h2>
          {k.byPhase.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">No active procurements.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {k.byPhase.map((p) => (
                <li key={p.phase}>
                  <div className="flex justify-between text-sm">
                    <span>{PHASE_LABEL[p.phase] ?? p.phase}</span>
                    <strong>{p.count}</strong>
                  </div>
                  <div aria-hidden="true" className="mt-1.5 h-1.5 rounded-full bg-surface-alt">
                    <div
                      className="h-1.5 rounded-full bg-accent"
                      style={{ width: `${(p.count / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {spend && <SpendChart report={spend} />}
      </section>

      {roles.some((r) =>
        ['PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC', 'FINANCE', 'PROBITY', 'CONTRACT_MGR', 'ADMIN'].includes(
          r,
        ),
      ) && (
        <section aria-labelledby="role-views-h" className="flex flex-col gap-4">
          <SectionHeader id="role-views-h" eyebrow="Your role" title="Your role's view" />
          <Dashboards />
        </section>
      )}
    </div>
  );
}
