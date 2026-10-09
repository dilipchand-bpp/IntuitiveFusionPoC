'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AiBadge, Badge, Button, Card, EmptyState, Table, Td, Th, type BadgeTone } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import { ApiError } from '@/lib/api-client';
import type { OcrBatch, OcrBatchRow, OcrSample } from './ocr-types';

const toBase64 = (buf: ArrayBuffer) => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

export const DOC_TONE: Record<string, BadgeTone> = {
  NEEDS_REVIEW: 'warning',
  READY: 'success',
  COMMITTED: 'info',
  REJECTED: 'neutral',
  FAILED: 'error',
};
export const DOC_LABEL: Record<string, string> = {
  NEEDS_REVIEW: 'Needs review',
  READY: 'Ready to commit',
  COMMITTED: 'Committed',
  REJECTED: 'Rejected',
  FAILED: 'Could not be read',
};

/** The ingestion home: upload (files or a zip), try a synthetic sample, the batch list and the documents of the open batch (CP-07). */
export function OcrIngestHome({ csrf, canIngest }: { csrf: string; canIngest: boolean }) {
  const batches = useData<{ items: OcrBatchRow[] }>('/contract-ingest/batches');
  const samples = useData<{ samples: OcrSample[] }>('/contract-ingest/samples');
  const [open, setOpen] = useState<string | null>(null);
  const detail = useData<OcrBatch>(open ? `/contract-ingest/batches/${open}` : null);
  const input = useRef<HTMLInputElement>(null);
  const { busy, run, messages } = useRun();

  async function upload() {
    const files = Array.from(input.current?.files ?? []);
    if (!files.length)
      throw new ApiError({ status: 400, code: 'NO_FILE', title: 'Choose at least one file' });
    const body = {
      files: await Promise.all(
        files.map(async (f) => ({ name: f.name, contentBase64: toBase64(await f.arrayBuffer()) })),
      ),
    };
    const b = await send<OcrBatch>(csrf, 'POST', '/contract-ingest/uploads', body);
    setOpen(b.id);
    if (input.current) input.current.value = '';
    await batches.reload();
  }
  async function trySample(key: string) {
    const b = await send<OcrBatch>(csrf, 'POST', '/contract-ingest/samples', { keys: [key] });
    setOpen(b.id);
    await batches.reload();
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {canIngest && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-xl font-bold">Upload contracts</h2>
            <AiBadge kind="simulated" />
          </div>
          <p className="mt-2 max-w-prose text-sm text-text-muted">
            PDF, PNG, JPG or TIFF, or a zip of them. A PDF with a text layer is read for real. Images and
            scanned PDFs go through a <strong>SIMULATED</strong> recognition engine that reads synthetic
            sample files only. Every file is scanned for malware first.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run('upload', upload, 'Uploaded and read.');
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Files
              <input
                ref={input}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.zip,.json,application/pdf,image/*,application/zip"
                data-testid="ocr-file"
                className="min-h-[44px] max-w-full rounded-md border border-border-strong bg-surface p-2 text-sm"
              />
            </label>
            <Button type="submit" loading={busy === 'upload'} data-testid="ocr-upload">
              Upload and read
            </Button>
          </form>
          {messages}
          {samples.data && (
            <div className="mt-4">
              <h3 className="text-sm font-bold">Or try a synthetic sample</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {samples.data.samples.map((s) => (
                  <li
                    key={s.key}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                  >
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-xs text-text-muted">{s.description}</p>
                    <div className="flex items-center gap-2">
                      <Badge tone={s.simulated ? 'warning' : 'info'}>
                        {s.simulated ? 'SIMULATED recognition' : 'Text layer'}
                      </Badge>
                      <Button
                        variant="secondary"
                        size="md"
                        loading={busy === `s-${s.key}`}
                        onClick={() => void run(`s-${s.key}`, () => trySample(s.key))}
                        data-testid={`ocr-sample-${s.key}`}
                      >
                        Read this sample
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <section aria-labelledby="ocr-batches" className="flex flex-col gap-3">
        <h2 id="ocr-batches" className="font-heading text-xl font-bold">
          Batches
        </h2>
        {!batches.data ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : batches.data.items.length === 0 ? (
          <EmptyState title="Nothing ingested yet" body="Upload a contract or read a sample to begin." />
        ) : (
          <Table caption="Ingest batches">
            <thead>
              <tr>
                <Th>Uploaded</Th>
                <Th>Source</Th>
                <Th>Documents</Th>
                <Th>Needs review</Th>
                <Th>Ready</Th>
                <Th>Committed</Th>
                <Th>
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {batches.data.items.map((b) => (
                <tr key={b.id} data-testid="ocr-batch">
                  <Td>{new Date(b.createdAt).toLocaleString('en-AU')}</Td>
                  <Td>
                    {b.origin === 'SAMPLE' ? 'Sample' : 'Upload'}
                    {b.skipped ? `, ${b.skipped} skipped` : ''}
                  </Td>
                  <Td>{b.documents}</Td>
                  <Td>{b.needsReview}</Td>
                  <Td>{b.ready}</Td>
                  <Td>{b.committed}</Td>
                  <Td>
                    <Button
                      variant="secondary"
                      onClick={() => setOpen(b.id === open ? null : b.id)}
                      aria-expanded={b.id === open}
                    >
                      {b.id === open ? 'Hide' : 'Documents'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {open && detail.data && (
        <section aria-labelledby="ocr-docs" className="flex flex-col gap-3" data-testid="ocr-batch-detail">
          <h2 id="ocr-docs" className="font-heading text-xl font-bold">
            Documents in this batch
          </h2>
          {detail.data.skipped.length > 0 && (
            <p className="text-sm text-text-muted">
              Skipped: {detail.data.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}
            </p>
          )}
          <ul className="grid gap-3">
            {detail.data.documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm"
                data-testid="ocr-doc"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading text-lg font-semibold">{d.title ?? d.fileName}</p>
                  <Badge tone={DOC_TONE[d.status] ?? 'neutral'}>{DOC_LABEL[d.status] ?? d.status}</Badge>
                  <Badge tone={d.simulated ? 'warning' : 'info'}>{d.label}</Badge>
                  {d.duplicateOf && <Badge tone="warning">Same file seen before</Badge>}
                </div>
                <p className="text-sm text-text-muted">
                  {d.entryPath ?? d.fileName} · {d.pageCount} page{d.pageCount === 1 ? '' : 's'}
                  {d.ocrConfidence !== null ? ` · page confidence ${Math.round(d.ocrConfidence * 100)}%` : ''}
                  {d.supplier ? ` · ${d.supplier}` : ''}
                  {d.endDate ? ` · ends ${d.endDate}` : ''}
                </p>
                {d.failure && <p className="text-sm text-error">{d.failure}</p>}
                {!d.failure && (
                  <p className="text-sm">
                    {d.needsReview} field{d.needsReview === 1 ? '' : 's'} to review · {d.missingMandatory}{' '}
                    mandatory clause
                    {d.missingMandatory === 1 ? '' : 's'} missing · {d.findings.HIGH} high,{' '}
                    {d.findings.MEDIUM} medium findings
                  </p>
                )}
                <div>
                  <Link
                    href={`/app/contracts/ingest/documents/${d.id}`}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-border-strong px-4 text-sm font-semibold no-underline"
                  >
                    Open document
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
