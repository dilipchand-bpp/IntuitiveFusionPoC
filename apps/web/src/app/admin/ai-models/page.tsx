import { AiModelsPanel } from '@/components/b10/ai-models';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'AI models – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">AI models</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Which model answers for this organisation, and the approval a third-party model needs before it can
          be switched on.
        </p>
      </header>
      <AiModelsPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
