import re
root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\e2e'
src = open(f'{root}\\evaluation.spec.ts', encoding='utf8').read()


def between(a, b):
    i = src.index(a)
    j = src.index(b, i)
    return src[i:j]


head = """import { expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

/** Shared set-up for browser tests that need a tender with bids, an evaluation, and signed-in people (copied from evaluation.spec.ts). */
export const PASSWORD = 'E2e-Only-Passw0rd!2026';
export const SUPPLIER_PASSWORD = 'Supplier-E2e-Passw0rd-1';
export const email = (u: string) => `${u}@meridian-demo.example`;
export const rand = () => Math.random().toString(36).slice(2, 8);
export const PDF = Buffer.from('%PDF-1.7\\nTECHNICAL-CONTENT-MARKER');
export const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('COMMERCIAL-PRICING-MARKER')]);

export async function signIn(page: Page, user: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel(/Email/).fill(user.includes('@') ? user : email(user));
  await page.getByLabel(/Password/).fill(user.includes('@') ? SUPPLIER_PASSWORD : PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId(user.includes('@') ? 'supplier-shell' : 'shell')).toBeVisible();
}

"""
abn = between("/** A checksum-valid ABN", "async function login(")
abn = abn.replace("let abnSeq", "let abnSeq").replace("function newAbn", "export function newAbn")
login = between("async function login(", "/**\n * Builds, through the API")
login = login.replace("async function login", "export async function login")
closed = between("/**\n * Builds, through the API", "const workspace = ")
closed = closed.replace("async function closedTender", "export async function closedTender")
# evaluation api helpers
ev = between("async function apiAs(", "async function download(")
ev = re.sub(r"^async function ", "export async function ", ev, flags=re.M)
out = head + abn + login + closed + ev
out = out.replace("import { API_URL } from '../playwright.config';\n", "import { API_URL } from '../playwright.config';\n", 1)
open(f'{root}\\helpers.ts', 'w', encoding='utf8').write(out)
print(len(out.split('\n')), 'lines')
