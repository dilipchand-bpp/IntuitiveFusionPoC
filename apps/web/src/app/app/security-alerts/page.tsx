import { PageHeader } from '@if/ui';
import { SecurityAlertsPanel } from '@/components/b11/security-alerts';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Security alerts – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Security alerts"
        subtitle={
          <>
            Unusual access and configuration drift, routed to the security owner. Acknowledge, close with a
            note, or end a person's sessions. Nothing is locked automatically.
          </>
        }
      />
      <SecurityAlertsPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
