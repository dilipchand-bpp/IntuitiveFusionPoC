import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button } from '@if/ui';
import { DraftPanel } from '@/components/requests/draft-panel';
import { RequestActions } from '@/components/requests/request-actions';
import type { RequestView } from '@/components/requests/types';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Request – Intuitive Fusion' };

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, view] = await Promise.all([
    getSessionUser(),
    apiGet<RequestView & { requesterId: string }>(`/requests/${id}`),
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
        <div className="min-w-0">
          <RequestActions view={view} csrf={user.csrfToken} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}
