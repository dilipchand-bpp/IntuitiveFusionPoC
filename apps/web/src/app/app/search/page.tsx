import { SearchView } from '@/components/b9/search';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Search – Intuitive Fusion' };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [user, sp] = await Promise.all([getSessionUser(), searchParams]);
  const q = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Search</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Search your own records, and if you choose, ask an outside source with identifiers withheld.
        </p>
      </header>
      <SearchView csrf={user!.csrfToken} initialQuery={(q ?? '').slice(0, 200)} />
    </div>
  );
}
