import Link from 'next/link';
import { PageHeader } from '@if/ui';
import { CommitmentView } from '@/components/b9/spend-views';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Future commitment – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-12">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <PageHeader
        title="Future commitment"
        subtitle="What current contracts commit for each financial year ahead. Ranges and unknown amounts are stated, never guessed."
      />
      <CommitmentView csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
