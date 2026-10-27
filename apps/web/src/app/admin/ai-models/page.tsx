import { AiModelsPanel } from '@/components/b10/ai-models';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'AI models – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="AI models"
        subtitle="Which model answers for this organisation, and the approval a third-party model needs before it can be switched on."
      />
      <AiModelsPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
