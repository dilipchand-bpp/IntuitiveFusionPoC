'use client';
import { Menu as MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button, Drawer, Logo, ThemeToggle } from '@if/ui';
import type { NavItem } from '@/lib/nav';
import { CommandPalette } from './command-palette';
import { PreviewLink } from '@/components/preview/preview-link';
import { AskAi } from './ask-ai';
import { NavLinks } from './nav-links';
import { NotificationBell } from './notification-bell';
import { ProfileMenu } from './profile-menu';

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  csrfToken: string;
  homePath: string;
}

/** Header + sidebar (desktop) / drawer (phone and tablet) around every signed-in page. */
export function ShellFrame({
  user,
  items,
  brand,
  children,
}: {
  user: ShellUser;
  items: NavItem[];
  brand?: { productName: string; tagline: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-hero-mesh min-h-screen text-text" data-testid="shell" data-role={user.role}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
      >
        Skip to main content
      </a>
      <header className="glass sticky top-0 z-30 flex items-center gap-2 border-b border-border/70 px-3 py-2 text-text sm:px-4">
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
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-text no-underline"
          aria-label={`${brand?.productName ?? 'Intuitive Fusion'} home page`}
        >
          <Logo size={36} />
          <span className="ml-3 hidden whitespace-nowrap font-heading text-lg font-bold sm:inline">
            {brand?.productName ?? 'Intuitive Fusion'}
            {brand?.tagline && (
              <span className="ml-2 hidden text-xs font-normal text-text-muted xl:inline">
                {brand.tagline}
              </span>
            )}
          </span>
        </Link>
        <span className="mx-1 hidden rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent xl:inline">
          Proof of concept · synthetic data
        </span>
        <div className="ml-auto flex items-center gap-1">
          <CommandPalette items={items} />
          <PreviewLink />
          <ThemeToggle />
          <NotificationBell csrfToken={user.csrfToken} />
          <ProfileMenu name={user.name} role={user.role} email={user.email} csrfToken={user.csrfToken} />
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-64 shrink-0 overflow-y-auto border-r border-border/70 bg-surface p-4 lg:block">
          <NavLinks items={items} />
        </aside>
        <Drawer open={open} onOpenChange={setOpen} title="Menu">
          <div className="overflow-y-auto">
            <NavLinks items={items} onNavigate={() => setOpen(false)} />
          </div>
        </Drawer>
        <main id="main" tabIndex={-1} className="reveal min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
      <AskAi csrf={user.csrfToken} />
    </div>
  );
}
