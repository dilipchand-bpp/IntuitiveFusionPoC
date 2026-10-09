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
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Contract ingestion</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Read existing contracts, extract the key dates, value, parties and clauses with a confidence for
          each, review what is uncertain, then create the contract record and its renewal, notice and expiry
          reminders.
        </p>
        <nav aria-label="Ingestion" className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/app/contracts/ingest/report"
            className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold no-underline"
          >
            Report across ingested contracts
          </Link>
        </nav>
      </header>
      <OcrIngestHome csrf={user!.csrfToken} canIngest={canIngest} />
    </div>
  );
}
