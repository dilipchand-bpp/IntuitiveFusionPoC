'use client';
import { ChevronDown, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Menu } from '@if/ui';

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
        {
          label: 'Sign out',
          onSelect: () => void signOut(),
          icon: <LogOut className="size-4" aria-hidden="true" />,
        },
      ]}
      trigger={
        <Button variant="ghost" aria-label={`Account menu for ${name}`} className="gap-2 px-2">
          <Avatar name={name} />
          <span className="hidden max-w-32 truncate text-sm font-semibold sm:inline">{name}</span>
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
      }
    />
  );
}
