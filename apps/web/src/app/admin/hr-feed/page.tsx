import { HrFeedPanel } from '@/components/b10/hr-feed';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'HR feed – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">HR feed</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Starters, leavers and delegate changes from the HR system: preview a batch, apply it, and see what
          needs a person.
        </p>
      </header>
      <HrFeedPanel csrf={user!.csrfToken} />
    </div>
  );
}
