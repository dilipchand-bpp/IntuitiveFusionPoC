import { EmptyState } from '@if/ui';
import { SettingsPanel, type LogEntry, type SettingsData } from '@/components/admin/settings-panel';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Settings – Intuitive Fusion' };

export default async function SettingsPage() {
  const [me, settings, log] = await Promise.all([
    getSessionUser(),
    apiGet<SettingsData>('/admin/settings'),
    apiGet<LogEntry[]>('/admin/notification-log'),
  ]);
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
        <SettingsPanel initial={settings} log={log ?? []} csrf={me.csrfToken} />
      )}
    </div>
  );
}
