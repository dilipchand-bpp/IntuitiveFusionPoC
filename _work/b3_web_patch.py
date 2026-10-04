p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\evaluation\evaluation-workspace.tsx'
s = open(p, encoding='utf8').read()


def rep(a, b, count=1):
    global s
    assert s.count(a) == count, (s.count(a), a[:70])
    s = s.replace(a, b)


rep("""import { Card, problem } from './eval-card';
import type { EvalCriterion, EvalView, MyScores } from './types';""", """import { Card, problem } from './eval-card';
import { ClarificationsPanel, NegotiationPanel, PlainScoreEntry, RankingEntry } from './b3-commercial';
import {
  AdvisorAllocation,
  CompliancePanel,
  CriteriaEditor,
  HoldBanner,
  HoldControls,
  PanelTools,
  ProbityDocs,
  RedeclarePrompt,
  ReportCoi,
  StagesCard,
} from './b3-governance';
import type { EvalCriterion, EvalView, MyScores } from './types';""")

rep("""export function EvaluationWorkspace({ initial, csrf }: { initial: EvalView; csrf: string }) {
  const router = useRouter();
  const [ev, setEv] = useState(initial);""", """export function EvaluationWorkspace({
  initial,
  csrf,
  roles = [],
}: {
  initial: EvalView;
  csrf: string;
  roles?: string[];
}) {
  const router = useRouter();
  const [ev, setEv] = useState(initial);
  const [sheetKey, setSheetKey] = useState(0);""")

rep("""        {!me && <Badge tone="neutral">Read-only view</Badge>}
      </div>
      <Stepper steps={STEPS} current={STEP_OF[ev.status]} />
""", """        {!me && <Badge tone="neutral">Read-only view</Badge>}
        {ev.mode === 'RANKING' && <Badge tone="warning">Ranking evaluation</Badge>}
        {ev.stage > 1 && <Badge tone="info">Stage {ev.stage}</Badge>}
      </div>
      <Stepper steps={STEPS} current={STEP_OF[ev.status]} />
      <HoldBanner ev={ev} />
""")

rep("""      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">""", """      <HoldControls ev={ev} csrf={csrf} roles={roles} onChange={setEv} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">""")

# aside: panel tools and stages after the panel card
rep("""          {ev.conflicts.length > 0 && (
            <ConflictReview ev={ev} csrf={csrf} onDone={setEv} run={run} busy={busy} />
          )}
""", """          <PanelTools ev={ev} csrf={csrf} roles={roles} onChange={setEv} />

          {ev.conflicts.length > 0 && (
            <ConflictReview ev={ev} csrf={csrf} onDone={setEv} run={run} busy={busy} />
          )}
""")

# main column
rep("""          <StageGuide ev={ev} />
          {!suppliersInRail && suppliersCard(true)}""", """          <StageGuide ev={ev} />
          <StagesCard ev={ev} />
          <CompliancePanel ev={ev} csrf={csrf} roles={roles} onChange={setEv} />
          <CriteriaEditor ev={ev} csrf={csrf} roles={roles} onChange={setEv} />
          <RedeclarePrompt ev={ev} csrf={csrf} roles={roles} onChange={setEv} />
          {!suppliersInRail && suppliersCard(true)}""")

rep("""          {p.canScore && <ScoringSheet ev={ev} csrf={csrf} onDone={refresh} />}
""", """          {p.canScore && ev.mode === 'RANKING' && <RankingEntry ev={ev} csrf={csrf} onDone={refresh} />}
          {p.canScore && ev.mode !== 'RANKING' && (
            <>
              <PlainScoreEntry ev={ev} csrf={csrf} onSaved={() => setSheetKey((k) => k + 1)} />
              <ScoringSheet key={sheetKey} ev={ev} csrf={csrf} onDone={refresh} />
            </>
          )}
""")

rep("""                    <span className="font-mono text-sm">{r.weightedScore.toFixed(1)} / 100</span>
                    {r.compliance === 'FAIL' && <Badge tone="error">Not compliant</Badge>}""", """                    <span className="font-mono text-sm">{r.weightedScore.toFixed(1)} / 100</span>
                    {r.tco !== null && (
                      <span className="text-xs text-text-muted">
                        Total cost AUD {Math.round(r.tco).toLocaleString('en-AU')}
                        {r.priceScore !== null ? ` (price score ${r.priceScore.toFixed(1)})` : ''}
                      </span>
                    )}
                    {r.compliance === 'FAIL' && <Badge tone="error">Not compliant</Badge>}""")

rep("""          {p.canReopen && <ReopenCard ev={ev} csrf={csrf} onDone={setEv} />}

          <ReportPanel ev={ev} csrf={csrf} busy={busy} run={run} post={post} setEv={setEv} />""", """          <ClarificationsPanel ev={ev} csrf={csrf} roles={roles} />
          <NegotiationPanel ev={ev} csrf={csrf} roles={roles} />

          {p.canReopen && <ReopenCard ev={ev} csrf={csrf} onDone={setEv} />}

          <ReportPanel ev={ev} csrf={csrf} roles={roles} busy={busy} run={run} post={post} setEv={setEv} />
          <ProbityDocs ev={ev} csrf={csrf} roles={roles} />
          <AdvisorAllocation ev={ev} csrf={csrf} roles={roles} />""")

