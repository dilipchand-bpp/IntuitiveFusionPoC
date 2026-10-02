import { expect, test, type Page } from '@playwright/test';

// Must match SEED_PASSWORD given to the API in playwright.config.ts (synthetic demo users only).
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const email = (key: string) => `${key}@meridian-demo.example`;

async function signIn(page: Page, key: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(email(key));
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in and waits until the app has left the login page (so later navigation is really signed in). */
async function signInAndWait(page: Page, key: string) {
  await signIn(page, key);
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('route guards (US-PLT-02, US-PLT-03)', () => {
  test('anonymous visitor to a protected page is sent to login and returned afterwards', async ({ page }) => {
    await page.goto('/app/requests');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Frequests/);
    await page.getByLabel(/Email/).fill(email('requester'));
    await page.getByLabel(/Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app\/requests$/);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-role', 'REQUESTER');
  });

  const homes: Array<[string, string, string]> = [
    ['requester', '/app/requests', 'REQUESTER'],
    ['delegate', '/app/approvals', 'DELEGATE'],
    ['evaluator-tech', '/app/evaluations', 'EVALUATOR'],
    ['probity', '/app/audit', 'PROBITY'],
    ['admin', '/admin', 'ADMIN'],
    ['supplier', '/supplier', 'SUPPLIER'],
  ];
  for (const [key, home, role] of homes) {
    test(`${role} lands on ${home} after login`, async ({ page }) => {
      await signIn(page, key);
      await expect(page).toHaveURL(new RegExp(home.replace('/', '\\/') + '$'));
      await expect(page.getByTestId('shell')).toHaveAttribute('data-role', role);
    });
  }

  test('a requester who opens /admin sees Access denied (403)', async ({ page }) => {
    await signIn(page, 'requester');
    await expect(page).toHaveURL(/\/app\/requests$/);
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();

    // The denial is written to the audit trail by POST /auth/access-denied (asserted in the API integration tests).
  });

  test('a supplier cannot open staff pages and a staff user cannot open the supplier area', async ({
    page,
  }) => {
    await signInAndWait(page, 'supplier');
    expect((await page.goto('/app/requests'))?.status()).toBe(403);
    await page.context().clearCookies();
    await signInAndWait(page, 'requester');
    expect((await page.goto('/supplier'))?.status()).toBe(403);
  });

  test('logout ends the session; protected pages then redirect to login', async ({ page }) => {
    await signIn(page, 'finance');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-role', 'FINANCE');
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test('the session cookie is HttpOnly and not readable by page scripts', async ({ page, context }) => {
    await signIn(page, 'exec');
    await expect(page.getByTestId('shell')).toBeVisible();
    const cookies = await context.cookies();
    const s = cookies.find((c) => c.name === 'if_session')!;
    expect(s.httpOnly).toBe(true);
    expect(s.sameSite).toBe('Lax');
    expect(await page.evaluate(() => document.cookie)).not.toContain('if_session');
  });
});

test.describe('login form', () => {
  test('client-side validation shows field errors without calling the server', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
  });

  test('wrong password shows one generic error that does not reveal whether the account exists', async ({
    page,
  }) => {
    await signIn(page, 'legal', 'wrong-password-123');
    const a = await page.locator('form [role=alert]').first().innerText();
    await page.reload();
    await signIn(page, 'does-not-exist', 'wrong-password-123');
    const b = await page.locator('form [role=alert]').first().innerText();
    expect(a).toBe(b);
    expect(a).toMatch(/Invalid email or password/);
  });

  test('open redirect is refused: a ?next= pointing off-site is ignored', async ({ page }) => {
    await page.goto('/login?next=//evil.example/steal');
    await page.getByLabel(/Email/).fill(email('delegate'));
    await page.getByLabel(/Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app\/approvals$/);
  });

  test('login page is accessible (axe: no WCAG 2.1 A/AA violations)', async ({ page }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    await page.goto('/login');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
