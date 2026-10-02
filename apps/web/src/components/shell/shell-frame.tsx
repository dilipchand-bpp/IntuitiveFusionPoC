'use client';
import { Menu as MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button, Drawer, Logo, ThemeToggle } from '@if/ui';
import type { NavItem } from '@/lib/nav';
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
  children,
}: {
  user: ShellUser;
  items: NavItem[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-bg text-text" data-testid="shell" data-role={user.role}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 flex items-center gap-2 bg-primary px-3 py-2 text-primary-fg sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="text-primary-fg hover:bg-primary-hover lg:hidden"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          <MenuIcon className="size-5" aria-hidden="true" />
        </Button>
        <Link
          href={user.homePath}
          className="flex items-center text-primary-fg no-underline"
          aria-label="Intuitive Fusion home"
        >
          <Logo withName compact size={36} />
        </Link>
        <span className="mx-1 hidden rounded-full border border-primary-fg/40 px-2 py-0.5 text-xs font-semibold sm:inline">
          Proof of concept · synthetic data
        </span>
        <div className="ml-auto flex items-center gap-1 text-primary-fg [&_button]:text-primary-fg [&_button:hover]:bg-primary-hover">
          <ThemeToggle />
          <NotificationBell csrfToken={user.csrfToken} />
          <ProfileMenu name={user.name} role={user.role} email={user.email} csrfToken={user.csrfToken} />
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-[56px] hidden h-[calc(100vh-56px)] w-64 shrink-0 overflow-y-auto border-r border-border bg-surface p-4 lg:block">
          <NavLinks items={items} />
        </aside>
        <Drawer open={open} onOpenChange={setOpen} title="Menu">
          <div className="overflow-y-auto">
            <NavLinks items={items} onNavigate={() => setOpen(false)} />
          </div>
        </Drawer>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
