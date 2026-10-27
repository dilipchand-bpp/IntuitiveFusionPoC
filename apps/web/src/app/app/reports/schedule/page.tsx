import { ScheduleGantt } from '@/components/reports/b6-reports';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Schedule – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Procurement schedule"
        subtitle="Every active procurement by phase. Drag a phase to move it and everything after it; the delegate calendar is worked out again and delegates are told."
      />
      <ScheduleGantt csrf={user!.csrfToken} />
    </div>
  );
}
