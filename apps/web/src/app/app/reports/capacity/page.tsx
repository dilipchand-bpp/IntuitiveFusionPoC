import Link from 'next/link';
import { CapacityView } from '@/components/reports/b6-reports';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Workload and capacity – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Workload and capacity</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Active procurements and dollar exposure for each procurement manager, against how many one person
          can carry.
        </p>
      </header>
      <CapacityView csrf={user!.csrfToken} canAssign />
    </div>
  );
}
