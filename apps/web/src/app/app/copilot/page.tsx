import { PageHeader } from '@if/ui';
import { CopilotHome } from '@/components/copilot/copilot';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Procurement Copilot – Intuitive Fusion' };

export default async function Page({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Procurement Copilot"
        subtitle="An agent that carries a procurement from the first request to a signed contract, acting as you and stopping wherever a person must decide. Simulated and rules-based."
      />
      <CopilotHome csrf={user!.csrfToken} initialText={(sp.text ?? '').slice(0, 1000)} />
    </div>
  );
}
