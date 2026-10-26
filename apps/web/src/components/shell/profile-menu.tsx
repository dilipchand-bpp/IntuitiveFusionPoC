'use client';
import { LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Avatar, Menu, useThemeChoice } from '@if/ui';

export function ProfileMenu({
  name,
  role,
  email,
  csrfToken,
}: {
  name: string;
  role: string;
  email: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const { next, toggle } = useThemeChoice();
  async function signOut() {
    await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } }).catch(
      () => undefined,
    );
    router.replace('/login');
    router.refresh();
  }
  return (
    <Menu
      header={
        <>
          <p className="font-semibold">{name}</p>
          <p className="text-text-muted">{email}</p>
          <p className="text-xs uppercase tracking-wide text-text-muted">{role.replace('_', ' ')}</p>
        </>
      }
      actions={[
        ...(role === 'SUPPLIER'
          ? []
          : [
              {
                label: 'Security',
                onSelect: () => router.push('/app/security'),
                icon: <ShieldCheck className="size-4" aria-hidden="true" />,
              },
            ]),
        {
          label: `Switch to ${next} mode`,
          onSelect: toggle,
          icon:
            next === 'light' ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            ),
        },
        {
          label: 'Sign out',
          onSelect: () => void signOut(),
          icon: <LogOut className="size-4" aria-hidden="true" />,
        },
      ]}
      trigger={
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Avatar name={name} className="size-8 bg-surface-alt" />
        </button>
      }
    />
  );
}
