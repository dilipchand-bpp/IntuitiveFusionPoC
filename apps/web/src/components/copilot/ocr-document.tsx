'use client';
import { Fragment, useMemo, useState } from 'react';
import { AiBadge, Badge, Button, Card, Input, Select, Table, Td, Th, type BadgeTone } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';
import { DOC_LABEL, DOC_TONE } from './ocr-ingest';
import type { OcrClause, OcrCommitResult, OcrDocument, OcrField, OcrFinding, OcrSpan } from './ocr-types';

const pct = (n: number) => `${Math.round(n * 100)}%`;
export const confTone = (n: number, threshold: number): BadgeTone =>
  n >= threshold ? 'success' : n >= threshold - 0.15 ? 'warning' : 'error';
const SEV: Record<string, BadgeTone> = { HIGH: 'error', MEDIUM: 'warning', LOW: 'info', INFO: 'neutral' };
const MATCH_LABEL = {
  STANDARD: 'Matches standard wording',
  MINOR_DEVIATION: 'Minor deviation',
  MATERIAL_DEVIATION: 'Material deviation',
} as const;

/** Scalar fields a reviewer can type a corrected value for; presence fields use a select. */
const TEXT_FIELDS = new Set([
  'title',
  'contractNumber',
  'customer',
  'supplier',
  'supplierAbn',
  'effectiveDate',
  'endDate',
  'termMonths',
  'noticeDays',
  'paymentTerms',
  'value',
  'governingLaw',
  'dataLocation',
]);
const PRESENCE_FIELDS = new Set(['indemnity', 'terminationConvenience', 'confidentiality']);
const HINT: Record<string, string> = {
  effectiveDate: 'e.g. 2026-07-01',
  endDate: 'e.g. 2027-06-30',
  value: 'e.g. AUD 1,250,000',
  supplierAbn: '11 digits',
  termMonths: 'months',
  noticeDays: 'days',
  paymentTerms: 'days',
};

interface Mark {
  start: number;
  end: number;
  kind: 'field' | 'clause';
  id: string;
}

/** The page text with the spans of fields and clauses marked; the selected one is stronger. Marks never overlap (the first wins). */
function PageText({
  text,
  page,
  doc,
  selected,
  onSelect,
}: {
  text: string;
  page: number;
  doc: OcrDocument;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const marks = useMemo(() => {
    const fieldMarks: Mark[] = [];
    const add = (list: Mark[], s: OcrSpan | null | undefined, kind: Mark['kind'], id: string) => {
      if (s && s.page === page && s.end > s.start) list.push({ start: s.start, end: s.end, kind, id });
    };
    for (const f of doc.fields) {
      add(fieldMarks, f.source, 'field', `f:${f.key}`);
      for (const x of f.extraSources ?? []) add(fieldMarks, x, 'field', `f:${f.key}`);
    }
    fieldMarks.sort((a, b) => a.start - b.start || a.end - b.end);
    // fields do not overlap one another (the first wins); a clause is marked only around the fields inside it
    const fields: Mark[] = [];
    let at = 0;
    for (const m of fieldMarks)
      if (m.start >= at) {
        fields.push(m);
        at = m.end;
      }
    const clauseMarks: Mark[] = [];
    for (const c of doc.clauses) {
      const raw: Mark[] = [];
      add(raw, c.source, 'clause', `c:${c.key}`);
      for (const r of raw) {
        let from = r.start;
        for (const f of fields) {
          if (f.end <= from || f.start >= r.end) continue;
          if (f.start > from) clauseMarks.push({ ...r, start: from, end: f.start });
          from = Math.max(from, f.end);
        }
        if (from < r.end) clauseMarks.push({ ...r, start: from });
      }
    }
    const all = [...fields, ...clauseMarks].sort((a, b) => a.start - b.start || a.end - b.end);
    const out: Mark[] = [];
    let end = 0;
    for (const m of all)
      if (m.start >= end) {
        out.push(m);
        end = m.end;
      }
    return out;
  }, [doc, page]);
  const parts: Array<{ t: string; m?: Mark }> = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) parts.push({ t: text.slice(at, m.start) });
    parts.push({ t: text.slice(m.start, m.end), m });
    at = m.end;
  }
  parts.push({ t: text.slice(at) });
  return (
    <pre
      className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-alt p-3 text-sm leading-relaxed"
      data-testid="ocr-page-text"
      tabIndex={0}
    >
      {parts.map((p, i) =>
        p.m ? (
          <mark
            key={i}
            onClick={() => onSelect(p.m!.id)}
            className={`cursor-pointer rounded px-0.5 text-text ${selected === p.m.id ? 'bg-warning-bg outline outline-2 outline-accent' : p.m.kind === 'field' ? 'bg-info-bg' : 'bg-success-bg'}`}
            data-mark={p.m.id}
          >
            {p.t}
          </mark>
        ) : (
          <Fragment key={i}>{p.t}</Fragment>
        ),
      )}
    </pre>
  );
}

