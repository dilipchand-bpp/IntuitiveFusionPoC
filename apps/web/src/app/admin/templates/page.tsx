import { Badge, Button, EmptyState } from '@if/ui';
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
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-extrabold tracking-tight">Templates and clause library</h1>
          <p className="mt-1 max-w-prose text-text-muted">
            The documents the platform starts from. A contract template lists the clauses assembled into every
            new contract; mandatory clauses can never be left out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled aria-label="Create a template (coming soon)">
            Create a template
          </Button>
          <Badge tone="warning">Coming soon</Badge>
        </div>
      </header>
      {!list ? (
        <EmptyState title="Templates are unavailable" body="Please refresh the page." />
      ) : (
        types.map((ty) => (
          <section key={ty} aria-labelledby={`t-${ty}`} className="flex flex-col gap-3">
            <h2 id={`t-${ty}`} className="font-heading text-xl font-bold">
              {TYPE[ty] ?? ty}
            </h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {list
                .filter((t) => t.type === ty)
                .map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-border bg-surface p-4 shadow-sm"
                    data-testid={`template-${t.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading font-semibold">{t.name}</h3>
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
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
