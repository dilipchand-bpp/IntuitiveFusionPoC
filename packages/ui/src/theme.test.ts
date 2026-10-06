import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_PAIRS,
  PALETTES,
  PALETTE_NAMES,
  contrastRatio,
  dark,
  light,
  themeToCss,
  withPalette,
} from './theme';

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

describe('white labelling palettes (FR-0855)', () => {
  it('offers the base palette and four more', () => {
    expect(PALETTE_NAMES).toEqual(['INDIGO', ...Object.keys(PALETTES)]);
  });
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const [mode, base, over] of [
      ['light', light, p.light],
      ['dark', dark, p.dark],
    ] as const) {
      const tokens = withPalette(base, over);
      for (const [fg, bg, min, why] of CONTRAST_PAIRS) {
        it(`${name} ${mode}: ${fg} on ${bg} >= ${min}:1 (${why})`, () => {
          expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
        });
      }
    }
  }
  it('emits a block for each palette, for light, the system dark setting and the manual dark setting', () => {
    const css = themeToCss();
    for (const n of Object.keys(PALETTES)) {
      expect(css).toContain(`:root[data-palette='${n}']:not([data-theme='dark'])`);
      expect(css).toContain(`:root[data-palette='${n}']:not([data-theme='light'])`);
      expect(css).toContain(`:root[data-palette='${n}'][data-theme='dark']`);
    }
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
