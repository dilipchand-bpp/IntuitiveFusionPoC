import Link from 'next/link';
import { Badge, Button, EmptyState, PageHeader, Table, Td, Th, SectionHeader } from '@if/ui';
import { Gantt } from '@/components/contract/gantt';
import type { ExpiringContract } from '@/components/contract/types';
import { aud } from '@/lib/labels';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Contracts expiring – Intuitive Fusion' };

const WINDOWS = [30, 90, 180, 365, 730];

export default async function ExpiringPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = WINDOWS.includes(Number(raw)) ? Number(raw) : 90;
  const rows = await apiGet<ExpiringContract[]>(`/reports/expiring-contracts?days=${days}`);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <PageHeader
        title="Contracts expiring"
        subtitle={
          <>
            Executed contracts that end within the next {days} days, soonest first. The chart shows the
            initial term and any optional extensions.
          </>
        }
        actions={
          <nav aria-label="Window" className="flex flex-wrap gap-2">
            {WINDOWS.map((w) => (
              <Button key={w} asChild variant={w === days ? 'primary' : 'secondary'} size="sm">
                <Link
                  href={`/app/contracts/expiring?days=${w}`}
                  aria-current={w === days ? 'page' : undefined}
                >
                  {w} days
                </Link>
              </Button>
            ))}
          </nav>
        }
      />

      {!rows ? (
        <EmptyState title="The report is unavailable" body="Please refresh the page." />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`Nothing ends in the next ${days} days`}
          body="Try a longer window to plan further ahead."
        />
      ) : (
        <>
          <section aria-labelledby="gantt-h" className="border border-border p-4">
            <SectionHeader id="gantt-h" title="Terms and extensions" />
            <Gantt
              today={today}
              rows={rows.map((r) => ({ id: r.contractId, label: `${r.number} ${r.supplier}`, bars: r.bars }))}
            />
          </section>
          <Table caption="Contracts expiring">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Contract</Th>
                <Th>Supplier</Th>
                <Th>Owner</Th>
                <Th className="text-right">Value</Th>
                <Th>Ends</Th>
                <Th>Notice by</Th>
                <Th className="text-right">Days left</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contractId}>
                  <Td label="Number" className="whitespace-nowrap font-mono text-xs">
                    {r.number}
                  </Td>
                  <Td label="Contract">
                    <Link href={`/app/contracts/${r.contractId}`}>{r.title ?? r.number}</Link>
                  </Td>
                  <Td label="Supplier">{r.supplier}</Td>
                  <Td label="Owner">{r.owner ?? '–'}</Td>
                  <Td label="Value" className="text-right">
                    {aud.format(r.value)}
                  </Td>
                  <Td label="Ends" className="whitespace-nowrap">
                    {r.endDate}
                  </Td>
                  <Td label="Notice by" className="whitespace-nowrap">
                    {r.noticeDeadline}
                  </Td>
                  <Td label="Days left" className="text-right">
                    <Badge
                      tone={r.daysRemaining <= 30 ? 'error' : r.daysRemaining <= 60 ? 'warning' : 'info'}
                    >
                      {r.daysRemaining}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
