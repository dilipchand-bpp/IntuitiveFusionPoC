import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo, ThemeToggle } from '@if/ui';
import { PreviewLink } from '@/components/preview/preview-link';
import { AskAi } from '@/components/shell/ask-ai';
import { NotificationBell } from '@/components/shell/notification-bell';
import { ProfileMenu } from '@/components/shell/profile-menu';
import { getSessionUser } from '@/lib/session';

const SUPPLIER_LINKS = [
  { href: '/supplier', label: 'My tenders' },
  { href: '/supplier/profile', label: 'Company profile' },
];

/** Header-and-menu frame for external suppliers: they get one tender and a few actions, not the buying team's menu. */
export async function SupplierShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <div className="bg-hero-mesh min-h-screen text-text" data-testid="supplier-shell">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
      >
        Skip to main content
      </a>
      <header className="glass sticky top-0 z-30 flex items-center gap-2 border-b border-border/70 px-3 py-2 sm:px-4">
        <Link
          href="/"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-text no-underline"
          aria-label="Intuitive Fusion home page"
        >
          <Logo withName compact size={36} />
        </Link>
        <span className="mx-1 hidden rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent sm:inline">
          Supplier portal
        </span>
        <div className="ml-auto flex items-center gap-1">
          <PreviewLink />
          <ThemeToggle />
          <NotificationBell csrfToken={user.csrfToken} />
          <ProfileMenu name={user.name} role={user.role} email={user.email} csrfToken={user.csrfToken} />
        </div>
      </header>
      <nav
        aria-label="Supplier portal"
        className="mx-auto flex max-w-4xl flex-wrap gap-1 px-3 pt-2 sm:px-6 lg:px-8"
      >
        {SUPPLIER_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-semibold text-text no-underline hover:bg-surface-alt"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <main id="main" tabIndex={-1} className="reveal mx-auto max-w-4xl p-4 outline-none sm:p-6 lg:p-8">
        {children}
      </main>
      <AskAi csrf={user.csrfToken} supplier />
    </div>
  );
}
