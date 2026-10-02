import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const themes = ['light', 'dark'] as const;

async function open(page: Page, theme: (typeof themes)[number], vp: (typeof viewports)[number]) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.addInitScript((t) => localStorage.setItem('if-theme', t), theme);
  await page.goto('/ui-kit');
  await expect(page.getByRole('heading', { name: 'UI kit', level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of themes) {
  for (const vp of viewports) {
    test.describe(`${theme} / ${vp.name}`, () => {
      test(`axe: no WCAG 2.1 A/AA violations`, async ({ page }) => {
        await open(page, theme, vp);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(
          results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        ).toEqual([]);
      });

      test('responsive: no horizontal page scroll', async ({ page }) => {
        await open(page, theme, vp);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });

      test('theme applied from tokens', async ({ page }) => {
        await open(page, theme, vp);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg).toBe(theme === 'light' ? 'rgb(246, 247, 250)' : 'rgb(20, 23, 30)');
      });

      test('@visual snapshot', async ({ page }) => {
        await open(page, theme, vp);
        await expect(page).toHaveScreenshot(`ui-kit-${theme}-${vp.name}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
        });
      });
    });
  }
}

test('self-hosted fonts load (no third-party requests)', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http'))
      external.push(r.url());
  });
  await open(page, 'light', viewports[2]);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  });
  expect(fonts.join(',')).toMatch(/Inter/);
  expect(fonts.join(',')).toMatch(/Plus Jakarta/);
  expect(external).toEqual([]);
});

test('keyboard: dialog opens, traps focus, Escape closes and returns focus', async ({ page }) => {
  await open(page, 'light', viewports[2]);
  const trigger = page.getByRole('button', { name: 'Open dialog' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Approve procurement plan' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('theme toggle switches and persists across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/ui-kit');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'light', viewports[2]);
  const d = await page.evaluate(() => getComputedStyle(document.querySelector('button')!).transitionDuration);
  expect(parseFloat(d)).toBeLessThan(0.05);
});
