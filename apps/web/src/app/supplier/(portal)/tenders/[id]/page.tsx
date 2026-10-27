import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '@if/ui';
import { SupplierTender } from '@/components/supplier/supplier-tender';
import type { SupplierTenderView } from '@/components/tender/types';
import { apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Tender – Intuitive Fusion' };

export default async function SupplierTenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, res] = await Promise.all([
    getSessionUser(),
    apiGetResult<SupplierTenderView>(`/supplier/tenders/${id}`),
  ]);
  if (!user || res.status === 404 || res.status === 403) notFound(); // not invited = not there
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm">
        <Link href="/supplier">← My tenders</Link>
      </p>
      {res.data ? (
        <>
          <PageHeader eyebrow={<span className="font-mono">{res.data.number}</span>} title={res.data.title} />
          <SupplierTender initial={res.data} csrf={user.csrfToken} />
        </>
      ) : (
        <EmptyState title="The tender could not be loaded" body="Please refresh the page." />
      )}
    </div>
  );
}
