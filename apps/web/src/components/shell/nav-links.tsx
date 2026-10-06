'use client';
import {
  BadgeCheck,
  BarChart3,
  Building2,
  ClipboardList,
  FileSignature,
  FileText,
  Inbox,
  LayoutDashboard,
  Scale,
  ShieldCheck,
  UploadCloud,
  UserCog,
  Users,
  Workflow,
  ChevronDown,
  Landmark,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@if/ui';
import type { NavIcon, NavItem } from '@/lib/nav';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  requests: Inbox,
  plans: ClipboardList,
  approvals: BadgeCheck,
  tenders: FileText,
  evaluations: Scale,
  contracts: FileSignature,
  reports: BarChart3,
  suppliers: Building2,
  audit: ShieldCheck,
  users: Users,
  delegations: Landmark,
  workflows: Workflow,
  templates: FileText,
  migration: UploadCloud,
  settings: Settings,
  admin: UserCog,
  profile: Building2,
};

const STORE = 'if.nav.collapsed';
const readStored = (): string[] | null => {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(STORE) ?? 'null');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null; // storage can be blocked or empty: the menu then simply starts from its defaults
  }
};

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = [...new Set(items.map((i) => i.section))];
  const isCurrent = (i: NavItem) => pathname === i.href || pathname.startsWith(i.href + '/');
  const currentSection = items.find(isCurrent)?.section;
  // Sections the person has closed. With no saved choice, only the first section and the one holding the current page are open,
  // so a long menu starts short. Arriving at a page always opens its section, so nobody loses their place.
  const [closed, setClosed] = useState<string[]>(() =>
    sections.filter((s, i) => i > 0 && s !== currentSection),
  );
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const s = readStored();
    if (s) setClosed(s);
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored && currentSection)
      setClosed((c) => (c.includes(currentSection) ? c.filter((x) => x !== currentSection) : c));
  }, [restored, currentSection]);
  const save = (next: string[]) => {
    setClosed(next);
    try {
      window.localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* not remembered, still works */
    }
  };
  const toggle = (section: string) =>
    save(closed.includes(section) ? closed.filter((x) => x !== section) : [...closed, section]);
  const allClosed = sections.every((s) => closed.includes(s));
  const setAll = (collapse: boolean) => save(collapse ? [...sections] : []);
  return (
    <nav aria-label="Main" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setAll(!allClosed)}
        className="self-end rounded-md px-2 py-1 text-xs font-semibold text-text-muted hover:bg-surface-alt hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
      >
        {allClosed ? 'Expand all' : 'Collapse all'}
      </button>
      {sections.map((section) => {
        const open = !closed.includes(section);
        const id = `nav-section-${section.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        return (
          <div key={section} className="flex flex-col gap-1">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => toggle(section)}
              className="flex min-h-[36px] w-full items-center justify-between rounded-md px-3 text-xs font-bold uppercase tracking-widest text-text-muted hover:bg-surface-alt hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span>{section}</span>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 transition-transform motion-reduce:transition-none',
                  !open && '-rotate-90',
                )}
                aria-hidden="true"
              />
            </button>
            <ul id={id} hidden={!open} className="flex flex-col gap-1">
              {items
                .filter((i) => i.section === section)
                .map((i) => {
                  const Icon = ICONS[i.icon];
                  // The most specific nav entry wins, so /admin does not light up for /admin/users.
                  const longer = items.some(
                    (o) =>
                      o.href !== i.href &&
                      o.href.startsWith(i.href + '/') &&
                      (pathname === o.href || pathname.startsWith(o.href + '/')),
                  );
                  const current = !longer && (pathname === i.href || pathname.startsWith(i.href + '/'));
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        onClick={onNavigate}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium text-text no-underline transition-colors hover:bg-surface-alt',
                          current && 'bg-accent/10 font-semibold text-accent hover:bg-accent/15',
                        )}
                      >
                        <Icon className="size-5 shrink-0" aria-hidden="true" />
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
