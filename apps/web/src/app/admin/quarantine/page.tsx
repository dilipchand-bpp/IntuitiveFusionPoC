import { QuarantinePanel } from '@/components/b11/quarantine-panel';
import { PageHeader } from '@if/ui';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Upload quarantine – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Upload quarantine"
        subtitle="Every upload is scanned. Infected files are refused and listed here without their content; uploads held while the scanner was down wait here until they are scanned. The scanner is simulated."
      />
      <QuarantinePanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
