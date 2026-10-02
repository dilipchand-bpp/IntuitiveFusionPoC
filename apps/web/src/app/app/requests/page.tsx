import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Badge, Button, EmptyState, Table, Td, Th } from '@if/ui';
import { COMPLEXITY_LABEL, COMPLEXITY_TONE, PHASE_LABEL, STATUS_LABEL, STATUS_TONE, aud } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Requests – Intuitive Fusion' };

interface Item {
  id: string;
  number: string;
  title: string;
  phase: string;
  status: string;
  complexity?: string;
  estimatedValue: number;
  updatedAt: string;
}
interface Page {
  items: Item[];
  page: { total: number; limit: number; offset: number };
}

const when = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const user = await getSessionUser();
  const qs = new URLSearchParams({ limit: '50' });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  const data = await apiGet<Page>(`/requests?${qs}`);
  const canCreate = user?.roles.some((r) => r === 'REQUESTER' || r === 'PROCUREMENT') ?? false;
  const own = user?.roles.length === 1 && user.roles[0] === 'REQUESTER';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{own ? 'My requests' : 'Requests'}</h1>
          <p className="mt-1 max-w-prose text-text-muted">
            {own
              ? 'Everything you have asked for, and where it is up to.'
              : 'Procurement requests across the organisation.'}
          </p>
        </div>
        {canCreate && (
          <Button asChild variant="accent" size="lg">
            <Link href="/app/requests/new" className="text-accent-fg no-underline">
              <Plus className="size-5" aria-hidden="true" />
              New request
            </Link>
          </Button>
        )}
      </header>

      <form role="search" aria-label="Search requests" className="flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">
          Search by title or number
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search by title or number"
          className="min-h-[44px] w-full max-w-sm rounded-sm border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-text-muted"
        />
        <label htmlFor="status" className="sr-only">
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={status ?? ''}
          className="min-h-[44px] rounded-sm border border-border-strong bg-surface px-3 text-sm text-text"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {!data ? (
        <EmptyState
          title="Requests unavailable"
          body="The list could not be loaded. Please refresh the page."
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={q || status ? 'No matching requests' : 'No requests yet'}
          body={
            canCreate
              ? 'Describe what you need to the assistant and it will draft the request for you.'
              : 'Requests you can see will appear here.'
          }
          action={
            canCreate && !q && !status ? (
              <Button asChild variant="accent">
                <Link href="/app/requests/new" className="text-accent-fg no-underline">
                  Start your first request
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table caption="Requests">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Title</Th>
                <Th>Phase</Th>
                <Th>Status</Th>
                <Th>Complexity</Th>
                <Th className="text-right">Value</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-xs">{r.number}</Td>
                  <Td>
                    <Link href={`/app/requests/${r.id}`}>{r.title}</Link>
                  </Td>
                  <Td>{PHASE_LABEL[r.phase] ?? r.phase}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </Td>
                  <Td>
                    {r.complexity ? (
                      <Badge tone={COMPLEXITY_TONE[r.complexity] ?? 'neutral'}>
                        {COMPLEXITY_LABEL[r.complexity]}
                      </Badge>
                    ) : (
                      '–'
                    )}
                  </Td>
                  <Td className="text-right">{aud.format(r.estimatedValue)}</Td>
                  <Td className="whitespace-nowrap">{when.format(new Date(r.updatedAt))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-sm text-text-muted">
            Showing {data.items.length} of {data.page.total}.
          </p>
        </>
      )}
    </div>
  );
}
