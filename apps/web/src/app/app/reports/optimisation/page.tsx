import Link from 'next/link';
import { PageHeader } from '@if/ui';
import { OptimisationView } from '@/components/b9/spend-views';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Spend optimisation – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-12">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <PageHeader
        title="Spend optimisation"
        subtitle="Where money could be saved, with the evidence behind each idea. Savings are estimates from a rules-simulated model."
      />
      <OptimisationView csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
