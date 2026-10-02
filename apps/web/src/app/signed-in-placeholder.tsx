import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { LogoutButton } from './logout-button';

/**
 * TODO(M5): replaced by the real app shell (sidebar, notifications, profile menu).
 * Shows who is signed in so role-based redirects and guards can be verified end to end.
 */
export async function SignedInPlaceholder({ area }: { area: string }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">{area}</p>
      <h1 className="text-3xl font-bold">Welcome, {user.name}</h1>
      <p data-testid="whoami" className="text-text-muted">
        Signed in as <strong>{user.role}</strong> ({user.email})
      </p>
      <LogoutButton csrfToken={user.csrfToken} />
    </main>
  );
}
