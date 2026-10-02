import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const good = { SESSION_SECRET: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('applies defaults when only the secret is supplied', () => {
    const c = loadConfig(good);
    expect(c.API_PORT).toBe(4000);
    expect(c.AI_PROVIDER).toBe('mock');
  });
  it('fails fast when SESSION_SECRET is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });
  it('rejects a short secret and does not echo its value', () => {
    try {
      loadConfig({ SESSION_SECRET: 'short-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('SESSION_SECRET');
      expect((e as Error).message).not.toContain('short-secret-value');
    }
  });
  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...good, API_PORT: '99999' })).toThrow(/API_PORT/);
  });
  it('rejects an unknown provider', () => {
    expect(() => loadConfig({ ...good, AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
  });
});
