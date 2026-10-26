/**
 * The restyle: top tabs with dropdowns per role, keyboard use, the phone drawer, dark by default with a light option,
 * and the "Your work" home (sections, KPI links, filter) with axe in both colour modes.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { navFor } from '../apps/web/src/lib/nav';
import { groupNav } from '../apps/web/src/lib/nav-tabs';
import { signIn } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const ROLE_USERS = [
  ['REQUESTER', 'requester'],
  ['PROCUREMENT', 'procurement'],
  ['LEGAL', 'legal'],
  ['FINANCE', 'finance'],
  ['EXEC', 'exec'],
  ['ADMIN', 'admin'],
  ['PROBITY', 'probity'],
] as const;

const tabLabels = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .locator(':scope > ul > li > :is(button, a)')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));

test.describe('top tabs per role', () => {
  for (const [role, user] of ROLE_USERS) {
    test(`${role}: the tabs are the groups of the pages this role may open, nothing more`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await signIn(page, user);
      const expected = groupNav(navFor([role])).map((g) => g.label);
      expect(await tabLabels(page)).toEqual(expected);
      // every link in the menu is a page the role may open (no dead links); the guard answers 200 for each
      const hrefs = await page
        .getByRole('navigation', { name: 'Main' })
        .locator('a[href]')
        .evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
      expect(hrefs.sort()).toEqual(
        navFor([role])
          .map((n) => n.href)
          .sort(),
      );
    });
  }

  test('the owner-specified tabs appear for a staff role, in order, and Admin only for an administrator', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'procurement');
    const labels = await tabLabels(page);
    expect(labels.slice(0, 7)).toEqual([
      'Your work',
      'Requests',
      'Sourcing',
      'Suppliers',
      'Contracts',
      'Legal',
      'Reports',
    ]);
    expect(labels).not.toContain('Admin');
    await signIn(page, 'admin');
    expect(await tabLabels(page)).toContain('Admin');
  });

  test('the tab of the current page is underlined (aria-current) and the page is marked inside its menu', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'procurement');
    await page.goto('/app/plans');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('button', { name: 'Requests' })).toHaveAttribute('aria-current', 'true');
    await expect(nav.getByRole('button', { name: 'Reports' })).not.toHaveAttribute('aria-current');
    await nav.getByRole('button', { name: 'Requests' }).click();
    await expect(nav.getByRole('link', { name: 'Procurement plans' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('dropdown keyboard use', () => {
  test('Enter opens, arrows move, Escape closes and returns focus, Enter on a page opens it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'procurement');
    const nav = page.getByRole('navigation', { name: 'Main' });
    const tab = nav.getByRole('button', { name: 'Requests' });
    await tab.focus();
    await page.keyboard.press('Enter');
    await expect(tab).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    const first = nav.getByRole('link', { name: 'Requests' });
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(nav.getByRole('link', { name: 'Procurement plans' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    await expect(tab).toBeFocused();
    // Arrow Down on the tab opens it on the first page; Enter follows the link
    await page.keyboard.press('ArrowDown');
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/requests$/);
  });

  test('Arrow Right moves to the next tab, and a menu closes when the pointer goes elsewhere', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'procurement');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('button', { name: 'Your work' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(nav.getByRole('button', { name: 'Requests' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(nav.getByRole('link', { name: 'Procurement plans' })).toBeVisible();
    await page.mouse.click(700, 500);
    await expect(nav.getByRole('link', { name: 'Procurement plans' })).toBeHidden();
  });

  test('the skip link is still the first stop', async ({ page }) => {
    await signIn(page, 'finance');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });
});

test.describe('phone', () => {
  test('the tabs are a drawer with an accordion; Escape closes it and focus returns to the menu button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'procurement');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    const open = page.getByRole('button', { name: 'Open menu' });
    await open.click();
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await nav.getByRole('button', { name: 'Requests' }).click();
    await nav.getByRole('link', { name: 'Procurement plans' }).click();
    await expect(page).toHaveURL(/\/app\/plans$/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('the home page has no sideways scroll on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'exec');
    await page.goto('/app/dashboard');
    await expect(page.getByTestId('work-queue')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });
});

test.describe('colour mode', () => {
  test('dark is the default even when the operating system prefers light; the profile menu switches to light and it persists', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'exec');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Switch to light mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('if-theme'))).toBe('light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('Your work home', () => {
  test('shows the greeting, four figures with drill-down links, the since panel, the queue and recent activity', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'exec');
    await page.goto('/app/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /^Good (morning|afternoon|evening), \w+\.$/,
    );
    await expect(page.getByText(/ \/ \w+day \d{1,2} \w+/).first()).toBeVisible(); // eyebrow: tenant / date
    const kpis = page.getByRole('region', { name: 'Key figures' });
    for (const l of [
      'Active procurements',
      'Awaiting decisions',
      'Active agreements',
      'Expiring within 90 days',
    ])
      await expect(kpis).toContainText(l);
    await expect(kpis).toContainText(/\d\d/); // zero-padded numerals
    await expect(page.getByRole('heading', { name: 'Since you were last here' })).toBeVisible();
    await expect(
      page.getByTestId('work-queue').getByRole('heading', { name: 'Your work queue' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('recent-activity').getByRole('heading', { name: 'Recent activity' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible();
    await expect(page.getByTestId('copilot-card')).toContainText('Procurement Copilot');
    await expect(page.getByRole('link', { name: 'Personalise my dashboard' })).toHaveAttribute(
      'href',
      '/app/dashboard/my',
    );
    await expect(page.getByRole('link', { name: 'New request' })).toHaveAttribute(
      'href',
      '/app/requests/new',
    );
  });

  test('the figures link to where the numbers come from', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'exec');
    await page.goto('/app/dashboard');
    const kpis = page.getByRole('region', { name: 'Key figures' });
    await expect(kpis.getByRole('link', { name: /Active agreements/ })).toHaveAttribute(
      'href',
      '/app/contracts',
    );
    await expect(kpis.getByRole('link', { name: /Expiring within 90 days/ })).toHaveAttribute(
      'href',
      '/app/contracts/expiring',
    );
    await kpis.getByRole('link', { name: /Awaiting decisions/ }).click();
    await expect(page).toHaveURL(/\/app\/actions$/);
    await page.goBack();
    await kpis.getByRole('link', { name: /Active procurements/ }).click();
    await expect(page).toHaveURL(/\/app\/requests$/);
  });

  test('the queue filters as you type, offers Team and All to a portfolio role, and says so calmly when empty', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'procurement');
    await page.goto('/app/dashboard');
    const queue = page.getByTestId('work-queue');
    await expect(queue.getByTestId('queue-list').or(queue.getByTestId('queue-empty'))).toBeVisible();
    const select = queue.getByRole('combobox', { name: 'Show' });
    await expect(select.locator('option')).toHaveText(['My work', 'Team', 'All']);
    await select.selectOption('all');
    await expect(queue.getByTestId('queue-list')).toBeVisible();
    await queue.getByRole('searchbox', { name: 'Find a task or procurement' }).fill('zzzz-no-such-thing');
    await expect(queue.getByTestId('queue-empty')).toHaveText('Nothing matches that search.');
  });

  test('a requester gets the same page with their own data and no link they cannot open', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'requester');
    await page.goto('/app/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');
    const kpis = page.getByRole('region', { name: 'Key figures' });
    await expect(kpis.getByRole('link', { name: /Active agreements/ })).toHaveCount(0);
    await expect(kpis.getByRole('link', { name: /Expiring within 90 days/ })).toHaveCount(0);
    await expect(
      page.getByTestId('work-queue').getByRole('combobox', { name: 'Show' }).locator('option'),
    ).toHaveText(['My work', 'My procurements']);
    await expect(page.getByTestId('scope-text')).toContainText('requests you raised');
  });

  test('the last visit is remembered in this browser, and the page works without it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'exec');
    await page.goto('/app/dashboard');
    await expect(page.getByTestId('since-panel')).toContainText(/Nothing new|update/);
    await page.goto('/app/requests'); // leaving the page saves the visit
    const saved = await page.evaluate(() => localStorage.getItem('if.home.lastVisit'));
    expect(Date.parse(saved ?? '')).not.toBeNaN();
    // blocked storage: the page still renders
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.goto('/app/dashboard');
    await expect(page.getByTestId('since-panel')).toBeVisible();
  });
});

test.describe('axe in both colour modes', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: the home page and an open tab menu have no WCAG 2.1 A/AA violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript((t) => localStorage.setItem('if-theme', t), theme);
      await signIn(page, 'exec');
      await page.goto('/app/dashboard');
      await expect(page.getByTestId('work-queue')).toBeVisible();
      await expect(page.getByTestId('queue-list').or(page.getByTestId('queue-empty'))).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      let r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(
        r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([]);
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Requests' }).click();
      r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(
        r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([]);
    });
  }
});
