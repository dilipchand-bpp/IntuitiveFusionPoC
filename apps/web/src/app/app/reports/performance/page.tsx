import Link from 'next/link';
import { Performance, SpendBy } from '@/components/reports/b6-reports';

export const metadata = { title: 'Performance – Intuitive Fusion' };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/reports">← Reports</Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Spend and performance</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Category spend, maverick spend, captured savings and where procurement time goes, then spend by
          supplier, contract, master agreement, project, business unit or division.
        </p>
      </header>
      <>
        <Performance />
        <section aria-labelledby="sb-h" className="flex flex-col gap-3">
          <h2 id="sb-h" className="font-heading text-xl font-bold">
            Spend by dimension
          </h2>
          <SpendBy />
        </section>
      </>
    </div>
  );
}
