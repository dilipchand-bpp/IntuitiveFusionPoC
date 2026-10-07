'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import type { ProcurementTable } from '@/components/reports/types';

interface CoverageItem {
  key: string;
  label: string;
  ask: string;
  status: 'PASS' | 'FAIL' | 'NA';
  detail: string;
}
interface Coverage {
  request: { number: string; title: string } | null;
  events: number;
  items: CoverageItem[];
  passed: number;
  failed: number;
  notApplicable: number;
  ready: boolean;
}
interface Verification {
  verified: boolean;
  failedParts: string[];
  files: Array<{ name: string; status: string }>;
  signature: { status: string; keyFingerprint: string | null };
  chain: {
    status: string;
    checked: number;
    gaps: number;
    brokenAtSeq: number | null;
    reason: string | null;
    headMatchesManifest: boolean;
  };
  live: { checked: number; mismatchedSeqs: number[] };
  manifest: { generatedAt: string | null; generatedBy: string | null; eventCount: number | null } | null;
  note: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const STATUS = {
  PASS: { tone: 'success', text: 'Pass' },
  FAIL: { tone: 'error', text: 'Fail' },
  NA: { tone: 'neutral', text: 'Not applicable' },
} as const;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The auditor evidence pack: what an external auditor would look for, the download, and a check of any pack (SEC-L07, NFR-R06). */
export function AuditPackPanel({ csrf }: { csrf: string }) {
  const procs = useData<ProcurementTable>('/reports/procurements');
  const [requestId, setRequestId] = useState('');
  const [from, setFrom] = useState(yearAgo());
  const [to, setTo] = useState(today());
  const cov = useData<Coverage>(requestId ? `/audit/export-pack/coverage?requestId=${requestId}` : null);
  const { busy, run, messages } = useRun();
  const [result, setResult] = useState<Verification | null>(null);
  const [text, setText] = useState('');

  async function download(format: 'JSON' | 'ZIP') {
    const res = await fetch('/api/v1/audit/export-pack', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ from, to, format, ...(requestId ? { requestId } : {}) }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const p = (await res.json().catch(() => null)) as { title?: string } | null;
      throw new Error(p?.title ?? 'The pack could not be made');
    }
    save(await res.blob(), `evidence-pack-${from}_${to}.${format === 'ZIP' ? 'zip' : 'json'}`);
  }
  async function verify(body: unknown) {
    setResult(await send<Verification>(csrf, 'POST', '/audit/export-pack/verify', body));
  }
  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.name.endsWith('.zip')) await verify({ zipBase64: toBase64(await file.arrayBuffer()) });
    else {
      const j = JSON.parse(await file.text()) as { files?: Record<string, string> };
      await verify({ bundle: { files: j.files ?? {} } });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card role="region" aria-labelledby="pack-h">
        <h2 id="pack-h" className="font-heading text-xl font-bold">
          Make a pack
        </h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          A pack holds the audit events for the period as a hash chain (each event with its hash), the probity
          records (declarations, allocations, witnesses, signed documents, deviations, approvals with an
          authority check, supplier communications, late-bid handling and holds), a manifest with a SHA-256
          for every file, and a signature. Choose one procurement to also get the checklist below.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Procurement">
            <Select value={requestId} onChange={(e) => setRequestId(e.target.value)}>
              <option value="">Whole organisation</option>
              {(procs.data?.items ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} {r.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            loading={busy === 'zip'}
            disabled={busy !== null}
            onClick={() => void run('zip', () => download('ZIP'))}
          >
            Download pack (zip)
          </Button>
          <Button
            variant="secondary"
            loading={busy === 'json'}
            disabled={busy !== null}
            onClick={() => void run('json', () => download('JSON'), 'Pack downloaded.')}
          >
            Download as one JSON file
          </Button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          SIMULATED signature: the manifest is signed with an HMAC using a secret held by the platform
          (audit.export.signing). That is a symmetric stand-in; a real deployment signs with an asymmetric key
          in a hardware security module so the auditor can verify with a public key alone.
        </p>
        {messages}
      </Card>

      {requestId && (
        <section aria-labelledby="cov-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="cov-h" className="font-heading text-xl font-bold">
              What an external auditor would look for
            </h2>
            {cov.data && (
              <Badge tone={cov.data.ready ? 'success' : 'warning'}>
                <span data-testid="coverage-summary">
                  {cov.data.passed} pass, {cov.data.failed} fail, {cov.data.notApplicable} not applicable
                </span>
              </Badge>
            )}
          </div>
          {cov.error && (
            <p role="alert" className="text-sm font-medium text-error">
              {cov.error}
            </p>
          )}
          {!cov.data && !cov.error && <p className="text-sm text-text-muted">Checking the records…</p>}
          {cov.data && (
            <Table caption="Coverage checklist">
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Result</Th>
                  <Th>What the records show</Th>
                </tr>
              </thead>
              <tbody>
                {cov.data.items.map((i) => (
                  <tr key={i.key} data-testid="coverage-row" data-key={i.key} data-status={i.status}>
                    <Td label="Item">
                      <strong>{i.label}</strong>
                      <span className="block text-xs text-text-muted">{i.ask}</span>
                    </Td>
                    <Td label="Result">
                      <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].text}</Badge>
                    </Td>
                    <Td label="Records">{i.detail}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}

      <Card role="region" aria-labelledby="verify-h">
        <h2 id="verify-h" className="font-heading text-xl font-bold">
          Check a pack
        </h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          Choose a pack you were given (the zip, or the single JSON file) or paste the JSON. Every file is
          compared with the manifest, the signature and every event hash are checked, and the events are
          compared with the platform&apos;s own record. If something was changed, the part that fails is
          named.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Pack file" hint="A .zip or .json file as downloaded from this page.">
            <Input
              type="file"
              accept=".zip,.json,application/zip,application/json"
              onChange={(e) => void run('verify-file', () => onFile(e.target.files?.[0]))}
            />
          </Field>
          <Field label="Or paste the JSON" hint="The whole downloaded JSON file.">
            <textarea
              className="min-h-[88px] w-full rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-xs text-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Pasted pack JSON"
            />
          </Field>
        </div>
        <Button
          className="mt-3"
          variant="secondary"
          loading={busy === 'verify-text'}
          disabled={text.trim() === '' || busy !== null}
          onClick={() =>
            void run('verify-text', async () => {
              try {
                const j = JSON.parse(text) as { files?: Record<string, string> };
                await verify({ bundle: { files: j.files ?? {} } });
              } catch (e) {
                throw e instanceof SyntaxError ? new Error('That is not valid JSON') : e;
              }
            })
          }
        >
          Check pasted pack
        </Button>
        {result && (
          <div
            className="mt-5 flex flex-col gap-3"
            data-testid="verify-result"
            data-verified={String(result.verified)}
            role="status"
          >
            <Badge tone={result.verified ? 'success' : 'error'}>
              {result.verified ? 'Verified: every check passed' : 'Not verified'}
            </Badge>
            {!result.verified && (
              <ul className="list-disc pl-6 text-sm font-medium text-error" data-testid="verify-failed">
                {result.failedParts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-muted">Signature (simulated)</dt>
                <dd>{result.signature.status.toLowerCase().replace('_', ' ')}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Hash chain</dt>
                <dd>
                  {result.chain.status.toLowerCase()}, {result.chain.checked} events
                  {result.chain.gaps
                    ? `, ${result.chain.gaps} gap(s) where other procurements were left out`
                    : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Compared with the platform&apos;s record</dt>
                <dd>
                  {result.live.checked} events, {result.live.mismatchedSeqs.length} differ
                </dd>
              </div>
              {result.manifest && (
                <div>
                  <dt className="text-xs text-text-muted">Generated</dt>
                  <dd>
                    {result.manifest.generatedAt?.slice(0, 16).replace('T', ' ')} UTC by{' '}
                    {result.manifest.generatedBy}
                  </dd>
                </div>
              )}
            </dl>
            <Table caption="Pack files">
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Against the manifest</Th>
                </tr>
              </thead>
              <tbody>
                {result.files.map((f) => (
                  <tr key={f.name}>
                    <Td label="File" className="font-mono text-xs">
                      {f.name}
                    </Td>
                    <Td label="Against the manifest">
                      <Badge tone={f.status === 'OK' ? 'success' : 'error'}>{f.status.toLowerCase()}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="text-xs text-text-muted">{result.note}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
