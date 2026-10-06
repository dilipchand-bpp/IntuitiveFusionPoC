/**
 * Published browser and operating-system baseline (NFR-C08). One table drives the public /browser-support page, the
 * polite notice shown after sign-in, and the server-side re-check of what a browser reports, so the three can never
 * disagree. Pure functions only: nothing here touches `window` or `navigator`, so it is unit-tested with plain strings.
 */
export const BROWSER_FAMILIES = [
  'Chrome',
  'Edge',
  'Firefox',
  'Safari',
  'Opera',
  'Samsung Internet',
  'Internet Explorer',
  'Other',
] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

export interface BaselineBrowser {
  family: BrowserFamily;
  /** Oldest major version that is supported. */
  min: number;
  /** Where the family is listed (desktop and mobile are the same engine for the browsers named here). */
  platforms: string;
}

export const BASELINE = {
  /** Date the baseline was last reviewed, shown on the public page. */
  reviewed: '2026-10-01',
  browsers: [
    { family: 'Chrome', min: 120, platforms: 'Windows, macOS, Linux, ChromeOS, Android' },
    { family: 'Edge', min: 120, platforms: 'Windows, macOS' },
    { family: 'Firefox', min: 120, platforms: 'Windows, macOS, Linux, Android' },
    { family: 'Safari', min: 17, platforms: 'macOS 14 and later, iPadOS 17 and later' },
  ] as readonly BaselineBrowser[],
  mobile: [
    { name: 'Safari and other browsers on iPhone and iPad', min: 'iOS or iPadOS 17' },
    { name: 'Chrome on Android', min: 'Chrome 120 on Android 12' },
    { name: 'Samsung Internet', min: 'Version 23' },
  ] as ReadonlyArray<{ name: string; min: string }>,
  operatingSystems: [
    { name: 'Windows', min: 'Windows 10 (22H2) or Windows 11' },
    { name: 'macOS', min: 'macOS 13 (Ventura) or later' },
    { name: 'iOS and iPadOS', min: '17 or later' },
    { name: 'Android', min: '12 or later' },
    { name: 'ChromeOS and Linux', min: 'A currently supported release with a supported browser above' },
  ] as ReadonlyArray<{ name: string; min: string }>,
  /** Capabilities the portal relies on. A browser that reports a good version but lacks one of these is treated as below baseline. */
  features: [
    { key: 'fetch', label: 'Fetch API' },
    { key: 'grid', label: 'CSS grid' },
    { key: 'structuredClone', label: 'structuredClone' },
    { key: 'subtleCrypto', label: 'Web Crypto' },
    { key: 'intersectionObserver', label: 'IntersectionObserver' },
  ] as ReadonlyArray<{ key: string; label: string }>,
};

const MIN_BY_FAMILY: Record<string, number> = Object.fromEntries(
  BASELINE.browsers.map((b) => [b.family, b.min]),
);
MIN_BY_FAMILY['Samsung Internet'] = 23;
const MIN_IOS = 17;

export interface ParsedBrowser {
  family: BrowserFamily;
  /** Major version of the browser; on iPhone and iPad every browser is WebKit, so this is the iOS major version. */
  major: number;
  os: 'Windows' | 'macOS' | 'iOS' | 'Android' | 'ChromeOS' | 'Linux' | 'Other';
  mobile: boolean;
}

const num = (m: RegExpMatchArray | null): number | null => (m?.[1] ? Number.parseInt(m[1], 10) : null);

