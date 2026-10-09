'use client';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Field, Select, Table, Td, Th } from '@if/ui';
import type { HistBatch, HistEntityDef } from './hist-types';

/** Step 2: which column of the file is which field. The suggestion is a starting point; every choice can be changed and saved per source system. */
export function HistMappingStep({
  batch,
  def,
  busy,
  onBack,
  onSave,
}: {
  batch: HistBatch;
  def: HistEntityDef;
  busy: boolean;
  onBack: () => void;
  onSave: (mapping: Record<string, string | null>, rule: 'SKIP' | 'MERGE', save: boolean) => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string | null>>(batch.mapping);
  const [rule, setRule] = useState<'SKIP' | 'MERGE'>(batch.duplicateRule);
  const [save, setSave] = useState(true);
  const missing = def.fields.filter((f) => f.required && !mapping[f.key]);
  const used = new Map<string, string>();
  for (const [k, h] of Object.entries(mapping)) if (h) used.set(h, k);
  const conflict = Object.entries(mapping).some(([k, h]) => h && used.get(h) !== k);
  const conf = batch.suggestion?.confidence ?? {};
  return (
    <Card role="region" aria-labelledby="hist-s1" data-testid="hist-mapping">
      <h2 id="hist-s1" className="font-heading text-xl font-bold">
        2. Map the columns
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        {batch.filename}: {batch.rowCount} row(s), {batch.headers.length} column(s).{' '}
        {batch.suggestion?.usedSavedMapping
          ? `Started from the mapping saved for ${batch.sourceSystem}.`
          : 'These are suggestions from the column names and what the columns contain.'}
      </p>
      {batch.parseWarnings.map((w) => (
        <p key={w} className="mt-1 text-sm text-text-muted" data-testid="hist-parse-warning">
          {w}
        </p>
      ))}
      <Table caption="Field to column">
        <thead>
          <tr>
            <Th>Field</Th>
            <Th>Column in your file</Th>
            <Th>Confidence</Th>
            <Th>First rows</Th>
          </tr>
        </thead>
        <tbody>
          {def.fields.map((f) => (
            <tr key={f.key} data-testid="hist-map-row" data-field={f.key}>
              <Td label="Field">
                {f.label}
                {f.required && <span className="text-error"> *</span>}
                {f.hint && <span className="block text-xs text-text-muted">{f.hint}</span>}
              </Td>
              <Td label="Column">
                <Field label={`Column for ${f.label}`}>
                  <Select
                    value={mapping[f.key] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}
                  >
                    <option value="">Not in my file</option>
                    {batch.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Td>
              <Td label="Confidence">
                {mapping[f.key] && conf[f.key] !== undefined && mapping[f.key] === batch.mapping[f.key] ? (
                  <Badge tone={conf[f.key]! >= 0.85 ? 'success' : 'warning'}>
                    {Math.round(conf[f.key]! * 100)}%
                  </Badge>
                ) : mapping[f.key] ? (
                  <Badge tone="neutral">Your choice</Badge>
                ) : (
                  '–'
                )}
              </Td>
              <Td label="First rows" className="max-w-48 truncate text-xs text-text-muted">
                {mapping[f.key]
                  ? batch.preview
                      .map((r) => r[mapping[f.key]!] ?? '')
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(' | ')
                  : ''}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="When a row matches a record already on file"
          hint="Contracts and spend are never changed once loaded, so their duplicates are always skipped."
        >
          <Select
            value={rule}
            onChange={(e) => setRule(e.target.value as 'SKIP' | 'MERGE')}
            data-testid="hist-rule"
          >
            <option value="SKIP">Skip it</option>
            <option value="MERGE">Merge it into the record on file (suppliers and catalogue prices)</option>
          </Select>
        </Field>
        <Checkbox
          checked={save}
          onChange={(e) => setSave(e.target.checked)}
          label={`Save this mapping for ${batch.sourceSystem}`}
          data-testid="hist-save-mapping"
        />
      </div>
      {missing.length > 0 && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          Map these required fields: {missing.map((f) => f.label).join(', ')}.
        </p>
      )}
      {conflict && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          A column is used for more than one field.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button
          loading={busy}
          disabled={missing.length > 0 || conflict}
          data-testid="hist-run-dry"
          onClick={() => onSave(mapping, rule, save)}
        >
          Save mapping and run the dry run
        </Button>
      </div>
    </Card>
  );
}
