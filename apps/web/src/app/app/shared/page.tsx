import { EmptyState } from '@if/ui';
import { SharedProjects, type Project } from '@/components/shared/shared-projects';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Shared documents – Intuitive Fusion' };

export default async function SharedPage() {
  const user = await getSessionUser();
  const admin = user?.roles.some((r) => r === 'PROCUREMENT' || r === 'ADMIN') ?? false;
  const [mine, grants, candidates] = await Promise.all([
    apiGet<{ projects: Project[] }>('/shared/projects'),
    admin ? apiGet<{ grants: never[] }>('/access-grants') : Promise.resolve(null),
    admin ? apiGet<{ users: never[]; tenders: never[] }>('/access-grants/candidates') : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Shared documents</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Time-bound access to one project&apos;s documents, for committee members, auditors and advisors.
          Access ends on its own at the date or event it was given for.
        </p>
      </header>
      {!mine || !user ? (
        <EmptyState title="Shared documents are unavailable" body="Please refresh the page." />
      ) : (
        <SharedProjects
          initial={mine.projects}
          grants={grants?.grants ?? null}
          candidates={candidates}
          csrf={user.csrfToken}
        />
      )}
    </div>
  );
}
