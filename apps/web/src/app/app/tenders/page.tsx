import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th } from '@if/ui';
import { CreateTenderForm } from '@/components/tender/create-tender-form';
import type { TenderSummary } from '@/components/tender/types';
import {
  TENDER_STATUS_LABEL,
  TENDER_STATUS_TONE,
  TENDER_TYPE_LABEL,
  aud,
  formatDateTime,
} from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Tenders – Intuitive Fusion' };

interface PlanRow {
  requestId: string;
  requestNumber: string;
  title: string;
  estimatedValue: number;
  status: string;
}

export default async function TendersPage() {
  const user = await getSessionUser();
  const [tenders, plans] = await Promise.all([
    apiGet<TenderSummary[]>('/tenders'),
    user?.roles.includes('PROCUREMENT')
      ? apiGet<PlanRow[]>('/plans?status=APPROVED_LOCKED')
      : Promise.resolve([] as PlanRow[]),
  ]);
  const have = new Set((tenders ?? []).map((t) => t.requestId));
  const ready = (plans ?? []).filter((p) => !have.has(p.requestId));
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Tenders</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Build the tender pack from an approved plan, keep it staged until a delegate gives permission, then
          publish, answer supplier questions and watch bids arrive sealed until close.
        </p>
      </header>

      {ready.length > 0 && (
        <section aria-labelledby="ready-h" className="flex flex-col gap-3">
          <h2 id="ready-h" className="font-heading text-xl font-bold">
            Ready for a tender pack
          </h2>
          <ul className="grid gap-3" aria-label="Approved plans without a tender">
            {ready.map((p) => (
              <li
                key={p.requestId}
                className="rounded-lg border border-border bg-surface p-4 shadow-sm"
                data-testid="ready-plan"
              >
                <p className="font-mono text-xs text-text-muted">{p.requestNumber}</p>
                <p className="font-heading text-lg font-semibold">{p.title}</p>
                <p className="mb-3 text-sm text-text-muted">
                  {aud.format(p.estimatedValue)} · plan approved and locked
                </p>
                <CreateTenderForm requestId={p.requestId} title={p.title} csrf={user!.csrfToken} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-h" className="flex flex-col gap-3">
        <h2 id="all-h" className="font-heading text-xl font-bold">
          All tenders
        </h2>
        {!tenders ? (
          <EmptyState
            title="Tenders unavailable"
            body="The list could not be loaded. Please refresh the page."
          />
        ) : tenders.length === 0 ? (
          <EmptyState
            title="No tenders yet"
            body={
              user?.roles.includes('PROCUREMENT')
                ? 'When a plan is approved, create its tender pack here.'
                : 'Tenders appear here once procurement creates them.'
            }
          />
        ) : (
          <Table caption="Tenders">
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Title</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Closes</Th>
                <Th className="text-right">Bids</Th>
              </tr>
            </thead>
            <tbody>
              {tenders.map((t) => (
                <tr key={t.id}>
                  <Td label="Request" className="whitespace-nowrap font-mono text-xs">
                    {t.requestNumber}
                  </Td>
                  <Td label="Title">
                    <Link href={`/app/tenders/${t.id}`} className="underline">
                      {t.title}
                    </Link>
                    {t.status === 'STAGED' && !t.permissionGranted && (
                      <span className="ml-2 text-xs text-text-muted">awaiting permission</span>
                    )}
                    {t.openQuestions > 0 && (
                      <span className="ml-2 text-xs font-semibold text-warning">
                        {t.openQuestions} question(s)
                      </span>
                    )}
                  </Td>
                  <Td label="Type">{TENDER_TYPE_LABEL[t.type] ?? t.type}</Td>
                  <Td label="Status">
                    <Badge tone={TENDER_STATUS_TONE[t.status] ?? 'neutral'}>
                      {TENDER_STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </Td>
                  <Td label="Closes" className="whitespace-nowrap">
                    {formatDateTime(t.closesAt)}
                  </Td>
                  <Td label="Bids" className="text-right">
                    {t.bids}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
