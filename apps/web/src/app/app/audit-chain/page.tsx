import { AuditChainPanel } from '@/components/b11/audit-chain';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Audit chain – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Audit chain"
        subtitle="Check that the record of administrative actions has not been altered. Probity, executives and administrators can all run the check."
      />
      <AuditChainPanel csrf={user!.csrfToken} />
    </div>
  );
}
