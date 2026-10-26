import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { Avatar } from './surfaces';
import { cn } from './cn';
import { UiLink } from './link';

/**
 * Page-pattern primitives (see docs/Design-System.md). Every inner page is built from these:
 * PageHeader, SectionHeader, KpiStrip/KpiCell, Panel, RowList/ListRow, ActivityRow and the Eyebrow label.
 */

/** Small uppercase label with wide tracking, muted. Sits above a title or a figure. */
export function Eyebrow({ children, className, ...p }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'text-[11px] font-medium uppercase leading-4 tracking-[0.14em] text-text-muted',
        className,
      )}
      {...p}
    >
      {children}
    </p>
  );
}

/** Page title block: eyebrow, large light title, muted subtitle and the page's actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  id,
  className,
  subtitleTestId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
  subtitleTestId?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1
          id={id}
          className={cn(
            'font-heading text-4xl font-medium tracking-[var(--if-heading-tracking)] text-text',
            eyebrow && 'mt-3',
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p data-testid={subtitleTestId} className="mt-2 max-w-prose text-sm text-text-muted">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Heading for a block of a page: eyebrow over a title, optional controls on the right. */
export function SectionHeader({
  eyebrow,
  title,
  actions,
  id,
  as: Tag = 'h2',
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  id?: string;
  as?: ElementType;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Tag
          id={id}
          className={cn(
            'font-heading text-2xl font-medium tracking-[var(--if-heading-tracking)] text-text',
            eyebrow && 'mt-1.5',
          )}
        >
          {title}
        </Tag>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A bordered panel: hairline border, no fill and no shadow. */
export function Panel({
  className,
  padded = true,
  as: Tag = 'section',
  ...p
}: HTMLAttributes<HTMLElement> & { padded?: boolean; as?: ElementType }) {
  return (
    <Tag
      className={cn('rounded-lg border border-border text-text', padded && 'p-5 sm:p-6', className)}
      {...p}
    />
  );
}

/** Zero-padded numeral for the KPI strip: 8 becomes "08". Anything that is not a number shows a dash. */
export const padNumber = (n: number | null | undefined, width = 2): string =>
  typeof n === 'number' && Number.isFinite(n) ? String(Math.max(0, Math.trunc(n))).padStart(width, '0') : '–';

/** Cells separated by hairlines, no filled cards. Two columns on phones, one row from `lg`. */
export function KpiStrip({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'grid grid-cols-2 border-y border-border lg:grid-cols-4',
        '[&>*]:border-border max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(even)]:border-l lg:[&>*:not(:first-child)]:border-l',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** One figure: eyebrow label, large numeral, small caption and a drill-down arrow (a link when `href` is given). */
export function KpiCell({
  label,
  value,
  caption,
  href,
  linkLabel,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  href?: string;
  /** Accessible name of the drill-down link; defaults to the label and caption. */
  linkLabel?: string;
}) {
  return (
    <div className="relative flex flex-col gap-2 px-5 py-6">
      <Eyebrow>{label}</Eyebrow>
      <p className="font-heading text-4xl font-medium leading-none tracking-[var(--if-heading-tracking)] text-text">
        {value}
      </p>
      <p className="flex items-center gap-2 text-xs text-text-muted">
        <span>{caption}</span>
        {href && (
          <UiLink
            href={href}
            aria-label={linkLabel ?? `${label}${typeof caption === 'string' ? `: ${caption}` : ''}`}
            className="inline-flex size-6 items-center justify-center rounded-sm text-text-muted no-underline after:absolute after:inset-0 hover:text-text"
          >
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </UiLink>
        )}
      </p>
    </div>
  );
}

/** Hairline-separated list for rows. */
export function RowList({ className, ...p }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cn('flex flex-col divide-y divide-border border-y border-border', className)} {...p} />
  );
}

export type RowAccent = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info';
const accentBar: Record<RowAccent, string> = {
  neutral: 'bg-border-strong',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
};
const tagText: Record<RowAccent, string> = {
  neutral: 'text-text-muted',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
};

/** A row with a thin coloured bar on the left, a small caption, a title, a subtitle, a tag and an arrow. */
export function ListRow({
  href,
  accent = 'neutral',
  caption,
  title,
  subtitle,
  tag,
  tagTone,
  className,
}: {
  href?: string;
  accent?: RowAccent;
  caption?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  tag?: ReactNode;
  tagTone?: RowAccent;
  className?: string;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn('my-1 w-0.5 shrink-0 self-stretch rounded-full', accentBar[accent])}
      />
      <span className="min-w-0 flex-1">
        {caption && <span className="block text-[11px] leading-4 text-text-muted">{caption}</span>}
        <span className="block text-base font-medium text-text">{title}</span>
        {subtitle && <span className="block text-xs text-text-muted">{subtitle}</span>}
      </span>
      {tag && <span className={cn('shrink-0 text-xs font-medium', tagText[tagTone ?? accent])}>{tag}</span>}
      {href && <ArrowRight className="size-4 shrink-0 text-text-muted" aria-hidden="true" />}
    </>
  );
  const cls = cn('flex min-h-[64px] items-center gap-4 px-1 py-3 text-text no-underline', className);
  return (
    <li>
      {href ? (
        <UiLink href={href} className={cn(cls, 'hover:bg-surface-alt')}>
          {body}
        </UiLink>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** One line of activity: a small round initial, the text and a muted "who · when" line. */
export function ActivityRow({
  who,
  text,
  meta,
  href,
}: {
  who: string;
  text: ReactNode;
  meta?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <Avatar name={who} className="mt-0.5 size-7 text-[10px]" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text">{text}</span>
        {meta && <span className="block text-xs text-text-muted">{meta}</span>}
      </span>
    </>
  );
  const cls = 'flex items-start gap-3 py-3 text-text no-underline';
  return (
    <li>
      {href ? (
        <UiLink href={href} className={cn(cls, 'hover:bg-surface-alt')}>
          {body}
        </UiLink>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
