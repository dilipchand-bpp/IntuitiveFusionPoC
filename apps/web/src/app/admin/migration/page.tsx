import Link from 'next/link';
import { EmptyState } from '@if/ui';
import { MigrationPanel, type MigrationBatch } from '@/components/admin/migration-panel';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Data migration – Intuitive Fusion' };

export default async function MigrationPage() {
  const [me, batches] = await Promise.all([getSessionUser(), apiGet<MigrationBatch[]>('/migration/batches')]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Data migration</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Bring legacy contract records in. Each upload is checked for missing fields, dates and amounts that
          cannot be read, and duplicates. Nothing is loaded until every exception has been corrected or set
          aside with a reason. Loaded records are marked with their source system, linked to their originating
          procurement and given alerts.
        </p>
        <p className="mt-2 text-sm">
          Spreadsheets, suppliers, spend and catalogue prices, with a dry run and rollback:{' '}
          <Link href="/admin/migration/import" className="font-semibold underline">
            open the Import wizard
          </Link>
          .
        </p>
      </header>
      {!me || !batches ? (
        <EmptyState title="Data migration is unavailable" body="Please refresh the page." />
      ) : (
        <MigrationPanel initial={batches} csrf={me.csrfToken} canCutover={me.roles.includes('ADMIN')} />
      )}
    </div>
  );
}
