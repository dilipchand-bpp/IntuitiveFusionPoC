import { SecurityAlertsPanel } from '@/components/b11/security-alerts';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Security alerts – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Security alerts</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Unusual access and configuration drift, routed to the security owner. Acknowledge, close with a
          note, or end a person's sessions. Nothing is locked automatically.
        </p>
      </header>
      <SecurityAlertsPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
