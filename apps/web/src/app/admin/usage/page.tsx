import { PageHeader } from '@if/ui';
import { UsagePanel } from '@/components/b11/usage-panel';

export const metadata = { title: 'Usage and plan – Intuitive Fusion' };

export default function Page() {
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <PageHeader
        title="Usage and plan"
        subtitle="The usage plan this organisation is on, its limits, and how much has been used today. Each organisation has its own allowance, so heavy use elsewhere never slows yours."
      />
      <UsagePanel />
    </div>
  );
}
