import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Badge, EmptyState, Table, Td, Th } from '@if/ui';
import { Gantt } from '@/components/contract/gantt';
import { SpendChart } from '@/components/reports/spend-chart';
import type { SpendReport, WorkloadReport } from '@/components/reports/types';
import { PHASE_LABEL, aud } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Reports – Intuitive Fusion' };

export default async function ReportsPage() {
  const user = await getSessionUser();
  const has = (...r: string[]) => user?.roles.some((x) => r.includes(x)) ?? false;
  const [spend, work] = await Promise.all([
    has('EXEC', 'FINANCE', 'PROCUREMENT') ? apiGet<SpendReport>('/reports/spend') : Promise.resolve(null),
    has('EXEC', 'PROCUREMENT') ? apiGet<WorkloadReport>('/reports/workload') : Promise.resolve(null),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Reports</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Where the money goes, who is carrying the work, and what is coming up. Figures come from synthetic
          demo data.
        </p>
        <nav aria-label="More reports" className="mt-3 flex flex-wrap gap-2">
          {[
            [
              '/app/reports/ask',
              'Ask for a report',
              ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR', 'DELEGATE', 'LEGAL', 'PROBITY'],
            ],
            ['/app/reports/performance', 'Spend and performance', ['EXEC', 'FINANCE', 'PROCUREMENT']],
            ['/app/reports/schedule', 'Schedule', ['PROCUREMENT', 'EXEC', 'DELEGATE']],
            ['/app/reports/capacity', 'Workload and capacity', ['PROCUREMENT', 'EXEC']],
            [
              '/app/reports/commitment',
              'Future commitment',
              ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'],
            ],
            [
              '/app/reports/optimisation',
              'Spend optimisation',
              ['EXEC', 'FINANCE', 'PROCUREMENT', 'CONTRACT_MGR'],
            ],
            [
              '/app/reports/supplier-risk',
              'Supplier risk map',
              ['PROCUREMENT', 'EXEC', 'FINANCE', 'PROBITY'],
            ],
          ]
            .filter(([, , roles]) => has(...(roles as string[])))
            .map(([href, label]) => (
              <Link
                key={href as string}
                href={href as string}
                className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
              >
                {label as string}
              </Link>
            ))}
        </nav>
        {has('CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC') && (
          <nav aria-label="Related reports" className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/app/contracts/expiring"
              className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
            >
              Contracts expiring
            </Link>
            <Link
              href="/app/contracts/alerts"
              className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
            >
              Contract alerts
            </Link>
            <Link
              href="/app/contracts/ingest/report"
              className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
            >
              Ingested contracts (clauses, caps, notice)
            </Link>
          </nav>
        )}
      </header>

      {!spend && !work && (
        <EmptyState
          title="No reports for your role"
          body="Spend and workload reports are for the executive, finance and procurement. Contract managers can open the expiring contracts report above."
        />
      )}

      {spend && (
        <>
          <section aria-labelledby="cat-h" className="grid min-w-0 gap-6 lg:grid-cols-2">
            <SpendChart report={spend} />
            <div className="min-w-0 rounded-lg border border-border bg-surface p-6 shadow-sm">
              <h2 id="cat-h" className="font-heading text-lg font-semibold">
                What is behind each category
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                Open a category to see its requests and contracts.
              </p>
              <ul className="mt-3 flex flex-col gap-2" data-testid="drilldown">
                {spend.byCategory.map((c) => (
                  <li key={c.category} className="rounded-md border border-border">
                    <details>
                      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
                        <span className="min-w-0">{c.category}</span>
                        <span className="shrink-0">{aud.format(c.pipeline + c.committed)}</span>
                      </summary>
                      <ul className="border-t border-border px-3 py-2 text-sm">
                        {c.items.map((i) => (
                          <li
                            key={`${i.kind}-${i.number}`}
                            className="flex flex-wrap justify-between gap-x-3 py-1"
                          >
                            <span>
                              <span className="font-mono text-xs text-text-muted">{i.number}</span>{' '}
                              {i.title || i.supplier}
                              <Badge tone={i.kind === 'CONTRACT' ? 'success' : 'info'} className="ml-2">
                                {i.kind === 'CONTRACT' ? 'Contract' : 'Pipeline'}
                              </Badge>
                            </span>
                            <span>{aud.format(i.value)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="sup-h" className="flex min-w-0 flex-col gap-3">
            <h2 id="sup-h" className="font-heading text-xl font-bold">
              Committed spend by supplier
            </h2>
            {spend.bySupplier.length === 0 ? (
              <EmptyState
                title="No executed contracts yet"
                body="Spend by supplier appears when contracts are executed."
              />
            ) : (
              <Table caption="Committed spend by supplier">
                <thead>
                  <tr>
                    <Th>Supplier</Th>
                    <Th className="text-right">Contracts</Th>
                    <Th className="text-right">Committed</Th>
                    <Th className="text-right">Share</Th>
                  </tr>
                </thead>
                <tbody>
                  {spend.bySupplier.map((s) => (
                    <tr key={s.supplierId}>
                      <Td label="Supplier">{s.company}</Td>
                      <Td label="Contracts" className="text-right">
                        {s.contracts}
                      </Td>
                      <Td label="Committed" className="text-right">
                        {aud.format(s.committed)}
                      </Td>
                      <Td label="Share" className="text-right">
                        {s.share}%
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section aria-labelledby="mav-h" className="flex min-w-0 flex-col gap-3">
            <h2 id="mav-h" className="flex items-center gap-2 font-heading text-xl font-bold">
              Off-contract spend
              {spend.offContract.length > 0 && (
                <Badge tone="warning">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  {aud.format(spend.totalOffContract)}
                </Badge>
              )}
            </h2>
            {spend.offContract.length === 0 ? (
              <p className="text-text-muted">
                Every purchase that reached delivery has a contract behind it.
              </p>
            ) : (
              <>
                <p className="max-w-prose text-sm text-text-muted">
                  These purchases reached delivery or were closed with no executed contract. They are the
                  first place to look for savings and risk.
                </p>
                <Table caption="Off-contract spend">
                  <thead>
                    <tr>
                      <Th>Number</Th>
                      <Th>Purchase</Th>
                      <Th>Category</Th>
                      <Th>Phase</Th>
                      <Th className="text-right">Value</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {spend.offContract.map((o) => (
                      <tr key={o.requestId} data-testid="offcontract-row">
                        <Td label="Number" className="whitespace-nowrap font-mono text-xs">
                          {o.number}
                        </Td>
                        <Td label="Purchase">
                          <Link href={`/app/requests/${o.requestId}`}>{o.title}</Link>
                        </Td>
                        <Td label="Category">{o.category}</Td>
                        <Td label="Phase">{PHASE_LABEL[o.phase] ?? o.phase}</Td>
                        <Td label="Value" className="text-right">
                          {aud.format(o.value)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </section>
        </>
      )}

      {work && (
        <>
          <section aria-labelledby="work-h" className="flex min-w-0 flex-col gap-3">
            <h2 id="work-h" className="font-heading text-xl font-bold">
              Workload by owner
            </h2>
            <p className="max-w-prose text-sm text-text-muted">{work.note}</p>
            {work.owners.length === 0 ? (
              <EmptyState
                title="No active procurements"
                body="Workload appears when procurements are in progress."
              />
            ) : (
              <Table caption="Workload by owner">
                <thead>
                  <tr>
                    <Th>Owner</Th>
                    <Th className="text-right">Procurements</Th>
                    <Th className="text-right">Value</Th>
                    <Th>By phase</Th>
                  </tr>
                </thead>
                <tbody>
                  {work.owners.map((o) => (
                    <tr key={o.ownerId} data-testid="owner-row">
                      <Td label="Owner">{o.ownerName}</Td>
                      <Td label="Procurements" className="text-right">
                        {o.procurements}
                      </Td>
                      <Td label="Value" className="text-right">
                        {aud.format(o.value)}
                      </Td>
                      <Td label="By phase">
                        {Object.entries(o.byPhase)
                          .map(([ph, n]) => `${PHASE_LABEL[ph] ?? ph}: ${n}`)
                          .join(', ')}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section
            aria-labelledby="tl-h"
            className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            <h2 id="tl-h" className="font-heading text-xl font-bold">
              Procurement timeline
            </h2>
            <Gantt
              today={work.today}
              rows={work.timeline.map((r) => ({
                id: r.requestId,
                label: `${r.number} ${r.title} (${r.owner})`,
                bars: r.bars,
              }))}
            />
          </section>
        </>
      )}
    </div>
  );
}
