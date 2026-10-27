import { Badge, Button, EmptyState, PageHeader, Panel, SectionHeader } from '@if/ui';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Templates – Intuitive Fusion' };

interface TemplateRow {
  id: string;
  type: string;
  name: string;
  version: string;
  status: string;
  appliesTo: string[];
  clauses: Array<{ id: string; title: string; mandatory: boolean }>;
}
const TYPE: Record<string, string> = {
  CONTRACT: 'Contract templates',
  TENDER: 'Tender templates',
  PLAN: 'Plan templates',
};

export default async function TemplatesPage() {
  const list = await apiGet<TemplateRow[]>('/admin/templates');
  const types = [...new Set((list ?? []).map((t) => t.type))];
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Templates and clause library"
        subtitle="The documents the platform starts from. A contract template lists the clauses assembled into every new contract; mandatory clauses can never be left out."
        actions={
          <>
            <Button variant="secondary" disabled aria-label="Create a template (coming soon)">
              Create a template
            </Button>
            <Badge tone="warning">Coming soon</Badge>
          </>
        }
      />
      {!list ? (
        <EmptyState title="Templates are unavailable" body="Please refresh the page." />
      ) : (
        types.map((ty) => (
          <section key={ty} aria-labelledby={`t-${ty}`} className="flex flex-col gap-3">
            <SectionHeader id={`t-${ty}`} title={TYPE[ty] ?? ty} />
            <ul className="grid gap-3 lg:grid-cols-2">
              {list
                .filter((t) => t.type === ty)
                .map((t) => (
                  <Panel as="li" key={t.id} className="p-4" data-testid={`template-${t.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading text-sm font-medium">{t.name}</h3>
                      <Badge tone="neutral">Version {t.version}</Badge>
                      <Badge tone={t.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {t.status === 'ACTIVE' ? 'Active' : t.status}
                      </Badge>
                    </div>
                    {t.appliesTo.length > 0 && (
                      <p className="mt-1 text-sm text-text-muted">
                        Used for: {t.appliesTo.join(', ')} tenders
                      </p>
                    )}
                    {t.clauses.length > 0 && (
                      <details className="mt-2">
                        <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold">
                          {t.clauses.length} clauses ({t.clauses.filter((c) => c.mandatory).length} mandatory)
                        </summary>
                        <ul className="flex flex-col gap-1 text-sm">
                          {t.clauses.map((c) => (
                            <li key={c.id} className="flex items-center justify-between gap-2">
                              <span>{c.title}</span>
                              {c.mandatory && <Badge tone="neutral">Mandatory</Badge>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </Panel>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
