import { CurrencyAdmin } from '@/components/b9/currency';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Currencies' };

export default async function Page() {
  const user = await getSessionUser();
  const canEdit = Boolean(user?.roles.some((r) => r === 'ADMIN' || r === 'FINANCE'));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Currencies</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          The exchange rates used to turn a foreign amount into Australian dollars, so every total, budget and
          approval limit uses the same figure.
        </p>
      </header>
      <CurrencyAdmin csrf={user!.csrfToken} canEdit={canEdit} />
    </div>
  );
}
