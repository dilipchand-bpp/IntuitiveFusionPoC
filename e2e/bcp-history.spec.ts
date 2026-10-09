import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/** CP-07 historical import in the browser: upload a sample, check the mapping, dry run, load, roll back. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

test.describe('CP-07 historical import wizard', () => {
  test('CP-07 upload the supplier sample, review the suggested mapping, dry run, load and roll back', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await page.goto('/admin/migration');
    await page.getByRole('link', { name: 'open the Import wizard' }).click();
    await expect(page.getByRole('heading', { name: 'Import wizard' })).toBeVisible();
    await expect(page.getByTestId('hist-sample')).toHaveCount(4);
    await scan(page);

    // 1. a sample file is uploaded
    await page.getByTestId('hist-use-supplier-extract').click();
    await expect(page.getByTestId('hist-mapping')).toBeVisible();

    // 2. the mapping is suggested, and can be edited
    const company = page.locator('[data-testid="hist-map-row"][data-field="company"]');
    await expect(company.getByRole('combobox')).toHaveValue('Name 1');
    await expect(
      page.locator('[data-testid="hist-map-row"][data-field="abn"]').getByRole('combobox'),
    ).toHaveValue('ABN');
    await page
      .locator('[data-testid="hist-map-row"][data-field="email"]')
      .getByRole('combobox')
      .selectOption('');
    await scan(page);

    // 3. the dry run loads nothing and lists the problem rows
    await page.getByTestId('hist-run-dry').click();
    await expect(page.getByTestId('hist-results')).toBeVisible();
    await expect(page.getByText('Nothing has been loaded')).toBeVisible();
    await expect(page.getByTestId('hist-row').first()).toBeVisible();
    await expect(page.locator('[data-testid="hist-row"][data-status="ERROR"]').first()).toContainText(
      'ABN_CHECKSUM',
    );
    await expect(page.getByTestId('hist-error-report')).toHaveAttribute('href', /errors\.csv$/);
    await scan(page);

    // 4. load
    await page.getByTestId('hist-to-load').click();
    await expect(page.getByTestId('hist-commit')).toBeDisabled();
    await page.getByTestId('hist-confirm').check();
    await page.getByTestId('hist-commit').click();
    await expect(page.getByTestId('hist-committed')).toContainText('reconciled');

    // 5. history, then roll back
    await page.getByRole('button', { name: 'Go to history' }).click();
    const row = page.locator('[data-testid="hist-batch"][data-status="COMMITTED"]').first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^Open / }).click();
    await expect(page.getByTestId('hist-selected')).toHaveAttribute('data-status', 'COMMITTED');
    await page.getByTestId('hist-rollback').click();
    await page.getByTestId('hist-rollback-reason').fill('Loaded the sample by mistake');
    await page.getByTestId('hist-rollback-confirm').click();
    await expect(page.getByTestId('hist-selected')).toHaveAttribute('data-status', 'ROLLED_BACK');
    await expect(page.getByTestId('hist-summary')).toContainText('Rolled back');
    await scan(page);
  });

  test('CP-07 a requester cannot reach the wizard, and the existing CSV migration page still works', async ({
    page,
  }) => {
    await signIn(page, 'requester');
    await page.goto('/admin/migration/import');
    await expect(page.getByRole('heading', { name: 'Import wizard' })).toHaveCount(0);
    await signIn(page, 'admin');
    await page.goto('/admin/migration');
    await expect(page.getByRole('heading', { name: 'Data migration' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upload an extract' })).toBeVisible();
  });
});
