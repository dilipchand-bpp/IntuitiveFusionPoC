import { RestrictedPanel } from '@/components/b11/restricted-panel';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Restricted projects – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Restricted projects</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          A restricted project is invisible outside its sourcing group. Its plan text, report narrative and
          documents are encrypted with a per-project key.
        </p>
      </header>
      <RestrictedPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
