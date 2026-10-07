import { AuditChainPanel } from '@/components/b11/audit-chain';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Audit chain – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Audit chain</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Check that the record of administrative actions has not been altered. Probity, executives and
          administrators can all run the check.
        </p>
      </header>
      <AuditChainPanel csrf={user!.csrfToken} />
    </div>
  );
}
