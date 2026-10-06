/**
 * Roadmap register: every requirement the traceability matrix marks as stubbed (tier S, "coming soon") or deferred
 * (tier D, not in the proof of concept). The data is generated from docs/RTM.csv (see _work/gen_roadmap.py), so the
 * screens that list it cannot drift from the matrix.
 */
export interface RoadmapItem {
  id: string;
  tier: 'S' | 'D';
  /** BUILT: delivered in a roadmap batch. PARTIAL: partly built (tier D, with a note) or referenced by earlier built work (tier S). PLANNED: coming soon. DEFERRED: tier D. */
  status: 'BUILT' | 'PARTIAL' | 'PLANNED' | 'DEFERRED';
  category: string;
  /** The screen the feature belongs to (tier S only). */
  area: string | null;
  priority: string;
  title: string;
  /** The roadmap batch that delivered it (B1, B2 ...), when built or partly built. */
  batch?: string;
  /** For a partly built requirement: what is built and what is not. */
  note?: string;
}

export { ROADMAP_DATA as ROADMAP } from './roadmap-data.js';
import { ROADMAP_DATA } from './roadmap-data.js';

/** Items shown on (and listed for) one screen. Matching is exact: the area is the screen's own path. */
export const roadmapForArea = (area: string): RoadmapItem[] => ROADMAP_DATA.filter((i) => i.area === area);

export function groupBy<T>(list: readonly T[], key: (t: T) => string): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const t of list) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}
