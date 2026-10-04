import { EmptyState } from '@if/ui';
import { MfaPanel, type MfaStatus } from '@/components/security/mfa-panel';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Security – Intuitive Fusion' };

export default async function SecurityPage() {
  const [me, status] = await Promise.all([getSessionUser(), apiGet<MfaStatus>('/auth/mfa')]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Security</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          How you prove it is you. An authenticator app adds a second step at sign-in.
        </p>
      </header>
      {!me || !status ? (
        <EmptyState title="Security settings are unavailable" body="Please refresh the page." />
      ) : (
        <MfaPanel status={status} csrf={me.csrfToken} />
      )}
    </div>
  );
}
