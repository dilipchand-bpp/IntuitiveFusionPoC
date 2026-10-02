'use client';
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'icon';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-gradient shadow-md hover:-translate-y-0.5 hover:shadow-lg hover:brightness-110 active:translate-y-0',
  accent:
    'bg-brand-gradient shadow-md hover:-translate-y-0.5 hover:shadow-lg hover:brightness-110 active:translate-y-0',
  secondary: 'bg-surface text-text border border-border-strong shadow-sm hover:bg-surface-alt',
  ghost: 'bg-transparent text-text hover:bg-surface-alt',
  danger: 'bg-error text-surface hover:opacity-90',
};
const sizes: Record<ButtonSize, string> = {
  md: 'min-h-[44px] px-4 text-sm',
  lg: 'min-h-[48px] px-6 text-base',
  icon: 'min-h-[44px] min-w-[44px] p-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render as the child element (e.g. a Next.js Link) while keeping button styling. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    asChild = false,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      aria-busy={loading || undefined}
      disabled={asChild ? undefined : disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-all duration-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {children}
        </>
      )}
    </Comp>
  );
});
