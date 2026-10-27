import { PageHeader } from '@if/ui';
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
      <PageHeader
        title="Invoices"
        subtitle={
          <>
            Each invoice is matched to its purchase order and the contract rate card before it can be paid.
            One that applies an unapproved price increase, or an escalation outside the clause, is blocked
            until finance releases it with a reason.
          </>
        }
      />
      <InvoiceQueue csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
