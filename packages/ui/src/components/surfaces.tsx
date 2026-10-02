'use client';
import * as RadixAccordion from '@radix-ui/react-accordion';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import * as RadixPopover from '@radix-ui/react-popover';
import { ChevronDown, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';

// ---------------- Drawer (mobile navigation) ----------------
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <RadixDialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] flex-col gap-2 border-r border-border bg-surface p-4 text-text shadow-lg"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <RadixDialog.Title className="font-heading text-lg font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close menu">
                <X className="size-5" aria-hidden="true" />
              </Button>
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

// ---------------- Popover ----------------
export function Popover({
  trigger,
  label,
  children,
  onOpenChange,
  align = 'end',
}: {
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <RadixPopover.Root onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={8}
          aria-label={label}
          className="z-50 w-[min(24rem,calc(100vw-24px))] rounded-md border border-border bg-surface p-2 text-text shadow-lg"
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

// ---------------- Dropdown menu ----------------
export interface MenuAction {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
}
export function Menu({
  trigger,
  header,
  actions,
}: {
  trigger: ReactNode;
  header?: ReactNode;
  actions: MenuAction[];
}) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 rounded-md border border-border bg-surface p-1 text-text shadow-lg"
        >
          {header && <div className="border-b border-border px-3 py-2 text-sm">{header}</div>}
          {actions.map((a) => (
            <RadixDropdown.Item
              key={a.label}
              onSelect={a.onSelect}
              className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-surface-alt"
            >
              {a.icon}
              {a.label}
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}

// ---------------- Accordion (FAQ) ----------------
export function Accordion({ items }: { items: Array<{ q: string; a: ReactNode }> }) {
  return (
    <RadixAccordion.Root
      type="single"
      collapsible
      className="divide-y divide-border rounded-md border border-border bg-surface"
    >
      {items.map((it, i) => (
        <RadixAccordion.Item key={it.q} value={`i${i}`}>
          <RadixAccordion.Header>
            <RadixAccordion.Trigger
              className={cn(
                'group flex min-h-[48px] w-full items-center justify-between gap-4 px-4 py-3 text-left font-semibold text-text',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
              )}
            >
              {it.q}
              <ChevronDown
                className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </RadixAccordion.Trigger>
          </RadixAccordion.Header>
          <RadixAccordion.Content className="px-4 pb-4 text-text-muted">{it.a}</RadixAccordion.Content>
        </RadixAccordion.Item>
      ))}
    </RadixAccordion.Root>
  );
}

// ---------------- Avatar (initials; decorative) ----------------
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg',
        className,
      )}
    >
      {initials}
    </span>
  );
}

// ---------------- KPI card ----------------
export function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-5 text-text shadow-sm">
      <div className="flex items-center justify-between text-sm font-semibold text-text-muted">
        <span>{label}</span>
        {icon}
      </div>
      <p className="break-words font-heading text-2xl font-bold">{value}</p>
      {hint && <p className="text-sm text-text-muted">{hint}</p>}
    </div>
  );
}
