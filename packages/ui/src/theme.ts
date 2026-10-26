/**
 * THE theme file. Every colour, font, size, radius and shadow in the product comes from here.
 * Rebranding = edit this file, run `npm run theme:build -w @if/ui`, done (see rebrand test).
 *
 * Colour provenance: primary/secondary/silver are sampled from Logo.jpg (dark bar, tile, "F").
 * The logo is monochrome, so the accent is a proposed hue approved by the owner (2026-10-02).
 */

export type ColorTokens = {
  bg: string; // page background
  surface: string; // cards, inputs
  surfaceAlt: string; // zebra rows, subtle panels
  border: string; // decorative dividers
  borderStrong: string; // borders of interactive controls (>= 3:1 against surface, WCAG 1.4.11)
  text: string;
  textMuted: string;
  primary: string; // brand dark: header, primary buttons
  primaryFg: string;
  primaryHover: string;
  secondary: string; // logo tile tone; icons, large text, non-text UI only
  silver: string; // logo "F" tone; chips, dividers
  accent: string; // links, focus, selected state, hero CTA
  accentFg: string;
  accentHover: string;
  ring: string; // focus ring
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
  info: string;
  infoBg: string;
  gradientFrom: string; // brand gradient start (hero, primary CTA, accents)
  gradientTo: string; // brand gradient end
  gradientFg: string; // text/icons placed on the gradient
  overlay: string; // modal scrim
};

export const light: ColorTokens = {
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F5',
  border: '#DCE1E9',
  borderStrong: '#6F7A8B',
  text: '#141A22',
  textMuted: '#4F5B6B',
  primary: '#1A2230',
  primaryFg: '#FFFFFF',
  primaryHover: '#2D384A',
  secondary: '#6F7A8B',
  silver: '#D3D9E2',
  accent: '#4254C5',
  accentFg: '#FFFFFF',
  accentHover: '#3646A8',
  ring: '#4254C5',
  success: '#1B7A4B',
  successBg: '#E6F4EC',
  warning: '#9A5200',
  warningBg: '#FDF0DC',
  error: '#B42318',
  errorBg: '#FCE8E6',
  info: '#1A5FA8',
  infoBg: '#E5F0FB',
  gradientFrom: '#4254C5',
  gradientTo: '#7A45D6',
  gradientFg: '#FFFFFF',
  overlay: 'rgba(15, 20, 28, 0.5)',
};

/** The default colour mode: near-black blue-grey, hairline slate borders, one restrained accent. */
export const dark: ColorTokens = {
  bg: '#0B0F14',
  surface: '#10151C',
  surfaceAlt: '#161D27',
  border: '#222B37',
  borderStrong: '#6C7889',
  text: '#E7EBF1',
  textMuted: '#9AA5B4',
  primary: '#E4E8EE',
  primaryFg: '#0B0F14',
  primaryHover: '#FFFFFF',
  secondary: '#8E99A9',
  silver: '#3A4452',
  accent: '#8C9BFF',
  accentFg: '#0B0F14',
  accentHover: '#A9B5FF',
  ring: '#8C9BFF',
  success: '#4CC38A',
  successBg: '#0F2219',
  warning: '#EBB05A',
  warningBg: '#2B2010',
  error: '#FF8F86',
  errorBg: '#301917',
  info: '#6CB4FF',
  infoBg: '#0F2336',
  gradientFrom: '#8C9BFF',
  gradientTo: '#B79CFF',
  gradientFg: '#10132B',
  overlay: 'rgba(3, 6, 10, 0.7)',
};

export const typography = {
  heading: "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', system-ui, sans-serif",
  body: "'Inter Variable', 'Inter', system-ui, sans-serif",
  mono: "ui-monospace, 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  // size / line-height pairs (px). Light and airy: body text is 14px, captions 12-13px (eyebrows are set in the kit).
  scale: {
    xs: ['12px', '16px'],
    sm: ['13px', '20px'],
    base: ['14px', '22px'],
    lg: ['16px', '24px'],
    xl: ['18px', '26px'],
    '2xl': ['22px', '30px'],
    '3xl': ['28px', '34px'],
    '4xl': ['34px', '40px'],
    '5xl': ['44px', '50px'],
  },
  // Utilities such as font-semibold / font-extrabold resolve to these, so headings stay light across the whole product.
  weights: { medium: '450', semibold: '550', bold: '600', extrabold: '500' },
  /** Headings are set tight. */
  headingTracking: '-0.015em',
  /** Small uppercase labels above titles and figures. */
  eyebrowTracking: '0.14em',
} as const;

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
  12: '48px',
  16: '64px',
  24: '96px',
} as const;

export const radius = { sm: '3px', md: '5px', lg: '6px', full: '999px' } as const;

