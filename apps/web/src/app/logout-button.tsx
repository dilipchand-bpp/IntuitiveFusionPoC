'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@if/ui';

export function LogoutButton({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      className="w-fit"
      onClick={async () => {
        setBusy(true);
        await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } }).catch(
          () => undefined,
        );
        router.replace('/login');
        router.refresh();
      }}
    >
      Log out
    </Button>
  );
}
