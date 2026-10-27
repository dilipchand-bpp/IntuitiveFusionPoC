'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@if/ui';

/** The supplier portal's few pages as top tabs; the most specific match is the current one. */
export function SupplierTabs({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  const current = links
    .filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Supplier portal">
      <ul className="flex flex-wrap items-center gap-x-7">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current === l.href ? 'page' : undefined}
              className={cn(
                'relative inline-flex min-h-[44px] items-center whitespace-nowrap px-0.5 text-sm text-text-muted no-underline transition-colors hover:text-text',
                'after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-transparent',
                current === l.href && 'text-text after:bg-text',
              )}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
