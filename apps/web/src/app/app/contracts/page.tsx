import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th } from '@if/ui';
import { DraftContract } from '@/components/contract/draft-contract';
import type { ContractAward, ContractSummary } from '@/components/contract/types';
import { CONTRACT_STATUS, aud } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Contracts – Intuitive Fusion' };

export default async function ContractsPage() {
  const user = await getSessionUser();
  const drafter = user?.roles.some((r) => r === 'LEGAL' || r === 'PROCUREMENT') ?? false;
  const manager =
    user?.roles.some((r) => ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC'].includes(r)) ?? false;
  const [contracts, awards] = await Promise.all([
    apiGet<ContractSummary[]>('/contracts'),
    drafter ? apiGet<ContractAward[]>('/contracts/awards') : Promise.resolve(null),
  ]);
  const waiting = (awards ?? []).filter((a) => !a.contractId && a.recommended.length > 0);
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Contracts</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          A contract is drafted from the approved evaluation report, reviewed by legal, then signed by people
          who hold signing authority. Once signed it is locked.
        </p>
        {manager && (
          <nav aria-label="Contract management" className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/app/contracts/expiring"
              className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
            >
              Expiring contracts
            </Link>
            <Link
              href="/app/contracts/alerts"
              className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
            >
              Alerts
            </Link>
          </nav>
        )}
      </header>

      {waiting.length > 0 && (
        <section aria-labelledby="await-h" className="flex flex-col gap-3">
          <h2 id="await-h" className="font-heading text-xl font-bold">
            Awards ready for a contract
          </h2>
          <ul className="grid gap-3" aria-label="Approved awards without a contract">
            {waiting.map((a) => (
              <li
                key={a.evaluationId}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center"
                data-testid="award-ready"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-text-muted">{a.requestNumber}</p>
                  <p className="font-heading text-lg font-semibold">{a.title}</p>
                  <p className="text-sm text-text-muted">
                    Recommended: {a.recommended.map((r) => `${r.company} (${r.score} / 100)`).join(', ')}
                  </p>
                </div>
                <DraftContract
                  evaluationId={a.evaluationId}
                  supplierId={a.recommended[0]!.supplierId}
                  company={a.recommended[0]!.company}
                  csrf={user!.csrfToken}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-h" className="flex flex-col gap-3">
        <h2 id="all-h" className="font-heading text-xl font-bold">
          All contracts
        </h2>
        {!contracts ? (
          <EmptyState title="Contracts unavailable" body="The list could not be loaded. Please refresh." />
        ) : contracts.length === 0 ? (
          <EmptyState
            title="No contracts yet"
            body="When an evaluation report is approved, its contract is drafted here."
          />
        ) : (
          <Table caption="Contracts">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Contract</Th>
                <Th>Supplier</Th>
                <Th className="text-right">Value</Th>
                <Th>Status</Th>
                <Th>Ends</Th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <Td label="Number" className="whitespace-nowrap font-mono text-xs">
                    {c.number}
                  </Td>
                  <Td label="Contract">
                    <Link href={`/app/contracts/${c.id}`}>{c.title ?? c.number}</Link>
                  </Td>
                  <Td label="Supplier">{c.supplierName}</Td>
                  <Td label="Value" className="text-right">
                    {aud.format(c.value)}
                  </Td>
                  <Td label="Status">
                    <Badge tone={CONTRACT_STATUS[c.status]?.[1] ?? 'neutral'}>
                      {CONTRACT_STATUS[c.status]?.[0] ?? c.status}
                    </Badge>
                  </Td>
                  <Td label="Ends" className="whitespace-nowrap">
                    {c.endDate ?? '–'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
