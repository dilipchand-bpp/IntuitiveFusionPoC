'use client';
import { useState } from 'react';
import { Badge, Card, Field, Select, Table, Td, Th } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';

interface TenderRow {
  id: string;
  title?: string;
  requestTitle?: string;
  status?: string;
}
interface Box {
  tenderId: string;
  status: string;
  dualWitness: boolean;
  opened: boolean;
  seal: { readable: boolean; code?: string; reason?: string };
  bidCount: number;
  bids: Array<{
    submissionId: string;
    bidder: string | null;
    status: string;
    submittedAt: string | null;
    files: Array<{
      id: string;
      name: string | null;
      section: string | null;
      sizeBytes: number;
      sha256: string | null;
      uploadedAt: string;
      encrypted: boolean;
      keyVersion: number | null;
    }>;
    answers: { count: number; encrypted: number; sizeBytes: number };
  }>;
  note: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

function Bids({ id }: { id: string }) {
  const { data, error } = useData<Box>(`/tenders/${id}/bid-box`);
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={data.seal.readable ? 'success' : 'warning'}>
          <span data-testid="bid-seal">{data.seal.readable ? 'Open' : 'Sealed'}</span>
        </Badge>
        <span className="text-sm text-text-muted">
          {data.bidCount} bid{data.bidCount === 1 ? '' : 's'} · tender {data.status.toLowerCase()}
          {data.dualWitness ? ' · two witnesses required' : ''}
        </span>
      </div>
      <p className="mt-3 max-w-prose text-sm text-text-muted" data-testid="bid-note">
        {data.seal.readable ? data.note : (data.seal.reason ?? data.note)}
      </p>
      {data.bids.length > 0 && (
        <div className="mt-4">
          <Table caption="Bids">
            <thead>
              <tr>
                <Th>Bidder</Th>
                <Th>Submitted</Th>
                <Th>Files</Th>
                <Th>Answers</Th>
              </tr>
            </thead>
            <tbody>
              {data.bids.map((b) => (
                <tr key={b.submissionId} data-testid="bid-row">
                  <Td label="Bidder">{b.bidder ?? 'Hidden until open'}</Td>
                  <Td label="Submitted">{b.submittedAt ? when(b.submittedAt) : 'draft'}</Td>
                  <Td label="Files">
                    <ul className="text-sm">
                      {b.files.map((f) => (
                        <li key={f.id}>
                          {f.name ?? 'Encrypted file'} · {f.sizeBytes} bytes ·{' '}
                          {f.encrypted ? `encrypted (key v${f.keyVersion})` : 'server-key sealed'}
                          <div className="text-xs text-text-muted">
                            <code>{f.sha256?.slice(0, 16)}</code> · {when(f.uploadedAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td label="Answers">
                    {b.answers.count} ({b.answers.encrypted} encrypted)
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/** Sealed bids: metadata only until the tender closes and, for a high-value tender, is opened by two witnesses (SEC-D03, SEC-D04). */
export function BidBoxPanel(_props: { csrf: string; roles: readonly string[] }) {
  const tenders = useData<TenderRow[] | { items: TenderRow[] }>('/tenders');
  const [id, setId] = useState('');
  const rows = Array.isArray(tenders.data) ? tenders.data : (tenders.data?.items ?? []);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <Field label="Tender">
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose a tender</option>
            {rows.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title ?? t.requestTitle ?? t.id}
                {t.status ? ` (${t.status.toLowerCase()})` : ''}
              </option>
            ))}
          </Select>
        </Field>
      </Card>
      {id && <Bids id={id} />}
    </div>
  );
}
