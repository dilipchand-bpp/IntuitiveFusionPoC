import { PageHeader } from '@if/ui';
import { PrivacyPanel } from '@/components/b11/privacy';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Privacy – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Privacy"
        subtitle="See how your personal information is handled, and ask to see it or correct it. Requests are answered within the time the organisation has set, and every step is recorded."
      />
      <PrivacyPanel csrf={user!.csrfToken} context="PRIVACY_PAGE" />
    </div>
  );
}
