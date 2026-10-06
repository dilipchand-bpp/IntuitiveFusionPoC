import { RepositoryPage } from '@/components/b10/repository';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Document repository' };

export default async function Page() {
  const user = await getSessionUser();
  const has = (...r: string[]) => Boolean(user?.roles.some((x) => r.includes(x)));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Document repository</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Read and write the project sites in the enterprise document repository, with every version kept.
        </p>
      </header>
      <RepositoryPage
        csrf={user!.csrfToken}
        canWrite={has('REQUESTER', 'PROCUREMENT', 'LEGAL', 'CONTRACT_MGR')}
        canPublish={has('PROCUREMENT', 'LEGAL', 'CONTRACT_MGR')}
      />
    </div>
  );
}
