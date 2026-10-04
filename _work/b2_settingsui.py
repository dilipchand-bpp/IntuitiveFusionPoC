root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src'


def edit(rel, pairs):
    p = f'{root}\\{rel}'
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (rel, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)


SECTIONS = """      <Section
        {...sec('onboardingQuestions')}
        title="Supplier onboarding questions"
        blurb="Questions every new supplier answers when they register, for example about modern slavery or sustainability. A yes or no answer can be flagged so procurement looks at it before the supplier bids."
        onSave={() => void save('onboardingQuestions', s.onboardingQuestions)}
      >
        {s.onboardingQuestions.map((q, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2" data-testid="onboarding-question">
            <Field label={`Key ${i + 1}`} hint="letters and digits">
              <Input value={q.id} onChange={(e) => setS({ ...s, onboardingQuestions: s.onboardingQuestions.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} />
            </Field>
            <Field label={`Question ${i + 1}`}>
              <Input value={q.label} onChange={(e) => setS({ ...s, onboardingQuestions: s.onboardingQuestions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            </Field>
            <Field label={`Answer type ${i + 1}`}>
              <Select value={q.type} onChange={(e) => setS({ ...s, onboardingQuestions: s.onboardingQuestions.map((x, j) => (j === i ? { ...x, type: e.target.value as 'YESNO' | 'TEXT' } : x)) })}>
                <option value="YESNO">Yes or no</option>
                <option value="TEXT">Text</option>
              </Select>
            </Field>
            {q.type === 'YESNO' && (
              <Field label={`Flag when ${i + 1}`}>
                <Select
                  value={q.flagIf ?? ''}
                  onChange={(e) =>
                    setS({
                      ...s,
                      onboardingQuestions: s.onboardingQuestions.map((x, j) => {
                        if (j !== i) return x;
                        const { flagIf: _drop, ...rest } = x;
                        void _drop;
                        return e.target.value ? { ...rest, flagIf: e.target.value as 'YES' | 'NO' } : rest;
                      }),
                    })
                  }
                >
                  <option value="">Never</option>
                  <option value="NO">The answer is no</option>
                  <option value="YES">The answer is yes</option>
                </Select>
              </Field>
            )}
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-[var(--if-color-accent)]" checked={q.mandatory} onChange={(e) => setS({ ...s, onboardingQuestions: s.onboardingQuestions.map((x, j) => (j === i ? { ...x, mandatory: e.target.checked } : x)) })} aria-label={`Question ${i + 1} is required`} />
              Required
            </label>
            <Button variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => setS({ ...s, onboardingQuestions: s.onboardingQuestions.filter((_, j) => j !== i) })}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button variant="secondary" disabled={s.onboardingQuestions.length >= 15} onClick={() => setS({ ...s, onboardingQuestions: [...s.onboardingQuestions, { id: '', label: '', type: 'YESNO', mandatory: true }] })}>
            Add a question
          </Button>
        </div>
      </Section>

      <Section
        {...sec('publicRegisters')}
        title="Public registers"
        blurb="A public-sector tender at or above a register's value is sent to that register when it is published. Registers are simulated in the proof of concept."
        onSave={() => void save('publicRegisters', s.publicRegisters)}
      >
        {s.publicRegisters.map((r, i) => (
          <div key={r.register} className="flex flex-wrap items-end gap-3">
            <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold">
              <input type="checkbox" className="size-5 accent-[var(--if-color-accent)]" checked={r.enabled} onChange={(e) => setS({ ...s, publicRegisters: s.publicRegisters.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} aria-label={`Send to ${r.register}`} />
              {r.register}
            </label>
            <span className="text-sm text-text-muted">{r.jurisdiction}</span>
            <Field label={`${r.register} from (AUD)`}>
              <Input type="number" min={0} value={r.minValueAud} onChange={(e) => setS({ ...s, publicRegisters: s.publicRegisters.map((x, j) => (j === i ? { ...x, minValueAud: Number(e.target.value) } : x)) })} />
            </Field>
          </div>
        ))}
      </Section>

"""

edit('components/admin/settings-panel.tsx', [
    ("  security: { requireMfa: boolean; enforceSso: boolean; stepUpApprovals: boolean };\n", "  security: { requireMfa: boolean; enforceSso: boolean; stepUpApprovals: boolean };\n  onboardingQuestions: Array<{\n    id: string;\n    label: string;\n    type: 'YESNO' | 'TEXT';\n    mandatory: boolean;\n    flagIf?: 'YES' | 'NO';\n  }>;\n  publicRegisters: Array<{\n    register: 'AusTender' | 'SAM.gov' | 'TED';\n    jurisdiction: string;\n    minValueAud: number;\n    enabled: boolean;\n  }>;\n"),
    ("      <Section\n        {...sec('security')}", SECTIONS + "      <Section\n        {...sec('security')}"),
    ("export interface LogEntry {", "export interface EmailEntry {\n  id: string;\n  to: string;\n  subject: string;\n  kind: string;\n  status: string;\n  createdAt: string;\n}\nexport interface LogEntry {"),
    ("export function SettingsPanel({\n  initial,\n  log,\n  csrf,\n}: {\n  initial: SettingsData;\n  log: LogEntry[];\n  csrf: string;\n}) {", "export function SettingsPanel({\n  initial,\n  log,\n  emails = [],\n  csrf,\n}: {\n  initial: SettingsData;\n  log: LogEntry[];\n  emails?: EmailEntry[];\n  csrf: string;\n}) {"),
    ("        {entries.length > 0 && (\n          <Table caption=\"Recent deliveries\">", "        {emails.length > 0 && (\n          <Table caption=\"Recent emails to suppliers (simulated)\">\n            <thead>\n              <tr>\n                <Th>When</Th>\n                <Th>To</Th>\n                <Th>Subject</Th>\n                <Th>Kind</Th>\n              </tr>\n            </thead>\n            <tbody>\n              {emails.slice(0, 10).map((m) => (\n                <tr key={m.id} data-testid=\"email-row\">\n                  <Td label=\"When\" className=\"whitespace-nowrap text-xs\">\n                    {new Date(m.createdAt).toLocaleString('en-AU')}\n                  </Td>\n                  <Td label=\"To\" className=\"break-all text-xs\">\n                    {m.to}\n                  </Td>\n                  <Td label=\"Subject\">{m.subject}</Td>\n                  <Td label=\"Kind\">\n                    <Badge tone=\"info\">{m.kind.replace(/_/g, ' ').toLowerCase()}</Badge>\n                  </Td>\n                </tr>\n              ))}\n            </tbody>\n          </Table>\n        )}\n        {entries.length > 0 && (\n          <Table caption=\"Recent deliveries\">"),
])
edit('app/admin/settings/page.tsx', [
    ("import { SettingsPanel, type LogEntry, type SettingsData } from '@/components/admin/settings-panel';", "import {\n  SettingsPanel,\n  type EmailEntry,\n  type LogEntry,\n  type SettingsData,\n} from '@/components/admin/settings-panel';"),
    ("  const [me, settings, log] = await Promise.all([", "  const [me, settings, log, emails] = await Promise.all(["),
    ("    apiGet<LogEntry[]>('/admin/notification-log'),\n  ]);", "    apiGet<LogEntry[]>('/admin/notification-log'),\n    apiGet<EmailEntry[]>('/admin/email-log'),\n  ]);"),
    ("<SettingsPanel initial={settings} log={log ?? []} csrf={me.csrfToken} />", "<SettingsPanel initial={settings} log={log ?? []} emails={emails ?? []} csrf={me.csrfToken} />"),
])
print('ok')
