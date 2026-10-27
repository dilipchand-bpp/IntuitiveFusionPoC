import { ShieldCheck } from 'lucide-react';
import { EmptyState, KpiCell, KpiStrip, ListRow, PageHeader, RowList, padNumber } from '@if/ui';
import type { AdminUser } from '@/components/admin/users-panel';
import type { DelegationRow } from '@/components/admin/delegations-panel';
import type { WorkflowRow } from '@/components/admin/workflows-panel';
import { apiGet } from '@/lib/session';

export const metadata = { title: 'Administration – Intuitive Fusion' };

export default async function AdminHome() {
  const [users, delegations, workflows, templates] = await Promise.all([
    apiGet<AdminUser[]>('/admin/users'),
    apiGet<DelegationRow[]>('/admin/delegations'),
    apiGet<WorkflowRow[]>('/admin/workflows'),
    apiGet<Array<{ id: string }>>('/admin/templates'),
  ]);
  if (!users || !delegations || !workflows || !templates)
    return <EmptyState title="Administration is unavailable" body="Please refresh the page." />;
  const areas = [
    {
      href: '/admin/users',
      label: 'Users and roles',
      body: `${users.filter((u) => u.active).length} people can sign in${users.some((u) => u.awaitingActivation) ? `, ${users.filter((u) => u.awaitingActivation).length} waiting to activate` : ''}.`,
    },
    {
      href: '/admin/delegations',
      label: 'Delegations and alert timing',
      body: `${delegations.filter((d) => d.active).length} active limits of authority.`,
    },
    {
      href: '/admin/settings',
      label: 'Settings',
      body: 'Numbering, labels, custom fields, checkpoints, intake rules, notifications and routing.',
    },
    {
      href: '/admin/workflows',
      label: 'Workflows',
      body: `${workflows.length} workflows route new requests; the simple one is editable.`,
    },
    {
      href: '/admin/templates',
      label: 'Templates and clauses',
      body: `${templates.length} templates, read only for now.`,
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Administration"
        subtitle="Configure who can do what and how the platform behaves. Every change is audited. Administrators cannot read bid content."
      />
      <KpiStrip label="At a glance">
        <KpiCell label="People" value={padNumber(users.length)} />
        <KpiCell label="Limits of authority" value={padNumber(delegations.length)} />
        <KpiCell label="Workflows" value={padNumber(workflows.length)} />
        <KpiCell label="Templates" value={padNumber(templates.length)} />
      </KpiStrip>
      <RowList aria-label="Administration areas">
        {areas.map((a) => (
          <ListRow key={a.href} href={a.href} accent="accent" title={a.label} subtitle={a.body} />
        ))}
      </RowList>
      <p className="flex items-start gap-2 text-sm text-text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Administrators hold no path to bids or scores: refusals are enforced by the application and by the
        database, and every attempt is recorded in the audit trail.
      </p>
    </div>
  );
}
