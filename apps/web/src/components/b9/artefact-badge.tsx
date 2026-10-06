'use client';
import { Badge, Button } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface ArtefactState {
  mode: 'REALTIME' | 'BATCHED' | 'MANUAL';
  batchMinutes: number;
  stale: boolean;
  reason: string | null;
  refreshedAt: string | null;
  nextRefreshAt: string | null;
}

const time = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

/** How current a generated artefact is (FR-0870): the update mode, whether it is behind, and a way to refresh it. */
export function ArtefactBadge({
  kind,
  id,
  csrf,
  canRefresh,
  onRefreshed,
}: {
  kind: 'EVAL_REPORT' | 'CONTRACT_PLANS';
  id: string;
  csrf: string;
  canRefresh: boolean;
  /** Called after a successful refresh so the page can reload the artefact itself. */
  onRefreshed?: () => void;
}) {
  const { data, reload } = useData<ArtefactState>(`/artefacts/${kind}/${id}/state`);
  const { busy, run, messages } = useRun();
  if (!data) return null;
  const mode =
    data.mode === 'REALTIME'
      ? 'Real-time'
      : data.mode === 'BATCHED'
        ? `Batched every ${data.batchMinutes} minutes`
        : 'Manual';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="artefact-badge">
      <Badge tone="neutral">{mode}</Badge>
      {data.stale ? (
        <Badge tone="warning">
          Out of date{data.reason ? `: ${data.reason}` : ''}
          {data.nextRefreshAt ? `. Next refresh ${time.format(new Date(data.nextRefreshAt))}` : ''}
        </Badge>
      ) : (
        <Badge tone="success">Up to date</Badge>
      )}
      {canRefresh && (
        <Button
          variant="secondary"
          loading={busy === 'refresh'}
          onClick={() =>
            void run(
              'refresh',
              async () => {
                await send(csrf, 'POST', `/artefacts/${kind}/${id}/refresh`);
                await reload();
                onRefreshed?.();
              },
              'Refreshed.',
            )
          }
        >
          Refresh now
        </Button>
      )}
      {messages}
    </div>
  );
}
