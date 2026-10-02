import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'E2e-Only-Passw0rd!2026';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function signIn(page: Page, user: string) {
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(`${user}@meridian-demo.example`);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('shell')).toBeVisible();
}
const preview = (page: Page) => page.getByTestId('device-preview');
const frame = (page: Page) => page.frameLocator('[data-testid="preview-frame"]');

test.describe('device preview: check the app as a phone or tablet from a desktop browser', () => {
  test('phone frame shows the real mobile layout; tablet and rotate change the frame size', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/preview?device=phone&path=/login');
    await expect(preview(page)).toHaveAttribute('data-device', 'phone');
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-width', '355'); // 375 less the bezel
    // inside the frame this is a real 355px-wide page: the sign-in form shows, the wide brand panel does not
    await expect(frame(page).getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(frame(page).getByRole('heading', { name: /From request to signed contract/ })).toBeHidden();

    await page.getByRole('button', { name: /Tablet/ }).click();
    await expect(preview(page)).toHaveAttribute('data-device', 'tablet');
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-width', '748');
    await expect(frame(page).getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('button', { name: 'Rotate' }).click();
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-width', '1004'); // 1024 landscape less bezel
    await expect(frame(page).getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('button', { name: /Desktop/ }).click();
    await expect(preview(page)).toHaveAttribute('data-device', 'desktop');
    await expect(page.getByTitle('App preview, desktop')).toBeVisible();
  });

  test('a signed-in page keeps its place when the device changes, and shows the phone menu inside the frame', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await signIn(page, 'exec');
    await page.goto('/preview?device=phone&path=/app/dashboard');
    await expect(frame(page).getByRole('button', { name: 'Open menu' })).toBeVisible(); // phone header, not the desktop sidebar
    await expect(frame(page).getByRole('navigation', { name: 'Main' })).toBeHidden();
    await frame(page).getByRole('button', { name: 'Open menu' }).click();
    await frame(page).getByRole('link', { name: 'Requests' }).click();
    await expect(frame(page).getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: /Tablet/ }).click();
    await expect(frame(page).getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible(); // same page, new size
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: /Open in a new tab/ }).click();
    expect((await popup).url()).toContain('/app/requests'); // the page shown in the frame, not where the preview started
  });

  test('the header has a preview button on a desktop screen, opening the current page; not inside the frame, not on a phone', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await signIn(page, 'procurement');
    await page.goto('/app/tenders');
    const link = page.getByRole('link', { name: 'Preview on phone or tablet' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(preview(page)).toHaveAttribute('data-device', 'tablet');
    await expect(frame(page).getByRole('heading', { name: 'Tenders', level: 1 })).toBeVisible();
    await expect(frame(page).getByRole('link', { name: 'Preview on phone or tablet' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close the preview' }).click();
    await expect(page).toHaveURL(/\/app\/tenders$/);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app/tenders');
    await expect(page.getByRole('link', { name: 'Preview on phone or tablet' })).toBeHidden();
  });

  test('the landing page and the login page offer it too', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    for (const path of ['/', '/login']) {
      await page.goto(path);
      await expect(page.getByRole('link', { name: 'Preview on phone or tablet' }), path).toBeVisible();
    }
  });

  test('only same-site pages can be framed: external, protocol-relative and self-referencing paths fall back to home', async ({
    page,
  }) => {
    for (const bad of ['https://evil.example', '//evil.example', '/preview?path=/x', 'javascript:alert(1)']) {
      await page.goto(`/preview?device=phone&path=${encodeURIComponent(bad)}`);
      expect(await page.locator('iframe').getAttribute('src'), bad).toBe('/');
    }
  });

  test('the preview controls are accessible and fit a small screen', async ({ page }) => {
    for (const vp of [
      { width: 375, height: 812 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('/preview?device=tablet&path=/login');
      await expect(preview(page)).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      const r = await new AxeBuilder({ page }).withTags(WCAG).disableRules(['frame-tested']).analyze();
      expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('|')}`)).toEqual(
        [],
      );
    }
  });
});
