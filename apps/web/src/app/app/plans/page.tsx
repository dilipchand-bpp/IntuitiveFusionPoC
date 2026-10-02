import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th } from '@if/ui';
import { COMPLEXITY_LABEL, COMPLEXITY_TONE, PLAN_STATUS_LABEL, PLAN_STATUS_TONE, aud } from '@/lib/labels';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Procurement plans – Intuitive Fusion' };

interface Row {
  planId?: string;
  requestId: string;
  requestNumber: string;
  title: string;
  estimatedValue: number;
  complexity?: string;
  status: string;
  updatedAt: string;
}
const when = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

export default async function PlansPage() {
  const rows = await apiGet<Row[]>('/plans');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">Procurement plans</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Each submitted request gets a plan, drafted for you from what was asked. Review it, change anything
          in plain language, then send it for approval.
        </p>
      </header>
      {!rows ? (
        <EmptyState title="Plans unavailable" body="The list could not be loaded. Please refresh the page." />
      ) : rows.length === 0 ? (
        <EmptyState title="No plans yet" body="When a request is submitted, its plan appears here." />
      ) : (
        <Table caption="Procurement plans">
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Title</Th>
              <Th>Plan status</Th>
              <Th>Complexity</Th>
              <Th className="text-right">Value</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requestId}>
                <Td label="Request" className="whitespace-nowrap font-mono text-xs">
                  {r.requestNumber}
                </Td>
                <Td label="Title">
                  <Link href={`/app/plans/${r.requestId}`}>{r.title}</Link>
                </Td>
                <Td label="Plan status">
                  <Badge tone={PLAN_STATUS_TONE[r.status] ?? 'neutral'}>
                    {PLAN_STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </Td>
                <Td label="Complexity">
                  {r.complexity ? (
                    <Badge tone={COMPLEXITY_TONE[r.complexity] ?? 'neutral'}>
                      {COMPLEXITY_LABEL[r.complexity]}
                    </Badge>
                  ) : (
                    '–'
                  )}
                </Td>
                <Td label="Value" className="text-right">
                  {aud.format(r.estimatedValue)}
                </Td>
                <Td label="Updated" className="whitespace-nowrap">
                  {when.format(new Date(r.updatedAt))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
