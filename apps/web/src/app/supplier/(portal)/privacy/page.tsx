import { PrivacyPanel } from '@/components/b11/privacy';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Privacy – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Privacy</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          How your contact details are handled, and how to ask to see or correct them.
        </p>
      </header>
      <PrivacyPanel csrf={user!.csrfToken} context="PRIVACY_PAGE" />
    </div>
  );
}
