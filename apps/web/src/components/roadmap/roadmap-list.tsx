import { Badge } from '@if/ui';
import type { RoadmapItem } from '@if/shared';

const STATUS: Record<RoadmapItem['status'], { label: string; tone: 'info' | 'warning' | 'neutral' }> = {
  PARTIAL: { label: 'Partly built', tone: 'info' },
  PLANNED: { label: 'Coming soon', tone: 'warning' },
  DEFERRED: { label: 'Not in the proof of concept', tone: 'neutral' },
};

/** One requirement per row: the id (as written in the traceability matrix), what it will do, and where it stands. */
export function RoadmapList({ items, label }: { items: readonly RoadmapItem[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-border rounded-md border border-border">
      {items.map((i) => (
        <li
          key={i.id}
          data-testid="roadmap-item"
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3"
        >
          <div className="min-w-0 flex-1 basis-72">
            <span className="font-mono text-xs text-text-muted">{i.id}</span>
            <p className="text-sm">{i.title}</p>
          </div>
          <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
        </li>
      ))}
    </ul>
  );
}
