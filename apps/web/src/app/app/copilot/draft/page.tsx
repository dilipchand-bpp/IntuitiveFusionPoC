import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DraftPanel } from '@/components/copilot/draft-panel';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Draft with AI – Intuitive Fusion' };

export default async function DraftPage() {
  const user = await getSessionUser();
  if (!user) notFound();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm">
          <Link href="/app/copilot">← Procurement Copilot</Link>
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Draft with AI</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Describe a need by typing or speaking, and get a request, plan, job specification, tender document,
          contract draft or evaluation criteria. Change it in plain language, see exactly what changed, and
          undo. Simulated and rules-based.
        </p>
      </header>
      <DraftPanel
        csrf={user.csrfToken}
        kinds={['REQUEST', 'JOB_SPEC', 'PLAN', 'TENDER_DOC', 'CONTRACT_DRAFT', 'EVAL_CRITERIA']}
        defaultOpen
        heading="Describe what you need"
        idPrefix="aidraft"
      />
    </div>
  );
}
