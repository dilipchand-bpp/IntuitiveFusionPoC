/**
 * Foreign currency and exchange rates (FR-0810). Money is kept in the organisation's base currency everywhere that adds it
 * up; the amount a person typed, its currency and the rate used are kept beside it, so the original is never lost and
 * the conversion can be shown. Rates are "units of base currency for one unit of the foreign currency" on a date.
 */
export const FX_MODEL = 'rules-simulated-v1';
export const SUPPORTED = ['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'JPY', 'SGD'] as const;
export type Currency = (typeof SUPPORTED)[number];

export interface Rate {
  currency: string;
  /** Base currency per one unit of `currency`. */
  rate: number;
  asOf: string;
  source: 'ANNUAL' | 'LIVE' | 'MANUAL';
}

/** The Australian financial year (1 July to 30 June) a date falls in, named by the year it ends. */
export const financialYear = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? y + 1 : y;
};
export const fyStart = (fy: number) => `${fy - 1}-07-01`;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * The rate to use on a date. In ANNUAL mode it is the one set for the financial year the date falls in (the latest one
 * set on or before the date within that year); in LIVE mode, the most recent rate on or before the date. No rate means
 * the amount cannot be converted, and the caller must say so rather than guess.
 */
export function rateOn(rates: Rate[], currency: string, date: string, mode: 'ANNUAL' | 'LIVE'): Rate | null {
  const mine = rates
    .filter((r) => r.currency === currency && r.asOf <= date)
    .sort((a, b) => (a.asOf < b.asOf ? 1 : -1));
  if (mode === 'LIVE') return mine[0] ?? null;
  // a rate from the live feed is never used for an annual rate, even if the setting was switched back
  const fy = financialYear(date);
  return mine.find((r) => r.source !== 'LIVE' && financialYear(r.asOf) === fy) ?? null;
}

export interface Converted {
  base: number;
  original: number;
  currency: string;
  rate: number;
  asOf: string | null;
}

export function toBase(
  amount: number,
  currency: string,
  baseCurrency: string,
  rate: Rate | null,
): Converted | null {
  if (currency === baseCurrency)
    return { base: round(amount), original: amount, currency, rate: 1, asOf: null };
  if (!rate) return null;
  return { base: round(amount * rate.rate), original: amount, currency, rate: rate.rate, asOf: rate.asOf };
}

/** Converts between any two supported currencies by way of the base currency. */
export function convert(
  amount: number,
  from: string,
  to: string,
  baseCurrency: string,
  rates: Rate[],
  date: string,
  mode: 'ANNUAL' | 'LIVE',
): { amount: number; via: string } | null {
  if (from === to) return { amount, via: 'same currency' };
  const a = from === baseCurrency ? 1 : rateOn(rates, from, date, mode)?.rate;
  const b = to === baseCurrency ? 1 : rateOn(rates, to, date, mode)?.rate;
  if (!a || !b) return null;
  return { amount: round((amount * a) / b, to === 'JPY' ? 0 : 2), via: baseCurrency };
}

/** True when an amount was entered in a currency other than the base (AUD), which decides whose delegation applies. */
export const isForeign = (currency: string | null | undefined) => (currency ?? 'AUD') !== 'AUD';

/** Where a request is local or international spend, which decides whose delegation applies. */
export const isInternational = (currency: string, baseCurrency: string) => currency !== baseCurrency;

/**
 * A stand-in for a live market feed: each day each currency moves a little from its anchor, the same way every time, so a
 * demonstration and a test see the same numbers. A real adapter reads a rates provider and returns the same shape.
 */
export function simulatedLiveRate(currency: string, anchor: number, date: string): number {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  let h = 0;
  for (const c of currency) h = (h * 31 + c.charCodeAt(0)) % 997;
  const wave = Math.sin((day + h) / 7) * 0.012 + Math.sin((day + h * 3) / 23) * 0.02;
  return round(anchor * (1 + wave), 6);
}

/** Starting points for the simulated feed and the annual rates the seed sets (base AUD). */
export const ANCHORS: Record<string, number> = {
  USD: 1.52,
  EUR: 1.65,
  GBP: 1.94,
  NZD: 0.91,
  JPY: 0.0101,
  SGD: 1.14,
};
