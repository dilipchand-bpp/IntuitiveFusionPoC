'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@if/ui';
import { aud } from '@/lib/labels';

export interface Pin {
  supplierId: string;
  company: string;
  level: string;
  committed: number;
  location: { city: string; state: string; country: string; lat: number; lng: number };
  signals: Array<{ feed: string; level: string; detail: string }>;
}

const SHAPE: Record<string, string> = { HIGH: '▲', MEDIUM: '◆', LOW: '●', UNKNOWN: '○' };
const FILL: Record<string, string> = {
  HIGH: 'bg-error text-white',
  MEDIUM: 'bg-warning text-white',
  LOW: 'bg-success text-white',
  UNKNOWN: 'bg-surface text-text',
};
const AUSTRALIA: [number, number] = [-25, 134];

/**
 * A real map (OpenStreetMap tiles through Leaflet) with the suppliers pinned on it. Zoom with the buttons, the keyboard
 * (plus and minus), a double click or a pinch; the page keeps scrolling because the wheel is left alone. The table beside it
 * carries the same facts for anyone who cannot use a map. Tiles need an internet connection; the pins do not.
 */
export function SupplierMap({ pins }: { pins: Pin[] }) {
  const box = useRef<HTMLDivElement>(null);
  const fit = useRef<() => void>(() => undefined);
  const [tilesFailed, setTilesFailed] = useState(false);
  const key = JSON.stringify(pins.map((p) => [p.supplierId, p.location.lat, p.location.lng, p.level]));

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !box.current) return;
      const map = L.map(box.current, { scrollWheelZoom: false, worldCopyJump: true, minZoom: 2 });
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
      tiles.on('tileerror', () => setTilesFailed(true));
      tiles.addTo(map);
      const points: Array<[number, number]> = [];
      for (const p of pins) {
        const el = document.createElement('span');
        el.className = `flex size-8 items-center justify-center rounded-full border-2 border-white text-base font-bold shadow-md ${FILL[p.level] ?? FILL.UNKNOWN}`;
        el.textContent = SHAPE[p.level] ?? SHAPE.UNKNOWN!;
        const icon = L.divIcon({
          html: el,
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -16],
        });
        // supplier names come from outside, so the popup is built from text nodes, never from HTML
        const pop = document.createElement('div');
        const h = document.createElement('strong');
        h.textContent = p.company;
        const where = document.createElement('div');
        where.textContent = `${p.location.city}, ${p.location.state}`;
        const risk = document.createElement('div');
        risk.textContent = `${p.level.toLowerCase()} risk · ${aud.format(p.committed)} committed`;
        pop.append(h, where, risk);
        for (const s of p.signals) {
          const li = document.createElement('div');
          li.textContent = `${s.feed.toLowerCase()}: ${s.level.toLowerCase()} (${s.detail})`;
          pop.append(li);
        }
        L.marker([p.location.lat, p.location.lng], {
          icon,
          title: `${p.company}, ${p.location.city}`,
          alt: `${p.company}, ${p.location.city}`,
        })
          .bindPopup(pop)
          .addTo(map);
        points.push([p.location.lat, p.location.lng]);
      }
      const reset = () => {
        if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 6 });
        else if (points.length === 1) map.setView(points[0]!, 6);
        else map.setView(AUSTRALIA, 4);
      };
      fit.current = reset;
      reset();
      dispose = () => map.remove();
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [key]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => fit.current()}>
          Show all suppliers
        </Button>
        <p className="text-sm text-text-muted">
          Zoom with the + and − buttons, a double click or a pinch. With the map selected, the + and − keys
          and the arrow keys work too.
        </p>
      </div>
      <div
        ref={box}
        role="region"
        aria-label={`Map of ${pins.length} supplier location${pins.length === 1 ? '' : 's'}`}
        data-testid="supplier-map"
        className="relative isolate z-0 h-[26rem] w-full overflow-hidden rounded-lg border border-border bg-surface-alt"
      />
      {tilesFailed && (
        <p role="status" className="text-sm text-warning" data-testid="tiles-failed">
          The map background could not be loaded (it needs an internet connection). The pins and the table
          below still work.
        </p>
      )}
    </div>
  );
}
