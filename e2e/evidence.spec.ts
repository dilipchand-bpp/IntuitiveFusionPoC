import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * M15 evidence capture (opt in: EVIDENCE=1). Opens the main screens of every kind of user at three screen sizes in
 * light and dark, saves a screenshot of each and records the axe (WCAG 2.1 A and AA) result for each. It never fails
 * on a finding: the findings are the evidence, and the summary file is written for the report.
 */
const PASSWORD = 'E2e-Only-Passw0rd!2026';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const DIR = process.env.EVIDENCE_DIR ?? 'docs/evidence/m15';
const SIZES = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

const SCREENS: Array<{ who: string | null; path: string; name: string }> = [
  { who: null, path: '/', name: 'landing' },
  { who: null, path: '/login', name: 'login' },
  { who: 'requester', path: '/app/requests', name: 'requests' },
  { who: 'requester', path: '/app/requests/new', name: 'new-request' },
  { who: 'procurement', path: '/app/plans', name: 'plans' },
  { who: 'procurement', path: '/app/tenders', name: 'tenders' },
  { who: 'delegate', path: '/app/approvals', name: 'approvals' },
  { who: 'chair', path: '/app/evaluations', name: 'evaluations' },
  { who: 'legal', path: '/app/contracts', name: 'contracts' },
  { who: 'exec', path: '/app/dashboard', name: 'dashboard' },
  { who: 'exec', path: '/app/reports', name: 'reports' },
  { who: 'probity', path: '/app/audit', name: 'audit' },
  { who: 'admin', path: '/admin', name: 'admin' },
  { who: 'admin', path: '/admin/users', name: 'admin-users' },
  { who: 'supplier', path: '/supplier', name: 'supplier-portal' },
];

async function signIn(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(`${user}@meridian-demo.example`);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId(user === 'supplier' ? 'supplier-shell' : 'shell')).toBeVisible();
}

interface Result {
  screen: string;
  scheme: string;
  size: string;
  violations: Array<{ id: string; impact: string | null | undefined; nodes: number }>;
  horizontalScroll: boolean;
}
const results: Result[] = [];

test.describe('evidence capture', () => {
  test.skip(!process.env.EVIDENCE, 'opt-in: set EVIDENCE=1');

  for (const who of [...new Set(SCREENS.map((s) => s.who))]) {
    test(`screens for ${who ?? 'a visitor'}`, async ({ page }) => {
      test.setTimeout(300_000);
      if (who) await signIn(page, who);
      else await page.context().clearCookies();
      mkdirSync(`${DIR}/screens`, { recursive: true });
      for (const scheme of SCHEMES) {
        await page.goto('/login');
        await page.evaluate((s) => localStorage.setItem('if-theme', s), scheme);
        for (const size of SIZES) {
          await page.setViewportSize({ width: size.width, height: size.height });
          for (const s of SCREENS.filter((x) => x.who === who)) {
            const res = await page.goto(s.path);
            expect(res?.status(), `${s.path}`).toBe(200);
            await expect(page.locator('h1, h2').first()).toBeAttached();
            await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
            await page.screenshot({
              path: `${DIR}/screens/${s.name}-${size.name}-${scheme}.jpg`,
              type: 'jpeg',
              quality: 70,
            });
            const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
            results.push({
              screen: s.name,
              scheme,
              size: size.name,
              violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
              horizontalScroll: await page.evaluate(
                () => document.documentElement.scrollWidth > window.innerWidth,
              ),
            });
          }
        }
      }
      // each worker writes its own file; the report script merges them
      writeFileSync(`${DIR}/axe-${who ?? 'visitor'}.json`, JSON.stringify(results.splice(0), null, 2) + '\n');
    });
  }
});
