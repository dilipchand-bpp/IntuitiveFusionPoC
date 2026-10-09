import Link from 'next/link';
import { EmptyState } from '@if/ui';
import { HistWizard } from '@/components/copilot/hist-wizard';
import type { HistBatchListItem, HistEntityDef, HistSample } from '@/components/copilot/hist-types';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Import wizard – Intuitive Fusion' };

export default async function ImportWizardPage() {
  const [me, entities, samples, batches] = await Promise.all([
    getSessionUser(),
    apiGet<HistEntityDef[]>('/history-import/entities'),
    apiGet<HistSample[]>('/history-import/samples'),
    apiGet<HistBatchListItem[]>('/history-import/batches'),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Import wizard</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Bring in historical contracts, suppliers, spend and catalogue prices from a spreadsheet or CSV.
          Check the mapping, run a dry run that loads nothing, then load. A loaded batch can be rolled back
          while what it created is untouched. The CSV contract migration is still at{' '}
          <Link href="/admin/migration" className="underline">
            Data migration
          </Link>
          .
        </p>
      </header>
      {!me || !entities || !samples || !batches ? (
        <EmptyState title="The import wizard is unavailable" body="Please refresh the page." />
      ) : (
        <HistWizard
          entities={entities}
          samples={samples}
          initialBatches={batches}
          csrf={me.csrfToken}
          canLoad={me.roles.includes('ADMIN')}
        />
      )}
    </div>
  );
}
