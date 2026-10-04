import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROLE_HOME, ROLE_NAMES, type RoleName } from '@if/shared';
import { NAV, navFor } from '../apps/web/src/lib/nav';

// Synthetic demo password given to the e2e API server in playwright.config.ts.
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const USER_FOR: Record<RoleName, string> = {
  REQUESTER: 'requester',
  PROCUREMENT: 'procurement',
  DELEGATE: 'delegate',
  EVALUATOR: 'evaluator-tech',
  CHAIR: 'chair',
  LEGAL: 'legal',
  CONTRACT_MGR: 'contract-mgr',
  PROBITY: 'probity',
  FINANCE: 'finance',
  ADMIN: 'admin',
  EXEC: 'exec',
  SUPPLIER: 'supplier',
};
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function signIn(page: Page, role: RoleName) {
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(`${USER_FOR[role]}@meridian-demo.example`);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(ROLE_HOME[role].replace('/', '\\/') + '$'));
  await expect(page.getByTestId(role === 'SUPPLIER' ? 'supplier-shell' : 'shell')).toBeVisible();
}
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('US-PLT-01 public landing page', () => {
  test('has hero + CTA, features, 4 steps, illustrations, trust section, FAQ and footer with contact and legal links', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Intuitive Fusion/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('one conversation');
    await expect(page.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/login');
    await expect(page.getByRole('heading', { name: 'Key features and benefits' })).toBeVisible();
    await expect(page.locator('#how-it-works ol > li')).toHaveCount(4);
    await expect(
      page
        .getByRole('img', { name: /Illustration/ })
        .or(page.getByLabel(/Illustration/))
        .first(),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Security, trust and compliance' })).toBeVisible();
    await expect(
      page.getByText(/no independent certification|have not been performed/i).first(),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: /@intuitivefusion\.example/ })).toBeVisible();
    for (const l of ['Privacy policy', 'Terms of use', 'Accessibility statement'])
      await expect(footer.getByRole('link', { name: l })).toBeVisible();
  });

  test('FAQ accordion opens and closes with the keyboard', async ({ page }) => {
    await page.goto('/');
    const q = page.getByRole('button', { name: 'Does the AI make decisions?' });
    await expect(async () => {
      // keyboard events before React hydrates are lost, so retry until the page is interactive
      await q.focus();
      await page.keyboard.press('Enter');
      await expect(q).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText('Every AI-populated field can be edited')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(q).toHaveAttribute('aria-expanded', 'false');
  });

  test('legal links resolve to real pages; unknown legal pages are 404', async ({ page }) => {
    for (const slug of ['privacy', 'terms', 'accessibility']) {
      const res = await page.goto(`/legal/${slug}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    expect((await page.goto('/legal/nope'))?.status()).toBe(404);
  });

  test('logo is used in the header, on the login screen and as the favicon', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('banner').locator('img[src*="logo-"]').first()).toBeVisible();
    expect(await page.locator('link[rel~="icon"]').count()).toBeGreaterThan(0);
    await page.goto('/login');
    await expect(page.locator('img[src*="logo-"]').first()).toBeAttached();
  });
});

test.describe('US-PLT-02 login screen', () => {
  test('forgot-password shows the same neutral confirmation for any address', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await page.getByLabel(/Email/).fill('ghost@meridian-demo.example');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('If an account exists');
  });

  test('show/hide password toggle works and is announced', async ({ page }) => {
    await page.goto('/login');
    const pw = page.getByLabel(/Password/);
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('US-PLT-03/04 signed-in shell', () => {
  for (const role of ROLE_NAMES) {
    test(`${role}: navigation shows exactly the permitted items and every item opens a real page (no blank, no 403, no 404)`, async ({
      page,
    }) => {
      await signIn(page, role);
      const expected = navFor([role]);
      // The supplier portal has no side menu (a supplier sees one tender, not the buying team's modules), so only
      // staff roles have a menu to compare; every supplier page must still open for real.
      const frame = role === 'SUPPLIER' ? 'supplier-shell' : 'shell';
      if (role !== 'SUPPLIER') {
        const nav = page.getByRole('navigation', { name: 'Main' });
        const links = await nav.getByRole('link').allInnerTexts();
        expect(links.map((l) => l.trim()).sort()).toEqual(expected.map((n) => n.label).sort());
      }
      for (const item of expected) {
        const res = await page.goto(item.href);
        expect(res?.status(), item.href).toBe(200);
        await expect(page.getByTestId(frame), item.href).toBeVisible();
        await expect(page.locator('main h1').first(), `${item.href} has a heading`).toBeVisible();
        const text = (await page.locator('main').innerText()).trim();
        expect(text.length, `${item.href} is not blank`).toBeGreaterThan(40);
        expect(await noHorizontalScroll(page), `${item.href} overflows`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('items outside the role are not in the nav and the guard refuses them', async ({ page }) => {
    await signIn(page, 'REQUESTER');
    const hidden = NAV.filter((n) => !n.roles.includes('REQUESTER'));
    expect(hidden.length).toBeGreaterThan(5);
    for (const item of hidden) {
      expect((await page.goto(item.href))?.status(), item.href).toBe(403);
      await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    }
  });

  test('an unknown page under the app is a branded 404 inside the guard, not a blank screen', async ({
    page,
  }) => {
    await signIn(page, 'REQUESTER');
    const res = await page.goto('/app/does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('Ctrl+K opens the jump-to palette; typing filters the pages and Enter opens the match', async ({
    page,
  }) => {
    await signIn(page, 'DELEGATE');
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Search pages' });
    await expect(box).toBeFocused();
    await box.fill('approv');
    await expect(page.getByRole('option')).toHaveCount(1);
    await box.press('Enter');
    await expect(page).toHaveURL(/\/app\/approvals/);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search pages' }).fill('zzz');
    await expect(page.getByText('No pages match.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search pages' })).toHaveCount(0);
  });

  test('notification bell shows the unread count, lists items and marks one read (it stays read after a reload)', async ({
    page,
  }) => {
    await signIn(page, 'LEGAL');
    // Other tests may add notifications for this user, so compare against the starting count rather than assuming it.
    // The bell reads "0 unread" until its first fetch returns, so wait for a real count before taking the start value.
    const bell = page.getByRole('button', { name: /^Notifications, [1-9]\d* unread$/ });
    await expect(bell).toBeVisible();
    const start = Number(/(\d+) unread/.exec((await bell.getAttribute('aria-label')) ?? '')![1]);
    expect(start).toBeGreaterThanOrEqual(1);
    await bell.click();
    await expect(page.getByText('Draft contract ready for review').first()).toBeVisible();
    // other tests (running in parallel) can add notifications for this user at any moment, so do not compare totals:
    // follow the one notification that was marked and check, through the API, that it stays read
    const marked = page.waitForResponse(
      (r) => /\/api\/v1\/notifications\/[^/]+\/read$/.test(r.url()) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Mark read' }).first().click();
    const id = /notifications\/([^/]+)\/read/.exec((await marked).url())![1]!;
    await page.keyboard.press('Escape');
    await page.reload();
    const list: Array<{ id: string; read: boolean }> = await page.evaluate(async () =>
      (await fetch('/api/v1/notifications')).json(),
    );
    expect(list.find((n) => n.id === id)?.read, 'the marked notification stays read after a reload').toBe(
      true,
    );
    await expect(page.getByRole('button', { name: /^Notifications, \d+ unread$/ })).toBeVisible();
  });

  test('profile menu shows who is signed in and signs out', async ({ page }) => {
    await signIn(page, 'EXEC');
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await expect(page.getByText('exec@meridian-demo.example')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('current page is marked in the navigation (aria-current)', async ({ page }) => {
    await signIn(page, 'ADMIN');
    await page.goto('/admin/users');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Users & roles' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Admin overview' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('dashboard shows live KPIs and a procurement table (at least the seeded data, whatever other tests added)', async ({
    page,
  }) => {
    await signIn(page, 'EXEC');
    await page.goto('/app/dashboard');
    const kpis = page.getByRole('region', { name: 'Key figures' });
    for (const label of [
      'Active procurements',
      'Value in flight',
      'Avg. cycle time',
      'Alerts due',
      'Waiting for you',
    ]) {
      await expect(kpis).toContainText(label);
    }
    // The seed alone puts $6,648,000 in flight across 4 active procurements; other tests only add to it.
    const hint = await kpis
      .getByText(/^\$[\d,]{7,}$/)
      .first()
      .innerText();
    expect(Number(hint.replace(/[^\d]/g, ''))).toBeGreaterThanOrEqual(6_648_000);
    const table = page.getByRole('table', { name: 'Procurements' });
    await expect(table.getByRole('columnheader')).toHaveCount(10);
    expect(await table.getByRole('row').count()).toBeGreaterThan(1);
  });

  test('skip link moves focus to the main content', async ({ page }) => {
    await signIn(page, 'FINANCE');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});

test.describe('US-PLT-05 responsive and themes', () => {
  test('phone layout: sidebar becomes a drawer that opens, navigates and closes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page, 'PROCUREMENT');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Tenders' }).click();
    await expect(page).toHaveURL(/\/app\/tenders$/);
    await expect(nav).toBeHidden(); // drawer closed after navigating
  });

  for (const vp of VIEWPORTS) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${vp.name}/${theme}: public and signed-in pages have no horizontal scroll and no axe violations`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.addInitScript((t) => localStorage.setItem('if-theme', t), theme);
        const publicPages = ['/', '/login', '/forgot-password', '/legal/privacy'];
        for (const path of publicPages) {
          await page.goto(path);
          await page.evaluate(() => document.fonts.ready);
          expect(await noHorizontalScroll(page), `${path} overflow`).toBeLessThanOrEqual(0);
          const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
          expect(
            r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`),
          ).toEqual([]);
        }
        await signIn(page, 'EXEC');
        for (const path of ['/app/dashboard', '/app/requests']) {
          await page.goto(path);
          await page.evaluate(() => document.fonts.ready);
          expect(await noHorizontalScroll(page), `${path} overflow`).toBeLessThanOrEqual(0);
          const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
          expect(
            r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`),
          ).toEqual([]);
        }
      });
    }
  }

  test('403 and 404 pages are accessible', async ({ page }) => {
    await signIn(page, 'REQUESTER');
    for (const path of ['/admin', '/app/nope']) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(
        r.violations.map((v) => v.id),
        path,
      ).toEqual([]);
    }
  });
});

test.describe('visual regression @visual', () => {
  for (const vp of VIEWPORTS) {
    for (const theme of ['light', 'dark'] as const) {
      test(`landing ${theme} ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.addInitScript((t) => localStorage.setItem('if-theme', t), theme);
        await page.goto('/');
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`landing-${theme}-${vp.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
        });
      });
      test(`login ${theme} ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.addInitScript((t) => localStorage.setItem('if-theme', t), theme);
        await page.goto('/login');
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`login-${theme}-${vp.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
  test('signed-in shell chrome (header and sidebar), light desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, 'EXEC');
    await page.goto('/app/dashboard');
    await page.evaluate(() => document.fonts.ready);
    // Live figures change as other tests create requests, so only the stable page chrome is compared.
    const shell = page.getByTestId('shell');
    await expect(shell.locator('header').first()).toHaveScreenshot('shell-header-light.png', {
      maxDiffPixelRatio: 0.02,
    });
    await expect(shell.locator('aside')).toHaveScreenshot('shell-sidebar-exec-light.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
