import os
os.chdir(r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\contract')


def rd(p):
    return open(p, encoding='utf8').read()


def sub(t, a, b):
    assert a in t, a[:70]
    return t.replace(a, b, 1)


# ---------------- types
t = rd('types.ts')
t = sub(t, """  deviations: Array<{
    clauseId: string;
    title: string;
    mandatory: boolean;
    templateText: string;
    currentText: string;
  }>;""",
        """  deviations: Array<{
    clauseId: string;
    title: string;
    mandatory: boolean;
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    decision: 'APPROVED' | 'REJECTED' | null;
    decidedBy: string | null;
    stamp: string | null;
    templateText: string;
    currentText: string;
  }>;
  deviationBlockers: string[];
  parent: { id: string; number: string } | null;
  variations: Array<{ id: string; number: string; status: string; value: number; endDate: string | null }>;
  cumulative: { value: number; endDate: string | null };""")
t = sub(t, """    canDelete: boolean;
  };""", """    canDelete: boolean;
    canDecideDeviations: boolean;
    canAmendRisk: boolean;
    canVary: boolean;
    canEditRecord: boolean;
  };""")
t = sub(t, "  alerts: AlertRow[];\n}", "  alerts: AlertRow[];\n  ownerCandidates?: Array<{ id: string; name: string }>;\n}")
t = sub(t, "  sentAt: string | null;\n  contractNumber?: string;", "  sentAt: string | null;\n  note?: string | null;\n  origin?: 'SYSTEM' | 'USER';\n  contractNumber?: string;")
open('types.ts', 'w', encoding='utf8').write(t)

# ---------------- workspace
t = rd('contract-workspace.tsx')
t = sub(t, "import { Badge, Button, Card, Dialog, Field, Input, Stepper, Textarea } from '@if/ui';",
        "import Link from 'next/link';\nimport { Badge, Button, Card, Dialog, Field, Input, Select, Stepper, Textarea, type BadgeTone } from '@if/ui';")
t = sub(t, "  const [dialog, setDialog] = useState<null | 'terms' | 'return' | 'delete'>(null);",
        "  const [dialog, setDialog] = useState<null | 'terms' | 'return' | 'delete' | 'devreject' | 'variation'>(null);\n  const [rejectClause, setRejectClause] = useState<string | null>(null);\n  const [variation, setVariation] = useState({ reason: '', value: '', endDate: '' });")
t = sub(t, "  const remove = () =>", """  const decideDeviation = (clauseId: string, decision: 'APPROVE' | 'REJECT', why?: string) =>
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
        api<ContractView>(`/contracts/${c.id}/deviations/${clauseId}/risk`, { method: 'PUT', csrf, body: { risk } }),
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
  const remove = () =>""")
t = sub(t, "  const [statusLabel, tone] = CONTRACT_STATUS[c.status] ?? [c.status, 'neutral' as const];",
        "  const [statusLabel, tone] = CONTRACT_STATUS[c.status] ?? [c.status, 'neutral' as const];\n  const RISK_TONE: Record<string, BadgeTone> = { LOW: 'success', MEDIUM: 'warning', HIGH: 'error' };")
t = sub(t, "        <Stepper steps={STEPS} current={STEP_OF[c.status] ?? 0} />\n      </header>",
        """        <Stepper steps={STEPS} current={STEP_OF[c.status] ?? 0} />
        {c.parent && (
          <p className="text-sm" data-testid="parent-link">
            Variation of <Link href={`/app/contracts/${c.parent.id}`}>{c.parent.number}</Link>
          </p>
        )}
      </header>""")
t = sub(t, "{c.status === 'EXECUTED' && <ManagementCard record={c.record} />}",
        "{c.status === 'EXECUTED' && !c.parent && (\n            <ManagementCard record={c.record} contractId={c.id} csrf={csrf} editable={p.canEditRecord} onChange={setC} />\n          )}")
# deviations card body
a = t.index("                {c.deviations.map((x) => (")
b = t.index("                ))}", a) + len("                ))}")
t = t[:a] + """                {c.deviations.map((x) => (
                  <li key={x.clauseId} className="rounded-md border border-border p-3 text-sm" data-testid={`deviation-${x.clauseId}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{x.title}</p>
                      <Badge tone={RISK_TONE[x.risk] ?? 'neutral'}>{x.risk.toLowerCase()} risk</Badge>
                      {x.decision === 'APPROVED' && <Badge tone="success">Approved</Badge>}
                      {x.decision === 'REJECTED' && <Badge tone="error">Rejected</Badge>}
                      {!x.decision && (x.mandatory || x.risk === 'HIGH') && <Badge tone="warning">Needs a delegate</Badge>}
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
                ))}""" + t[b:]
# terms card: cumulative + variations + create variation
t = sub(t, """              <dt className="text-text-muted">Notice</dt>
              <dd>{c.noticeDays} days</dd>
            </dl>""", """              <dt className="text-text-muted">Notice</dt>
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
              <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="Variations" data-testid="variations">
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
            )}""")
# blockers near release
t = sub(t, "            {p.signBlocked && (", """            {p.canRelease && c.deviationBlockers.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-warning" data-testid="release-blockers">
                {c.deviationBlockers.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {p.signBlocked && (""")
# dialogs: devreject + variation (append before final </div>)
idx = t.rindex("    </div>\n  );\n}")
t = t[:idx] + """
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
            <Textarea rows={3} value={variation.reason} onChange={(e) => setVariation({ ...variation, reason: e.target.value })} />
          </Field>
          <Field label="Additional value (AUD)" hint="Leave empty if only the end date changes.">
            <Input type="number" min={0} value={variation.value} onChange={(e) => setVariation({ ...variation, value: e.target.value })} />
          </Field>
          <Field label="New end date" hint="Leave empty to keep the current end date.">
            <Input type="date" value={variation.endDate} onChange={(e) => setVariation({ ...variation, endDate: e.target.value })} />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error.message}
              {error.list.length > 0 ? ` ${error.list.join(' ')}` : ''}
            </p>
          )}
        </div>
      </Dialog>
""" + t[idx:]
open('contract-workspace.tsx', 'w', encoding='utf8').write(t)
print('ok')
