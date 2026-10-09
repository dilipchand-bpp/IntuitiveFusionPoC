'use client';
import { useState } from 'react';
import { Badge, Card, EmptyState, Select, Table, Td, Th } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';
import { aud } from '@/lib/labels';
import type { OcrReport } from './ocr-types';

const BASIS: Record<string, string> = {
  FIXED: 'Fixed amount',
  FEES_12_MONTHS: 'Fees paid or payable',
  FEES_PERIOD: 'Fees for a period',
  UNLIMITED: 'Unlimited',
  NOT_STATED: 'Not stated',
};

/** Reporting across ingested contracts: renewals, notice windows, liability caps, missing clauses and supplier concentration (CP-07). */
export function OcrReportView() {
  const [days, setDays] = useState('180');
  const [scope, setScope] = useState('all');
  const { data: r, error } = useData<OcrReport>(`/contract-ingest/report?days=${days}&scope=${scope}`);
  if (error && !r)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!r) return <p className="text-sm text-text-muted">Loading the report…</p>;
  if (r.totals.documents === 0)
    return (
      <EmptyState
        title="No ingested contracts yet"
        body="Read a contract or a sample on the ingest page, then come back."
      />
    );
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="ocr-report">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Look ahead
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days to look ahead">
            {['90', '180', '365', '730'].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Contracts
          <Select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which contracts">
            <option value="all">All ingested (reviewed or not)</option>
            <option value="committed">Committed only</option>
          </Select>
        </label>
      </div>
      <p className="text-sm text-text-muted">
        {r.totals.documents} documents: {r.totals.committed} committed, {r.totals.readyToCommit} ready,{' '}
        {r.totals.needsReview} needing review. As at {r.asOf}. Extraction is rules-based (rules-simulated-v1).
      </p>

      <Card>
        <h2 className="font-heading text-lg font-bold">Renewals due in {r.days} days</h2>
        {r.renewalsDue.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">None.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <Table caption="Renewals due">
              <thead>
                <tr>
                  <Th>Contract</Th>
                  <Th>Supplier</Th>
                  <Th>Ends</Th>
                  <Th>Days</Th>
                  <Th>Notice deadline</Th>
                  <Th>Option</Th>
                </tr>
              </thead>
              <tbody>
                {r.renewalsDue.map((x) => (
                  <tr key={x.documentId}>
                    <Td>{x.title}</Td>
                    <Td>{x.supplier}</Td>
                    <Td>{x.endDate}</Td>
                    <Td>{x.daysToEnd}</Td>
                    <Td>{x.noticeDeadline ?? 'not found'}</Td>
                    <Td>{x.renewal}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-lg font-bold">Notice windows</h2>
        {r.noticeWindows.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No notice deadline falls in this period.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <Table caption="Notice windows">
              <thead>
                <tr>
                  <Th>Contract</Th>
                  <Th>Notice</Th>
                  <Th>Deadline</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody>
                {r.noticeWindows.map((x) => (
                  <tr key={x.documentId}>
                    <Td>{x.title}</Td>
                    <Td>{x.noticeDays} days</Td>
                    <Td>{x.noticeDeadline}</Td>
                    <Td>
                      <Badge tone={x.state === 'PASSED' ? 'error' : 'warning'}>
                        {x.state === 'PASSED' ? 'Deadline passed' : `In ${x.daysToDeadline} days`}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-lg font-bold">Liability caps</h2>
        <p className="mt-1 text-sm text-text-muted">
          {r.liabilityCaps.summary.fixed} fixed, {r.liabilityCaps.summary.feesBased} fee-based,{' '}
          {r.liabilityCaps.summary.unlimited} unlimited, {r.liabilityCaps.summary.notStated} not stated;{' '}
          {r.liabilityCaps.summary.belowValue} below the contract value.
        </p>
        <div className="mt-2 overflow-x-auto">
          <Table caption="Liability caps">
            <thead>
              <tr>
                <Th>Contract</Th>
                <Th>Basis</Th>
                <Th>Cap</Th>
                <Th>Percent of value</Th>
              </tr>
            </thead>
            <tbody>
              {r.liabilityCaps.items.map((x) => (
                <tr key={x.documentId}>
                  <Td>{x.title}</Td>
                  <Td>{BASIS[x.basis] ?? x.basis}</Td>
                  <Td>
                    {x.capAmount !== null ? `${x.currency} ${x.capAmount.toLocaleString('en-AU')}` : ''}
                  </Td>
                  <Td>
                    {x.capPercentOfValue !== null ? (
                      <Badge tone={x.belowValue ? 'error' : 'success'}>{x.capPercentOfValue}%</Badge>
                    ) : (
                      ''
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h2 className="font-heading text-lg font-bold">Missing clauses</h2>
        <p className="mt-1 text-sm text-text-muted">
          {r.missingClauses.documentsWithMissingMandatory} of {r.missingClauses.documentsChecked} documents
          miss at least one mandatory clause.
        </p>
        <div className="mt-2 overflow-x-auto">
          <Table caption="Missing clauses by clause">
            <thead>
              <tr>
                <Th>Clause</Th>
                <Th>Mandatory</Th>
                <Th>Documents missing it</Th>
              </tr>
            </thead>
            <tbody>
              {r.missingClauses.byClause.map((c) => (
                <tr key={c.key}>
                  <Td>{c.title}</Td>
                  <Td>{c.mandatory ? 'Yes' : 'No'}</Td>
                  <Td>
                    {c.count}: {c.missing.map((m) => m.title).join('; ')}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h2 className="font-heading text-lg font-bold">Concentration by supplier</h2>
        <p className="mt-1 text-sm text-text-muted">
          Total {aud.format(r.concentration.totalValue)}; the largest supplier holds{' '}
          {r.concentration.topShare}%; concentration index {r.concentration.hhi} (10,000 is one supplier).
          {r.concentration.unconverted > 0
            ? ` ${r.concentration.unconverted} document(s) without a convertible value are not counted in the value.`
            : ''}
        </p>
        <div className="mt-2 overflow-x-auto">
          <Table caption="Concentration by supplier">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>Documents</Th>
                <Th>Value (AUD)</Th>
                <Th>Share</Th>
              </tr>
            </thead>
            <tbody>
              {r.concentration.bySupplier.map((s) => (
                <tr key={s.supplier}>
                  <Td>{s.supplier}</Td>
                  <Td>{s.documents}</Td>
                  <Td>{aud.format(s.totalValue)}</Td>
                  <Td>{s.share}%</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
