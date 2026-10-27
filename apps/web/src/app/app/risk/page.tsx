import { PageHeader } from '@if/ui';
import { RiskRegister } from '@/components/b9/risk-register';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Risk register – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit, risk and compliance register"
        subtitle="Risks, audit findings and obligations in one place, rated, owned and followed up."
      />
      <RiskRegister csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
