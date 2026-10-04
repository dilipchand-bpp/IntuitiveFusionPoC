p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\admin\settings-panel.tsx'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)


rep("""  erpFieldMap: Array<{ erpName: string; platformKey: string }>;
  workflowRouting:""", """  criteriaLibrary: Array<{
    name: string;
    stream: 'TECHNICAL' | 'COMMERCIAL' | 'OTHER';
    weight: number;
    passFail: boolean;
  }>;
  evaluationRules: {
    requireInsurance: boolean;
    rankingMaxValueAud: number;
    redeclarationReminderHours: number;
    clarificationDays: number;
  };
  erpFieldMap: Array<{ erpName: string; platformKey: string }>;
  workflowRouting:""")

rep("""      <Section
        {...sec('security')}
        title="Sign-in security\"""", """      <Section
        {...sec('evaluationRules')}
        title="Evaluation rules"
        blurb="How evaluations run: the compliance gate, when ranking may replace scoring, and how often reminders go out."
        onSave={() => void save('evaluationRules', s.evaluationRules)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.evaluationRules.requireInsurance}
            onChange={(e) =>
              setS({ ...s, evaluationRules: { ...s.evaluationRules, requireInsurance: e.target.checked } })
            }
          />
          <span>A supplier with no insurance certificate on record fails the compliance gate (an expired one always fails)</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ranking allowed up to (AUD)">
            <Input
              type="number"
              min={0}
              value={s.evaluationRules.rankingMaxValueAud}
              onChange={(e) =>
                setS({ ...s, evaluationRules: { ...s.evaluationRules, rankingMaxValueAud: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Reminder every (hours)">
            <Input
              type="number"
              min={1}
              max={720}
              value={s.evaluationRules.redeclarationReminderHours}
              onChange={(e) =>
                setS({
                  ...s,
                  evaluationRules: { ...s.evaluationRules, redeclarationReminderHours: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Days to answer a clarification">
            <Input
              type="number"
              min={1}
              max={60}
              value={s.evaluationRules.clarificationDays}
              onChange={(e) =>
                setS({ ...s, evaluationRules: { ...s.evaluationRules, clarificationDays: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('criteriaLibrary')}
        title="Criteria library"
        blurb="The criteria procurement chooses from when setting up an evaluation. Each evaluation, and each stage of it, picks its own and sets the weights."
        onSave={() => void save('criteriaLibrary', s.criteriaLibrary)}
      >
        <ul className="flex flex-col gap-2" aria-label="Library criteria">
          {s.criteriaLibrary.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{c.name}</span>{' '}
                <span className="text-text-muted">
                  {{ TECHNICAL: 'Technical', COMMERCIAL: 'Commercial', OTHER: 'Shared' }[c.stream]}
                  {c.passFail ? ', pass or fail' : `, usual weight ${c.weight}`}
                </span>
              </span>
              <Button
                variant="secondary"
                aria-label={`Remove ${c.name} from the library`}
                onClick={() => setS({ ...s, criteriaLibrary: s.criteriaLibrary.filter((_, j) => j !== i) })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <LibraryAdd onAdd={(c) => setS({ ...s, criteriaLibrary: [...s.criteriaLibrary, c] })} />
      </Section>

      <Section
        {...sec('security')}
        title="Sign-in security\"""")

s += """
function LibraryAdd({ onAdd }: { onAdd: (c: SettingsData['criteriaLibrary'][number]) => void }) {
  const [name, setName] = useState('');
  const [stream, setStream] = useState<'TECHNICAL' | 'COMMERCIAL' | 'OTHER'>('TECHNICAL');
  const [weight, setWeight] = useState('10');
  const [passFail, setPassFail] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <Field label="New criterion">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-72 max-w-full" />
      </Field>
      <Field label="Stream">
        <Select value={stream} onChange={(e) => setStream(e.target.value as typeof stream)}>
          <option value="TECHNICAL">Technical</option>
          <option value="COMMERCIAL">Commercial</option>
          <option value="OTHER">Shared</option>
        </Select>
      </Field>
      <Field label="Usual weight">
        <Input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} className="w-24" />
      </Field>
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={passFail} onChange={(e) => setPassFail(e.target.checked)} />
        Pass or fail
      </label>
      <Button
        variant="secondary"
        disabled={name.trim().length < 3}
        onClick={() => {
          onAdd({ name: name.trim(), stream, weight: passFail ? 0 : Number(weight) || 0, passFail });
          setName('');
        }}
      >
        Add to the library
      </Button>
    </div>
  );
}
"""
open(p, 'w', encoding='utf8').write(s)
print('ok')
