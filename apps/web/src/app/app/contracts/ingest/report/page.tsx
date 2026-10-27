import { PageHeader } from '@if/ui';
import Link from 'next/link';
import { OcrReportView } from '@/components/copilot/ocr-report';

export const metadata = { title: 'Ingested contracts report – Intuitive Fusion' };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts/ingest">← Contract ingestion</Link>
      </p>
      <PageHeader
        title="Ingested contracts report"
        subtitle={
          <>
            Renewals due, notice windows, liability caps, missing clauses and concentration by supplier across
            the contracts read from documents.
          </>
        }
      />
      <OcrReportView />
    </div>
  );
}
