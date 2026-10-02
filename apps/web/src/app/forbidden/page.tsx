import Link from 'next/link';
import { Button } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Access denied – Intuitive Fusion' };

export default async function Forbidden() {
  const user = await getSessionUser();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-3xl font-bold">Access denied</h1>
      <p className="text-text-muted">
        Your role does not have permission to open this page. The attempt has been recorded.
      </p>
      <Button asChild className="w-fit">
        <Link href={user?.homePath ?? '/login'}>{user ? 'Go to my home page' : 'Sign in'}</Link>
      </Button>
    </main>
  );
}
