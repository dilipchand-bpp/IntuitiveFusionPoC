'use client';
import * as RadixTabs from '@radix-ui/react-tabs';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './button';
import { THEME_STORAGE_KEY as KEY } from './theme-script';
import { cn } from './cn';

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}
/** Roving-tabindex tabs with arrow-key support (Radix). */
export function Tabs({
  items,
  label,
  defaultValue,
}: {
  items: TabItem[];
  label: string;
  defaultValue?: string;
}) {
  return (
    <RadixTabs.Root defaultValue={defaultValue ?? items[0]?.value}>
      <RadixTabs.List aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
        {items.map((t) => (
          <RadixTabs.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              'min-h-[44px] shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 text-sm font-semibold text-text-muted',
              'data-[state=active]:border-accent data-[state=active]:text-text',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
            )}
          >
            {t.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((t) => (
        <RadixTabs.Content
          key={t.value}
          value={t.value}
          className="pt-4 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

export type ThemeChoice = 'light' | 'dark';

function currentTheme(): ThemeChoice {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice | null>(null);
  useEffect(() => setTheme(currentTheme()), []);
  const next: ThemeChoice = theme === 'dark' ? 'light' : 'dark';
  const toggle = () => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage can be blocked; the choice then lasts for this page view only */
    }
    setTheme(next);
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      aria-pressed={theme === 'dark'}
    >
      {theme === 'dark' ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </Button>
  );
}
