/** Pure helpers behind the "Your work" home page (kept apart from the components so they can be tested directly). */
import type { RowAccent } from '@if/ui';

export type DayPart = 'morning' | 'afternoon' | 'evening';

export const dayPart = (hour: number): DayPart =>
  hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

/** "Alex Lee" -> "Alex". Falls back to the whole name, then to nothing. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';

export const greeting = (name: string, hour: number): string => {
  const first = firstName(name);
  return `Good ${dayPart(hour)}${first ? `, ${first}` : ''}.`;
};

/** "Tuesday 27 October" (Australian English, no comma). */
export const longDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(d)
    .replace(',', '');

/** "26 Oct 2026". */
export const shortDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

export interface ActionItem {
  key: string;
  kind: string;
  title: string;
  detail: string;
  link: string;
  whatToDo?: string;
}

export interface QueueRow {
  key: string;
  href: string;
  caption: string;
  title: string;
  subtitle: string;
  accent: RowAccent;
  tag?: string;
}

const OVERDUE = /overdue|was due|past due/i;

/** One action item as a queue row: a warm bar and an "Overdue" tag for late things, a cool bar for the rest. */
export function actionRow(i: ActionItem): QueueRow {
  const late = OVERDUE.test(i.kind) || OVERDUE.test(i.detail);
  const blocked = /blocked|breach|failed/i.test(i.kind + ' ' + i.detail);
  return {
    key: i.key,
    href: i.link,
    caption: i.kind,
    title: i.title,
    subtitle: i.detail,
    accent: late ? 'warning' : blocked ? 'error' : 'info',
    ...(late ? { tag: 'Overdue' } : blocked ? { tag: 'Blocked' } : {}),
  };
}

export interface ProcurementLite {
  id: string;
  number: string;
  title: string;
  phase: string;
  status: string;
  estimatedValue: number;
}

/** One procurement as a queue row (the Team and All views). `href` is null when the person's menu does not offer Requests. */
export function procurementRow(
  p: ProcurementLite,
  phaseLabel: (phase: string) => string,
  href: string | null,
): QueueRow {
  return {
    key: `proc:${p.id}`,
    href: href ?? '',
    caption: `Procurement · ${phaseLabel(p.phase)}`,
    title: p.title,
    subtitle: p.number,
    accent: p.status === 'BLOCKED' ? 'error' : p.status === 'COMPLETE' ? 'success' : 'neutral',
    ...(p.status === 'BLOCKED' ? { tag: 'Blocked' } : p.status === 'COMPLETE' ? { tag: 'Complete' } : {}),
  };
}

export const matchesQuery = (r: QueueRow, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  return !needle || `${r.caption} ${r.title} ${r.subtitle}`.toLowerCase().includes(needle);
};

/** Audit events that describe business activity, not sign-in noise. */
const NOISE = /^(auth\.|access\.|session\.|login|logout)/i;
export interface AuditLite {
  seq: number;
  at: string;
  actorName: string | null;
  action: string;
  entityType: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
}

/** "plan.decision" -> "Plan decision". */
export const humaniseAction = (action: string): string => {
  const s = action.replace(/[._-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export interface ActivityLine {
  key: string;
  who: string;
  text: string;
  meta: string;
  at: string;
  href?: string;
}

export function auditLines(rows: readonly AuditLite[], limit: number): ActivityLine[] {
  return rows
    .filter((r) => r.result === 'SUCCESS' && !NOISE.test(r.action))
    .slice(0, limit)
    .map((r) => ({
      key: `audit:${r.seq}`,
      who: r.actorName ?? 'System',
      text: `${humaniseAction(r.action)} (${r.entityType.replace(/_/g, ' ')})`,
      meta: `${r.actorName ?? 'System'} · ${shortDate(r.at)}`,
      at: r.at,
    }));
}

export interface RecentProcurement {
  id: string;
  number: string;
  title: string;
  phase: string;
  status: string;
  updatedAt: string;
}

/** The fallback feed for people who may not read the audit trail: the procurements they can see, newest change first. */
export function procurementLines(
  rows: readonly RecentProcurement[],
  phaseLabel: (phase: string) => string,
  hrefFor: (id: string) => string | undefined,
  limit: number,
): ActivityLine[] {
  return [...rows]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((r) => {
      const href = hrefFor(r.id);
      return {
        key: `proc:${r.id}`,
        who: r.title,
        text: `${r.title} is in ${phaseLabel(r.phase).toLowerCase()}`,
        meta: `${r.number} · ${shortDate(r.updatedAt)}`,
        at: r.updatedAt,
        ...(href ? { href } : {}),
      };
    });
}

export interface NoteLite {
  id: string;
  title: string;
  body?: string;
  link?: string;
  createdAt: string;
}

export const LAST_VISIT_KEY = 'if.home.lastVisit';
/** With no stored visit (first time, or storage blocked) look back this far. */
export const FIRST_LOOK_BACK_MS = 7 * 86_400_000;

/** Reads the last visit; never throws (storage can be blocked). */
export function readLastVisit(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    const v = storage?.getItem(LAST_VISIT_KEY) ?? null;
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}
export function writeLastVisit(storage: Pick<Storage, 'setItem'> | null, now: Date): void {
  try {
    storage?.setItem(LAST_VISIT_KEY, now.toISOString());
  } catch {
    /* not remembered: the page still works */
  }
}

/** What happened since `since` (an ISO time, or null for "recently"), newest first, across the given sources. */
export function sinceLines(
  since: string | null,
  now: Date,
  sources: { notes: readonly NoteLite[]; activity: readonly ActivityLine[] },
): ActivityLine[] {
  const from = since ? Date.parse(since) : now.getTime() - FIRST_LOOK_BACK_MS;
  const notes: ActivityLine[] = sources.notes.map((n) => ({
    key: `note:${n.id}`,
    who: 'System',
    text: n.title,
    meta: `${n.body ? `${n.body} · ` : ''}${shortDate(n.createdAt)}`,
    at: n.createdAt,
    ...(n.link ? { href: n.link } : {}),
  }));
  return [...notes, ...sources.activity]
    .filter((l) => Date.parse(l.at) > from)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** "2 updates", "1 update"; the one-line summary of the panel. */
export const sinceSummary = (n: number, since: string | null): string =>
  n === 0
    ? since
      ? `Nothing new since ${shortDate(since)}.`
      : 'Nothing new in the last week.'
    : `${n} ${n === 1 ? 'update' : 'updates'} ${since ? `since ${shortDate(since)}` : 'in the last week'}.`;
