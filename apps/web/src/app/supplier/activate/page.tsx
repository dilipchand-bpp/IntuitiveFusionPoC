import Link from 'next/link';
import { Logo, PageHeader, Panel, ThemeToggle } from '@if/ui';
import { PrivacyNotice } from '@/components/b11/privacy';
import { ActivateForm } from './activate-form';

export const metadata = { title: 'Activate your account – Intuitive Fusion' };

const API = process.env.API_URL ?? 'http://localhost:4000';

interface Info {
  name: string;
  email: string;
  company: string;
  organisation: string;
}

async function lookup(token: string): Promise<Info | null> {
  try {
    const r = await fetch(`${API}/api/v1/supplier/activate/${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    return r.ok ? ((await r.json()) as Info) : null;
  } catch {
    return null;
  }
}

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const info = token ? await lookup(token) : null;
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="flex items-center justify-between p-4">
        <Link href="/" className="text-text no-underline" aria-label="Intuitive Fusion home">
          <Logo withName size={36} />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-16 pt-4">
        <Panel className="flex flex-col gap-6">
          <PageHeader
            title="Activate your account"
            subtitle={
              info
                ? info.company
                  ? `${info.organisation} has added you as a contact for ${info.company}. Choose a password to finish.`
                  : `${info.organisation} has created an account for you. Choose a password to finish.`
                : undefined
            }
          />
          {info && token ? (
            <>
              <PrivacyNotice context="USER_ACTIVATION" />
              <ActivateForm token={token} name={info.name} email={info.email} />
            </>
          ) : (
            <p
              role="alert"
              className="rounded-md border border-error bg-error-bg p-3 text-sm font-medium text-error"
            >
              This link is not valid. It may have been used already or may have expired. Ask the buyer for a
              new one.
            </p>
          )}
        </Panel>
      </main>
    </div>
  );
}
