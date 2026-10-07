import { AccessPoliciesPanel } from '@/components/b11/access-policies';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Access policies – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Access policies</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Rules that override the default hierarchy: explicit denials, named grants with an expiry, and a
          simulator that shows what a person can see and why.
        </p>
      </header>
      <AccessPoliciesPanel csrf={user!.csrfToken} />
    </div>
  );
}
