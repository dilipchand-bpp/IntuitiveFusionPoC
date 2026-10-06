// Runs the built app the way it is shared: production mode, the API and the web server together, one port to expose.
//   npm run build        (once, and again after any change)
//   npm run demo:start
// Then point a tunnel at the web port (see docs/Share-the-Demo.md). Only the web port needs to be reachable: it passes
// /api/v1 on to the API, so the browser never talks to the API directly.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const apiPort = Number(process.env.API_PORT ?? 4000);
const webPort = Number(process.env.WEB_PORT ?? 3000);
const env = { ...process.env, NODE_ENV: 'production', API_URL: `http://localhost:${apiPort}` };

const missing = ['apps/api/dist/main.js', 'apps/web/.next/BUILD_ID'].filter(
  (f) => !existsSync(`${root}${f}`),
);
if (missing.length) {
  console.error(`Not built yet (missing ${missing.join(', ')}). Run:  npm run build`);
  process.exit(1);
}
if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
  console.error(
    'SESSION_SECRET is missing or too short. Run npm run db:seed once (it creates .env), or set it.',
  );
  process.exit(1);
}

const inUse = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(port, '127.0.0.1');
  });
for (const [name, port] of [
  ['API', apiPort],
  ['web', webPort],
]) {
  if (await inUse(port)) {
    console.error(
      `The ${name} port ${port} is already in use. Stop the development servers (npm run dev) first: the database allows one running API at a time.`,
    );
    process.exit(1);
  }
}

const run = (label, cmd, args, cwd) => {
  const p = spawn(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => {
    console.error(`${label} stopped (code ${code}). Stopping the other one.`);
    for (const c of children) if (c !== p) c.kill();
    process.exit(code ?? 1);
  });
  return p;
};
const children = [];
children.push(run('api', 'node', ['dist/main.js'], `${root}apps/api`));
children.push(run('web', 'npx', ['next', 'start', '-p', String(webPort)], `${root}apps/web`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => children.forEach((c) => c.kill()));
process.stdout.write(
  `\nIntuitive Fusion is starting in production mode.\n  Local address: http://localhost:${webPort}\n  Share this port through a tunnel; do not expose ${apiPort}.\n`,
);
