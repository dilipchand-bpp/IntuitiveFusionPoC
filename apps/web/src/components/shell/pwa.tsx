'use client';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@if/ui';

/** Registers the service worker in a production build only, so development hot reloading is never in its way. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** An "Install the app" button where the browser allows it, and the way to do it by hand where it does not. */
export function InstallApp() {
  const [ev, setEv] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia('(display-mode: standalone)').matches);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEv(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  if (installed) return <p className="text-sm text-success">You are using the installed app.</p>;
  if (ev)
    return (
      <Button
        variant="secondary"
        onClick={() => {
          void ev.prompt();
          setEv(null);
        }}
      >
        <Download className="size-4" aria-hidden="true" />
        Install the app
      </Button>
    );
  return (
    <p className="text-sm text-text-muted" data-testid="install-hint">
      {ios
        ? 'To install: tap Share, then Add to Home Screen.'
        : 'To install: open this page in Chrome or Edge, then use the browser menu and choose Install app.'}
    </p>
  );
}
