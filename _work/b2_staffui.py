root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src'


def edit(rel, pairs):
    p = f'{root}\\{rel}'
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (rel, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)


edit('components/tender/types.ts', [
    ("  status: 'OPEN' | 'ANSWERED' | 'PUBLISHED';\n  askedAt: string;\n}", "  status: 'OPEN' | 'ANSWERED' | 'PUBLISHED';\n  /** SINGLE: the answer goes only to the supplier who asked (FR-0195). */\n  audience?: 'ALL' | 'SINGLE';\n  askedAt: string;\n}"),
    ("  version: number;\n  planStatus: string | null;", "  version: number;\n  stage?: number;\n  parentTenderId?: string | null;\n  planStatus: string | null;"),
    ("  invitations: Array<{ id: string; email: string; company: string; state: string; expiresAt: string }>;", "  invitations: Array<{\n    id: string;\n    email: string;\n    company: string;\n    supplierId?: string | null;\n    state: string;\n    expiresAt: string;\n  }>;"),
    ("      receipt: string | null;\n      submittedAt: string | null;\n    }>;", "      receipt: string | null;\n      submittedAt: string | null;\n      sanctionsStatus?: string;\n      insuranceStatus?: string;\n    }>;"),
])
edit('components/tender/tender-workspace.tsx', [
    ("import type { TenderView } from './types';", "import { TenderB2Panel } from './b2-panel';\nimport type { TenderView } from './types';"),
    ("export function TenderWorkspace({ initial, csrf }: { initial: TenderView; csrf: string }) {", "export function TenderWorkspace({\n  initial,\n  csrf,\n  roles = [],\n}: {\n  initial: TenderView;\n  csrf: string;\n  roles?: string[];\n}) {"),
    ("                        <span className=\"font-semibold\">{b.company}</span>\n                        <span className=\"font-mono text-xs\">{b.receipt}</span>",
     "                        <span className=\"font-semibold\">{b.company}</span>\n                        <span className=\"flex gap-1\">\n                          {b.sanctionsStatus === 'MATCH' && <Badge tone=\"error\">Screening match</Badge>}\n                          {b.insuranceStatus && b.insuranceStatus !== 'CURRENT' && (\n                            <Badge tone={b.insuranceStatus === 'EXPIRED' ? 'error' : 'warning'}>\n                              Insurance {b.insuranceStatus.toLowerCase()}\n                            </Badge>\n                          )}\n                        </span>\n                        <span className=\"font-mono text-xs\">{b.receipt}</span>"),
    ("          {\n            value: 'bids',\n            label: `Bids (${t.submissions.count})`,", "          {\n            value: 'stages',\n            label: (t.stage ?? 1) > 1 ? `Stage ${t.stage}, register and notices` : 'Stages, register and notices',\n            content: <TenderB2Panel t={t} roles={roles} csrf={csrf} />,\n          },\n          {\n            value: 'bids',\n            label: `Bids (${t.submissions.count})`,"),
    # answer audience
    ("                <Field label=\"Answer\">\n                  <Textarea\n                    rows={3}\n                    value={answers[q.id] ?? q.answer ?? ''}\n                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}\n                    maxLength={4000}\n                  />\n                </Field>",
     "                <Field label=\"Answer\">\n                  <Textarea\n                    rows={3}\n                    value={answers[q.id] ?? q.answer ?? ''}\n                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}\n                    maxLength={4000}\n                  />\n                </Field>\n                <Field label=\"Who should get this answer?\">\n                  <Select\n                    value={audiences[q.id] ?? 'ALL'}\n                    onChange={(e) => setAudiences((a) => ({ ...a, [q.id]: e.target.value as 'ALL' | 'SINGLE' }))}\n                  >\n                    <option value=\"ALL\">Everyone, published with the next addendum</option>\n                    <option value=\"SINGLE\">Only the supplier who asked, sent now</option>\n                  </Select>\n                </Field>"),
    ("                      body: { answer: answers[q.id] ?? q.answer ?? '' },", "                      body: { answer: answers[q.id] ?? q.answer ?? '', audience: audiences[q.id] ?? 'ALL' },"),
    ("  const [answers, setAnswers] = useState<Record<string, string>>({});", "  const [answers, setAnswers] = useState<Record<string, string>>({});\n  const [audiences, setAudiences] = useState<Record<string, 'ALL' | 'SINGLE'>>({});"),
    ("            {q.status === 'PUBLISHED' && <p className=\"mt-2 text-sm\">{q.answer}</p>}", "            {q.status === 'PUBLISHED' && (\n              <p className=\"mt-2 text-sm\">\n                {q.answer}\n                {q.audience === 'SINGLE' && <span className=\"ml-2 text-xs text-text-muted\">(sent to the asker only)</span>}\n              </p>\n            )}"),
    ("import { Badge, Button, Card, Field, Input, Stepper, Tabs, Textarea } from '@if/ui';", "import { Badge, Button, Card, Field, Input, Select, Stepper, Tabs, Textarea } from '@if/ui';"),
])
edit('app/app/tenders/[id]/page.tsx', [
    ("<TenderWorkspace initial={res.data} csrf={user.csrfToken} />", "<TenderWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />"),
])
print('ok')
