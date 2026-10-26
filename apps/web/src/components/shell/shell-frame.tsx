'use client';
import { Menu as MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button, Drawer, Logo } from '@if/ui';
import type { NavItem } from '@/lib/nav';
import { CommandPalette } from './command-palette';
import { PreviewLink } from '@/components/preview/preview-link';
import { BrowserNotice } from '@/components/b10/browser-notice';
import { AskAi } from './ask-ai';
import { MobileNav } from './mobile-nav';
import { NotificationBell } from './notification-bell';
import { ProfileMenu } from './profile-menu';
import { TopNav } from './top-nav';

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  csrfToken: string;
  homePath: string;
}

/**
 * The frame around every signed-in page: a top bar (logo, workspace, search, notifications, account), a row of tabs
 * with a dropdown of pages each (a drawer with an accordion on phones and tablets), the page, and the Ask pill.
 */
export function ShellFrame({
  user,
  items,
  brand,
  workspace,
  children,
}: {
  user: ShellUser;
  items: NavItem[];
  brand?: { productName: string; tagline: string };
  /** The organisation's name, shown in the workspace chip. */
  workspace?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const product = brand?.productName ?? 'Intuitive Fusion';
  const tenant = workspace?.trim() || product;
  return (
    <div className="bg-hero-mesh min-h-screen text-text" data-testid="shell" data-role={user.role}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 text-text backdrop-blur">
        <div className="flex min-h-[60px] items-center gap-3 px-3 sm:px-6 lg:px-10">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <MenuIcon className="size-5" aria-hidden="true" />
          </Button>
          <Link
            href="/"
            className="flex min-h-[44px] min-w-[44px] items-center gap-3 text-text no-underline"
            aria-label={`${product} home page`}
          >
            <Logo size={32} />
            <span className="hidden whitespace-nowrap font-heading text-lg font-medium tracking-[var(--if-heading-tracking)] sm:inline">
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
              <span className="text-[11px] text-text-muted">Procurement workspace</span>
            </span>
          </div>
          <span className="ml-auto hidden text-[11px] uppercase tracking-[0.12em] text-text-muted xl:inline">
            Proof of concept · synthetic data
          </span>
          <div className="ml-auto flex items-center gap-0.5 xl:ml-3">
            <CommandPalette items={items} />
            <PreviewLink />
            <NotificationBell csrfToken={user.csrfToken} />
            <ProfileMenu name={user.name} role={user.role} email={user.email} csrfToken={user.csrfToken} />
          </div>
        </div>
        <div className="hidden border-t border-border px-10 lg:block">
          <TopNav items={items} />
        </div>
      </header>

      <Drawer open={open} onOpenChange={setOpen} title="Menu">
        <div className="overflow-y-auto">
          <MobileNav items={items} onNavigate={() => setOpen(false)} />
        </div>
      </Drawer>
      <main
        id="main"
        tabIndex={-1}
        className="reveal mx-auto min-w-0 max-w-[1310px] px-4 py-8 outline-none sm:px-8 sm:py-10"
      >
        <BrowserNotice csrf={user.csrfToken} />
        {children}
      </main>
      <AskAi csrf={user.csrfToken} />
    </div>
  );
}
