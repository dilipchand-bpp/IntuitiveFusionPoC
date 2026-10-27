import { AccessPoliciesPanel } from '@/components/b11/access-policies';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Access policies – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Access policies"
        subtitle="Rules that override the default hierarchy: explicit denials, named grants with an expiry, and a simulator that shows what a person can see and why."
      />
      <AccessPoliciesPanel csrf={user!.csrfToken} />
    </div>
  );
}
