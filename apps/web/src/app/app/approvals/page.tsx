import Link from 'next/link';
import { Button, EmptyState, PageHeader, Panel, SectionHeader } from '@if/ui';
import { aud } from '@/lib/labels';
import type { TenderSummary } from '@/components/tender/types';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Approvals – Intuitive Fusion' };

interface Row {
  planId?: string;
  requestId: string;
  requestNumber: string;
  title: string;
  estimatedValue: number;
  complexity?: string;
  status: string;
}

export default async function ApprovalsPage() {
  const [rows, tenders] = await Promise.all([
    apiGet<Row[]>('/plans?status=AWAITING_APPROVAL'),
    apiGet<TenderSummary[]>('/tenders'),
  ]);
  const staged = (tenders ?? []).filter((x) => x.status === 'STAGED' && !x.permissionGranted);
  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Approvals"
        subtitle="Plans waiting for your decision. Open one to see the key points on a single screen and approve within your authority."
      />
      {!rows ? (
        <EmptyState
          title="Approvals unavailable"
          body="The list could not be loaded. Please refresh the page."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing is waiting for you"
          body="You will be notified when a plan needs your approval."
        />
      ) : (
        <ul className="grid gap-3" aria-label="Plans awaiting approval">
          {rows.map((r) => (
            <Panel
              as="li"
              key={r.requestId}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-4"
              data-testid="approval-item"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-text-muted">{r.requestNumber}</p>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-sm text-text-muted">
                  {aud.format(r.estimatedValue)}
                  {r.complexity ? ` · ${r.complexity.toLowerCase()} complexity` : ''}
                </p>
              </div>
              <Button asChild variant="accent">
                <Link href={`/app/plans/${r.requestId}`} className="no-underline">
                  Review and decide
                </Link>
              </Button>
            </Panel>
          ))}
        </ul>
      )}
      {staged.length > 0 && (
        <section aria-labelledby="permit-h" className="flex flex-col gap-4">
          <SectionHeader id="permit-h" title="Tenders waiting for permission to publish" />
          <ul className="grid gap-3" aria-label="Tenders awaiting permission to publish">
            {staged.map((x) => (
              <Panel
                as="li"
                key={x.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-4"
                data-testid="permit-item"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-text-muted">{x.requestNumber}</p>
                  <p className="text-sm font-medium">{x.title}</p>
                  <p className="text-sm text-text-muted">
                    {aud.format(x.estimatedValue)} · staged, not visible to suppliers
                  </p>
                </div>
                <Button asChild variant="accent">
                  <Link href={`/app/tenders/${x.id}`} className="no-underline">
                    Review and give permission
                  </Link>
                </Button>
              </Panel>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
