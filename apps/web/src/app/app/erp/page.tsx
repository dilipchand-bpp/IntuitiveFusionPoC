import { PageHeader } from '@if/ui';
import { ErpPanel } from '@/components/b10/erp';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'ERP data – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  const has = (...r: string[]) => Boolean(user?.roles.some((x) => r.includes(x)));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="ERP data"
        subtitle={
          <>
            Budgets, cost centres, organisation units and the ledger imported from the finance system, and the
            result of each import.{' '}
            {has('ADMIN', 'FINANCE') ? '' : ' Only an administrator or finance can run the sync.'}
          </>
        }
      />
      <ErpPanel
        csrf={user!.csrfToken}
        canRun={has('ADMIN', 'FINANCE')}
        canCheck={has('PROCUREMENT', 'FINANCE', 'EXEC')}
      />
    </div>
  );
}
