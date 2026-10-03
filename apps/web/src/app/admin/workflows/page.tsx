import { EmptyState } from '@if/ui';
import { WorkflowsPanel, type WorkflowRow } from '@/components/admin/workflows-panel';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Workflows – Intuitive Fusion' };

export default async function WorkflowsPage() {
  const [me, list] = await Promise.all([getSessionUser(), apiGet<WorkflowRow[]>('/admin/workflows')]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Workflows</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          The steps each kind of procurement follows, and which of them are mandatory checkpoints. The simple
          workflow can be edited now; the intermediate and complex ones are coming soon. In this proof of
          concept the library is configuration: it does not yet route live requests.
        </p>
      </header>
      {!list || !me ? (
        <EmptyState title="Workflows are unavailable" body="Please refresh the page." />
      ) : (
        <WorkflowsPanel initial={list} csrf={me.csrfToken} canEdit={me.roles.includes('ADMIN')} />
      )}
    </div>
  );
}
