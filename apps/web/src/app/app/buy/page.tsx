import { BuyingView } from '@/components/b9/buying';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Guided buying – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Guided buying</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Buy everyday goods from the approved catalogue, or describe what you need and see a scored
          shortlist.
        </p>
      </header>
      <BuyingView csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
