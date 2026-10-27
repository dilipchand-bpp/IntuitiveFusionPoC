import { ConfigAdmin } from '@/components/b10/config-admin';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Configuration – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Configuration"
        subtitle="Every setting that shapes how this organisation uses the platform, where to change it, and a way to export and import the lot."
      />
      <ConfigAdmin csrf={user!.csrfToken} />
    </div>
  );
}
