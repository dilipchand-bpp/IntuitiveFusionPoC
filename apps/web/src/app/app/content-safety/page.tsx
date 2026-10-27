import { PageHeader } from '@if/ui';
import { ContentSafetyPanel } from '@/components/b11/content-safety';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Content safety – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Content safety"
        subtitle="Supplier and uploaded text is treated as data, never as instructions. When it reads like an instruction to an AI it is flagged here, made inert, and can never change a score, a result or a route."
      />
      <ContentSafetyPanel csrf={user!.csrfToken} />
    </div>
  );
}
