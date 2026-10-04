import { EmptyState } from '@if/ui';
import { LegalDesk, type Board, type Knowledge } from '@/components/legal/legal-desk';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Legal desk – Intuitive Fusion' };

export default async function LegalPage() {
  const [user, board, kb] = await Promise.all([
    getSessionUser(),
    apiGet<Board>('/legal/matters'),
    apiGet<{ items: Knowledge[] }>('/legal-knowledge'),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Legal desk</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Legal matters on a board, the hours spent reviewing each, and the policies and fallback positions
          legal keeps for the platform to draw on.
        </p>
      </header>
      {!board || !kb || !user ? (
        <EmptyState title="The legal desk is unavailable" body="Please refresh the page." />
      ) : (
        <LegalDesk
          initialBoard={board}
          initialKnowledge={kb.items}
          csrf={user.csrfToken}
          canEdit={user.roles.includes('LEGAL')}
        />
      )}
    </div>
  );
}
