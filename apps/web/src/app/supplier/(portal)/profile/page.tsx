import { EmptyState } from '@if/ui';
import { SupplierProfile, type SupplierSelfProfile } from '@/components/supplier/supplier-profile';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Company profile – Intuitive Fusion' };

export default async function SupplierProfilePage() {
  const [me, profile] = await Promise.all([
    getSessionUser(),
    apiGet<SupplierSelfProfile>('/supplier/profile'),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Company profile</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Your screening and insurance status, your privacy choices, and the people who can sign in for your
          company.
        </p>
      </header>
      {!me || !profile ? (
        <EmptyState title="Your profile is unavailable" body="Please refresh the page." />
      ) : (
        <SupplierProfile initial={profile} csrf={me.csrfToken} meId={me.id} />
      )}
    </div>
  );
}
