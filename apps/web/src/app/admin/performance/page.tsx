import { PerformancePanel } from '@/components/b10/performance';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Performance – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Performance</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          How quickly the budget check answers inside the intake conversation, measured on this system.
        </p>
      </header>
      <PerformancePanel csrf={user!.csrfToken} />
    </div>
  );
}
