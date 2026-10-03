import { Badge, Card } from '@if/ui';
import { ALERT_KIND, formatDateTime } from '@/lib/labels';
import { Gantt } from './gantt';
import type { ContractRecord } from './types';

/** The management record of an executed contract: owner, milestones, optional extensions, term chart and alerts. */
export function ManagementCard({ record }: { record: ContractRecord }) {
  return (
    <Card aria-labelledby="mgmt-h" role="region" data-testid="management-card">
      <h2 id="mgmt-h" className="font-heading text-xl font-bold">
        Contract management
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">Contract owner</dt>
        <dd className="font-semibold" data-testid="owner">
          {record.owner?.name ?? 'Not assigned'}
        </dd>
      </dl>

      <h3 className="mt-4 font-heading font-semibold">Term and optional extensions</h3>
      <Gantt rows={[{ id: 'this', label: 'This contract', bars: record.bars }]} />

      <h3 className="mt-4 font-heading font-semibold">Milestones</h3>
      <ul className="mt-1 flex flex-col gap-1 text-sm" aria-label="Milestones">
        {record.milestones.map((m) => (
          <li key={m.id} className="flex justify-between gap-3">
            <span>{m.title}</span>
            <span className="text-text-muted">{m.dueDate}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 font-heading font-semibold">Alerts</h3>
      <ul className="mt-1 flex flex-col gap-2 text-sm" aria-label="Alerts" data-testid="alerts">
        {record.alerts.map((a) => (
          <li key={a.id} className="rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{ALERT_KIND[a.kind] ?? a.kind}</span>
              <Badge tone={a.status === 'SENT' ? 'success' : a.status === 'CANCELLED' ? 'neutral' : 'info'}>
                {a.status === 'SENT' ? 'Sent' : a.status === 'CANCELLED' ? 'Cancelled' : 'Scheduled'}
              </Badge>
              <span className="ml-auto text-text-muted">{a.triggerDate}</span>
            </div>
            {a.deliveries.length > 0 && (
              <p className="mt-1 text-xs text-text-muted">
                Delivered {formatDateTime(a.sentAt)} by{' '}
                {a.deliveries
                  .map((d) => (d.channel === 'IN_APP' ? 'in-app' : 'email (simulated)'))
                  .filter((v, i, all) => all.indexOf(v) === i)
                  .join(' and ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
