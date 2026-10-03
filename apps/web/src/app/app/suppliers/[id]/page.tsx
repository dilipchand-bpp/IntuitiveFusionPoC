import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@if/ui';
import { AddContact } from '@/components/supplier/add-contact';
import { StatusBadges } from '@/components/supplier/status-badges';
import type { SupplierProfile } from '@/components/supplier/types';
import { CONTRACT_STATUS, aud, formatDateTime } from '@/lib/labels';
import { apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Supplier – Intuitive Fusion' };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, res] = await Promise.all([
    getSessionUser(),
    apiGetResult<SupplierProfile>(`/suppliers/${id}`),
  ]);
  if (!user || res.status === 404 || res.status === 403) notFound();
  const s = res.data;
  if (!s) return <EmptyState title="The supplier could not be loaded" body="Please refresh the page." />;
  return (
    <div className="flex flex-col gap-6" data-testid="supplier-profile">
      <p className="text-sm">
        <Link href="/app/suppliers">← Suppliers</Link>
      </p>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">{s.company}</h1>
        <p className="font-mono text-sm text-text-muted">ABN {s.abn}</p>
        <StatusBadges sanctions={s.sanctionsStatus} insurance={s.insuranceStatus} />
        <p className="text-sm text-text-muted">
          Last checked {formatDateTime(s.lastCheckedAt)} (simulated screening)
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="contacts-h" role="region">
          <h2 id="contacts-h" className="font-heading text-xl font-bold">
            Contacts
          </h2>
          <ul className="mt-3 flex flex-col gap-2" data-testid="contacts">
            {s.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-semibold">{c.name}</span>
                  <span className="block text-text-muted">{c.email}</span>
                </span>
                {c.awaitingActivation && <Badge tone="warning">Waiting to activate</Badge>}
              </li>
            ))}
          </ul>
          {s.canAddContact && (
            <div className="mt-3">
              <AddContact supplierId={s.id} company={s.company} csrf={user.csrfToken} />
            </div>
          )}
        </Card>

        <Card aria-labelledby="tenders-h" role="region">
          <h2 id="tenders-h" className="font-heading text-xl font-bold">
            Tenders and contracts
          </h2>
          {s.tenders.length === 0 && s.contracts.length === 0 && (
            <p className="mt-2 text-sm text-text-muted">Nothing yet.</p>
          )}
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {s.tenders.map((t) => (
              <li key={t.tenderId} className="flex flex-wrap justify-between gap-2">
                <span>
                  <span className="font-mono text-xs text-text-muted">{t.number}</span> {t.title}
                </span>
                <span className="text-text-muted">Bid {t.submission?.toLowerCase() ?? 'not started'}</span>
              </li>
            ))}
            {s.contracts.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2">
                <Link href={`/app/contracts/${c.id}`}>{c.number}</Link>
                <span className="text-text-muted">
                  {aud.format(c.value)} · {CONTRACT_STATUS[c.status]?.[0] ?? c.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
