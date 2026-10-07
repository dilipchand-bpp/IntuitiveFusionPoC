import { KeysPanel } from '@/components/b11/keys-panel';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Encryption keys – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Encryption keys</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Customer-managed keys per purpose with rotation, re-wrapping and disabling. This is a simulated
          local key service; in production the keys sit in the organisation's managed key service.
        </p>
      </header>
      <KeysPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
