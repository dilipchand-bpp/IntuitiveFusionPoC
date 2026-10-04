import Link from 'next/link';
import { DisclosureTasks } from '@/components/contract/b5-pages';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Register disclosures – Intuitive Fusion' };

export default async function DisclosuresPage() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Public register disclosures</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          For public-sector customers, a change to a contract above the statutory threshold must be disclosed
          on the public register. Each one is a task until the register reference is recorded.
        </p>
      </header>
      <DisclosureTasks csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
