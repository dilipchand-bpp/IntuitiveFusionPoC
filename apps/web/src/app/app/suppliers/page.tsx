import Link from 'next/link';
import { EmptyState, Table, Td, Th } from '@if/ui';
import { StatusBadges } from '@/components/supplier/status-badges';
import type { SupplierRow } from '@/components/supplier/types';
import { formatDateTime } from '@/lib/labels';
import { apiGet, getSessionUser } from '@/lib/session';
import { DuplicatesCard } from '@/components/supplier/b8-staff';

export const metadata = { title: 'Suppliers – Intuitive Fusion' };

export default async function SuppliersPage() {
  const [rows, user] = await Promise.all([apiGet<SupplierRow[]>('/suppliers'), getSessionUser()]);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Suppliers</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Every supplier in the directory, with the status of its sanctions screening and insurance. In this
          proof of concept the screening is simulated.
        </p>
      </header>
      {user && (
        <DuplicatesCard
          csrf={user.csrfToken}
          canDismiss={user.roles.some((r) => r === 'PROCUREMENT' || r === 'LEGAL')}
        />
      )}
      {!rows ? (
        <EmptyState title="The directory is unavailable" body="Please refresh the page." />
      ) : rows.length === 0 ? (
        <EmptyState title="No suppliers yet" body="Suppliers appear when they register from an invitation." />
      ) : (
        <Table caption="Suppliers">
          <thead>
            <tr>
              <Th>Company</Th>
              <Th>ABN</Th>
              <Th>Screening</Th>
              <Th className="text-right">Contacts</Th>
              <Th>Last checked</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} data-testid="supplier-row">
                <Td label="Company">
                  <Link href={`/app/suppliers/${s.id}`}>{s.company}</Link>
                </Td>
                <Td label="ABN" className="whitespace-nowrap font-mono text-xs">
                  {s.abn}
                </Td>
                <Td label="Screening">
                  <StatusBadges sanctions={s.sanctionsStatus} insurance={s.insuranceStatus} />
                </Td>
                <Td label="Contacts" className="text-right">
                  {s.contacts}
                </Td>
                <Td label="Last checked" className="whitespace-nowrap">
                  {formatDateTime(s.lastCheckedAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
