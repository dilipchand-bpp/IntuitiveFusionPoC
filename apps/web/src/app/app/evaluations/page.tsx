import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th, type BadgeTone } from '@if/ui';
import { OpenEvaluation } from '@/components/evaluation/open-evaluation';
import type { EvalSummary, ReadyTender } from '@/components/evaluation/types';
import { TENDER_TYPE_LABEL, formatDateTime } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Evaluations – Intuitive Fusion' };

const STATUS: Record<string, [string, BadgeTone]> = {
  COI_PENDING: ['Declaring conflicts', 'warning'],
  SCORING: ['Scoring', 'info'],
  CONSENSUS: ['Consensus', 'info'],
  LOCKED: ['Locked', 'neutral'],
  REPORTED: ['Report awaiting approval', 'warning'],
  APPROVED: ['Approved', 'success'],
};

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ conflict?: string }>;
}) {
  const { conflict } = await searchParams;
  const [user, data] = await Promise.all([
    getSessionUser(),
    apiGet<{ evaluations: EvalSummary[]; ready: ReadyTender[] }>('/evaluations'),
  ]);
  const mine = (e: EvalSummary) =>
    e.myCoiState === 'NOT_DECLARED'
      ? 'Declare your conflicts of interest'
      : e.myCoiState === 'DECLARED_NONE' && e.myScoringComplete === false && e.status === 'SCORING'
        ? 'Your scores are due'
        : '';
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Evaluations</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Panel members declare conflicts first, score independently without seeing each other&apos;s scores,
          and the chair brings the scores together, with differences recorded, before the report is written.
        </p>
      </header>

      {conflict === '1' && (
        <p
          role="status"
          className="rounded-md border border-warning bg-warning-bg p-3 text-sm font-medium text-warning"
          data-testid="conflict-notice"
        >
          Your conflict of interest was recorded and your access to that evaluation is suspended. A delegate
          will decide, and you will be notified of the outcome.
        </p>
      )}

      {(data?.ready ?? []).length > 0 && (
        <section aria-labelledby="ready-h" className="flex flex-col gap-3">
          <h2 id="ready-h" className="font-heading text-xl font-bold">
            Closed tenders ready to evaluate
          </h2>
          <ul className="grid gap-3" aria-label="Closed tenders without an evaluation">
            {data!.ready.map((t) => (
              <li
                key={t.tenderId}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center"
                data-testid="ready-tender"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-text-muted">{t.requestNumber}</p>
                  <p className="font-heading text-lg font-semibold">{t.title}</p>
                  <p className="text-sm text-text-muted">
                    {TENDER_TYPE_LABEL[t.type] ?? t.type} · {t.bids} bid(s) received
                  </p>
                </div>
                {t.evaluable && t.bids > 0 ? (
                  <OpenEvaluation tenderId={t.tenderId} title={t.title} csrf={user!.csrfToken} />
                ) : (
                  <Badge tone="neutral">
                    {t.bids === 0 ? 'No bids to evaluate' : 'Not scored for award'}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-h" className="flex flex-col gap-3">
        <h2 id="all-h" className="font-heading text-xl font-bold">
          {user?.roles.includes('EVALUATOR') || user?.roles.includes('CHAIR')
            ? 'Your evaluations'
            : 'All evaluations'}
        </h2>
        {!data ? (
          <EmptyState
            title="Evaluations unavailable"
            body="The list could not be loaded. Please refresh the page."
          />
        ) : data.evaluations.length === 0 ? (
          <EmptyState
            title="No evaluations yet"
            body="When a tender closes and a panel is chosen, the evaluation appears here."
          />
        ) : (
          <Table caption="Evaluations">
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Title</Th>
                <Th>Stage</Th>
                <Th className="text-right">Bids</Th>
                <Th className="text-right">Panel</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {data.evaluations.map((e) => (
                <tr key={e.id}>
                  <Td label="Request" className="whitespace-nowrap font-mono text-xs">
                    {e.requestNumber}
                  </Td>
                  <Td label="Title">
                    <Link href={`/app/evaluations/${e.id}`}>{e.title}</Link>
                    {mine(e) && <span className="ml-2 text-xs font-semibold text-warning">{mine(e)}</span>}
                  </Td>
                  <Td label="Stage">
                    <Badge tone={STATUS[e.status]?.[1] ?? 'neutral'}>
                      {STATUS[e.status]?.[0] ?? e.status}
                    </Badge>
                  </Td>
                  <Td label="Bids" className="text-right">
                    {e.bids}
                  </Td>
                  <Td label="Panel" className="text-right">
                    {e.panelSize}
                  </Td>
                  <Td label="Updated" className="whitespace-nowrap">
                    {formatDateTime(e.updatedAt)}
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
