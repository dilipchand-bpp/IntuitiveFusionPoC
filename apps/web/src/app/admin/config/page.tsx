import { ConfigAdmin } from '@/components/b10/config-admin';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Configuration – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Configuration</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Every setting that shapes how this organisation uses the platform, where to change it, and a way to
          export and import the lot.
        </p>
      </header>
      <ConfigAdmin csrf={user!.csrfToken} />
    </div>
  );
}
