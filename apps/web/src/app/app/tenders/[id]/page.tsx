import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@if/ui';
import type { TenderView } from '@/components/tender/types';
import { TenderWorkspace } from '@/components/tender/tender-workspace';
import { apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Tender – Intuitive Fusion' };

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, res] = await Promise.all([getSessionUser(), apiGetResult<TenderView>(`/tenders/${id}`)]);
  if (!user || res.status === 404 || res.status === 403) notFound();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/app/tenders">← Tenders</Link>
      </p>
      {res.data ? (
        <>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="font-mono text-lg text-text-muted">{res.data.requestNumber}</span>{' '}
            {res.data.title}
          </h1>
          <TenderWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />
        </>
      ) : (
        <EmptyState
          title="The tender could not be loaded"
          body="Please refresh the page; if the problem continues, contact support."
        />
      )}
    </div>
  );
}
