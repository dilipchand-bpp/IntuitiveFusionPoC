'use client';
import { Badge, Button, Card, KpiCard, Select, Table, Td, Th } from '@if/ui';
import type { HistBatch, HistRow } from './hist-types';

const TONE = {
  VALID: 'success',
  ERROR: 'error',
  DUPLICATE: 'warning',
  PENDING: 'neutral',
  LOADED: 'info',
  MERGED: 'info',
  SKIPPED: 'neutral',
} as const;
const LABEL = {
  VALID: 'Ready',
  ERROR: 'Error',
  DUPLICATE: 'Duplicate',
  PENDING: 'Not checked',
  LOADED: 'Loaded',
  MERGED: 'Merged',
  SKIPPED: 'Skipped',
} as const;

const keyOf = (b: HistBatch, r: HistRow) => {
  const first = Object.values(b.mapping).find(Boolean);
  const col = (Object.entries(b.mapping).find(([, h]) => h) ?? [])[1] ?? first;
  return col ? (r.raw[col] ?? '') : '';
};

/** Step 3: the dry run. Nothing has been loaded; this shows what a load would do and every row that has a problem. */
export function HistResults({
  batch,
  busy,
  onBack,
  onNext,
  onRule,
}: {
  batch: HistBatch;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
  onRule: (rule: 'SKIP' | 'MERGE') => void;
}) {
  const s = batch.summary!;
  return (
    <Card role="region" aria-labelledby="hist-s2" data-testid="hist-results">
      <h2 id="hist-s2" className="font-heading text-xl font-bold">
        3. Dry run
      </h2>
      <p className="mt-1 text-sm text-text-muted" role="status">
        Nothing has been loaded. This is what a load of {batch.filename} would do.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Rows" value={s.total} />
        <KpiCard label="Ready" value={s.valid} />
        <KpiCard label="Errors" value={s.errors} />
        <KpiCard label="Duplicates" value={s.duplicates} />
        <KpiCard label="With warnings" value={s.withWarnings} />
      </div>
      <ul className="mt-3 list-disc pl-5 text-sm text-text-muted">
        {s.suppliers.wouldCreate > 0 && (
          <li>
            {s.suppliers.wouldCreate} new supplier(s) would be created; {s.suppliers.linked} row(s) link to
            suppliers already on file.
          </li>
        )}
        {s.reminders && (
          <li>
            {s.reminders.contractsWithReminders} contract(s) would get key-date reminders;{' '}
            {s.reminders.endedOrTerminated} have ended and get none.
          </li>
        )}
        {s.spend && (
          <li>
            {s.spend.lines} spend line(s) totalling ${s.spend.total.toLocaleString('en-AU')} ({s.spend.from}{' '}
            to {s.spend.to}) would be added to spend reports.
          </li>
        )}
        {s.variants.length > 0 && (
          <li>
            {s.variants.length} group(s) of supplier names look like the same business, for example{' '}
            {s.variants[0]!.names.slice(0, 2).join(' and ')}.
          </li>
        )}
        {s.note && <li>{s.note}</li>}
        {Object.entries(s.errorsByRule).map(([rule, n]) => (
          <li key={rule}>
            <span className="font-mono text-xs">{rule}</span>: {n}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Duplicate rule
          <Select
            value={batch.duplicateRule}
            disabled={busy}
            onChange={(e) => onRule(e.target.value as 'SKIP' | 'MERGE')}
            aria-label="Duplicate rule"
          >
            <option value="SKIP">Skip duplicates</option>
            <option value="MERGE">Merge into records on file</option>
          </Select>
        </label>
        <Button asChild variant="secondary">
          <a href={`/api/v1/history-import/batches/${batch.id}/errors.csv`} data-testid="hist-error-report">
            Download the error report
          </a>
        </Button>
      </div>
      {batch.rows.length > 0 && (
        <Table
          caption={`Rows with problems (${batch.rowsTotal}${batch.rowsTotal > batch.rows.length ? `, first ${batch.rows.length} shown` : ''})`}
        >
          <thead>
            <tr>
              <Th>Row</Th>
              <Th>Key</Th>
              <Th>Status</Th>
              <Th>Problems</Th>
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((r) => (
              <tr key={r.rowNo} data-testid="hist-row" data-status={r.status}>
                <Td label="Row">{r.rowNo}</Td>
                <Td label="Key" className="font-mono text-xs">
                  {keyOf(batch, r)}
                </Td>
                <Td label="Status">
                  <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                </Td>
                <Td label="Problems" className="text-xs">
                  {r.issues.map((i, k) => (
                    <span key={k} className="block text-error">
                      <span className="font-mono">{i.rule}</span> {i.message}
                    </span>
                  ))}
                  {r.warnings.map((w, k) => (
                    <span key={k} className="block text-text-muted">
                      {w.message}
                    </span>
                  ))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onBack}>
          Change the mapping
        </Button>
        <Button disabled={s.wouldLoad === 0} onClick={onNext} data-testid="hist-to-load">
          Continue to load ({s.wouldLoad} row(s))
        </Button>
      </div>
    </Card>
  );
}
