import { AiModelsPanel } from '@/components/b10/ai-models';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'AI model approvals – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">AI model approvals</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          A third-party AI model is switched on only after two different people agree: one asks, and probity
          or an executive decides. You can also withdraw an approval, which puts the organisation back on the
          built-in model at once. Only an administrator switches the active model.
        </p>
      </header>
      <AiModelsPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
