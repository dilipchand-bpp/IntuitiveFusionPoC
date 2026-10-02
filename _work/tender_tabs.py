p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\tender\tender-workspace.tsx'
t = open(p, encoding='utf8', newline='').read()

a = t.index('      {/* ---------------------------------------------------------- pack */}')
end_marker = '      </Card>\n    </div>\n  );\n}\n\nfunction PackSection('
b = t.index(end_marker) + len('      </Card>\n')
block = t[a:b]

pack_start = block.index('      <section aria-labelledby="pack-h"')
pack_end = block.index('      </section>\n', pack_start) + len('      </section>\n')
pack = block[pack_start:pack_end]
bids_start = block.index('      <Card role="region" aria-labelledby="bids-h">')
bids = block[bids_start:]

new = '''      <Tabs
        label="Tender sections"
        items={[
          {
            value: 'pack',
            label: 'Tender pack',
            content: (
''' + pack + '''            ),
          },
          {
            value: 'invitations',
            label: `Invitations (${t.invitations.length})`,
            content: <InvitePanel t={t} csrf={csrf} onDone={refresh} />,
          },
          {
            value: 'qa',
            label: toAnswer > 0 ? `Questions and addenda (${toAnswer} to answer)` : 'Questions and addenda',
            content: <QaPanel t={t} csrf={csrf} onDone={refresh} />,
          },
          {
            value: 'bids',
            label: `Bids (${t.submissions.count})`,
            content: (
''' + bids + '''            ),
          },
        ]}
      />
'''
t = t[:a] + new + t[b:]
t = t.replace("import { Badge, Button, Card, Field, Input, Stepper, Textarea } from '@if/ui';",
              "import { Badge, Button, Card, Field, Input, Stepper, Tabs, Textarea } from '@if/ui';")
t = t.replace("  const refresh = useCallback(", "  const toAnswer = t.questions.filter((q) => q.status !== 'PUBLISHED').length;\n  const refresh = useCallback(", 1)
open(p, 'w', encoding='utf8', newline='').write(t)

# tab strip must scroll sideways on a phone instead of overflowing the page
n = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\packages\ui\src\components\nav.tsx'
s = open(n, encoding='utf8', newline='').read()
s = s.replace('className="flex gap-1 border-b border-border"', 'className="flex gap-1 overflow-x-auto border-b border-border"', 1)
s = s.replace("'min-h-[44px] border-b-2 border-transparent px-4 text-sm font-semibold text-text-muted',", "'min-h-[44px] shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 text-sm font-semibold text-text-muted',", 1)
open(n, 'w', encoding='utf8', newline='').write(s)
print('ok')
