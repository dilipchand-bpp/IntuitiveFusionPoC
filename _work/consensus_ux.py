p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\evaluation\evaluation-workspace.tsx'
t = open(p, encoding='utf8', newline='').read()

# helper + handler after `const reason = ...`
anchor = "  const reason = (s: string, c: string) => why[key(s, c)] ?? row(s, c)?.rationale ?? '';"
assert anchor in t
helper = anchor + '''

  /** The average of the individual scores, to the nearest half point: only a starting suggestion for agreeing scores. */
  const average = (s: string, c: string) => {
    const xs = row(s, c)?.individual?.map((i) => i.score) ?? [];
    return xs.length ? String(Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 2) / 2) : '';
  };
  const useAverages = () =>
    setVals((cur) => {
      const next = { ...cur };
      for (const r of ev.consensus)
        if (!r.flagged && r.consensusScore === null && next[key(r.supplierId, r.criterionId)] === undefined) {
          const c = ev.criteria.find((x) => x.id === r.criterionId);
          const a = average(r.supplierId, r.criterionId);
          if (a && c && !c.passFail) next[key(r.supplierId, r.criterionId)] = a;
        }
      return next;
    });
  const needReason = ev.consensus.filter((r) => r.flagged && (reason(r.supplierId, r.criterionId).trim().length < 10)).length;'''
t = t.replace(anchor, helper, 1)

# button + summary under the intro paragraph (editable only)
intro_end = "          : 'Read-only view of the consensus discussion.'}\n      </p>"
assert intro_end in t
t = t.replace(intro_end, intro_end + '''
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={useAverages}>
            Use the average where scorers agree
          </Button>
          <span className="text-sm text-text-muted" role="status">
            {needReason > 0
              ? `${needReason} flagged score(s) still need a reason.`
              : ev.consensus.some((r) => r.flagged)
                ? 'Every flagged score has a reason.'
                : 'No scores are flagged.'}
          </span>
        </div>
      )}''', 1)
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
