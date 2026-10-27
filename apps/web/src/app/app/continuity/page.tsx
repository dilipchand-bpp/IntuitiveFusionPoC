import { PageHeader } from '@if/ui';
import { ContinuityPage } from '@/components/b10/continuity';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Continuity alerts' };

export default async function Page() {
  const user = await getSessionUser();
  const raise = Boolean(user?.roles.some((r) => ['PROCUREMENT', 'CONTRACT_MGR', 'EXEC'].includes(r)));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Continuity alerts"
        subtitle="Raise an event, reach the people it affects by SMS and email (simulated gateways), and see who is safe, affected, needs help or has not answered."
      />
      <ContinuityPage csrf={user!.csrfToken} canRaise={raise} />
    </div>
  );
}
