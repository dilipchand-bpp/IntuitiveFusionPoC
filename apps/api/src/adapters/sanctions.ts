/**
 * Sanctions and watchlist screening for supplier onboarding (FR-0180). SWAP POINT (docs/swap-points.md): the real
 * service calls a screening provider (OFAC, EU, UN and similar lists); this one matches against a small SYNTHETIC list so
 * the whole flow (hold, review, release) can be shown and tested. The interface is what a real adapter keeps.
 */
export interface ScreeningResult {
  status: 'CLEAR' | 'MATCH';
  /** Which list matched, when one did. */
  list?: string;
  reason?: string;
}

export interface SanctionsScreening {
  readonly simulated: boolean;
  screen(input: { company: string; abn: string }): Promise<ScreeningResult>;
}

/** Synthetic names only: none of these is a real organisation. */
const WATCHLIST: Array<{ needle: string; list: string }> = [
  { needle: 'blocked holdings', list: 'SYNTHETIC-WATCHLIST-A' },
  { needle: 'sanctioned trading', list: 'SYNTHETIC-WATCHLIST-B' },
  { needle: 'embargo exports', list: 'SYNTHETIC-WATCHLIST-C' },
];

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export class MockSanctionsScreening implements SanctionsScreening {
  readonly simulated = true;
  async screen(input: { company: string; abn: string }): Promise<ScreeningResult> {
    const name = normalise(input.company);
    const hit = WATCHLIST.find((w) => name.includes(w.needle));
    return hit
      ? { status: 'MATCH', list: hit.list, reason: `The company name matches an entry on ${hit.list}` }
      : { status: 'CLEAR' };
  }
}
