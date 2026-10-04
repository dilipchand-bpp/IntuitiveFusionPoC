import { Envelopes } from '@/components/contract/b5-pages';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Funding envelopes – Intuitive Fusion' };

export default async function EnvelopesPage() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Funding envelopes</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          A delegate approves an allocated amount once. The people they nominate approve individual
          commitments against it, and the delegate is told to approve more as it nears exhaustion.
        </p>
      </header>
      <Envelopes csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
