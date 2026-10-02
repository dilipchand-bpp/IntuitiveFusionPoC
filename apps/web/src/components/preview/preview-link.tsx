'use client';
import { MonitorSmartphone } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@if/ui';

/**
 * Header button that opens the current page in the device preview. Hidden on phones (pointless there) and inside
 * the preview frame itself.
 */
export function PreviewLink() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [href, setHref] = useState('/preview');
  useEffect(() => {
    setShow(window.self === window.top);
    setHref(`/preview?device=tablet&path=${encodeURIComponent(pathname + window.location.search)}`);
  }, [pathname]);
  if (!show) return null;
  return (
    <span className="hidden md:block">
      <Button asChild variant="ghost" size="icon">
        <a
          href={href}
          aria-label="Preview on phone or tablet"
          title="Preview on phone or tablet"
          className="text-text"
        >
          <MonitorSmartphone className="size-5" aria-hidden="true" />
        </a>
      </Button>
    </span>
  );
}
