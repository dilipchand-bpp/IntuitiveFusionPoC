// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/lib/nav';
import { MobileNav } from './mobile-nav';
import { TopNav } from './top-nav';

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
  item('/app/copilot', 'Procurement Copilot', 'Procure'),
  item('/app/requests', 'Requests', 'Procure'),
  item('/app/plans', 'Procurement plans', 'Procure'),
  item('/app/tenders', 'Tenders', 'Procure'),
  item('/app/legal', 'Legal desk', 'Contracts'),
];

afterEach(cleanup);

describe('the top tabs', () => {
  it('shows a tab per group; a group of several pages is a button, a group of one is a link', () => {
    path = '/app/requests';
    render(<TopNav items={ITEMS} />);
    expect(screen.getByRole('button', { name: 'Your work' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Requests' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sourcing' })).toHaveAttribute('href', '/app/tenders');
    expect(screen.getByRole('link', { name: 'Legal' })).toHaveAttribute('href', '/app/legal');
  });

  it('every page stays in the document while its menu is closed (and is hidden from the screen)', () => {
    path = '/app/dashboard';
    render(<TopNav items={ITEMS} />);
    expect(document.querySelectorAll('nav a[href]')).toHaveLength(ITEMS.length);
    const list = document.getElementById('topnav-requests')!;
    expect(list.hidden).toBe(true);
  });

  it('marks the current tab and the current page', async () => {
    path = '/app/plans';
    const user = userEvent.setup();
    render(<TopNav items={ITEMS} />);
    expect(screen.getByRole('button', { name: 'Requests' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Your work' })).not.toHaveAttribute('aria-current');
    await user.click(screen.getByRole('button', { name: 'Requests' }));
    expect(screen.getByRole('link', { name: 'Procurement plans' })).toHaveAttribute('aria-current', 'page');
  });

  it('a click opens the menu and a second click closes it', async () => {
    path = '/app/dashboard';
    const user = userEvent.setup();
    render(<TopNav items={ITEMS} />);
    const tab = screen.getByRole('button', { name: 'Requests' });
    expect(tab).toHaveAttribute('aria-expanded', 'false');
    await user.click(tab);
    expect(tab).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Procurement plans' })).toBeVisible();
    await user.click(tab);
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });

  it('Arrow Down opens the menu on the first page, the arrows move, Escape closes and returns focus to the tab', async () => {
    path = '/app/dashboard';
    const user = userEvent.setup();
    render(<TopNav items={ITEMS} />);
    const tab = screen.getByRole('button', { name: 'Requests' });
    tab.focus();
    await user.keyboard('{ArrowDown}');
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Requests' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: 'Procurement plans' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('link', { name: 'Procurement plans' })).toHaveFocus(); // wraps round
    await user.keyboard('{Escape}');
    expect(tab).toHaveAttribute('aria-expanded', 'false');
    expect(tab).toHaveFocus();
  });

  it('Arrow Right moves between tabs', async () => {
    path = '/app/dashboard';
    const user = userEvent.setup();
    render(<TopNav items={ITEMS} />);
    screen.getByRole('button', { name: 'Your work' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Requests' })).toHaveFocus();
  });

  it('clicking elsewhere closes an open menu', async () => {
    path = '/app/dashboard';
    const user = userEvent.setup();
    render(
      <>
        <TopNav items={ITEMS} />
        <p>elsewhere</p>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Requests' }));
    await user.click(screen.getByText('elsewhere'));
    expect(screen.getByRole('button', { name: 'Requests' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the phone menu', () => {
  it('is an accordion of the same groups; the current group starts open and others open on demand', async () => {
    path = '/app/tenders';
    const user = userEvent.setup();
    render(<MobileNav items={ITEMS} />);
    expect(screen.getByRole('button', { name: 'Sourcing' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Requests' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Requests' }));
    expect(screen.getByRole('link', { name: 'Procurement plans' })).toBeVisible();
  });
  it('closes the drawer when a page is chosen', async () => {
    path = '/app/dashboard';
    const user = userEvent.setup();
    const done = vi.fn();
    render(<MobileNav items={ITEMS} onNavigate={done} />);
    await user.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(done).toHaveBeenCalled();
  });
});