function FieldRow({
  f,
  doc,
  edits,
  setEdit,
  selected,
  onSelect,
  editable,
}: {
  f: OcrField;
  doc: OcrDocument;
  edits: Record<string, string>;
  setEdit: (k: string, v: string) => void;
  selected: boolean;
  onSelect: () => void;
  editable: boolean;
}) {
  const t = doc.reviewThreshold;
  return (
    <tr
      className={selected ? 'bg-warning-bg' : undefined}
      data-testid={`ocr-field-${f.key}`}
      data-needs-review={f.needsReview}
    >
      <Td>
        <button
          type="button"
          onClick={onSelect}
          className="text-left font-semibold underline-offset-2 hover:underline"
        >
          {f.label}
        </button>
        {f.required && <span className="ml-1 text-xs text-text-muted">(required)</span>}
      </Td>
      <Td>
        {f.status === 'NOT_FOUND' ? (
          <span className="text-text-muted">Not found</span>
        ) : (
          <span>{f.display}</span>
        )}
        {f.note && <p className="text-xs text-text-muted">{f.note}</p>}
        {f.source && (
          <p className="text-xs text-text-muted">
            page {f.source.page}, characters {f.source.start} to {f.source.end}
          </p>
        )}
      </Td>
      <Td>
        {f.status === 'NOT_FOUND' ? (
          <Badge tone={f.required ? 'error' : 'neutral'}>{f.required ? 'Missing' : 'None'}</Badge>
        ) : (
          <Badge tone={f.status === 'CORRECTED' ? 'info' : confTone(f.confidence, t)}>
            {f.status === 'CORRECTED' ? 'Corrected' : pct(f.confidence)}
          </Badge>
        )}
        {f.needsReview && <p className="mt-1 text-xs font-semibold text-warning">Review needed</p>}
        {f.reviewed && f.status !== 'CORRECTED' && <p className="mt-1 text-xs text-text-muted">Accepted</p>}
      </Td>
      <Td>
        {editable && TEXT_FIELDS.has(f.key) && (
          <Input
            aria-label={`Correct ${f.label}`}
            placeholder={HINT[f.key] ?? 'Correct value'}
            value={edits[f.key] ?? ''}
            onChange={(e) => setEdit(f.key, e.target.value)}
            data-testid={`ocr-edit-${f.key}`}
          />
        )}
        {editable && PRESENCE_FIELDS.has(f.key) && (
          <Select
            aria-label={`Correct ${f.label}`}
            value={edits[f.key] ?? ''}
            onChange={(e) => setEdit(f.key, e.target.value)}
          >
            <option value="">Leave as read</option>
            <option value="yes">Present</option>
            <option value="no">Not in this contract</option>
          </Select>
        )}
      </Td>
    </tr>
  );
}

function ClauseRow({ c, selected, onSelect }: { c: OcrClause; selected: boolean; onSelect: () => void }) {
  return (
    <tr className={selected ? 'bg-warning-bg' : undefined} data-testid={`ocr-clause-${c.key}`}>
      <Td>
        <button
          type="button"
          onClick={onSelect}
          className="text-left font-semibold underline-offset-2 hover:underline"
          disabled={!c.found}
        >
          {c.title}
        </button>
        {c.mandatory && <span className="ml-1 text-xs text-text-muted">(mandatory)</span>}
      </Td>
      <Td>
        {c.found ? (
          <>
            <Badge
              tone={c.match === 'STANDARD' ? 'success' : c.match === 'MINOR_DEVIATION' ? 'warning' : 'error'}
            >
              {c.match ? MATCH_LABEL[c.match] : ''}
            </Badge>
            <p className="mt-1 text-xs text-text-muted">
              similarity {pct(c.similarity ?? 0)} · confidence {pct(c.confidence)}
            </p>
          </>
        ) : (
          <Badge tone={c.mandatory ? 'error' : 'neutral'}>
            {c.mandatory ? 'Missing (mandatory)' : 'Not found'}
          </Badge>
        )}
      </Td>
      <Td>
        {c.found && (
          <span className="text-xs text-text-muted">
            {(c.text ?? '').slice(0, 160)}
            {(c.text ?? '').length > 160 ? '…' : ''}
          </span>
        )}
      </Td>
    </tr>
  );
}

