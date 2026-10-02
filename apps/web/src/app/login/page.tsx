import { ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Logo, ThemeToggle } from '@if/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in – Intuitive Fusion' };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-fg lg:flex">
        <Link href="/" className="w-fit text-primary-fg no-underline" aria-label="Intuitive Fusion home">
          <Logo withName size={44} />
        </Link>
        <div className="flex flex-col gap-6">
          <h2 className="text-4xl font-extrabold leading-tight">
            From request to signed contract, in one conversation.
          </h2>
          <ul className="flex flex-col gap-4 text-primary-fg/90">
            <li className="flex gap-3">
              <Sparkles className="size-6 shrink-0" aria-hidden="true" />
              AI drafts every document. You review and decide.
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="size-6 shrink-0" aria-hidden="true" />
              Every action is recorded in a tamper-evident audit trail.
            </li>
            <li className="flex gap-3">
              <UserCheck className="size-6 shrink-0" aria-hidden="true" />
              Role-based access with separation of duties.
            </li>
          </ul>
        </div>
        <p className="text-sm text-primary-fg/80">Proof of concept · synthetic data</p>
      </aside>
      <main id="main" className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Link href="/" className="text-text no-underline lg:hidden" aria-label="Intuitive Fusion home">
            <Logo withName size={36} />
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 pb-16">
          <div>
            <h1 className="text-3xl font-bold">Sign in</h1>
            <p className="mt-1 text-text-muted">Use your work account to continue.</p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="text-sm text-text-muted">
            This is a demonstration environment. Demo users and their shared password are listed in the
            project README.
          </p>
        </div>
      </main>
    </div>
  );
}
