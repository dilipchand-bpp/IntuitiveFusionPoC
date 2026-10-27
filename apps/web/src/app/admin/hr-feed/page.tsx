import { HrFeedPanel } from '@/components/b10/hr-feed';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'HR feed – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="HR feed"
        subtitle="Starters, leavers and delegate changes from the HR system: preview a batch, apply it, and see what needs a person."
      />
      <HrFeedPanel csrf={user!.csrfToken} />
    </div>
  );
}
