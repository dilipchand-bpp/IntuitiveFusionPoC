'use client';
import { ExternalLink, Monitor, RefreshCw, RotateCw, Smartphone, Tablet, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, cn } from '@if/ui';
import { safePath } from './safe-path';

export type Device = 'phone' | 'tablet' | 'desktop';
const DEVICES: Record<Device, { label: string; w: number; h: number; Icon: typeof Monitor }> = {
  phone: { label: 'Phone', w: 375, h: 812, Icon: Smartphone },
  tablet: { label: 'Tablet', w: 768, h: 1024, Icon: Tablet },
  desktop: { label: 'Desktop', w: 0, h: 0, Icon: Monitor },
};

/**
 * Shows the app inside a phone or tablet frame so the owner can check the mobile and tablet layouts from a desktop
 * browser. The page inside is a real same-origin iframe of that width, so media queries, the menu drawer and
 * touch-size rules behave exactly as on the device. It is a viewing aid, not a device emulator: it does not
 * simulate touch input or a phone's browser chrome.
 */
export function DevicePreview({
  initialPath,
  initialDevice,
}: {
  initialPath: string;
  initialDevice: Device;
}) {
  const router = useRouter();
  const [device, setDevice] = useState<Device>(initialDevice);
  const [landscape, setLandscape] = useState(false);
  const [path, setPath] = useState(initialPath);
  const [scale, setScale] = useState(1);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  const spec = DEVICES[device];
  const w = device === 'desktop' ? 0 : landscape ? spec.h : spec.w;
  const h = device === 'desktop' ? 0 : landscape ? spec.w : spec.h;

  /** The page currently shown inside the frame (same origin, so it can be read). */
  const current = useCallback((): string => {
    try {
      const l = frame.current?.contentWindow?.location;
      return l ? safePath(l.pathname + l.search) : path;
    } catch {
      return path;
    }
  }, [path]);

  // Fit the device into the space available, never enlarging it.
  useEffect(() => {
    const fit = () => {
      const box = stage.current?.getBoundingClientRect();
      if (!box || device === 'desktop') return setScale(1);
      setScale(Math.min(1, (box.width - 32) / w, (window.innerHeight - box.top - 24) / h));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [device, w, h]);

  const choose = (d: Device) => {
    setPath(current()); // keep the same page when switching devices
    setDevice(d);
  };
  const rotate = () => {
    setPath(current());
    setLandscape((l) => !l);
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-surface-alt"
      data-testid="device-preview"
      data-device={device}
    >
      <div
        role="toolbar"
        aria-label="Device preview controls"
        className="glass sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
      >
        <span className="mr-2 hidden font-heading font-bold sm:inline">Device preview</span>
        <div role="group" aria-label="Device" className="flex gap-1">
          {(Object.keys(DEVICES) as Device[]).map((d) => {
            const { label, Icon } = DEVICES[d];
            return (
              <Button
                key={d}
                variant={d === device ? 'primary' : 'secondary'}
                aria-pressed={d === device}
                onClick={() => choose(d)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
                {d !== 'desktop' && (
                  <span className="hidden text-xs opacity-80 md:inline">{DEVICES[d].w}px</span>
                )}
              </Button>
            );
          })}
        </div>
        {device !== 'desktop' && (
          <Button variant="secondary" onClick={rotate} aria-pressed={landscape}>
            <RotateCw className="size-4" aria-hidden="true" />
            Rotate
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label="Reload the page in the frame"
          onClick={() => frame.current?.contentWindow?.location.reload()}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={() => window.open(current(), '_blank', 'noopener')}>
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Open in a new tab</span>
            <span className="sr-only sm:hidden">Open in a new tab</span>
          </Button>
          <Button variant="secondary" aria-label="Close the preview" onClick={() => router.push(current())}>
            <X className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Close</span>
          </Button>
        </span>
      </div>

      <div ref={stage} className="flex flex-1 justify-center overflow-auto p-4">
        {device === 'desktop' ? (
          <iframe
            ref={frame}
            key={`d-${path}`}
            src={path}
            title="App preview, desktop"
            className="h-[calc(100vh-5rem)] w-full rounded-lg border border-border bg-bg shadow-lg"
          />
        ) : (
          <div style={{ width: w * scale, height: h * scale }} className="shrink-0">
            <div
              style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
              className={cn(
                'overflow-hidden border-[10px] border-text bg-bg shadow-lg',
                device === 'phone' ? 'rounded-[2.5rem]' : 'rounded-[1.75rem]',
              )}
            >
              <iframe
                ref={frame}
                key={`${device}-${landscape}-${path}`}
                src={path}
                title={`App preview, ${spec.label.toLowerCase()} ${w} by ${h}`}
                width={w - 20}
                height={h - 20}
                className="block border-0 bg-bg"
                data-testid="preview-frame"
                data-width={w - 20}
              />
            </div>
          </div>
        )}
      </div>
      <p className="px-4 pb-3 text-center text-xs text-text-muted">
        A real page of this width. It does not simulate touch or a phone browser&apos;s own toolbars.
      </p>
    </div>
  );
}
