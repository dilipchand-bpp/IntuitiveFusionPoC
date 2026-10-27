import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@if/ui';
import { PrivacyNotice } from '@/components/b11/privacy';
import { IntakeChat } from '@/components/requests/intake-chat';
import { DraftPanel } from '@/components/copilot/draft-panel';
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
      <div className="flex flex-col gap-6">
        <PageHeader
          title="New request"
          subtitle="Only requesters and the procurement team can create requests."
        />
        <Link href="/app/requests">Back to requests</Link>
      </div>
    );
  }
  const validId = request && /^[0-9a-f-]{36}$/i.test(request) ? request : undefined;
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          <Link href="/app/requests">← Requests</Link>
        </p>
        <PageHeader
          title={validId ? 'Continue your request' : 'New request'}
          subtitle="Tell the assistant what you need in your own words. It drafts the request and asks only for what it cannot work out. You can change anything before you submit."
        />
      </div>
      <PrivacyNotice context="REQUEST_INTAKE" csrf={user.csrfToken} />
      <IntakeChat csrf={user.csrfToken} requestId={validId} />
      <DraftPanel
        csrf={user.csrfToken}
        kinds={['REQUEST']}
        procurementId={validId}
        heading="Draft the whole request with AI"
        idPrefix="aidraft"
      />
    </div>
  );
}
