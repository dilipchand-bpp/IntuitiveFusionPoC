import { PageHeader } from '@if/ui';
import { PrivacyPanel } from '@/components/b11/privacy';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Privacy – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Privacy"
        subtitle="How your contact details are handled, and how to ask to see or correct them."
      />
      <PrivacyPanel csrf={user!.csrfToken} context="PRIVACY_PAGE" />
    </div>
  );
}
