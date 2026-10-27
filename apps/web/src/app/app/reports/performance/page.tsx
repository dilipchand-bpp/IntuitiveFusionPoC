import Link from 'next/link';
import { PageHeader } from '@if/ui';
import { SectionHeader } from '@if/ui';
import { Performance, SpendBy } from '@/components/reports/b6-reports';

export const metadata = { title: 'Performance – Intuitive Fusion' };

export default async function Page() {
  return (
    <div className="flex flex-col gap-12">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <PageHeader
        title="Spend and performance"
        subtitle="Category spend, maverick spend, captured savings and where procurement time goes, then spend by supplier, contract, master agreement, project, business unit or division."
      />
      <>
        <Performance />
        <section aria-labelledby="sb-h" className="flex flex-col gap-3">
          <SectionHeader id="sb-h" title="Spend by dimension" />
          <SpendBy />
        </section>
      </>
    </div>
  );
}
