'use client';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { checkUserAgent, type BaselineResult, type FeatureFlags } from '@if/shared';
import { api } from '@/lib/api-client';

/** Feature detection for what the portal relies on (BASELINE.features). Reads `window`, so client only. */
function detectFeatures(): FeatureFlags {
  const f: FeatureFlags = {};
  f.fetch = typeof fetch === 'function';
  f.grid =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS.supports('display', 'grid') : true;
  f.structuredClone = typeof structuredClone === 'function';
  f.subtleCrypto = typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
  f.intersectionObserver = typeof IntersectionObserver !== 'undefined';
  return f;
}

const store = {
  get(key: string) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      window.sessionStorage.setItem(key, v);
    } catch {
      /* private window: the notice simply comes back next time */
    }
  },
};

/**
 * A polite, dismissible notice when the browser is below the published baseline (NFR-C08). It never blocks anything.
 * With a `csrf` token (signed in) the result is also reported once per browser session so an administrator can see
 * which browsers sign in; the server judges it again and keeps only the browser, its version and the verdict.
 */
export function BrowserNotice({ csrf }: { csrf?: string }) {
  const [result, setResult] = useState<BaselineResult | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent;
    const features = detectFeatures();
    const { browser, result: r } = checkUserAgent(ua, features);
    const key = `${browser.family}-${browser.major}`;
    if (store.get('if-browser-dismissed') === key) setDismissed(true);
    setResult(r);
    if (csrf && store.get('if-browser-reported') !== key) {
      store.set('if-browser-reported', key);
      void api('/auth/client-check', { method: 'POST', csrf, body: { userAgent: ua, features } }).catch(
        () => undefined,
      );
    }
  }, [csrf]);

  if (!result || result.status === 'SUPPORTED' || dismissed) return null;
  return (
    <div
      role="region"
      aria-label="Browser notice"
      data-testid="browser-notice"
      className="mb-4 flex items-start gap-3 rounded-lg border border-border-strong bg-surface-alt p-3 text-sm"
    >
      <p className="min-w-0 flex-1" role="status">
        {result.message}{' '}
        <Link href="/browser-support" className="underline">
          See the supported browsers
        </Link>
        . You can carry on as you are.
      </p>
      <button
        type="button"
        aria-label="Dismiss browser notice"
        className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-surface"
        onClick={() => {
          const { browser } = checkUserAgent(window.navigator.userAgent);
          store.set('if-browser-dismissed', `${browser.family}-${browser.major}`);
          setDismissed(true);
        }}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
