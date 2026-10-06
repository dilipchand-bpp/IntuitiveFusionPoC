import Link from 'next/link';
import { CommitmentView } from '@/components/b9/spend-views';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Future commitment – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Future commitment</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          What current contracts commit for each financial year ahead. Ranges and unknown amounts are stated,
          never guessed.
        </p>
      </header>
      <CommitmentView csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
