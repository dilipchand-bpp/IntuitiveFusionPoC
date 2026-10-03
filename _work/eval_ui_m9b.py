import re

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\evaluation\evaluation-workspace.tsx'
t = open(p, encoding='utf8', newline='').read()


def rep(a, b):
    global t
    assert a in t, a[:90]
    t = t.replace(a, b, 1)


# imports
rep("import { Badge, Button, Field, Select, Stepper, Textarea, cn } from '@if/ui';", "import { Badge, Button, Dialog, Field, Select, Stepper, Textarea, cn } from '@if/ui';")
rep("import { CheckCircle2, CircleDashed, Download, EyeOff, Flag, Lock, UserX } from 'lucide-react';", "import { CheckCircle2, CircleDashed, Download, EyeOff, FileDown, Flag, Info, Lock, RotateCcw, UserX } from 'lucide-react';")

# labels and the "active" panel
rep("  NOT_DECLARED: 'Not declared',", "  NOT_DECLARED: 'Not declared',\n  DECLARED_CONFLICT: 'Conflict: awaiting decision',")
rep("const live = ev.panel.filter((m) => m.coiState !== 'REMOVED');", "const live = ev.panel.filter((m) => m.coiState !== 'REMOVED' && m.coiState !== 'DECLARED_CONFLICT');")

# a declared conflict suspends the member; send them to the list with a notice
rep("post<{ removed?: boolean; message?: string }>(", "post<{ suspended?: boolean; message?: string }>(")
rep("if (r.removed) {\n                    router.push('/app/evaluations');", "if (r.suspended) {\n                    router.push('/app/evaluations?conflict=1');")

# file links: name on its own line, details underneath (no awkward wrapping in the narrow rail)
a = t.index('                          <a\n                            href={`/api/v1/evaluations/${ev.id}/suppliers/${s.supplierId}/files/${f.id}`}')
b = t.index('</a>', a) + len('</a>')
t = t[:a] + '''                          <a
                            href={`/api/v1/evaluations/${ev.id}/suppliers/${s.supplierId}/files/${f.id}`}
                            className="flex min-h-[44px] items-start gap-2 py-1"
                            download
                          >
                            <Download className="mt-1 size-4 shrink-0" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block break-all font-medium">{f.name}</span>
                              <span className="block text-xs text-text-muted">
                                {STREAM_LABEL[f.section]} · {kb(f.sizeBytes)}
                              </span>
                            </span>
                          </a>''' + t[b:]

# conflict review card in the rail (before Suppliers) and the stage guide at the top of the main column
rep('          <Card id="sup-h" title="Suppliers"', '''          {ev.conflicts.length > 0 && (
            <ConflictReview ev={ev} csrf={csrf} onDone={setEv} run={run} busy={busy} />
          )}

          <Card id="sup-h" title="Suppliers"''')
rep('        <div className="flex min-w-0 flex-col gap-4 lg:order-1">\n', '        <div className="flex min-w-0 flex-col gap-4 lg:order-1">\n          <StageGuide ev={ev} />\n')
# reopen card before the report
rep('          <ReportPanel', '          {p.canReopen && <ReopenCard ev={ev} csrf={csrf} onDone={setEv} />}\n\n          <ReportPanel')

# report: PDF download and clearer status wording
rep("? 'Returned'", "? 'Needs regenerating'")
rep("      {p.canGenerateReport && (", '''      {rep && (
        <div className="mt-3">
          <Button asChild variant="secondary">
            <a href={`/api/v1/evaluations/${ev.id}/report/pdf`} download className="text-text no-underline">
              <FileDown className="size-4" aria-hidden="true" />
              Download PDF
            </a>
          </Button>
        </div>
      )}
      {p.canGenerateReport && (''')

