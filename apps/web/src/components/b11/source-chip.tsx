import { Badge, type BadgeTone } from '@if/ui';

export interface PopulationSource {
  kind: 'IN_HOUSE' | 'OUTSIDE_PACK' | 'BOTH';
  label: string;
  pack: { kind: string; name: string; version: number; refreshedAt: string | null } | null;
  note: string | null;
}

const TONE: Record<PopulationSource['kind'], BadgeTone> = {
  IN_HOUSE: 'neutral',
  OUTSIDE_PACK: 'info',
  BOTH: 'success',
};

/** Where a populated field came from: the organisation's own records, an outside content pack (name and version), or both (NFR-R03). */
export function SourceChip({ source }: { source: PopulationSource }) {
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-1"
      data-testid="source-chip"
      title={source.pack ? `${source.pack.name}, version ${source.pack.version}` : undefined}
    >
      <span className="sr-only">Source: </span>
      <Badge tone={TONE[source.kind]} className="max-w-full whitespace-normal! text-left">
        {source.label}
      </Badge>
      {source.note && <span className="text-xs text-text-muted">{source.note}</span>}
    </span>
  );
}
