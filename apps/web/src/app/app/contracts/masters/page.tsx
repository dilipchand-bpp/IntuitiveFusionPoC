import Link from 'next/link';
import { EmptyState, Table, Td, Th } from '@if/ui';
import { aud } from '@/lib/labels';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Master agreements – Intuitive Fusion' };

interface Report {
  masters: Array<{
    id: string;
    number: string;
    title: string | null;
    supplier: string;
    value: number;
    committed: number;
    invoiced: number;
    workOrders: number;
    allocated: number;
  }>;
  workOrders: Array<{
    id: string;
    number: string;
    title: string;
    masterId: string;
    masterNumber: string;
    value: number;
    committed: number;
    invoiced: number;
    status: string;
  }>;
}

export default async function MastersPage() {
  const r = await apiGet<Report>('/reports/master-agreements');
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Master agreements</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Each master agreement and the work orders raised under it, reported at both levels.
        </p>
      </header>
      {!r ? (
        <EmptyState title="The report is unavailable" body="Please refresh the page." />
      ) : r.masters.length === 0 ? (
        <EmptyState
          title="No master agreements"
          body="An executed master agreement appears here, with its work orders."
        />
      ) : (
        <>
          <Table caption="Master agreements">
            <thead>
              <tr>
                <Th>Agreement</Th>
                <Th>Supplier</Th>
                <Th className="text-right">Value</Th>
                <Th className="text-right">Allocated</Th>
                <Th className="text-right">Committed</Th>
                <Th className="text-right">Invoiced</Th>
                <Th className="text-right">Work orders</Th>
              </tr>
            </thead>
            <tbody>
              {r.masters.map((m) => (
                <tr key={m.id}>
                  <Td label="Agreement">
                    <Link href={`/app/contracts/${m.id}`}>{m.title ?? m.number}</Link>
                    <div className="font-mono text-xs text-text-muted">{m.number}</div>
                  </Td>
                  <Td label="Supplier">{m.supplier}</Td>
                  <Td label="Value" className="text-right">
                    {aud.format(m.value)}
                  </Td>
                  <Td label="Allocated" className="text-right">
                    {aud.format(m.allocated)}
                  </Td>
                  <Td label="Committed" className="text-right">
                    {aud.format(m.committed)}
                  </Td>
                  <Td label="Invoiced" className="text-right">
                    {aud.format(m.invoiced)}
                  </Td>
                  <Td label="Work orders" className="text-right">
                    {m.workOrders}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {r.workOrders.length > 0 && (
            <Table caption="Work orders">
              <thead>
                <tr>
                  <Th>Work order</Th>
                  <Th>Under</Th>
                  <Th className="text-right">Value</Th>
                  <Th className="text-right">Committed</Th>
                  <Th className="text-right">Invoiced</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {r.workOrders.map((o) => (
                  <tr key={o.id}>
                    <Td label="Work order">
                      {o.title}
                      <div className="font-mono text-xs text-text-muted">{o.number}</div>
                    </Td>
                    <Td label="Under">{o.masterNumber}</Td>
                    <Td label="Value" className="text-right">
                      {aud.format(o.value)}
                    </Td>
                    <Td label="Committed" className="text-right">
                      {aud.format(o.committed)}
                    </Td>
                    <Td label="Invoiced" className="text-right">
                      {aud.format(o.invoiced)}
                    </Td>
                    <Td label="Status">{o.status.toLowerCase()}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
