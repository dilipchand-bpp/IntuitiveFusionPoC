import Link from 'next/link';
import { Badge, EmptyState, Table, Td, Th } from '@if/ui';
import { AlertPreferences } from '@/components/contract/b5-pages';
import type { AlertRow } from '@/components/contract/types';
import { ALERT_KIND, CHANNEL_LABEL, formatDateTime } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Contract alerts – Intuitive Fusion' };

export default async function AlertsPage() {
  const [rows, user] = await Promise.all([apiGet<AlertRow[]>('/alerts'), getSessionUser()]);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Contract alerts</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Alerts are raised when a contract is executed and go to its owner on the day: by notification and by
          email. In this proof of concept the email is recorded but not sent.
        </p>
      </header>
      <AlertPreferences csrf={user!.csrfToken} />
      {!rows ? (
        <EmptyState title="Alerts are unavailable" body="Please refresh the page." />
      ) : rows.length === 0 ? (
        <EmptyState title="No alerts yet" body="Alerts appear when a contract is executed." />
      ) : (
        <Table caption="Alerts">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Contract</Th>
              <Th>Alert</Th>
              <Th>Status</Th>
              <Th>Delivery</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <Td label="Date" className="whitespace-nowrap">
                  {a.triggerDate}
                </Td>
                <Td label="Contract">
                  <Link href={`/app/contracts/${a.contractId}`}>{a.contractNumber}</Link>
                </Td>
                <Td label="Alert">{ALERT_KIND[a.kind] ?? a.kind}</Td>
                <Td label="Status">
                  <Badge
                    tone={a.status === 'SENT' ? 'success' : a.status === 'CANCELLED' ? 'neutral' : 'info'}
                  >
                    {a.status === 'SENT' ? 'Sent' : a.status === 'CANCELLED' ? 'Cancelled' : 'Scheduled'}
                  </Badge>
                </Td>
                <Td label="Delivery">
                  {a.deliveries.length
                    ? `${formatDateTime(a.sentAt)} · ${[...new Set(a.deliveries.map((d) => CHANNEL_LABEL[d.channel] ?? d.channel))].join(' and ')}`
                    : '–'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
