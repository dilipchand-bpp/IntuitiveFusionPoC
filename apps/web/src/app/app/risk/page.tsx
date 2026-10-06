import { RiskRegister } from '@/components/b9/risk-register';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Risk register – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Audit, risk and compliance register</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Risks, audit findings and obligations in one place, rated, owned and followed up.
        </p>
      </header>
      <RiskRegister csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
