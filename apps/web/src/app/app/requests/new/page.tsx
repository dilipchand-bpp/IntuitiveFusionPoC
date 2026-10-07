import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrivacyNotice } from '@/components/b11/privacy';
import { IntakeChat } from '@/components/requests/intake-chat';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'New request – Intuitive Fusion' };

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request } = await searchParams;
  const user = await getSessionUser();
  if (!user) notFound();
  const canCreate = user.roles.some((r) => r === 'REQUESTER' || r === 'PROCUREMENT');
  if (!canCreate) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">New request</h1>
        <p className="text-text-muted">Only requesters and the procurement team can create requests.</p>
        <Link href="/app/requests">Back to requests</Link>
      </div>
    );
  }
  const validId = request && /^[0-9a-f-]{36}$/i.test(request) ? request : undefined;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm">
          <Link href="/app/requests">← Requests</Link>
        </p>
        <h1 className="mt-1 text-3xl font-bold">{validId ? 'Continue your request' : 'New request'}</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Tell the assistant what you need in your own words. It drafts the request and asks only for what it
          cannot work out. You can change anything before you submit.
        </p>
      </header>
      <PrivacyNotice context="REQUEST_INTAKE" csrf={user.csrfToken} />
      <IntakeChat csrf={user.csrfToken} requestId={validId} />
    </div>
  );
}
