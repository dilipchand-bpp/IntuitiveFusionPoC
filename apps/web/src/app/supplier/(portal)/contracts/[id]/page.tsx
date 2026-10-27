import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@if/ui';
import { SupplierContractView, type SupplierContract } from '@/components/supplier/supplier-contract';
import { apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Contract – Intuitive Fusion' };

export default async function SupplierContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, res] = await Promise.all([
    getSessionUser(),
    apiGetResult<SupplierContract>(`/supplier/contracts/${id}`),
  ]);
  if (!user || !res.data) notFound();
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm">
        <Link href="/supplier/contracts">← Contracts</Link>
      </p>
      <PageHeader
        eyebrow={<span className="font-mono">{res.data.number}</span>}
        title={res.data.title ?? 'Contract'}
      />
      <SupplierContractView initial={res.data} csrf={user.csrfToken} />
    </div>
  );
}
