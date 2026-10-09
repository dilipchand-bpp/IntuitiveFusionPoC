import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { signIn } from './helpers';

/** CP-07 contract OCR and extraction in the browser: upload, review, commit, see the contract and its reminders, then the report. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const scan = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/contract-ocr/${name}`, import.meta.url));

test.describe('CP-07 contract ingestion', () => {
  test('CP-07 upload a licence PDF, review the derived value, commit, then see the contract and its reminders', async ({
    page,
  }) => {
    await signIn(page, 'contract-mgr');
    await page.goto('/app/contracts');
    await page.getByRole('link', { name: 'Contract ingestion (read from documents)' }).click();
    await expect(page.getByRole('heading', { name: 'Contract ingestion' })).toBeVisible();
    await expect(page).toHaveTitle(/Contract ingestion/);
    await scan(page);

    await page.getByTestId('ocr-file').setInputFiles(fixture('office-licence.pdf'));
    await page.getByTestId('ocr-upload').click();
    await expect(page.getByTestId('ocr-doc')).toContainText('Licence to Occupy Office Premises');
    await expect(page.getByTestId('ocr-doc')).toContainText('Needs review');
    await page.getByRole('link', { name: 'Open document' }).first().click();

    // the page text has the fields marked, and the derived value is flagged
    await expect(page.getByTestId('ocr-page-text')).toContainText('The licence fee is $102,000 per annum');
    await expect(page.locator('[data-mark="f:endDate"]')).toHaveText('31 January 2031');
    const value = page.getByTestId('ocr-field-value');
    await expect(value).toContainText('AUD 510,000');
    await expect(value).toHaveAttribute('data-needs-review', 'true');
    await expect(page).toHaveTitle(/Ingested contract/);
    await scan(page);

    // commit is refused until the flagged value is reviewed
    await page.getByTestId('ocr-commit').click();
    await expect(page.locator('p[role="alert"]')).toContainText('Review the');
    await page.getByTestId('ocr-edit-value').fill('AUD 520,000');
    await page.getByTestId('ocr-accept').click();
    await expect(page.getByTestId('ocr-field-value')).toContainText('AUD 520,000');
    await expect(page.getByTestId('ocr-field-value')).toContainText('Corrected');
    await expect(page.getByText('Corrections made')).toBeVisible();

    await page.getByTestId('ocr-commit').click();
    await expect(page.getByTestId('ocr-commit-result')).toContainText(
      'Created LIC-2025-0077 for Harbourside Property Holdings Pty Ltd',
    );
    await expect(page.getByTestId('ocr-committed')).toBeVisible();

    // the contract record exists with its reminders and the clauses read from the document
    await page.getByTestId('ocr-contract-link').click();
    await expect(page.getByText('LIC-2025-0077').first()).toBeVisible();
    await expect(page.getByText(/Licence to Occupy Office Premises/).first()).toBeVisible();
  });

  test('CP-07 a SIMULATED scanned image needs a typed end date before it can be committed', async ({
    page,
  }) => {
    await signIn(page, 'legal');
    await page.goto('/app/contracts/ingest');
    await page.getByTestId('ocr-file').setInputFiles(fixture('scanned-security-services.png'));
    await page.getByTestId('ocr-upload').click();
    await expect(page.getByTestId('ocr-doc')).toContainText('SIMULATED recognition');
    await page.getByRole('link', { name: 'Open document' }).first().click();
    await expect(page.getByTestId('ocr-field-endDate')).toContainText('Missing');
    await page.getByTestId('ocr-accept').click();
    await expect(page.locator('p[role="alert"]')).toContainText('cannot be accepted');
    await page.getByTestId('ocr-edit-endDate').fill('28 February 2027');
    await page.getByTestId('ocr-accept').click();
    await expect(page.getByTestId('ocr-field-endDate')).toContainText('2027-02-28');
    await page.getByTestId('ocr-commit').click();
    await expect(page.getByTestId('ocr-commit-result')).toContainText('Created SEC-2026-0019');
  });

  test('CP-07 the report across ingested contracts, and an executive can read but not upload', async ({
    page,
  }) => {
    await signIn(page, 'legal');
    await page.goto('/app/contracts/ingest');
    await page.getByTestId('ocr-sample-services-agreement').click();
    await expect(page.getByTestId('ocr-doc').first()).toContainText(
      'Facilities Management Services Agreement',
    );
    await signIn(page, 'exec');
    await page.goto('/app/contracts/ingest/report');
    await expect(page.getByTestId('ocr-report')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Renewals due/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Concentration by supplier' })).toBeVisible();
    await expect(page).toHaveTitle(/Ingested contracts report/);
    await scan(page);
    await page.goto('/app/contracts/ingest');
    await expect(page.getByTestId('ocr-upload')).toHaveCount(0);
    await signIn(page, 'requester');
    await page.goto('/app/contracts/ingest');
    await expect(page.getByText(/not allowed|forbidden|403/i).first()).toBeVisible();
  });
});
