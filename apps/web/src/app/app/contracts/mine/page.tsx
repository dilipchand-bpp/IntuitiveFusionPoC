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
      <form
        role="search"
        aria-label="Search contracts"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-semibold">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Number, title or supplier"
            className="min-h-[44px] rounded-md border border-border-strong bg-surface px-3 text-base font-normal"
          />
        </label>
        {within && <input type="hidden" name="within" value={within} />}
        <button
          type="submit"
          className="min-h-[44px] rounded-md bg-brand-gradient px-5 text-sm font-semibold text-white"
        >
          Search
        </button>
        <nav aria-label="Ending within" className="flex basis-full flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Ending within</span>
          {[['', 'Any time'], ...WINDOWS.map((w) => [String(w), `${w} days`])].map(([k, l]) => (
            <Link
              key={k}
              href={`/app/contracts/mine?${new URLSearchParams({ ...(q ? { q } : {}), ...(k ? { within: k } : {}) })}`}
              aria-current={(within ?? '') === k ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-sm font-semibold no-underline ${(within ?? '') === k ? 'border-accent bg-accent/10 text-accent' : 'border-border-strong text-text'}`}
            >
              {l}
            </Link>
          ))}
        </nav>
      </form>
      {res && <p className="text-sm text-text-muted">{res.items.length} contract(s).</p>}
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
                  <Link href={`/app/contracts/${c.id}`}>{c.title ?? c.supplier}</Link>
                  <div className="font-mono text-xs text-text-muted">{c.number}</div>
                  <Badge tone={CONTRACT_STATUS[c.status]?.[1] ?? 'neutral'}>
                    {CONTRACT_STATUS[c.status]?.[0] ?? c.status}
                  </Badge>
                </Td>
                <Td label="Supplier">{c.supplier}</Td>
                <Td label="Owner">{c.owner ?? 'Not assigned'}</Td>
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
