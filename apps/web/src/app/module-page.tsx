import { notFound } from 'next/navigation';
import { ComingSoon } from '@if/ui';
import { roadmapForArea } from '@if/shared';
import { RoadmapList } from '@/components/roadmap/roadmap-list';
import { resolveNav } from '@/lib/nav';

/**
 * Placeholder for every module screen that is not built yet. Never blank: it names the module, says what it will do
 * and lists the requirement IDs it will satisfy (the same ids the roadmap register is reconciled against the RTM with).
 * Paths that are not exactly an entry in the navigation table are real 404s.
 */
export function ModulePage({ pathname }: { pathname: string }) {
  const item = resolveNav(pathname);
  // a placeholder answers only for its own address: /supplier/anything-else is a real 404, not "My tenders - coming soon"
  if (!item || item.href !== pathname) notFound();
  const planned = roadmapForArea(item.href);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">{item.section}</p>
        <h1 className="text-3xl font-bold">{item.label}</h1>
        <p className="mt-1 max-w-prose text-text-muted">{item.blurb}</p>
      </header>
      <ComingSoon feature={item.module} requirementIds={[...item.requirements]} />
      {planned.length > 0 && (
        <section aria-labelledby="planned-title" className="flex flex-col gap-2">
          <h2 id="planned-title" className="font-heading text-lg font-semibold">
            What is planned here
          </h2>
          <RoadmapList items={planned} label={`${item.label}: planned`} />
        </section>
      )}
    </div>
  );
}
