import { IncidentsPanel } from '@/components/b11/incidents';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Data breach incidents – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Data breach incidents</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Report a suspected breach straight away. Managers assess whether serious harm is likely, work the
          containment checklist, draft notices to the regulator and the people affected, and close the
          incident with what was learned. The assessment is decision support, not legal advice.
        </p>
      </header>
      <IncidentsPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
