import { AuditPackPanel } from '@/components/b11/audit-pack';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Auditor evidence pack – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Auditor evidence pack"
        subtitle="Make a signed pack of probity and audit history for an external auditor, see what an auditor would look for on one procurement, and check any pack for tampering."
      />
      <AuditPackPanel csrf={user!.csrfToken} />
    </div>
  );
}
