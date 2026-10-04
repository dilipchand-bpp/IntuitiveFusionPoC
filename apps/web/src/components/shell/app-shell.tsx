import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { MfaPanel, type MfaStatus } from '@/components/security/mfa-panel';
import { navFor } from '@/lib/nav';
import { apiGet, getSessionUser } from '@/lib/session';
import { ShellFrame } from './shell-frame';

/** Server component: resolves the user once per request, filters the nav by role, hands off to the client frame. */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // an organisation that requires an authenticator app: until it is set up, this is all the person can see
  const mfa = await apiGet<MfaStatus>('/auth/mfa');
  const mustEnrol = Boolean(mfa && mfa.required && !mfa.enrolled);
  return (
    <ShellFrame
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        csrfToken: user.csrfToken,
        homePath: user.homePath,
      }}
      items={navFor(user.roles, Boolean(user.external))}
    >
      {mustEnrol && mfa ? <MfaPanel status={mfa} csrf={user.csrfToken} gate /> : children}
    </ShellFrame>
  );
}
