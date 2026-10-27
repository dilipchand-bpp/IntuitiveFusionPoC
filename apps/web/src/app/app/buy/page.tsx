import { PageHeader } from '@if/ui';
import { BuyingView } from '@/components/b9/buying';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Guided buying – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Guided buying"
        subtitle="Buy everyday goods from the approved catalogue, or describe what you need and see a scored shortlist."
      />
      <BuyingView csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
