import { AskPanel } from '@/components/reports/b6-reports';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Ask for a report – Intuitive Fusion' };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Ask for a report</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Ask in plain language and see the report, with how it was understood. Save the views you use and
          share them.
        </p>
      </header>
      <AskPanel csrf={user!.csrfToken} initial={q?.slice(0, 300)} />
    </div>
  );
}
