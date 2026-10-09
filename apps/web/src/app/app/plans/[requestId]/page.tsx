import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@if/ui';
import { DocumentTools } from '@/components/collab/doc-tools';
import { ContentHintsCard } from '@/components/b11/content-hints-card';
import { DraftPanel } from '@/components/copilot/draft-panel';
import { EsgCard, type EsgData } from '@/components/plan/esg-card';
import { EsgTargetsCard } from '@/components/plan/esg-targets-card';
import { PlanWorkspace } from '@/components/plan/plan-workspace';
import type { PlanView } from '@/components/plan/types';
import { apiGet, apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Procurement plan – Intuitive Fusion' };

export default async function PlanPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) notFound();
  const [user, res] = await Promise.all([
    getSessionUser(),
    apiGetResult<PlanView>(`/requests/${requestId}/plan`),
  ]);
  if (!user) notFound();
  if (res.status === 404 || res.status === 403) notFound(); // not visible = not there
  const esg = res.data ? await apiGet<EsgData>(`/plans/${res.data.id}/esg`) : null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/app/plans">← Procurement plans</Link>
      </p>
      {res.data ? (
        <>
          <h1 className="text-3xl font-bold">
            <span className="font-mono text-lg text-text-muted">{res.data.requestNumber}</span>{' '}
            {res.data.title}
          </h1>
          <PlanWorkspace plan={res.data} csrf={user.csrfToken} userId={user.id} />
          <DocumentTools type="plan" id={res.data.id} csrf={user.csrfToken} />
          {esg && (
            <EsgCard
              planId={res.data.id}
              initial={esg}
              csrf={user.csrfToken}
              canEdit={user.roles.includes('PROCUREMENT') || user.roles.includes('REQUESTER')}
            />
          )}
          <EsgTargetsCard planId={res.data.id} csrf={user.csrfToken} />
          <ContentHintsCard requestId={requestId} />
          {user.roles.some((r) => r === 'PROCUREMENT' || r === 'REQUESTER') && (
            <DraftPanel
              csrf={user.csrfToken}
              kinds={['PLAN']}
              procurementId={requestId}
              heading="Draft plan sections with AI"
              idPrefix="aidraft"
            />
          )}
        </>
      ) : res.code === 'REQUEST_NOT_SUBMITTED' ? (
        <EmptyState
          title="This request has not been submitted yet"
          body="The plan is created once the request is submitted."
          action={<Link href={`/app/requests/${requestId}`}>Back to the request</Link>}
        />
      ) : (
        <EmptyState
          title="The plan could not be loaded"
          body="Please refresh the page; if the problem continues, contact support."
        />
      )}
    </div>
  );
}
