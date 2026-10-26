'use client';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { cn } from '@if/ui';
import type { NavItem } from '@/lib/nav';
import { currentTab, groupNav, type TabId } from '@/lib/nav-tabs';
import { isCurrentPage } from './top-nav';

/** Phone and tablet menu: the same tabs as an accordion inside the drawer. The current tab starts open. */
export function MobileNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = useMemo(() => groupNav(items), [items]);
  const active = currentTab(groups, items, pathname);
  const [open, setOpen] = useState<TabId | null>(active ?? groups[0]?.id ?? null);
  return (
    <nav aria-label="Pages" className="flex flex-col">
      {groups.map((g) => {
        const isOpen = open === g.id;
        const id = `mnav-${g.id}`;
        return (
          <div key={g.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={id}
              onClick={() => setOpen(isOpen ? null : g.id)}
              className={cn(
                'flex min-h-[48px] w-full items-center justify-between px-1 text-left text-base text-text-muted focus-visible:outline-2 focus-visible:outline-ring',
                active === g.id && 'text-text',
              )}
            >
              {g.label}
              <ChevronDown
                className={cn(
                  'size-4 transition-transform motion-reduce:transition-none',
                  isOpen && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
            <ul id={id} hidden={!isOpen} className="flex flex-col pb-2">
              {g.items.map((i) => {
                const current = isCurrentPage(items, pathname, i.href);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'flex min-h-[44px] items-center rounded-sm px-3 text-sm text-text-muted no-underline hover:bg-surface-alt hover:text-text',
                        current && 'bg-surface-alt font-medium text-text',
                      )}
                    >
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
