import Link from 'next/link';
import { KpiCard } from '@if/ui';
import { ROADMAP, groupBy } from '@if/shared';
import { RoadmapList } from '@/components/roadmap/roadmap-list';
import { navFor, resolveNav } from '@/lib/nav';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Roadmap – Intuitive Fusion' };

/** Every requirement that is stubbed or deferred in the proof of concept, straight from the traceability matrix. */
export default async function RoadmapPage() {
  const user = await getSessionUser();
  const stubs = ROADMAP.filter((i) => i.tier === 'S');
  const deferred = ROADMAP.filter((i) => i.tier === 'D');
  const areas = groupBy(stubs, (i) => i.area ?? '');
  // link an area only when the person's own menu offers it (no links that end in "not permitted")
  const offered = new Set(navFor(user?.roles ?? []).map((n) => n.href));
  const canOpen = (path: string) => offered.has(path);
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Roadmap</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          What this proof of concept does not do yet. Each item carries the requirement id from the
          traceability matrix. &quot;Coming soon&quot; items are designed and have a place in the product; the
          second list is out of scope for the proof of concept.
        </p>
      </header>

      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Coming soon" value={String(stubs.filter((i) => i.status === 'PLANNED').length)} />
        <KpiCard label="Partly built" value={String(stubs.filter((i) => i.status === 'PARTIAL').length)} />
        <KpiCard label="Not in the proof of concept" value={String(deferred.length)} />
      </section>

      <section aria-labelledby="soon" className="flex flex-col gap-6">
        <h2 id="soon" className="font-heading text-2xl font-bold">
          Coming soon, by area
        </h2>
        {areas.map(([area, items]) => {
          const nav = resolveNav(area);
          const name = nav?.label ?? area;
          return (
            <section key={area} aria-labelledby={`area-${area}`} className="flex flex-col gap-2">
              <h3 id={`area-${area}`} className="font-heading text-lg font-semibold">
                {canOpen(area) ? (
                  <Link href={area} className="underline underline-offset-4">
                    {name}
                  </Link>
                ) : (
                  name
                )}{' '}
                <span className="text-sm font-normal text-text-muted">({items.length})</span>
              </h3>
              <RoadmapList items={items} label={`${name}: coming soon`} />
            </section>
          );
        })}
      </section>

      <section aria-labelledby="later" className="flex flex-col gap-3">
        <h2 id="later" className="font-heading text-2xl font-bold">
          Not in the proof of concept
        </h2>
        {groupBy(deferred, (i) => i.category).map(([category, items]) => (
          <details key={category} className="rounded-md border border-border p-3">
            <summary className="min-h-[44px] cursor-pointer font-semibold">
              {category} <span className="text-sm font-normal text-text-muted">({items.length})</span>
            </summary>
            <div className="mt-2">
              <RoadmapList items={items} label={`${category}: not in the proof of concept`} />
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
