'use client';
import { Badge, Button } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Ev {
  id: string;
  kind: string;
  target: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** What was sent to the customer's legal platform and whether it got there; a failed one can be tried again (FR-0390). Nothing shows when the customer runs no legal platform. */
export function PlatformSync({ csrf }: { csrf: string }) {
  const { data, reload } = useData<Ev[]>('/integration-events');
  const r = useRun();
  const rows = (data ?? []).filter((e) => e.kind === 'MATTER_INITIATED');
  if (rows.length === 0) return null;
  const failed = rows.filter((e) => e.status !== 'DELIVERED').length;
  return (
    <section
      aria-labelledby="sync-h"
      className="rounded-lg border border-border bg-surface p-4"
      data-testid="platform-sync"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="sync-h" className="font-heading text-lg font-bold">
          Legal platform sync
        </h2>
        <Badge tone={failed ? 'error' : 'success'}>
          {failed ? `${failed} not delivered` : 'all delivered'}
        </Badge>
        {failed > 0 && (
          <Button
            className="ml-auto"
            variant="secondary"
            loading={r.busy === 'retry'}
            onClick={() =>
              void r.run(
                'retry',
                async () => {
                  await send(csrf, 'POST', '/integration-events/retry');
                  await reload();
                },
                'Tried again.',
              )
            }
          >
            Try again
          </Button>
        )}
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {rows.slice(0, 5).map((e) => (
          <li key={e.id}>
            <Badge tone={e.status === 'DELIVERED' ? 'success' : 'error'}>{e.status.toLowerCase()}</Badge> to{' '}
            {e.target}
            {e.attempts > 1 ? `, ${e.attempts} attempts` : ''}
            {e.lastError ? ` · ${e.lastError}` : ''}
          </li>
        ))}
      </ul>
      {r.messages}
    </section>
  );
}
