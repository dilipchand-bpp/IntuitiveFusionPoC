import { cn } from './cn';

/**
 * Brand mark. The image is served from the web app's /public (copied from Logo.jpg).
 * Decorative when the visible product name sits next to it; named otherwise.
 */
export function Logo({
  size = 40,
  withName = false,
  className,
}: {
  size?: number;
  withName?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <img
        src="/logo-256.png"
        width={size}
        height={size}
        alt={withName ? '' : 'Intuitive Fusion'}
        className="rounded-sm"
      />
      {withName && <span className="font-heading text-lg font-bold">Intuitive Fusion</span>}
    </span>
  );
}
