import { ContinuityPage } from '@/components/b10/continuity';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Continuity alerts' };

export default async function Page() {
  const user = await getSessionUser();
  const raise = Boolean(user?.roles.some((r) => ['PROCUREMENT', 'CONTRACT_MGR', 'EXEC'].includes(r)));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Continuity alerts</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Raise an event, reach the people it affects by SMS and email (simulated gateways), and see who is
          safe, affected, needs help or has not answered.
        </p>
      </header>
      <ContinuityPage csrf={user!.csrfToken} canRaise={raise} />
    </div>
  );
}
