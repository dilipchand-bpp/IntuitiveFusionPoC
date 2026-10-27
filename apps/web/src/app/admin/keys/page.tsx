import { KeysPanel } from '@/components/b11/keys-panel';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Encryption keys – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Encryption keys"
        subtitle="Customer-managed keys per purpose with rotation, re-wrapping and disabling. This is a simulated local key service; in production the keys sit in the organisation's managed key service."
      />
      <KeysPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
