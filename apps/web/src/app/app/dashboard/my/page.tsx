import Link from 'next/link';
import { EmptyState, PageHeader } from '@if/ui';
import { MyDashboard } from '@/components/b9/my-dashboard';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'My dashboard – Intuitive Fusion' };

export default async function MyDashboardPage() {
  const user = await getSessionUser();
  if (!user) {
    return <EmptyState title="Sign in required" body="Please sign in to personalise your dashboard." />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="My dashboard"
        subtitle={
          <>
            Choose the widgets you want, how big each is and how it is drawn.{' '}
            <Link href="/app/dashboard">Back to the dashboard</Link>
          </>
        }
      />
      <MyDashboard csrf={user.csrfToken} roles={user.roles} />
    </div>
  );
}
