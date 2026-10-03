'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, Dialog, Field, Input, Select, Stepper, Textarea, type BadgeTone } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { CONTRACT_STATUS, aud } from '@/lib/labels';
import { ManagementCard } from './management-card';
import type { ContractView } from './types';

const STEPS = ['Draft', 'Legal review', 'Signing', 'Executed'];
const STEP_OF: Record<string, number> = {
  DRAFT: 0,
  LEGAL_REVIEW: 1,
  AWAITING_SIGNATURE: 2,
  PARTIALLY_SIGNED: 2,
  EXECUTED: 4,
};

type Problem = { message: string; list: string[] };
const problem = (e: unknown): Problem =>
  e instanceof ApiError
    ? { message: e.message, list: (e.problem.errors ?? []).map((x) => x.message) }
    : { message: 'Something went wrong. Please try again.', list: [] };

export function ContractWorkspace({ initial, csrf }: { initial: ContractView; csrf: string }) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [error, setError] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [dialog, setDialog] = useState<null | 'terms' | 'return' | 'delete' | 'devreject' | 'variation'>(
    null,
  );
  const [rejectClause, setRejectClause] = useState<string | null>(null);
  const [variation, setVariation] = useState({ reason: '', value: '', endDate: '' });
  const [comment, setComment] = useState('');
  const [terms, setTerms] = useState({ value: '', startDate: '', endDate: '', noticeDays: '' });
  const p = c.permissions;

  async function run<T>(key: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      return true;
    } catch (e) {
      setError(problem(e));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const reload = () => api<ContractView>(`/contracts/${c.id}`).then(setC);

  const saveClause = (id: string) =>
    run(`clause-${id}`, async () => {
      await api(`/contracts/${c.id}/clauses/${id}`, { method: 'PUT', csrf, body: { text: draftText } });
      await reload();
      setEditing(null);
    });
  const release = () =>
    run(
      'release',
      () => api<ContractView>(`/contracts/${c.id}/release-for-signing`, { method: 'POST', csrf }),
      setC,
    );
  const sign = () =>
    run(
      'sign',
      () =>
        api<ContractView>(`/contracts/${c.id}/sign`, { method: 'POST', csrf, body: { decision: 'APPROVE' } }),
      setC,
    );
  const giveBack = () =>
    run(
      'return',
      () =>
        api<ContractView>(`/contracts/${c.id}/sign`, {
          method: 'POST',
          csrf,
          body: { decision: 'REJECT', comment },
        }),
      (r) => {
        setC(r);
        setDialog(null);
        setComment('');
      },
    );
  const saveTerms = () =>
    run(
      'terms',
      () =>
        api<ContractView>(`/contracts/${c.id}`, {
          method: 'PATCH',
          csrf,
          body: {
            ...(terms.value ? { value: Number(terms.value) } : {}),
            ...(terms.startDate ? { startDate: terms.startDate } : {}),
            ...(terms.endDate ? { endDate: terms.endDate } : {}),
            ...(terms.noticeDays ? { noticeDays: Number(terms.noticeDays) } : {}),
          },
        }),
      (r) => {
        setC(r);
        setDialog(null);
      },
    );
  const decideDeviation = (clauseId: string, decision: 'APPROVE' | 'REJECT', why?: string) =>
    run(
      `dev-${clauseId}`,
      () =>
        api<ContractView>(`/contracts/${c.id}/deviations/${clauseId}/decision`, {
          method: 'POST',
          csrf,
          body: { decision, ...(why ? { comment: why } : {}) },
        }),
      (r) => {
        setC(r);
        setDialog(null);
        setComment('');
      },
    );
  const setRisk = (clauseId: string, risk: string) =>
    run(
      `risk-${clauseId}`,
      () =>
        api<ContractView>(`/contracts/${c.id}/deviations/${clauseId}/risk`, {
          method: 'PUT',
          csrf,
          body: { risk },
        }),
      setC,
    );
  const createVariation = () =>
    run(
      'variation',
      () =>
        api<{ id: string }>(`/contracts/${c.id}/variations`, {
          method: 'POST',
          csrf,
          body: {
            reason: variation.reason,
            value: Number(variation.value || 0),
            ...(variation.endDate ? { endDate: variation.endDate } : {}),
          },
        }),
      (r) => router.push(`/app/contracts/${r.id}`),
    );
  const remove = () =>
    run(
      'delete',
      () => api(`/contracts/${c.id}`, { method: 'DELETE', csrf, body: { reason: comment } }),
      () => router.push('/app/contracts'),
    );

  const [statusLabel, tone] = CONTRACT_STATUS[c.status] ?? [c.status, 'neutral' as const];
  const RISK_TONE: Record<string, BadgeTone> = { LOW: 'success', MEDIUM: 'warning', HIGH: 'error' };
  return (
    <div className="flex flex-col gap-6" data-testid="contract-workspace">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="font-mono text-lg text-text-muted">{c.number}</span> {c.title ?? 'Contract'}
          </h1>
          <Badge tone={tone}>{statusLabel}</Badge>
        </div>
        <Stepper steps={STEPS} current={STEP_OF[c.status] ?? 0} />
        {c.parent && (
          <p className="text-sm" data-testid="parent-link">
            Variation of <Link href={`/app/contracts/${c.parent.id}`}>{c.parent.number}</Link>
          </p>
        )}
      </header>

      {c.locked && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
          data-testid="locked-banner"
        >
          This contract is executed and locked. Its terms and clauses can no longer be changed.
        </p>
      )}
      {error && (
        <div role="alert" className="rounded-md border border-error bg-error-bg p-3 text-sm text-error">
          <p className="font-semibold">{error.message}</p>
          {error.list.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {error.list.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card aria-labelledby="clauses-h" role="region">
            <h2 id="clauses-h" className="font-heading text-xl font-bold">
              Clauses
            </h2>
            <ol className="mt-3 flex flex-col gap-4" data-testid="clauses">
              {c.clauses.map((k) => (
                <li key={k.id} className="rounded-md border border-border p-3" data-testid={`clause-${k.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-heading font-semibold">{k.title}</h3>
                    {k.mandatory && <Badge tone="neutral">Mandatory</Badge>}
                    {k.changedFromTemplate && <Badge tone="warning">Changed from template</Badge>}
                    {p.canEdit && editing !== k.id && (
                      <Button
                        variant="secondary"
                        className="ml-auto"
                        aria-label={`Edit ${k.title}`}
                        onClick={() => {
                          setEditing(k.id);
                          setDraftText(k.text);
                          setError(null);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                  {editing === k.id ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <Textarea
                        aria-label={`Wording of ${k.title}`}
                        rows={5}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button loading={busy === `clause-${k.id}`} onClick={() => void saveClause(k.id)}>
                          Save clause
                        </Button>
                        <Button variant="secondary" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-line text-sm text-text">{k.text}</p>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          {c.status === 'EXECUTED' && !c.parent && (
            <ManagementCard
              record={c.record}
              contractId={c.id}
              csrf={csrf}
              editable={p.canEditRecord}
              onChange={setC}
            />
          )}

          <Card aria-labelledby="dev-h" role="region">
            <h2 id="dev-h" className="font-heading text-xl font-bold">
              Deviations from the template
            </h2>
            {c.deviations.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted" data-testid="no-deviations">
                No clause differs from the standard template.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3" data-testid="deviations">
                {c.deviations.map((x) => (
                  <li
                    key={x.clauseId}
                    className="rounded-md border border-border p-3 text-sm"
                    data-testid={`deviation-${x.clauseId}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{x.title}</p>
                      <Badge tone={RISK_TONE[x.risk] ?? 'neutral'}>{x.risk.toLowerCase()} risk</Badge>
                      {x.decision === 'APPROVED' && <Badge tone="success">Approved</Badge>}
                      {x.decision === 'REJECTED' && <Badge tone="error">Rejected</Badge>}
                      {!x.decision && (x.mandatory || x.risk === 'HIGH') && (
                        <Badge tone="warning">Needs a delegate</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-text-muted">
                      <span className="font-semibold">Template: </span>
                      {x.templateText}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">Now: </span>
                      {x.currentText}
                    </p>
                    {x.stamp && <p className="mt-1 font-mono text-xs text-text-muted">{x.stamp}</p>}
                    {(p.canAmendRisk || p.canDecideDeviations) && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        {p.canAmendRisk && (
                          <label className="flex flex-col gap-1 text-xs font-semibold">
                            Risk rating
                            <Select
                              aria-label={`Risk rating for ${x.title}`}
                              value={x.risk}
                              onChange={(e) => void setRisk(x.clauseId, e.target.value)}
                              className="w-36"
                            >
                              <option value="LOW">Low</option>
                              <option value="MEDIUM">Medium</option>
                              <option value="HIGH">High</option>
                            </Select>
                          </label>
                        )}
                        {p.canDecideDeviations && (
                          <>
                            <Button
                              aria-label={`Approve the change to ${x.title}`}
                              loading={busy === `dev-${x.clauseId}`}
                              onClick={() => void decideDeviation(x.clauseId, 'APPROVE')}
                            >
                              Approve change
                            </Button>
                            <Button
                              variant="secondary"
                              aria-label={`Reject the change to ${x.title}`}
                              onClick={() => {
                                setError(null);
                                setComment('');
                                setRejectClause(x.clauseId);
                                setDialog('devreject');
                              }}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card aria-labelledby="terms-h" role="region">
            <h2 id="terms-h" className="font-heading text-xl font-bold">
              Terms
            </h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-text-muted">Supplier</dt>
              <dd className="font-semibold">{c.supplierName}</dd>
              <dt className="text-text-muted">Value</dt>
              <dd className="font-semibold">{aud.format(c.value)}</dd>
              <dt className="text-text-muted">Starts</dt>
              <dd>{c.startDate ?? '–'}</dd>
              <dt className="text-text-muted">Ends</dt>
              <dd>{c.endDate ?? '–'}</dd>
              <dt className="text-text-muted">Notice</dt>
              <dd>{c.noticeDays} days</dd>
              {c.variations.some((v) => v.status === 'EXECUTED') && (
                <>
                  <dt className="text-text-muted">With variations</dt>
                  <dd className="font-semibold" data-testid="cumulative">
                    {aud.format(c.cumulative.value)} to {c.cumulative.endDate}
                  </dd>
                </>
              )}
            </dl>
            {c.variations.length > 0 && (
              <ul
                className="mt-3 flex flex-col gap-1 text-sm"
                aria-label="Variations"
                data-testid="variations"
              >
                {c.variations.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/app/contracts/${v.id}`}>{v.number}</Link>
                    <span className="text-text-muted">
                      {aud.format(v.value)} · {CONTRACT_STATUS[v.status]?.[0] ?? v.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {p.canVary && (
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  setVariation({ reason: '', value: '', endDate: '' });
                  setError(null);
                  setDialog('variation');
                }}
              >
                Create a variation
              </Button>
            )}
            {p.canEditTerms && (
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  setTerms({
                    value: String(c.value),
                    startDate: c.startDate ?? '',
                    endDate: c.endDate ?? '',
                    noticeDays: String(c.noticeDays),
                  });
                  setError(null);
                  setDialog('terms');
                }}
              >
                Change terms
              </Button>
            )}
          </Card>

          <Card aria-labelledby="sign-h" role="region">
            <h2 id="sign-h" className="font-heading text-xl font-bold">
              Signatures
            </h2>
            <ul className="mt-3 flex flex-col gap-2" data-testid="signature-chain">
              {c.chain.map((s) => (
                <li key={s.role} className="rounded-md border border-border p-2 text-sm">
                  <p className="font-semibold">{s.label}</p>
                  {s.signedBy ? (
                    <p className="font-mono text-xs text-success" data-testid="stamp">
                      {s.stamp}
                    </p>
                  ) : (
                    <p className="text-text-muted">Not signed yet</p>
                  )}
                </li>
              ))}
            </ul>
            {c.signatures.some((s) => s.decision === 'REJECTED') && (
              <p className="mt-2 text-xs text-text-muted">
                Returned to legal at least once:{' '}
                {c.signatures
                  .filter((s) => s.decision === 'REJECTED')
                  .map((s) => s.comment)
                  .join('; ')}
              </p>
            )}
            {p.canRelease && c.deviationBlockers.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-warning" data-testid="release-blockers">
                {c.deviationBlockers.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {p.signBlocked && (
              <p className="mt-2 text-sm text-warning" data-testid="sign-blocked">
                {p.signBlocked}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {p.canRelease && (
                <Button loading={busy === 'release'} onClick={() => void release()}>
                  Release for signing
                </Button>
              )}
              {p.canSign && (
                <>
                  <Button loading={busy === 'sign'} onClick={() => void sign()}>
                    Sign contract
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError(null);
                      setComment('');
                      setDialog('return');
                    }}
                  >
                    Return to legal
                  </Button>
                </>
              )}
              {p.canDelete && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setError(null);
                    setComment('');
                    setDialog('delete');
                  }}
                >
                  Remove contract
                </Button>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <Dialog
        open={dialog === 'terms'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Change the contract terms"
        description="Clauses nobody has edited follow the new value and dates."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button loading={busy === 'terms'} onClick={() => void saveTerms()}>
              Save terms
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Contract value (AUD)">
            <Input
              type="number"
              value={terms.value}
              onChange={(e) => setTerms({ ...terms, value: e.target.value })}
            />
          </Field>
          <Field label="Start date">
            <Input
              type="date"
              value={terms.startDate}
              onChange={(e) => setTerms({ ...terms, startDate: e.target.value })}
            />
          </Field>
          <Field label="End date">
            <Input
              type="date"
              value={terms.endDate}
              onChange={(e) => setTerms({ ...terms, endDate: e.target.value })}
            />
          </Field>
          <Field label="Notice period (days)">
            <Input
              type="number"
              value={terms.noticeDays}
              onChange={(e) => setTerms({ ...terms, noticeDays: e.target.value })}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error.message}
            </p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'return' || dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'delete' ? 'Remove this contract' : 'Return the contract to legal'}
        description={
          dialog === 'delete'
            ? 'The record is kept and the removal is audited; it disappears from the lists.'
            : 'Signatures already given are withdrawn and legal reviews it again.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog === 'delete' ? 'danger' : 'primary'}
              loading={busy === 'return' || busy === 'delete'}
              disabled={comment.trim().length < (dialog === 'delete' ? 10 : 5)}
              onClick={() => void (dialog === 'delete' ? remove() : giveBack())}
            >
              {dialog === 'delete' ? 'Remove contract' : 'Return to legal'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Reason" required>
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error.message}
            </p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'devreject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject this change"
        description="Legal will see your reason and can restore or reword the clause."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={comment.trim().length < 5}
              loading={busy === `dev-${rejectClause}`}
              onClick={() => rejectClause && void decideDeviation(rejectClause, 'REJECT', comment)}
            >
              Reject change
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {error.message}
          </p>
        )}
      </Dialog>

      <Dialog
        open={dialog === 'variation'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Create a variation"
        description="A variation is its own contract linked to this one. It is reviewed, signed and locked like any contract, and signing authority is judged on the total value."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'variation'}
              disabled={variation.reason.trim().length < 10}
              onClick={() => void createVariation()}
            >
              Create variation
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Reason" required hint="Why the contract changes (at least 10 characters).">
            <Textarea
              rows={3}
              value={variation.reason}
              onChange={(e) => setVariation({ ...variation, reason: e.target.value })}
            />
          </Field>
          <Field label="Additional value (AUD)" hint="Leave empty if only the end date changes.">
            <Input
              type="number"
              min={0}
              value={variation.value}
              onChange={(e) => setVariation({ ...variation, value: e.target.value })}
            />
          </Field>
          <Field label="New end date" hint="Leave empty to keep the current end date.">
            <Input
              type="date"
              value={variation.endDate}
              onChange={(e) => setVariation({ ...variation, endDate: e.target.value })}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error.message}
              {error.list.length > 0 ? ` ${error.list.join(' ')}` : ''}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
