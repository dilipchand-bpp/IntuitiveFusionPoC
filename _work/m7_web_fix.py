root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\plan'

def edit(f, pairs):
    p = root + '\\' + f
    t = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in t, (f, old[:60])
        t = t.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(t)

edit('types.ts', [("export interface PlanConflict {\n  id: string;\n", "export interface PlanConflict {\n  id: string;\n  userId: string;\n")])
edit('plan-workspace.tsx', [
    ("{p.canDecideConflict && c.disposition === 'PENDING' && c.userName !== '' && (", "{p.canDecideConflict && c.disposition === 'PENDING' && c.userId !== props.userId && ("),
])
print('ok')
