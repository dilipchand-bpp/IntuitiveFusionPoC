def sub(p, a, b):
    t = open(p, encoding='utf8', newline='').read()
    assert a in t, (p, a[:80])
    open(p, 'w', encoding='utf8', newline='').write(t.replace(a, b, 1))


R = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db'
sub(R + r'\schema.ts', "      .default('NOT_DECLARED'),\n  },\n  (t) => [uniqueIndex('panel_member_uq')",
    "      .default('NOT_DECLARED'),\n    /** When the member marked their scoring complete (the chair needs all of them before opening consensus). */\n    scoredAt: timestamp('scored_at', { withTimezone: true }),\n  },\n  (t) => [uniqueIndex('panel_member_uq')")

S = R + r'\seed.ts'
# panel members finished scoring
sub(S, "        stream,\n        coiState: 'DECLARED_NONE',\n      });", "        stream,\n        coiState: 'DECLARED_NONE',\n        scoredAt: day(-3),\n      });")

# who may score what: a technical member never scores price, a commercial member never scores technical criteria
a = open(S, encoding='utf8', newline='').read()
i = a.index("    const scorers = [\n      ['evaluator-tech', 0],")
j = a.index("    await log(\n      'evaluation.consensus_open',")
new = '''    // Stream rules (same as the application): technical members score technical and "other" criteria only (never price),
    // commercial members score commercial and "other" only, the chair (stream OTHER) can score everything.
    const scorers = [
      ['evaluator-tech', 0, 'TECHNICAL'],
      ['evaluator-comm', -0.3, 'COMMERCIAL'],
      ['chair', 0.2, 'OTHER'],
    ] as const;
    const may = (stream: string, criterionStream: string) =>
      stream === 'OTHER' || criterionStream === 'OTHER' || stream === criterionStream;
    // engineered disagreement: the technical evaluator and the chair differ by 37.5% on Brightwave's technical capability
    const value = (key: string, ci: number, who: string, delta: number) =>
      key === 'brightwave' && ci === 0 && who === 'chair'
        ? 5.0
        : Math.max(0, Math.min(10, base[key]![ci]! + delta));
    for (const sp of SUPPLIERS) {
      for (const [ci, [, , cStream]] of crit.entries()) {
        for (const [who, delta, stream] of scorers) {
          if (!may(stream, cStream)) continue;
          await tx.insert(s.score).values({
            tenantId: TENANT_ID,
            evaluationId: ev,
            supplierId: uid(`supplier:${sp.key}`),
            criterionId: uid(`criterion:${ci}`),
            evaluatorId: userId(who),
            score: value(sp.key, ci, who, delta).toFixed(2),
          });
        }
      }
    }
    for (const sp of SUPPLIERS)
      for (const [ci, [, , cStream]] of crit.entries()) {
        const vals = scorers
          .filter(([, , stream]) => may(stream, cStream))
          .map(([who, delta]) => value(sp.key, ci, who, delta));
        const variance = ((Math.max(...vals) - Math.min(...vals)) / Math.max(...vals)) * 100;
        await tx.insert(s.consensusItem).values({
          tenantId: TENANT_ID,
          evaluationId: ev,
          supplierId: uid(`supplier:${sp.key}`),
          criterionId: uid(`criterion:${ci}`),
          variancePct: variance.toFixed(2),
          flagged: variance > 30,
        });
      }
'''
a = a[:i] + new + a[j:]
open(S, 'w', encoding='utf8', newline='').write(a)
print('ok')
