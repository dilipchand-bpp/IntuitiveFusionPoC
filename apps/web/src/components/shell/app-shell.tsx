import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { navFor } from '@/lib/nav';
import { getSessionUser } from '@/lib/session';
import { ShellFrame } from './shell-frame';

/** Server component: resolves the user once per request, filters the nav by role, hands off to the client frame. */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return (
    <ShellFrame
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        csrfToken: user.csrfToken,
        homePath: user.homePath,
      }}
      items={navFor(user.roles)}
    >
      {children}
    </ShellFrame>
  );
}
