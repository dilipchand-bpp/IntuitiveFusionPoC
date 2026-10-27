import { PageHeader } from '@if/ui';
import { CompliancePanel } from '@/components/b11/compliance';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Configuration compliance – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Configuration compliance"
        subtitle="Checks of how this organisation is configured, each with guidance and, where one setting is the fix, a one-click change for an administrator."
      />
      <CompliancePanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
