'use client';
import { Check, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, Field, Select } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';

interface Milestone {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
  celebration: string;
}
interface Progress {
  milestones: Milestone[];
  doneCount: number;
  percent: number;
  complete: boolean;
}
type Character = 'rocket' | 'hiker' | 'sailboat';
interface Pref {
  playful: boolean;
  character: Character;
}
const PREF = 'if-journey';
const DEFAULT: Pref = { playful: true, character: 'rocket' };
const COLOURS = ['bg-accent', 'bg-success', 'bg-warning', 'bg-info', 'bg-error'];

/** A small themed character, drawn here so there is nothing to download. Decorative: the words say everything it does. */
function Mascot({ kind }: { kind: Character }) {
  const common = {
    width: 34,
    height: 34,
    viewBox: '0 0 32 32',
    'aria-hidden': true as const,
    focusable: false as const,
  };
  if (kind === 'hiker')
    return (
      <svg {...common}>
        <circle cx="16" cy="7" r="4" className="fill-accent" />
        <path
          d="M16 11v10M16 14l-6 5M16 14l6 4M16 21l-5 8M16 21l6 8"
          className="fill-none stroke-accent"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  if (kind === 'sailboat')
    return (
      <svg {...common}>
        <path d="M16 4v18H6z" className="fill-accent" />
        <path d="M18 8v14h8z" className="fill-info" />
        <path d="M4 24h24l-4 5H8z" className="fill-text" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M16 2c5 4 6 10 5 17h-10c-1-7 0-13 5-17z" className="fill-accent" />
      <circle cx="16" cy="12" r="2.6" className="fill-surface" />
      <path d="M11 19l-4 6 5-2zM21 19l4 6-5-2z" className="fill-info" />
      <path d="M13 22h6l-3 7z" className="fill-warning" />
    </svg>
  );
}

/** Progress to completion for one procurement: milestones read from the records, a character on a track, and a small celebration at each one. */
export function ProgressJourney({ requestId }: { requestId: string }) {
  const { data } = useData<Progress>(`/requests/${requestId}/progress`);
  const [pref, setPref] = useState<Pref>(DEFAULT);
  const [cheer, setCheer] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREF);
      if (raw) setPref({ ...DEFAULT, ...(JSON.parse(raw) as Partial<Pref>) });
    } catch {
      /* private window: keep the defaults */
    }
  }, []);
  const save = (p: Pref) => {
    setPref(p);
    try {
      localStorage.setItem(PREF, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };

  // a new milestone since this person last looked is celebrated once
  useEffect(() => {
    if (!data) return;
    const key = `if-journey-seen-${requestId}`;
    let seen = -1;
    try {
      seen = Number(localStorage.getItem(key) ?? '-1');
      localStorage.setItem(key, String(data.doneCount));
    } catch {
      /* ignore */
    }
    if (seen >= 0 && data.doneCount > seen) {
      const reached = data.milestones.filter((m) => m.done)[data.doneCount - 1];
      setCheer(reached?.celebration ?? 'Another step done.');
    }
  }, [data, requestId]);

  if (!data) return null;
  const current = data.milestones.find((m) => m.current);
  return (
    <Card role="region" aria-labelledby="jr-h" data-testid="journey" className="relative overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="jr-h" className="font-heading text-xl font-bold">
          {data.complete ? 'All done' : 'Journey to completion'}
        </h2>
        <p className="text-sm text-text-muted" data-testid="journey-count">
          {data.doneCount} of {data.milestones.length} steps · {data.percent}%
          {current ? ` · next: ${current.label.toLowerCase()}` : ''}
        </p>
      </div>
      <div className="relative mt-5 pb-1" aria-hidden="true">
        <div className="h-2 w-full rounded-full bg-surface-alt">
          <div
            className="h-2 rounded-full bg-brand-gradient transition-[width] duration-700"
            style={{ width: `${data.percent}%` }}
            data-testid="journey-bar"
          />
        </div>
        {pref.playful && (
          <span
            className="absolute -top-7 transition-[left] duration-700"
            style={{ left: `calc(${Math.min(data.percent, 96)}% - 8px)` }}
            data-testid="journey-mascot"
          >
            <Mascot kind={pref.character} />
          </span>
        )}
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Milestones">
        {data.milestones.map((m) => (
          <li
            key={m.key}
            aria-current={m.current ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${m.current ? 'border-accent bg-accent/5 font-semibold' : 'border-border'}`}
          >
            {m.done ? (
              <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <Circle className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
            )}
            <span>
              {m.label}
              <span className="sr-only">{m.done ? ', done' : m.current ? ', next' : ', to do'}</span>
            </span>
          </li>
        ))}
      </ol>
      {cheer && (
        <div className="relative mt-3" data-testid="celebration">
          {pref.playful && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-2 h-24">
              {Array.from({ length: 18 }, (_, n) => (
                <span
                  key={n}
                  className={`confetti-piece ${COLOURS[n % COLOURS.length]}`}
                  style={{
                    left: `${(n * 100) / 18 + 2}%`,
                    ['--d' as string]: `${(n % 6) * 90}ms`,
                    ['--dx' as string]: `${(n % 2 ? 1 : -1) * (8 + (n % 5) * 6)}px`,
                    ['--rot' as string]: `${200 + n * 40}deg`,
                  }}
                />
              ))}
            </div>
          )}
          <p
            role="status"
            className="relative rounded-md border border-success bg-success-bg p-3 text-sm font-semibold text-success"
          >
            Milestone reached: {cheer}
          </p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-3 text-sm">
        <label className="flex min-h-[44px] items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={pref.playful}
            onChange={(e) => save({ ...pref, playful: e.target.checked })}
          />
          Playful progress (character and celebrations)
        </label>
        {pref.playful && (
          <Field label="Character">
            <Select
              value={pref.character}
              onChange={(e) => save({ ...pref, character: e.target.value as Character })}
              className="w-40"
            >
              <option value="rocket">Rocket</option>
              <option value="hiker">Hiker</option>
              <option value="sailboat">Sailboat</option>
            </Select>
          </Field>
        )}
      </div>
    </Card>
  );
}
