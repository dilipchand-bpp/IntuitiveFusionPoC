import { SupplierRisk } from '@/components/reports/b6-reports';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Supplier risk – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Supplier risk map</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Where suppliers are, with weather, financial-distress and geopolitical signals, and the single
          points of failure. The external feeds are simulated.
        </p>
      </header>
      <SupplierRisk
        csrf={user!.csrfToken}
        canEdit={user!.roles.some((r) => r === 'PROCUREMENT' || r === 'ADMIN')}
      />
    </div>
  );
}
