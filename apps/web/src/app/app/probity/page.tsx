import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th, type BadgeTone } from '@if/ui';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Probity portal – Intuitive Fusion' };

interface Portal {
  external: boolean;
  procurements: Array<{
    evaluationId: string;
    tenderId: string;
    number: string;
    title: string;
    status: string;
    held: boolean;
    holdReason: string | null;
    documents: Array<{ kind: 'PLAN' | 'OUTCOMES'; status: 'DRAFT' | 'SIGNED'; version: number }>;
  }>;
}
const STAGE: Record<string, [string, BadgeTone]> = {
  COI_PENDING: ['Declaring conflicts', 'warning'],
  SCORING: ['Scoring', 'info'],
  CONSENSUS: ['Consensus', 'info'],
  LOCKED: ['Locked', 'neutral'],
  REPORTED: ['Report awaiting approval', 'warning'],
  APPROVED: ['Approved', 'success'],
};
const DOC = { PLAN: 'Plan', OUTCOMES: 'Outcomes report' } as const;

export default async function ProbityPortalPage() {
  const data = await apiGet<Portal>('/probity/portal');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Probity portal</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          {data?.external
            ? 'Read-only oversight of the procurements you are allocated to. You can place a hold to freeze an evaluation on suspected bias or a process breach, and you write and sign the probity plan and outcomes report.'
            : 'Oversight of every procurement. You can place a hold to freeze an evaluation on suspected bias or a process breach, and you write and sign the probity plan and outcomes report.'}
        </p>
      </header>
      {!data ? (
        <EmptyState title="The portal is unavailable" body="Please refresh the page." />
      ) : data.procurements.length === 0 ? (
        <EmptyState
          title="No procurements are allocated to you"
          body="Procurement allocates an external advisor to each procurement they oversee. Nothing else is visible to you."
        />
      ) : (
        <Table caption="Procurements under oversight">
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Title</Th>
              <Th>Stage</Th>
              <Th>Probity documents</Th>
            </tr>
          </thead>
          <tbody>
            {data.procurements.map((p) => (
              <tr key={p.evaluationId} data-testid="probity-row">
                <Td label="Request" className="whitespace-nowrap font-mono text-xs">
                  {p.number}
                </Td>
                <Td label="Title">
                  <Link href={`/app/evaluations/${p.evaluationId}`}>{p.title}</Link>
                </Td>
                <Td label="Stage">
                  <Badge tone={STAGE[p.status]?.[1] ?? 'neutral'}>{STAGE[p.status]?.[0] ?? p.status}</Badge>
                  {p.held && (
                    <Badge tone="error" className="ml-2">
                      On hold
                    </Badge>
                  )}
                </Td>
                <Td label="Probity documents">
                  {p.documents.length === 0
                    ? 'None yet'
                    : p.documents
                        .map(
                          (d) =>
                            `${DOC[d.kind]}: ${d.status === 'SIGNED' ? 'signed' : 'draft'} v${d.version}`,
                        )
                        .join('; ')}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
