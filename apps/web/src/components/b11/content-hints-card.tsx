'use client';
import { Badge, Card } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';
import { SourceChip, type PopulationSource } from './source-chip';

interface Hints {
  category: string | null;
  taxonomy: {
    scheme: string;
    code: string;
    label: string;
    category: string;
    source: PopulationSource;
    inHouse: { code: string; label: string } | null;
    differs: boolean;
  } | null;
  benchmark: {
    text: string;
    verdict: 'BELOW' | 'WITHIN' | 'ABOVE' | null;
    source: PopulationSource;
  } | null;
  risks: Array<{ key: string; title: string; description: string; source: PopulationSource }>;
  riskNote: string | null;
  notes: Array<{ kind: string; note: string }>;
}

/** What in-house data and the outside content packs suggest for a procurement, each with its source (NFR-R03). */
export function ContentHintsCard({ requestId }: { requestId: string }) {
  const d = useData<Hints>(`/requests/${requestId}/content-hints`);
  const h = d.data;
  if (!h) return null;
  return (
    <Card role="region" aria-labelledby="hints-h" data-testid="content-hints-card">
      <h2 id="hints-h" className="font-heading text-xl font-bold">
        Reference content for this procurement
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Filled from the organisation&apos;s own records and from outside content that is refreshed regularly.
        Each suggestion says where it came from.
      </p>
      <dl className="mt-3 flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-semibold">Classification</dt>
          <dd>
            {h.taxonomy ? (
              <>
                <span className="font-mono font-semibold" data-testid="hint-code">
                  {h.taxonomy.scheme} {h.taxonomy.code}
                </span>{' '}
                {h.taxonomy.label} <SourceChip source={h.taxonomy.source} />
                {h.taxonomy.differs && h.taxonomy.inHouse && (
                  <span className="block text-xs text-text-muted">
                    The in-house table has {h.taxonomy.inHouse.code} for the same category.
                  </span>
                )}
              </>
            ) : (
              <span className="text-text-muted">No code to suggest for this category.</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Market price</dt>
          <dd>
            {h.benchmark ? (
              <>
                <span data-testid="hint-benchmark">{h.benchmark.text}</span>{' '}
                {h.benchmark.verdict && (
                  <Badge tone={h.benchmark.verdict === 'WITHIN' ? 'success' : 'warning'}>
                    {h.benchmark.verdict === 'WITHIN'
                      ? 'Within range'
                      : h.benchmark.verdict === 'ABOVE'
                        ? 'Above range'
                        : 'Below range'}
                  </Badge>
                )}{' '}
                <SourceChip source={h.benchmark.source} />
              </>
            ) : (
              <span className="text-text-muted">No benchmark for this category.</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Standard risks from the library</dt>
          <dd>
            {h.risks.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1" data-testid="hint-risks">
                {h.risks.map((r) => (
                  <li key={r.key}>
                    {r.title} <SourceChip source={r.source} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-text-muted">{h.riskNote ?? 'None apply.'}</span>
            )}
          </dd>
        </div>
      </dl>
      {h.notes.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-xs text-warning" data-testid="hint-notes">
          {h.notes.map((n) => (
            <li key={n.kind}>{n.note}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
