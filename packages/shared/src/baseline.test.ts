import { describe, expect, it } from 'vitest';
import { BASELINE, checkUserAgent, evaluateBrowser, missingFeatures, parseUserAgent } from './baseline.js';

const UA = {
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  chromeOld:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.51',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iosOld:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
  ie11: 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko',
  unknown: 'SomeBot/1.0 (+http://example.test/bot)',
};

describe('NFR-C08 browser baseline: parsing user agents', () => {
  it('reads Chrome, Edge, Firefox and desktop Safari', () => {
    expect(parseUserAgent(UA.chrome)).toMatchObject({
      family: 'Chrome',
      major: 124,
      os: 'Windows',
      mobile: false,
    });
    expect(parseUserAgent(UA.edge)).toMatchObject({ family: 'Edge', major: 125, os: 'Windows' });
    expect(parseUserAgent(UA.firefox)).toMatchObject({ family: 'Firefox', major: 121 });
    expect(parseUserAgent(UA.safari)).toMatchObject({ family: 'Safari', major: 17, os: 'macOS' });
  });
  it('reads iPhone Safari and Chrome on iPhone by the iOS version, because both are WebKit', () => {
    expect(parseUserAgent(UA.iosSafari)).toMatchObject({
      family: 'Safari',
      major: 17,
      os: 'iOS',
      mobile: true,
    });
    expect(parseUserAgent(UA.iosChrome)).toMatchObject({ family: 'Chrome', major: 17, os: 'iOS' });
    expect(parseUserAgent(UA.androidChrome)).toMatchObject({
      family: 'Chrome',
      major: 123,
      os: 'Android',
      mobile: true,
    });
  });
  it('reads a headless Chrome the way it reads Chrome', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)).toMatchObject({ family: 'Chrome', major: 131, os: 'Linux' });
    expect(checkUserAgent(ua).result.status).toBe('SUPPORTED');
  });
  it('never throws on rubbish and calls an unrecognised agent Other', () => {
    expect(parseUserAgent(UA.unknown).family).toBe('Other');
    expect(parseUserAgent('').family).toBe('Other');
    expect(parseUserAgent(undefined).family).toBe('Other');
    expect(parseUserAgent('x'.repeat(5000)).family).toBe('Other');
  });
});

describe('NFR-C08 browser baseline: judging against the published minimums', () => {
  it('accepts current browsers on every listed family', () => {
    for (const ua of [
      UA.chrome,
      UA.edge,
      UA.firefox,
      UA.safari,
      UA.iosSafari,
      UA.iosChrome,
      UA.androidChrome,
    ])
      expect(checkUserAgent(ua).result.status, ua).toBe('SUPPORTED');
  });
  it('flags an old Chrome, an old iPhone and Internet Explorer as below baseline, politely and with the minimum', () => {
    const old = checkUserAgent(UA.chromeOld).result;
    expect(old.status).toBe('BELOW_BASELINE');
    expect(old.minimum).toBe('Chrome 120');
    expect(old.message).toContain('update');
    expect(checkUserAgent(UA.iosOld).result).toMatchObject({
      status: 'BELOW_BASELINE',
      minimum: 'iOS or iPadOS 17',
    });
    expect(checkUserAgent(UA.ie11).result.status).toBe('BELOW_BASELINE');
  });
  it('treats an unknown browser as UNKNOWN, not as unsupported', () => {
    expect(checkUserAgent(UA.unknown).result.status).toBe('UNKNOWN');
  });
  it('feature detection can lower a good version, and a missing flag list changes nothing', () => {
    expect(missingFeatures(undefined)).toEqual([]);
    expect(missingFeatures({ fetch: true, grid: false })).toEqual(['CSS grid']);
    const r = evaluateBrowser(parseUserAgent(UA.chrome), { fetch: true, structuredClone: false });
    expect(r.status).toBe('BELOW_BASELINE');
    expect(r.missingFeatures).toEqual(['structuredClone']);
  });
  it('publishes Chrome and Edge and Firefox 120 and Safari 17', () => {
    const m = Object.fromEntries(BASELINE.browsers.map((b) => [b.family, b.min]));
    expect(m).toEqual({ Chrome: 120, Edge: 120, Firefox: 120, Safari: 17 });
  });
});
