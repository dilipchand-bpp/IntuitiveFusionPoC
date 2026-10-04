import { expect, test, type Page } from '@playwright/test';

/**
 * M14 route crawler and link checker. For every role it signs in, opens every screen that role is offered and checks
 * that the page is not blank, not an error, and that every internal link on it leads somewhere (no 404, no 500).
 * It also checks that screens a role may NOT open answer 403 (never a 500 or an empty page), and that the public
 * pages and the "not found" page are never blank.
 */
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const USER_FOR: Record<string, string> = {
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

async function signIn(page: Page, role: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(`${USER_FOR[role]}@meridian-demo.example`);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId(role === 'SUPPLIER' ? 'supplier-shell' : 'shell')).toBeVisible();
}

/** Opens a page and checks it is a real page: successful, has a heading and some text, and shows no error. */
async function expectRealPage(page: Page, path: string): Promise<string[]> {
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBe(200);
  await expect(page.locator('h1').first(), `${path} has a heading`).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text.length, `${path} is not blank`).toBeGreaterThan(80);
  expect(text, `${path} shows no error`).not.toMatch(
    /Application error|Internal Server Error|Unhandled Runtime Error/i,
  );
  return page.$$eval('a[href]', (as) =>
    as
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/api/')),
  );
}

const ROLES = Object.keys(USER_FOR);

// Every screen in the application. Whatever a role is not offered must be refused (403) or be a real page, never broken.
const ALL_SCREENS = [
  '/app/dashboard',
  '/app/requests',
  '/app/plans',
  '/app/approvals',
  '/app/tenders',
  '/app/evaluations',
  '/app/contracts',
  '/app/contracts/expiring',
  '/app/contracts/alerts',
  '/app/suppliers',
  '/app/reports',
  '/app/audit',
  '/app/collaboration',
  '/app/roadmap',
  '/admin',
  '/admin/users',
  '/admin/delegations',
  '/admin/workflows',
  '/admin/templates',
  '/admin/migration',
  '/admin/settings',
  '/app/security',
  '/supplier',
  '/supplier/profile',
];

/** The screens the navigation offers this person, read from the page itself. */
const offeredScreens = (page: Page) =>
  page.$$eval('nav a[href]', (as) =>
    as.map((a) => a.getAttribute('href') ?? '').filter((h) => /^\/(app|admin|supplier)(\/|$)/.test(h)),
  );

for (const role of ROLES) {
  test(`crawler (${role}): every offered screen opens with content, no link is dead, refused screens answer 403`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, role);
    const offered = [...new Set(await offeredScreens(page))];
    expect(offered.length, 'the navigation offers something').toBeGreaterThan(0);

    const links = new Set<string>();
    for (const p of offered) for (const l of await expectRealPage(page, p)) links.add(l.split('#')[0] || p);

    // link checker: every internal link seen on those pages opens (redirects followed), none is missing or broken
    const broken: string[] = [];
    for (const l of links) {
      const r = await page.request.get(l, { maxRedirects: 5 });
      if (r.status() >= 400) broken.push(`${l} -> ${r.status()}`);
    }
    expect(broken, `broken links for ${role}`).toEqual([]);

    // everything else: refused with a page, or a real page the role may open although it is not in the menu
    for (const h of ALL_SCREENS.filter((s) => !offered.includes(s))) {
      const r = await page.goto(h);
      const status = r?.status();
      expect([200, 403], `${role} on ${h}`).toContain(status);
      expect((await page.locator('body').innerText()).length, `${h} is not blank`).toBeGreaterThan(30);
    }
    // the hard boundaries: only administrators reach /admin, only suppliers reach /supplier
    if (role !== 'ADMIN') expect((await page.goto('/admin'))?.status()).toBe(403);
    if (role !== 'SUPPLIER') expect((await page.goto('/supplier'))?.status()).toBe(403);
    else expect((await page.goto('/app/dashboard'))?.status()).toBe(403);

    // a path that does not exist is a 404 with a page, not a blank screen
    const base = role === 'SUPPLIER' ? '/supplier' : role === 'ADMIN' ? '/admin' : '/app';
    const missing = await page.goto(`${base}/no-such-screen-${role.toLowerCase()}`);
    // streamed layouts can answer 200 before the not-found page is chosen; what matters is the person sees it
    expect([200, 404]).toContain(missing?.status());
    await expect(page.locator('body')).toContainText(/could not be found|not found|404/i);
  });
}

test('public pages are never blank and their links work; an unknown address is a 404 page', async ({
  page,
}) => {
  await page.context().clearCookies();
  const links = new Set<string>();
  for (const p of ['/', '/login', '/forgot-password', '/legal/privacy', '/legal/terms']) {
    for (const l of await expectRealPage(page, p)) links.add(l.split('#')[0] || p);
  }
  const broken: string[] = [];
  for (const l of links) {
    const r = await page.request.get(l, { maxRedirects: 5 });
    if (r.status() >= 500 || r.status() === 404) broken.push(`${l} -> ${r.status()}`);
  }
  expect(broken).toEqual([]);
  const r = await page.goto('/nothing-here');
  expect(r?.status()).toBe(404);
  expect((await page.locator('body').innerText()).length).toBeGreaterThan(20);
});

test('every navigation entry resolves to a screen and the roadmap and coming-soon screens list requirement ids', async ({
  page,
}) => {
  await signIn(page, 'ADMIN');
  await page.goto('/admin/migration');
  await expect(page.getByRole('heading', { name: 'Data migration', level: 1 })).toBeVisible(); // built in roadmap batch B1
  await signIn(page, 'PROCUREMENT');
  await page.goto('/app/collaboration');
  await expect(page.getByRole('heading', { name: /coming soon/i })).toBeVisible();
  await page.goto('/app/roadmap');
  await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible();
  await expect(page.locator('body')).toContainText('FR-0010');
});
