import { PageHeader } from '@if/ui';
import Link from 'next/link';
import { DeletedContracts } from '@/components/contract/deleted-contracts';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Deleted contracts – Intuitive Fusion' };

export default async function DeletedPage() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <PageHeader
        title="Deleted contracts"
        subtitle={
          <>
            A signed contract is kept for good. Taking it out of view only hides it; it, its signatures and
            its whole history stay, and Legal or an executive can bring it back.
          </>
        }
      />
      <DeletedContracts
        csrf={user!.csrfToken}
        canRestore={user!.roles.some((r) => r === 'LEGAL' || r === 'EXEC')}
      />
    </div>
  );
}
