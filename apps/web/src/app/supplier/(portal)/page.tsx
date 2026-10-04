import Link from 'next/link';
import { Badge, EmptyState } from '@if/ui';
import type { SupplierTenderSummary } from '@/components/tender/types';
import {
  SUBMISSION_LABEL,
  SUBMISSION_TONE,
  TENDER_STATUS_LABEL,
  TENDER_STATUS_TONE,
  TENDER_TYPE_LABEL,
  formatDateTime,
} from '@/lib/labels';
import { apiGetResult } from '@/lib/session';

export const metadata = { title: 'My tenders – Intuitive Fusion' };

export default async function SupplierHome() {
  const res = await apiGetResult<SupplierTenderSummary[]>('/supplier/tenders');
  const rows = res.data;
  const onHold = res.code === 'SUPPLIER_QUARANTINED';
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">My tenders</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          You can only see tenders you have been invited to, or that are open to every registered supplier.
        </p>
      </header>
      {onHold ? (
        <EmptyState
          title="Your account is on hold"
          body="A screening result is being reviewed by the buyer, so tenders are not available yet. You will be told when it is released."
        />
      ) : !rows ? (
        <EmptyState title="Your tenders are unavailable" body="Please refresh the page." />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No tenders yet"
          body="When a buyer invites you and the tender is published, it appears here. Use the link in your invitation to register."
        />
      ) : (
        <ul className="grid gap-4" aria-label="Your tenders">
          {rows.map((t) => (
            <li
              key={t.id}
              className="card-lift rounded-lg border border-border bg-surface p-5 shadow-sm"
              data-testid="supplier-tender"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TENDER_STATUS_TONE[t.status] ?? 'neutral'}>
                  {TENDER_STATUS_LABEL[t.status] ?? t.status}
                </Badge>
                <Badge tone="info">{TENDER_TYPE_LABEL[t.type] ?? t.type}</Badge>
                <Badge tone={SUBMISSION_TONE[t.submissionStatus] ?? 'neutral'}>
                  {SUBMISSION_LABEL[t.submissionStatus] ?? t.submissionStatus}
                </Badge>
              </div>
              <h2 className="mt-3 font-heading text-xl font-bold">
                <Link href={`/supplier/tenders/${t.id}`}>{t.title}</Link>
              </h2>
              <p className="text-sm text-text-muted">
                <span className="font-mono">{t.number}</span> · closes {formatDateTime(t.closesAt)}
                {t.receipt ? ` · receipt ${t.receipt}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
