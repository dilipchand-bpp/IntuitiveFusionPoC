import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { themeToCss } from '../src/theme';

const out = fileURLToPath(new URL('../src/theme.css', import.meta.url));
writeFileSync(out, themeToCss(), 'utf8');
console.warn(`wrote ${out}`);
