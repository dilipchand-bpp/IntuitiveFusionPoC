import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@if/ui';
import { InstructBox } from '@/components/collab/ai-panels';
import { EvaluationWorkspace } from '@/components/evaluation/evaluation-workspace';
import type { EvalView } from '@/components/evaluation/types';
import { apiGetResult, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Evaluation – Intuitive Fusion' };

export default async function EvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [user, res] = await Promise.all([getSessionUser(), apiGetResult<EvalView>(`/evaluations/${id}`)]);
  if (!user || res.status === 404 || res.status === 403) notFound(); // not on the panel = not there
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/app/evaluations">← Evaluations</Link>
      </p>
      {res.data ? (
        <>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="font-mono text-lg text-text-muted">{res.data.requestNumber}</span>{' '}
            {res.data.title}
          </h1>
          <EvaluationWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />
          {user.roles.includes('PROCUREMENT') && ['COI_PENDING', 'SCORING'].includes(res.data.status) && (
            <InstructBox
              testId="committee-box"
              title="Change the committee"
              label="Say who to add or remove"
              hint='For example "add Tomas" or "remove Mei Tanaka". If several people match you choose from a list.'
              path={`/evaluations/${res.data.id}/committee/instruct`}
              csrf={user.csrfToken}
              button="Do it"
            />
          )}
        </>
      ) : (
        <EmptyState
          title="The evaluation could not be loaded"
          body="Please refresh the page; if the problem continues, contact support."
        />
      )}
    </div>
  );
}
