import Link from 'next/link';
import { Badge, EmptyState } from '@if/ui';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Contracts – Intuitive Fusion' };

interface Row {
  id: string;
  number: string;
  title: string | null;
  docType: string;
  status: string;
  value: number;
}

export default async function SupplierContractsPage() {
  const data = await apiGet<{ contracts: Row[] }>('/supplier/contracts');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Contracts</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Contracts out for signature or signed. You can read the full text and ask questions before it is
          signed.
        </p>
      </header>
      {!data || data.contracts.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          body="When a contract is released for signature you will be told, and it appears here."
        />
      ) : (
        <ul className="grid gap-3" aria-label="Contracts">
          {data.contracts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm"
              data-testid="supplier-contract-row"
            >
              <span className="font-mono text-xs text-text-muted">{c.number}</span>
              <Link href={`/supplier/contracts/${c.id}`} className="font-heading text-lg font-semibold">
                {c.title ?? 'Contract'}
              </Link>
              <Badge tone={c.status === 'EXECUTED' ? 'success' : 'warning'}>
                {c.status === 'EXECUTED' ? 'Signed' : 'Out for signature'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
