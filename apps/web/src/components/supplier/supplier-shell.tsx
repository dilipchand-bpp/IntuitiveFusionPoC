import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@if/ui';
import { PreviewLink } from '@/components/preview/preview-link';
import { AskAi } from '@/components/shell/ask-ai';
import { NotificationBell } from '@/components/shell/notification-bell';
import { ProfileMenu } from '@/components/shell/profile-menu';
import { getBranding } from '@/lib/branding';
import { getSessionUser } from '@/lib/session';
import { SupplierTabs } from './supplier-tabs';

const SUPPLIER_LINKS = [
  { href: '/supplier', label: 'My tenders' },
  { href: '/supplier/profile', label: 'Company profile' },
];

/**
 * Top-bar frame for external suppliers (same pattern as the staff shell, without the staff tabs): they get one
 * tender and a few actions, not the buying team's menu. The theme choice lives in the account menu.
 */
export async function SupplierShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const brand = await getBranding();
  const product = brand.productName || 'Intuitive Fusion';
  const tenant = user.tenantName?.trim() || product;
  return (
    <div className="min-h-screen bg-bg text-text" data-testid="supplier-shell">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 text-text backdrop-blur">
        <div className="flex min-h-[60px] items-center gap-3 px-3 sm:px-6 lg:px-10">
          <Link
            href="/"
            className="flex min-h-[44px] min-w-[44px] items-center gap-3 text-text no-underline"
            aria-label="Intuitive Fusion home page"
          >
            <Logo size={32} />
            <span className="hidden whitespace-nowrap text-sm font-medium tracking-heading sm:inline">
              {product}
            </span>
          </Link>
          <span aria-hidden="true" className="hidden h-7 w-px bg-border md:block" />
          <div className="hidden items-center gap-3 md:flex" data-testid="workspace-chip">
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-xs font-medium"
            >
              {tenant.charAt(0).toUpperCase()}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="max-w-48 truncate text-sm font-medium">{tenant}</span>
              <span className="text-[11px] text-text-muted">Supplier portal</span>
            </span>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <PreviewLink />
            <NotificationBell csrfToken={user.csrfToken} />
            <ProfileMenu name={user.name} role={user.role} email={user.email} csrfToken={user.csrfToken} />
          </div>
        </div>
        <div className="border-t border-border px-3 sm:px-6 lg:px-10">
          <SupplierTabs links={SUPPLIER_LINKS} />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-w-0 max-w-[1310px] flex-col gap-12 px-4 py-8 outline-none sm:px-8 sm:py-10"
      >
        {children}
      </main>
      <AskAi csrf={user.csrfToken} supplier />
    </div>
  );
}
