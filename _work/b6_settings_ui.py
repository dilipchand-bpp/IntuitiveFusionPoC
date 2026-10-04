p = 'apps/web/src/components/admin/settings-panel.tsx'
s = open(p, encoding='utf8', newline='').read()


def rep(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)


rep("""  contractManagement: {
    erpIntegrated: boolean;""", """  dashboards: { visibility: 'HIERARCHY' | 'BROAD'; capacityPerManager: number; referenceRefreshDays: number };
  contractManagement: {
    erpIntegrated: boolean;""")
section = """      <Section
        {...sec('dashboards')}
        title="Dashboards and workload"
        blurb="Who sees whose procurements on a dashboard, how many procurements one manager can carry, and how often the reference content is refreshed."
        onSave={() => void save('dashboards', s.dashboards)}
      >
        <Field label="Dashboard visibility" hint="By hierarchy, a person sees their own unit and those beneath it; broad shows the whole organisation. Procurement and the executive always see everything.">
          <Select
            value={s.dashboards.visibility}
            onChange={(e) =>
              setS({ ...s, dashboards: { ...s.dashboards, visibility: e.target.value as 'HIERARCHY' | 'BROAD' } })
            }
          >
            <option value="BROAD">Broad: the whole organisation</option>
            <option value="HIERARCHY">By the organisation hierarchy</option>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Procurements one manager can carry">
            <Input
              type="number"
              min={1}
              max={200}
              value={s.dashboards.capacityPerManager}
              onChange={(e) =>
                setS({ ...s, dashboards: { ...s.dashboards, capacityPerManager: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Refresh the reference content every (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={s.dashboards.referenceRefreshDays}
              onChange={(e) =>
                setS({ ...s, dashboards: { ...s.dashboards, referenceRefreshDays: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </Section>

"""
rep("""      <Section
        {...sec('contractManagement')}""", section + """      <Section
        {...sec('contractManagement')}""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
