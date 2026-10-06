import { MobileHome } from '@/components/b9/mobile-home';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Mobile home – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  return <MobileHome csrf={user!.csrfToken} name={user!.name} roles={user!.roles} />;
}
