import { Envelopes } from '@/components/contract/b5-pages';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@if/ui';

export const metadata = { title: 'Funding envelopes – Intuitive Fusion' };

export default async function EnvelopesPage() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Funding envelopes"
        subtitle={
          <>
            A delegate approves an allocated amount once. The people they nominate approve individual
            commitments against it, and the delegate is told to approve more as it nears exhaustion.
          </>
        }
      />
      <Envelopes csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
