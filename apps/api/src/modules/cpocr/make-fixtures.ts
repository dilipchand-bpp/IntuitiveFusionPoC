/* eslint-disable no-console */
/**
 * Writes the small synthetic contract files the Playwright spec uploads (e2e/fixtures/contract-ocr). Run from apps/api:
 *   npx tsx src/modules/cpocr/make-fixtures.ts
 * Everything is invented (see samples.ts); the scanned PNG carries a SIMULATED recognition fixture.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSample } from './samples.js';

const dir = fileURLToPath(new URL('../../../../../e2e/fixtures/contract-ocr/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const key of ['office-licence', 'scanned-security', 'services-agreement']) {
  const s = buildSample(key)!;
  writeFileSync(`${dir}${s.fileName}`, s.bytes);
  console.log(`${s.fileName} ${s.bytes.length} bytes`);
}
