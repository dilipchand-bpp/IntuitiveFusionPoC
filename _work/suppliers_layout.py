import re

p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\evaluation\evaluation-workspace.tsx'
t = open(p, encoding='utf8', newline='').read()

a = t.index('          <Card id="sup-h" title="Suppliers"')
b = t.index('</Card>', a) + len('</Card>')
block = t[a:b]
# the list becomes a grid when the card sits in the wide main column
assert 'className="mt-3 flex flex-col gap-3"' in block
block = block.replace('className="mt-3 flex flex-col gap-3"', "className={cn('mt-3 gap-3', wide ? 'grid sm:grid-cols-2' : 'flex flex-col')}", 1)
card_fn = '  const suppliersCard = (wide: boolean) => (\n' + block + '\n  );\n'

t = t[:a] + '          {suppliersInRail && suppliersCard(false)}' + t[b:]

anchor = '  return (\n    <div className="flex flex-col gap-6" data-testid="evaluation-workspace"'
assert anchor in t
decide = '''  // People who score or agree consensus keep the documents beside their work; read-only roles get them in the main column.
  const suppliersInRail = p.canScore || p.canSetConsensus || ev.consensus.length > 0 || me?.coiState === 'NOT_DECLARED';
'''
t = t.replace(anchor, decide + card_fn + '\n' + anchor, 1)
t = t.replace('          <StageGuide ev={ev} />\n', '          <StageGuide ev={ev} />\n          {!suppliersInRail && suppliersCard(true)}\n', 1)
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
