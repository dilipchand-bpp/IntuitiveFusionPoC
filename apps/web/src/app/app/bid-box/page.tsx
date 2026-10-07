import { BidBoxPanel } from '@/components/b11/bid-box-panel';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Sealed bids – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Sealed bids</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Bids are encrypted when they are uploaded. Until the tender closes, and for a high-value tender
          until two witnesses open it, only metadata is shown.
        </p>
      </header>
      <BidBoxPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
