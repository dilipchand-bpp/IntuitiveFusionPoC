import { PrivacyManagePanel } from '@/components/b11/privacy';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Privacy requests – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Privacy requests</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Access and correction requests with their due dates, calls logged for someone without an account,
          how long AI conversations are kept and which records are on legal hold.
        </p>
      </header>
      <PrivacyManagePanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
