import { UsagePanel } from '@/components/b11/usage-panel';

export const metadata = { title: 'Usage and plan – Intuitive Fusion' };

export default function Page() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Usage and plan</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          The usage plan this organisation is on, its limits, and how much has been used today. Each
          organisation has its own allowance, so heavy use elsewhere never slows yours.
        </p>
      </header>
      <UsagePanel />
    </div>
  );
}
