import { EvidencePanel } from '@/components/b11/evidence-panel';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Security evidence – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Security evidence"
        subtitle="What is encrypted, measured from the database now: transport settings, encrypted and plaintext rows, key versions in use, tenant isolation, and what this application cannot show."
      />
      <EvidencePanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
