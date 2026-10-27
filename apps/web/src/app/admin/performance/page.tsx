import { PerformancePanel } from '@/components/b10/performance';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Performance – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Performance"
        subtitle="How quickly the budget check answers inside the intake conversation, measured on this system."
      />
      <PerformancePanel csrf={user!.csrfToken} />
    </div>
  );
}
