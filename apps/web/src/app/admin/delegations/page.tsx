import { EmptyState, PageHeader } from '@if/ui';
import {
  AlertSettingsForm,
  DelegationsPanel,
  type AlertSettings,
  type DelegationRow,
  type StaffUser,
} from '@/components/admin/delegations-panel';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Delegations – Intuitive Fusion' };

export default async function DelegationsPage() {
  const [user, delegations, users, settings] = await Promise.all([
    getSessionUser(),
    apiGet<DelegationRow[]>('/admin/delegations'),
    apiGet<StaffUser[]>('/admin/users'),
    apiGet<AlertSettings>('/admin/alert-settings'),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Delegations and alert timing"
        subtitle="Who may approve and sign up to what value, and how early contract alerts go out. Every change is audited and takes effect immediately. Administrators cannot read bid content."
      />
      {!delegations || !users || !user ? (
        <EmptyState title="Delegations are unavailable" body="Please refresh the page." />
      ) : (
        <DelegationsPanel initial={delegations} users={users} csrf={user.csrfToken} />
      )}
      {settings && user && <AlertSettingsForm initial={settings} csrf={user.csrfToken} />}
    </div>
  );
}
