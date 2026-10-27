import { SupplierRisk } from '@/components/reports/b6-reports';
import { PageHeader } from '@if/ui';
import { DiversityCard, SupplierScores } from '@/components/supplier/b8-staff';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Supplier risk – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Supplier risk map"
        subtitle="Where suppliers are, with weather, financial-distress and geopolitical signals, and the single points of failure. The external feeds are simulated."
      />
      <SupplierRisk
        csrf={user!.csrfToken}
        canEdit={user!.roles.some((r) => r === 'PROCUREMENT' || r === 'ADMIN')}
      />
      <SupplierScores
        canOpen={user!.roles.some((r) => ['PROCUREMENT', 'LEGAL', 'FINANCE', 'ADMIN'].includes(r))}
      />
      {user!.roles.some((r) => ['PROCUREMENT', 'EXEC', 'FINANCE'].includes(r)) && <DiversityCard />}
    </div>
  );
}
