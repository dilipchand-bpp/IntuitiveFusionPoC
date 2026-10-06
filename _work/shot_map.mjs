// One-off: sign in to a running instance, open the supplier risk map, zoom, and save screenshots.
import { chromium } from '@playwright/test';

const base = process.env.BASE ?? 'http://localhost:3010';
const out = process.env.OUT ?? '.';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(`${base}/login`);
await page.getByLabel(/Email/).fill('procurement@meridian-demo.example');
await page.getByLabel(/Password/).fill('Demo-Only-Passw0rd!2026');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByTestId('shell').waitFor();
await page.goto(`${base}/app/reports/supplier-risk`);
const map = page.getByTestId('supplier-map');
await map.waitFor();
await page.waitForTimeout(4000);
await map.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/map-1-all.png` });
await map.getByRole('button', { name: 'Zoom in' }).click();
await map.getByRole('button', { name: 'Zoom in' }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/map-2-zoomed.png` });
await map.locator('.leaflet-marker-icon').first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/map-3-popup.png` });
console.log('tiles failed notice:', await page.getByTestId('tiles-failed').count());
await browser.close();
