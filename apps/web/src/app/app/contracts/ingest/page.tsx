import { Button, PageHeader } from '@if/ui';
import Link from 'next/link';
import { OcrIngestHome } from '@/components/copilot/ocr-ingest';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Contract ingestion – Intuitive Fusion' };

export default async function Page() {
  const user = await getSessionUser();
  const canIngest = Boolean(user?.roles.some((r) => ['LEGAL', 'CONTRACT_MGR', 'PROCUREMENT'].includes(r)));
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts">← Contracts</Link>
      </p>
      <PageHeader
        title="Contract ingestion"
        subtitle={
          <>
            Read existing contracts, extract the key dates, value, parties and clauses with a confidence for
            each, review what is uncertain, then create the contract record and its renewal, notice and expiry
            reminders.
          </>
        }
        actions={
          <nav aria-label="Ingestion" className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/contracts/ingest/report">Report across ingested contracts</Link>
            </Button>
          </nav>
        }
      />
      <OcrIngestHome csrf={user!.csrfToken} canIngest={canIngest} />
    </div>
  );
}
