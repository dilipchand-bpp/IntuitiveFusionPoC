import { ScheduleGantt } from '@/components/reports/b6-reports';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Schedule – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Procurement schedule</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Every active procurement by phase. Drag a phase to move it and everything after it; the delegate
          calendar is worked out again and delegates are told.
        </p>
      </header>
      <ScheduleGantt csrf={user!.csrfToken} />
    </div>
  );
}
