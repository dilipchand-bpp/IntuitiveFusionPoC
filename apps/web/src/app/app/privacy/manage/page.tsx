import { PageHeader } from '@if/ui';
import { PrivacyManagePanel } from '@/components/b11/privacy';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Privacy requests – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Privacy requests"
        subtitle="Access and correction requests with their due dates, calls logged for someone without an account, how long AI conversations are kept and which records are on legal hold."
      />
      <PrivacyManagePanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
