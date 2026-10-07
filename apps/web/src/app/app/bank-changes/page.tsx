import { BankChangesPanel } from '@/components/b11/bank-changes';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Bank detail changes – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Bank detail changes</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Supplier bank details are visible to finance only. A change waits for a finance confirmation before
          it takes effect.
        </p>
      </header>
      <BankChangesPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
