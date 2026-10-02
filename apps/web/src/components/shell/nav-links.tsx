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
  Landmark,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  audit: ShieldCheck,
  users: Users,
  delegations: Landmark,
  workflows: Workflow,
  templates: FileText,
  migration: UploadCloud,
  admin: UserCog,
  profile: Building2,
};

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = [...new Set(items.map((i) => i.section))];
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{section}</p>
          <ul className="flex flex-col gap-1">
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
                        'flex min-h-[44px] items-center gap-3 rounded-sm px-3 text-sm font-medium text-text no-underline hover:bg-surface-alt',
                        current &&
                          'bg-surface-alt font-semibold shadow-[inset_3px_0_0_var(--if-color-accent)]',
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
      ))}
    </nav>
  );
}
