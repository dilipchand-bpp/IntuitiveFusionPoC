'use client';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Button, Dialog, cn } from '@if/ui';
import type { NavItem } from '@/lib/nav';

/** "Jump to" palette over the pages this person can open. Opens with Ctrl/Cmd+K or the header button. */
export function CommandPalette({ items }: { items: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => `${i.label} ${i.section}`.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active].href);
    }
  };

  return (
    <>
      <span className="hidden lg:block">
        <Button
          variant="secondary"
          className="min-w-[13rem] justify-between text-text-muted"
          onClick={() => setOpen(true)}
          aria-label="Jump to a page (Control K)"
        >
          <span className="flex items-center gap-2 font-medium">
            <Search className="size-4" aria-hidden="true" /> Jump to…
          </span>
          <kbd className="rounded-sm border border-border bg-surface-alt px-1.5 py-0.5 font-mono text-xs">
            Ctrl K
          </kbd>
        </Button>
      </span>
      <span className="lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Jump to a page">
          <Search className="size-5" aria-hidden="true" />
        </Button>
      </span>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setQuery('');
            setActive(0);
          }
        }}
        title="Jump to"
        description="Type to filter, use the arrow keys, and press Enter."
      >
        <label htmlFor="palette-input" className="sr-only">
          Search pages
        </label>
        <input
          id="palette-input"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `palette-${active}` : undefined}
          placeholder="Search pages…"
          className="min-h-[44px] w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text placeholder:text-text-muted"
        />
        <ul
          id="palette-list"
          role="listbox"
          aria-label="Pages"
          className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto"
        >
          {results.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">No pages match.</li>}
          {results.map((r, i) => (
            <li
              key={r.href}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.href)}
              className={cn(
                'flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 text-sm',
                i === active ? 'bg-accent/10 font-semibold text-accent' : 'text-text',
              )}
            >
              {r.label}
              <span className="text-xs text-text-muted">{r.section}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
