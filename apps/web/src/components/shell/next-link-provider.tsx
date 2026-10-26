'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { UiLinkProvider } from '@if/ui';

/** Gives the UI kit's rows, KPI cells and tabs the Next.js router link, so they navigate without a page load. */
export function NextUiLinkProvider({ children }: { children: ReactNode }) {
  return <UiLinkProvider component={Link}>{children}</UiLinkProvider>;
}
