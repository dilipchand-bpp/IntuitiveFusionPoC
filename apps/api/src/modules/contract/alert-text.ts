/**
 * Plain-language custom alerts (US-CMG-03), e.g. "alert me 1 year before expiry and include whoever is my manager
 * then". A small, deterministic grammar, not AI: a lead time, an anchor date of the contract, and who else to include.
 */
import { addDays, addMonths } from './dates.js';

export type Anchor = 'EXPIRY' | 'NOTICE' | 'START';

export interface ParsedAlert {
  triggerDate: string;
  anchor: Anchor;
  /** Who else gets it, resolved when the alert fires. The author always does. */
  include: Array<'MANAGER' | `ROLE:${string}`>;
  recipientRule: string;
  summary: string;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};
export const INCLUDE_ROLES: Record<string, string> = {
  legal: 'LEGAL',
  procurement: 'PROCUREMENT',
  finance: 'FINANCE',
  executive: 'EXEC',
  exec: 'EXEC',
  delegate: 'DELEGATE',
  'contract manager': 'CONTRACT_MGR',
};

export const ALERT_HELP =
  'Try: "alert me 3 months before expiry", "alert me 2 weeks before the notice deadline and include legal", or "alert me 1 year before expiry and include whoever is my manager then".';

export function parseAlert(
  text: string,
  c: { startDate: string; endDate: string; noticeDays: number },
  today: string,
): { ok: true; value: ParsedAlert } | { ok: false; message: string } {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const m =
    /(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(day|week|month|year)s?\s+(before|after)\s+(?:the\s+)?(expiry|expiration|end|notice(?:\s+(?:deadline|date|period))?|start|commencement)/.exec(
      s,
    );
  if (!m)
    return { ok: false, message: `I could not find a lead time and a date to count from. ${ALERT_HELP}` };
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : (NUMBER_WORDS[m[1]!] ?? 0);
  if (n < 1 || n > 1000) return { ok: false, message: `The amount of time is out of range. ${ALERT_HELP}` };
  const unit = m[2]!;
  const sign = m[3] === 'before' ? -1 : 1;
  const word = m[4]!;
  const anchor: Anchor = word.startsWith('notice')
    ? 'NOTICE'
    : word.startsWith('start') || word.startsWith('comm')
      ? 'START'
      : 'EXPIRY';
  const base =
    anchor === 'START' ? c.startDate : anchor === 'NOTICE' ? addDays(c.endDate, -c.noticeDays) : c.endDate;
  const shift = sign * n;
  const triggerDate =
    unit === 'day'
      ? addDays(base, shift)
      : unit === 'week'
        ? addDays(base, shift * 7)
        : unit === 'month'
          ? addMonths(base, shift)
          : addMonths(base, shift * 12);
  if (triggerDate < today)
    return { ok: false, message: `That date (${triggerDate}) has already passed. Choose a later date.` };

  const include: ParsedAlert['include'] = [];
  if (/(?<!contract )\bmanager\b/.test(s) && /\binclude|\bcc\b|\balso (tell|notify|alert)/.test(s))
    include.push('MANAGER');
  for (const [name, role] of Object.entries(INCLUDE_ROLES)) {
    if (
      new RegExp(`\\b(include|cc|also (tell|notify|alert))\\s+(the\\s+)?${name}\\b`).test(s) &&
      !include.includes(`ROLE:${role}`)
    )
      include.push(`ROLE:${role}`);
  }
  const rule = ['AUTHOR', ...include].join('+');
  const what =
    anchor === 'EXPIRY' ? 'expiry' : anchor === 'NOTICE' ? 'the notice deadline' : 'the start date';
  const who = include.length
    ? ` and ${include.map((i) => (i === 'MANAGER' ? 'your manager' : i.slice(5).toLowerCase().replace('_', ' '))).join(', ')}`
    : '';
  return {
    ok: true,
    value: {
      triggerDate,
      anchor,
      include,
      recipientRule: rule,
      summary: `${n} ${unit}${n > 1 ? 's' : ''} ${m[3]} ${what} (${triggerDate}), to you${who}`,
    },
  };
}
