import { ContentSafetyPanel } from '@/components/b11/content-safety';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Content safety – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Content safety</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Supplier and uploaded text is treated as data, never as instructions. When it reads like an
          instruction to an AI it is flagged here, made inert, and can never change a score, a result or a
          route.
        </p>
      </header>
      <ContentSafetyPanel csrf={user!.csrfToken} />
    </div>
  );
}
