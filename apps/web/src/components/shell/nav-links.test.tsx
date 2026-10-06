// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/lib/nav';
import { NavLinks } from './nav-links';

let path = '/app/requests';
vi.mock('next/navigation', () => ({ usePathname: () => path }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

const item = (href: string, label: string, section: NavItem['section']): NavItem => ({
  href,
  label,
  icon: 'dashboard',
  roles: ['EXEC'],
  section,
  module: label,
  requirements: [],
  blurb: '',
});
const ITEMS = [
  item('/app/dashboard', 'Dashboard', 'Overview'),
  item('/app/requests', 'Requests', 'Procure'),
  item('/app/tenders', 'Tenders', 'Procure'),
  item('/app/reports', 'Reports', 'Insight'),
  item('/app/audit', 'Audit trail', 'Oversight'),
];

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const isShown = (label: string) => {
  const link = screen.getByText(label, { selector: 'a' });
  return !link.closest('ul')!.hidden;
};

describe('the left menu groups pages under headings that open and close', () => {
  it('starts short: the first group and the group holding the current page are open, the rest closed', () => {
    path = '/app/tenders';
    render(<NavLinks items={ITEMS} />);
    expect(isShown('Dashboard')).toBe(true);
    expect(isShown('Tenders')).toBe(true);
    expect(isShown('Reports')).toBe(false);
    expect(isShown('Audit trail')).toBe(false);
    expect(screen.getByRole('button', { name: 'Procure' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Insight' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('a heading opens and closes its pages, and the choice is remembered', async () => {
    path = '/app/requests';
    const user = userEvent.setup();
    const { unmount } = render(<NavLinks items={ITEMS} />);
    await user.click(screen.getByRole('button', { name: 'Insight' }));
    expect(isShown('Reports')).toBe(true);
    unmount();
    render(<NavLinks items={ITEMS} />);
    expect(isShown('Reports')).toBe(true); // remembered
    await user.click(screen.getByRole('button', { name: 'Insight' }));
    expect(isShown('Reports')).toBe(false);
  });

  it('collapse all and expand all', async () => {
    path = '/app/requests';
    const user = userEvent.setup();
    render(<NavLinks items={ITEMS} />);
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    for (const l of ['Dashboard', 'Requests', 'Reports', 'Audit trail']) expect(isShown(l)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    for (const l of ['Dashboard', 'Requests', 'Reports', 'Audit trail']) expect(isShown(l)).toBe(true);
  });

  it('every page stays in the document, so it can be found and tested even while its group is closed', () => {
    path = '/app/dashboard';
    render(<NavLinks items={ITEMS} />);
    expect(document.querySelectorAll('nav a[href]')).toHaveLength(ITEMS.length);
  });

  it('marks the current page', () => {
    path = '/app/tenders';
    render(<NavLinks items={ITEMS} />);
    expect(screen.getByText('Tenders', { selector: 'a' })).toHaveAttribute('aria-current', 'page');
  });
});
