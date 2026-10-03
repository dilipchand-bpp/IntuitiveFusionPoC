import { EmptyState } from '@if/ui';
import { UsersPanel, type AdminUser, type OrgUnit } from '@/components/admin/users-panel';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Users & roles – Intuitive Fusion' };

export default async function UsersPage() {
  const [me, users, units] = await Promise.all([
    getSessionUser(),
    apiGet<AdminUser[]>('/admin/users'),
    apiGet<OrgUnit[]>('/admin/org-units'),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Users and roles</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Add people and choose their roles. Administrators cannot read bid content, and the administrator
          role cannot be combined with another. Supplier contacts are managed by procurement on the supplier
          profile.
        </p>
      </header>
      {!me || !users || !units ? (
        <EmptyState title="Users are unavailable" body="Please refresh the page." />
      ) : (
        <UsersPanel initial={users} units={units} csrf={me.csrfToken} meId={me.id} />
      )}
    </div>
  );
}