# new components appended
t += '''
/** Says where the evaluation is, what is happening and what comes next, so the page is never an unexplained empty space. */
function StageGuide({ ev }: { ev: EvalView }) {
  const live = ev.panel.filter((m) => m.coiState !== 'REMOVED' && m.coiState !== 'DECLARED_CONFLICT');
  const declared = live.filter((m) => m.coiState === 'DECLARED_NONE').length;
  const finished = live.filter((m) => m.scoringComplete).length;
  const awaiting = ev.panel.filter((m) => m.coiState === 'DECLARED_CONFLICT').length;
  const roster = ev.panel.length > 1; // only people who run the evaluation can see everyone
  const flagged = ev.consensus.filter((c) => c.flagged).length;
  const text: Record<EvalView['status'], { title: string; body: string }> = {
    COI_PENDING: {
      title: 'Waiting for conflict declarations',
      body: `${roster ? `${declared} of ${live.length} panel members have declared. ` : ''}${awaiting ? `${awaiting} declared conflict(s) are waiting for a delegate to decide. ` : ''}Scoring opens when every member has declared and every conflict is decided.`,
    },
    SCORING: {
      title: 'Evaluators are scoring independently',
      body: `${roster ? `${finished} of ${live.length} have finished. ` : ''}Scores stay hidden from everyone, including the chair, until the chair opens consensus.`,
    },
    CONSENSUS: {
      title: 'The chair is agreeing consensus scores',
      body: `${flagged ? `${flagged} score(s) differ by more than ${ev.varianceLimitPct}% and need a recorded reason. ` : ''}The consensus is shown to procurement, delegates and the executive once it is locked.`,
    },
    LOCKED: { title: 'Consensus is locked', body: 'Procurement generates the evaluation report next.' },
    REPORTED: {
      title: ev.report?.status === 'DRAFT' ? 'The report needs regenerating' : 'The report is waiting for approval',
      body: ev.report?.status === 'DRAFT' ? 'Consensus was reopened, so the earlier report no longer stands. It is regenerated after the chair locks again.' : 'A delegate, or the executive for larger awards, approves or returns it.',
    },
    APPROVED: { title: 'The report is approved', body: 'The award can proceed to contract.' },
  };
  const s = text[ev.status];
  return (
    <section aria-labelledby="stage-h" data-testid="stage-guide" className="flex items-start gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
      <span className="icon-tile shrink-0">
        <Info className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 id="stage-h" className="font-heading text-lg font-bold">
          {s.title}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{s.body}</p>
      </div>
    </section>
  );
}

const DISPOSITION: Record<string, string> = { PENDING: 'Awaiting decision', IMMATERIAL: 'Immaterial: reinstated', MANAGEABLE: 'Manageable: reinstated', MATERIAL: 'Material: removed' };

/** Declared conflicts: a delegate (or the executive) decides each one; everyone else on the process can see them. */
function ConflictReview({
  ev,
  csrf,
  onDone,
  run,
  busy,
}: {
  ev: EvalView;
  csrf: string;
  onDone: (e: EvalView) => void;
  run: (n: string, f: () => Promise<void>, ok?: string) => Promise<void>;
  busy: string | null;
}) {
  const [why, setWhy] = useState<Record<string, string>>({});
  const decide = (userId: string, disposition: 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL') =>
    run(
      `conflict-${userId}`,
      async () =>
        onDone(
          await api<EvalView>(`/evaluations/${ev.id}/conflicts/${userId}/decision`, {
            method: 'POST',
            csrf,
            body: { disposition, ...(why[userId] ? { rationale: why[userId] } : {}) },
          }),
        ),
      'Decision recorded.',
    );
  return (
    <Card id="conf-h" title="Declared conflicts" tone={ev.permissions.canDecideConflict ? 'warning' : undefined} testId="conflict-review">
      <ul className="mt-3 flex flex-col gap-3">
        {ev.conflicts.map((c) => (
          <li key={c.userId} className="rounded-md border border-border p-3 text-sm" data-conflict={c.disposition}>
            <div className="flex flex-wrap items-center gap-2">
              <strong>{c.name}</strong>
              <Badge tone={c.disposition === 'PENDING' ? 'warning' : c.disposition === 'MATERIAL' ? 'error' : 'success'}>{DISPOSITION[c.disposition]}</Badge>
            </div>
            <p className="mt-1">{c.nature}</p>
            {c.subjectOrg && <p className="text-text-muted">Concerning: {c.subjectOrg}</p>}
            {ev.permissions.canDecideConflict && c.disposition === 'PENDING' && (
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <Field label="Reason for your decision (optional)">
                  <Textarea rows={2} maxLength={2000} value={why[c.userId] ?? ''} onChange={(e) => setWhy((cur) => ({ ...cur, [c.userId]: e.target.value }))} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" loading={busy === `conflict-${c.userId}`} onClick={() => void decide(c.userId, 'IMMATERIAL')} aria-label={`Immaterial: reinstate ${c.name}`}>
                    Immaterial: reinstate
                  </Button>
                  <Button variant="secondary" loading={busy === `conflict-${c.userId}`} onClick={() => void decide(c.userId, 'MANAGEABLE')} aria-label={`Manageable: reinstate ${c.name}`}>
                    Manageable: reinstate
                  </Button>
                  <Button loading={busy === `conflict-${c.userId}`} onClick={() => void decide(c.userId, 'MATERIAL')} aria-label={`Material: remove ${c.name}`}>
                    Material: remove
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The chair can reopen a locked consensus, with a recorded reason. Any report written from the old scores is invalidated. */
function ReopenCard({ ev, csrf, onDone }: { ev: EvalView; csrf: string; onDone: (e: EvalView) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      onDone(await api<EvalView>(`/evaluations/${ev.id}/consensus/reopen`, { method: 'POST', csrf, body: { reason } }));
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card id="reopen-h" title="Reopen consensus" testId="reopen-card">
        <p className="mt-2 text-sm text-text-muted">
          If something needs to change after the lock, reopen it with a reason. Agreed values are kept, individual scores stay frozen, and the report has to be generated again after you lock.
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Reopen consensus
          </Button>
        </div>
      </Card>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Reopen consensus?"
        description="The reason is recorded in the audit trail and sent to procurement, the delegates and probity."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 10} onClick={() => void go()}>
              Reopen
            </Button>
          </>
        }
      >
        <Field label="Reason (at least 10 characters)" required>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
'''
open(p, 'w', encoding='utf8', newline='').write(t)

