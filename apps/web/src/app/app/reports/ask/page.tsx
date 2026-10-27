import { AskPanel } from '@/components/reports/b6-reports';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Ask for a report – Intuitive Fusion' };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Ask for a report"
        subtitle="Ask in plain language and see the report, with how it was understood. Save the views you use and share them."
      />
      <AskPanel csrf={user!.csrfToken} initial={q?.slice(0, 300)} />
    </div>
  );
}
