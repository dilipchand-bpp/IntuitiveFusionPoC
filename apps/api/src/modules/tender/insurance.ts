const DAY = 86_400_000;

export type InsuranceStatus = 'UNKNOWN' | 'CURRENT' | 'EXPIRING' | 'EXPIRED';

/** Current, expiring (within 30 days) or expired, from the certificate's end date. */
export function insuranceStatusFor(expiresOn: string | null, today: string): InsuranceStatus {
  if (!expiresOn) return 'UNKNOWN';
  if (expiresOn <= today) return 'EXPIRED';
  const days = (Date.parse(expiresOn) - Date.parse(today)) / DAY;
  return days <= 30 ? 'EXPIRING' : 'CURRENT';
}
