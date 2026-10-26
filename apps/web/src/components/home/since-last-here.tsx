'use client';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ActivityRow, RowList } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';
import {
  readLastVisit,
  sinceLines,
  sinceSummary,
  writeLastVisit,
  type ActivityLine,
  type NoteLite,
} from '@/lib/home';

const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * "Since you were last here": your notifications and the activity you can see, newer than your last visit.
 * The last visit lives in this browser only (never required): it is saved when you leave the page.
 */
export function SinceLastHere({ activity }: { activity: ActivityLine[] }) {
  const { data: notes } = useData<NoteLite[]>('/notifications');
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setSince(readLastVisit(store()));
    setNow(new Date());
    const save = () => writeLastVisit(store(), new Date());
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save(); // navigating inside the app unmounts the page without a pagehide
    };
  }, []);

  const lines = useMemo(
    () => (since === undefined || !now ? [] : sinceLines(since, now, { notes: notes ?? [], activity })),
    [since, now, notes, activity],
  );
  const ready = since !== undefined && notes !== null;
  const shown = lines.slice(0, 3);
  return (
    <section
      aria-labelledby="since-h"
      data-testid="since-panel"
      className="rounded-lg border border-border p-5 text-text sm:p-6"
    >
      <h2 id="since-h" className="flex items-center gap-2 font-heading text-xl font-medium">
        <Sparkles className="size-4 text-text-muted" aria-hidden="true" />
        Since you were last here
      </h2>
      <p className="mt-1 text-xs text-text-muted" role="status">
        {ready ? sinceSummary(lines.length, since ?? null) : 'Checking what is new…'}
      </p>
      {ready && shown.length > 0 && (
        <RowList className="mt-4 border-b-0" aria-label="What changed">
          {shown.map((l) => (
            <ActivityRow key={l.key} who={l.who} text={l.text} meta={l.meta} href={l.href} />
          ))}
        </RowList>
      )}
    </section>
  );
}
