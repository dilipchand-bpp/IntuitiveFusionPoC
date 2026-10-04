import Link from 'next/link';
import { notFound } from 'next/navigation';
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
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/supplier/contracts">← Contracts</Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">
        <span className="font-mono text-lg text-text-muted">{res.data.number}</span>{' '}
        {res.data.title ?? 'Contract'}
      </h1>
      <SupplierContractView initial={res.data} csrf={user.csrfToken} />
    </div>
  );
}
