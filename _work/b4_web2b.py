import os
root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src'


def write(path, text):
    p = root + '\\' + path
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf8').write(text)


def patch(path, pairs):
    p = root + '\\' + path
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, s.count(a), a[:80])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)


patch(r'..\..\..\packages\shared\src\access.ts', [
    ("  { prefix: '/app/probity', roles: ['PROBITY'] },", "  { prefix: '/app/probity', roles: ['PROBITY'] },\n  { prefix: '/app/legal', roles: ['LEGAL', 'PROCUREMENT'] },"),
])

# ------------------------------------------------------------------ banking details on the supplier profile
patch(r'components\supplier\supplier-profile.tsx', [
    ("""      <Card role="region" aria-labelledby="priv-h" data-testid="privacy-card">""", """      <BankCard csrf={csrf} />

      <Card role="region" aria-labelledby="priv-h" data-testid="privacy-card">"""),
])
s = open(root + r'\components\supplier\supplier-profile.tsx', encoding='utf8').read()
s += """
/** Banking details, checked against the company's legal name before a contract can be signed (FR-0415). */
function BankCard({ csrf }: { csrf: string }) {
  const [f, setF] = useState({ bsb: '', account: '', accountName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api<{ account: string }>('/supplier/profile/bank', { method: 'PUT', csrf, body: f });
      setNote(`Saved. Account ${r.account} is on record.`);
      setF({ bsb: '', account: '', accountName: '' });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card role="region" aria-labelledby="bank-h" data-testid="bank-card">
      <h2 id="bank-h" className="font-heading text-xl font-bold">
        Banking details
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        The account name must match your company&apos;s legal name. The buyer checks this before a contract is signed. Only
        the last three digits are ever shown back to you.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="BSB">
          <Input value={f.bsb} onChange={(e) => setF({ ...f, bsb: e.target.value })} placeholder="062-000" />
        </Field>
        <Field label="Account number">
          <Input value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label="Account name">
          <Input value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-2 text-sm font-medium text-success">
          {note}
        </p>
      )}
      <div className="mt-3">
        <Button variant="secondary" loading={busy} disabled={!f.bsb || !f.account || !f.accountName} onClick={() => void save()}>
          Save banking details
        </Button>
      </div>
    </Card>
  );
}
"""
open(root + r'\components\supplier\supplier-profile.tsx', 'w', encoding='utf8').write(s)

# ------------------------------------------------------------------ settings
patch(r'components\admin\settings-panel.tsx', [
    ("""  criteriaLibrary: Array<{""", """  contractRules: {
    requireBankDetails: boolean;
    requireRiskSummaryReview: boolean;
    endorsements: Array<'LEGAL' | 'FINANCE'>;
    protectedClauses: string[];
    negotiationLockDays: number;
    signingReminderHours: number;
  };
  criteriaLibrary: Array<{"""),
    ("""      <Section
        {...sec('criteriaLibrary')}""", """      <Section
        {...sec('contractRules')}
        title="Contract rules"
        blurb="What must happen before a contract is released for signing, which clauses are non-negotiable, and how long a negotiation may run."
        onSave={() => void save('contractRules', s.contractRules)}
      >
        {(
          [
            ['requireBankDetails', 'The supplier must have banking details on record, matching its legal name'],
            ['requireRiskSummaryReview', 'Legal must review the risk summary before a contract is released'],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={s.contractRules[key]}
              onChange={(e) => setS({ ...s, contractRules: { ...s.contractRules, [key]: e.target.checked } })}
            />
            <span>{text}</span>
          </label>
        ))}
        <fieldset className="flex flex-wrap gap-4">
          <legend className="text-sm font-semibold">Endorsements needed before release</legend>
          {(['LEGAL', 'FINANCE'] as const).map((r) => (
            <label key={r} className="flex min-h-[44px] items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-[var(--if-color-accent)]"
                checked={s.contractRules.endorsements.includes(r)}
                onChange={(e) =>
                  setS({
                    ...s,
                    contractRules: {
                      ...s.contractRules,
                      endorsements: e.target.checked
                        ? [...s.contractRules.endorsements, r]
                        : s.contractRules.endorsements.filter((x) => x !== r),
                    },
                  })
                }
              />
              {r === 'LEGAL' ? 'Legal' : 'Finance'}
            </label>
          ))}
        </fieldset>
        <Field label="Non-negotiable clause ids (comma separated)" >
          <Input
            value={s.contractRules.protectedClauses.join(', ')}
            onChange={(e) =>
              setS({
                ...s,
                contractRules: {
                  ...s.contractRules,
                  protectedClauses: e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
                },
              })
            }
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lock signing after this many days of negotiation">
            <Input
              type="number"
              min={1}
              max={365}
              value={s.contractRules.negotiationLockDays}
              onChange={(e) =>
                setS({ ...s, contractRules: { ...s.contractRules, negotiationLockDays: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Remind unsigned signatories every (hours)">
            <Input
              type="number"
              min={1}
              max={720}
              value={s.contractRules.signingReminderHours}
              onChange={(e) =>
                setS({ ...s, contractRules: { ...s.contractRules, signingReminderHours: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('criteriaLibrary')}"""),
])
print('ok')