/** Reads the browser family, major version and operating system from a user agent string. Never throws. */
export function parseUserAgent(ua: string | null | undefined): ParsedBrowser {
  const s = String(ua ?? '').slice(0, 400);
  const ios = /\b(iPhone|iPad|iPod)\b/.test(s) || (/\bMacintosh\b/.test(s) && /\bMobile\//.test(s));
  const os: ParsedBrowser['os'] = ios
    ? 'iOS'
    : /\bAndroid\b/.test(s)
      ? 'Android'
      : /\bCrOS\b/.test(s)
        ? 'ChromeOS'
        : /\bWindows\b/.test(s)
          ? 'Windows'
          : /\bMac OS X\b|\bMacintosh\b/.test(s)
            ? 'macOS'
            : /\bLinux\b|\bX11\b/.test(s)
              ? 'Linux'
              : 'Other';
  const mobile = ios || /\bMobile\b|\bAndroid\b/.test(s);
  const iosMajor = num(s.match(/\bOS (\d+)[_.]/)) ?? num(s.match(/\bVersion\/(\d+)/));

  const pick = (family: BrowserFamily, major: number | null): ParsedBrowser => ({
    family,
    major: ios ? (iosMajor ?? major ?? 0) : (major ?? 0),
    os,
    mobile,
  });

  const edge = num(s.match(/\b(?:Edg|EdgA|EdgiOS|Edge)\/(\d+)/));
  if (edge !== null) return pick('Edge', edge);
  const opera = num(s.match(/\b(?:OPR|OPiOS)\/(\d+)/));
  if (opera !== null) return pick('Opera', opera);
  const samsung = num(s.match(/\bSamsungBrowser\/(\d+)/));
  if (samsung !== null) return pick('Samsung Internet', samsung);
  const crios = num(s.match(/\bCriOS\/(\d+)/));
  if (crios !== null) return pick('Chrome', crios);
  const fxios = num(s.match(/\bFxiOS\/(\d+)/));
  if (fxios !== null) return pick('Firefox', fxios);
  const firefox = num(s.match(/\bFirefox\/(\d+)/));
  if (firefox !== null) return pick('Firefox', firefox);
  const chrome = num(s.match(/(?:\b|Headless)Chrome\/(\d+)/)); // headless test browsers say HeadlessChrome
  if (chrome !== null) return pick('Chrome', chrome);
  if (/\bTrident\/|\bMSIE /.test(s)) return pick('Internet Explorer', num(s.match(/\b(?:MSIE |rv:)(\d+)/)));
  const safari = num(s.match(/\bVersion\/(\d+)/));
  if (safari !== null && /\bSafari\//.test(s)) return pick('Safari', safari);
  return { family: 'Other', major: 0, os, mobile };
}

export type BaselineStatus = 'SUPPORTED' | 'BELOW_BASELINE' | 'UNKNOWN';
export interface BaselineResult {
  status: BaselineStatus;
  /** One plain sentence for the notice. */
  message: string;
  /** The minimum the person needs, when known. */
  minimum?: string;
  missingFeatures: string[];
}

/** Capability flags the client collects by feature detection; keys are in BASELINE.features. */
export type FeatureFlags = Record<string, boolean>;

export function missingFeatures(flags: FeatureFlags | undefined): string[] {
  if (!flags) return [];
  return BASELINE.features.filter((f) => flags[f.key] === false).map((f) => f.label);
}

/** Judges a parsed browser (and, optionally, feature detection) against the published baseline. */
export function evaluateBrowser(b: ParsedBrowser, flags?: FeatureFlags): BaselineResult {
  const gaps = missingFeatures(flags);
  if (b.family === 'Other') {
    return {
      status: 'UNKNOWN',
      message:
        'We could not tell which browser you are using. The portal is tested on current Chrome, Edge, Firefox and Safari.',
      missingFeatures: gaps,
    };
  }
  const onIos = b.os === 'iOS';
  const min = onIos ? MIN_IOS : MIN_BY_FAMILY[b.family];
  if (min === undefined) {
    return {
      status: 'BELOW_BASELINE',
      message: `${b.family} is not on the supported list. The portal is tested on current Chrome, Edge, Firefox and Safari.`,
      missingFeatures: gaps,
    };
  }
  if (b.major < min) {
    const minimum = onIos ? `iOS or iPadOS ${min}` : `${b.family} ${min}`;
    return {
      status: 'BELOW_BASELINE',
      message: `Your ${onIos ? `iOS version (${b.major})` : `${b.family} version (${b.major})`} is older than the supported minimum. Please update to ${minimum} or later for the best experience.`,
      minimum,
      missingFeatures: gaps,
    };
  }
  if (gaps.length > 0) {
    return {
      status: 'BELOW_BASELINE',
      message: `Your browser does not provide ${gaps.join(', ')}, which some pages need. Please update it or use another supported browser.`,
      missingFeatures: gaps,
    };
  }
  return { status: 'SUPPORTED', message: 'Your browser meets the published baseline.', missingFeatures: [] };
}

/** One call for the common case. */
export const checkUserAgent = (ua: string | null | undefined, flags?: FeatureFlags) => {
  const browser = parseUserAgent(ua);
  return { browser, result: evaluateBrowser(browser, flags) };
};
