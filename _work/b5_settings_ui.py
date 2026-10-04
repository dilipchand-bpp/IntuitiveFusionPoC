p = 'apps/web/src/components/admin/settings-panel.tsx'
s = open(p, encoding='utf8', newline='').read()


def rep(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)


rep("""  criteriaLibrary: Array<{
    name: string;""", """  contractManagement: {
    erpIntegrated: boolean;
    variationModel: 'CUMULATIVE' | 'INCREMENTAL';
    variationNumbering: 'SUFFIX' | 'NEW_PROCUREMENT';
    publicSectorDisclosure: boolean;
    disclosureThresholdPct: number;
    disclosureDays: number;
    highValueAud: number;
    spendAlertPct: number;
    planTemplates: Array<{ kind: 'CMP' | 'RMP'; name: string; sections: Array<{ title: string; text: string }> }>;
  };
  criteriaLibrary: Array<{
    name: string;""")

section = """      <Section
        {...sec('contractManagement')}
        title="Contract management"
        blurb="How spend is guarded, how a variation is measured and disclosed, and when a contract gets management and risk plans."
        onSave={() => void save('contractManagement', s.contractManagement)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.contractManagement.erpIntegrated}
            onChange={(e) =>
              setS({ ...s, contractManagement: { ...s.contractManagement, erpIntegrated: e.target.checked } })
            }
          />
          <span>Our ERP is integrated: block a requisition above the contract limit, and require a purchase order on every invoice</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How a variation is measured" hint="Cumulative judges the whole contract; incremental judges only the extra spend.">
            <Select
              value={s.contractManagement.variationModel}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: {
                    ...s.contractManagement,
                    variationModel: e.target.value as 'CUMULATIVE' | 'INCREMENTAL',
                  },
                })
              }
            >
              <option value="CUMULATIVE">Cumulative spend</option>
              <option value="INCREMENTAL">Incremental (additional spend only)</option>
            </Select>
          </Field>
          <Field label="Variation numbers" hint="A suffix keeps the contract number; a new procurement number also links a procurement.">
            <Select
              value={s.contractManagement.variationNumbering}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: {
                    ...s.contractManagement,
                    variationNumbering: e.target.value as 'SUFFIX' | 'NEW_PROCUREMENT',
                  },
                })
              }
            >
              <option value="SUFFIX">A suffix on the contract number (CT-2026-0001-V1)</option>
              <option value="NEW_PROCUREMENT">A new procurement number as well</option>
            </Select>
          </Field>
        </div>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.contractManagement.publicSectorDisclosure}
            onChange={(e) =>
              setS({
                ...s,
                contractManagement: { ...s.contractManagement, publicSectorDisclosure: e.target.checked },
              })
            }
          />
          <span>We are a public-sector customer: disclose large contract changes on the public register</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Disclose a change over (% of the contract)">
            <Input
              type="number"
              min={0}
              max={1000}
              value={s.contractManagement.disclosureThresholdPct}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: { ...s.contractManagement, disclosureThresholdPct: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Days allowed to disclose">
            <Input
              type="number"
              min={1}
              max={365}
              value={s.contractManagement.disclosureDays}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: { ...s.contractManagement, disclosureDays: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="High-value contract from (AUD)" hint="Contracts at or above this, or judged high risk, get management and risk plans.">
            <Input
              type="number"
              min={0}
              value={s.contractManagement.highValueAud}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: { ...s.contractManagement, highValueAud: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Spend alert at (% of contract value)" hint="Besides the fixed notices at 80, 90 and 100 per cent, which cannot be changed.">
            <Input
              type="number"
              min={1}
              max={100}
              value={s.contractManagement.spendAlertPct}
              onChange={(e) =>
                setS({
                  ...s,
                  contractManagement: { ...s.contractManagement, spendAlertPct: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
      </Section>

"""
rep("""      <Section
        {...sec('criteriaLibrary')}""", section + """      <Section
        {...sec('criteriaLibrary')}""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
