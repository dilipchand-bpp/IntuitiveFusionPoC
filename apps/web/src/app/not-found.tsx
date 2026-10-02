import Link from 'next/link';
import { Button, Logo } from '@if/ui';

export const metadata = { title: 'Page not found – Intuitive Fusion' };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-10">
      <Logo withName size={40} />
      <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">Error 404</p>
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-text-muted">The page you are looking for does not exist or has moved.</p>
      <Button asChild className="w-fit">
        <Link href="/" className="text-primary-fg no-underline">
          Go to the home page
        </Link>
      </Button>
    </main>
  );
}