/** Almost none: structure comes from hairline borders. Only floating layers (menus, dialogs) lift. */
export const shadow = {
  sm: '0 0 0 transparent',
  md: '0 6px 18px rgba(0, 0, 0, 0.16)',
  lg: '0 14px 36px rgba(0, 0, 0, 0.28)',
} as const;

export const breakpoints = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' } as const;

export const motion = {
  fast: '150ms',
  base: '200ms',
  slow: '250ms',
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

/** Minimum interactive target (WCAG 2.5.8 / mobile guidance). */
export const touchTarget = '44px';

/**
 * Contrast contract. [foreground key, background key, minimum ratio, why]
 * 4.5 = normal text, 3 = large text / UI components / focus indicators.
 * The unit test evaluates every pair for both themes - a rebrand that breaks AA fails the build.
 */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [keyof ColorTokens, keyof ColorTokens, number, string]> =
  [
    ['text', 'bg', 4.5, 'body text on page'],
    ['text', 'surface', 4.5, 'body text on cards'],
    ['text', 'surfaceAlt', 4.5, 'body text on subtle panels'],
    ['textMuted', 'bg', 4.5, 'secondary text on page'],
    ['textMuted', 'surface', 4.5, 'secondary text on cards'],
    ['textMuted', 'surfaceAlt', 4.5, 'secondary text on subtle panels'],
    ['primaryFg', 'primary', 4.5, 'primary button / header'],
    ['primaryFg', 'primaryHover', 4.5, 'primary button hover'],
    ['accentFg', 'accent', 4.5, 'accent button'],
    ['accentFg', 'accentHover', 4.5, 'accent button hover'],
    ['accent', 'bg', 4.5, 'links on page'],
    ['accent', 'surface', 4.5, 'links on cards'],
    ['success', 'surface', 4.5, 'success text'],
    ['warning', 'surface', 4.5, 'warning text'],
    ['error', 'surface', 4.5, 'error text'],
    ['info', 'surface', 4.5, 'info text'],
    ['success', 'successBg', 4.5, 'success badge'],
    ['warning', 'warningBg', 4.5, 'warning badge'],
    ['error', 'errorBg', 4.5, 'error badge'],
    ['info', 'infoBg', 4.5, 'info badge'],
    ['borderStrong', 'surface', 3, 'control borders (1.4.11)'],
    ['borderStrong', 'bg', 3, 'control borders on page (1.4.11)'],
    ['ring', 'bg', 3, 'focus indicator on page'],
    ['ring', 'surface', 3, 'focus indicator on cards'],
    ['secondary', 'surface', 3, 'icons / large text only'],
    ['gradientFg', 'gradientFrom', 4.5, 'text on the brand gradient (start)'],
    ['gradientFg', 'gradientTo', 4.5, 'text on the brand gradient (end)'],
    ['gradientFrom', 'bg', 4.5, 'gradient headline text on page (start)'],
    ['gradientTo', 'bg', 4.5, 'gradient headline text on page (end)'],
  ];

// ---------- white labelling (FR-0855) ----------

/**
 * Colour sets an organisation can choose for its own portal. INDIGO is the base theme above; each other palette changes only
 * the accent and the brand gradient, and every one passes the same contrast contract in both themes (a test checks it).
 */
export const PALETTE_NAMES = ['INDIGO', 'TEAL', 'CRIMSON', 'FOREST', 'SLATE'] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];
type PaletteTokens = Pick<
  ColorTokens,
  'accent' | 'accentHover' | 'ring' | 'gradientFrom' | 'gradientTo' | 'gradientFg'
>;
const pal = (accent: string, hover: string, to: string, fg: string): PaletteTokens => ({
  accent,
  accentHover: hover,
  ring: accent,
  gradientFrom: accent,
  gradientTo: to,
  gradientFg: fg,
});
export const PALETTES: Record<
  Exclude<PaletteName, 'INDIGO'>,
  { light: PaletteTokens; dark: PaletteTokens }
> = {
  TEAL: {
    light: pal('#0E6B73', '#0A545A', '#1F7A5C', '#FFFFFF'),
    dark: pal('#5CD1D9', '#7FE0E6', '#7FE3B8', '#08201F'),
  },
  CRIMSON: {
    light: pal('#B3263E', '#8F1D31', '#B4411C', '#FFFFFF'),
    dark: pal('#FF8DA1', '#FFA9B8', '#FFB38A', '#2A0A12'),
  },
  FOREST: {
    light: pal('#2F6B2F', '#245524', '#4A7A23', '#FFFFFF'),
    dark: pal('#8FD18F', '#A8DEA8', '#C4E37A', '#0F2410'),
  },
  SLATE: {
    light: pal('#3D4F66', '#2E3D50', '#566B87', '#FFFFFF'),
    dark: pal('#A9B8CC', '#C2CEDC', '#C8D3E3', '#10151D'),
  },
};
/** The tokens a palette in a theme actually uses: the base theme with the palette laid over it. */
export const withPalette = (base: ColorTokens, p: PaletteTokens): ColorTokens => ({ ...base, ...p });

