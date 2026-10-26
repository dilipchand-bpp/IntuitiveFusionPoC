'use client';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@if/ui';
import type { NavItem } from '@/lib/nav';
import { currentItem, currentTab, groupNav, type NavGroup, type TabId } from '@/lib/nav-tabs';

/** The most specific menu entry wins, so /admin does not light up for /admin/users. */
export const isCurrentPage = (items: readonly NavItem[], pathname: string, href: string) =>
  currentItem(items, pathname)?.href === href;

const focusables = (panel: HTMLElement | null) =>
  Array.from(panel?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []);

/**
 * The top tabs (desktop). A tab with several pages opens a dropdown listing them; a tab with one page is a plain link.
 * Every page stays in the document (a closed dropdown is `hidden`), so the menu can be read and tested while closed.
 * Keyboard: Enter / Space / Arrow Down opens and moves to the first page, Arrow Up / Down move between pages,
 * Arrow Left / Right move between tabs, Escape closes and returns focus to the tab, Tab leaves and closes.
 */
export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const groups = useMemo(() => groupNav(items), [items]);
  const active = currentTab(groups, items, pathname);
  const [openId, setOpenId] = useState<TabId | null>(null);
  const root = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<TabId, HTMLElement>());
  const panels = useRef(new Map<TabId, HTMLElement>());

  // a page change always closes the menu
  useEffect(() => setOpenId(null), [pathname]);
  useEffect(() => {
    if (!openId) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [openId]);

  const tabIds = groups.map((g) => g.id);
  const focusTab = (id: TabId) => triggers.current.get(id)?.focus();

  const onTriggerKey = (e: KeyboardEvent<HTMLElement>, g: NavGroup, multi: boolean) => {
    const i = tabIds.indexOf(g.id);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const to = tabIds[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabIds.length) % tabIds.length]!;
      const wasOpen = openId !== null;
      focusTab(to);
      if (wasOpen && groups.find((x) => x.id === to)!.items.length > 1) setOpenId(to);
      else setOpenId(null);
    } else if (multi && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setOpenId(g.id);
      // the panel is already in the document; wait one frame for it to be shown
      requestAnimationFrame(() => {
        const links = focusables(panels.current.get(g.id) ?? null);
        (e.key === 'ArrowUp' ? links.at(-1) : links[0])?.focus();
      });
    } else if (e.key === 'Escape' && openId) {
      setOpenId(null);
    }
  };

  const onPanelKey = (e: KeyboardEvent<HTMLElement>, g: NavGroup) => {
    const links = focusables(panels.current.get(g.id) ?? null);
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      links[(at + 1) % links.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      links[(at - 1 + links.length) % links.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      links[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      links.at(-1)?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpenId(null);
      focusTab(g.id);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = tabIds.indexOf(g.id);
      const to = tabIds[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabIds.length) % tabIds.length]!;
      focusTab(to);
      setOpenId(groups.find((x) => x.id === to)!.items.length > 1 ? to : null);
    }
  };

  const tabCls = (isActive: boolean) =>
    cn(
      'relative inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap px-0.5 text-sm text-text-muted no-underline transition-colors hover:text-text',
      'after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-transparent',
      isActive && 'text-text after:bg-text',
    );

  return (
    <nav
      aria-label="Main"
      ref={root}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpenId(null);
      }}
    >
      <ul className="flex flex-wrap items-center gap-x-7">
        {groups.map((g) => {
          const multi = g.items.length > 1;
          const isActive = active === g.id;
          const open = openId === g.id;
          const panelId = `topnav-${g.id}`;
          return (
            <li key={g.id} className="relative">
              {multi ? (
                <>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) triggers.current.set(g.id, el);
                    }}
                    aria-expanded={open}
                    aria-controls={panelId}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => setOpenId(open ? null : g.id)}
                    onKeyDown={(e) => onTriggerKey(e, g, true)}
                    className={tabCls(isActive)}
                  >
                    {g.label}
                    <ChevronDown
                      className={cn(
                        'size-3 transition-transform motion-reduce:transition-none',
                        open && 'rotate-180',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  <ul
                    id={panelId}
                    hidden={!open}
                    ref={(el) => {
                      if (el) panels.current.set(g.id, el);
                    }}
                    onKeyDown={(e) => onPanelKey(e, g)}
                    className="absolute left-0 top-full z-40 mt-px flex min-w-60 flex-col rounded-md border border-border bg-surface p-1 shadow-md"
                  >
                    {g.items.map((i) => {
                      const current = isCurrentPage(items, pathname, i.href);
                      return (
                        <li key={i.href}>
                          <Link
                            href={i.href}
                            aria-current={current ? 'page' : undefined}
                            className={cn(
                              'flex min-h-[40px] items-center rounded-sm px-3 text-sm text-text-muted no-underline hover:bg-surface-alt hover:text-text',
                              current && 'bg-surface-alt font-medium text-text',
                            )}
                          >
                            {i.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <Link
                  href={g.items[0]!.href}
                  ref={(el) => {
                    if (el) triggers.current.set(g.id, el);
                  }}
                  aria-current={isCurrentPage(items, pathname, g.items[0]!.href) ? 'page' : undefined}
                  onKeyDown={(e) => onTriggerKey(e, g, false)}
                  className={tabCls(isActive)}
                >
                  {g.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
