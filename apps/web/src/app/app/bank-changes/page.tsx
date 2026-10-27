import { PageHeader } from '@if/ui';
import { BankChangesPanel } from '@/components/b11/bank-changes';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Bank detail changes – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Bank detail changes"
        subtitle={
          <>
            Supplier bank details are visible to finance only. A change waits for a finance confirmation
            before it takes effect.
          </>
        }
      />
      <BankChangesPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
