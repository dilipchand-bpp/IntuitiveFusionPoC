/**
 * Field population from in-house data and periodically refreshed outside content (NFR-R03).
 *
 * An outside content pack is a versioned set of items (taxonomy codes, market benchmarks, standard risks, clause references,
 * ESG reference) held per tenant. A refresh asks the outside source for a release through the resilient provider layer
 * (`callProvider`, connector kind MIDDLEWARE, provider SIMULATED_CONTENT) and replaces the items, keeping what was added,
 * changed and removed. A pack that is past `valid_until`, or whose last refresh failed with nothing usable before it, is not
 * used: the field is populated from in-house data alone and says so.
 *
 * Every populated field carries its source: IN_HOUSE (the platform's own records), OUTSIDE_PACK (a pack, with its name and
 * version) or BOTH.
 */
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import type { AuditService } from '../../audit/audit-service.js';
import { canonical } from '../../audit/audit-service.js';
import { createHash } from 'node:crypto';
import { withSystem, type Database, type RequestContext, type Tx } from '../../db/client.js';
import {
  contentItem,
  contentPack,
  CONTENT_KINDS,
  request,
  tenant,
  type ContentKind,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { callProvider } from '../b10conn/resilience.js';
import { classifyCategory, type Taxonomy, type TaxonomyResult } from '../intake/classify.js';
import { loadSettings, type Settings } from '../settings/settings.js';
import { LATEST_VERSION, fetchContentRelease, type ContentRelease } from './content-source.js';

export type PackState = 'CURRENT' | 'STALE' | 'FAILED' | 'NONE';
type PackRow = typeof contentPack.$inferSelect;

export const KIND_LABEL: Record<ContentKind, string> = {
  UNSPSC_TAXONOMY: 'UNSPSC taxonomy',
  MARKET_BENCHMARKS: 'Market price benchmarks',
  RISK_LIBRARY: 'Standard risk library',
  CLAUSE_REFERENCE: 'Legal clause references',
  ESG_REFERENCE: 'ESG reference content',
};
export const KIND_USE: Record<ContentKind, string> = {
  UNSPSC_TAXONOMY: 'Suggests a classification code when a request names what it buys.',
  MARKET_BENCHMARKS: 'Shows a market price range beside the estimate on the plan.',
  RISK_LIBRARY: 'Adds standard risk statements to the candidate risks of a procurement.',
  CLAUSE_REFERENCE: 'Reference for Legal when choosing clause wording.',
  ESG_REFERENCE: 'Reference for the ESG and socio-economic targets of a plan.',
};

/** A pack in force: the state the user sees (a CURRENT pack past its end date is STALE). */
export function stateOf(
  pack: Pick<PackRow, 'status' | 'validUntil'> | null | undefined,
  now: Date,
): PackState {
  if (!pack) return 'NONE';
  if (pack.status === 'FAILED') return 'FAILED';
  if (pack.status === 'STALE') return 'STALE';
  if (pack.validUntil && now.getTime() > pack.validUntil.getTime()) return 'STALE';
  return 'CURRENT';
}

const DAY = 86_400_000;
const checksumOf = (items: Array<{ key: string; label: string; data: unknown }>) =>
  createHash('sha256')
    .update(canonical([...items].sort((a, b) => a.key.localeCompare(b.key))))
    .digest('hex');

export interface PackView {
  kind: ContentKind;
  label: string;
  use: string;
  state: PackState;
  version: number | null;
  latestAvailable: number;
  sourceName: string | null;
  sourceUrl: string | null;
  refreshedAt: string | null;
  validUntil: string | null;
  itemCount: number;
  checksum: string | null;
  lastDiff: { added: string[]; changed: string[]; removed: string[] } | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  fallbackNote: string | null;
}

const EMPTY_DIFF = { added: [] as string[], changed: [] as string[], removed: [] as string[] };

export function fallbackNote(
  kind: ContentKind,
  state: PackState,
  pack: PackRow | null,
  settings: Pick<Settings, 'content'>,
): string | null {
  if (!settings.content.useOutsideContent)
    return 'Outside content is switched off in settings, so fields use in-house data only.';
  if (state === 'CURRENT') return null;
  const name = KIND_LABEL[kind];
  if (state === 'NONE')
    return `No outside content has been loaded for ${name} yet, so in-house data only is used.`;
  if (state === 'FAILED')
    return `The last refresh of ${name} failed${pack?.lastError ? ` (${pack.lastError})` : ''}, so in-house data only is used.`;
  return `${name} is stale${pack?.validUntil ? ` (valid until ${pack.validUntil.toISOString().slice(0, 10)})` : ''}, so in-house data only is used until it is refreshed.`;
}

export async function listPacks(
  tx: Tx,
  tenantId: string,
  now: Date,
  settings: Settings,
): Promise<PackView[]> {
  const rows = await tx.select().from(contentPack).where(eq(contentPack.tenantId, tenantId));
  return CONTENT_KINDS.map((kind) => {
    const pack = rows.find((r) => r.kind === kind) ?? null;
    const state = stateOf(pack, now);
    return {
      kind,
      label: KIND_LABEL[kind],
      use: KIND_USE[kind],
      state,
      version: pack?.version ?? null,
      latestAvailable: LATEST_VERSION,
      sourceName: pack?.sourceName ?? null,
      sourceUrl: pack?.sourceUrl ?? null,
      refreshedAt: pack?.refreshedAt?.toISOString() ?? null,
      validUntil: pack?.validUntil?.toISOString() ?? null,
      itemCount: pack?.itemCount ?? 0,
      checksum: pack?.checksum ?? null,
      lastDiff: pack ? ({ ...EMPTY_DIFF, ...(pack.lastDiff as object) } as PackView['lastDiff']) : null,
      lastError: pack?.lastError ?? null,
      lastAttemptAt: pack?.lastAttemptAt?.toISOString() ?? null,
      fallbackNote: fallbackNote(kind, state, pack, settings),
    };
  });
}

// ------------------------------------------------------------------ refresh
export interface RefreshResult {
  kind: ContentKind;
  outcome: 'UPDATED' | 'UNCHANGED' | 'FAILED';
  fromVersion: number | null;
  toVersion: number | null;
  diff: { added: string[]; changed: string[]; removed: string[] };
  error?: string;
  state: PackState;
}

export interface RefreshDeps {
  clock: Clock;
  audit: AuditService;
  /** The source of releases; the simulated one by default. */
  fetchRelease?: (kind: ContentKind, version: number) => Promise<ContentRelease>;
}

/**
 * Asks the outside source for the next release (or `toVersion`) of one pack and applies it. Applying the same release twice
 * changes nothing. A failed call leaves the items as they were.
 */
export async function refreshPack(
  tx: Tx,
  d: RefreshDeps,
  ctx: RequestContext,
  kind: ContentKind,
  opts: { toVersion?: number | undefined; validDays: number },
): Promise<RefreshResult> {
  const now = d.clock.now();
  const [pack] = await tx
    .select()
    .from(contentPack)
    .where(and(eq(contentPack.tenantId, ctx.tenantId), eq(contentPack.kind, kind)));
  const from = pack && pack.version > 0 ? pack.version : null;
  const target = opts.toVersion ?? Math.min((from ?? 0) + 1, LATEST_VERSION);
  if (from !== null && target < from)
    throw new AppError(
      422,
      'VERSION_OLDER',
      `The pack is already at version ${from}; a refresh cannot go back to version ${target}`,
    );
  if (target > LATEST_VERSION)
    throw new AppError(
      422,
      'VERSION_UNAVAILABLE',
      `The source has published up to version ${LATEST_VERSION}`,
    );
  const fetchRelease = d.fetchRelease ?? fetchContentRelease;
  const call = await callProvider<ContentRelease | null>(
    tx,
    { clock: d.clock },
    ctx.tenantId,
    'MIDDLEWARE',
    () => fetchRelease(kind, target),
    { fallback: () => null, retries: 1 },
  );
  if (!call.ok || !call.value) {
    const error = call.ok ? 'The source returned nothing' : call.error;
    const usable = pack && pack.version > 0;
    const still = usable && pack.validUntil && now.getTime() <= pack.validUntil.getTime();
    // a failed refresh keeps what is held; the pack only turns STALE or FAILED when nothing in date is left
    const status = !usable ? 'FAILED' : still ? pack.status : 'STALE';
    if (pack)
      await tx
        .update(contentPack)
        .set({ status, lastError: error.slice(0, 300), lastAttemptAt: now })
        .where(eq(contentPack.id, pack.id));
    else
      await tx.insert(contentPack).values({
        tenantId: ctx.tenantId,
        kind,
        version: 0,
        sourceName: 'Not yet loaded',
        sourceUrl: 'https://not-loaded.simulated.test/',
        status: 'FAILED',
        lastError: error.slice(0, 300),
        lastAttemptAt: now,
      });
    await d.audit.record(tx, ctx, {
      action: 'content.refresh',
      entityType: 'content_pack',
      entityId: pack?.id ?? null,
      after: { kind, outcome: 'FAILED', error: error.slice(0, 200) },
      result: 'FAILED',
    });
    const after = (
      await tx
        .select()
        .from(contentPack)
        .where(and(eq(contentPack.tenantId, ctx.tenantId), eq(contentPack.kind, kind)))
    )[0]!;
    return {
      kind,
      outcome: 'FAILED',
      fromVersion: from,
      toVersion: from,
      diff: { ...EMPTY_DIFF },
      error,
      state: stateOf(after, now),
    };
  }

  const rel = call.value;
  const existing = pack ? await tx.select().from(contentItem).where(eq(contentItem.packId, pack.id)) : [];
  const held = new Map(existing.map((i) => [i.itemKey, i]));
  const next = new Map(rel.items.map((i) => [i.key, i]));
  const diff = { added: [] as string[], changed: [] as string[], removed: [] as string[] };
  for (const [key, item] of next) {
    const was = held.get(key);
    if (!was) diff.added.push(key);
    else if (was.label !== item.label || canonical(was.data) !== canonical(item.data)) diff.changed.push(key);
  }
  for (const key of held.keys()) if (!next.has(key)) diff.removed.push(key);
  const unchanged =
    pack &&
    pack.version === rel.version &&
    !diff.added.length &&
    !diff.changed.length &&
    !diff.removed.length;

  const validUntil = new Date(now.getTime() + opts.validDays * DAY);
  const header = {
    version: rel.version,
    sourceName: rel.sourceName,
    sourceUrl: rel.sourceUrl,
    refreshedAt: now,
    validUntil,
    status: 'CURRENT' as const,
    itemCount: rel.items.length,
    checksum: checksumOf(rel.items),
    lastError: null,
    lastAttemptAt: now,
    refreshedBy: ctx.userId,
  };
  let packId: string;
  if (!pack) {
    const [row] = await tx
      .insert(contentPack)
      .values({ tenantId: ctx.tenantId, kind, ...header, lastDiff: diff })
      .returning({ id: contentPack.id });
    packId = row!.id;
  } else {
    packId = pack.id;
    await tx
      .update(contentPack)
      .set({ ...header, lastDiff: unchanged ? (pack.lastDiff as object) : diff })
      .where(eq(contentPack.id, pack.id));
  }
  for (const key of diff.removed)
    await tx.delete(contentItem).where(and(eq(contentItem.packId, packId), eq(contentItem.itemKey, key)));
  for (const key of [...diff.added, ...diff.changed]) {
    const item = next.get(key)!;
    await tx
      .insert(contentItem)
      .values({ tenantId: ctx.tenantId, packId, kind, itemKey: key, label: item.label, data: item.data })
      .onConflictDoUpdate({
        target: [contentItem.packId, contentItem.itemKey],
        set: { label: item.label, data: item.data },
      });
  }
  await d.audit.record(tx, ctx, {
    action: 'content.refresh',
    entityType: 'content_pack',
    entityId: packId,
    before: { version: from },
    after: {
      kind,
      version: rel.version,
      outcome: unchanged ? 'UNCHANGED' : 'UPDATED',
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removed.length,
    },
  });
  return {
    kind,
    outcome: unchanged ? 'UNCHANGED' : 'UPDATED',
    fromVersion: from,
    toVersion: rel.version,
    diff: unchanged ? { ...EMPTY_DIFF } : diff,
    state: 'CURRENT',
  };
}

/** The packs that are due: never loaded, or last refreshed `refreshDays` ago or more. */
export async function dueKinds(
  tx: Tx,
  tenantId: string,
  now: Date,
  settings: Settings,
): Promise<ContentKind[]> {
  const rows = await tx.select().from(contentPack).where(eq(contentPack.tenantId, tenantId));
  return CONTENT_KINDS.filter((k) => {
    const r = rows.find((x) => x.kind === k);
    if (!r || r.version === 0) return true;
    if (r.status === 'FAILED') return true;
    return !r.refreshedAt || now.getTime() - r.refreshedAt.getTime() >= settings.content.refreshDays * DAY;
  });
}

/** The scheduled run: every tenant's due packs. Never throws; a tenant that fails is skipped. */
export async function runContentSchedule(database: Database, d: RefreshDeps): Promise<number> {
  const now = d.clock.now();
  const tenants = await withSystem(database, (tx) => tx.select({ id: tenant.id }).from(tenant));
  let n = 0;
  for (const t of tenants) {
    try {
      await withSystem(database, async (tx) => {
        const settings = await loadSettings(tx, t.id);
        if (!settings.content.useOutsideContent) return;
        const ctx: RequestContext = { tenantId: t.id, userId: null, role: 'SYSTEM' };
        for (const kind of await dueKinds(tx, t.id, now, settings)) {
          const r = await refreshPack(tx, d, ctx, kind, { validDays: settings.content.validDays });
          if (r.outcome === 'UPDATED') n += 1;
        }
      });
    } catch {
      // next tick tries again
    }
  }
  return n;
}

// ------------------------------------------------------------------ population
export type SourceKind = 'IN_HOUSE' | 'OUTSIDE_PACK' | 'BOTH';
export interface PopulationSource {
  kind: SourceKind;
  /** Plain words for the chip: "In-house", "Outside content: UNSPSC taxonomy v3" or both. */
  label: string;
  pack: { kind: ContentKind; name: string; version: number; refreshedAt: string | null } | null;
  /** Why the outside pack was not used, when it was not. */
  note: string | null;
}

interface Usable {
  pack: PackRow | null;
  items: Array<typeof contentItem.$inferSelect>;
  note: string | null;
}

/** The pack for a kind when it may be used (current, and the setting allows it); otherwise null with the reason. */
export async function usablePack(
  tx: Tx,
  tenantId: string,
  kind: ContentKind,
  now: Date,
  settings: Settings,
): Promise<Usable> {
  const [pack] = await tx
    .select()
    .from(contentPack)
    .where(and(eq(contentPack.tenantId, tenantId), eq(contentPack.kind, kind)));
  const state = stateOf(pack, now);
  const note = fallbackNote(kind, state, pack ?? null, settings);
  if (note || !pack) return { pack: null, items: [], note };
  const items = await tx.select().from(contentItem).where(eq(contentItem.packId, pack.id));
  return { pack, items, note: null };
}

const packRef = (p: PackRow) => ({
  kind: p.kind as ContentKind,
  name: p.sourceName,
  version: p.version,
  refreshedAt: p.refreshedAt?.toISOString() ?? null,
});
const packLabel = (p: PackRow) => `${KIND_LABEL[p.kind as ContentKind]} v${p.version}`;

export function sourceOf(inHouse: boolean, u: Usable): PopulationSource {
  if (inHouse && u.pack)
    return {
      kind: 'BOTH',
      label: `In-house and outside content: ${packLabel(u.pack)}`,
      pack: packRef(u.pack),
      note: null,
    };
  if (u.pack)
    return {
      kind: 'OUTSIDE_PACK',
      label: `Outside content: ${packLabel(u.pack)}`,
      pack: packRef(u.pack),
      note: null,
    };
  return { kind: 'IN_HOUSE', label: 'In-house', pack: null, note: u.note };
}

// --- taxonomy
export interface TaxonomySuggestion {
  scheme: Taxonomy;
  code: string;
  label: string;
  category: string;
  source: PopulationSource;
  inHouse: TaxonomyResult | null;
  outside: { code: string; label: string; category: string } | null;
  /** True when both gave a code and the codes differ: the outside code is shown and the in-house one is listed beside it. */
  differs: boolean;
}

export async function suggestTaxonomy(
  tx: Tx,
  tenantId: string,
  category: string | null | undefined,
  scheme: Taxonomy,
  now: Date,
  settings: Settings,
): Promise<TaxonomySuggestion | null> {
  const inHouse = classifyCategory(category, scheme);
  // the outside pack is a UNSPSC registry, so it applies only when the tenant classifies by UNSPSC
  const u: Usable =
    scheme === 'UNSPSC'
      ? await usablePack(tx, tenantId, 'UNSPSC_TAXONOMY', now, settings)
      : { pack: null, items: [], note: null };
  const q = (category ?? '').trim().toLowerCase();
  const hit = q
    ? u.items
        .map((i) => ({ i, c: String((i.data as { category?: string }).category ?? '').toLowerCase() }))
        .filter((x) => x.c && (q.startsWith(x.c) || x.c.startsWith(q)))
        .sort((a, b) => b.c.length - a.c.length)[0]?.i
    : undefined;
  const outside = hit
    ? {
        code: String((hit.data as { code: string }).code),
        label: hit.label,
        category: String((hit.data as { category: string }).category),
      }
    : null;
  if (!inHouse && !outside) return null;
  const chosen = outside ?? inHouse!;
  return {
    scheme,
    code: chosen.code,
    label: chosen.label,
    category: chosen.category,
    source: outside ? sourceOf(Boolean(inHouse), u) : sourceOf(true, { pack: null, items: [], note: u.note }),
    inHouse,
    outside,
    differs: Boolean(inHouse && outside && inHouse.code !== outside.code),
  };
}

// --- market benchmark
export interface BenchmarkHint {
  category: string;
  inHouse: { count: number; min: number; median: number; max: number } | null;
  outside: { low: number; median: number; high: number; unit: string; basis: string } | null;
  annualEstimate: number | null;
  verdict: 'BELOW' | 'WITHIN' | 'ABOVE' | null;
  text: string;
  source: PopulationSource;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

export async function benchmarkFor(
  tx: Tx,
  tenantId: string,
  facts: {
    requestId: string;
    category: string | null;
    estimatedValue: number | null;
    termMonths: number | null;
  },
  now: Date,
  settings: Settings,
): Promise<BenchmarkHint | null> {
  const category = (facts.category ?? '').trim();
  if (!category) return null;
  // in-house: what this organisation has asked for before in the same category (other requests, with a value)
  const past = await tx
    .select({ v: request.estimatedValue })
    .from(request)
    .where(
      and(
        eq(request.tenantId, tenantId),
        ne(request.id, facts.requestId),
        isNotNull(request.estimatedValue),
        sql`lower(${request.category}) = ${category.toLowerCase()}`,
      ),
    )
    .orderBy(desc(request.createdAt))
    .limit(50);
  const values = past.map((r) => Number(r.v)).filter((n) => n > 0);
  const inHouse = values.length
    ? { count: values.length, min: Math.min(...values), median: median(values), max: Math.max(...values) }
    : null;
  const u = await usablePack(tx, tenantId, 'MARKET_BENCHMARKS', now, settings);
  const q = category.toLowerCase();
  const hit = u.items
    .map((i) => ({ i, c: String((i.data as { category?: string }).category ?? '').toLowerCase() }))
    .filter((x) => x.c && (q.startsWith(x.c) || x.c.startsWith(q)))
    .sort((a, b) => b.c.length - a.c.length)[0]?.i;
  const d = hit?.data as
    { low: number; median: number; high: number; unit: string; basis: string } | undefined;
  const outside = d ? { low: d.low, median: d.median, high: d.high, unit: d.unit, basis: d.basis } : null;
  if (!inHouse && !outside) return null;
  const annual =
    facts.estimatedValue && facts.termMonths
      ? Math.round((facts.estimatedValue / facts.termMonths) * 12)
      : (facts.estimatedValue ?? null);
  const perYear = outside?.unit === 'AUD per year';
  const compare = outside ? (perYear ? annual : facts.estimatedValue) : null;
  const verdict =
    outside && compare !== null
      ? compare < outside.low
        ? ('BELOW' as const)
        : compare > outside.high
          ? ('ABOVE' as const)
          : ('WITHIN' as const)
      : null;
  const parts: string[] = [];
  if (outside)
    parts.push(
      `Market benchmark for ${category}: ${aud.format(outside.low)} to ${aud.format(outside.high)} (${outside.unit.replace('AUD ', '')}, median ${aud.format(outside.median)}).${
        verdict && compare !== null
          ? ` The estimate of ${aud.format(compare)}${perYear ? ' a year' : ''} is ${verdict === 'WITHIN' ? 'within' : verdict === 'BELOW' ? 'below' : 'above'} that range.`
          : ''
      }`,
    );
  if (inHouse)
    parts.push(
      `In-house: ${inHouse.count} earlier request${inHouse.count === 1 ? '' : 's'} in this category, median ${aud.format(inHouse.median)} (${aud.format(inHouse.min)} to ${aud.format(inHouse.max)}).`,
    );
  if (!outside && u.note) parts.push(u.note);
  return {
    category,
    inHouse,
    outside,
    annualEstimate: annual,
    verdict,
    text: parts.join(' '),
    source: sourceOf(Boolean(inHouse), outside ? u : { ...u, pack: null }),
  };
}

// --- risk library
export interface LibraryRisk {
  key: string;
  title: string;
  description: string;
  options: string[];
  source: PopulationSource;
}

/** Standard risk statements that apply to this procurement, from the library pack (none when it is stale or not loaded). */
export async function libraryRisks(
  tx: Tx,
  tenantId: string,
  facts: { category: string; text: string },
  now: Date,
  settings: Settings,
): Promise<{ risks: LibraryRisk[]; note: string | null; source: PopulationSource }> {
  const u = await usablePack(tx, tenantId, 'RISK_LIBRARY', now, settings);
  const hay = `${facts.category} ${facts.text}`.toLowerCase();
  const risks = u.items
    .filter((i) => {
      try {
        return new RegExp((i.data as { appliesTo: string }).appliesTo, 'i').test(hay);
      } catch {
        return false;
      }
    })
    .map((i) => {
      const d = i.data as { title: string; description: string; options: string[] };
      return {
        key: `lib-${i.itemKey}`,
        title: d.title,
        description: d.description,
        options: d.options,
        source: sourceOf(false, u),
      };
    });
  return { risks, note: u.note, source: sourceOf(true, u) };
}

/** The source of each item of a drafted risk assessment: a `lib-` key came from the risk library pack, the rest from the platform's own rules. */
export async function riskSources(tx: Tx, tenantId: string): Promise<(key: string) => PopulationSource> {
  const [pack] = await tx
    .select()
    .from(contentPack)
    .where(and(eq(contentPack.tenantId, tenantId), eq(contentPack.kind, 'RISK_LIBRARY')));
  return (key) =>
    key.startsWith('lib-') && pack
      ? {
          kind: 'OUTSIDE_PACK',
          label: `Outside content: ${packLabel(pack)}`,
          pack: packRef(pack),
          note: null,
        }
      : { kind: 'IN_HOUSE', label: 'In-house', pack: null, note: null };
}
