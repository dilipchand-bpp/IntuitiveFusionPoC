def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:60])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


w = 'apps/web/src/components/'
rw(w + 'plan/plan-workspace.tsx', [("body: { value: draft, expectedVersion: plan.version },", "body: { value: draft, expectedRev: f.rev ?? 0 },")])
rw(w + 'tender/tender-workspace.tsx', [("body: { value: text, expectedVersion: version },", "body: { value: text, expectedRev: field.rev ?? 0 },")])
rw(w + 'plan/types.ts', [("export interface PlanField {", "export interface PlanField {\n  /** Counts changes to this section, so a concurrent edit of it is noticed (FR-0735). */\n  rev?: number;")])
rw(w + 'tender/types.ts', [("export interface TenderField {", "export interface TenderField {\n  /** Counts changes to this section, so a concurrent edit of it is noticed (FR-0735). */\n  rev?: number;")])
print('ok')
