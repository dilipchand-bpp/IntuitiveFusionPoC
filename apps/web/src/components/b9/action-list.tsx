'use client';
import Link from 'next/link';
import { Badge, EmptyState } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';

interface Item {
  key: string;
  kind: string;
  title: string;
  detail: string;
  link: string;
}

/** The items behind the dashboard card "Waiting for you" (GET /action-items), each linking to where the action is taken. */
export function ActionList() {
  const { data, error } = useData<{ count: number; items: Item[] }>('/action-items');
  if (error)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-text-muted">Loading…</p>;
  if (data.items.length === 0)
    return (
      <EmptyState title="Nothing is waiting for you" body="There are no actions for your roles right now." />
    );
  return (
    <ul className="flex flex-col gap-3" aria-label="Actions waiting for you" data-testid="action-list">
      {data.items.map((i) => (
        <li key={i.key}>
          <Link
            href={i.link}
            className="flex min-h-[44px] flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 text-text no-underline shadow-sm hover:bg-surface-alt"
          >
            <Badge tone="info">{i.kind}</Badge>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{i.title}</span>
              <span className="block text-sm text-text-muted">{i.detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
