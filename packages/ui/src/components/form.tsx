'use client';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

const control =
  'w-full min-h-[44px] rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-text ' +
  'placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ' +
  'aria-[invalid=true]:border-error disabled:cursor-not-allowed disabled:opacity-60';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    required?: boolean;
  }>;
}

/** Wires label, hint and error to the control for screen readers (WCAG 1.3.1, 3.3.1, 3.3.2). */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-text">
        {label}
        {required && (
          <span aria-hidden="true" className="text-error">
            {' '}
            *
          </span>
        )}
      </label>
      {isValidElement(children) &&
        cloneElement(children, {
          id,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
          required,
        })}
      {hint && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...p },
  ref,
) {
  return <input ref={ref} className={cn(control, className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...p }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(control, className)} {...p} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...p },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, 'pr-8', className)} {...p}>
      {children}
    </select>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...p },
  ref,
) {
  return (
    <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-3 text-base text-text">
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'size-5 rounded-sm border border-border-strong accent-[var(--if-color-accent)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          className,
        )}
        {...p}
      />
      <span>{label}</span>
    </label>
  );
});
