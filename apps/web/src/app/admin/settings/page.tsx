import { EmptyState } from '@if/ui';
import {
  SettingsPanel,
  type EmailEntry,
  type LogEntry,
  type SettingsData,
} from '@/components/admin/settings-panel';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Settings – Intuitive Fusion' };

export default async function SettingsPage() {
  const [me, settings, log, emails, users] = await Promise.all([
    getSessionUser(),
    apiGet<SettingsData>('/admin/settings'),
    apiGet<LogEntry[]>('/admin/notification-log'),
    apiGet<EmailEntry[]>('/admin/email-log'),
    apiGet<Array<{ id: string; name: string; roles: string[]; active: boolean }>>('/admin/users'),
  ]);
  // only procurement managers carry a workload, so only they can be given their own capacity
  const managers = (users ?? [])
    .filter((u) => u.active && u.roles.includes('PROCUREMENT'))
    .map((u) => ({ id: u.id, name: u.name }));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          The rules the platform follows, changed without a release. Each section saves on its own and every
          change is recorded in the audit trail with the old and the new value.
        </p>
      </header>
      {!settings || !me ? (
        <EmptyState title="Settings are unavailable" body="Please refresh the page." />
      ) : (
        <SettingsPanel
          initial={settings}
          log={log ?? []}
          emails={emails ?? []}
          managers={managers}
          csrf={me.csrfToken}
        />
      )}
    </div>
  );
}
