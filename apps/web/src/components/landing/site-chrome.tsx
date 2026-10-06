import Link from 'next/link';
import { Button, Logo, ThemeToggle } from '@if/ui';
import { PreviewLink } from '@/components/preview/preview-link';
import { getSessionUser } from '@/lib/session';

export const CONTACT_EMAIL = 'hello@intuitivefusion.example';

export async function SiteHeader() {
  const user = await getSessionUser();
  return (
    <header className="glass sticky top-0 z-30 border-b border-border/60">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        <Link href="/" className="text-text no-underline" aria-label="Intuitive Fusion home">
          <Logo withName size={36} />
        </Link>
        <nav aria-label="Page sections" className="ml-6 hidden items-center gap-1 md:flex">
          {[
            ['#features', 'Features'],
            ['#how-it-works', 'How it works'],
            ['#trust', 'Security'],
            ['#faq', 'FAQ'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-text no-underline transition-colors hover:bg-accent/10 hover:text-accent"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <PreviewLink />
          <ThemeToggle />
          <Button asChild variant="accent">
            {user ? (
              <Link href={user.homePath} className="text-gradient-fg no-underline">
                Back to my portal
              </Link>
            ) : (
              <Link href="/login" className="text-gradient-fg no-underline">
                Log in
              </Link>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border bg-surface">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-brand-gradient" />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[2fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo withName size={36} />
          <p className="max-w-prose text-sm text-text-muted">
            Conversational procurement and contract management, from request to signed contract. This site is
            a proof of concept running on synthetic data.
          </p>
        </div>
        <div>
          <h2 className="font-heading text-base font-semibold">Contact</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </li>
            <li className="text-text-muted">Business hours (AEST)</li>
          </ul>
        </div>
        <div>
          <h2 className="font-heading text-base font-semibold">Legal</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            <li>
              <Link href="/legal/privacy">Privacy policy</Link>
            </li>
            <li>
              <Link href="/legal/terms">Terms of use</Link>
            </li>
            <li>
              <Link href="/legal/accessibility">Accessibility statement</Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t border-border px-4 py-4 text-center text-xs text-text-muted">
        © 2026 Intuitive Fusion. Proof of concept – not for production use.
      </p>
    </footer>
  );
}
