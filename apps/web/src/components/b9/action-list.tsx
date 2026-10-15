'use client';
import Link from 'next/link';
import { Badge, Button, EmptyState } from '@if/ui';
import { ASK_EVENT, type AskEventDetail } from '@/components/shell/ask-ai';
import { useData } from '@/components/contract/b5-shared';

interface Item {
  key: string;
  kind: string;
  title: string;
  detail: string;
  link: string;
  /** For a Procurement Copilot item: where to go and what to do, and the ids Ask needs. */
  whatToDo?: string;
  runId?: string;
  gateId?: string;
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
        <li key={i.key} className="flex flex-col gap-2">
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
          {i.whatToDo && i.runId && (
            <p className="flex flex-wrap items-center gap-3 px-1 text-sm" data-testid="action-what-to-do">
              <span className="min-w-0 flex-1">{i.whatToDo.replace(/ Open \/\S+$/, '')}</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent<AskEventDetail>(ASK_EVENT, {
                      detail: {
                        question: 'What do I do?',
                        path: `/app/copilot/${i.runId}`,
                        ...(i.gateId ? { gateId: i.gateId } : {}),
                      },
                    }),
                  )
                }
              >
                What do I do?
              </Button>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
