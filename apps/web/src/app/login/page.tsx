import { ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Logo, ThemeToggle } from '@if/ui';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in – Intuitive Fusion' };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="bg-brand-gradient relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <span aria-hidden="true" className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />
        <span aria-hidden="true" className="absolute -bottom-32 -left-20 size-96 rounded-full bg-white/10" />
        <span aria-hidden="true" className="bg-grid absolute inset-0 opacity-20" />
        <Link
          href="/"
          className="relative w-fit text-gradient-fg no-underline"
          aria-label="Intuitive Fusion home"
        >
          <Logo withName size={44} />
        </Link>
        <div className="relative flex flex-col gap-8">
          <h2 className="text-5xl font-extrabold leading-[1.08] tracking-tight">
            From request to signed contract, in one conversation.
          </h2>
          <ul className="flex flex-col gap-4">
            <li className="flex items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur">
              <Sparkles className="size-6 shrink-0" aria-hidden="true" />
              AI drafts every document. You review and decide.
            </li>
            <li className="flex items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur">
              <ShieldCheck className="size-6 shrink-0" aria-hidden="true" />
              Every action is recorded in a tamper-evident audit trail.
            </li>
            <li className="flex items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur">
              <UserCheck className="size-6 shrink-0" aria-hidden="true" />
              Role-based access with separation of duties.
            </li>
          </ul>
        </div>
        <p className="relative text-sm opacity-90">Proof of concept · synthetic data</p>
      </aside>
      <main id="main" className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Link href="/" className="text-text no-underline lg:hidden" aria-label="Intuitive Fusion home">
            <Logo withName size={36} />
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 pb-16">
          <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-8 shadow-lg">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight">Sign in</h1>
              <p className="mt-1 text-text-muted">Use your work account to continue.</p>
            </div>
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
          <p className="px-2 text-center text-sm text-text-muted">
            This is a demonstration environment. Demo users and their shared password are listed in the
            project README.
          </p>
        </div>
      </main>
    </div>
  );
}
