import { ResidencyPanel } from '@/components/b11/residency';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Residency and egress – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Residency and egress</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          The customer elects a hosting country, and it is enforced on every path that leaves the application:
          connectors, AI models, outside search, email and SMS, the repository, e-signature and log exports.
          Only approved hosts can be called, and no public AI endpoint is reachable.
        </p>
      </header>
      <ResidencyPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
