import { loadConfig, ConfigError } from '@if/shared';
import { buildApp } from './app.js';

try {
  const config = loadConfig(process.env);
  const app = await buildApp(config);
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(78); // EX_CONFIG
  }
  throw e;
}
