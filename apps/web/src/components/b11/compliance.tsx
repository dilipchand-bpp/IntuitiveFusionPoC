'use client';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Field, Input, Table, Td, Th, type BadgeTone } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';
import { formatDateTime } from '@/lib/labels';
import { SectionForm, type FieldSpec } from './section-form';

interface Check {
  key: string;
  label: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'NOT_RUN';
  detail: string;
  lastCheckedAt: string | null;
  firstFailedAt: string | null;
  guidance: string;
  remediation: { label: string; oneClick: true } | null;
}
interface View {
  summary: { pass: number; warn: number; fail: number; notRun: number };
  canRemediate: boolean;
  checks: Check[];
}

const TONE: Record<Check['status'], { tone: BadgeTone; text: string }> = {
  PASS: { tone: 'success', text: 'Pass' },
  WARN: { tone: 'warning', text: 'Warning' },
  FAIL: { tone: 'error', text: 'Fail' },
  NOT_RUN: { tone: 'neutral', text: 'Not checked' },
};

const FIELDS: FieldSpec[] = [
  { key: 'secretMaxAgeDays', label: 'Connector secret: oldest allowed (days)', kind: 'number' },
  { key: 'keyMaxAgeDays', label: 'Encryption key: oldest allowed (days)', kind: 'number' },
  { key: 'breakerMaxHours', label: 'Connector failing: longest allowed (hours)', kind: 'number' },
  { key: 'delegationReviewAud', label: 'Delegations above this value need review (AUD)', kind: 'number' },
  { key: 'delegationReviewDays', label: '…reviewed within (days)', kind: 'number' },
  { key: 'approvalLinkMaxHours', label: 'Approval links: longest validity (hours)', kind: 'number' },
  { key: 'dormantDays', label: 'Privileged account unused (days)', kind: 'number' },
  { key: 'minPasswordLength', label: 'Recommended password length', kind: 'number' },
];

/** The configuration checks, with guidance and one-click safe fixes for an administrator (SEC-L08). */
export function CompliancePanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const { data, error, reload } = useData<View>('/compliance');
  const { busy, run, messages } = useRun();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const started = useRef(false);
  const canFix = has(roles, 'ADMIN');
  // the first time, nothing has been checked: check now
  useEffect(() => {
    if (!data || started.current || data.summary.notRun === 0) return;
    started.current = true;
    void send(csrf, 'POST', '/compliance/run').then(reload, () => undefined);
  }, [data, csrf, reload]);
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading the checks…</p>;
  const s = data.summary;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card role="region" aria-labelledby="comp-h">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="comp-h" className="font-heading text-xl font-bold">
            Where the configuration stands
          </h2>
          <Badge tone={s.fail > 0 ? 'error' : s.warn > 0 ? 'warning' : 'success'}>
            <span data-testid="compliance-summary">
              {s.pass} pass, {s.warn} warning, {s.fail} fail
            </span>
          </Badge>
        </div>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          The checks run when you ask, on a schedule, and after every change to the settings. A check that
          passed and now fails raises a security alert for the security owner. Each check says what to do;
          where one safe setting change is the fix, an administrator can apply it in one click, with a reason,
          and the checks run again.
        </p>
        <Button
          className="mt-4"
          loading={busy === 'run'}
          disabled={busy !== null}
          onClick={() =>
            void run(
              'run',
              async () => {
                await send(csrf, 'POST', '/compliance/run');
                await reload();
              },
              'The checks ran.',
            )
          }
        >
          Run the checks now
        </Button>
        {messages}
      </Card>

      <Table caption="Configuration checks">
        <thead>
          <tr>
            <Th>Check</Th>
            <Th>Result</Th>
            <Th>Detail and what to do</Th>
          </tr>
        </thead>
        <tbody>
          {data.checks.map((c) => (
            <tr key={c.key} data-testid="check-row" data-key={c.key} data-status={c.status}>
              <Td label="Check">
                <strong>{c.label}</strong>
                <span className="block text-xs text-text-muted">{c.category.toLowerCase()}</span>
              </Td>
              <Td label="Result">
                <Badge tone={TONE[c.status].tone}>{TONE[c.status].text}</Badge>
                {c.firstFailedAt && (
                  <span className="block text-xs text-text-muted">
                    failing since {formatDateTime(c.firstFailedAt)}
                  </span>
                )}
              </Td>
              <Td label="Detail">
                <div className="text-left">
                  <p>{c.detail}</p>
                  {c.status !== 'PASS' && <p className="mt-1 text-xs text-text-muted">{c.guidance}</p>}
                  {c.lastCheckedAt && (
                    <p className="mt-1 text-xs text-text-muted">Checked {formatDateTime(c.lastCheckedAt)}</p>
                  )}
                  {canFix && c.remediation && (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="sm:w-72">
                        <Field label="Reason for the change">
                          <Input
                            value={reasons[c.key] ?? ''}
                            maxLength={500}
                            onChange={(e) => setReasons((x) => ({ ...x, [c.key]: e.target.value }))}
                          />
                        </Field>
                      </div>
                      <Button
                        variant="secondary"
                        loading={busy === `fix-${c.key}`}
                        disabled={(reasons[c.key] ?? '').trim().length < 5 || busy !== null}
                        onClick={() =>
                          void run(
                            `fix-${c.key}`,
                            async () => {
                              await send(csrf, 'POST', `/compliance/checks/${c.key}/remediate`, {
                                reason: reasons[c.key]!.trim(),
                              });
                              await reload();
                            },
                            'Fixed and checked again.',
                          )
                        }
                      >
                        {c.remediation.label}
                      </Button>
                    </div>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <SectionForm
        section="compliancePolicy"
        title="Check thresholds"
        intro="The limits the checks use: how old a secret or key may be, how long a connector may fail, which delegations need review."
        fields={FIELDS}
        csrf={csrf}
        canEdit={canFix}
      />
    </div>
  );
}
