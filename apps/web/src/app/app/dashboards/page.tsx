import { Dashboards } from '@/components/reports/b6-reports';

export const metadata = { title: 'Dashboards – Intuitive Fusion' };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboards</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          A view for each role. What you see follows the organisation hierarchy unless the organisation chose
          broader visibility.
        </p>
      </header>
      <Dashboards />
    </div>
  );
}
