import { RestrictedPanel } from '@/components/b11/restricted-panel';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@if/ui';

export const metadata = { title: 'Restricted projects – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Restricted projects"
        subtitle={
          <>
            A restricted project is invisible outside its sourcing group. Its plan text, report narrative and
            documents are encrypted with a per-project key.
          </>
        }
      />
      <RestrictedPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
