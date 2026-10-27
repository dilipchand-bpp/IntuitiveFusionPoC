import { PageHeader } from '@if/ui';
import { Dashboards } from '@/components/reports/b6-reports';

export const metadata = { title: 'Dashboards – Intuitive Fusion' };

export default async function Page() {
  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Dashboards"
        subtitle="A view for each role. What you see follows the organisation hierarchy unless the organisation chose broader visibility."
      />
      <Dashboards />
    </div>
  );
}
