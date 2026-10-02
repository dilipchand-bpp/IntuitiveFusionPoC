'use client';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Popover } from '@if/ui';

interface Item {
  id: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export function NotificationBell({ csrfToken }: { csrfToken: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/notifications', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setItems((await r.json()) as Item[]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = items?.filter((i) => !i.read).length ?? 0;

  async function markRead(id: string) {
    setItems((cur) => cur?.map((i) => (i.id === id ? { ...i, read: true } : i)) ?? cur);
    await fetch(`/api/v1/notifications/${id}/read`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    }).catch(() => undefined);
  }

  return (
    <Popover
      label="Notifications"
      onOpenChange={(o) => o && void load()}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications, ${unread} unread`}
          className="relative"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-accent-fg"
            >
              {unread}
            </span>
          )}
        </Button>
      }
    >
      <h2 className="px-2 py-1 font-heading text-base font-semibold">Notifications</h2>
      {failed && <p className="px-2 py-3 text-sm text-error">Could not load notifications.</p>}
      {!failed && items && items.length === 0 && (
        <p className="px-2 py-3 text-sm text-text-muted">You are all caught up.</p>
      )}
      {!failed && !items && <p className="px-2 py-3 text-sm text-text-muted">Loading…</p>}
      <ul className="flex max-h-80 flex-col overflow-y-auto">
        {items?.map((n) => (
          <li key={n.id} className="border-t border-border first:border-t-0">
            <div className="flex items-start gap-2 p-2">
              <span
                aria-hidden="true"
                className={`mt-2 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-accent'}`}
              />
              <div className="flex-1 text-sm">
                <p className={n.read ? 'font-medium' : 'font-semibold'}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => void markRead(n.id)}>
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                  {!n.read && <span className="sr-only"> (unread)</span>}
                </p>
                {n.body && <p className="text-text-muted">{n.body}</p>}
              </div>
              {!n.read && (
                <Button
                  variant="ghost"
                  onClick={() => void markRead(n.id)}
                  className="min-h-[44px] px-2 text-xs"
                >
                  Mark read
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
