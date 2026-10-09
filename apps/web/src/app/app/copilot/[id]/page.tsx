import { RunPage } from '@/components/copilot/copilot';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Copilot run – Intuitive Fusion' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  return <RunPage id={id} csrf={user!.csrfToken} canControl={true} />;
}
