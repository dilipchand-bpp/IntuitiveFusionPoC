import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Logo, ThemeToggle } from '@if/ui';
import { RegisterForm } from './register-form';

export const metadata = { title: 'Register as a supplier – Intuitive Fusion' };

const API = process.env.API_URL ?? 'http://localhost:4000';

interface Invitation {
  email: string;
  company: string;
  organisation: string;
}

async function lookup(token: string): Promise<Invitation | null> {
  try {
    const r = await fetch(`${API}/api/v1/supplier/invitations/${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    return r.ok ? ((await r.json()) as Invitation) : null;
  } catch {
    return null;
  }
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invitation = token ? await lookup(token) : null;
  const badLink = Boolean(token) && !invitation;
  return (
    <div className="bg-hero-mesh min-h-screen">
      <header className="flex items-center justify-between p-4">
        <Link href="/" className="text-text no-underline" aria-label="Intuitive Fusion home">
          <Logo withName size={36} />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-16 pt-4">
        <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-8 shadow-lg">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Register as a supplier</h1>
            <p className="mt-1 text-text-muted">
              {invitation
                ? `${invitation.organisation} has invited ${invitation.company} to tender. Create your account to see the tender documents.`
                : 'Create a supplier account. You will see tenders you are invited to and any that are open to all suppliers.'}
            </p>
          </div>
          {badLink ? (
            <p
              role="alert"
              className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
            >
              This invitation link is not valid. It may have been used already or may have expired. Ask the
              buyer for a new one.
            </p>
          ) : (
            <RegisterForm
              token={token}
              {...(invitation ? { email: invitation.email, company: invitation.company } : {})}
            />
          )}
          <p className="flex items-start gap-2 text-sm text-text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Your company is screened against watchlists when you register. Already registered?{' '}
            <Link href="/login">Sign in</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