const paletteCss = (): string =>
  (Object.keys(PALETTES) as Array<keyof typeof PALETTES>)
    .map((n) => {
      const vars = (t: PaletteTokens, indent: string) =>
        Object.entries(t)
          .map(([k, val]) => `${indent}--if-color-${kebabCase(k)}: ${val};`)
          .join('\n');
      const sel = `:root[data-palette='${n}']`;
      // dark is the default mode, so a palette's dark values apply unless the light theme is chosen
      return [
        `${sel}:not([data-theme='light']) {`,
        vars(PALETTES[n].dark, '  '),
        '}',
        `${sel}[data-theme='light'] {`,
        vars(PALETTES[n].light, '  '),
        '}',
      ].join('\n');
    })
    .join('\n');
const kebabCase = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

// ---------- emitters (pure functions, used by the build script and tests) ----------

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

const colorVars = (c: ColorTokens, indent = '  ') =>
  Object.entries(c)
    .map(([k, v]) => `${indent}--if-color-${kebab(k)}: ${v};`)
    .join('\n');

/** Emits the full CSS: variables for both themes, system preference, manual override, Tailwind v4 @theme mapping. */
export function themeToCss(): string {
  const scale = Object.entries(typography.scale)
    .map(([k, [s, l]]) => `  --if-text-${k}: ${s};\n  --if-leading-${k}: ${l};`)
    .join('\n');
  const sp = Object.entries(spacing)
    .map(([k, v]) => `  --if-space-${k}: ${v};`)
    .join('\n');
  const wt = Object.entries(typography.weights)
    .map(([k, v]) => `  --if-weight-${k}: ${v};`)
    .join('\n');
  const rd = Object.entries(radius)
    .map(([k, v]) => `  --if-radius-${k}: ${v};`)
    .join('\n');
  const sh = Object.entries(shadow)
    .map(([k, v]) => `  --if-shadow-${k}: ${v};`)
    .join('\n');
  const tailwindColors = Object.keys(light)
    .map((k) => `  --color-${kebab(k)}: var(--if-color-${kebab(k)});`)
    .join('\n');
  const tailwindText = Object.keys(typography.scale)
    .map((k) => `  --text-${k}: var(--if-text-${k});\n  --text-${k}--line-height: var(--if-leading-${k});`)
    .join('\n');
  const tailwindWeights = Object.keys(typography.weights)
    .map((k) => `  --font-weight-${k}: var(--if-weight-${k});`)
    .join('\n');
  return `/* GENERATED from src/theme.ts by scripts/build-theme.ts - do not edit by hand. */
/* Dark is the default colour mode; the light theme is chosen with data-theme='light' (see theme-script.ts). */
:root {
${colorVars(dark)}
  --if-font-heading: ${typography.heading};
  --if-font-body: ${typography.body};
  --if-font-mono: ${typography.mono};
  --if-heading-tracking: ${typography.headingTracking};
  --if-eyebrow-tracking: ${typography.eyebrowTracking};
${scale}
${wt}
${sp}
${rd}
${sh}
  --if-motion-fast: ${motion.fast};
  --if-motion-base: ${motion.base};
  --if-motion-slow: ${motion.slow};
  --if-motion-easing: ${motion.easing};
  --if-touch-target: ${touchTarget};
  color-scheme: dark;
}
:root[data-theme='light'] {
${colorVars(light)}
  color-scheme: light;
}
${paletteCss()}
@media (prefers-reduced-motion: reduce) {
  :root {
    --if-motion-fast: 0ms;
    --if-motion-base: 0ms;
    --if-motion-slow: 0ms;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
@theme inline {
${tailwindColors}
${tailwindText}
${tailwindWeights}
  --font-heading: var(--if-font-heading);
  --font-sans: var(--if-font-body);
  --font-mono: var(--if-font-mono);
  --radius-sm: var(--if-radius-sm);
  --radius-md: var(--if-radius-md);
  --radius-lg: var(--if-radius-lg);
  --shadow-sm: var(--if-shadow-sm);
  --shadow-md: var(--if-shadow-md);
  --shadow-lg: var(--if-shadow-lg);
  --breakpoint-sm: ${breakpoints.sm};
  --breakpoint-md: ${breakpoints.md};
  --breakpoint-lg: ${breakpoints.lg};
  --breakpoint-xl: ${breakpoints.xl};
}
`;
}

// ---------- WCAG 2.1 contrast maths ----------
function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
