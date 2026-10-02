import { notFound } from 'next/navigation';
import { ComingSoon } from '@if/ui';
import { resolveNav } from '@/lib/nav';

/**
 * Placeholder for every module screen that is not built yet. Never blank: it names the module, says what it will do
 * and lists the requirement IDs it will satisfy (TODO markers are reconciled against the RTM in M14).
 * Paths that are not in the navigation table are real 404s.
 */
export function ModulePage({ pathname }: { pathname: string }) {
  const item = resolveNav(pathname);
  if (!item) notFound();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">{item.section}</p>
        <h1 className="text-3xl font-bold">{item.label}</h1>
        <p className="mt-1 max-w-prose text-text-muted">{item.blurb}</p>
      </header>
      <ComingSoon feature={item.module} requirementIds={[...item.requirements]} />
    </div>
  );
}
