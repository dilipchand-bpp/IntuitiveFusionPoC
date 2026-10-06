import Link from 'next/link';
import { OptimisationView } from '@/components/b9/spend-views';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Spend optimisation – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Spend optimisation</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Where money could be saved, with the evidence behind each idea. Savings are estimates from a
          rules-simulated model.
        </p>
      </header>
      <OptimisationView csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
