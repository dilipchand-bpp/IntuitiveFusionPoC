import { PageHeader } from '@if/ui';
import { ConnectorsPage } from '@/components/b10/connectors';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Connectors' };

export default async function Page() {
  const user = await getSessionUser();
  const has = (...r: string[]) => Boolean(user?.roles.some((x) => r.includes(x)));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Connectors"
        subtitle={
          <>
            The systems this platform connects to: whether each is healthy, the secrets that sign the
            messages, what has been delivered, and the work to do by hand while a system is down.{' '}
            {has('ADMIN') ? '' : ' Only an administrator can change a connector or a secret.'}
          </>
        }
      />
      <ConnectorsPage
        csrf={user!.csrfToken}
        roles={{
          admin: has('ADMIN'),
          operate: has('ADMIN', 'PROCUREMENT'),
          sync: has('ADMIN', 'PROCUREMENT', 'FINANCE'),
          work: has('ADMIN', 'PROCUREMENT', 'FINANCE', 'LEGAL'),
          events: has('ADMIN', 'PROCUREMENT', 'LEGAL'),
          evidence: has('ADMIN', 'PROCUREMENT', 'EXEC'),
        }}
      />
    </div>
  );
}
