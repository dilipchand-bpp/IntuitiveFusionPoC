import { AuditPackPanel } from '@/components/b11/audit-pack';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Auditor evidence pack – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Auditor evidence pack</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Make a signed pack of probity and audit history for an external auditor, see what an auditor would
          look for on one procurement, and check any pack for tampering.
        </p>
      </header>
      <AuditPackPanel csrf={user!.csrfToken} />
    </div>
  );
}
