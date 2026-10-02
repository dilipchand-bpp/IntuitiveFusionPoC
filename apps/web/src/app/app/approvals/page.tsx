import Link from 'next/link';
import { Button, EmptyState } from '@if/ui';
import { aud } from '@/lib/labels';
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
  const rows = await apiGet<Row[]>('/plans?status=AWAITING_APPROVAL');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">Approvals</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Plans waiting for your decision. Open one to see the key points on a single screen and approve
          within your authority.
        </p>
      </header>
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
            <li
              key={r.requestId}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-4"
              data-testid="approval-item"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-text-muted">{r.requestNumber}</p>
                <p className="font-heading text-lg font-semibold">{r.title}</p>
                <p className="text-sm text-text-muted">
                  {aud.format(r.estimatedValue)}
                  {r.complexity ? ` · ${r.complexity.toLowerCase()} complexity` : ''}
                </p>
              </div>
              <Button asChild variant="accent">
                <Link href={`/app/plans/${r.requestId}`} className="text-gradient-fg no-underline">
                  Review and decide
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
