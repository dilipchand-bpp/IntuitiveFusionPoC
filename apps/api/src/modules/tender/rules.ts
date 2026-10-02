import { createHash } from 'node:crypto';

export type TenderStatus = 'DRAFT' | 'STAGED' | 'PUBLISHED' | 'CLOSED' | 'EVALUATING' | 'AWARDED';
const DAY_MS = 86_400_000;

/** A published tender whose closing time has passed is closed, whether or not the stored row has been updated yet. */
export function effectiveStatus(status: TenderStatus, closesAt: Date | null, now: Date): TenderStatus {
  return status === 'PUBLISHED' && closesAt && now.getTime() >= closesAt.getTime() ? 'CLOSED' : status;
}

export const isOpenForBids = (status: TenderStatus, closesAt: Date | null, now: Date) =>
  effectiveStatus(status, closesAt, now) === 'PUBLISHED';

export interface WindowCheck {
  ok: boolean;
  days: number;
  minDays: number;
}

/** Statutory minimum between publication and close (US-TND-04). Whole days, rounded down: 24.9 days is not 25. */
export function validateWindow(publishAt: Date, closesAt: Date, minDays: number): WindowCheck {
  const days = Math.floor((closesAt.getTime() - publishAt.getTime()) / DAY_MS);
  return { ok: closesAt.getTime() > publishAt.getTime() && days >= minDays, days, minDays };
}

/**
 * Australian Business Number check: 11 digits and the official weighted checksum
 * (subtract 1 from the first digit, weights 10,1,3,5,...,19, total divisible by 89).
 */
export function validAbn(input: string): boolean {
  const d = input.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(d)) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...d].reduce((s, ch, i) => s + (i === 0 ? Number(ch) - 1 : Number(ch)) * w[i]!, 0);
  return sum % 89 === 0;
}

/** Receipt reference: stable for a submission and time, readable, and not guessable from the ABN alone. */
export function makeReceipt(abn: string, submittedAt: Date, submissionId: string): string {
  const day = submittedAt.toISOString().slice(0, 10).replace(/-/g, '');
  const tag = createHash('sha256')
    .update(`${submissionId}|${submittedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 8);
  return `RC-${abn.replace(/\s+/g, '').slice(-4)}-${day}-${tag.toUpperCase()}`;
}
