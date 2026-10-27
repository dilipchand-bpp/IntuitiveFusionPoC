import Link from 'next/link';
import { PageHeader } from '@if/ui';
import { CapacityView } from '@/components/reports/b6-reports';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Workload and capacity – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-12">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <PageHeader
        title="Workload and capacity"
        subtitle="Active procurements and dollar exposure for each procurement manager, against how many one person can carry."
      />
      <CapacityView csrf={user!.csrfToken} canAssign />
    </div>
  );
}
