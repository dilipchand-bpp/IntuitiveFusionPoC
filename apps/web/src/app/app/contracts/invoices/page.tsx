import Link from 'next/link';
import { InvoiceQueue } from '@/components/contract/b5-pages';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Invoices – Intuitive Fusion' };

export default async function InvoicesPage() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Invoices</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Each invoice is matched to its purchase order and the contract rate card before it can be paid. One
          that applies an unapproved price increase, or an escalation outside the clause, is blocked until
          finance releases it with a reason.
        </p>
      </header>
      <InvoiceQueue csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
