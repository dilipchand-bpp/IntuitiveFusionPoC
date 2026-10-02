// Creates a local .env on first run so `npm run dev` works out of the box.
// The secret is random per machine and the file is git-ignored. Never reuse it outside local development.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const examplePath = fileURLToPath(new URL('../.env.example', import.meta.url));

if (!existsSync(envPath)) {
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
  const secret = randomBytes(32).toString('hex');
  const body = example.includes('SESSION_SECRET=')
    ? example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`)
    : `${example}\nSESSION_SECRET=${secret}\n`;
  writeFileSync(envPath, body, { mode: 0o600 });
  console.warn('Created .env with a new random SESSION_SECRET (local development only).');
}
