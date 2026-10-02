'use client';
import * as RadixDialog from '@radix-ui/react-dialog';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';

// ---------------- Dialog ----------------
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

/** Modal dialog on Radix: focus trap, Escape to close, focus return, aria labelling handled by the primitive. */
export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  // The dialog is controlled (no Radix Trigger), so remember what opened it and give focus back on close.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <RadixDialog.Content
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2',
            'rounded-md border border-border bg-surface p-6 text-text shadow-lg',
          )}
        >
          <RadixDialog.Title className="font-heading text-xl font-semibold">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-text-muted">
              {description}
            </RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
          <RadixDialog.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close dialog" className="absolute right-3 top-3">
              <X className="size-5" aria-hidden="true" />
            </Button>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

// ---------------- Toast ----------------
export type ToastTone = 'success' | 'info' | 'warning' | 'error';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}
const ToastCtx = createContext<{ toast: (t: Omit<ToastItem, 'id'>) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const toneStyle: Record<ToastTone, { cls: string; Icon: typeof Info }> = {
  success: { cls: 'bg-success-bg text-success border-success', Icon: CheckCircle2 },
  info: { cls: 'bg-info-bg text-info border-info', Icon: Info },
  warning: { cls: 'bg-warning-bg text-warning border-warning', Icon: TriangleAlert },
  error: { cls: 'bg-error-bg text-error border-error', Icon: XCircle },
};

/** Polite live region so assistive tech announces toasts (errors use role=alert). Auto-dismiss after 6 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++seq.current;
    setItems((x) => [...x, { ...t, id }]);
  }, []);
  const dismiss = (id: number) => setItems((x) => x.filter((i) => i.id !== id));
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-32px)] max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {items.map((i) => (
          <ToastView key={i.id} item={i} onDismiss={() => dismiss(i.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const { cls, Icon } = toneStyle[item.tone];
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-4 shadow-md', cls)}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">{item.title}</p>
        {item.body && <p className="text-sm">{item.body}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="min-h-[44px] min-w-[44px] -m-2 p-2"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
