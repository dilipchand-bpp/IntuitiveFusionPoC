import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DraftPanel } from '@/components/requests/draft-panel';
import { RequestActions } from '@/components/requests/request-actions';
import type { RequestView } from '@/components/requests/types';
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
      <header>
        <p className="text-sm">
          <Link href="/app/requests">← Requests</Link>
        </p>
        <h1 className="mt-1 text-3xl font-bold">{view.title}</h1>
        {view.status !== 'DRAFT' && (
          <p className="mt-2">
            <Link href={`/app/plans/${view.id}`}>Open the procurement plan →</Link>
          </p>
        )}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 rounded-md border border-border bg-surface p-4">
          <DraftPanel view={view} />
        </div>
        <div className="min-w-0">
          <RequestActions view={view} csrf={user.csrfToken} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}
