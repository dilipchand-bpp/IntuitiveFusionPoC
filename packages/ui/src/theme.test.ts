import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, contrastRatio, dark, light, themeToCss } from './theme';

describe('theme contrast contract (WCAG 2.1 AA)', () => {
  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [fg, bg, min, why] of CONTRAST_PAIRS) {
      it(`${name}: ${fg} on ${bg} >= ${min}:1 (${why})`, () => {
        const ratio = contrastRatio(tokens[fg], tokens[bg]);
        expect(ratio, `${tokens[fg]} on ${tokens[bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('matches known reference values from the spec', () => {
    expect(contrastRatio('#FFFFFF', '#2A303C')).toBeCloseTo(13.24, 1);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('both themes define exactly the same tokens', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('generated theme.css is in sync with theme.ts (run `npm run theme:build -w @if/ui`)', () => {
    const onDisk = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
    expect(onDisk).toBe(themeToCss());
  });
});

describe('rebrand = one-file change', () => {
  it('a different accent in theme.ts flows to the emitted CSS without touching anything else', () => {
    const css = themeToCss();
    expect(css).toContain(`--if-color-accent: ${light.accent};`);
    expect(css).toContain(`--color-accent: var(--if-color-accent);`);
    // no component or page may hard-code a hex colour: enforced by the next test
  });
});
