import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OcrDocumentView } from '@/components/copilot/ocr-document';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Ingested contract – Intuitive Fusion' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getSessionUser();
  const canIngest = Boolean(user?.roles.some((r) => ['LEGAL', 'CONTRACT_MGR', 'PROCUREMENT'].includes(r)));
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/app/contracts/ingest">← Contract ingestion</Link>
      </p>
      <OcrDocumentView id={id} csrf={user!.csrfToken} canIngest={canIngest} />
    </div>
  );
}
