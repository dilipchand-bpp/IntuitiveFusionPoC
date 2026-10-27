import { PageHeader } from '@if/ui';
import { TopologyPanel } from '@/components/b11/topology';

export const metadata = { title: 'Hosting topology – Intuitive Fusion' };

export default function Page() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Hosting topology"
        subtitle="Platform-hosted, customer cloud or hybrid: what flows where, who is responsible for what, and what it means for residency and keys. DESIGN ONLY: not built."
      />
      <TopologyPanel />
    </div>
  );
}
