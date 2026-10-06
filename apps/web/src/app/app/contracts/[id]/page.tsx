import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@if/ui';
import { ContractWorkspace } from '@/components/contract/contract-workspace';
import type { ContractView } from '@/components/contract/types';
import { apiGet, apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Contract – Intuitive Fusion' };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, res, layout] = await Promise.all([
    getSessionUser(),
    apiGetResult<ContractView>(`/contracts/${id}`),
    apiGet<{ keys: string[] }>('/layouts/CONTRACT/applied'),
  ]);
  if (!user || res.status === 404 || res.status === 403) notFound();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      {res.data ? (
        <ContractWorkspace
          initial={res.data}
          csrf={user.csrfToken}
          roles={user.roles}
          layout={layout?.keys}
        />
      ) : (
        <EmptyState title="The contract could not be loaded" body="Please refresh the page." />
      )}
    </div>
  );
}
