import { EvidencePanel } from '@/components/b11/evidence-panel';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Security evidence – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Security evidence</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          What is encrypted, measured from the database now: transport settings, encrypted and plaintext rows,
          key versions in use, tenant isolation, and what this application cannot show.
        </p>
      </header>
      <EvidencePanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
