import { Badge, type BadgeTone } from '@if/ui';

const SANCTIONS: Record<string, [string, BadgeTone]> = {
  PENDING: ['Sanctions pending', 'warning'],
  CLEAR: ['Sanctions clear', 'success'],
  MATCH: ['Sanctions match', 'error'],
};
const INSURANCE: Record<string, [string, BadgeTone]> = {
  UNKNOWN: ['Insurance unknown', 'neutral'],
  CURRENT: ['Insurance current', 'success'],
  EXPIRING: ['Insurance expiring', 'warning'],
  EXPIRED: ['Insurance expired', 'error'],
};

export function StatusBadges({ sanctions, insurance }: { sanctions: string; insurance: string }) {
  const s = SANCTIONS[sanctions] ?? [sanctions, 'neutral' as BadgeTone];
  const i = INSURANCE[insurance] ?? [insurance, 'neutral' as BadgeTone];
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={s[1]}>{s[0]}</Badge>
      <Badge tone={i[1]}>{i[0]}</Badge>
    </span>
  );
}
