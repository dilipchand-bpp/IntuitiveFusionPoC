import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th } from '@if/ui';
import { PRIORITY_TONE } from '@/components/contract/b5-shared';
import { CONTRACT_STATUS, aud } from '@/lib/labels';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'My contracts – Intuitive Fusion' };

interface Item {
  id: string;
  number: string;
  title: string | null;
  supplier: string;
  status: string;
  value: number;
  endDate: string | null;
  daysToEnd: number | null;
  owner: string | null;
  spentPct: number | null;
  nextStep: { priority: 'HIGH' | 'MEDIUM' | 'LOW'; text: string; why: string } | null;
}
interface Result {
  scope: 'TEAM' | 'ALL';
  note: string;
  model: string;
  items: Item[];
}
const WINDOWS = [30, 90, 180, 365];

export default async function MyContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; within?: string }>;
}) {
  const { q, within } = await searchParams;
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (within && WINDOWS.includes(Number(within))) qs.set('endingWithinDays', within);
  const res = await apiGet<Result>(`/contracts/search?${qs}`);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {res?.scope === 'TEAM' ? 'My contracts' : 'Search contracts'}
        </h1>
        <p className="mt-1 max-w-prose text-text-muted">
          {res?.note ?? 'Search the contracts you can see.'} As a contract nears its end you are shown what to
          do next.
        </p>
      </header>
      <form role="search" aria-label="Search contracts" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Search by number, title or supplier
          <input
            name="q"
            defaultValue={q}
            className="min-h-[44px] w-72 rounded-md border border-border-strong bg-surface px-3 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Ending within
          <select
            name="within"
            defaultValue={within ?? ''}
            className="min-h-[44px] rounded-md border border-border-strong bg-surface px-3 text-base"
          >
            <option value="">Any time</option>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w} days
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[44px] rounded-md bg-brand-gradient px-5 text-sm font-semibold text-white"
        >
          Search
        </button>
      </form>
      {!res ? (
        <EmptyState title="Contracts unavailable" body="The search could not be run. Please refresh." />
      ) : res.items.length === 0 ? (
        <EmptyState title="No contracts match" body="Try a different search." />
      ) : (
        <Table caption="Your contracts">
          <thead>
            <tr>
              <Th>Contract</Th>
              <Th>Supplier</Th>
              <Th>Owner</Th>
              <Th className="text-right">Value</Th>
              <Th>Spent</Th>
              <Th>Ends</Th>
              <Th>Suggested next step</Th>
            </tr>
          </thead>
          <tbody>
            {res.items.map((c) => (
              <tr key={c.id}>
                <Td label="Contract">
                  <Link href={`/app/contracts/${c.id}`}>{c.title ?? c.number}</Link>
                  <div className="font-mono text-xs text-text-muted">{c.number}</div>
                  <Badge tone={CONTRACT_STATUS[c.status]?.[1] ?? 'neutral'}>
                    {CONTRACT_STATUS[c.status]?.[0] ?? c.status}
                  </Badge>
                </Td>
                <Td label="Supplier">{c.supplier}</Td>
                <Td label="Owner">{c.owner ?? '–'}</Td>
                <Td label="Value" className="text-right">
                  {aud.format(c.value)}
                </Td>
                <Td label="Spent">{c.spentPct === null ? '–' : `${c.spentPct}%`}</Td>
                <Td label="Ends" className="whitespace-nowrap">
                  {c.endDate ?? '–'}
                  {c.daysToEnd !== null && c.daysToEnd >= 0 && (
                    <div className="text-xs text-text-muted">in {c.daysToEnd} days</div>
                  )}
                </Td>
                <Td label="Suggested next step">
                  {c.nextStep ? (
                    <span data-testid="next-step">
                      <Badge tone={PRIORITY_TONE[c.nextStep.priority]}>
                        {c.nextStep.priority.toLowerCase()}
                      </Badge>{' '}
                      {c.nextStep.text}
                    </span>
                  ) : (
                    <span className="text-text-muted">–</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {res && (
        <p className="text-xs text-text-muted">
          Suggestions come from fixed rules, a stand-in for an AI model ({res.model}).
        </p>
      )}
    </div>
  );
}
