import { PageHeader } from '@if/ui';
import { ClassificationPanel } from '@/components/b11/classification';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Data classification – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Data classification"
        subtitle="Sensitive data found automatically in text fields: tax file numbers, card and bank details, identity documents, health information and confidentiality markers. Review each finding and see where it sits."
      />
      <ClassificationPanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
