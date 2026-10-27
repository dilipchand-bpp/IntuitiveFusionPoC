import { PageHeader } from '@if/ui';
import { ContentPacks } from '@/components/b11/content-packs';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Outside content – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Outside content"
        subtitle="Reference content that is refreshed from outside sources: classification codes, market prices, standard risks, clause references and ESG guidance. Fields on requests and plans use it together with the organisation's own records, and show which they came from."
      />
      <ContentPacks csrf={user!.csrfToken} />
    </div>
  );
}
