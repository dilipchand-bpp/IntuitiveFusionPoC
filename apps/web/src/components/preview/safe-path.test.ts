import { describe, expect, it } from 'vitest';
import { safePath } from './safe-path';

describe('safePath (what the device preview is allowed to frame)', () => {
  it('keeps ordinary same-site paths, with their query', () => {
    expect(safePath('/app/dashboard')).toBe('/app/dashboard');
    expect(safePath('/supplier/tenders/abc?x=1')).toBe('/supplier/tenders/abc?x=1');
  });
  it('falls back to the home page for anything that could leave the site or loop', () => {
    for (const bad of [
      undefined,
      '',
      'https://evil.example',
      '//evil.example/x',
      'javascript:alert(1)',
      '/\\evil.example',
      '/preview',
      '/preview?path=/preview',
      '/a\nb',
      'app/dashboard',
    ])
      expect(safePath(bad), String(bad)).toBe('/');
  });
});
