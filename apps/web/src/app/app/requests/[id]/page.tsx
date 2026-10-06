import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button } from '@if/ui';
import { InstructBox, RiskAssessmentPanel } from '@/components/collab/ai-panels';
import { DraftPanel } from '@/components/requests/draft-panel';
import { LessonsPanel } from '@/components/requests/lessons';
import { RequestActions } from '@/components/requests/request-actions';
import { RequestExtras, type ExtendedView, type ExtrasData } from '@/components/requests/extras';
import type { RequestView } from '@/components/requests/types';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Request – Intuitive Fusion' };

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, view, suppliers, ecv, artefacts, delegates, variations] = await Promise.all([
    getSessionUser(),
    apiGet<ExtendedView & RequestView & { requesterId: string }>(`/requests/${id}`),
    apiGet<ExtrasData['suppliers']>(`/requests/${id}/suggested-suppliers`),
    apiGet<ExtrasData['ecv']>(`/requests/${id}/ecv`),
    apiGet<ExtrasData['artefacts']>(`/requests/${id}/artefacts`),
    apiGet<ExtrasData['delegates']>(`/requests/${id}/delegates`),
    apiGet<ExtrasData['variations']>(`/requests/${id}/process-variations`),
  ]);
  if (!user || !view) notFound(); // a request you cannot see looks exactly like one that does not exist
  const canEdit =
    user.roles.includes('PROCUREMENT') || (user.roles.includes('REQUESTER') && view.requesterId === user.id);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm">
          <Link href="/app/requests">← Requests</Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md bg-surface-alt px-2 py-1 font-mono text-sm font-semibold text-text-muted">
            {view.number}
          </span>
          <Badge tone={STATUS_TONE[view.status] ?? 'neutral'}>
            {STATUS_LABEL[view.status] ?? view.status}
          </Badge>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{view.title}</h1>
        {view.status !== 'DRAFT' && (
          <div>
            <Button asChild variant="secondary">
              <Link href={`/app/plans/${view.id}`} className="text-text no-underline">
                Open the procurement plan
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        )}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <DraftPanel view={view} hideHeader />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <RequestActions view={view} csrf={user.csrfToken} canEdit={canEdit} />
          {view.status !== 'DRAFT' && canEdit && (
            <InstructBox
              testId="advance-box"
              title="Move this procurement on"
              label="Say where it should go"
              hint='For example "go to the next phase" or "move to tender". It moves only when the work before it is finished.'
              path={`/requests/${view.id}/advance`}
              csrf={user.csrfToken}
              button="Move on"
            />
          )}
          {view.status !== 'DRAFT' && (
            <RiskAssessmentPanel requestId={view.id} csrf={user.csrfToken} canEdit={canEdit} />
          )}
          {view.status !== 'DRAFT' && (
            <LessonsPanel
              requestId={view.id}
              phase={view.phase}
              csrf={user.csrfToken}
              canClose={user.roles.some((r) => r === 'PROCUREMENT' || r === 'EXEC')}
            />
          )}
          {suppliers && ecv && artefacts && delegates && variations && (
            <RequestExtras
              view={view}
              data={{ suppliers, ecv, artefacts, delegates, variations }}
              csrf={user.csrfToken}
              canEdit={canEdit}
              isDelegate={user.roles.includes('DELEGATE') || user.roles.includes('EXEC')}
              canRedirect={user.roles.includes('PROCUREMENT')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