/** One ingested document: page text with its extracted fields and clauses marked, review and corrections, findings, commit (CP-07). */
export function OcrDocumentView({ id, csrf, canIngest }: { id: string; csrf: string; canIngest: boolean }) {
  const { data: doc, error, reload } = useData<OcrDocument>(`/contract-ingest/documents/${id}`);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<OcrCommitResult | null>(null);
  const { busy, run, messages } = useRun();

  if (error && !doc)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!doc) return <p className="text-sm text-text-muted">Loading the document…</p>;
  const editable = canIngest && (doc.status === 'NEEDS_REVIEW' || doc.status === 'READY');
  const flagged = doc.fields.filter((f) => f.needsReview);
  const pageData = doc.pages.find((p) => p.page === page) ?? doc.pages[0];
  const select = (sel: string) => {
    setSelected(sel);
    const f = doc.fields.find((x) => `f:${x.key}` === sel);
    const c = doc.clauses.find((x) => `c:${x.key}` === sel);
    const p = f?.source?.page ?? c?.source?.page;
    if (p) setPage(p);
  };

  const corrections = () =>
    Object.entries(edits)
      .filter(([, v]) => v.trim() !== '')
      .map(([key, v]) => {
        const presence = PRESENCE_FIELDS.has(key);
        return {
          key,
          value: presence ? (v === 'yes' ? true : null) : v.trim(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        };
      });
  const review = (accept: boolean) =>
    run(
      accept ? 'accept' : 'correct',
      async () => {
        await send<OcrDocument>(csrf, 'POST', `/contract-ingest/documents/${id}/review`, {
          corrections: corrections(),
          ...(accept ? { accept: true } : {}),
        });
        setEdits({});
        await reload();
      },
      accept
        ? 'Reviewed: corrections saved and the remaining flagged values accepted.'
        : 'Corrections saved.',
    );
  const commit = (body: Record<string, unknown>) =>
    run('commit', async () => {
      const r = await send<OcrCommitResult>(csrf, 'POST', `/contract-ingest/documents/${id}/commit`, body);
      setResult(r);
      await reload();
    });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-xl font-bold">{doc.title ?? doc.fileName}</h2>
          <Badge tone={DOC_TONE[doc.status] ?? 'neutral'}>{DOC_LABEL[doc.status] ?? doc.status}</Badge>
          {doc.simulated && <AiBadge kind="simulated" />}
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {doc.entryPath ?? doc.fileName} · {doc.pageCount} page{doc.pageCount === 1 ? '' : 's'} ·{' '}
          {doc.engineLabel}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Review threshold {pct(doc.reviewThreshold)}: fields read with less confidence must be reviewed
          before the contract record is created.
        </p>
        {doc.failure && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {doc.failure}
          </p>
        )}
        {doc.duplicateOf && (
          <p className="mt-2 text-sm font-medium text-warning">
            The same file was ingested before. Committing it again needs a decision.
          </p>
        )}
      </Card>

      {!doc.failure && (
        <>
          <div className="grid min-w-0 gap-6 lg:grid-cols-2">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-heading text-lg font-bold">Page text</h3>
                {doc.pages.length > 1 && (
                  <div className="flex gap-1" role="group" aria-label="Page">
                    {doc.pages.map((p) => (
                      <Button
                        key={p.page}
                        variant={p.page === page ? 'primary' : 'secondary'}
                        onClick={() => setPage(p.page)}
                        aria-pressed={p.page === page}
                      >
                        {p.page}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Page {pageData?.page} read at {pct(pageData?.confidence ?? 0)}. Blue marks are extracted
                fields, green marks are clauses; select a row to jump to its source.
              </p>
              <div className="mt-2">
                {pageData && (
                  <PageText
                    text={pageData.text}
                    page={pageData.page}
                    doc={doc}
                    selected={selected}
                    onSelect={select}
                  />
                )}
              </div>
            </Card>

            <Card>
              <h3 className="font-heading text-lg font-bold">Extracted fields</h3>
              <p className="mt-1 text-xs text-text-muted">
                {flagged.length} to review. Corrections are kept with the value before and after.
              </p>
              <div className="mt-2 overflow-x-auto">
                <Table caption="Extracted fields">
                  <thead>
                    <tr>
                      <Th>Field</Th>
                      <Th>Value and source</Th>
                      <Th>Confidence</Th>
                      <Th>{editable ? 'Correct' : ''}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.fields.map((f) => (
                      <FieldRow
                        key={f.key}
                        f={f}
                        doc={doc}
                        edits={edits}
                        setEdit={(k, v) => setEdits((e) => ({ ...e, [k]: v }))}
                        selected={selected === `f:${f.key}`}
                        onSelect={() => select(`f:${f.key}`)}
                        editable={editable}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
              {editable && (
                <div className="mt-3 flex flex-col gap-2">
                  <Input
                    aria-label="Reason for the correction"
                    placeholder="Reason (optional)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      loading={busy === 'correct'}
                      onClick={() => void review(false)}
                      disabled={Object.values(edits).every((v) => !v.trim())}
                      data-testid="ocr-save-corrections"
                    >
                      Save corrections
                    </Button>
                    <Button
                      loading={busy === 'accept'}
                      onClick={() => void review(true)}
                      data-testid="ocr-accept"
                    >
                      Save corrections and accept the rest as read
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <h3 className="font-heading text-lg font-bold">Clauses against the library</h3>
            <div className="mt-2 overflow-x-auto">
              <Table caption="Clauses">
                <thead>
                  <tr>
                    <Th>Clause</Th>
                    <Th>Result</Th>
                    <Th>Wording found</Th>
                  </tr>
                </thead>
                <tbody>
                  {doc.clauses.map((c) => (
                    <ClauseRow
                      key={c.key}
                      c={c}
                      selected={selected === `c:${c.key}`}
                      onSelect={() => select(`c:${c.key}`)}
                    />
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>

          <Card>
            <h3 className="font-heading text-lg font-bold">Findings</h3>
            {doc.findings.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">Nothing to flag.</p>
            ) : (
              <ul className="mt-2 grid gap-2" data-testid="ocr-findings">
                {doc.findings.map((f: OcrFinding, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={SEV[f.severity] ?? 'neutral'}>{f.severity}</Badge>
                    <span>{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {doc.corrections.length > 0 && (
            <Card>
              <h3 className="font-heading text-lg font-bold">Corrections made</h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {doc.corrections.map((c) => (
                  <li key={c.id}>
                    {c.fieldKey}: {c.before?.display || 'not found'} → {c.after?.display || 'none'}
                    {c.reason ? ` (${c.reason})` : ''}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h3 className="font-heading text-lg font-bold">Commit to the contract register</h3>
            {doc.status === 'COMMITTED' ? (
              <p className="mt-2 text-sm" data-testid="ocr-committed">
                Committed.{' '}
                {doc.contractId && (
                  <a href={`/app/contracts/${doc.contractId}`} data-testid="ocr-contract-link">
                    Open the contract record
                  </a>
                )}
                {doc.commitSummary &&
                  Array.isArray((doc.commitSummary as { reminders?: unknown[] }).reminders) && (
                    <span>
                      {' '}
                      {(doc.commitSummary as { reminders: unknown[] }).reminders.length} reminders scheduled.
                    </span>
                  )}
              </p>
            ) : (
              <>
                {doc.matches && (
                  <div className="mt-2 text-sm">
                    <p>
                      Supplier:{' '}
                      {doc.matches.supplier.match
                        ? `${doc.matches.supplier.match.company} (matched by ${doc.matches.supplier.match.by})`
                        : doc.matches.supplier.similar.length
                          ? `no exact match; similar: ${doc.matches.supplier.similar.map((s) => s.company).join(', ')}`
                          : 'a new supplier will be created'}
                    </p>
                    {doc.matches.contracts.length > 0 && (
                      <p className="text-warning">
                        Possible duplicates:{' '}
                        {doc.matches.contracts.map((c) => `${c.number} (${c.reason})`).join('; ')}
                      </p>
                    )}
                  </div>
                )}
                {editable && flagged.length > 0 && (
                  <p className="mt-2 text-sm font-medium text-warning">
                    Review the {flagged.length} flagged field(s) first; the commit is refused until then.
                  </p>
                )}
                {editable && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      loading={busy === 'commit'}
                      onClick={() => void commit({})}
                      data-testid="ocr-commit"
                    >
                      Commit: create the contract and reminders
                    </Button>
                    {doc.matches?.contracts[0] && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void commit({ mode: 'LINK', contractId: doc.matches!.contracts[0]!.id })
                        }
                      >
                        Link to {doc.matches.contracts[0].number}
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      onClick={() =>
                        void run('reject', async () => {
                          await send(csrf, 'POST', `/contract-ingest/documents/${id}/reject`, {
                            reason: 'Rejected by the reviewer',
                          });
                          await reload();
                        })
                      }
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </>
            )}
            {messages}
            {result && (
              <p
                role="status"
                className="mt-2 text-sm font-medium text-success"
                data-testid="ocr-commit-result"
              >
                {result.mode === 'LINK'
                  ? `Linked to ${result.contractNumber}.`
                  : `Created ${result.contractNumber} for ${result.supplier.company}${result.supplier.created ? ' (new supplier)' : ''} with ${result.reminders?.length ?? 0} reminders.`}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
