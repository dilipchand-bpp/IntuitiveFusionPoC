'use client';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, Field, Input, Table, Td, Th } from '@if/ui';
import type { HistBatch, HistBatchListItem } from './hist-types';

const TONE = {
  UPLOADED: 'neutral',
  MAPPED: 'info',
  DRY_RUN: 'info',
  COMMITTED: 'success',
  ROLLED_BACK: 'warning',
} as const;
const LABEL = {
  UPLOADED: 'Uploaded',
  MAPPED: 'Mapped',
  DRY_RUN: 'Checked',
  COMMITTED: 'Loaded',
  ROLLED_BACK: 'Rolled back',
} as const;

/** Step 5: every batch, what it loaded, and a rollback while what it created is untouched. */
export function HistHistory({
  batches,
  selected,
  canLoad,
  busy,
  onOpen,
  onNew,
  onRollback,
}: {
  batches: HistBatchListItem[];
  selected: HistBatch | null;
  canLoad: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRollback: (id: string, reason: string) => void;
}) {
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Card role="region" aria-labelledby="hist-s4" data-testid="hist-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hist-s4" className="font-heading text-xl font-bold">
          History
        </h2>
        <Button onClick={onNew} data-testid="hist-new">
          Start another import
        </Button>
      </div>
      {batches.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No imports yet.</p>
      ) : (
        <Table caption="Import batches">
          <thead>
            <tr>
              <Th>File</Th>
              <Th>What</Th>
              <Th>Source</Th>
              <Th>Rows</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Open</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} data-testid="hist-batch" data-status={b.status}>
                <Td label="File">{b.filename}</Td>
                <Td label="What">{b.entityLabel}</Td>
                <Td label="Source">{b.sourceSystem}</Td>
                <Td label="Rows">
                  {b.rowCount}
                  {b.loaded !== null && ` (${b.loaded} loaded)`}
                </Td>
                <Td label="Status">
                  <Badge tone={TONE[b.status]}>{LABEL[b.status]}</Badge>
                </Td>
                <Td label="Open">
                  <Button variant="secondary" aria-label={`Open ${b.filename}`} onClick={() => onOpen(b.id)}>
                    Open
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {selected && (
        <section
          className="mt-4 flex flex-col gap-2"
          data-testid="hist-selected"
          data-status={selected.status}
          aria-label="Selected batch"
        >
          <h3 className="font-heading text-base font-bold">
            {selected.filename}{' '}
            <span className="font-normal text-text-muted">from {selected.sourceSystem}</span>
          </h3>
          {selected.entity === 'CONTRACT_FILES' && selected.ocr && (
            <p className="text-sm" data-testid="hist-ocr">
              {selected.ocr.available === false
                ? selected.ocr.message
                : selected.ocr.error
                  ? selected.ocr.message
                  : `Contract ingestion batch ${selected.ocr.id ?? ''}: ${selected.ocr.documents ?? 0} document(s). Review and commit them under Contracts > Ingest.`}
            </p>
          )}
          {selected.commitSummary && (
            <p className="text-sm text-text-muted" data-testid="hist-summary">
              Loaded {selected.commitSummary.loaded}, merged {selected.commitSummary.merged}, skipped{' '}
              {selected.commitSummary.skippedDuplicates + selected.commitSummary.skippedErrors} of{' '}
              {selected.commitSummary.total}.
              {selected.commitSummary.rollback &&
                ` Rolled back: ${selected.commitSummary.rollback.contractsDeleted} contract(s) logically deleted, ${selected.commitSummary.rollback.remindersCancelled} reminder(s) cancelled, ${selected.commitSummary.rollback.suppliersDeleted} supplier(s) removed, ${selected.commitSummary.rollback.spendLinesDeleted} spend line(s) removed.`}
            </p>
          )}
          {selected.status === 'COMMITTED' && selected.rollback && (
            <>
              {!selected.rollback.possible && (
                <ul className="list-disc pl-5 text-sm text-error" data-testid="hist-blockers">
                  {selected.rollback.blockers.map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              )}
              <div>
                <Button
                  variant="danger"
                  disabled={!canLoad || !selected.rollback.possible}
                  onClick={() => setAsk(true)}
                  data-testid="hist-rollback"
                >
                  Roll back this batch
                </Button>
                {!selected.rollback.possible && (
                  <span className="ml-2 text-sm text-text-muted">
                    Rollback is only possible while what was imported is untouched.
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      )}
      <Dialog
        open={ask}
        onOpenChange={setAsk}
        title="Roll back this batch?"
        description="Removes exactly what this batch created. Imported contracts are kept as logically deleted records, with their reminders cancelled."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsk(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 5}
              data-testid="hist-rollback-confirm"
              onClick={() => {
                onRollback(selected!.id, reason.trim());
                setAsk(false);
                setReason('');
              }}
            >
              Roll back
            </Button>
          </>
        }
      >
        <Field label="Why (at least 5 characters)">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="hist-rollback-reason"
          />
        </Field>
      </Dialog>
    </Card>
  );
}
