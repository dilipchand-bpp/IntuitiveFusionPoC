'use client';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, PageHeader } from '@if/ui';
import { greeting, longDate } from '@/lib/home';

/**
 * "NORTHLINE / TUESDAY 27 OCTOBER", the greeting by the time of day on the person's own clock, a calm subtitle and the
 * page's actions. The server renders its own clock; the browser corrects it as soon as it loads.
 */
export function HomeHeader({
  workspace,
  name,
  serverNow,
  subtitle,
  newRequestHref,
  personaliseHref,
}: {
  workspace: string;
  name: string;
  serverNow: string;
  subtitle: string;
  newRequestHref?: string;
  personaliseHref?: string;
}) {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => setNow(new Date()), []);
  return (
    <PageHeader
      eyebrow={
        <span suppressHydrationWarning>
          {workspace} / {longDate(now)}
        </span>
      }
      title={<span suppressHydrationWarning>{greeting(name, now.getHours())}</span>}
      subtitle={subtitle}
      subtitleTestId="scope-text"
      actions={
        <>
          {personaliseHref && (
            <Button asChild variant="ghost" size="sm">
              <Link href={personaliseHref}>Personalise my dashboard</Link>
            </Button>
          )}
          {newRequestHref && (
            <Button asChild size="sm">
              <Link href={newRequestHref}>
                <Plus className="size-4" aria-hidden="true" />
                New request
              </Link>
            </Button>
          )}
        </>
      }
    />
  );
}
