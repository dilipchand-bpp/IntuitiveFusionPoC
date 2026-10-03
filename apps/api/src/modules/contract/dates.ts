/**
 * Date rules of contract management (M11). Pure functions on ISO dates (YYYY-MM-DD, UTC), so month ends and leap
 * years are handled in one place and tested without a database.
 */

export const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

export const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * 86_400_000));

export const daysBetween = (from: string, to: string) =>
  Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);

/** Adds calendar months; a day that does not exist in the target month moves to its last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: string, months: number): string {
  const d = parse(s);
  const day = d.getUTCDate();
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

export type AlertKind = 'EXPIRY' | 'NOTICE' | 'MILESTONE' | 'EXTENSION';

/** Days before the end date that the expiry warning goes out. */
export const EXPIRY_LEAD_DAYS = 60;
/** The notice alert goes out this many days before the notice deadline (so 90 days notice = 150 days before the end). */
export const NOTICE_LEAD_DAYS = 60;
/** Days before an extension notice deadline that the decision reminder goes out. */
export const EXTENSION_LEAD_DAYS = 30;
/** Days before a milestone is due. */
export const MILESTONE_LEAD_DAYS = 14;

/** Lead times of the system alerts; a tenant can change them (settings), these are the defaults. */
export interface LeadDays {
  expiry: number;
  notice: number;
  extension: number;
  milestone: number;
}
export const DEFAULT_LEADS: LeadDays = {
  expiry: EXPIRY_LEAD_DAYS,
  notice: NOTICE_LEAD_DAYS,
  extension: EXTENSION_LEAD_DAYS,
  milestone: MILESTONE_LEAD_DAYS,
};

/** Reads lead times from a tenant config object, ignoring anything that is not a whole number of days from 1 to 365. */
export function leadsFrom(config: unknown): LeadDays {
  const c = ((config as { alertLeadDays?: Partial<Record<keyof LeadDays, unknown>> } | null)?.alertLeadDays ??
    {}) as Partial<Record<keyof LeadDays, unknown>>;
  const ok = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365 ? v : d;
  return {
    expiry: ok(c.expiry, DEFAULT_LEADS.expiry),
    notice: ok(c.notice, DEFAULT_LEADS.notice),
    extension: ok(c.extension, DEFAULT_LEADS.extension),
    milestone: ok(c.milestone, DEFAULT_LEADS.milestone),
  };
}

export interface ScheduleInput {
  endDate: string;
  noticeDays: number;
  milestones: Array<{ title: string; dueDate: string }>;
  extensions: number[];
}
export interface ScheduledAlert {
  kind: AlertKind;
  triggerDate: string;
}

/**
 * The system alerts for a contract. Notice and expiry are always scheduled (a late warning beats none: if the date has
 * passed the alert fires on the next run). Milestone and extension reminders whose date has passed are dropped.
 */
export function scheduleAlerts(
  i: ScheduleInput,
  today: string,
  leads: LeadDays = DEFAULT_LEADS,
): ScheduledAlert[] {
  const out: ScheduledAlert[] = [
    { kind: 'NOTICE', triggerDate: addDays(i.endDate, -(i.noticeDays + leads.notice)) },
    { kind: 'EXPIRY', triggerDate: addDays(i.endDate, -leads.expiry) },
  ];
  if (i.extensions.length)
    out.push({
      kind: 'EXTENSION',
      triggerDate: addDays(i.endDate, -(i.noticeDays + leads.extension)),
    });
  for (const m of i.milestones)
    out.push({ kind: 'MILESTONE', triggerDate: addDays(m.dueDate, -leads.milestone) });
  const seen = new Set<string>();
  return out
    .filter((a) => a.kind === 'NOTICE' || a.kind === 'EXPIRY' || a.triggerDate >= today)
    .filter((a) => {
      const k = `${a.kind}:${a.triggerDate}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.triggerDate.localeCompare(b.triggerDate));
}

/** Milestones every contract record starts with: commencement and a review half way through the term. */
export function defaultMilestones(startDate: string, endDate: string) {
  const mid = addDays(startDate, Math.floor(daysBetween(startDate, endDate) / 2));
  return [
    { title: 'Commencement', dueDate: startDate },
    { title: 'Mid-term review', dueDate: mid },
  ];
}

/** Initial term and each optional extension laid end to end, for the Gantt chart. */
export function termBars(startDate: string, endDate: string, extensions: number[]) {
  const bars = [{ label: 'Initial term', start: startDate, end: endDate, optional: false }];
  let from = endDate;
  extensions.forEach((m, i) => {
    const to = addMonths(from, m);
    bars.push({ label: `Option ${i + 1} (${m} months)`, start: from, end: to, optional: true });
    from = to;
  });
  return bars;
}
