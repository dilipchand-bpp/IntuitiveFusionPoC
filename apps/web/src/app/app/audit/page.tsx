import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th, type BadgeTone } from '@if/ui';
import type { AuditPage, ProcurementTable } from '@/components/reports/types';
import { formatDateTime } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Audit trail – Intuitive Fusion' };

const PAGE = 25;
const RESULT_TONE: Record<string, BadgeTone> = { SUCCESS: 'success', DENIED: 'error', FAILED: 'warning' };
type Params = { requestId?: string; action?: string; from?: string; to?: string; offset?: string };
const isDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');
const isId = (s?: string) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : '');

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const filters = {
    requestId: isId(sp.requestId),
    action: (sp.action ?? '').replace(/[^a-z0-9._-]/gi, '').slice(0, 60),
    from: isDay(sp.from),
    to: isDay(sp.to),
  };
  const offset = Math.max(0, Number.parseInt(sp.offset ?? '0', 10) || 0);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as Array<[string, string]>);
  const user = await getSessionUser();
  const canExport = user?.roles.some((r) => r === 'PROBITY' || r === 'ADMIN') ?? false;
  const [page, procs] = await Promise.all([
    apiGet<AuditPage>(
      `/audit-events?${new URLSearchParams({ ...Object.fromEntries(query), limit: String(PAGE), offset: String(offset) })}`,
    ),
    apiGet<ProcurementTable>('/reports/procurements'),
  ]);
  const link = (o: number) =>
    `/app/audit?${new URLSearchParams({ ...Object.fromEntries(query), offset: String(o) })}`;
  const input = 'min-h-[44px] rounded-md border border-border-strong bg-surface px-3 font-normal';
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Audit trail</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Who did what and when, newest first, with what changed. Entries cannot be edited or removed.
        </p>
      </header>

      <form
        method="get"
        role="search"
        aria-label="Filter the audit trail"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Procurement
          <select name="requestId" defaultValue={filters.requestId} className={`${input} w-64`}>
            <option value="">All activity</option>
            {(procs?.items ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.number} {r.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Action starts with
          <input
            name="action"
            defaultValue={filters.action}
            placeholder="plan."
            className={`${input} w-40`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          From
          <input type="date" name="from" defaultValue={filters.from} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          To
          <input type="date" name="to" defaultValue={filters.to} className={input} />
        </label>
        <button
          type="submit"
          className="min-h-[44px] rounded-md border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-alt"
        >
          Search
        </button>
        {query.size > 0 && (
          <Link href="/app/audit" className="min-h-[44px] py-3 text-sm">
            Clear
          </Link>
        )}
      </form>

      {!page ? (
        <EmptyState title="The audit trail is unavailable" body="Please refresh the page." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-text-muted" data-testid="audit-count">
              {page.page.total} event(s)
            </p>
            {canExport && (
              <a
                href={`/api/v1/audit-events/export${query.size ? `?${query}` : ''}`}
                download
                className="ml-auto inline-flex min-h-[44px] items-center rounded-md bg-brand-gradient px-4 text-sm font-semibold text-white no-underline"
              >
                Export CSV
              </a>
            )}
          </div>
          {page.items.length === 0 ? (
            <EmptyState title="No events match" body="Try widening the dates or clearing the filters." />
          ) : (
            <Table caption="Audit events">
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>Record</Th>
                  <Th>Result</Th>
                  <Th>What changed</Th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.seq} data-testid="audit-row">
                    <Td label="Time" className="whitespace-nowrap text-xs">
                      {formatDateTime(e.at)}
                    </Td>
                    <Td label="Who">
                      {e.actorName ?? '–'}
                      {e.actorRole && <span className="block text-xs text-text-muted">{e.actorRole}</span>}
                    </Td>
                    <Td label="Action" className="font-mono text-xs">
                      {e.action}
                    </Td>
                    <Td label="Record" className="text-xs">
                      {e.entityType}
                    </Td>
                    <Td label="Result">
                      <Badge tone={RESULT_TONE[e.result] ?? 'neutral'}>{e.result.toLowerCase()}</Badge>
                    </Td>
                    <Td label="What changed">
                      {e.before || e.after ? (
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold">Show</summary>
                          {e.before && (
                            <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs">
                              Before: {JSON.stringify(e.before, null, 1)}
                            </pre>
                          )}
                          {e.after && (
                            <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs">
                              After: {JSON.stringify(e.after, null, 1)}
                            </pre>
                          )}
                        </details>
                      ) : (
                        '–'
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
            {offset > 0 && <Link href={link(Math.max(0, offset - PAGE))}>← Newer</Link>}
            {offset + PAGE < page.page.total && <Link href={link(offset + PAGE)}>Older →</Link>}
          </nav>
        </>
      )}
    </div>
  );
}
