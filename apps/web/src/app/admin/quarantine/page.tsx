import { QuarantinePanel } from '@/components/b11/quarantine-panel';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Upload quarantine – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Upload quarantine</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Every upload is scanned. Infected files are refused and listed here without their content; uploads
          held while the scanner was down wait here until they are scanned. The scanner is simulated.
        </p>
      </header>
      <QuarantinePanel csrf={user!.csrfToken} roles={user!.roles} />
    </div>
  );
}