# report panel
rep("""function ReportPanel({
  ev,
  csrf,
  busy,
  run,
  post,
  setEv,
}: {
  ev: EvalView;
  csrf: string;
  busy: string | null;""", """function ReportPanel({
  ev,
  csrf,
  roles,
  busy,
  run,
  post,
  setEv,
}: {
  ev: EvalView;
  csrf: string;
  roles: string[];
  busy: string | null;""")
rep("""  void csrf;
  return (
    <Card
      id="rep-h"
      title="Evaluation report\"""", """  return (
    <Card
      id="rep-h"
      title="Evaluation report\"""")
rep("""            {rep.status === 'APPROVED'
              ? 'Approved'
              : rep.status === 'DRAFT'
                ? 'Needs regenerating'
                : 'Awaiting approval'}""", """            {rep.status === 'APPROVED'
              ? 'Approved'
              : rep.status === 'DRAFT'
                ? ev.status === 'LOCKED'
                  ? 'Draft: ready to review'
                  : 'Needs regenerating'
                : 'Awaiting approval'}""")
rep("""            {rep ? 'Regenerate report' : 'Generate report'}""", """            {rep && ev.status !== 'LOCKED' ? 'Regenerate report' : 'Generate report'}""")
rep("""          <Button asChild variant="secondary">
            <a href={`/api/v1/evaluations/${ev.id}/report/docx`} download className="text-text no-underline">
              <FileDown className="size-4" aria-hidden="true" />
              Download Word
            </a>
          </Button>
        </div>
      )}""", """          <Button asChild variant="secondary">
            <a href={`/api/v1/evaluations/${ev.id}/report/docx`} download className="text-text no-underline">
              <FileDown className="size-4" aria-hidden="true" />
              Download Word
            </a>
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      )}""")
rep("""          <p className="mt-2 text-sm text-text-muted">
            Generated {formatDateTime(rep.generatedAt)} from the locked consensus scores.
          </p>
          <div className="mt-3 flex flex-col gap-4">
            {rep.sections.map((s) => (""", """          <p className="mt-2 text-sm text-text-muted">
            Generated {formatDateTime(rep.generatedAt)} from the locked consensus scores.
            {rep.status === 'AWAITING_APPROVAL' && rep.routedTo.length > 0 && (
              <>
                {' '}
                Sent for approval to <strong data-testid="routed-to">{rep.routedTo.join(' or ')}</strong>, whose
                sourcing authority covers AUD {Math.round(rep.value).toLocaleString('en-AU')}.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-col gap-4" data-print-area>
            <p className="hidden print:block">
              {ev.requestNumber} {ev.title}: report {rep.id.slice(0, 8).toUpperCase()}, evaluation version{' '}
              {ev.version}, generated {formatDateTime(rep.generatedAt)}.
            </p>
            {rep.sections.filter((x) => x.paragraphs.length > 0).map((s) => (""")
rep("""      {p.canDecideReport && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">""", """      {rep && <ReportCoi ev={ev} csrf={csrf} roles={roles} reportId={rep.id} />}
      {p.canDecideReport && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">""")

# icons
rep("""  Lock,
  RotateCcw,""", """  Lock,
  Printer,
  RotateCcw,""")

# conflicts: exclusion for a minor conflict
rep("""  const [why, setWhy] = useState<Record<string, string>>({});
  const decide = (userId: string, disposition: 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL') =>""", """  const [why, setWhy] = useState<Record<string, string>>({});
  const [exclude, setExclude] = useState<Record<string, string>>({});
  const decide = (userId: string, disposition: 'IMMATERIAL' | 'MANAGEABLE' | 'MATERIAL') =>""")
rep("""            body: { disposition, ...(why[userId] ? { rationale: why[userId] } : {}) },""", """            body: {
              disposition,
              ...(why[userId] ? { rationale: why[userId] } : {}),
              ...(disposition === 'MANAGEABLE' && exclude[userId] ? { excludeSupplierId: exclude[userId] } : {}),
            },""")
rep("""                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={busy === `conflict-${c.userId}`}
                    onClick={() => void decide(c.userId, 'IMMATERIAL')}""", """                <Field
                  label={`Supplier ${c.name} must not assess (for a manageable conflict)`}
                  hint="A manageable (minor) conflict keeps the person on the panel but away from this supplier."
                >
                  <Select
                    value={exclude[c.userId] ?? ''}
                    onChange={(e) => setExclude((cur) => ({ ...cur, [c.userId]: e.target.value }))}
                  >
                    <option value="">None: reinstate fully</option>
                    {ev.suppliers.map((s) => (
                      <option key={s.supplierId} value={s.supplierId}>
                        {s.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={busy === `conflict-${c.userId}`}
                    onClick={() => void decide(c.userId, 'IMMATERIAL')}""")
rep("""  MANAGEABLE: 'Manageable: reinstated',""", """  MANAGEABLE: 'Manageable: reinstated (may be kept from one supplier)',""")

open(p, 'w', encoding='utf8').write(s)
print('ok')
