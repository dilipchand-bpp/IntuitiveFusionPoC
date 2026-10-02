p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\requests\intake-chat.tsx'
t = open(p, encoding='utf8', newline='').read()
a = t.index('          <div>\n            <h2 className="font-heading text-lg font-semibold">Your request draft</h2>')
b = t.index('        )}\n      </aside>')
new = '''          <div className="flex flex-col gap-4">
            <div>
              <h2 className="font-heading text-xl font-bold">Your request draft</h2>
              <p className="mt-1 text-sm text-text-muted">
                As you describe your need, the draft appears here. You can change any field before submitting.
              </p>
            </div>
            <ul className="flex flex-col gap-2" aria-label="What the assistant will fill in">
              {[
                [FileText, 'What you need', 'Title, category and a short background'],
                [Banknote, 'Size and term', 'Estimated value and contract length'],
                [Building2, 'Who owns it', 'Business unit and contract owner'],
                [ShieldCheck, 'What it needs', 'Complexity and the approvals it will require'],
              ].map(([Icon, title, text]) => {
                const I = Icon as typeof FileText;
                return (
                  <li key={title as string} className="flex items-start gap-3 rounded-lg border border-dashed border-border-strong p-3">
                    <span className="icon-tile !size-9 shrink-0">
                      <I className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 text-sm">
                      <strong className="block">{title as string}</strong>
                      <span className="text-text-muted">{text as string}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
'''
t = t[:a] + new + t[b:]
t = t.replace("import { Send } from 'lucide-react';", "import { Banknote, Building2, FileText, Send, ShieldCheck } from 'lucide-react';", 1)
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