# types
tp = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\evaluation\types.ts'
s = open(tp, encoding='utf8', newline='').read()
s = s.replace("coiState: 'NOT_DECLARED' | 'DECLARED_NONE' | 'DECLARED_CONFLICT' | 'REMOVED';", "coiState: 'NOT_DECLARED' | 'DECLARED_NONE' | 'DECLARED_CONFLICT' | 'REMOVED';", 1)
s = s.replace("  consensus: ConsensusRow[];\n  ranking:", "  conflicts: Array<{\n    userId: string;\n    name: string;\n    nature: string;\n    subjectOrg: string | null;\n    disposition: 'PENDING' | 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL';\n    declaredAt: string;\n    decidedAt?: string;\n  }>;\n  consensus: ConsensusRow[];\n  ranking:", 1)
s = s.replace("    canDecideReport: boolean;\n  };", "    canDecideReport: boolean;\n    canReopen: boolean;\n    canDecideConflict: boolean;\n  };", 1)
open(tp, 'w', encoding='utf8', newline='').write(s)

# list page: show the notice after a declared conflict
lp = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\app\app\evaluations\page.tsx'
l = open(lp, encoding='utf8', newline='').read()
l = l.replace("export default async function EvaluationsPage() {", "export default async function EvaluationsPage({ searchParams }: { searchParams: Promise<{ conflict?: string }> }) {\n  const { conflict } = await searchParams;", 1)
l = l.replace("      {(data?.ready ?? []).length > 0 && (", """      {conflict === '1' && (
        <p role="status" className="rounded-md border border-warning bg-warning-bg p-3 text-sm font-medium text-warning" data-testid="conflict-notice">
          Your conflict of interest was recorded and your access to that evaluation is suspended. A delegate will decide, and you will be notified of the outcome.
        </p>
      )}

      {(data?.ready ?? []).length > 0 && (""", 1)
open(lp, 'w', encoding='utf8', newline='').write(l)
print('ok')
