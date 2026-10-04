import Link from 'next/link';
import { Landmark, Settings, ShieldCheck, Users, Workflow, FileText } from 'lucide-react';
import { EmptyState, KpiCard } from '@if/ui';
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
      icon: Users,
    },
    {
      href: '/admin/delegations',
      label: 'Delegations and alert timing',
      body: `${delegations.filter((d) => d.active).length} active limits of authority.`,
      icon: Landmark,
    },
    {
      href: '/admin/settings',
      label: 'Settings',
      body: 'Numbering, labels, custom fields, checkpoints, intake rules, notifications and routing.',
      icon: Settings,
    },
    {
      href: '/admin/workflows',
      label: 'Workflows',
      body: `${workflows.length} workflows route new requests; the simple one is editable.`,
      icon: Workflow,
    },
    {
      href: '/admin/templates',
      label: 'Templates and clauses',
      body: `${templates.length} templates, read only for now.`,
      icon: FileText,
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Administration</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Configure who can do what and how the platform behaves. Every change is audited. Administrators
          cannot read bid content.
        </p>
      </header>
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="People" value={users.length} icon={<Users className="size-5" aria-hidden="true" />} />
        <KpiCard
          label="Limits of authority"
          value={delegations.length}
          icon={<Landmark className="size-5" aria-hidden="true" />}
        />
        <KpiCard
          label="Workflows"
          value={workflows.length}
          icon={<Workflow className="size-5" aria-hidden="true" />}
        />
        <KpiCard
          label="Templates"
          value={templates.length}
          icon={<FileText className="size-5" aria-hidden="true" />}
        />
      </section>
      <ul className="grid gap-4 md:grid-cols-2" aria-label="Administration areas">
        {areas.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className="card-lift flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-5 text-text no-underline shadow-sm"
            >
              <span className="icon-tile shrink-0">
                <a.icon className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-heading text-lg font-bold">{a.label}</span>
                <span className="text-sm text-text-muted">{a.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 text-sm text-text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Administrators hold no path to bids or scores: refusals are enforced by the application and by the
        database, and every attempt is recorded in the audit trail.
      </p>
    </div>
  );
}
